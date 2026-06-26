import { LINK_COL } from "../config.js";
import { idOf } from "../util.js";

// Build the link, node and community layers, plus edge geometry, positioning, the
// currency toggle and the drag behavior. Selections are stored on ctx so the other
// modules share them.
export function createRender(ctx) {
  const { zoomG, nodes, links, byId, ui, profile, scales } = ctx;
  const { rOf, colorOf, symbolGen } = scales;

  // Edges: no pointer events, arrowheads via the shared marker.
  const link = zoomG.append("g")
    .attr("fill", "none").style("pointer-events", "none")
    .attr("stroke", LINK_COL).attr("stroke-opacity", profile.LINK_OP).attr("stroke-width", profile.LINK_W)
    .selectAll("path").data(links).join("path").attr("marker-end", "url(#arrow)");

  // Community rectangle layer, between edges and nodes so nodes stay on top.
  const commG = zoomG.append("g").style("pointer-events", "none");

  const node = zoomG.append("g")
    .selectAll("path").data(nodes).join("path")
    .attr("d", symbolGen).attr("fill", colorOf)
    .attr("stroke", "#fff").attr("stroke-width", 1).style("cursor", "pointer");
  node.append("title").text((d) => `${d.name} (${d.kind === "reaction" ? "reaction" : "metabolite"})`);

  ctx.sel.node = node;
  ctx.sel.link = link;
  ctx.layers.commG = commG;

  const isCurr = (ref) => { const n = byId.get(idOf(ref)); return !!(n && n.currency); };
  function applyCurrency() {
    node.style("display", (d) => (!ui.currency && d.currency) ? "none" : null);
    link.style("display", (l) => (!ui.currency && (isCurr(l.source) || isCurr(l.target))) ? "none" : null);
  }

  // Straight edge, shortened at the target end so the arrow sits outside the node.
  function edgePoint(l) {
    const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
    const len = Math.hypot(dx, dy) || 1, gap = rOf(l.target) + 4;
    return { x: l.target.x - (dx / len) * gap, y: l.target.y - (dy / len) * gap };
  }
  const linkPath = (l) => { const s = l.source, e = edgePoint(l); return `M${s.x},${s.y} L${e.x},${e.y}`; };

  function positionAll() {
    link.attr("d", linkPath);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    if (ctx.sel.label) ctx.sel.label.attr("x", (d) => d.x).attr("y", (d) => d.y - rOf(d) - 6);
  }
  function moveOne(d) {
    node.filter((n) => n === d).attr("transform", `translate(${d.x},${d.y})`);
    link.filter((l) => l.source === d || l.target === d).attr("d", linkPath);
    if (ctx.sel.label) ctx.sel.label.filter((n) => n === d).attr("x", d.x).attr("y", d.y - rOf(d) - 6);
  }

  const drag = d3.drag()
    .container(() => zoomG.node())
    .on("start", (e, d) => { d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.x = e.x; d.y = e.y; d.fx = e.x; d.fy = e.y; moveOne(d); })
    .on("end", (e, d) => { d.fx = null; d.fy = null; });
  ctx.drag = drag;

  return { positionAll, linkPath, applyCurrency };
}
