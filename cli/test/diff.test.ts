import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diff, enumMembers, report, semver, typeRepr } from "../src/diff.ts";
import type { JsonObject } from "../src/schema.ts";

/**
 * The vocabulary diff decides whether a change is additive or breaking,
 * and whether the version bump matches. Producers gate publication on it,
 * so a misclassification either blocks a legitimate release or lets a
 * breaking change reach consumers as a minor. Both directions are
 * checked, on the same scenarios the specs tool's tests pin.
 */

function vocabulary(
  version = "1.0.0",
  components: JsonObject = {},
  actions: JsonObject = {},
  name = "example",
): JsonObject {
  return { milano: "1.0.0", name, version, components, actions };
}

function verdicts(old: JsonObject, next: JsonObject): string[] {
  return diff(old, next)
    .map(([verdict]) => verdict)
    .sort();
}

function messages(old: JsonObject, next: JsonObject): string[] {
  return diff(old, next).map(([, message]) => message);
}

function component(properties: JsonObject): JsonObject {
  return vocabulary("1.0.0", { A: { properties } });
}

function withEvents(events: JsonObject): JsonObject {
  return vocabulary("1.0.0", { A: { events } });
}

describe("semver", () => {
  it("accepts major.minor.patch and nothing else", () => {
    assert.deepEqual(semver("1.2.3"), [1, 2, 3]);
    assert.deepEqual(semver("10.20.30"), [10, 20, 30]);
    for (const text of ["1.2", "1.2.3.4", "x.y.z", "1.2.x", "", "v1.2.3", "1.1.0-rc.1", null]) {
      assert.equal(semver(text), null, `${String(text)} should not parse`);
    }
  });
});

describe("type representation", () => {
  it("is stable across key order and distinguishes optionality", () => {
    assert.equal(typeRepr({ enum: ["a"], optional: true }), typeRepr({ optional: true, enum: ["a"] }));
    assert.notEqual(typeRepr("string"), typeRepr("string?"));
  });

  it("reads enum members with their optionality", () => {
    assert.deepEqual(enumMembers({ enum: ["b", "a"] }), [new Set(["a", "b"]), false]);
    assert.deepEqual(enumMembers({ enum: ["a"], optional: true }), [new Set(["a"]), true]);
    assert.equal(enumMembers("string"), null);
    assert.equal(enumMembers({ array: "string" }), null);
  });
});

describe("components", () => {
  it("adding is additive, removing is breaking", () => {
    const one = vocabulary("1.0.0", { A: {} });
    const two = vocabulary("1.0.0", { A: {}, B: {} });
    assert.deepEqual(verdicts(one, two), ["ADDITIVE"]);
    assert.ok(messages(one, two).includes("component B added"));
    assert.deepEqual(verdicts(two, one), ["BREAKING"]);
    assert.ok(messages(two, one).includes("component B removed"));
  });

  it("accepting children is additive, refusing them is breaking", () => {
    const without = vocabulary("1.0.0", { A: {} });
    const withChildren = vocabulary("1.0.0", { A: { children: true } });
    assert.deepEqual(verdicts(without, withChildren), ["ADDITIVE"]);
    assert.deepEqual(verdicts(withChildren, without), ["BREAKING"]);
  });

  it("becoming strict is breaking, relaxing is additive", () => {
    const lenient = vocabulary("1.0.0", { A: {} });
    const strict = vocabulary("1.0.0", { A: { strict: true } });
    assert.deepEqual(verdicts(lenient, strict), ["BREAKING"]);
    assert.ok(messages(lenient, strict).includes("component A became strict"));
    assert.deepEqual(verdicts(strict, lenient), ["ADDITIVE"]);
  });
});

describe("properties", () => {
  it("adding is additive, removing and retyping are breaking", () => {
    assert.deepEqual(verdicts(component({ a: "string" }), component({ a: "string", b: "int" })), ["ADDITIVE"]);
    assert.deepEqual(verdicts(component({ a: "string", b: "int" }), component({ a: "string" })), ["BREAKING"]);
    assert.deepEqual(verdicts(component({ a: "string" }), component({ a: "int" })), ["BREAKING"]);
    assert.match(messages(component({ a: "string" }), component({ a: "int" }))[0] ?? "", /type changed/);
  });

  it("changing optionality is breaking in both directions", () => {
    // Optionality is part of the type (vocabulary schema spec, Evolution).
    assert.deepEqual(verdicts(component({ a: "string" }), component({ a: "string?" })), ["BREAKING"]);
    assert.deepEqual(verdicts(component({ a: "string?" }), component({ a: "string" })), ["BREAKING"]);
  });

  it("an enum gaining members is additive; losing, swapping, or changing optionality is breaking", () => {
    const one = component({ a: { enum: ["one"] } });
    const two = component({ a: { enum: ["one", "two"] } });
    assert.deepEqual(verdicts(one, two), ["ADDITIVE"]);
    assert.match(messages(one, two)[0] ?? "", /enum gained: two/);
    assert.deepEqual(verdicts(two, one), ["BREAKING"]);
    assert.deepEqual(verdicts(two, component({ a: { enum: ["one", "three"] } })), ["BREAKING"]);
    assert.deepEqual(verdicts(one, component({ a: { enum: ["one"], optional: true } })), ["BREAKING"]);
  });

  it("reordering members or declarations is not a change", () => {
    assert.deepEqual(diff(component({ a: { enum: ["one", "two"] } }), component({ a: { enum: ["two", "one"] } })), []);
    assert.deepEqual(diff(component({ a: "string", b: "int" }), component({ b: "int", a: "string" })), []);
  });
});

