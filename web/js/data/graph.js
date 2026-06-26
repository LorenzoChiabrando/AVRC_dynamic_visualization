import { idOf } from "../util.js";

// Build the node/link arrays and the lookup maps the views need. Pure: no d3, no
// DOM. topN = how many of the most-connected non-currency nodes get a label.
export function buildMaps(raw, topN) {
  const nodes = raw.nodes;
  // Keep only source/target; drop stoichiometry/weight, the views do not use them.
  const links = raw.links.map((l) => ({ source: idOf(l.source), target: idOf(l.target) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
  links.forEach((l) => { neighbors.get(l.source).add(l.target); neighbors.get(l.target).add(l.source); });
  // Direct neighbours by direction: outNbr[id] = ids it points to, inNbr[id] = ids pointing to it.
  const outNbr = new Map(nodes.map((n) => [n.id, []]));
  const inNbr  = new Map(nodes.map((n) => [n.id, []]));
  links.forEach((l) => { outNbr.get(l.source).push(l.target); inNbr.get(l.target).push(l.source); });
  const topLabelled = new Set(
    [...nodes].filter((n) => !n.currency).sort((a, b) => b.degree - a.degree)
      .slice(0, topN).map((d) => d.id));
  return { nodes, links, byId, neighbors, inNbr, outNbr, topLabelled };
}

// Fetch a dataset file and build the maps.
export function loadGraph(file, topN) {
  return d3.json("data/" + file).then((raw) => buildMaps(raw, topN));
}
