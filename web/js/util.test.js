// Pure-helper checks, run with: node --test web/js/util.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { idOf, escapeHtml, shorten, compLabel } from "./util.js";

test("idOf reads string or object", () => {
  assert.equal(idOf("R_X"), "R_X");
  assert.equal(idOf({ id: "M_y" }), "M_y");
});
test("escapeHtml escapes all five", () => {
  assert.equal(escapeHtml(`<a b="c">&'`), "&lt;a b=&quot;c&quot;&gt;&amp;&#39;");
});
test("shorten truncates past 26 chars", () => {
  assert.equal(shorten("short"), "short");
  assert.equal(shorten("x".repeat(30)).length, 25); // 24 chars + ellipsis
});
test("compLabel maps known compartments", () => {
  assert.equal(compLabel("c"), "cytosol");
  assert.equal(compLabel("zzz"), "zzz");
});
