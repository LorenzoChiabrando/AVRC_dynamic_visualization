import { idOf, escapeHtml } from "../util.js";
import { BOUNDARY_SUBS } from "../config.js";

// Community highlight: a subsystem's reactions plus the metabolites they use. Lights
// the members, dims the rest, draws a dashed frame and shows the composition. Reads
// the subsystem -> reactions map prepared by layout-organized (ctx.organized.subRxns).
export function createCommunity(ctx) {
  const { neighbors, byId, ui, profile } = ctx;
  const info = d3.select("#info");
  const subRxns = ctx.organized.subRxns;

  function communityMembers(s) {
    const rxns = subRxns.get(s) || [];
    const mets = new Set();
    rxns.forEach((r) => neighbors.get(r.id).forEach((id) => {
      const nb = byId.get(id);
      if (nb && nb.kind !== "reaction" && (ui.currency || !nb.currency)) mets.add(id);
    }));
    return { rxns, mets };
  }

  function selectCommunity(s) {
    if (!subRxns.has(s)) return;
    const { node, link } = ctx.sel;
    if (ctx.search) ctx.search.clearBox();        // search and community are exclusive
    ui.selected = null; ui.community = s;
    const { rxns, mets } = communityMembers(s);
    const member = new Set([...rxns.map((r) => r.id), ...mets]);
    node.attr("stroke", "#fff").attr("stroke-width", 1).attr("opacity", 1)
        .attr("fill-opacity", (n) => member.has(n.id) ? 1 : profile.NODE_DIM)
        .attr("stroke-opacity", (n) => member.has(n.id) ? 1 : profile.NODE_DIM);
    const inComm = (l) => member.has(idOf(l.source)) && member.has(idOf(l.target));
    link.attr("opacity", 1)
        .attr("stroke-opacity", (l) => inComm(l) ? profile.LINK_OP : profile.LINK_DIM)
        .attr("marker-end", (l) => inComm(l) ? "url(#arrow)" : null);
    drawCommRect(rxns, s, rxns.length, mets.size);
    renderCommInfo(s, rxns, mets);
    ctx.labels.applyLabels();
  }

  // Dashed rounded rectangle around the community reactions, with name and counts.
  function drawCommRect(rxns, label, nR, nM) {
    const commG = ctx.layers.commG;
    commG.selectAll("*").remove();
    if (!rxns.length) return;
    const xs = rxns.map((r) => r.x), ys = rxns.map((r) => r.y), pad = 55;
    const x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad, y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
    commG.append("rect").attr("x", x0).attr("y", y0).attr("width", x1 - x0).attr("height", y1 - y0)
      .attr("rx", 22).attr("fill", "rgba(110,241,199,0.10)")
      .attr("stroke", profile.MATCH_COL).attr("stroke-width", 2.5).attr("stroke-dasharray", "8 5");
    commG.append("text").attr("x", (x0 + x1) / 2).attr("y", y0 - 12).attr("text-anchor", "middle")
      .style("font", "800 16px system-ui").style("fill", "#0f766e")
      .style("paint-order", "stroke").style("stroke", "white").style("stroke-width", 5)
      .text(`${label}  ·  ${nR} reactions, ${nM} metabolites`);
  }

  function renderCommInfo(s, rxns, mets) {
    info.style("display", null).html(
      `<div class="title">${escapeHtml(s)}</div>` +
      `<div class="ctype">community · subsystem</div>` +
      `<div class="cstat"><span class="cstat-glyph cstat-rxn"></span>` +
        `<span class="cstat-num">${rxns.length}</span><span class="cstat-what">reactions</span></div>` +
      `<div class="cstat"><span class="cstat-glyph cstat-met"></span>` +
        `<span class="cstat-num">${mets.size}</span><span class="cstat-what">metabolites</span></div>`
    );
  }

  // For a metabolite, the (non-boundary) subsystem most used by its reactions; for a
  // reaction, its own subsystem. Null if there is none (boundary).
  function dominantSub(d) {
    if (d.kind === "reaction") return BOUNDARY_SUBS.has(d.subsystem) ? null : d.subsystem;
    const c = new Map();
    neighbors.get(d.id).forEach((id) => {
      const nb = byId.get(id);
      if (nb && nb.kind === "reaction" && !BOUNDARY_SUBS.has(nb.subsystem)) c.set(nb.subsystem, (c.get(nb.subsystem) || 0) + 1);
    });
    let best = null, bestN = 0;
    c.forEach((v, k) => { if (v > bestN) { bestN = v; best = k; } });
    return best;
  }

  return { communityMembers, selectCommunity, drawCommRect, renderCommInfo, dominantSub };
}
