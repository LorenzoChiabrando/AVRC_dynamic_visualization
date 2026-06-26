// Node labels: the text element per node, the name/id switch, and the display rules
// (hovered, search matches, selection, or the top-degree set). The label selection is
// shared on ctx so render can position it.
export function createLabels(ctx) {
  const { zoomG, nodes, ui, scales, topLabelled } = ctx;
  const { fontOf } = scales;

  const labelText = (d) => ui.labelId ? (d.id || d.name) : (d.name || d.id);
  const label = zoomG.append("g")
    .selectAll("text").data(nodes, (d) => d.id).join("text")
    .attr("text-anchor", "middle").style("pointer-events", "none")
    .style("font-size", (d) => fontOf(d) + "px").style("font-weight", 700)
    .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 4).style("fill", "#222")
    .style("display", "none").text(labelText);
  ctx.sel.label = label;

  function applyLabelText() { label.text(labelText); }

  function applyLabels() {
    // In the isolated view labels are handled by relayoutIso (columns), so skip here.
    if (ctx.iso.active) return;
    const searchHit = ctx.search ? ctx.search.hit : () => false;
    label.style("display", (d) => {
      if (!ui.currency && d.currency) return "none";
      if (d.id === ctx.hovered) return null;
      // Search with matches: show only match labels (debounced via searchLabels).
      if (ui.search && ui.searchMatch) return (ui.searchLabels && searchHit(d)) ? null : "none";
      if (ui.selected) return d.id === ui.selected ? null : "none";
      return (ui.labels && topLabelled.has(d.id)) ? null : "none";
    });
  }

  return { labelText, applyLabelText, applyLabels };
}
