// the canvas's BACKING ratio — device pixels per CSS pixel as the renderer actually
// sized it. Not window.devicePixelRatio: the renderer may cap it (a phone at DPR 2.8
// renders ~2× the pixels of DPR 2 for no visible gain), and every CSS→device mapping
// — picks, marquees, splat sizes — must use the ratio the buffer really has.
export function backingRatio(canvas) {
  const cw = canvas && canvas.clientWidth;
  return cw ? canvas.width / cw : ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}
