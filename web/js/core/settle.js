// Headless warm-up: tick the simulation many steps per frame without redrawing
// (redrawing ~3900 nodes every frame is the real cost), show the percentage under
// the veil, draw once at the end. The simulation lives on ctx.sim (set by the layout).
export function createSettle(ctx) {
  const TICKS_PER_FRAME = 25;
  function animateSettle(done) {
    const total = ctx.opt.settleTicks; let t = 0;
    ctx.overlay.show();
    ctx.render.positionAll(); ctx.zoomCtl.fitView(false);
    (function frame() {
      const end = Math.min(t + TICKS_PER_FRAME, total);
      for (; t < end; t++) ctx.sim.tick();
      ctx.overlay.setText(`Computing the layout… ${Math.round((100 * t) / total)}%`);
      if (t < total) requestAnimationFrame(frame); else done();
    })();
  }
  return { animateSettle };
}
