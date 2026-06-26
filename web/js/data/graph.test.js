// Run with: node --test web/js/data/graph.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaps } from "./graph.js";

const raw = {
  nodes: [
    { id: "M_a", currency: false, degree: 2 },
    { id: "R_1", currency: false, degree: 1 },
    { id: "M_b", currency: true,  degree: 1 },
  ],
  links: [ { source: "M_a", target: "R_1" }, { source: "R_1", target: "M_b" } ],
};

test("buildMaps wires neighbours by direction", () => {
  const g = buildMaps(raw, 2);
  assert.deepEqual([...g.neighbors.get("R_1")].sort(), ["M_a", "M_b"]);
  assert.deepEqual(g.inNbr.get("R_1"), ["M_a"]);
  assert.deepEqual(g.outNbr.get("R_1"), ["M_b"]);
});
test("buildMaps skips currency nodes in topLabelled", () => {
  const g = buildMaps(raw, 2);
  assert.ok(g.topLabelled.has("M_a"));
  assert.ok(!g.topLabelled.has("M_b"));
});
