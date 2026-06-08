// viewer.js: bipartite metabolic network viewer (D3 v7).
//
// Performance approach for a large graph (~3900 nodes, ~8800 edges):
//   currency metabolites are hidden by default (a toggle shows them);
//   the force layout is computed headless behind an overlay, without redrawing
//   on every tick; once settled we draw the graph, stop the simulation and auto
//   fit the view.
//
// Interactions: drag, zoom and pan, hover neighbour label, click to select,
// search, color toggles, legend. D3 is the global "d3" loaded by the page.


// Style and behavior constants.
const COL_MET   = "#8bc34a";   // lime green, metabolites
const COL_RXN   = "#8e5fd0";   // purple, reactions
const GREY      = "#c4c8cc";   // grey for "Other" and non matches
const LINK_COL  = "#aab1b8";   // edges, medium grey
const LINK_W    = 1.5;         // edge width
const LINK_OP   = 0.6;         // edge stroke-opacity in the normal state
// LINK_DIM and NODE_DIM apply to selection: they dim what is not connected to the
// selected node. For edges we use element opacity (not stroke-opacity) so the
// arrow tip fades too (the marker has its own paint).
const LINK_DIM  = 0.05;        // edge opacity when not linked to the selected node
const NODE_DIM  = 0.15;        // node opacity when not linked to the selected node
const R_MIN     = 6;           // minimum radius (low degree)
const R_MAX     = 40;          // maximum radius (hubs)
const SUB_N     = 10;          // how many subsystems get a color (rest are "Other")
const TOP_LABELS = 28;         // how many nodes are always labelled (most connected)
const MATCH_COL = "#D55E00";   // search highlight color
const ARROW_COL = "#7a828b";   // arrow tip color
const ISO_DUR   = 800;         // isolate and return animation duration (ms)

// Isolated view (ego network) parameters in one place: column geometry, label
// spacing to avoid overlap, and node radii in the dedicated view.
const ISO = {
  rowH:     30,   // vertical step between rows of a column (px)
  panelTop: 128,  // space above the columns for the #iso-panel bar
  botPad:   56,   // space below the columns
  colFrac: 0.30,  // column distance from the focal as a fraction of window width...
  colMax:  420,   // ...capped in px so columns do not run off on wide screens
  nbrRMin:   6,   // minimum radius of a neighbour node
  nbrRMax:  12,   // maximum radius of a neighbour node
  focalR:   20,   // minimum radius of the focal node
  labelGap:  8,   // gap between the node edge and its side label
};

// Force layout defaults. These are the initial values of the layout panel, kept
// in one place so the sliders and the simulation read the same numbers.
const LAYOUT_DEFAULTS = {
  charge:      -160,   // repulsion between nodes (negative pushes them apart)
  chargeMax:    600,   // max range of the repulsion (higher is more spaced, slower)
  linkBase:      55,   // base edge length (the two node radii are added to it)
  collidePad:     3,   // extra anti overlap padding beyond the node radius
  separate:   false,   // if true, push metabolites left and reactions right
  settleTicks:  320,   // headless simulation steps before drawing
};


// Page elements.
const svg  = d3.select("#graph");
const info = d3.select("#info");
const W = window.innerWidth;
const H = window.innerHeight;

// Toolbar controls.
const elSearch = d3.select("#search");
const elSub    = d3.select("#t-sub");
const elComp   = d3.select("#t-comp");
const elCurr   = d3.select("#t-curr");
const elLabels = d3.select("#t-lbl");
const elSel    = d3.select("#sub-select");
const elReset  = d3.select("#reset");
const legendEl = d3.select("#legend");

// After forceLink, edge source/target are node objects; before, they are strings.
// idOf returns the string id whatever the form.
const idOf = (ref) => (ref && ref.id != null ? ref.id : ref);


// Wrapper group for zoom and pan. The whole graph lives in this <g>; one transform
// here moves and scales the entire scene.
const zoomG = svg.append("g");
const zoom = d3.zoom()
  .scaleExtent([0.04, 8])
  .on("zoom", (e) => zoomG.attr("transform", e.transform));
svg.call(zoom).on("dblclick.zoom", null);   // no zoom on double click

// Single arrow marker reused by every edge; it orients along the edge tangent.
svg.append("defs").append("marker")
  .attr("id", "arrow").attr("viewBox", "0 0 10 10")
  .attr("refX", 9).attr("refY", 5).attr("markerWidth", 5).attr("markerHeight", 5)
  .attr("orient", "auto-start-reverse")
  .append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", ARROW_COL);

// Loading overlay: a semi transparent veil so you can see the network settle
// underneath while the layout is computed.
const overlay = svg.append("g");
overlay.append("rect").attr("width", W).attr("height", H).attr("fill", "#ffffff").attr("opacity", 0.55);
const overlayText = overlay.append("text")
  .attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
  .style("font-size", "15px").style("fill", "#444").style("font-weight", "600")
  .text("Warming up the layout…");

// The overlay is kept, not destroyed: hidden after the settle and shown again on
// each recompute.
function showOverlay() {
  overlay.raise().style("display", null).style("opacity", 1);   // raise above everything again
}
function hideOverlay() {
  overlay.transition().duration(250).style("opacity", 0)
    .on("end", () => overlay.style("display", "none"));
}


