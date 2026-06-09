// organized.js: organized layout of the E. coli metabolic network (D3 v7).
//
// Idea: organize by subsystem, keeping reactions and metabolites together.
//   each subsystem is a block: its reactions are pulled toward a common anchor;
//   metabolites follow the reactions that use them (pulled toward the mean of
//   their reactions' anchors), so private ones sit inside a block and shared ones
//   land between blocks, near all of them;
//   extracellular metabolites are pushed out to a boundary ring, and the exchange
//   reactions (degree 1 stubs) follow them onto the border;
//   the block anchors come from a mini layout of the subsystem meta graph (two
//   subsystems are linked by how many metabolites they share), so related
//   subsystems end up adjacent and the bridge metabolites stay short.
//
// Separate page: it does not touch index.html/viewer.js. The simulation runs
// headless behind a veil and then stops. D3 is the global "d3" loaded by the page.


// Constants.
const COL_MET = "#2f474a";     // dark teal (MINEBUGS): cytosol metabolites
const COL_EXT = "#2f474a";     // same teal: extracellular (the boundary is only structural)
const COL_RXN = "#6a306c";     // purple (MINEBUGS): reactions
const GREY    = "#c4c8cc";
const LINK_COL = "#aab1b8", LINK_W = 1.0, LINK_OP = 0.4;
const LINK_DIM = 0.04, NODE_DIM = 0.12;
const SEARCH_LABEL_DELAY = 400;   // ms before match labels appear (debounce)
const R_MIN = 4, R_MAX = 28;
const TOP_LABELS = 24;         // label the most connected nodes
const LABEL_MIN = 8;           // a block gets its subsystem label if it has at least this many reactions
const ARROW_COL = "#7a828b";
const MATCH_COL = "#6ef1c7";   // mint (MINEBUGS): highlight accent (community frame and focal ring)
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

// Boundary subsystems: their reactions are not anchored to a block, they follow
// their single metabolite, which is pushed to the border. Exchanges are end stubs.
const BOUNDARY_SUBS = new Set(["Exchange/demand reaction"]);
// Separator for "subsystem pair" keys: a control character that never appears in
// names, so we can join and split two names without ambiguity.
const SEP = "";

// Layout panel defaults (clustering forces).
// Defaults retuned for the reaction-reaction projection (denser than the bipartite and without
// metabolites between blocks): more repulsion and more space between blocks.
const DEF = { cluster: 0.6, charge: -110, collidePad: 14, boundary: 0.30, spacing: 1.8, settleTicks: 350 };

const COMP_NAME = { c: "cytosol", e: "extracellular", p: "periplasm" };
const compLabel = (c) => COMP_NAME[c] || c || "?";
const shorten = (s) => (s && s.length > 26) ? s.slice(0, 24) + "…" : (s || "?");


// Page elements, zoom and overlay.
const svg = d3.select("#graph");
const info = d3.select("#info");
const legendEl = d3.select("#legend");
// The legend is a fixed strip BELOW the toolbar, but the toolbar height VARIES (wrapping rows, the
// VIEW row, the search bar): measure its real height and place the legend just under it, otherwise
// it gets covered by the toolbar. Recomputed on window resize too.
function placeLegend() {
  const tb = document.getElementById("toolbar");
  if (tb) legendEl.style("top", (tb.getBoundingClientRect().height + 6) + "px");
}
window.addEventListener("resize", placeLegend);
const W = window.innerWidth, H = window.innerHeight;
const idOf = (ref) => (ref && ref.id != null ? ref.id : ref);

const zoomG = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.03, 8]).on("zoom", (e) => zoomG.attr("transform", e.transform));
svg.call(zoom).on("dblclick.zoom", null);

svg.append("defs").append("marker")
  .attr("id", "arrow").attr("viewBox", "0 0 10 10")
  .attr("refX", 9).attr("refY", 5).attr("markerWidth", 5).attr("markerHeight", 5)
  .attr("orient", "auto-start-reverse")
  .append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", ARROW_COL);

const overlay = svg.append("g");
overlay.append("rect").attr("width", W).attr("height", H).attr("fill", "#fff").attr("opacity", 0.55);
const overlayText = overlay.append("text")
  .attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
  .style("font-size", "15px").style("fill", "#444").style("font-weight", "600")
  .text("Warming up the layout…");
function showOverlay() { document.body.classList.add("loading"); overlay.raise().style("display", null).style("opacity", 1); }
function hideOverlay() { document.body.classList.remove("loading"); overlay.transition().duration(250).style("opacity", 0).on("end", () => overlay.style("display", "none")); }


// Projection source.
// We load the reaction projection of the model SELECTED in the bipartite (shared sessionStorage
// key "organized.model"): read data/models.json and take the model's "reactions" field. If the
// #model-select dropdown is present (inside index.html, projection mode) we fill it and a model
// change reloads staying in projection. Standalone (reactions.html, no dropdown) falls back to
// data/reactions.json (E. coli).
const SS_MODEL = "organized.model";
const SS_VIEW  = "organized.view";
const selEl = document.getElementById("model-select");

function addModelOption(file, label) {
  const o = document.createElement("option");
  o.value = file; o.textContent = label || file;
  selEl.appendChild(o);
}
if (selEl) {
  // In projection, changing model reloads but KEEPS the projection view (flag untouched).
  selEl.addEventListener("change", () => { sessionStorage.setItem(SS_MODEL, selEl.value); location.reload(); });
}

