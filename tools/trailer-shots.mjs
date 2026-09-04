// The trailer's cut, shared by build-trailer.mjs and render-captions.mjs.
//
// Both tools need the same timeline: the builder to lay the clips out, the caption renderer to know
// when each line is on screen. Keeping the table here means a caption can name the shot it belongs
// over (`over: '15-nova.png'`) instead of a hand-computed fraction that silently drifts the moment a
// shot's length changes — which is exactly how "some of us stayed, and sang to the stones" ended up
// over a shot of somebody else.

/** shot = plate file, seconds on screen, Ken Burns move (start/end zoom + pan direction) */
export const SHOTS = [
  ['01-path.png',      4.2, { z0: 1.00, z1: 1.10, dx: 0.0, dy: 0.0 }],
  ['02-approach.png',  3.8, { z0: 1.09, z1: 1.00, dx: -0.2, dy: 0.0 }],
  ['03-gate.png',      3.4, { z0: 1.00, z1: 1.11, dx: 0.0, dy: -0.1 }],
  ['04-forest.png',    3.0, { z0: 1.10, z1: 1.00, dx: 0.25, dy: 0.0 }],
  ['05-lanterns.png',  3.4, { z0: 1.00, z1: 1.10, dx: 0.1, dy: 0.0 }],
  ['06-court.png',     3.4, { z0: 1.08, z1: 1.00, dx: -0.15, dy: 0.05 }],
  // the shrine is still tended: the wide, then Nova, then a watcher alone at the edge
  ['14-tended.png',    3.4, { z0: 1.00, z1: 1.09, dx: 0.12, dy: 0.0 }],
  ['15-nova.png',      4.0, { z0: 1.12, z1: 1.00, dx: 0.0, dy: 0.0 }],
  ['07-pool.png',      2.4, { z0: 1.00, z1: 1.12, dx: 0.0, dy: 0.1 }],
  ['16-watcher.png',   3.0, { z0: 1.00, z1: 1.10, dx: -0.14, dy: 0.0 }],
  ['08-stone.png',     3.4, { z0: 1.12, z1: 1.00, dx: 0.0, dy: 0.0 }],
  ['09-ruin.png',      2.8, { z0: 1.00, z1: 1.10, dx: -0.2, dy: 0.0 }],
  ['10-innergate.png', 3.4, { z0: 1.00, z1: 1.13, dx: 0.0, dy: -0.05 }],
  ['17-kneel.png',     3.2, { z0: 1.09, z1: 1.00, dx: 0.10, dy: 0.0 }],
  ['11-sanctum.png',   3.4, { z0: 1.10, z1: 1.00, dx: 0.0, dy: 0.1 }],
  ['12-beamwide.png',  3.8, { z0: 1.00, z1: 1.12, dx: 0.0, dy: 0.0 }],
  ['13-crane.png',     5.0, { z0: 1.12, z1: 1.00, dx: 0.0, dy: 0.0 }],
];

/** cross-dissolve length, in seconds */
export const XF = 0.7;

/**
 * Where every shot sits on the finished timeline.
 * Shots overlap by XF, so shot i starts at sum(previous lengths) - XF * i.
 */
export function timeline(shots = SHOTS) {
  let acc = 0;
  const at = shots.map(([file, secs], i) => {
    const start = acc - XF * i;
    acc += secs;
    return { file, start, end: start + secs, secs };
  });
  const total = acc - XF * (shots.length - 1);
  return { at, total, find: (file) => at.find((s) => s.file === file) };
}
