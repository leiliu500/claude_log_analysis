import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxSeverity,
  highestSeverity,
  atOrAbove,
  coerceSeverity,
  severityRank,
} from "../src/lib/severity.ts";

test("severityRank orders low to high", () => {
  assert.ok(severityRank("info") < severityRank("low"));
  assert.ok(severityRank("high") < severityRank("critical"));
});

test("maxSeverity returns the more severe", () => {
  assert.equal(maxSeverity("low", "high"), "high");
  assert.equal(maxSeverity("critical", "medium"), "critical");
});

test("highestSeverity over a list", () => {
  assert.equal(highestSeverity(["low", "medium", "high"]), "high");
  assert.equal(highestSeverity([]), "info");
});

test("atOrAbove threshold", () => {
  assert.ok(atOrAbove("critical", "high"));
  assert.ok(atOrAbove("high", "high"));
  assert.ok(!atOrAbove("medium", "high"));
});

test("coerceSeverity normalizes junk to low", () => {
  assert.equal(coerceSeverity("HIGH"), "high");
  assert.equal(coerceSeverity("bogus"), "low");
  assert.equal(coerceSeverity(undefined), "low");
});
