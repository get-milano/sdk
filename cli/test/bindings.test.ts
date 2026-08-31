import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { BindingError, defaultPrefix, generateKotlin, generateSwift, generateTs } from "../src/bindings.ts";
import type { Vocabulary } from "../src/bindings.ts";

/**
 * The bindings generators against the specs repository's goldens: the
 * committed output of the Python generator for a fixture that reaches
 * every descriptor form, byte for byte. The rest pins what must hold in
 * every language at once, and the shapes the goldens cannot show.
 */

const SPECS = process.env["MILANO_SPECS_DIR"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../specs");
const TESTDATA = join(SPECS, "tools", "testdata");
const HAS_SPECS = existsSync(join(TESTDATA, "bindings_fixture.json"));
const skip = HAS_SPECS ? false : "no specs checkout";

function fixture(): Vocabulary {
  return JSON.parse(readFileSync(join(TESTDATA, "bindings_fixture.json"), "utf8")) as Vocabulary;
}

function golden(name: string): string {
  return readFileSync(join(TESTDATA, name), "utf8");
}

function vocabulary(components: Record<string, unknown> = {}, actions: Record<string, unknown> = {}): Vocabulary {
  return { milano: "1.0.0", name: "shop", version: "2.1.0", components, actions };
}

describe("the goldens", { skip }, () => {
  it("Swift", () => {
    assert.equal(generateSwift(fixture(), "Fx"), golden("expected_bindings.swift"));
  });

  it("Kotlin", () => {
    assert.equal(generateKotlin(fixture(), "com.example.fixture", ""), golden("expected_bindings.kt"));
  });

  it("TypeScript", () => {
    assert.equal(generateTs(fixture(), "Fx", "@get-milano/core"), golden("expected_bindings.ts"));
  });

  it("every suite vocabulary generates, with balanced delimiters", () => {
    const suites = readdirSync(join(SPECS, "conformance"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(SPECS, "conformance", entry.name, "vocabulary.json"))
      .filter((path) => existsSync(path));
    assert.ok(suites.length > 0);
    for (const path of suites) {
      const artifact = JSON.parse(readFileSync(path, "utf8")) as Vocabulary;
      for (const produced of [
        generateSwift(artifact, "Suite"),
        generateKotlin(artifact, "dev.getmilano.suite", ""),
        generateTs(artifact, "Suite", "@get-milano/core"),
      ]) {
        assert.ok(produced.length > 0);
        assert.equal(produced.split("{").length, produced.split("}").length, `${path}: unbalanced`);
      }
    }
  });
});

describe("optionality", { skip }, () => {
  // A declared non-optional must never come back nullable, and an optional
  // never non-nullable: the reason the generator exists.
  it("Swift", () => {
    const produced = generateSwift(fixture(), "Fx");
    assert.ok(produced.includes("public var title: String {"));
    assert.ok(produced.includes("public var subtitle: String? {"));
    assert.ok(produced.includes("public var count: Int64 {"));
    assert.ok(produced.includes("public var layout: FxWidgetLayout {"));
    assert.ok(produced.includes("public var tone: FxWidgetTone? {"));
  });

  it("Kotlin", () => {
    const produced = generateKotlin(fixture(), "com.example.fixture", "");
    assert.match(produced, /val title: String\b(?!\?)/);
    assert.match(produced, /val subtitle: String\?/);
    assert.match(produced, /val count: Long\b(?!\?)/);
  });

  it("TypeScript", () => {
    const produced = generateTs(fixture(), "Fx", "@get-milano/core");
    assert.ok(produced.includes("get title(): string {"));
    assert.ok(produced.includes("get subtitle(): string | null {"));
    assert.ok(produced.includes("get count(): bigint {"));
    assert.ok(produced.includes("get tone(): FxWidgetTone | null {"));
    // A non-optional read asserts the type rather than defaulting.
    assert.equal(produced.includes('?? ""'), false);
  });
});

describe("shapes the goldens cannot show", () => {
  it("a vocabulary with no actions still has the unrecognized case", () => {
    const artifact = vocabulary({ Text: { properties: { text: "string" } } });
    assert.ok(generateSwift(artifact, "Shop").includes("    case unrecognized(MilanoAction)"));
    assert.ok(generateKotlin(artifact, "com.acme", "").includes("data class Unrecognized("));
    assert.ok(generateTs(artifact, "Shop", "@get-milano/core").includes('| { readonly kind: "unrecognized"'));
  });

  it("a vocabulary with no components, and a component with nothing declared", () => {
    const artifact = vocabulary({ Spacer: {} }, { go: {} });
    assert.ok(generateSwift(artifact, "Shop").includes("public struct ShopSpacerNode {"));
    assert.ok(generateKotlin(artifact, "com.acme", "").includes("class SpacerNode(\n    val node: MilanoNode,\n)\n"));
    assert.ok(generateTs(artifact, "Shop", "@get-milano/core").includes("export class ShopSpacerNode {"));
    assert.ok(generateSwift(vocabulary(), "Shop").includes("public enum ShopAction {"));
  });

  it("escapes what each language reserves, and never the wire name", () => {
    const artifact = vocabulary(
      { Box: { properties: { repeat: "string", object: "int?" }, events: { default: null } } },
      { in: { parameters: { as: "string" } } },
    );
    const swift = generateSwift(artifact, "Shop");
    assert.ok(swift.includes("public var `repeat`: String { node.property(\"repeat\").stringValue! }"));
    assert.ok(swift.includes("public var object: Int64? { node.property(\"object\").intValue }"));
    assert.ok(swift.includes("case `in`(`as`: String)"));
    const kotlin = generateKotlin(artifact, "com.acme", "Px");
    assert.ok(kotlin.includes("val `object`: Long? get() = node.property(\"object\").intOrNull"));
    assert.ok(kotlin.includes("val repeat: String get() = node.property(\"repeat\").stringOrNull!!"));
    assert.ok(kotlin.includes("val `as`: String,"));
    const ts = generateTs(artifact, "Shop", "@get-milano/core");
    assert.ok(ts.includes("get repeat(): string { return this.node.property(\"repeat\").stringValue as string; }"));
    assert.ok(ts.includes('  | { readonly kind: "in"; readonly as: string }'));
  });

  it("an unknown descriptor kind falls back to the raw value in every position", () => {
    const artifact = vocabulary(
      { Box: { properties: { color: "colour" }, events: { pick: "colour" } } },
      { paint: { parameters: { shade: "colour" } } },
    );
    const swift = generateSwift(artifact, "Shop");
    assert.ok(swift.includes("public var color: MilanoValue { node.property(\"color\") }"));
    assert.ok(swift.includes("public func emitPick(_ payload: MilanoValue) { node.emit(\"pick\", payload: payload) }"));
    assert.ok(swift.includes("case paint(shade: MilanoValue)"));
    const kotlin = generateKotlin(artifact, "com.acme", "");
    assert.ok(kotlin.includes("val color: MilanoValue get() = node.property(\"color\")"));
    assert.ok(kotlin.includes("fun emitPick(payload: MilanoValue) = node.emit(\"pick\", payload)"));
    assert.ok(kotlin.includes("val shade: MilanoValue,"));
    const ts = generateTs(artifact, "Shop", "@get-milano/core");
    assert.ok(ts.includes("get color(): MilanoValue { return this.node.property(\"color\"); }"));
    assert.ok(ts.includes("emitPick(payload: MilanoValue): void { this.node.emit(\"pick\", payload); }"));
    assert.ok(ts.includes('| { readonly kind: "paint"; readonly shade: MilanoValue }'));
  });

  it("names the result an action completes with, structured ones stably", () => {
    const artifact = vocabulary({}, {
      fetch: { result: { record: { b: "int", a: "string" } } },
      ping: { result: "string" },
      fire: {},
    });
    const swift = generateSwift(artifact, "Shop");
    assert.ok(swift.includes('/// The handler completes it with a `{"record": {"a": "string", "b": "int"}}` result'));
    assert.ok(swift.includes("/// The handler completes it with a `string` result, bound to `result` in onSuccess.\n    case ping"));
    assert.ok(swift.includes("\n    case fire\n"));
  });

  it("names the failure payload an action fails with, and types its sites", () => {
    const artifact = vocabulary({}, {
      submit: { failure: { enum: ["rejected", "offline"] } },
      order: { result: "string", failure: { record: { code: "int" } } },
    });
    const swift = generateSwift(artifact, "Shop");
    assert.ok(swift.includes("public enum ShopSubmitFailure: String {"));
    assert.ok(swift.includes("public struct ShopOrderFailure {"));
    // The failure note is longer than a doc line allows, so it wraps: the
    // generated files are linted, and an unwrapped comment trips the
    // line-length rule.
    assert.ok(
      swift.includes(
        "    /// The handler completes it with a `string` result, bound to `result` in onSuccess.\n" +
          "    /// The handler fails it with a `{\"record\": {\"code\": \"int\"}}` payload (a MilanoActionFailure), bound to\n" +
          "    /// `failure` in onFailure.\n" +
          "    case order",
      ),
    );
    const kotlin = generateKotlin(artifact, "com.example.shop", "");
    assert.ok(kotlin.includes("enum class SubmitFailure("));
    assert.ok(kotlin.includes("bound to `failure` in onFailure"));
    const ts = generateTs(artifact, "Shop", "@get-milano/core");
    assert.ok(ts.includes('export type ShopSubmitFailure = "offline" | "rejected";'));
    assert.ok(ts.includes("bound to `failure` in onFailure"));
  });

  it("refuses enum members that collide when capitalized", () => {
    const artifact = vocabulary({ Box: { properties: { tone: { enum: ["warm", "Warm"] } } } });
    assert.throws(
      () => generateSwift(artifact, "Shop"),
      (error: unknown) =>
        error instanceof BindingError &&
        error.message === "enum at ('property', 'Box', 'tone') has members that collide when capitalized; rename them",
    );
  });

  it("nests records and arrays into one type per site, in every language", () => {
    const artifact = vocabulary({
      Cart: {
        properties: { lines: { array: { record: { sku: "string", tags: { array: { array: "int?" } } } } } },
        events: { changed: { record: { owner: { record: { name: "string" } }, count: "int" }, optional: true } },
      },
    });
    const swift = generateSwift(artifact, "Shop");
    assert.ok(swift.includes("public struct ShopCartLinesItem {"));
    assert.ok(swift.includes("public var tags: [[Int64?]] {"));
    assert.ok(swift.includes("public struct ShopCartChangedPayloadOwner {"));
    assert.ok(swift.includes("public func emitChanged(_ payload: ShopCartChangedPayload?) {"));
    const kotlin = generateKotlin(artifact, "com.acme", "");
    assert.ok(kotlin.includes("class CartLinesItem("));
    // Long enough to be wrapped: the accessor's type and its body split.
    assert.ok(kotlin.includes("val tags: List<List<Long?>>\n        get() ="));
    assert.ok(kotlin.includes("item -> item.arrayOrNull!!.map { item1 -> item1.intOrNull }"));
    const ts = generateTs(artifact, "Shop", "@get-milano/core");
    assert.ok(ts.includes("export class ShopCartLinesItem {"));
    assert.ok(ts.includes("get tags(): readonly (readonly (bigint | null)[])[] {"));
    assert.ok(ts.includes("emitChanged(payload: ShopCartChangedPayload | null): void {"));
  });

  it("defaults the prefix to the capitalized vocabulary name", () => {
    assert.equal(defaultPrefix(vocabulary()), "Shop");
    assert.ok(generateTs(vocabulary(), defaultPrefix(vocabulary()), "@get-milano/core").includes("export type ShopAction ="));
  });
});
