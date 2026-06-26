import { PROFILE, LAYOUT, ARROW_COL } from "../config.js";
import { createOverlay } from "./overlay.js";

// Build the shared context: the svg, the zoom group, the arrow marker, the overlay,
// the data and maps, the per-view profile and layout options, and the mutable state
// holders (ui flags, zoom factor, isolated-view state). Every module reads/writes ctx.
export function createContext({ view, graph }) {
  const W = window.innerWidth, H = window.innerHeight;
  const svg = d3.select("#graph");
  const zoomG = svg.append("g");
  // Minimal zoom handler here; core/zoom.js replaces it with onZoom (which also
  // rescales search beacons) once it is created.
  const zoom = d3.zoom().scaleExtent([0.03, 8]).on("zoom", (e) => zoomG.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrow").attr("viewBox", "0 0 10 10")
    .attr("refX", 9).attr("refY", 5).attr("markerWidth", 5).attr("markerHeight", 5)
    .attr("orient", "auto-start-reverse")
    .append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", ARROW_COL);

  const overlay = createOverlay(svg, W, H);

  return {
    view, W, H, svg, zoomG, zoom, overlay,
    nodes: graph.nodes, links: graph.links,
    byId: graph.byId, neighbors: graph.neighbors,
    inNbr: graph.inNbr, outNbr: graph.outNbr, topLabelled: graph.topLabelled,
    profile: PROFILE[view],
    scales: null,              // set by createScales
    sel: {}, layers: {},       // node/link/label selections + commG/glabelG layers
    drag: null,
    ui: {
      currency: true, labels: true, groupLabels: true, selected: null,
      community: null, search: "", searchLabels: false, searchMatch: false, labelId: false,
    },
    opt: { ...LAYOUT[view] },   // mutable copy of the view's layout defaults
    k: 1, sizedK: null, hovered: null,
    iso: {
      active: false, focal: null, snapshot: null, shown: null, radius: null,
      state: null, labelTimer: null, path: [], pathExpanded: false, touched: null,
    },
  };
}
