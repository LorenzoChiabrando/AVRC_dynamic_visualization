// Size, shape and color scales derived from the node degrees. Per-view sizing and
// palette come from the profile so each view keeps its own look.
export function createScales(nodes, profile) {
  const rScale = d3.scaleSqrt().domain(d3.extent(nodes, (d) => d.degree)).range([profile.R_MIN, profile.R_MAX]);
  const rOf = (d) => rScale(d.degree || 0);
  const fScale = d3.scaleSqrt().domain(d3.extent(nodes, (d) => d.degree)).range([profile.FONT_MIN, profile.FONT_MAX]);
  const fontOf = (d) => fScale(d.degree || 0);
  // Circle for metabolites, square for reactions; area proportional to the radius.
  const symbolGen = d3.symbol()
    .type((d) => d.kind === "reaction" ? d3.symbolSquare : d3.symbolCircle)
    .size((d) => Math.PI * rOf(d) * rOf(d));
  // Neutral color by type and boundary (no color by subsystem here).
  const colorOf = (d) => d.kind === "reaction" ? profile.COL_RXN : (d.compartment === "e" ? profile.COL_EXT : profile.COL_MET);
  return { rOf, fontOf, colorOf, symbolGen, rScale, fScale };
}
