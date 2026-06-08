// reactions.js: D3 v7 viewer for the reaction to reaction projection.
// One node per reaction (no metabolites). Data comes from data/reactions.json.
// D3 is the global "d3" loaded by the HTML page.

const svg = d3.select("#graph");
const info = d3.select("#info");
const width = window.innerWidth;
const height = window.innerHeight;

const filterSub = document.getElementById("filter-subsystem");

const REACTION_COLOR = "#e4572e";
const RADIUS = 4;
const RADIUS_SELECTED = 8;
const DIM_NODE = 0.1;
const DIM_LINK = 0.04;
const LINK_OPACITY = 0.5;

// One <g> that we transform for zoom and pan.
const container = svg.append("g");

svg.call(
  d3.zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => container.attr("transform", event.transform))
);

d3.json("data/reactions.json").then((graph) => {
  // Force directed layout.
  const simulation = d3.forceSimulation(graph.nodes)
    .force("link", d3.forceLink(graph.links).id((d) => d.id).distance(30))
    .force("charge", d3.forceManyBody().strength(-30))
    .force("center", d3.forceCenter(width / 2, height / 2));

  // One <line> per edge.
  const link = container.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(graph.links)
    .join("line")
    .attr("class", "link");

  // One <circle> per reaction.
  const node = container.append("g")
    .attr("class", "nodes")
    .selectAll("circle")
    .data(graph.nodes)
    .join("circle")
    .attr("class", "node")
    .attr("r", RADIUS)
    .attr("fill", REACTION_COLOR)
    .call(drag(simulation))
    .on("click", (event, d) => {
      event.stopPropagation();
      select(d);
    });

  // Native tooltip with the reaction name.
  node.append("title").text((d) => d.name);

  // Click on the background clears the selection.
  svg.on("click", clearSelection);

  // Fill the subsystem filter with the distinct values from the data.
  populateOptions(filterSub, distinct(graph.nodes, "subsystem"));
  filterSub.addEventListener("change", applyHighlight);

  let selectedId = null;

  function select(d) {
    selectedId = d.id;
    node.classed("selected", (n) => n.id === selectedId)
        .attr("r", (n) => (n.id === selectedId ? RADIUS_SELECTED : RADIUS));
    renderInfo(d);
  }

  function clearSelection() {
    selectedId = null;
    node.classed("selected", false).attr("r", RADIUS);
    info.html('<span class="muted">Click a node to see its details</span>');
  }

  function renderInfo(d) {
    const rows = [
      ["id", d.id],
      ["type", "reaction"],
      ["subsystem", d.subsystem ?? "-"],
      ["reversible", d.reversible ? "yes" : "no"],
      ["degree", d.degree],
    ];
    const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
    info.html(`<div class="title">${escapeHtml(d.name || d.id)}</div><dl>${dl}</dl>`);
  }

  // A reaction matches when its subsystem is the one picked in the menu.
  function matchesFilter(d) {
    return Boolean(filterSub.value) && d.subsystem === filterSub.value;
  }

  function applyHighlight() {
    const active = Boolean(filterSub.value);
    node.attr("opacity", (d) => (!active || matchesFilter(d) ? 1 : DIM_NODE));
    link.attr("stroke-opacity", (l) => {
      if (!active) return LINK_OPACITY;
      return matchesFilter(l.source) || matchesFilter(l.target) ? LINK_OPACITY : DIM_LINK;
    });
  }

  // Copy the simulated positions into SVG attributes on every tick.
  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y);
  });
}).catch((err) => {
  console.error("Failed to load data/reactions.json. Run `python converter/convert.py --graph reaction`", err);
});


// Distinct values of an attribute across all nodes, sorted.
function distinct(nodes, attr) {
  return Array.from(new Set(nodes.map((n) => n[attr]).filter(Boolean))).sort();
}

function populateOptions(select, values) {
  for (const v of values) select.append(new Option(v, v));
}

// Escape the HTML special characters so text can be injected safely.
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Node dragging. fx/fy pin the node while dragging, alphaTarget reheats the layout.
function drag(simulation) {
  return d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}