function resolveProjectionDataset() {
  return d3.json("data/models.json").then((manifest) => {
    const models = (manifest && Array.isArray(manifest.models)) ? manifest.models : [];
    if (!models.length) throw new Error("empty manifest");
    if (selEl) models.forEach((m) => addModelOption(m.file, m.label));
    const valid = new Set(models.map((m) => m.file));
    const saved = sessionStorage.getItem(SS_MODEL);
    const file = (saved && valid.has(saved)) ? saved
               : (manifest.default && valid.has(manifest.default)) ? manifest.default
               : models[0].file;
    if (selEl) selEl.value = file;
    const entry = models.find((m) => m.file === file) || models[0];
    return entry.reactions || "reactions.json";   // this model's projection file
  }).catch(() => "reactions.json");                // models.json missing: fall back to E. coli
}

// Toggle button (only inside index.html): back to the BIPARTITE. And hide the bipartite toolbar's
// "currency" toggle (no metabolites to show/hide here).
if (document.getElementById("view-toggle")) {
  d3.select("#view-toggle").text("◂ Back to bipartite")
    .on("click", () => { sessionStorage.setItem(SS_VIEW, "bipartite"); location.reload(); });
}
(function () { const c = document.getElementById("o-curr"); const lab = c && c.closest("label"); if (lab) lab.style.display = "none"; })();

