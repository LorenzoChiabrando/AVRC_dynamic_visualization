import { LAYOUT } from "../config.js";

// Wire the DOM controls to the modules. Node interactions (hover, click, background,
// Esc) are shared by every view; the toolbar, sliders and popovers are per view.
export function wire(ctx, { layout }) {
  const { ui } = ctx;
  const node = ctx.sel.node;

  // Hover shows a label; in the isolated view hover must not touch labels (columns).
  node.on("mouseenter", (e, d) => { if (ctx.iso.active) return; ctx.hovered = d.id; ctx.labels.applyLabels(); });
  node.on("mouseleave", () => { if (ctx.iso.active) return; ctx.hovered = null; ctx.labels.applyLabels(); });
  // Click: drill a shown neighbour while isolated, otherwise select.
  node.on("click", (e, d) => {
    e.stopPropagation();
    if (ctx.iso.active) {
      if (ctx.iso.shown && ctx.iso.shown.has(d.id) && ctx.iso.focal && d.id !== ctx.iso.focal.id) ctx.isolated.drillTo(d);
      return;
    }
    ctx.select.selectNode(d);
  });
  ctx.svg.on("click", () => { if (ctx.iso.active) return; ctx.select.clearHighlight(); });
  d3.select("body").on("keydown", (e) => { if (e.key === "Escape" && ctx.iso.active) ctx.isolated.dismiss(); });

  wireOrganized(ctx, layout);
}

// Toolbar, layout sliders and popovers for the organized and projection views.
function wireOrganized(ctx, layout) {
  const { ui } = ctx;
  const DEF = LAYOUT[ctx.view];

  d3.select("#o-curr").on("change", function () { ui.currency = this.checked; ctx.render.applyCurrency(); ctx.labels.applyLabels(); layout.renderGroupLabels(); });
  d3.select("#o-lbl").on("change", function () { ui.labels = this.checked; ctx.labels.applyLabels(); });
  d3.select("#o-glbl").on("change", function () { ui.groupLabels = this.checked; ctx.layers.glabelG.style("display", ui.groupLabels ? null : "none"); });
  d3.select("#o-lblid").on("change", function () {
    ui.labelId = this.checked;
    d3.select("#iso-lblid").property("checked", this.checked);
    ctx.labels.applyLabelText();
  });
  d3.select("#o-fit").on("click", () => ctx.zoomCtl.fitView(true));
  d3.select("#reset").on("click", reset);
  d3.select("#view-toggle").text("Reaction projection ▸")
    .on("click", () => { sessionStorage.setItem("organized.view", "projection"); location.reload(); });

  const slider = (id, key, fmt) => d3.select(id).on("input", function () { ctx.opt[key] = +this.value; d3.select(id + "-v").text(fmt(this.value)); });
  slider("#op-cluster", "cluster", (v) => (+v).toFixed(2));
  slider("#op-charge", "charge", (v) => v);
  slider("#op-collide", "collidePad", (v) => v);
  slider("#op-boundary", "boundary", (v) => (+v).toFixed(2));
  slider("#op-spacing", "spacing", (v) => (+v).toFixed(2));
  d3.select("#op-recompute").on("click", layout.recompute);

  // "Layout" popover.
  d3.select("#lay-btn").on("click", function () {
    const panel = d3.select("#layout-panel"), open = !panel.classed("lay-open");
    panel.classed("lay-open", open);
    d3.select(this).classed("open", open);
  });
  // Close the "Search & view" popover and clear the search (so beacons do not linger).
  function closeToolsPanel() {
    d3.select("#tools-panel").classed("tools-open", false);
    d3.select("#tools-btn").classed("open", false);
    if (ui.search) { ctx.search.clearBox(); ctx.labels.applyLabels(); }
  }
  d3.select("#tools-btn").on("click", function () {
    const willOpen = !d3.select("#tools-panel").classed("tools-open");
    if (willOpen) {
      d3.select("#tools-panel").classed("tools-open", true);
      d3.select(this).classed("open", true);
      setTimeout(() => { const s = document.getElementById("o-search"); if (s) s.focus(); }, 0);
    } else {
      closeToolsPanel();
    }
  });
  // Isolated view filter dropdown trigger.
  if (ctx.isolated.groupTrigger) ctx.isolated.groupTrigger.on("click", () => { d3.select("#iso-group").classed("open", !d3.select("#iso-group").classed("open")); });
  // Click outside closes the popovers and the filter dropdown.
  d3.select(document).on("click.popovers", (ev) => {
    const t = ev.target;
    if (t.closest && !t.closest("#lay-btn") && !t.closest("#layout-panel")) {
      d3.select("#layout-panel").classed("lay-open", false);
      d3.select("#lay-btn").classed("open", false);
    }
    if (t.closest && !t.closest("#tools-btn") && !t.closest("#tools-panel")) {
      if (d3.select("#tools-panel").classed("tools-open")) closeToolsPanel();
    }
    if (t.closest && !t.closest("#iso-group")) d3.select("#iso-group").classed("open", false);
  });

  function reset() {
    ui.currency = true; ui.labels = true; ui.groupLabels = true; ui.labelId = false;
    d3.select("#o-curr").property("checked", true);
    d3.select("#o-lbl").property("checked", true);
    d3.select("#o-glbl").property("checked", true);
    d3.select("#o-lblid").property("checked", false); ctx.labels.applyLabelText();
    Object.assign(ctx.opt, DEF);
    d3.select("#op-cluster").property("value", DEF.cluster);   d3.select("#op-cluster-v").text(DEF.cluster.toFixed(2));
    d3.select("#op-charge").property("value", DEF.charge);     d3.select("#op-charge-v").text(DEF.charge);
    d3.select("#op-collide").property("value", DEF.collidePad); d3.select("#op-collide-v").text(DEF.collidePad);
    d3.select("#op-boundary").property("value", DEF.boundary); d3.select("#op-boundary-v").text(DEF.boundary.toFixed(2));
    d3.select("#op-spacing").property("value", DEF.spacing);   d3.select("#op-spacing-v").text(DEF.spacing.toFixed(2));
    ctx.layers.glabelG.style("display", null);
    ctx.search.clearBox();
    ctx.select.clearHighlight(); ctx.render.applyCurrency();
    layout.recompute();
  }
}
