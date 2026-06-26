// config.js: all the tunable constants in one place.
//
// Three groups: shared constants, the organized-only structural constants (subsystem
// blocks and search beacons), and the per-view PROFILE and LAYOUT.

// --- Shared across every view ---------------------------------------------
export const LINK_COL = "#aab1b8";        // edge color
export const ARROW_COL = "#7a828b";       // arrow tip color
export const ISO_DUR = 800;               // isolate/return animation (ms)
// Isolated-view geometry (panelTop is per-view, see PROFILE).
export const ISO = {
  rowH: 30, botPad: 56, colFrac: 0.30, colMax: 420,
  nbrRMin: 6, nbrRMax: 12, focalR: 20, labelGap: 8,
};

// --- Organized-only structural constants ----------------------------------
export const LABEL_MIN = 8;               // a block is labelled past this many reactions
export const NODE_SP = 21;                // air inside a subsystem block
export const BOUNDARY_SUBS = new Set(["Exchange/demand reaction"]);
export const SEP = "";              // join/split separator for subsystem-pair keys (never in names)
export const SEARCH_BEACON_R = 15;        // min on-screen radius of a matched node
export const SEARCH_RING_W = 2.5;         // match ring thickness (px)
export const SEARCH_RING_COL = "#2f474a"; // match ring color
export const SEARCH_LABEL_MIN = 13;       // min on-screen size of a match label

// --- Per-view visual profile ----------------------------------------------
// Colors and sizing for the views. Organized and its reaction projection share one profile.
const ORGANIZED_PROFILE = {
  COL_MET: "#2f474a", COL_EXT: "#2f474a", COL_RXN: "#6a306c",
  LINK_W: 1.0, LINK_OP: 0.4, LINK_DIM: 0.04, NODE_DIM: 0.12,
  R_MIN: 4, R_MAX: 28, FONT_MIN: 12, FONT_MAX: 20,
  TOP_LABELS: 24, MATCH_COL: "#6ef1c7", isoPanelTop: 170,
};
export const PROFILE = {
  organized: ORGANIZED_PROFILE,
  projection: ORGANIZED_PROFILE,
};

// --- Per-view layout-force defaults (the layout panel's initial values) ----
export const LAYOUT = {
  organized:  { cluster: 0.6, charge:  -55, collidePad: 12, boundary: 0.30, spacing: 1.2, settleTicks: 350 },
  projection: { cluster: 0.6, charge: -110, collidePad: 14, boundary: 0.30, spacing: 1.8, settleTicks: 350 },
};