// Load the data.
d3.json("data/graph.json").then((raw) => {

  // Size scale: degree to radius (sqrt so the area grows with degree).
  const rScale = d3.scaleSqrt().domain(d3.extent(raw.nodes, (d) => d.degree)).range([R_MIN, R_MAX]);
  const rOf = (d) => rScale(d.degree || 0);

  // Label size scale: degree to px, so the most connected labels are larger.
  const fScale = d3.scaleSqrt().domain(d3.extent(raw.nodes, (d) => d.degree)).range([13, 22]);
  const fontOf = (d) => fScale(d.degree || 0);

  // Shapes: circle for metabolite, square for reaction. size is the area.
  const symbolGen = d3.symbol()
    .type((d) => d.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle)
    .size((d) => Math.PI * rOf(d) * rOf(d));

  // Base color by type.
  const baseColor = (d) => d.kind === "reaction" ? COL_RXN : COL_MET;

  // Categorical palettes, computed from the data.
  // Top N subsystems by reaction count get a color.
  const subCounts = d3.rollup(raw.nodes.filter((n) => n.kind === "reaction"), (v) => v.length, (d) => d.subsystem);
  const topSubs = [...subCounts].sort((a, b) => b[1] - a[1]).slice(0, SUB_N).map((d) => d[0]);
  const subColor = d3.scaleOrdinal(topSubs, d3.schemeTableau10);
  // Compartments (few): one color each.
  const comps = [...new Set(raw.nodes.filter((n) => n.kind === "metabolite").map((d) => d.compartment))].sort();
  const compColor = d3.scaleOrdinal(comps, d3.schemeTableau10);
  // All subsystems, to fill the "isolate one" menu.
  const allSubs = [...new Set(raw.nodes.filter((n) => n.kind === "reaction").map((d) => d.subsystem))].sort();
  allSubs.forEach((s) => elSel.append("option").attr("value", s).text(s));

  // Working nodes and edges. Nodes are the original objects (the simulation adds
  // x/y). Edges are cloned with string source/target (forceLink resolves them).
  const nodes = raw.nodes;
  const links = raw.links.map((l) => ({ source: idOf(l.source), target: idOf(l.target), weight: l.weight, stoichiometry: l.stoichiometry }));

  // Neighbour map (id to Set of ids) for hover, built once.
  const neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  links.forEach((l) => { neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source); });

  // id to node map, to get a name from an id (details panel).
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Direct neighbours split by direction. Edge direction is meaningful: M to R
  // means the metabolite is a substrate, R to M means the reaction produces it.
  // source/target are still strings here.
  //   outNbr[id] = ids that id points to (outgoing)
  //   inNbr[id]  = ids that point to id  (incoming)
  const outNbr = new Map(nodes.map((n) => [n.id, []]));
  const inNbr  = new Map(nodes.map((n) => [n.id, []]));
  links.forEach((l) => { outNbr.get(l.source).push(l.target); inNbr.get(l.target).push(l.source); });

  // Nodes that are always labelled: the most connected, currency excluded.
  const topLabelled = new Set(
    [...nodes].filter((n) => !n.currency).sort((a, b) => b.degree - a.degree).slice(0, TOP_LABELS).map((d) => d.id)
  );

  // UI state.
  const ui = { sub: false, comp: false, currency: false, soloSub: "", selected: null };

  // Force layout state, edited by the layout panel sliders. Starts from defaults.
  const layout = { ...LAYOUT_DEFAULTS };


  // Draw once (data join). Edges first (below), then nodes, then labels. Edges are
  // straight <path> segments; fill:none so the path is not filled, and the arrow
  // orients itself on the segment.
  const link = zoomG.append("g")
    .attr("fill", "none").style("pointer-events", "none")   // edges do not catch clicks
    .attr("stroke", LINK_COL).attr("stroke-opacity", LINK_OP).attr("stroke-width", LINK_W)
    .selectAll("path").data(links).join("path")
    .attr("marker-end", "url(#arrow)");

  const node = zoomG.append("g")
    .selectAll("path").data(nodes).join("path")
    .attr("d", symbolGen).attr("fill", baseColor)
    .attr("stroke", "#fff").attr("stroke-width", 1)
    .style("cursor", "pointer");
  node.append("title").text((d) => `${d.name} (${d.kind === "reaction" ? "reaction" : "metabolite"})`);

  // One label per node, shown selectively (see applyLabels). White halo so they
  // read over the edges.
  const labelSel = zoomG.append("g")
    .selectAll("text").data(nodes, (d) => d.id).join("text")
    .attr("text-anchor", "middle").style("pointer-events", "none")
    .style("font-size", (d) => fontOf(d) + "px").style("font-weight", 700)
    .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 4).style("fill", "#222")
    .style("display", "none")   // hidden during warm up; applyLabels turns them on after the settle
    .text((d) => d.name);

  // Label state: labelsOn shows the top N (the "show labels" toggle); hovered is
  // the id under the mouse (its label stays visible while you are over it).
  let labelsOn = true;
  let hovered = null;

  // applyLabels: single source of truth for which labels are visible.
  //  with a selection: only the clicked node's label.
  //  without a selection: the top N by degree (when labels are on).
  //  always: the hovered node shows its label; never the hidden currency nodes.
  function applyLabels() {
    labelSel.style("display", (d) => {
      if (!ui.currency && d.currency) return "none";
      if (d.id === hovered) return null;                            // hover: always visible
      if (ui.selected) return d.id === ui.selected ? null : "none"; // selection: only the clicked node
      return (labelsOn && topLabelled.has(d.id)) ? null : "none";   // normal: top N when on
    });
  }


  // Layout helpers (used both at creation and on recompute).

  // Degree aware edge length: the two endpoint radii are added to the base, so
  // hubs get longer edges and their many neighbours fan out instead of crowding.
  const linkDist = (l) => layout.linkBase + rOf(l.source) + rOf(l.target);
  // Horizontal target: center by default, or, with "separate", metabolites left
  // (30%) and reactions right (70%).
  const sepX = (d) => layout.separate ? (d.kind === "reaction" ? W * 0.70 : W * 0.30) : W / 2;
  const sepStrength = () => layout.separate ? 0.12 : 0.03;

  // Force simulation, created stopped; we run it headless.
  // The parameters read `layout`; applyLayout re-applies them after the sliders.
  const sim = d3.forceSimulation(nodes)
    // no fixed link strength: the D3 default (1/min-degree) keeps leaf-to-hub
    // edges stiff and hub-to-hub edges loose, so the network spreads out.
    .force("link", d3.forceLink(links).id((d) => d.id).distance(linkDist))
    // distanceMax limits the repulsion range: higher is more space but slower.
    .force("charge", d3.forceManyBody().strength(layout.charge).distanceMax(layout.chargeMax))
    .force("collide", d3.forceCollide().radius((d) => rOf(d) + layout.collidePad))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("x", d3.forceX(sepX).strength(sepStrength))
    .force("y", d3.forceY(H / 2).strength(0.03))
    .stop();   // does not start on its own: we step it behind the overlay

  // applyLayout: re-apply the current `layout` values to the forces. Re-setting the
  // accessors makes D3 rebuild its internal tables, so this plus a new settle is enough.
  function applyLayout() {
    sim.force("charge").strength(layout.charge).distanceMax(layout.chargeMax);
    sim.force("link").distance(linkDist);
    sim.force("collide").radius((d) => rOf(d) + layout.collidePad);
    sim.force("x").x(sepX).strength(sepStrength);
  }


  // Live warm up of the layout. We step the simulation in a requestAnimationFrame
  // loop: each frame runs a few ticks and redraws, so the network is seen settling
  // under the veil. The camera (fitView) follows the expansion each frame.
  //
  // TICKS_PER_FRAME trades smoothness for speed. With ~3800 nodes the redraw, not
  // the ticks, dominates, so we keep it low.
  const TICKS_PER_FRAME = 3;

  // drawSettling: like positionAll but without labels (placing ~3800 texts every
  // frame would be too costly during the warm up).
  function drawSettling() {
    link.attr("d", linkPath);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  function animateSettle(done) {
    const total = layout.settleTicks;
    let t = 0;
    showOverlay();
    (function frame() {
      const end = Math.min(t + TICKS_PER_FRAME, total);
      for (; t < end; t++) sim.tick();
      drawSettling();                                        // the network moves on screen
      fitView(false);                                        // the camera follows the expansion
      overlayText.text(`Warming up the layout… ${Math.round((100 * t) / total)}%`);
      if (t < total) requestAnimationFrame(frame);
      else done();
    })();
  }

  // Draw current positions (called once after the settle and during drag).
  function positionAll() {
    link.attr("d", linkPath);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    labelSel.attr("x", (d) => d.x).attr("y", (d) => d.y - rOf(d) - 6);
  }

  // edgePoint: the edge end shortened to the target node border, so the arrow is
  // not hidden inside the node.
  function edgePoint(l) {
    const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
    const len = Math.hypot(dx, dy) || 1, gap = rOf(l.target) + 4;
    return { x: l.target.x - (dx / len) * gap, y: l.target.y - (dy / len) * gap };
  }

  // linkPath: straight segment from source to the target border (edgePoint leaves
  // a small gap for the arrow).
  function linkPath(l) {
    const s = l.source, e = edgePoint(l);
    return `M${s.x},${s.y} L${e.x},${e.y}`;
  }

  // Startup: set colors and currency before the warm up (so the network you see
  // moving is already correct), run the live warm up, then place labels, wire the
  // interactions and remove the veil.
  applyCurrency();        // hide currency (default) already during the warm up
  recolor();              // base color
  animateSettle(() => {
    positionAll();        // reposition everything, labels included
    applyLabels();        // labels: top N visible after the warm up
    node.call(drag);      // enable dragging
    wireInteractions();   // hover, click, toolbar, layout panel
    fitView(false);       // final framing
    hideOverlay();        // fade the veil out
  });

  // recompute: called by the "recompute layout" button. Re-applies the slider
  // values, reheats the simulation and settles it with the live warm up, then
  // finalizes. We stay in the "stop after settle" model.
  function recompute() {
    applyLayout();                                          // forces from current values
    sim.alpha(1);                                           // reheat the simulation
    animateSettle(() => {
      positionAll();
      applyLabels();
      fitView(false);
      hideOverlay();
    });
  }


  // Light drag. The simulation is stopped: dragging does not reheat it. We move
  // only the dragged node and the edges/label that touch it.
  const drag = d3.drag()
    .container(() => zoomG.node())   // coordinates consistent with zoom and pan
    .on("start", (e, d) => { d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => {
      d.x = e.x; d.y = e.y; d.fx = e.x; d.fy = e.y;
      moveOne(d);
    })
    .on("end", (e, d) => { if (!d.pinned) { d.fx = null; d.fy = null; } });

  // moveOne: redraw only node d, its incident edges and its label.
  function moveOne(d) {
    node.filter((n) => n === d).attr("transform", `translate(${d.x},${d.y})`);
    link.filter((l) => l.source === d || l.target === d).attr("d", linkPath);
    labelSel.filter((n) => n === d).attr("x", d.x).attr("y", d.y - rOf(d) - 6);
  }


  // Interactions (hover, click, toolbar), wired after the first draw.
  function wireInteractions() {

    // Hover shows only the label of the node under the mouse. Neighbour highlight
    // and dimming happen on selection (click), not on hover.
    node.on("mouseenter", (e, d) => { if (isolated) return; hovered = d.id; applyLabels(); });
    node.on("mouseleave", () => { if (isolated) return; hovered = null; applyLabels(); });

    // Click on a node selects it (dark border plus info panel). In the isolated
    // view node clicks drill down instead (you leave with Exit or Esc).
    node.on("click", (e, d) => {
      e.stopPropagation();
      // Isolated view: click a shown neighbour to drill down to it. Click on the
      // focal or a hidden node does nothing. Outside the view: normal selection.
      if (isolated) { if (isoShownSet && isoShownSet.has(d.id) && isoFocal && d.id !== isoFocal.id) drillTo(d); return; }
      selectNode(d);
    });
    // Click on the background clears the selection. In the isolated view it does
    // not close (leave with Exit or Esc), so you can scroll and use the controls.
    svg.on("click", () => { if (isolated) return; clearSelection(); });
    // Esc leaves the isolated view.
    d3.select("body").on("keydown", (e) => { if (e.key === "Escape" && isolated) dismissIsolation(); });

    // Toolbar.
    elSearch.on("input", function () {
      const q = this.value.trim().toLowerCase();
      if (!q) { recolor(); return; }                 // empty: restore colors
      // Match by name or by id (e.g. "EX_but" finds the reaction id "R_EX_but(e)").
      node.attr("fill", (d) =>
        ((d.name || "").toLowerCase().includes(q) || (d.id || "").toLowerCase().includes(q)) ? MATCH_COL : GREY);
    });
    elSub.on("change", function () { ui.sub = this.checked; recolor(); renderLegend(); });
    elComp.on("change", function () { ui.comp = this.checked; recolor(); renderLegend(); });
    elCurr.on("change", function () { ui.currency = this.checked; applyCurrency(); applyLabels(); });
    elLabels.on("change", function () { labelsOn = this.checked; applyLabels(); });
    elSel.on("change", function () {
      ui.soloSub = this.value;
      if (this.value) { ui.sub = true; elSub.property("checked", true); }   // isolating implies coloring by subsystem
      recolor(); renderLegend();
    });
    elReset.on("click", reset);

    // Layout panel: the sliders write to `layout` and update the shown number, but
    // the real recompute happens only on the "recompute" click, so dragging a
    // slider does not restart the simulation every pixel.
    d3.select("#lp-charge").on("input", function () {
      layout.charge = +this.value; d3.select("#lp-charge-v").text(this.value);
    });
    d3.select("#lp-link").on("input", function () {
      layout.linkBase = +this.value; d3.select("#lp-link-v").text(this.value);
    });
    d3.select("#lp-collide").on("input", function () {
      layout.collidePad = +this.value; d3.select("#lp-collide-v").text(this.value);
    });
    d3.select("#lp-separate").on("change", function () { layout.separate = this.checked; });
    d3.select("#lp-recompute").on("click", recompute);

    // Open and close the panel: the .collapsed class hides the body via CSS.
    d3.select("#lp-toggle").on("click", function () {
      const panel = d3.select("#layout-panel");
      const collapsed = panel.classed("collapsed");
      panel.classed("collapsed", !collapsed);
      d3.select(this).text(collapsed ? "▾" : "▸");   // triangle: down when open, right when closed
    });
  }


  // Focus: highlight the node and its neighbours, dim the rest. For edges we use
  // element opacity (not stroke-opacity) so the arrow tip dims too.
  function focusOnNode(d) {
    const f = neighbors.get(d.id);
    node.attr("opacity", (n) => f.has(n.id) ? 1 : NODE_DIM);
    link.attr("opacity", (l) => (f.has(idOf(l.source)) && f.has(idOf(l.target))) ? 1 : LINK_DIM);
  }
  // unfocus: everything back to full opacity.
  function unfocus() {
    node.attr("opacity", 1);
    link.attr("opacity", 1);
  }

  // Selection.
  function selectNode(d) {
    ui.selected = d.id;
    node.attr("stroke", (n) => n.id === d.id ? "#111" : "#fff")
        .attr("stroke-width", (n) => n.id === d.id ? 2.5 : 1);
    focusOnNode(d);  // highlight the connected nodes and dim the rest, arrows included
    applyLabels();   // the selected node always shows its label
    renderInfo(d);
  }
  function clearSelection() {
    ui.selected = null;
    node.attr("stroke", "#fff").attr("stroke-width", 1);
    unfocus();
    applyLabels();
    info.html('<span class="muted">Click a node to see its details</span>');
  }


  // Isolated view (dedicated ego network).
  //
  // The focal goes to the center, neighbours into two columns (inputs left = inNbr,
  // outputs right = outNbr) and the rest of the network fades to zero. All
  // neighbours are shown (no cap); if there are many the column runs off screen and
  // you scroll (drag pans, wheel zooms, "Fit" button). A dedicated bar (#iso-panel)
  // offers search, its own filters and the "shown / total" counts. Leave with Exit or Esc.
  let isolated     = false;  // are we in the isolated view?
  let isoSnapshot  = null;   // Map id to {x,y} saved before isolating (for the return)
  let isoFocal     = null;   // focal node of the isolation
  let isoShownSet  = null;   // Set of ids that pass the filters; other members go to opacity 0
  let isoRadiusMap = null;   // Map id to radius in the isolated view
  let isoState     = null;   // section state: focal, neighbour lists, reduced selections, filters
  let isoLabelTimer = null;  // timer: reveal labels only at the end of the transition
  let isoPath = [];          // visited focals (for the breadcrumb and the jumps back)
  let isoPathExpanded = false; // long breadcrumb: false = collapsed center with the dots
  let isoTouched = null;     // ids that ever became members in this session (to clean up on exit)

  // References to the dedicated bar (#iso-panel) elements, taken once.
  const isoEl = {
    panel:    d3.select("#iso-panel"),
    focal:    d3.select("#iso-focal-name"),
    headIn:   d3.select("#iso-head-in"),
    headOut:  d3.select("#iso-head-out"),
    countIn:  d3.select("#iso-count-in"),
    countOut: d3.select("#iso-count-out"),
    search:   d3.select("#iso-search"),
    group:    d3.select("#iso-group"),
    rev:      d3.select("#iso-rev"),
    revWrap:  d3.select("#iso-rev-wrap"),
    sort:     d3.select("#iso-sort"),
    fit:      d3.select("#iso-fit"),
    exit:     d3.select("#iso-exit"),
  };

  // isoActiveEdge: an edge is active if both ends are among the shown nodes. The
  // graph is bipartite, so an active edge links the focal to a shown neighbour.
  const isoActiveEdge = (l) => isoShownSet && isoShownSet.has(idOf(l.source)) && isoShownSet.has(idOf(l.target));

  // isoStraightPath: straight segment, shortened by (targetR+4) at the end so the
  // arrow stays outside the node. Explicit coordinates for the tween.
  function isoStraightPath(sx, sy, tx, ty, targetR) {
    const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1, gap = targetR + 4;
    return `M${sx},${sy} L${tx - (dx / len) * gap},${ty - (dy / len) * gap}`;
  }

  // isoSymbol: node path with an explicit radius. In the isolated view neighbours
  // are uniform and the focal is larger; the shape still depends on type.
  function isoSymbol(n, radius) {
    return d3.symbol()
      .type(n.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle)
      .size(Math.PI * radius * radius)();
  }

  // isoClampNbr: neighbour radius in the isolated view, clamped to [nbrRMin, nbrRMax].
  const isoClampNbr = (n) => Math.max(ISO.nbrRMin, Math.min(ISO.nbrRMax, rOf(n)));

  // gapR: radius used to stop the arrow at the node border. In the isolated view it
  // reads the dedicated sizes (isoRadiusMap); outside it falls back to the degree radius.
  const gapR = (ref) => (isoRadiusMap && isoRadiusMap.get(idOf(ref))) || rOf(ref);

  // buildIsoStateFor: compute the neighbours and member set of focal d, and (re)build
  // isoState with the selections reduced to the members only. Used by both isolateNode
  // and goToFocal so the focal logic lives in one place.
  function buildIsoStateFor(d) {
    // Neighbour type (bipartite graph): a reaction focal has metabolite neighbours, and vice versa.
    const nbrType = d.kind === "reaction" ? "metabolite" : "reaction";
    // Neighbours by direction, filtered by currency like the graph.
    const keepVisible = (ids) => ids.filter((id) => {
      const nn = byId.get(id);
      return nn && (ui.currency || !nn.currency);
    });
    const inAll  = keepVisible(inNbr.get(d.id));
    const outAll = keepVisible(outNbr.get(d.id));
    const allSet = new Set([d.id, ...inAll, ...outAll]);
    isoFocal = d;
    isoState = {
      focal: d, nbrType, inAll, outAll, allSet,
      nodeMembers:  node.filter((n) => allSet.has(n.id)),
      linkInc:      link.filter((l) => idOf(l.source) === d.id || idOf(l.target) === d.id),
      labelMembers: labelSel.filter((n) => allSet.has(n.id)),
      search: "", group: "", revOnly: false, sortAlpha: true,
    };
    return { nbrType, inAll, outAll, allSet };
  }

  function isolateNode(d) {
    if (isolated) return;
    isolated = true;
    sim.stop();
    isoSnapshot = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    isoPath = [d];                 // the breadcrumb starts from the first focal
    isoPathExpanded = false;

    const { nbrType, inAll, outAll, allSet } = buildIsoStateFor(d);
    isoTouched = new Set(allSet);  // everything that becomes a member is cleaned up on exit

    // Non members vanish at once with display:none. No transition over thousands of
    // elements: animating ~3800 nodes plus ~8800 edges was the cause of the freeze.
    node.filter((n) => !allSet.has(n.id)).attr("pointer-events", "none").style("display", "none");
    link.filter((l) => idOf(l.source) !== d.id && idOf(l.target) !== d.id).style("display", "none");
    labelSel.filter((n) => !allSet.has(n.id)).style("display", "none");

    // During isolation node drag is off: dragging pans the view, useful for long columns.
    node.on(".drag", null);

    // Normal panels hidden, dedicated bar shown.
    d3.select("#toolbar").style("display", "none");
    d3.select("#legend").style("display", "none");
    d3.select("#layout-panel").style("display", "none");
    info.style("display", "none");
    openIsoPanel(d, nbrType, inAll, outAll);

    // Camera to identity (world == screen): a single group transform.
    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);
    svg.transition(T).call(zoom.transform, d3.zoomIdentity);
    relayoutIso(ISO_DUR);
  }

  // goToFocal: change focal without leaving the view (drill down and breadcrumb jumps).
  // It does not re-snapshot or re-show the whole graph: it hides the neighbours that
  // leave, reveals the ones that enter, and repositions the columns with the transition.
  function goToFocal(d) {
    const oldAllSet  = isoState ? isoState.allSet  : new Set();
    const oldLinkInc = isoState ? isoState.linkInc : link.filter(() => false);  // edges of the previous step
    const { nbrType, inAll, outAll, allSet } = buildIsoStateFor(d);
    allSet.forEach((id) => isoTouched.add(id));

    // Neighbours that leave (were there, now gone): hidden at once, labels included.
    node.filter((n) => oldAllSet.has(n.id) && !allSet.has(n.id))
      .interrupt().style("display", "none").attr("pointer-events", "none");
    labelSel.filter((n) => oldAllSet.has(n.id) && !allSet.has(n.id))
      .interrupt().style("display", "none");

    // Edges of the previous step that no longer touch the new focal are hidden, else
    // their arrows would stay on screen. Edges incident to the new focal are revealed
    // (some were hidden); relayoutIso then animates them on path and opacity.
    oldLinkInc.filter((l) => idOf(l.source) !== d.id && idOf(l.target) !== d.id)
      .interrupt().style("display", "none").attr("opacity", 0);
    isoState.linkInc.style("display", null);

    // Neighbours that enter (were hidden): start from the current focal position and
    // fan out (revealed at opacity 0; relayoutIso brings them to 1 and into the columns).
    const fx = d.x, fy = d.y;
    allSet.forEach((id) => { if (!oldAllSet.has(id)) { const nn = byId.get(id); nn.x = fx; nn.y = fy; } });
    isoState.nodeMembers.filter((n) => !oldAllSet.has(n.id))
      .style("display", null).attr("opacity", 0).attr("transform", `translate(${fx},${fy})`);

    openIsoPanel(d, nbrType, inAll, outAll);   // reset filters, rebuild dropdown and breadcrumb

    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);
    svg.transition(T).call(zoom.transform, d3.zoomIdentity);
    relayoutIso(ISO_DUR);
  }

  // drillTo: click a shown neighbour to descend to it (adds a step to the path).
  function drillTo(d) {
    if (!isolated || !isoFocal || d.id === isoFocal.id) return;
    isoPath.push(d);
    isoPathExpanded = false;
    goToFocal(d);
  }

  // jumpTo: click a breadcrumb step to go back to that focal and drop the later steps
  // (forward history discarded, like the browser back button).
  function jumpTo(i) {
    if (!isolated || i < 0 || i >= isoPath.length - 1) return;
    const target = isoPath[i];
    isoPath.length = i + 1;
    isoPathExpanded = false;
    goToFocal(target);
  }

  // openIsoPanel: prepare the dedicated bar (#iso-panel): focal name, semantic
  // headers, type aware filter dropdown, toggles, and wire the control events.
  function openIsoPanel(d, nbrType, inAll, outAll) {
    isoEl.panel.style("display", "flex");
    renderBreadcrumb();   // the focal name is the last crumb of the path
    // Semantic column headers (matching the info panel).
    isoEl.headIn.text(d.kind === "reaction" ? "SUBSTRATES" : "PRODUCED BY");
    isoEl.headOut.text(d.kind === "reaction" ? "PRODUCTS" : "CONSUMED BY");
    // "reversible only" makes sense only with reaction neighbours.
    isoEl.revWrap.style("display", nbrType === "reaction" ? null : "none");
    // Dropdown: subsystem (reaction neighbours) or compartment (metabolite
    // neighbours), with only the values present among this focal's neighbours.
    const field = nbrType === "reaction" ? "subsystem" : "compartment";
    const vals = [...new Set([...inAll, ...outAll]
      .map((id) => byId.get(id)?.[field]).filter((v) => v != null && v !== ""))]
      .sort((a, b) => a.localeCompare(b));
    isoEl.group.selectAll("option").remove();
    isoEl.group.append("option").attr("value", "").text(`(${field}: all)`);
    vals.forEach((v) => isoEl.group.append("option").attr("value", v).text(v));
    // Controls to defaults.
    isoEl.search.property("value", "");
    isoEl.rev.property("checked", false);
    isoEl.sort.property("checked", true);
    // Events (each .on replaces the previous one: no buildup between isolations).
    isoEl.search.on("input", function () { isoState.search = this.value.trim().toLowerCase(); relayoutIso(420); });
    isoEl.group.on("change", function () { isoState.group = this.value; relayoutIso(420); });
    isoEl.rev.on("change", function () { isoState.revOnly = this.checked; relayoutIso(420); });
    isoEl.sort.on("change", function () { isoState.sortAlpha = this.checked; relayoutIso(420); });
    isoEl.fit.on("click", () => fitIsoColumns(true));
    isoEl.exit.on("click", dismissIsolation);
  }

  // renderBreadcrumb: draw the path of focals in #iso-focal-name. Each previous step
  // is clickable (jumpTo); the last is the current focal. A long path collapses its
  // center with dots (click to expand).
  function renderBreadcrumb() {
    const el = isoEl.focal;
    el.selectAll("*").remove();
    const last = isoPath.length - 1;
    // Indices of the steps to draw: if long and not expanded, first, dots, last three.
    let idxs = isoPath.map((_, i) => i);
    if (isoPath.length > 5 && !isoPathExpanded) idxs = [0, -1, last - 2, last - 1, last];
    idxs.forEach((i, k) => {
      if (k > 0) el.append("span").attr("class", "bc-sep").text("›");   // separator
      if (i === -1) {   // placeholder dots that expand the center of the path
        el.append("span").attr("class", "bc-more").attr("title", "Show the full path").text("…")
          .on("click", (ev) => { ev.stopPropagation(); isoPathExpanded = true; renderBreadcrumb(); });
        return;
      }
      const n = isoPath[i], isLast = i === last;
      const c = el.append("span")
        .attr("class", "bc-crumb" + (isLast ? " bc-current" : ""))
        .attr("title", `${n.name || n.id} (${n.kind === "reaction" ? "reaction" : "metabolite"})`)
        .text(n.name || n.id);
      if (!isLast) c.on("click", (ev) => { ev.stopPropagation(); jumpTo(i); });
    });
  }

  // isoFilteredSorted: apply the current filters (search, dropdown, reversible) and
  // the chosen order (A to Z, or by descending degree) to a list of ids.
  function isoFilteredSorted(ids) {
    const s = isoState;
    const kept = ids.filter((id) => {
      const nn = byId.get(id); if (!nn) return false;
      if (s.search && !((nn.name || "").toLowerCase().includes(s.search) || String(id).toLowerCase().includes(s.search))) return false;
      if (s.group && (s.nbrType === "reaction" ? nn.subsystem : nn.compartment) !== s.group) return false;
      if (s.revOnly && s.nbrType === "reaction" && !nn.reversible) return false;
      return true;
    });
    kept.sort(s.sortAlpha
      ? (a, b) => ((byId.get(a)?.name) || a).localeCompare((byId.get(b)?.name) || b)
      : (a, b) => {
          const da = (byId.get(a)?.degree) || 0, db = (byId.get(b)?.degree) || 0;
          return db - da || ((byId.get(a)?.name) || a).localeCompare((byId.get(b)?.name) || b);
        });
    return kept;
  }

  // relayoutIso: (re)position the members by the current filters. Shows every
  // neighbour that passes (no cap); the animation lasts `dur` and the panel counts update.
  function relayoutIso(dur) {
    const d = isoState.focal;
    const inShown  = isoFilteredSorted(isoState.inAll);
    const outShown = isoFilteredSorted(isoState.outAll);

    // Geometry: focal at the center of the usable area; columns at +/- colGap.
    const midX = W / 2;
    const usableTop = ISO.panelTop, usableBot = H - ISO.botPad;
    const midY = (usableTop + usableBot) / 2;
    const colGap = Math.min(W * ISO.colFrac, ISO.colMax);

    // Shown set plus maps: side (label anchor), radius, destination.
    const focalR = Math.max(ISO.focalR, rOf(d));
    isoShownSet  = new Set([d.id]);
    isoRadiusMap = new Map([[d.id, focalR]]);
    const sideOf = new Map();
    const dest   = new Map([[d.id, { x: midX, y: midY }]]);
    const place = (ids, colX, side) => {
      const y0 = midY - Math.max(0, ids.length - 1) * ISO.rowH / 2;   // block centered on midY
      ids.forEach((id, i) => {
        dest.set(id, { x: colX, y: y0 + i * ISO.rowH });
        isoShownSet.add(id); sideOf.set(id, side);
        isoRadiusMap.set(id, isoClampNbr(byId.get(id)));
      });
    };
    place(inShown,  midX - colGap, "in");
    place(outShown, midX + colGap, "out");

    // Current positions (for the edge tween), then move the data onto the targets.
    const cur = new Map([...isoState.allSet].map((id) => [id, { x: byId.get(id).x, y: byId.get(id).y }]));
    isoState.allSet.forEach((id) => { const t = dest.get(id); if (t) { const nn = byId.get(id); nn.x = t.x; nn.y = t.y; } });

    // Sizes and borders (shown members only): focal with an orange ring, uniform neighbours.
    isoState.nodeMembers.filter((n) => isoShownSet.has(n.id)).attr("d", (n) => isoSymbol(n, isoRadiusMap.get(n.id)));
    isoState.nodeMembers.filter((n) => n.id === d.id).attr("stroke", MATCH_COL).attr("stroke-width", 3);
    isoState.nodeMembers.filter((n) => isoShownSet.has(n.id) && n.id !== d.id).attr("stroke", "#fff").attr("stroke-width", 1.2);
    isoState.nodeMembers.attr("pointer-events", (n) => isoShownSet.has(n.id) ? null : "none")
      .style("cursor", (n) => (isoShownSet.has(n.id) && n.id !== isoState.focal.id) ? "pointer" : "default");

    const T = d3.transition().duration(dur).ease(d3.easeCubicInOut);

    isoState.nodeMembers.transition(T)
      .attr("transform", (n) => `translate(${n.x},${n.y})`)
      .attr("opacity", (n) => isoShownSet.has(n.id) ? 1 : 0);

    // Labels are kept hidden during the move so they do not jump from the network
    // positions and then re-column (the flash we want to avoid). We place them at
    // their final spot (still hidden) and reveal them only once the move ends.
    isoState.labelMembers.interrupt().style("display", "none");
    const shownLabels = isoState.labelMembers.filter((n) => isoShownSet.has(n.id));
    const lx = (n) => n.id === d.id ? midX
      : (sideOf.get(n.id) === "in" ? (n.x - isoRadiusMap.get(n.id) - ISO.labelGap) : (n.x + isoRadiusMap.get(n.id) + ISO.labelGap));
    const ly = (n) => n.id === d.id ? (midY + focalR + 16) : n.y;
    shownLabels
      .style("text-anchor", (n) => n.id === d.id ? "middle" : (sideOf.get(n.id) === "in" ? "end" : "start"))
      .style("dominant-baseline", "middle")
      .style("font-size", (n) => (n.id === d.id ? 16 : 13) + "px")
      .attr("x", lx).attr("y", ly);   // final position while still hidden
    // Reveal only at the end of the transition (one timer; cancel the previous one
    // so labels of a layout already replaced by a new filter or exit do not appear).
    clearTimeout(isoLabelTimer);
    isoLabelTimer = setTimeout(() => {
      shownLabels.style("display", null).style("opacity", 0)
        .transition().duration(200).style("opacity", 1);
    }, dur);

    // Edges incident to the focal: active if the other end passes the filters.
    isoState.linkInc.transition(T)
      .attr("opacity", (l) => isoActiveEdge(l) ? 1 : 0)
      .attrTween("d", function (l) {
        if (!isoActiveEdge(l)) return null;
        const s0 = cur.get(idOf(l.source)), s1 = dest.get(idOf(l.source)) || s0;
        const t0 = cur.get(idOf(l.target)), t1 = dest.get(idOf(l.target)) || t0;
        return (k) => isoStraightPath(
          s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k,
          t0.x + (t1.x - t0.x) * k, t0.y + (t1.y - t0.y) * k, gapR(l.target));
      });

    // "shown / total" counts in the dedicated panel.
    isoEl.countIn.text(`${inShown.length} / ${isoState.inAll.length}`);
    isoEl.countOut.text(`${outShown.length} / ${isoState.outAll.length}`);
  }

  // fitIsoColumns: frame the currently shown nodes (focal plus filtered neighbours),
  // with wide side margins for the labels. Called by the "Fit to view" button.
  function fitIsoColumns(animate) {
    if (!isoShownSet) return;
    const vis = nodes.filter((n) => isoShownSet.has(n.id));
    if (!vis.length) return;
    const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const x0 = d3.min(xs) - 230, x1 = d3.max(xs) + 230;   // room for the side labels
    const y0 = d3.min(ys) - 40,  y1 = d3.max(ys) + 50;
    const gw = (x1 - x0) || 1, gh = (y1 - y0) || 1, pad = 24, top = ISO.panelTop;
    const k = Math.max(0.04, Math.min((W - 2 * pad) / gw, (H - top - 2 * pad) / gh, 1.6));
    const tx = (W - k * (x0 + x1)) / 2;
    const ty = top + (H - top - k * (y0 + y1)) / 2;
    const target = d3.zoomIdentity.translate(tx, ty).scale(k);
    if (animate) svg.transition().duration(450).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  function dismissIsolation() {
    if (!isolated) return;
    isolated = false;
    const focal = isoFocal;
    const snap = isoSnapshot;
    const linkInc = isoState ? isoState.linkInc : link.filter(() => false);
    const members = isoState ? isoState.allSet : new Set();
    // Member selections only: on exit we animate just these, not the ~3800 graph nodes.
    const nodeMembers  = isoState ? isoState.nodeMembers  : node.filter(() => false);
    const labelMembers = isoState ? isoState.labelMembers : labelSel.filter(() => false);
    // Current isolated positions of the members (for the return edge tween).
    const cur = new Map([...members].map((id) => [id, { x: byId.get(id).x, y: byId.get(id).y }]));

    // The data goes back to the saved positions (pre isolation state).
    nodes.forEach((n) => { const s = snap.get(n.id); n.x = s.x; n.y = s.y; });

    // Post drill cleanup: nodes/edges touched during isolation but not members of the
    // last focal were moved into columns and then hidden, so their attributes are
    // stale. Realign them now (no animation) to the saved position, so when
    // applyCurrency reveals them they are in the right place. The last focal's members
    // stay where they are and are animated below.
    if (isoTouched) {
      node.filter((n) => isoTouched.has(n.id) && !members.has(n.id))
        .attr("transform", (n) => `translate(${n.x},${n.y})`);
      labelSel.filter((n) => isoTouched.has(n.id) && !members.has(n.id))
        .attr("x", (n) => n.x).attr("y", (n) => n.y - rOf(n) - 6);
      link.filter((l) => (isoTouched.has(idOf(l.source)) || isoTouched.has(idOf(l.target)))
                         && idOf(l.source) !== focal.id && idOf(l.target) !== focal.id)
        .attr("d", linkPath);
    }

    // Labels: on exit we do not want labels traveling. Cancel the reveal timer, hide
    // them at once, drop the isolated style and put them back above the node (still hidden).
    clearTimeout(isoLabelTimer);
    labelMembers.interrupt().style("display", "none").style("opacity", 1)
      .style("text-anchor", null).style("dominant-baseline", null)
      .style("font-size", (n) => fontOf(n) + "px")
      .attr("x", (n) => n.x).attr("y", (n) => n.y - rOf(n) - 6);

    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);

    // Animate only the members back to the saved positions (not the ~3800 nodes: that
    // was the exit freeze). Non members stay display:none and reappear together at the end.
    nodeMembers.transition(T)
      .attr("transform", (n) => `translate(${n.x},${n.y})`)
      .attr("opacity", 1);

    // Only the focal edges re-animate on path (there are few): back to opaque and
    // redrawing the line toward the saved position.
    linkInc.transition(T).attr("opacity", 1).attrTween("d", function (l) {
      const s0 = cur.get(idOf(l.source)) || snap.get(idOf(l.source)), s1 = snap.get(idOf(l.source));
      const t0 = cur.get(idOf(l.target)) || snap.get(idOf(l.target)), t1 = snap.get(idOf(l.target));
      return (k) => isoStraightPath(
        s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k,
        t0.x + (t1.x - t0.x) * k, t0.y + (t1.y - t0.y) * k, gapR(l.target));
    });

    // Finalize once at the end of the animation (a per-node .on("end") would fire
    // thousands of times): restore sizes, drag and panels, reset the state and reselect.
    setTimeout(() => {
      node.attr("d", symbolGen).attr("pointer-events", null).style("cursor", null).call(drag);   // normal sizes, default cursor, drag re-enabled
      // Re-show the non members in one block, respecting hidden currency. They come
      // back already dimmed because selectNode(focal) right after dims the non neighbours.
      applyCurrency();
      d3.select("#toolbar").style("display", null);
      d3.select("#legend").style("display", null);
      d3.select("#layout-panel").style("display", null);
      info.style("display", null);
      isoEl.panel.style("display", "none");
      isoShownSet = null; isoRadiusMap = null; isoSnapshot = null; isoFocal = null; isoState = null;
      isoPath = []; isoPathExpanded = false; isoTouched = null;   // reset the breadcrumb path
      if (focal) selectNode(focal);                    // consistent dark border plus info panel
    }, ISO_DUR + 40);

    fitView(true);   // the camera frames the whole graph again
  }
  // connSection: a connections block = small heading (with count) plus a list of
  // names, capped at CONN_CAP entries (then "+N more"). ids = neighbour id list.
  const CONN_CAP = 18;
  function connSection(label, ids) {
    const n = ids ? ids.length : 0;
    if (!n) return `<div class="conn"><div class="conn-h">${label} (0)</div></div>`;
    const names = ids.map((id) => (byId.get(id) && byId.get(id).name) || id).sort((a, b) => a.localeCompare(b));
    const shown = names.slice(0, CONN_CAP).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const more = n > CONN_CAP ? `<li class="more">+${n - CONN_CAP} more</li>` : "";
    return `<div class="conn"><div class="conn-h">${label} (${n})</div><ul>${shown}${more}</ul></div>`;
  }

  // renderInfo: node details in the panel. Besides the attributes it lists the direct
  // connections using edge direction:
  //   metabolite: "produced by" (R to M reactions) and "consumed by" (M to R reactions)
  //   reaction:   "substrates" (M to R metabolites) and "products" (R to M metabolites)
  function renderInfo(d) {
    const rows = [["id", d.id], ["type", d.kind === "reaction" ? "reaction" : "metabolite"]];
    if (d.kind === "reaction") rows.push(["subsystem", d.subsystem ?? "-"], ["reversible", d.reversible ? "yes" : "no"]);
    else rows.push(["compartment", d.compartment ?? "-"], ["currency", d.currency ? "yes" : "no"]);
    rows.push(["degree", d.degree]);
    const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");

    const conn = d.kind === "metabolite"
      ? connSection("produced by", inNbr.get(d.id)) + connSection("consumed by", outNbr.get(d.id))
      : connSection("substrates", inNbr.get(d.id)) + connSection("products", outNbr.get(d.id));

    // Action button: isolate the node with its inputs and outputs.
    const action = `<button class="info-action" id="info-isolate"` +
      ` title="Show this node with its inputs and outputs, isolated from the rest of the network">` +
      `Isolate this node</button>`;

    info.html(`<div class="title">${escapeHtml(d.name || d.id)}</div>${action}<dl>${dl}</dl>${conn}`);
    // The HTML was just rewritten: rewire the button click.
    info.select("#info-isolate").on("click", (ev) => { ev.stopPropagation(); isolateNode(d); });
  }


  // Color (recolor) and currency (applyCurrency).
  function recolor() {
    node.attr("fill", (d) => {
      if (d.kind === "reaction" && ui.sub) {
        if (ui.soloSub) return d.subsystem === ui.soloSub ? COL_RXN : GREY;   // isolate a specific one
        return topSubs.includes(d.subsystem) ? subColor(d.subsystem) : GREY;   // top N plus Other
      }
      if (d.kind === "metabolite" && ui.comp) return compColor(d.compartment);
      return baseColor(d);
    });
  }
  // applyCurrency: hide or show currency metabolites and the edges that touch them.
  function isCurr(ref) { return (ref && typeof ref === "object") ? !!ref.currency : false; }
  function applyCurrency() {
    node.style("display", (d) => (!ui.currency && d.currency) ? "none" : null);
    link.style("display", (l) => (!ui.currency && (isCurr(l.source) || isCurr(l.target))) ? "none" : null);
  }


  // Legend (clickable swatches): top N plus Other for subsystem, or the compartments.
  function renderLegend() {
    legendEl.selectAll("*").remove();
    if (ui.sub) {
      legendEl.append("span").style("color", "#555").text("subsystem:");
      topSubs.forEach((s) => {
        const sw = legendEl.append("span").attr("class", "sw")
          .on("click", () => { ui.soloSub = (ui.soloSub === s ? "" : s); elSel.property("value", ui.soloSub); recolor(); renderLegend(); });
        sw.append("i").style("background", subColor(s));
        sw.append("span").text(s).style("font-weight", ui.soloSub === s ? "700" : "400");
      });
      const o = legendEl.append("span").attr("class", "sw");
      o.append("i").style("background", GREY); o.append("span").text("Other");
    } else if (ui.comp) {
      legendEl.append("span").style("color", "#555").text("compartment:");
      comps.forEach((c) => {
        const sw = legendEl.append("span").attr("class", "sw");
        sw.append("i").style("background", compColor(c)); sw.append("span").text(c);
      });
    }
  }


  // Reset: controls, colors, selection, currency and view back to the start.
  function reset() {
    elSearch.property("value", ""); elSel.property("value", "");
    elSub.property("checked", false); elComp.property("checked", false); elCurr.property("checked", false);
    elLabels.property("checked", true);
    ui.sub = ui.comp = ui.currency = false; ui.soloSub = "";
    labelsOn = true; hovered = null;
    nodes.forEach((d) => { d.pinned = false; });
    clearSelection(); applyCurrency(); recolor(); renderLegend(); applyLabels();
    unfocus();   // safety: nothing dimmed after the reset
    fitView(true);
  }


  // Auto fit: frame the visible nodes in the window, below the toolbar.
  function fitView(animate) {
    const vis = nodes.filter((d) => ui.currency || !d.currency);
    if (!vis.length) return;
    const xs = vis.map((d) => d.x), ys = vis.map((d) => d.y);
    const x0 = d3.min(xs), x1 = d3.max(xs), y0 = d3.min(ys), y1 = d3.max(ys);
    const gw = (x1 - x0) || 1, gh = (y1 - y0) || 1, pad = 50, topBar = 70;
    const k = Math.max(0.04, Math.min((W - 2 * pad) / gw, (H - topBar - 2 * pad) / gh, 2));
    const tx = (W - k * (x0 + x1)) / 2;
    const ty = topBar + (H - topBar - k * (y0 + y1)) / 2;
    const target = d3.zoomIdentity.translate(tx, ty).scale(k);
    if (animate) svg.transition().duration(500).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  // Legend starts empty until a color toggle is on.
  renderLegend();

}).catch((err) => {
  console.error("Failed to load data/graph.json. Did you run `python converter/convert.py`?", err);
});


// escapeHtml: make text safe before inserting it as HTML.
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
