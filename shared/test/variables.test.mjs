import test from "node:test";
import assert from "node:assert/strict";
import { detectVariables } from "../dist/variables.js";

test("detects a standard variable", () => {
  assert.deepEqual(detectVariables("Hello {{name}}"), {
    variables: ["name"],
    malformed: []
  });
});

test("trims whitespace inside placeholder braces", () => {
  assert.deepEqual(detectVariables("Hello {{ first_name }}"), {
    variables: ["first_name"],
    malformed: []
  });
});

test("preserves first appearance order and removes duplicates", () => {
  assert.deepEqual(detectVariables("{{city}} {{name}} {{city}}"), {
    variables: ["city", "name"],
    malformed: []
  });
});

test("ignores escaped literal openers", () => {
  assert.deepEqual(detectVariables(String.raw`Use \{{not_a_variable}}`), {
    variables: [],
    malformed: []
  });
});

test("reports invalid variable names", () => {
  assert.deepEqual(detectVariables("{{first-name}}"), {
    variables: [],
    malformed: ["{{first-name}}"]
  });
});

test("reports an unclosed placeholder", () => {
  assert.deepEqual(detectVariables("Hello {{name"), {
    variables: [],
    malformed: ["{{name"]
  });
});

test("continues parsing after a malformed closed placeholder", () => {
  assert.deepEqual(detectVariables("{{bad-name}} {{valid}}"), {
    variables: ["valid"],
    malformed: ["{{bad-name}}"]
  });
});

test("returns empty arrays when no placeholders exist", () => {
  assert.deepEqual(detectVariables("No variables here"), {
    variables: [],
    malformed: []
  });
});
