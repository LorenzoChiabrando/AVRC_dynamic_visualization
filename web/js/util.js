// Small pure helpers shared by every view: id access, html escaping, label text.

// Compartment codes to readable names (used in info panels and labels).
const COMP_NAME = { c: "cytosol", e: "extracellular", p: "periplasm" };
export const compLabel = (c) => COMP_NAME[c] || c || "?";

// Trim long names for compact UI (keeps 24 chars + an ellipsis).
export const shorten = (s) => (s && s.length > 26) ? s.slice(0, 24) + "…" : (s || "?");

// Links may store source/target as a string id or as the resolved node object.
export const idOf = (ref) => (ref && ref.id != null ? ref.id : ref);

// One escaper for every view (covers & < > " ').
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
