// Zoom and the auto-fit camera. onZoom also rescales the search beacons when a search
// is active (so they keep a readable on-screen size).
export function createZoom(ctx) {
  const { svg, zoomG, zoom, nodes, W, H, ui } = ctx;

  function onZoom(e) {
    zoomG.attr("transform", e.transform);
    ctx.k = e.transform.k;
    if (ui.searchMatch && ctx.k !== ctx.sizedK && ctx.search) ctx.search.sizeHits();
  }
  zoom.on("zoom", onZoom);

  // fitView: frame the visible nodes with a uniform padding around them.
  function fitView(animate) {
    const vis = nodes.filter((d) => ui.currency || !d.currency);
    if (!vis.length) return;
    const xs = vis.map((d) => d.x), ys = vis.map((d) => d.y);
    const x0 = d3.min(xs), x1 = d3.max(xs), y0 = d3.min(ys), y1 = d3.max(ys);
    const gw = (x1 - x0) || 1, gh = (y1 - y0) || 1, pad = 60;
    const kk = Math.max(0.03, Math.min((W - 2 * pad) / gw, (H - 2 * pad) / gh, 2));
    const tx = (W - kk * (x0 + x1)) / 2, ty = (H - kk * (y0 + y1)) / 2;
    const target = d3.zoomIdentity.translate(tx, ty).scale(kk);
    if (animate) svg.transition().duration(500).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  return { onZoom, fitView };
}
