// Warm-up veil over the graph while the layout is computed headless.
export function createOverlay(svg, W, H) {
  const g = svg.append("g");
  g.append("rect").attr("width", W).attr("height", H).attr("fill", "#fff").attr("opacity", 0.55);
  const text = g.append("text")
    .attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
    .style("font-size", "15px").style("fill", "#444").style("font-weight", "600")
    .text("Warming up the layout…");
  return {
    show() {
      document.body.classList.add("loading");
      g.raise().style("display", null).style("opacity", 1);
    },
    hide() {
      document.body.classList.remove("loading");
      g.transition().duration(250).style("opacity", 0).on("end", () => g.style("display", "none"));
    },
    setText(s) { text.text(s); },
  };
}
