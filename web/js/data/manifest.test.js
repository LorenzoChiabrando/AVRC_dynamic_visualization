// Run with: node --test web/js/data/manifest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseModelFile, dataFile } from "./manifest.js";

const manifest = {
  default: "ecoli.json",
  models: [
    { file: "ecoli.json", reactions: "ecoli.reactions.json", label: "E. coli" },
    { file: "abio.json",  reactions: "abio.reactions.json",  label: "Abio" },
  ],
};

test("chooseModelFile prefers a valid saved choice", () => {
  assert.equal(chooseModelFile(manifest, "abio.json"), "abio.json");
});
test("chooseModelFile falls back to default when saved is invalid", () => {
  assert.equal(chooseModelFile(manifest, "gone.json"), "ecoli.json");
});
test("dataFile picks model vs reactions file by view", () => {
  assert.equal(dataFile(manifest, "ecoli.json", "organized"), "ecoli.json");
  assert.equal(dataFile(manifest, "ecoli.json", "projection"), "ecoli.reactions.json");
});
