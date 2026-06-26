import { NODE_SP, BOUNDARY_SUBS, SEP, LABEL_MIN } from "../config.js";
import { shorten } from "../util.js";

// Organized layout: reactions are pulled to their subsystem anchor, metabolites to
// the mean of their reactions' anchors (shared ones land between blocks), and
// extracellular metabolites are pushed to a boundary ring. Block anchors come from a
// mini layout of the subsystem meta-graph (subsystems linked by shared metabolites).
export function layoutOrganized(ctx) {
  const { nodes, links, neighbors, byId, ui, opt, scales, zoomG, W, H } = ctx;
  const { rOf } = scales;

  // Subsystem meta-graph: one node per subsystem, edges weighted by shared metabolites.
  const reactions = nodes.filter((n) => n.kind === "reaction");
  const coreSubs = [...new Set(reactions.map((r) => r.subsystem))].filter((s) => !BOUNDARY_SUBS.has(s));
  const subRxns = d3.group(reactions.filter((r) => !BOUNDARY_SUBS.has(r.subsystem)), (r) => r.subsystem);
  ctx.organized = { subRxns, coreSubs };

  const pairCount = new Map();
  nodes.forEach((m) => {
    if (m.kind === "reaction") return;
    const subs = new Set();
    neighbors.get(m.id).forEach((nbId) => {
      const nb = byId.get(nbId);
      if (nb && nb.kind === "reaction" && !BOUNDARY_SUBS.has(nb.subsystem)) subs.add(nb.subsystem);
    });
    const arr = [...subs];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const key = arr[i] < arr[j] ? arr[i] + SEP + arr[j] : arr[j] + SEP + arr[i];
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  });
  const metaNodes = coreSubs.map((s) => ({ id: s }));
  const metaLinks = [...pairCount].map(([key, c]) => { const p = key.split(SEP); return { source: p[0], target: p[1], w: c }; });

  // Block size ~ members (reactions plus a fraction of each shared metabolite).
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
  const blockR = (s) => NODE_SP * Math.sqrt((blockWeight.get(s) || 1) + 3);

  // Meta simulation: collision proportional to block size separates the blocks.
  const metaSim = d3.forceSimulation(metaNodes)
    .force("link", d3.forceLink(metaLinks).id((d) => d.id)
      .distance((l) => blockR(l.source.id) + blockR(l.target.id) + 70).strength((l) => Math.min(0.5, l.w / 40)))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("collide", d3.forceCollide().radius((d) => blockR(d.id) + 30).strength(1).iterations(4))
    .force("center", d3.forceCenter(0, 0))
    .stop();
  for (let i = 0; i < 420; i++) metaSim.tick();

  // Centered meta positions; opt.spacing scales them in layoutGeom().
  const mcx = (d3.min(metaNodes, (n) => n.x) + d3.max(metaNodes, (n) => n.x)) / 2;
  const mcy = (d3.min(metaNodes, (n) => n.y) + d3.max(metaNodes, (n) => n.y)) / 2;
  const metaPos = new Map(metaNodes.map((n) => [n.id, { x: n.x - mcx, y: n.y - mcy }]));

  const cx = W / 2, cy = H / 2;
  let Rout = Math.min(W, H) * 0.46;          // boundary radius (updated by layoutGeom)
  const subAnchor = new Map();               // subsystem -> {x,y}
  const metTarget = new Map();               // metabolite id -> {x,y}
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

  function nodeTarget(d) {
    if (d.kind === "reaction") return BOUNDARY_SUBS.has(d.subsystem) ? null : (subAnchor.get(d.subsystem) || null);
    return metTarget.get(d.id) || null;
  }
  const isExt = (d) => d.kind !== "reaction" && d.compartment === "e";
  function anchorStrength(d) { const t = nodeTarget(d); if (!t) return 0; return d.kind === "reaction" ? opt.cluster : opt.cluster * 0.75; }
  const radialStrength = (d) => isExt(d) ? opt.boundary : 0;

  const glabelG = zoomG.append("g").style("pointer-events", "none");
  ctx.layers.glabelG = glabelG;

  // Main simulation (created stopped; ticked headless by core/settle.js).
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => 40 + rOf(l.source) + rOf(l.target)).strength(0.08))
    .force("charge", d3.forceManyBody().strength(opt.charge).distanceMax(300))
    .force("collide", d3.forceCollide().radius((d) => rOf(d) + opt.collidePad))
    .force("ax", d3.forceX((d) => { const t = nodeTarget(d); return t ? t.x : d.x; }).strength(anchorStrength))
    .force("ay", d3.forceY((d) => { const t = nodeTarget(d); return t ? t.y : d.y; }).strength(anchorStrength))
    .force("radial", d3.forceRadial(Rout, cx, cy).strength(radialStrength))
    .stop();
  ctx.sim = sim;

  function applyForces() {
    sim.force("charge").strength(opt.charge);
    sim.force("collide").radius((d) => rOf(d) + opt.collidePad);
    sim.force("ax").strength(anchorStrength);
    sim.force("ay").strength(anchorStrength);
    sim.force("radial").radius(Rout).strength(radialStrength);   // Rout changes with the spacing
  }
  // Seed near the target (or on the border for extracellular) so the warm-up starts organized.
  function seedPositions() {
    nodes.forEach((d) => {
      const t = nodeTarget(d);
      if (t) { d.x = t.x + (Math.random() - 0.5) * 60; d.y = t.y + (Math.random() - 0.5) * 60; }
      else if (isExt(d)) { const a = Math.random() * 2 * Math.PI; d.x = cx + Math.cos(a) * Rout; d.y = cy + Math.sin(a) * Rout; }
      else { d.x = cx + (Math.random() - 0.5) * 160; d.y = cy + (Math.random() - 0.5) * 160; }
    });
  }
  seedPositions();

  // Block labels: subsystem name at the centroid of its reactions; clickable.
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
      .style("pointer-events", "auto").style("cursor", "pointer")
      .text((d) => d.label)
      .on("click", (ev, d) => { ev.stopPropagation(); ctx.community.selectCommunity(d.sub); });
  }

  // Recompute after a slider change: drop highlights, re-derive geometry, re-seed, re-settle.
  function recompute() {
    ctx.select.clearHighlight();
    layoutGeom(); seedPositions(); applyForces(); sim.alpha(1);
    ctx.settle.animateSettle(() => {
      ctx.render.positionAll(); ctx.labels.applyLabels(); renderGroupLabels();
      ctx.zoomCtl.fitView(false); ctx.overlay.hide();
    });
  }

  function run(done) { ctx.settle.animateSettle(done); }

  return { seedPositions, recompute, renderGroupLabels, run };
}
