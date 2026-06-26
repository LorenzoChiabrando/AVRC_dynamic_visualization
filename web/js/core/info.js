import { escapeHtml, compLabel } from "../util.js";

// Selected-node panel (#info): identity, type, subsystem or compartment, degree,
// connection counts, and the two actions (open isolated view, highlight community).
export function createInfo(ctx) {
  const { inNbr, outNbr } = ctx;
  const info = d3.select("#info");

  function renderInfo(d) {
    const grp = d.kind === "reaction"
      ? `<dt>subsystem</dt><dd>${escapeHtml(d.subsystem ?? "-")}</dd>`
      : `<dt>compartment</dt><dd>${escapeHtml(compLabel(d.compartment))}</dd>`;
    const inN = (inNbr.get(d.id) || []).length, outN = (outNbr.get(d.id) || []).length;
    const connRows = d.kind === "metabolite"
      ? `<dt>produced by</dt><dd>${inN}</dd><dt>consumed by</dt><dd>${outN}</dd>`
      : `<dt>substrates</dt><dd>${inN}</dd><dt>products</dt><dd>${outN}</dd>`;
    const ds = ctx.community ? ctx.community.dominantSub(d) : null;
    const focusBtn = `<button class="info-action" id="info-open" title="Open this node's isolated view with its inputs and outputs">Open detailed view</button>`;
    const commBtn = ds ? `<button class="info-action" id="info-comm" title="Highlight this node's community (${escapeHtml(ds)})">Highlight community</button>` : "";
    info.style("display", null).html(
      `<div class="title">${escapeHtml(d.name || d.id)}</div>${focusBtn}${commBtn}` +
      `<dl><dt>id</dt><dd>${escapeHtml(d.id)}</dd>` +
      `<dt>type</dt><dd>${d.kind === "reaction" ? "reaction" : "metabolite"}</dd>` +
      grp + `<dt>degree</dt><dd>${d.degree}</dd>${connRows}</dl>`
    );
    info.select("#info-open").on("click", (ev) => { ev.stopPropagation(); ctx.isolated.isolateNode(d); });
    if (ds) info.select("#info-comm").on("click", (ev) => { ev.stopPropagation(); ctx.community.selectCommunity(ds); });
  }

  return { renderInfo };
}