describe("events", () => {
  it("adding is additive, removing is breaking", () => {
    assert.deepEqual(verdicts(withEvents({ tap: null }), withEvents({ tap: null, hold: null })), ["ADDITIVE"]);
    assert.deepEqual(verdicts(withEvents({ tap: null, hold: null }), withEvents({ tap: null })), ["BREAKING"]);
  });

  it("giving a payloadless event a payload is breaking; a payload enum gaining members is additive", () => {
    assert.deepEqual(verdicts(withEvents({ tap: null }), withEvents({ tap: "string" })), ["BREAKING"]);
    assert.deepEqual(
      verdicts(withEvents({ pick: { enum: ["one"] } }), withEvents({ pick: { enum: ["one", "two"] } })),
      ["ADDITIVE"],
    );
  });
});

describe("actions", () => {
  it("adding is additive, removing is breaking", () => {
    assert.deepEqual(verdicts(vocabulary("1.0.0", {}, { a: {} }), vocabulary("1.0.0", {}, { a: {}, b: {} })), ["ADDITIVE"]);
    assert.deepEqual(verdicts(vocabulary("1.0.0", {}, { a: {}, b: {} }), vocabulary("1.0.0", {}, { a: {} })), ["BREAKING"]);
  });

  it("parameters: adding is additive, removing or retyping is breaking", () => {
    const old = vocabulary("1.0.0", {}, { a: { parameters: { x: "string" } } });
    assert.deepEqual(verdicts(old, vocabulary("1.0.0", {}, { a: { parameters: { x: "string", y: "int?" } } })), ["ADDITIVE"]);
    assert.deepEqual(verdicts(old, vocabulary("1.0.0", {}, { a: {} })), ["BREAKING"]);
    assert.deepEqual(verdicts(old, vocabulary("1.0.0", {}, { a: { parameters: { x: "int" } } })), ["BREAKING"]);
  });

  it("failures: adding is additive, removing or retyping is breaking, compared apart from results", () => {
    const none = vocabulary("1.0.0", {}, { a: {} });
    const text = vocabulary("1.0.0", {}, { a: { failure: "string" } });
    assert.ok(messages(none, text).includes("action a failure added"));
    assert.ok(messages(text, none).includes("action a failure removed"));
    const optional = vocabulary("1.0.0", {}, { a: { failure: "string?" } });
    assert.deepEqual(diff(text, optional).map(([verdict]) => verdict), ["BREAKING"]);
    const one = vocabulary("1.0.0", {}, { a: { failure: { enum: ["one"] } } });
    const two = vocabulary("1.0.0", {}, { a: { failure: { enum: ["one", "two"] } } });
    assert.ok(messages(one, two).includes("action a failure enum gained: two"));
    const both = vocabulary("1.0.0", {}, { a: { result: "string", failure: "int" } });
    const changed = vocabulary("1.0.0", {}, { a: { result: "string", failure: "string" } });
    assert.deepEqual(messages(both, changed), ['action a failure type changed: "int" -> "string"']);
  });

  it("results: adding is additive, removing or retyping is breaking, an enum may gain members", () => {
    const none = vocabulary("1.0.0", {}, { a: {} });
    const text = vocabulary("1.0.0", {}, { a: { result: "string" } });
    assert.deepEqual(verdicts(none, text), ["ADDITIVE"]);
    assert.ok(messages(none, text).includes("action a result added"));
    assert.deepEqual(verdicts(text, none), ["BREAKING"]);
    assert.ok(messages(text, none).includes("action a result removed"));
    const retyped = vocabulary("1.0.0", {}, { a: { result: "int" } });
    assert.deepEqual(verdicts(text, retyped), ["BREAKING"]);
    assert.match(messages(text, retyped)[0] ?? "", /type changed/);
    const one = vocabulary("1.0.0", {}, { a: { result: { enum: ["one"] } } });
    const two = vocabulary("1.0.0", {}, { a: { result: { enum: ["one", "two"] } } });
    assert.ok(messages(one, two).includes("action a result enum gained: two"));
    assert.deepEqual(diff(one, vocabulary("1.0.0", {}, { a: { result: { enum: ["one"] } } })), []);
  });
});