// Resolve the projection file, load it and build the layout.
resolveProjectionDataset().then((rfile) => d3.json("data/" + rfile)).then((raw) => {

  // Scales and shapes.
  const rScale = d3.scaleSqrt().domain(d3.extent(raw.nodes, (d) => d.degree)).range([R_MIN, R_MAX]);
  const rOf = (d) => rScale(d.degree || 0);
  const fScale = d3.scaleSqrt().domain(d3.extent(raw.nodes, (d) => d.degree)).range([12, 20]);
  const fontOf = (d) => fScale(d.degree || 0);
  const symbolGen = d3.symbol()
    .type((d) => d.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle)
    .size((d) => Math.PI * rOf(d) * rOf(d));

  // Neutral color (no color by subsystem, as requested): by type and boundary.
  const colorOf = (d) => d.kind === "reaction" ? COL_RXN : (d.compartment === "e" ? COL_EXT : COL_MET);

  // Nodes, edges, maps.
  const nodes = raw.nodes;
  // Keep the weight (number of bridging metabolites): used for the edge thickness.
  const links = raw.links.map((l) => ({ source: idOf(l.source), target: idOf(l.target), weight: l.weight || 1 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
  links.forEach((l) => { neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source); });
  // Direct neighbours by direction (for the panel lists): outNbr[id] = nodes id
  // points to, inNbr[id] = nodes that point to id. source/target are still strings.
  const outNbr = new Map(nodes.map((n) => [n.id, []]));
  const inNbr  = new Map(nodes.map((n) => [n.id, []]));
  links.forEach((l) => { outNbr.get(l.source).push(l.target); inNbr.get(l.target).push(l.source); });
  const topLabelled = new Set([...nodes].filter((n) => !n.currency).sort((a, b) => b.degree - a.degree).slice(0, TOP_LABELS).map((d) => d.id));

  const ui  = { currency: true, labels: true, groupLabels: true, selected: null, community: null, search: "", searchLabels: false, searchMatch: false, labelId: false };
  // Label text: node name or id, per the ui.labelId flag (shared by homepage and isolated view;
  // labels are the same elements, so rewriting the text here updates both views).
  const labelText = (d) => ui.labelId ? (d.id || d.name) : (d.name || d.id);
  function applyLabelText() { labelSel.text(labelText); }
  const opt = { ...DEF };

  // Geometry: blocks sit around (cx,cy); the extracellular boundary is an outer
  // ring whose radius (Rout) is recomputed in layoutGeom() from the spacing.
  const cx = W / 2, cy = H / 2;
  let Rout = Math.min(W, H) * 0.46;   // boundary radius (updated by layoutGeom)

  // Subsystem meta layout (block anchors).
  // Meta graph: one node per subsystem (boundary excluded), an edge weighted by the
  // number of shared metabolites. A small simulation lays it out: subsystems that
  // share many metabolites attract and end up adjacent.
  const reactions = nodes.filter((n) => n.kind === "reaction");
  const coreSubs = [...new Set(reactions.map((r) => r.subsystem))].filter((s) => !BOUNDARY_SUBS.has(s));
  // Reactions per subsystem: used to highlight a community and show its makeup.
  const subRxns = d3.group(reactions.filter((r) => !BOUNDARY_SUBS.has(r.subsystem)), (r) => r.subsystem);

  // Subsystem affinity from the reaction-reaction graph (no metabolites to count here):
  // for each edge between reactions of DIFFERENT (non boundary) subsystems, +1 to that pair.
  const pairCount = new Map();   // "AB" -> shared metabolite count
  links.forEach((l) => {
    const a = byId.get(idOf(l.source)), b = byId.get(idOf(l.target));
    if (!a || !b) return;
    const sa = a.subsystem, sb = b.subsystem;
    if (BOUNDARY_SUBS.has(sa) || BOUNDARY_SUBS.has(sb) || sa === sb) return;
    const key = sa < sb ? sa + SEP + sb : sb + SEP + sa;
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  });
  const metaNodes = coreSubs.map((s) => ({ id: s }));
  const metaLinks = [...pairCount].map(([key, c]) => { const p = key.split(SEP); return { source: p[0], target: p[1], w: c }; });

  // Block size = estimated members: reactions plus metabolites (split in fraction
  // among the subsystems that use them). Gives bigger blocks more room so they do
  // not overlap the small ones.
  const blockWeight = new Map(coreSubs.map((s) => [s, 0]));
  reactions.forEach((r) => { if (!BOUNDARY_SUBS.has(r.subsystem)) blockWeight.set(r.subsystem, blockWeight.get(r.subsystem) + 1); });
  nodes.forEach((m) => {
    if (m.kind === "reaction") return;
    const subs = new Set();
    neighbors.get(m.id).forEach((nbId) => { const nb = byId.get(nbId); if (nb && nb.kind === "reaction" && !BOUNDARY_SUBS.has(nb.subsystem)) subs.add(nb.subsystem); });
    if (!subs.size) return;
    const frac = 1 / subs.size;
    subs.forEach((s) => blockWeight.set(s, blockWeight.get(s) + frac));
  });
  // Block "territory" radius ~ sqrt(members): a disc that holds it, with margin.
  // Higher NODE_SP = more air inside the block and wider territories.
  const NODE_SP = 26;   // wider block territories (no metabolites to separate them)
  const blockR = (s) => NODE_SP * Math.sqrt((blockWeight.get(s) || 1) + 3);

  // Meta simulation: collision proportional to block size (the key to separation),
  // a link that pulls related subsystems together, light repulsion. Runs synchronously.
  const metaSim = d3.forceSimulation(metaNodes)
    .force("link", d3.forceLink(metaLinks).id((d) => d.id)
      .distance((l) => blockR(l.source.id) + blockR(l.target.id) + 120).strength((l) => Math.min(0.45, l.w / 60)))
    .force("charge", d3.forceManyBody().strength(-220))
    .force("collide", d3.forceCollide().radius((d) => blockR(d.id) + 50).strength(1).iterations(4))
    .force("center", d3.forceCenter(0, 0))
    .stop();
  for (let i = 0; i < 420; i++) metaSim.tick();

  // Relative (centered) meta graph positions; the spacing scales them in layoutGeom().
  const mcx = (d3.min(metaNodes, (n) => n.x) + d3.max(metaNodes, (n) => n.x)) / 2;
  const mcy = (d3.min(metaNodes, (n) => n.y) + d3.max(metaNodes, (n) => n.y)) / 2;
  const metaPos = new Map(metaNodes.map((n) => [n.id, { x: n.x - mcx, y: n.y - mcy }]));

  // Derived geometry (anchors, targets, boundary).
  // layoutGeom: from metaPos and opt.spacing it derives the block anchors, the
  // metabolite targets (mean of their reactions' anchors, so shared ones land in the
  // middle) and the boundary radius just outside the blocks. Called on each recompute.
  const subAnchor = new Map();   // subsystem -> {x,y}
  const metTarget = new Map();   // metabolite id -> {x,y}
  function layoutGeom() {
    metaPos.forEach((p, s) => subAnchor.set(s, { x: cx + p.x * opt.spacing, y: cy + p.y * opt.spacing }));
    let maxR = 0;
    subAnchor.forEach((a, s) => { maxR = Math.max(maxR, Math.hypot(a.x - cx, a.y - cy) + blockR(s)); });
    Rout = maxR + 140;
    metTarget.clear();
    nodes.forEach((m) => {
      if (m.kind === "reaction") return;
      let sx = 0, sy = 0, n = 0;
      neighbors.get(m.id).forEach((nbId) => {
        const nb = byId.get(nbId);
        if (nb && nb.kind === "reaction" && !BOUNDARY_SUBS.has(nb.subsystem)) { const a = subAnchor.get(nb.subsystem); if (a) { sx += a.x; sy += a.y; n++; } }
      });
      if (n > 0) metTarget.set(m.id, { x: sx / n, y: sy / n });
    });
  }
  layoutGeom();
  // Target of a node (or null if it has none: boundary reactions, boundary only metabolites).
  function nodeTarget(d) {
    if (d.kind === "reaction") return BOUNDARY_SUBS.has(d.subsystem) ? null : (subAnchor.get(d.subsystem) || null);
    return metTarget.get(d.id) || null;
  }
  const isExt = (d) => d.kind !== "reaction" && d.compartment === "e";
  // Anchor strength per node: reactions a bit stiffer than metabolites (which need to
  // slide between blocks); zero when there is no target.
  function anchorStrength(d) { const t = nodeTarget(d); if (!t) return 0; return d.kind === "reaction" ? opt.cluster : opt.cluster * 0.75; }
  const radialStrength = (d) => isExt(d) ? opt.boundary : 0;

  // Draw.
  const link = zoomG.append("g")
    .attr("fill", "none").style("pointer-events", "none")
    .attr("stroke", LINK_COL).attr("stroke-opacity", LINK_OP).attr("stroke-width", LINK_W)
    .selectAll("path").data(links).join("path").attr("marker-end", "url(#arrow)")
    .attr("stroke-width", (l) => 0.6 + Math.min(l.weight || 1, 6) * 0.45);   // width ~ bridging metabolites

  // Community rectangle layer (between edges and nodes, so nodes stay on top).
  const commG = zoomG.append("g").style("pointer-events", "none");

  const node = zoomG.append("g")
    .selectAll("path").data(nodes).join("path")
    .attr("d", symbolGen).attr("fill", colorOf)
    .attr("stroke", "#fff").attr("stroke-width", 1).style("cursor", "pointer");
  node.append("title").text((d) => `${d.name} (${d.kind === "reaction" ? "reaction" : "metabolite"})`);

  const labelSel = zoomG.append("g")
    .selectAll("text").data(nodes, (d) => d.id).join("text")
    .attr("text-anchor", "middle").style("pointer-events", "none")
    .style("font-size", (d) => fontOf(d) + "px").style("font-weight", 700)
    .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 4).style("fill", "#222")
    .style("display", "none").text(labelText);

  const glabelG = zoomG.append("g").style("pointer-events", "none");   // subsystem block labels

  // Currency.
  const isCurr = (ref) => { const n = byId.get(idOf(ref)); return !!(n && n.currency); };
  function applyCurrency() {
    node.style("display", (d) => (!ui.currency && d.currency) ? "none" : null);
    link.style("display", (l) => (!ui.currency && (isCurr(l.source) || isCurr(l.target))) ? "none" : null);
  }

  // Straight edges with a small gap for the arrow.
  function edgePoint(l) {
    const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
    const len = Math.hypot(dx, dy) || 1, gap = rOf(l.target) + 4;
    return { x: l.target.x - (dx / len) * gap, y: l.target.y - (dy / len) * gap };
  }
  const linkPath = (l) => { const s = l.source, e = edgePoint(l); return `M${s.x},${s.y} L${e.x},${e.y}`; };
  function positionAll() {
    link.attr("d", linkPath);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    labelSel.attr("x", (d) => d.x).attr("y", (d) => d.y - rOf(d) - 6);
  }
  function drawSettling() {
    link.attr("d", linkPath);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  // Block labels: the subsystem name at the centroid of its reactions.
  function renderGroupLabels() {
    const acc = new Map();
    nodes.forEach((d) => {
      if (d.kind !== "reaction" || BOUNDARY_SUBS.has(d.subsystem)) return;
      const o = acc.get(d.subsystem) || { x: 0, y: 0, n: 0 };
      o.x += d.x; o.y += d.y; o.n++; acc.set(d.subsystem, o);
    });
    const data = [...acc].filter(([s, o]) => o.n >= LABEL_MIN).map(([s, o]) => ({ x: o.x / o.n, y: o.y / o.n, label: shorten(s), sub: s }));
    glabelG.selectAll("text").data(data).join("text")
      .attr("x", (d) => d.x).attr("y", (d) => d.y).attr("text-anchor", "middle")
      .style("font-size", "15px").style("font-weight", 800)
      .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 5).style("stroke-linejoin", "round")
      .style("fill", "#444")
      .style("display", ui.groupLabels ? null : "none")
      .style("pointer-events", "auto").style("cursor", "pointer")   // clickable: highlights the community
      .text((d) => d.label)
      .on("click", (ev, d) => { ev.stopPropagation(); selectCommunity(d.sub); });
  }

  // Node labels.
  let hovered = null;
  function applyLabels() {
    // In the isolated view labels are handled only by relayoutIso (columns, reveal at
    // the end of the transition). Using the normal rules here would hide the column
    // labels, so we do nothing while isolated.
    if (isolated) return;
    labelSel.style("display", (d) => {
      if (!ui.currency && d.currency) return "none";
      if (d.id === hovered) return null;
      // Search with matches: show only match labels (debounced via searchLabels). With no match
      // the network stays normal, so we skip this and the usual top-N labels apply.
      if (ui.search && ui.searchMatch) return (ui.searchLabels && searchHit(d)) ? null : "none";
      if (ui.selected) return d.id === ui.selected ? null : "none";
      return (ui.labels && topLabelled.has(d.id)) ? null : "none";
    });
  }

  // Main simulation.
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => 60 + rOf(l.source) + rOf(l.target)).strength(0.05))
    .force("charge", d3.forceManyBody().strength(opt.charge).distanceMax(500))
    .force("collide", d3.forceCollide().radius((d) => rOf(d) + opt.collidePad))
    .force("ax", d3.forceX((d) => { const t = nodeTarget(d); return t ? t.x : d.x; }).strength(anchorStrength))
    .force("ay", d3.forceY((d) => { const t = nodeTarget(d); return t ? t.y : d.y; }).strength(anchorStrength))
    .force("radial", d3.forceRadial(Rout, cx, cy).strength(radialStrength))
    .stop();
  function applyForces() {
    sim.force("charge").strength(opt.charge);
    sim.force("collide").radius((d) => rOf(d) + opt.collidePad);
    sim.force("ax").strength(anchorStrength);
    sim.force("ay").strength(anchorStrength);
    sim.force("radial").radius(Rout).strength(radialStrength);   // Rout changes with the spacing
  }
  // seedPositions: initial positions near the target (or on the border for
  // extracellular ones) so the warm up starts already organized. Called on recompute too.
  function seedPositions() {
    nodes.forEach((d) => {
      const t = nodeTarget(d);
      if (t) { d.x = t.x + (Math.random() - 0.5) * 60; d.y = t.y + (Math.random() - 0.5) * 60; }
      else if (isExt(d)) { const a = Math.random() * 2 * Math.PI; d.x = cx + Math.cos(a) * Rout; d.y = cy + Math.sin(a) * Rout; }
      else { d.x = cx + (Math.random() - 0.5) * 160; d.y = cy + (Math.random() - 0.5) * 160; }
    });
  }
  seedPositions();

  // Headless layout computation.
  // The ticks run without redrawing every frame: redrawing ~3900 nodes plus ~8800
  // edges for ~140 frames was the real cost. Here we only show the percentage under
  // the veil and draw once at the end. An initial draw hints at the seeded layout.
  const TICKS_PER_FRAME = 25;   // headless: many ticks per frame, no redraw in between
  function animateSettle(done) {
    const total = opt.settleTicks; let t = 0;
    showOverlay();
    positionAll(); fitView(false);
    (function frame() {
      const end = Math.min(t + TICKS_PER_FRAME, total);
      for (; t < end; t++) sim.tick();
      overlayText.text(`Computing the layout… ${Math.round((100 * t) / total)}%`);
      if (t < total) requestAnimationFrame(frame); else done();
    })();
  }

  // Camera.
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

  // Selection: a node (click) or a community (click on a label or button).
  function focusOnNode(d) {
    // Dim non-neighbours via fill/stroke-opacity (NOT element opacity, which makes a compositing
    // layer per node and lags pan/zoom). Non-incident links lose stroke opacity and arrowhead.
    const f = neighbors.get(d.id);
    const on = (n) => n.id === d.id || f.has(n.id);
    node.attr("fill-opacity", (n) => on(n) ? 1 : NODE_DIM)
        .attr("stroke-opacity", (n) => on(n) ? 1 : NODE_DIM);
    const inc = (l) => idOf(l.source) === d.id || idOf(l.target) === d.id;
    link.attr("stroke-opacity", (l) => inc(l) ? LINK_OP : LINK_DIM)
        .attr("marker-end", (l) => inc(l) ? "url(#arrow)" : null);
  }
  // clearHighlight: clear both the node selection and the community selection.
  function clearHighlight() {
    ui.selected = null; ui.community = null;
    // Reset fill/stroke-opacity and arrowheads too (null = inherit defaults).
    node.attr("stroke", "#fff").attr("stroke-width", 1).attr("opacity", 1)
        .attr("fill-opacity", null).attr("stroke-opacity", null);
    link.attr("opacity", 1).attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
    commG.selectAll("*").remove();
    applyLabels();
    info.html('<span class="muted">Click a node, or a community label, to highlight it</span>');
  }

  // searchHit: node matches the query (by name OR id, case-insensitive). Null-safe for link ends.
  function searchHit(n) {
    return !!n && (((n.name || "").toLowerCase().includes(ui.search)) ||
                   ((n.id   || "").toLowerCase().includes(ui.search)));
  }
  // applySearch: highlight matching nodes (orange) and dim the rest via fill/stroke-opacity (no
  // per-element compositing layer, so pan/zoom stays smooth); non-match links also drop the
  // arrowhead. Match labels are handled by applyLabels via ui.searchLabels (debounced).
  // Returns -1 if not searching, 0 if no match, else the number of visible matches.
  function applySearch(q) {
    ui.search = q;
    if (!q) {
      ui.searchLabels = false; ui.searchMatch = false;
      resetSearchPaint();
      hideNoMatch();
      clearHighlight();
      return -1;
    }
    ui.selected = null; ui.community = null; commG.selectAll("*").remove();
    node.attr("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1);
    link.attr("opacity", 1);
    const m = nodes.filter((d) => searchHit(d) && (ui.currency || !d.currency)).length;
    if (m === 0) {
      // No match: keep the network normal (do not dim everything); the handler shows the tooltip.
      ui.searchMatch = false;
      resetSearchPaint();
      applyLabels();
      info.html(`<div class="title">Search</div><div class="ctype">no matching nodes</div>`);
      return 0;
    }
    ui.searchMatch = true;
    node.attr("fill", (n) => searchHit(n) ? MATCH_COL : colorOf(n))
        .attr("fill-opacity", (n) => searchHit(n) ? 1 : NODE_DIM)
        .attr("stroke-opacity", (n) => searchHit(n) ? 1 : NODE_DIM);
    const linkHit = (l) => searchHit(byId.get(idOf(l.source))) && searchHit(byId.get(idOf(l.target)));
    link.attr("stroke-opacity", (l) => linkHit(l) ? LINK_OP : LINK_DIM)
        .attr("marker-end", (l) => linkHit(l) ? "url(#arrow)" : null);
    applyLabels();
    info.html(`<div class="title">Search</div><div class="ctype">${m} matching ${m === 1 ? "node" : "nodes"}</div>`);
    return m;
  }
  // resetSearchPaint: restore the neutral look (type colours, full opacity, arrowheads back).
  function resetSearchPaint() {
    node.attr("fill", colorOf).attr("fill-opacity", null).attr("stroke-opacity", null);
    link.attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
  }
  // No-match tooltip under the search bar; positioned from the input's bounding rect on show.
  const searchTip = d3.select("#o-search-tip");
  function showNoMatch() {
    const el = document.getElementById("o-search");
    if (!el) return;
    const r = el.getBoundingClientRect();
    searchTip.style("left", Math.round(r.left) + "px")
             .style("top", Math.round(r.bottom + 6) + "px")
             .style("display", "block");
  }
  function hideNoMatch() { searchTip.style("display", "none"); }
  // clearSearchBox: empty the bar and drop the search highlight. No-op when not searching.
  function clearSearchBox() {
    if (!ui.search) return;
    ui.search = ""; ui.searchLabels = false; ui.searchMatch = false;
    d3.select("#o-search").property("value", "");
    resetSearchPaint();
    hideNoMatch();
  }
  function selectNode(d) {
    clearSearchBox();                                     // search and selection are exclusive
    ui.community = null; commG.selectAll("*").remove();   // leave community mode
    ui.selected = d.id;
    node.attr("stroke", (n) => n.id === d.id ? "#111" : "#fff").attr("stroke-width", (n) => n.id === d.id ? 2.5 : 1)
        .attr("opacity", 1);
    focusOnNode(d); applyLabels(); renderInfo(d);
  }
  // communityMembers: a subsystem's reactions plus the metabolites they use.
  function communityMembers(s) {
    const rxns = subRxns.get(s) || [];
    const mets = new Set();
    rxns.forEach((r) => neighbors.get(r.id).forEach((id) => { const nb = byId.get(id); if (nb && nb.kind !== "reaction" && (ui.currency || !nb.currency)) mets.add(id); }));
    return { rxns, mets };
  }
  function selectCommunity(s) {
    if (!subRxns.has(s)) return;
    clearSearchBox();                          // search and community are exclusive
    ui.selected = null; ui.community = s;
    const { rxns, mets } = communityMembers(s);
    const member = new Set([...rxns.map((r) => r.id), ...mets]);
    // Dim via fill/stroke-opacity (no element opacity): see focusOnNode/applySearch.
    node.attr("stroke", "#fff").attr("stroke-width", 1).attr("opacity", 1)
        .attr("fill-opacity", (n) => member.has(n.id) ? 1 : NODE_DIM)
        .attr("stroke-opacity", (n) => member.has(n.id) ? 1 : NODE_DIM);
    const inComm = (l) => member.has(idOf(l.source)) && member.has(idOf(l.target));
    link.attr("opacity", 1)
        .attr("stroke-opacity", (l) => inComm(l) ? LINK_OP : LINK_DIM)
        .attr("marker-end", (l) => inComm(l) ? "url(#arrow)" : null);
    drawCommRect(rxns, s, rxns.length, mets.size);
    renderCommInfo(s, rxns, mets);
    applyLabels();
  }
  // drawCommRect: a dashed rounded rectangle around the community reactions, with the
  // name and counts above. It lives in the commG layer (world), so pan and zoom follow it.
  function drawCommRect(rxns, label, nR, nM) {
    commG.selectAll("*").remove();
    if (!rxns.length) return;
    const xs = rxns.map((r) => r.x), ys = rxns.map((r) => r.y), pad = 55;
    const x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad, y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
    commG.append("rect").attr("x", x0).attr("y", y0).attr("width", x1 - x0).attr("height", y1 - y0)
      .attr("rx", 22).attr("fill", "rgba(110,241,199,0.10)")
      .attr("stroke", MATCH_COL).attr("stroke-width", 2.5).attr("stroke-dasharray", "8 5");
    commG.append("text").attr("x", (x0 + x1) / 2).attr("y", y0 - 12).attr("text-anchor", "middle")
      .style("font", "800 16px system-ui").style("fill", "#0f766e")
      .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 5)
      .text(`${label}  ·  ${nR} reactions`);
  }
  function renderCommInfo(s, rxns, mets) {
    // Compact format: title plus two "node glyph and number" rows (no name lists).
    info.html(
      `<div class="title">${esc(s)}</div>` +
      `<div class="ctype">community · subsystem</div>` +
      `<div class="cstat"><span class="cstat-glyph cstat-rxn"></span>` +
        `<span class="cstat-num">${rxns.length}</span><span class="cstat-what">reactions</span></div>`
    );
  }
  // dominantSub: for a metabolite, the (non boundary) subsystem most used by its
  // reactions; for a reaction, its own subsystem. Null if there is none (boundary).
  function dominantSub(d) {
    if (d.kind === "reaction") return BOUNDARY_SUBS.has(d.subsystem) ? null : d.subsystem;
    const c = new Map();
    neighbors.get(d.id).forEach((id) => { const nb = byId.get(id); if (nb && nb.kind === "reaction" && !BOUNDARY_SUBS.has(nb.subsystem)) c.set(nb.subsystem, (c.get(nb.subsystem) || 0) + 1); });
    let best = null, bestN = 0;
    c.forEach((v, k) => { if (v > bestN) { bestN = v; best = k; } });
    return best;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // connSection: a connections block = heading (with count) plus a name list, capped at CONN_CAP.
  const CONN_CAP = 18;
  function connSection(label, ids) {
    const n = ids ? ids.length : 0;
    if (!n) return `<div class="conn"><div class="conn-h">${label} (0)</div></div>`;
    const names = ids.map((id) => (byId.get(id) && byId.get(id).name) || id).sort((a, b) => a.localeCompare(b));
    const shown = names.slice(0, CONN_CAP).map((s) => `<li>${esc(s)}</li>`).join("");
    const more = n > CONN_CAP ? `<li class="more">+${n - CONN_CAP} more</li>` : "";
    return `<div class="conn"><div class="conn-h">${label} (${n})</div><ul>${shown}${more}</ul></div>`;
  }
  function renderInfo(d) {
    const grp = d.kind === "reaction"
      ? `<dt>subsystem</dt><dd>${esc(d.subsystem ?? "-")}</dd>`
      : `<dt>compartment</dt><dd>${esc(compLabel(d.compartment))}</dd>`;
    // Compact connections: just the count per direction (no name lists, shorter panel).
    // Directed projection: upstream = reactions feeding it (in-edges), downstream = those it feeds (out-edges).
    const inN = (inNbr.get(d.id) || []).length, outN = (outNbr.get(d.id) || []).length;
    const connRows = `<dt>upstream (feeds it)</dt><dd>${inN}</dd><dt>downstream (it feeds)</dt><dd>${outN}</dd>`;
    // Actions: focus the node in place (no page jump) and highlight its community.
    const ds = dominantSub(d);
    const focusBtn = `<button class="info-action" id="info-open" title="Open this node's detailed isolated view (focal with inputs/outputs and drill-down) in a dedicated window">Open detailed view</button>`;
    const commBtn = ds ? `<button class="info-action" id="info-comm" title="Highlight this node's community (${esc(ds)})">Highlight community</button>` : "";
    info.html(
      `<div class="title">${esc(d.name || d.id)}</div>${focusBtn}${commBtn}` +
      `<dl><dt>id</dt><dd>${esc(d.id)}</dd>` +
      `<dt>type</dt><dd>${d.kind === "reaction" ? "reaction" : "metabolite"}</dd>` +
      grp + `<dt>degree</dt><dd>${d.degree}</dd>${connRows}</dl>`
    );
    // Open the in place isolated view (same as the base viewer): focal plus input and
    // output columns, animated node moves, drill down and breadcrumb. Exit or Esc return.
    info.select("#info-open").on("click", (ev) => { ev.stopPropagation(); isolateNode(d); });
    if (ds) info.select("#info-comm").on("click", (ev) => { ev.stopPropagation(); selectCommunity(ds); });
  }

  // Legend (neutral): node type plus the extracellular boundary.
  function renderLegend() {
    legendEl.selectAll("*").remove();
    const item = (color, text, square) => {
      const sw = legendEl.append("span").attr("class", "sw");
      sw.append("i").style("background", color).style("border-radius", square ? "2px" : "50%");
      sw.append("span").text(text);
    };
    // Single node type (reaction); each edge = a shared non-currency metabolite (producer to consumer).
    item(COL_RXN, "reaction", true);
    placeLegend();   // below the toolbar (variable height), so it isn't covered
  }

  // Light drag.
  function moveOne(d) {
    node.filter((n) => n === d).attr("transform", `translate(${d.x},${d.y})`);
    link.filter((l) => l.source === d || l.target === d).attr("d", linkPath);
    labelSel.filter((n) => n === d).attr("x", d.x).attr("y", d.y - rOf(d) - 6);
  }
  const drag = d3.drag()
    .container(() => zoomG.node())
    .on("start", (e, d) => { d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.x = e.x; d.y = e.y; d.fx = e.x; d.fy = e.y; moveOne(d); })
    .on("end", (e, d) => { d.fx = null; d.fy = null; });

  // Recompute.
  function recompute() {
    clearHighlight();   // the layout changes: drop highlights and the rectangle
    layoutGeom(); seedPositions(); applyForces(); sim.alpha(1);
    animateSettle(() => { positionAll(); applyLabels(); renderGroupLabels(); fitView(false); hideOverlay(); });
  }

  // Interactions.
  function wire() {
    // In the isolated view hover must not touch labels: the columns are handled by
    // relayoutIso. Without this guard, moving the mouse (or nodes sliding under the
    // cursor during reflow) would trigger applyLabels and hide the column labels.
    node.on("mouseenter", (e, d) => { if (isolated) return; hovered = d.id; applyLabels(); });
    node.on("mouseleave", () => { if (isolated) return; hovered = null; applyLabels(); });
    node.on("click", (e, d) => {
      e.stopPropagation();
      // Isolated view: click a shown neighbour to drill down. Outside: select.
      if (isolated) { if (isoShownSet && isoShownSet.has(d.id) && isoFocal && d.id !== isoFocal.id) drillTo(d); return; }
      selectNode(d);
    });
    svg.on("click", () => { if (isolated) return; clearHighlight(); });
    // Esc leaves the isolated view (like the base viewer).
    d3.select("body").on("keydown", (e) => { if (e.key === "Escape" && isolated) dismissIsolation(); });

    d3.select("#o-curr").on("change", function () { ui.currency = this.checked; applyCurrency(); applyLabels(); renderGroupLabels(); });
    // Search bar: highlight matches live; match labels and the no-match tooltip are debounced.
    let searchTimer = null;
    d3.select("#o-search").on("input", function () {
      const q = this.value.trim().toLowerCase();
      ui.searchLabels = false;
      hideNoMatch();
      const m = applySearch(q);
      clearTimeout(searchTimer);
      if (q) searchTimer = setTimeout(() => {
        ui.searchLabels = true; applyLabels();
        if (m === 0) showNoMatch();
      }, SEARCH_LABEL_DELAY);
    });
    d3.select("#o-lbl").on("change", function () { ui.labels = this.checked; applyLabels(); });
    d3.select("#o-glbl").on("change", function () { ui.groupLabels = this.checked; glabelG.style("display", ui.groupLabels ? null : "none"); });
    // Name/id label flag (homepage + isolated view); keeps the isolated twin in sync.
    d3.select("#o-lblid").on("change", function () {
      ui.labelId = this.checked;
      d3.select("#iso-lblid").property("checked", this.checked);
      applyLabelText();
    });
    d3.select("#o-fit").on("click", () => fitView(true));
    d3.select("#reset").on("click", reset);
    // (#view-toggle here goes BACK to the bipartite; wired at module top, see above.)

    const slider = (id, key, fmt) => d3.select(id).on("input", function () { opt[key] = +this.value; d3.select(id + "-v").text(fmt(this.value)); });
    slider("#op-cluster", "cluster", (v) => (+v).toFixed(2));
    slider("#op-charge", "charge", (v) => v);
    slider("#op-collide", "collidePad", (v) => v);
    slider("#op-boundary", "boundary", (v) => (+v).toFixed(2));
    slider("#op-spacing", "spacing", (v) => (+v).toFixed(2));
    d3.select("#op-recompute").on("click", recompute);

    // "Layout" button: opens and closes the slider popover.
    d3.select("#lay-btn").on("click", function () {
      const panel = d3.select("#layout-panel"), open = !panel.classed("lay-open");
      panel.classed("lay-open", open);
      d3.select(this).classed("open", open);
    });
    // Trigger of the custom filter dropdown (isolated view): open and close the menu.
    isoEl.groupTrigger.on("click", () => { isoEl.group.classed("open", !isoEl.group.classed("open")); });
    // Click outside: close the layout popover and the filter dropdown.
    d3.select(document).on("click.popovers", (ev) => {
      const t = ev.target;
      if (t.closest && !t.closest("#lay-btn") && !t.closest("#layout-panel")) {
        d3.select("#layout-panel").classed("lay-open", false);
        d3.select("#lay-btn").classed("open", false);
      }
      if (t.closest && !t.closest("#iso-group")) isoEl.group.classed("open", false);
    });
  }

  // Reset.
  function reset() {
    ui.currency = true; ui.labels = true; ui.groupLabels = true; ui.labelId = false;
    d3.select("#o-curr").property("checked", true);
    d3.select("#o-lbl").property("checked", true);
    d3.select("#o-glbl").property("checked", true);
    d3.select("#o-lblid").property("checked", false); applyLabelText();
    Object.assign(opt, DEF);
    d3.select("#op-cluster").property("value", DEF.cluster);   d3.select("#op-cluster-v").text(DEF.cluster.toFixed(2));
    d3.select("#op-charge").property("value", DEF.charge);     d3.select("#op-charge-v").text(DEF.charge);
    d3.select("#op-collide").property("value", DEF.collidePad); d3.select("#op-collide-v").text(DEF.collidePad);
    d3.select("#op-boundary").property("value", DEF.boundary); d3.select("#op-boundary-v").text(DEF.boundary.toFixed(2));
    d3.select("#op-spacing").property("value", DEF.spacing);   d3.select("#op-spacing-v").text(DEF.spacing.toFixed(2));
    glabelG.style("display", null);
    clearSearchBox();
    clearHighlight(); applyCurrency();
    recompute();
  }


  // Isolated view (ported from viewer.js, adapted).
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
    group:        d3.select("#iso-group"),
    groupTrigger: d3.select("#iso-group-trigger"),
    groupLabel:   d3.select("#iso-group .msel-label"),
    groupChev:    d3.select("#iso-group .msel-chev"),
    groupMenu:    d3.select("#iso-group-menu"),
    rev:      d3.select("#iso-rev"),
    revWrap:  d3.select("#iso-rev-wrap"),
    sort:     d3.select("#iso-sort"),
    lblId:    d3.select("#iso-lblid"),
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
    // Directed projection: neighbours are reactions. in = reactions feeding the focal (in-edges),
    // out = reactions fed by the focal (out-edges). Two columns, like the base viewer.
    const nbrType = "reaction";
    const inAll  = [...inNbr.get(d.id)];
    const outAll = [...outNbr.get(d.id)];
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
    // Clear any selection dimming (fill/stroke-opacity, dropped arrowheads): the isolated view
    // shows/hides via element opacity, so nodes must start at full fill opacity.
    node.attr("fill-opacity", null).attr("stroke-opacity", null);
    link.attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
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
    d3.select("#layout-panel").classed("lay-open", false);   // close the layout popover on entering
    info.style("display", "none");
    glabelG.style("display", "none");   // hide the subsystem labels (organized specific layer)
    commG.selectAll("*").remove();      // drop any community rectangle
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
    // Directed projection: two columns. UPSTREAM = reactions feeding the focal (in-edges),
    // DOWNSTREAM = reactions fed by the focal (out-edges).
    isoEl.headIn.text("UPSTREAM");
    isoEl.headOut.text("DOWNSTREAM");
    d3.select(".iso-col-in").style("display", null);
    d3.select(".iso-col-out").style("display", null);
    // "reversible only" makes sense only with reaction neighbours.
    isoEl.revWrap.style("display", nbrType === "reaction" ? null : "none");
    // Dropdown: subsystem (reaction neighbours) or compartment (metabolite
    // neighbours), with only the values present among this focal's neighbours.
    const field = nbrType === "reaction" ? "subsystem" : "compartment";
    const vals = [...new Set([...inAll, ...outAll]
      .map((id) => byId.get(id)?.[field]).filter((v) => v != null && v !== ""))]
      .sort((a, b) => a.localeCompare(b));
    buildGroupMenu(field, vals);   // custom dropdown (instead of the native <select>)
    // Controls to defaults.
    isoEl.search.property("value", "");
    isoEl.rev.property("checked", false);
    isoEl.sort.property("checked", true);
    isoEl.lblId.property("checked", ui.labelId);   // reflect the shared name/id flag
    // Events (each .on replaces the previous one: no buildup between isolations).
    isoEl.search.on("input", function () { isoState.search = this.value.trim().toLowerCase(); relayoutIso(420); });
    // (the filter selection is handled by the custom dropdown items, see buildGroupMenu and selectGroup)
    isoEl.rev.on("change", function () { isoState.revOnly = this.checked; relayoutIso(420); });
    isoEl.sort.on("change", function () { isoState.sortAlpha = this.checked; relayoutIso(420); });
    isoEl.lblId.on("change", function () { ui.labelId = this.checked; d3.select("#o-lblid").property("checked", this.checked); applyLabelText(); });
    isoEl.fit.on("click", () => fitIsoColumns(true));
    isoEl.exit.on("click", dismissIsolation);
  }

  // Custom filter dropdown (MINEBUGS style, instead of the native <select>).
  // buildGroupMenu: rebuild the menu items from the type aware field and focal values.
  function buildGroupMenu(field, vals) {
    isoEl.groupLabel.text(`(${field}: all)`);      // trigger label = "all"
    isoEl.group.classed("open", false);            // the menu starts closed
    const menu = isoEl.groupMenu;
    menu.selectAll("*").remove();
    menu.append("div").attr("class", "msel-sec").text(field);   // section heading
    const addItem = (value, text) => menu.append("button")
      .attr("type", "button").attr("class", "msel-item").attr("data-value", value)
      .html(`<span>${esc(text)}</span><span class="tick">✓</span>`)
      .on("click", () => selectGroup(value, text));
    addItem("", `(${field}: all)`);                // the "all" item
    vals.forEach((v) => addItem(v, v));            // one item per present value
    markGroupSelected("");                         // "all" selected by default
  }
  // selectGroup: apply the menu choice, update trigger and tick, close and refilter.
  function selectGroup(value, text) {
    isoState.group = value;
    isoEl.groupLabel.text(text);
    markGroupSelected(value);
    isoEl.group.classed("open", false);
    relayoutIso(420);
  }
  // markGroupSelected: tick the active item (compared on data-value).
  function markGroupSelected(value) {
    isoEl.groupMenu.selectAll(".msel-item")
      .classed("sel", function () { return (this.getAttribute("data-value") || "") === value; });
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
      d3.select("#layout-panel").classed("lay-open", false);   // stays closed on leaving isolation
      info.style("display", null);
      isoEl.panel.style("display", "none");
      glabelG.style("display", ui.groupLabels ? null : "none");   // restore the subsystem labels
      isoShownSet = null; isoRadiusMap = null; isoSnapshot = null; isoFocal = null; isoState = null;
      isoPath = []; isoPathExpanded = false; isoTouched = null;   // reset the breadcrumb path
      if (focal) selectNode(focal);                    // consistent dark border plus info panel
    }, ISO_DUR + 40);

    fitView(true);   // the camera frames the whole graph again
  }

  // Startup.
  applyCurrency();
  renderLegend();
  animateSettle(() => {
    positionAll();
    applyLabels();
    renderGroupLabels();
    node.call(drag);
    wire();
    fitView(false);
    hideOverlay();
  });
});
