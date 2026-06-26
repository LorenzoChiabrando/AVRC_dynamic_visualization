// Neutral legend: node type swatches. Colors come from the per-view profile.
export function createLegend(ctx) {
  const { profile } = ctx;
  const legendEl = d3.select("#legend");
  function renderLegend() {
    legendEl.selectAll("*").remove();
    const item = (color, text, square) => {
      const sw = legendEl.append("span").attr("class", "sw");
      sw.append("i").style("background", color).style("border-radius", square ? "2px" : "50%");
      sw.append("span").text(text);
    };
    item(profile.COL_MET, "metabolite", false);
    item(profile.COL_RXN, "reaction", true);
  }
  return { renderLegend };
}
