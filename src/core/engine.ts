import {
  AppBase, AppOptions, CameraComponentSystem, DEVICETYPE_WEBGL2, DEVICETYPE_WEBGPU,
  FILLMODE_FILL_WINDOW, GraphicsDevice, Keyboard, LightComponentSystem, Mouse,
  ParticleSystemComponentSystem, RESOLUTION_AUTO, RenderComponentSystem, TextureHandler,
  ContainerHandler, createGraphicsDevice, platform,
} from 'playcanvas';

export interface EngineContext {
  app: AppBase;
  device: GraphicsDevice;
  canvas: HTMLCanvasElement;
  isWebGPU: boolean;
  rendererName: string;
  supportsCompute: boolean;
}

export interface EngineOptions { forceWebGL?: boolean; }

/**
 * Creates the graphics device (WebGPU first, automatic WebGL2 fallback) and the
 * PlayCanvas application with only the component systems and handlers we use.
 */
export async function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions = {}): Promise<EngineContext> {
  const deviceTypes = opts.forceWebGL ? [DEVICETYPE_WEBGL2] : [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2];

  let device: GraphicsDevice;
  try {
    device = await createGraphicsDevice(canvas, {
      deviceTypes,
      antialias: false,           // the scene is rendered to an internal HDR target with TAA
      powerPreference: 'high-performance',
      xrCompatible: false,
    });
  } catch (err) {
    console.warn('[engine] preferred device failed, falling back to WebGL2', err);
    device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: false });
  }

  // Cap device pixel ratio: 4K displays at DPR 2 would quadruple the fragment load
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

  const options = new AppOptions();
  options.graphicsDevice = device;
  options.keyboard = new Keyboard(window);
  options.mouse = new Mouse(canvas);
  options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ParticleSystemComponentSystem];
  options.resourceHandlers = [TextureHandler, ContainerHandler];

  const app = new AppBase(canvas);
  app.init(options);
  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);

  const resize = () => app.resizeCanvas();
  window.addEventListener('resize', resize);
  app.on('destroy', () => window.removeEventListener('resize', resize));

  const isWebGPU = device.isWebGPU;
  const rendererName = isWebGPU ? 'WebGPU' : 'WebGL 2';
  const ctx: EngineContext = { app, device, canvas, isWebGPU, rendererName, supportsCompute: !!device.supportsCompute };
  console.info(`[engine] ${rendererName} · compute=${ctx.supportsCompute} · mobile=${platform.mobile}`);
  return ctx;
}