describe("change sets", () => {
  it("report every change", () => {
    const old = vocabulary("1.0.0", { A: { properties: { x: "string" } }, Gone: {} }, { kept: {} });
    const next = vocabulary("1.0.0", { A: { properties: { x: "int", y: "string?" } }, New: {} }, { kept: {}, added: {} });
    const found = verdicts(old, next);
    assert.equal(found.filter((verdict) => verdict === "BREAKING").length, 2);
    assert.equal(found.filter((verdict) => verdict === "ADDITIVE").length, 3);
  });

  it("find nothing in an unchanged vocabulary", () => {
    const artifact = vocabulary("1.0.0", { A: { properties: { x: "string" }, events: { tap: null } } }, { go: {} });
    assert.deepEqual(diff(artifact, JSON.parse(JSON.stringify(artifact)) as JsonObject), []);
  });
});

describe("the report", () => {
  it("passes an unchanged vocabulary", () => {
    const artifact = vocabulary("1.0.0", { A: {} });
    const result = report(artifact, artifact);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "no declaration changes\nverdict: ok (0 breaking, 0 additive)\n");
    assert.equal(result.stderr, "");
  });

  it("passes additive changes with a minor bump and prints each with its verdict", () => {
    const result = report(vocabulary("1.0.0", { A: {} }), vocabulary("1.1.0", { A: {}, B: {} }));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "ADDITIVE  component B added\nverdict: ok (0 breaking, 1 additive)\n");
  });

  it("fails additive changes with only a patch bump, or none", () => {
    const patch = report(vocabulary("1.0.0", { A: {} }), vocabulary("1.0.1", { A: {}, B: {} }));
    assert.equal(patch.status, 1);
    assert.match(patch.stderr, /require at least a MINOR bump/);
    assert.ok(patch.stdout.endsWith("\n\n"), "a blank line separates the changes from the verdict");
    const none = report(vocabulary("1.0.0", { A: {} }), vocabulary("1.0.0", { A: {}, B: {} }));
    assert.equal(none.status, 1);
    assert.equal(
      none.stderr,
      "error: version did not increase: 1.0.0 -> 1.0.0\n" +
        "error: 1 additive change(s) require at least a MINOR bump; got 1.0.0 -> 1.0.0\n",
    );
  });

  it("fails breaking changes without a major bump and passes them with one", () => {
    const minor = report(vocabulary("1.0.0", { A: {}, B: {} }), vocabulary("1.1.0", { A: {} }));
    assert.equal(minor.status, 1);
    assert.match(minor.stderr, /1 breaking change\(s\) require a MAJOR bump; got 1\.0\.0 -> 1\.1\.0/);
    const major = report(vocabulary("1.4.2", { A: {}, B: {} }), vocabulary("2.0.0", { A: {} }));
    assert.equal(major.status, 0);
    assert.match(major.stdout, /BREAKING  component B removed\nverdict: ok \(1 breaking, 0 additive\)/);
  });

  it("fails a version going backwards, a renamed vocabulary, and an unparseable version", () => {
    assert.equal(report(vocabulary("2.0.0", { A: {} }), vocabulary("1.0.0", { A: {}, B: {} })).status, 1);
    const renamed = report(vocabulary("1.0.0", {}, {}, "before"), vocabulary("2.0.0", {}, {}, "after"));
    assert.equal(renamed.status, 1);
    assert.equal(renamed.stderr, "error: vocabulary name changed: before -> after\n");
    const prerelease = report(vocabulary("1.0.0"), vocabulary("1.1.0-rc.1", { A: {} }));
    assert.equal(prerelease.status, 1);
    assert.match(prerelease.stderr, /major\.minor\.patch/);
  });
});

describe("host functions", () => {
  function withFunctions(functions: JsonObject, version = "1.0.0"): JsonObject {
    return { ...vocabulary(version), milano: "2.1.0", functions };
  }
  const f = (args: unknown[], returns: unknown): JsonObject => ({ arguments: args, returns });

  it("treats an added function as additive and a removed one as breaking", () => {
    assert.deepEqual(messages(withFunctions({}), withFunctions({ formatMoney: f(["int", "string"], "string") })), [
      "function formatMoney added",
    ]);
    assert.deepEqual(messages(withFunctions({ formatMoney: f(["int", "string"], "string") }), withFunctions({})), [
      "function formatMoney removed",
    ]);
  });

  it("treats a changed arity, argument, or return as breaking", () => {
    const old = withFunctions({ g: f(["int", "string"], "string") });
    assert.deepEqual(messages(old, withFunctions({ g: f(["int"], "string") })), [
      "function g arity changed: 2 -> 1",
    ]);
    assert.deepEqual(messages(old, withFunctions({ g: f(["double", "string"], "string") })), [
      'function g argument 0 type changed: "int" -> "double"',
    ]);
    assert.deepEqual(messages(old, withFunctions({ g: f(["int", "string"], "string?") })), [
      'function g returns type changed: "string" -> "string?"',
    ]);
  });

  it("treats an enum gaining members as additive in either position", () => {
    const old = withFunctions({ g: f([{ enum: ["a"] }], { enum: ["x"] }) });
    const next = withFunctions({ g: f([{ enum: ["a", "b"] }], { enum: ["x", "y"] }) });
    assert.deepEqual(messages(old, next), [
      "function g argument 0 enum gained: b",
      "function g returns enum gained: y",
    ]);
  });
});
