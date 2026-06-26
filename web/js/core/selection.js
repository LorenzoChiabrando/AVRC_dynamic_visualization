import { idOf } from "../util.js";

// Node selection and the dim/highlight of its neighbourhood. Dimming uses
// fill/stroke-opacity (not element opacity, which would make a compositing layer per
// node and lag pan/zoom).
export function createSelection(ctx) {
  const { neighbors, profile } = ctx;
  const info = d3.select("#info");

  function focusOnNode(d) {
    const { node, link } = ctx.sel;
    const f = neighbors.get(d.id);
    const on = (n) => n.id === d.id || f.has(n.id);
    node.attr("fill-opacity", (n) => on(n) ? 1 : profile.NODE_DIM)
        .attr("stroke-opacity", (n) => on(n) ? 1 : profile.NODE_DIM);
    const inc = (l) => idOf(l.source) === d.id || idOf(l.target) === d.id;
    link.attr("stroke-opacity", (l) => inc(l) ? profile.LINK_OP : profile.LINK_DIM)
        .attr("marker-end", (l) => inc(l) ? "url(#arrow)" : null);
  }

  // Clear both the node selection and any community selection.
  function clearHighlight() {
    const { node, link } = ctx.sel;
    ctx.ui.selected = null; ctx.ui.community = null;
    node.attr("stroke", "#fff").attr("stroke-width", 1).attr("opacity", 1)
        .attr("fill-opacity", null).attr("stroke-opacity", null);
    link.attr("opacity", 1).attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
    ctx.layers.commG.selectAll("*").remove();
    ctx.labels.applyLabels();
    // Empty state: clear and hide #info; it reappears when a selection/search/community fills it.
    info.html("").style("display", "none");
  }

  function selectNode(d) {
    const { node } = ctx.sel;
    if (ctx.search) ctx.search.clearBox();                  // search and selection are exclusive
    ctx.ui.community = null; ctx.layers.commG.selectAll("*").remove();
    ctx.ui.selected = d.id;
    node.attr("stroke", (n) => n.id === d.id ? "#111" : "#fff").attr("stroke-width", (n) => n.id === d.id ? 2.5 : 1)
        .attr("opacity", 1);
    focusOnNode(d); ctx.labels.applyLabels(); ctx.info.renderInfo(d);
  }

  return { focusOnNode, clearHighlight, selectNode };
}
