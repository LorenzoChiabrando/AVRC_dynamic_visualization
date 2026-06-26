import { idOf } from "../util.js";
import { SEARCH_BEACON_R, SEARCH_RING_W, SEARCH_RING_COL, SEARCH_LABEL_MIN } from "../config.js";

// Search by name or id. Matches turn into "beacons": a minimum on-screen size with a
// dark ring, so they stay visible when the whole network is fit to screen. Highlight
// happens on Enter, not on every keystroke.
export function createSearch(ctx) {
  const { nodes, byId, ui, profile, scales } = ctx;
  const { rOf, fontOf, colorOf, symbolGen } = scales;
  const info = d3.select("#info");
  const searchTip = d3.select("#o-search-tip");

  let searchHitsSel = null, searchLabelSel = null;
  const beaconGen = d3.symbol().type((d) => d.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle);
  // On-screen radius at least SEARCH_BEACON_R px (counter-scaled by 1/k), never below natural.
  const beaconR = (d) => Math.max(rOf(d), SEARCH_BEACON_R / ctx.k);

  // Node matches the query (by name or id, case-insensitive). Null-safe for link ends.
  function hit(n) {
    return !!n && (((n.name || "").toLowerCase().includes(ui.search)) ||
                   ((n.id   || "").toLowerCase().includes(ui.search)));
  }

  // Resize only the matches at the current zoom (called by applySearch and onZoom).
  function sizeHits() {
    if (!ui.searchMatch || !searchHitsSel) return;
    ctx.sizedK = ctx.k;
    searchHitsSel
      .attr("d", (d) => beaconGen.size(Math.PI * beaconR(d) * beaconR(d))(d))
      .attr("stroke", SEARCH_RING_COL)
      .attr("stroke-width", SEARCH_RING_W / ctx.k);
    if (searchLabelSel) searchLabelSel
      .style("font-size", (d) => Math.max(fontOf(d), SEARCH_LABEL_MIN / ctx.k) + "px")
      .style("stroke-width", 4 / ctx.k)
      .attr("y", (d) => d.y - beaconR(d) - 4 / ctx.k);
  }

  // Restore the neutral look (colors, opacity, arrowheads, natural size and labels).
  function resetSearchPaint() {
    const { node, link, label } = ctx.sel;
    node.attr("fill", colorOf).attr("fill-opacity", null).attr("stroke-opacity", null)
        .attr("d", symbolGen).attr("stroke", "#fff").attr("stroke-width", 1);
    label.style("font-size", (d) => fontOf(d) + "px").style("stroke-width", 4)
         .attr("y", (d) => d.y - rOf(d) - 6);
    link.attr("stroke-opacity", null).attr("marker-end", "url(#arrow)");
    searchHitsSel = null; searchLabelSel = null; ctx.sizedK = null;
  }

  // Highlight matches and dim the rest. Returns -1 if not searching, 0 if no match,
  // else the number of visible matches.
  function applySearch(q) {
    const { node, link, label } = ctx.sel;
    ui.search = q;
    if (!q) {
      ui.searchLabels = false; ui.searchMatch = false;
      resetSearchPaint(); hideNoMatch(); ctx.select.clearHighlight();
      return -1;
    }
    ui.selected = null; ui.community = null; ctx.layers.commG.selectAll("*").remove();
    node.attr("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1);
    link.attr("opacity", 1);
    const m = nodes.filter((d) => hit(d) && (ui.currency || !d.currency)).length;
    if (m === 0) {
      ui.searchMatch = false;
      resetSearchPaint(); ctx.labels.applyLabels();
      info.style("display", null).html(`<div class="title">Search</div><div class="ctype">no matching nodes</div>`);
      return 0;
    }
    ui.searchMatch = true;
    node.attr("fill", (n) => hit(n) ? profile.MATCH_COL : colorOf(n))
        .attr("fill-opacity", (n) => hit(n) ? 1 : profile.NODE_DIM)
        .attr("stroke-opacity", (n) => hit(n) ? 1 : profile.NODE_DIM);
    // Keep the (few) matches as their own selection, resized at the current zoom.
    searchHitsSel = node.filter((n) => hit(n) && (ui.currency || !n.currency));
    searchLabelSel = label.filter((n) => hit(n) && (ui.currency || !n.currency));
    sizeHits();
    const linkHit = (l) => hit(byId.get(idOf(l.source))) && hit(byId.get(idOf(l.target)));
    link.attr("stroke-opacity", (l) => linkHit(l) ? profile.LINK_OP : profile.LINK_DIM)
        .attr("marker-end", (l) => linkHit(l) ? "url(#arrow)" : null);
    ctx.labels.applyLabels();
    info.style("display", null).html(`<div class="title">Search</div><div class="ctype">${m} matching ${m === 1 ? "node" : "nodes"}</div>`);
    return m;
  }

  // No-match tooltip under the search bar, positioned from the input's rect.
  function showNoMatch() {
    const el = document.getElementById("o-search");
    if (!el) return;
    const r = el.getBoundingClientRect();
    searchTip.style("left", Math.round(r.left) + "px")
             .style("top", Math.round(r.bottom + 6) + "px")
             .style("display", "block");
  }
  function hideNoMatch() { searchTip.style("display", "none"); }

  // Empty the bar and drop the highlight. No-op when not searching.
  function clearBox() {
    if (!ui.search) return;
    ui.search = ""; ui.searchLabels = false; ui.searchMatch = false;
    d3.select("#o-search").property("value", "");
    resetSearchPaint(); hideNoMatch();
  }

  // Bind the search input. Highlight on Enter; clearing the field resets the search.
  function wireSearch() {
    function runSearch(q) {
      const m = applySearch(q);
      if (q) { ui.searchLabels = true; ctx.labels.applyLabels(); if (m === 0) showNoMatch(); }
      else hideNoMatch();
    }
    d3.select("#o-search")
      .on("input", function () { hideNoMatch(); if (!this.value.trim() && ui.searchMatch) runSearch(""); })
      .on("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runSearch(this.value.trim().toLowerCase()); } })
      .on("search", function () { if (!this.value.trim()) runSearch(""); });
  }

  return { hit, applySearch, sizeHits, clearBox, wireSearch, showNoMatch, hideNoMatch };
}
