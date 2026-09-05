import type { Game } from '@/gameplay/game';

/** Opt-in artist review using the actual world, renderer, assets and actor animation path. */
export function installCharacterReview(game: Game): void {
  type Pose = Parameters<Game['combat']['preview']>[3];
  let angle = 0;
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label','Character review');
  panel.style.cssText='position:fixed;z-index:1000;left:20px;bottom:20px;max-width:calc(100vw - 40px);padding:16px;background:#101c29ee;color:#d7edf1;border:1px solid #49616b;border-radius:8px;font:14px system-ui;display:flex;gap:12px;flex-wrap:wrap;align-items:center';
  const title = document.createElement('strong');title.textContent='SHRINE · CHARACTER REVIEW';panel.append(title);
  const status = document.createElement('output');status.setAttribute('aria-live','polite');
  const pose = document.createElement('select');pose.setAttribute('aria-label','Animation');
  for (const [value,label] of [['idle','Combat idle'],['walk','Walk'],['run','Run'],['slash','Light attack'],['heavy','Heavy attack'],['dodge','Dodge'],['hit','Hit reaction'],['death','Death']]) {
    const option = document.createElement('option');option.value=value;option.textContent=label;pose.append(option);
  }
  const show=()=>{
    game.combat.preview(0,-8,180,pose.value as Pose);
    game.combat.setPreviewAngle(angle);
    status.textContent=`${pose.selectedOptions[0].text} · ${angle}°`;
  };
  pose.addEventListener('change',show);panel.append(pose);
  for (const [label,value] of [['Front',0],['Side',90],['Back',180]] as const) {
    const button=document.createElement('button');button.textContent=label;
    button.onclick=()=>{angle=value;show();};panel.append(button);
  }
  const pause=document.createElement('button');pause.textContent='Pause';
  pause.onclick=()=>{const stopped=pause.textContent==='Pause';game.setPaused(stopped);pause.textContent=stopped?'Play':'Pause';};
  panel.append(pause,status);document.body.append(panel);
  game.freeCam=true;game.player.enabled=false;
  game.world.camera.setPosition(0,3.8,-12);
  game.world.camera.lookAt(0,3.3,-4);
  show();
}
