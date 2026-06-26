import { ISO, ISO_DUR } from "../config.js";
import { idOf, escapeHtml } from "../util.js";

// Isolated (ego) view: focal at the centre, neighbours in two columns (inputs left,
// outputs right), the rest faded out. A dedicated bar (#iso-panel) adds search and
// filters; drill into a neighbour, walk back with the breadcrumb, leave with Esc.
// State lives on ctx.iso.
export function createIsolated(ctx) {
  const { svg, zoom, nodes, byId, inNbr, outNbr, ui, profile, scales } = ctx;
  const { rOf, fontOf, symbolGen } = scales;
  const node = ctx.sel.node, link = ctx.sel.link, labelSel = ctx.sel.label;
  const commG = ctx.layers.commG;
  const glabelG = ctx.layers.glabelG;   // group-label layer from the organized layout
  const info = d3.select("#info");
  const iso = ctx.iso;                   // shared isolated-view state

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

  // An edge is active if both ends are shown (bipartite: focal to a shown neighbour).
  const isoActiveEdge = (l) => iso.shown && iso.shown.has(idOf(l.source)) && iso.shown.has(idOf(l.target));

  // Straight segment, shortened by (targetR+4) so the arrow stays outside the node.
  function isoStraightPath(sx, sy, tx, ty, targetR) {
    const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1, gap = targetR + 4;
    return `M${sx},${sy} L${tx - (dx / len) * gap},${ty - (dy / len) * gap}`;
  }
  // Node path with an explicit radius (uniform neighbours, larger focal).
  function isoSymbol(n, radius) {
    return d3.symbol().type(n.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle).size(Math.PI * radius * radius)();
  }
  // Neighbour radius clamped to [nbrRMin, nbrRMax].
  const isoClampNbr = (n) => Math.max(ISO.nbrRMin, Math.min(ISO.nbrRMax, rOf(n)));
  // Radius used to stop the arrow at the node border (dedicated sizes while isolated).
  const gapR = (ref) => (iso.radius && iso.radius.get(idOf(ref))) || rOf(ref);

  // Compute the neighbours and member set of focal d, and (re)build iso.state with the
  // selections reduced to the members only. Shared by isolateNode and goToFocal.
  function buildIsoStateFor(d) {
    const nbrType = d.kind === "reaction" ? "metabolite" : "reaction";
    const keepVisible = (ids) => ids.filter((id) => { const nn = byId.get(id); return nn && (ui.currency || !nn.currency); });
    const inAll  = keepVisible(inNbr.get(d.id));
    const outAll = keepVisible(outNbr.get(d.id));
    const allSet = new Set([d.id, ...inAll, ...outAll]);
    iso.focal = d;
    iso.state = {
      focal: d, nbrType, inAll, outAll, allSet,
      nodeMembers:  node.filter((n) => allSet.has(n.id)),
      linkInc:      link.filter((l) => idOf(l.source) === d.id || idOf(l.target) === d.id),
      labelMembers: labelSel.filter((n) => allSet.has(n.id)),
      search: "", group: "", revOnly: false, sortAlpha: true,
    };
    return { nbrType, inAll, outAll, allSet };
  }

  function isolateNode(d) {
    if (iso.active) return;
    iso.active = true;
    ctx.sim.stop();
    node.attr("fill-opacity", null).attr("stroke-opacity", null);
    link.attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
    iso.snapshot = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    iso.path = [d];
    iso.pathExpanded = false;

    const { nbrType, inAll, outAll, allSet } = buildIsoStateFor(d);
    iso.touched = new Set(allSet);

    // Non members vanish at once (no transition over thousands of elements).
    node.filter((n) => !allSet.has(n.id)).attr("pointer-events", "none").style("display", "none");
    link.filter((l) => idOf(l.source) !== d.id && idOf(l.target) !== d.id).style("display", "none");
    labelSel.filter((n) => !allSet.has(n.id)).style("display", "none");

    // Node drag is off while isolated: dragging pans (useful for long columns).
    node.on(".drag", null);

    d3.select("#toolbar").style("display", "none");
    d3.select("#legend").style("display", "none");
    d3.select("#layout-panel").classed("lay-open", false);
    d3.select("#tools-panel").classed("tools-open", false);
    d3.select("#tools-btn").classed("open", false);
    info.style("display", "none");
    if (glabelG) glabelG.style("display", "none");
    commG.selectAll("*").remove();
    openIsoPanel(d, nbrType, inAll, outAll);

    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);
    svg.transition(T).call(zoom.transform, d3.zoomIdentity);
    relayoutIso(ISO_DUR);
  }

  // Change focal without leaving the view (drill down and breadcrumb jumps): hide the
  // neighbours that leave, reveal the ones that enter, reposition with the transition.
  function goToFocal(d) {
    const oldAllSet  = iso.state ? iso.state.allSet  : new Set();
    const oldLinkInc = iso.state ? iso.state.linkInc : link.filter(() => false);
    const { nbrType, inAll, outAll, allSet } = buildIsoStateFor(d);
    allSet.forEach((id) => iso.touched.add(id));

    node.filter((n) => oldAllSet.has(n.id) && !allSet.has(n.id)).interrupt().style("display", "none").attr("pointer-events", "none");
    labelSel.filter((n) => oldAllSet.has(n.id) && !allSet.has(n.id)).interrupt().style("display", "none");

    oldLinkInc.filter((l) => idOf(l.source) !== d.id && idOf(l.target) !== d.id).interrupt().style("display", "none").attr("opacity", 0);
    iso.state.linkInc.style("display", null);

    const fx = d.x, fy = d.y;
    allSet.forEach((id) => { if (!oldAllSet.has(id)) { const nn = byId.get(id); nn.x = fx; nn.y = fy; } });
    iso.state.nodeMembers.filter((n) => !oldAllSet.has(n.id)).style("display", null).attr("opacity", 0).attr("transform", `translate(${fx},${fy})`);

    openIsoPanel(d, nbrType, inAll, outAll);

    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);
    svg.transition(T).call(zoom.transform, d3.zoomIdentity);
    relayoutIso(ISO_DUR);
  }

  // Click a shown neighbour to descend to it (adds a breadcrumb step).
  function drillTo(d) {
    if (!iso.active || !iso.focal || d.id === iso.focal.id) return;
    iso.path.push(d);
    iso.pathExpanded = false;
    goToFocal(d);
  }
  // Click a breadcrumb step to go back to that focal, dropping the later steps.
  function jumpTo(i) {
    if (!iso.active || i < 0 || i >= iso.path.length - 1) return;
    const target = iso.path[i];
    iso.path.length = i + 1;
    iso.pathExpanded = false;
    goToFocal(target);
  }

  // Prepare the dedicated bar: focal name, semantic headers, type-aware dropdown,
  // toggles, and wire the control events (each .on replaces the previous one).
  function openIsoPanel(d, nbrType, inAll, outAll) {
    isoEl.panel.style("display", "flex");
    renderBreadcrumb();
    isoEl.headIn.text(d.kind === "reaction" ? "SUBSTRATES" : "PRODUCED BY");
    isoEl.headOut.text(d.kind === "reaction" ? "PRODUCTS" : "CONSUMED BY");
    isoEl.revWrap.style("display", nbrType === "reaction" ? null : "none");
    const field = nbrType === "reaction" ? "subsystem" : "compartment";
    const vals = [...new Set([...inAll, ...outAll].map((id) => byId.get(id)?.[field]).filter((v) => v != null && v !== ""))].sort((a, b) => a.localeCompare(b));
    buildGroupMenu(field, vals);
    isoEl.search.property("value", "");
    isoEl.rev.property("checked", false);
    isoEl.sort.property("checked", true);
    isoEl.lblId.property("checked", ui.labelId);
    isoEl.search.on("input", function () { iso.state.search = this.value.trim().toLowerCase(); relayoutIso(420); });
    isoEl.rev.on("change", function () { iso.state.revOnly = this.checked; relayoutIso(420); });
    isoEl.sort.on("change", function () { iso.state.sortAlpha = this.checked; relayoutIso(420); });
    isoEl.lblId.on("change", function () { ui.labelId = this.checked; d3.select("#o-lblid").property("checked", this.checked); ctx.labels.applyLabelText(); });
    isoEl.fit.on("click", () => fitIsoColumns(true));
    isoEl.exit.on("click", dismissIsolation);
  }

  // Custom filter dropdown (instead of the native select).
  function buildGroupMenu(field, vals) {
    isoEl.groupLabel.text(`(${field}: all)`);
    isoEl.group.classed("open", false);
    const menu = isoEl.groupMenu;
    menu.selectAll("*").remove();
    menu.append("div").attr("class", "msel-sec").text(field);
    const addItem = (value, text) => menu.append("button")
      .attr("type", "button").attr("class", "msel-item").attr("data-value", value)
      .html(`<span>${escapeHtml(text)}</span><span class="tick">✓</span>`)
      .on("click", () => selectGroup(value, text));
    addItem("", `(${field}: all)`);
    vals.forEach((v) => addItem(v, v));
    markGroupSelected("");
  }
  function selectGroup(value, text) {
    iso.state.group = value;
    isoEl.groupLabel.text(text);
    markGroupSelected(value);
    isoEl.group.classed("open", false);
    relayoutIso(420);
  }
  function markGroupSelected(value) {
    isoEl.groupMenu.selectAll(".msel-item").classed("sel", function () { return (this.getAttribute("data-value") || "") === value; });
  }

  // Breadcrumb of focals in #iso-focal-name. Previous steps are clickable (jumpTo); a
  // long path collapses its centre with dots (click to expand).
  function renderBreadcrumb() {
    const el = isoEl.focal;
    el.selectAll("*").remove();
    const last = iso.path.length - 1;
    let idxs = iso.path.map((_, i) => i);
    if (iso.path.length > 5 && !iso.pathExpanded) idxs = [0, -1, last - 2, last - 1, last];
    idxs.forEach((i, k) => {
      if (k > 0) el.append("span").attr("class", "bc-sep").text("›");
      if (i === -1) {
        el.append("span").attr("class", "bc-more").attr("title", "Show the full path").text("…")
          .on("click", (ev) => { ev.stopPropagation(); iso.pathExpanded = true; renderBreadcrumb(); });
        return;
      }
      const n = iso.path[i], isLast = i === last;
      const c = el.append("span")
        .attr("class", "bc-crumb" + (isLast ? " bc-current" : ""))
        .attr("title", `${n.name || n.id} (${n.kind === "reaction" ? "reaction" : "metabolite"})`)
        .text(n.name || n.id);
      if (!isLast) c.on("click", (ev) => { ev.stopPropagation(); jumpTo(i); });
    });
    const elNode = el.node();
    if (elNode) elNode.scrollLeft = elNode.scrollWidth;
  }

  // Apply the current filters (search, dropdown, reversible) and order (A-Z or degree).
  function isoFilteredSorted(ids) {
    const s = iso.state;
    const kept = ids.filter((id) => {
      const nn = byId.get(id); if (!nn) return false;
      if (s.search && !((nn.name || "").toLowerCase().includes(s.search) || String(id).toLowerCase().includes(s.search))) return false;
      if (s.group && (s.nbrType === "reaction" ? nn.subsystem : nn.compartment) !== s.group) return false;
      if (s.revOnly && s.nbrType === "reaction" && !nn.reversible) return false;
      return true;
    });
    kept.sort(s.sortAlpha
      ? (a, b) => ((byId.get(a)?.name) || a).localeCompare((byId.get(b)?.name) || b)
      : (a, b) => { const da = (byId.get(a)?.degree) || 0, db = (byId.get(b)?.degree) || 0; return db - da || ((byId.get(a)?.name) || a).localeCompare((byId.get(b)?.name) || b); });
    return kept;
  }

  // (Re)position the members by the current filters; animate over `dur`, update counts.
  function relayoutIso(dur) {
    const d = iso.state.focal;
    const inShown  = isoFilteredSorted(iso.state.inAll);
    const outShown = isoFilteredSorted(iso.state.outAll);

    const midX = ctx.W / 2;
    const usableTop = ISO.panelTop ?? profile.isoPanelTop, usableBot = ctx.H - ISO.botPad;
    const midY = (usableTop + usableBot) / 2;
    const colGap = Math.min(ctx.W * ISO.colFrac, ISO.colMax);

    const focalR = Math.max(ISO.focalR, rOf(d));
    iso.shown  = new Set([d.id]);
    iso.radius = new Map([[d.id, focalR]]);
    const sideOf = new Map();
    const dest   = new Map([[d.id, { x: midX, y: midY }]]);
    const place = (ids, colX, side) => {
      const y0 = midY - Math.max(0, ids.length - 1) * ISO.rowH / 2;
      ids.forEach((id, i) => {
        dest.set(id, { x: colX, y: y0 + i * ISO.rowH });
        iso.shown.add(id); sideOf.set(id, side);
        iso.radius.set(id, isoClampNbr(byId.get(id)));
      });
    };
    place(inShown,  midX - colGap, "in");
    place(outShown, midX + colGap, "out");

    const cur = new Map([...iso.state.allSet].map((id) => [id, { x: byId.get(id).x, y: byId.get(id).y }]));
    iso.state.allSet.forEach((id) => { const t = dest.get(id); if (t) { const nn = byId.get(id); nn.x = t.x; nn.y = t.y; } });

    iso.state.nodeMembers.filter((n) => iso.shown.has(n.id)).attr("d", (n) => isoSymbol(n, iso.radius.get(n.id)));
    iso.state.nodeMembers.filter((n) => n.id === d.id).attr("stroke", profile.MATCH_COL).attr("stroke-width", 3);
    iso.state.nodeMembers.filter((n) => iso.shown.has(n.id) && n.id !== d.id).attr("stroke", "#fff").attr("stroke-width", 1.2);
    iso.state.nodeMembers.attr("pointer-events", (n) => iso.shown.has(n.id) ? null : "none")
      .style("cursor", (n) => (iso.shown.has(n.id) && n.id !== iso.state.focal.id) ? "pointer" : "default");

    const T = d3.transition().duration(dur).ease(d3.easeCubicInOut);

    iso.state.nodeMembers.transition(T)
      .attr("transform", (n) => `translate(${n.x},${n.y})`)
      .attr("opacity", (n) => iso.shown.has(n.id) ? 1 : 0);

    iso.state.labelMembers.interrupt().style("display", "none");
    const shownLabels = iso.state.labelMembers.filter((n) => iso.shown.has(n.id));
    const lx = (n) => n.id === d.id ? midX
      : (sideOf.get(n.id) === "in" ? (n.x - iso.radius.get(n.id) - ISO.labelGap) : (n.x + iso.radius.get(n.id) + ISO.labelGap));
    const ly = (n) => n.id === d.id ? (midY + focalR + 16) : n.y;
    shownLabels
      .style("text-anchor", (n) => n.id === d.id ? "middle" : (sideOf.get(n.id) === "in" ? "end" : "start"))
      .style("dominant-baseline", "middle")
      .style("font-size", (n) => (n.id === d.id ? 16 : 13) + "px")
      .attr("x", lx).attr("y", ly);
    clearTimeout(iso.labelTimer);
    iso.labelTimer = setTimeout(() => {
      shownLabels.style("display", null).style("opacity", 0).transition().duration(200).style("opacity", 1);
    }, dur);

    iso.state.linkInc.transition(T)
      .attr("opacity", (l) => isoActiveEdge(l) ? 1 : 0)
      .attrTween("d", function (l) {
        if (!isoActiveEdge(l)) return null;
        const s0 = cur.get(idOf(l.source)), s1 = dest.get(idOf(l.source)) || s0;
        const t0 = cur.get(idOf(l.target)), t1 = dest.get(idOf(l.target)) || t0;
        return (k) => isoStraightPath(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, t0.x + (t1.x - t0.x) * k, t0.y + (t1.y - t0.y) * k, gapR(l.target));
      });

    isoEl.countIn.text(`${inShown.length} / ${iso.state.inAll.length}`);
    isoEl.countOut.text(`${outShown.length} / ${iso.state.outAll.length}`);
  }

  // Frame the currently shown nodes (focal centred), with side margins for the labels.
  function fitIsoColumns(animate) {
    if (!iso.shown || !iso.state) return;
    const vis = nodes.filter((n) => iso.shown.has(n.id));
    if (!vis.length) return;
    const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const fx = iso.state.focal.x;
    const halfX = Math.max(fx - d3.min(xs), d3.max(xs) - fx) + 230;
    const y0 = d3.min(ys) - 40, y1 = d3.max(ys) + 50;
    const gw = (2 * halfX) || 1, gh = (y1 - y0) || 1, pad = 24, top = ISO.panelTop ?? profile.isoPanelTop;
    const k = Math.max(0.04, Math.min((ctx.W - 2 * pad) / gw, (ctx.H - top - 2 * pad) / gh, 1.6));
    const tx = ctx.W / 2 - k * fx;
    const ty = top + (ctx.H - top - k * (y0 + y1)) / 2;
    const target = d3.zoomIdentity.translate(tx, ty).scale(k);
    if (animate) svg.transition().duration(450).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  function dismissIsolation() {
    if (!iso.active) return;
    iso.active = false;
    const focal = iso.focal;
    const snap = iso.snapshot;
    const linkInc = iso.state ? iso.state.linkInc : link.filter(() => false);
    const members = iso.state ? iso.state.allSet : new Set();
    const nodeMembers  = iso.state ? iso.state.nodeMembers  : node.filter(() => false);
    const labelMembers = iso.state ? iso.state.labelMembers : labelSel.filter(() => false);
    const cur = new Map([...members].map((id) => [id, { x: byId.get(id).x, y: byId.get(id).y }]));

    nodes.forEach((n) => { const s = snap.get(n.id); n.x = s.x; n.y = s.y; });

    if (iso.touched) {
      node.filter((n) => iso.touched.has(n.id) && !members.has(n.id)).attr("transform", (n) => `translate(${n.x},${n.y})`);
      labelSel.filter((n) => iso.touched.has(n.id) && !members.has(n.id)).attr("x", (n) => n.x).attr("y", (n) => n.y - rOf(n) - 6);
      link.filter((l) => (iso.touched.has(idOf(l.source)) || iso.touched.has(idOf(l.target))) && idOf(l.source) !== focal.id && idOf(l.target) !== focal.id)
        .attr("d", ctx.render.linkPath);
    }

    clearTimeout(iso.labelTimer);
    labelMembers.interrupt().style("display", "none").style("opacity", 1)
      .style("text-anchor", null).style("dominant-baseline", null)
      .style("font-size", (n) => fontOf(n) + "px")
      .attr("x", (n) => n.x).attr("y", (n) => n.y - rOf(n) - 6);

    const T = d3.transition().duration(ISO_DUR).ease(d3.easeCubicInOut);

    nodeMembers.transition(T).attr("transform", (n) => `translate(${n.x},${n.y})`).attr("opacity", 1);

    linkInc.transition(T).attr("opacity", 1).attrTween("d", function (l) {
      const s0 = cur.get(idOf(l.source)) || snap.get(idOf(l.source)), s1 = snap.get(idOf(l.source));
      const t0 = cur.get(idOf(l.target)) || snap.get(idOf(l.target)), t1 = snap.get(idOf(l.target));
      return (k) => isoStraightPath(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, t0.x + (t1.x - t0.x) * k, t0.y + (t1.y - t0.y) * k, gapR(l.target));
    });

    setTimeout(() => {
      node.attr("d", symbolGen).attr("pointer-events", null).style("cursor", null).call(ctx.drag);
      ctx.render.applyCurrency();
      d3.select("#toolbar").style("display", null);
      d3.select("#legend").style("display", null);
      d3.select("#layout-panel").classed("lay-open", false);
      info.html("").style("display", "none");
      isoEl.panel.style("display", "none");
      if (glabelG) glabelG.style("display", ui.groupLabels ? null : "none");
      iso.shown = null; iso.radius = null; iso.snapshot = null; iso.focal = null; iso.state = null;
      iso.path = []; iso.pathExpanded = false; iso.touched = null;
      if (focal) ctx.select.selectNode(focal);
    }, ISO_DUR + 40);

    ctx.zoomCtl.fitView(true);
  }

  return { isolateNode, drillTo, dismiss: dismissIsolation, groupTrigger: isoEl.groupTrigger, isActive: () => iso.active };
}
