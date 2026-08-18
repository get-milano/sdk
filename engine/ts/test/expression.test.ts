import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseJson } from "../src/core/json.ts";
import { MilanoType } from "../src/core/type.ts";
import { MilanoValue } from "../src/core/value.ts";
import { ExprError } from "../src/expression/ast.ts";
import { ExprChecker, payloadScope } from "../src/expression/checker.ts";
import { ExprEvaluator } from "../src/expression/evaluator.ts";
import { parseExpression } from "../src/expression/parser.ts";
import type { MilanoOccurrenceKind } from "../src/engine/observer.ts";
import { specsDirectory } from "./support/specs.ts";

const evaluate = (
  source: string,
  state: Record<string, MilanoValue> = {},
  context: Record<string, MilanoValue> = {},
): { value: MilanoValue; occurrences: MilanoOccurrenceKind[] } => {
  const occurrences: MilanoOccurrenceKind[] = [];
  const value = new ExprEvaluator(state, context, null, null, (kind) =>
    occurrences.push(kind),
  ).evaluate(parseExpression(source));
  return { value, occurrences };
};

const infer = (
  source: string,
  state: Record<string, MilanoType> = {},
  context: Record<string, MilanoType> = {},
  expecting: MilanoType | null = null,
): MilanoType | null =>
  new ExprChecker(state, context).infer(parseExpression(source), expecting);

describe("the numeric conformance suite, evaluated directly", () => {
  it("reproduces every generated numeric expectation", () => {
    const suite = join(specsDirectory(), "conformance", "generated-numeric");
    const files = readdirSync(suite)
      .filter((name) => name.endsWith(".json") && name !== "vocabulary.json")
      .sort();
    assert.ok(files.length >= 150, `expected the generated suite, found ${files.length}`);

    for (const file of files) {
      const vector = parseJson(readFileSync(join(suite, file), "utf8"))
        .recordValue as Record<string, MilanoValue>;
      const document = vector["document"]?.recordValue as Record<string, MilanoValue>;
      const root = document["root"]?.recordValue as Record<string, MilanoValue>;
      const properties = root["properties"]?.recordValue as Record<string, MilanoValue>;
      const source = (properties["text"]?.recordValue as Record<string, MilanoValue>)["$expr"]
        ?.stringValue as string;

      const expectView = (vector["expect"]?.recordValue as Record<string, MilanoValue>)["view"]
        ?.recordValue as Record<string, MilanoValue>;
      const expected = (expectView["properties"]?.recordValue as Record<string, MilanoValue>)[
        "text"
      ]?.stringValue as string;

      const expectedOccurrences = (
        (vector["expect"]?.recordValue as Record<string, MilanoValue>)["occurrences"]
          ?.arrayValue ?? []
      ).map(
        (occurrence) =>
          (occurrence.recordValue as Record<string, MilanoValue>)["kind"]?.stringValue as string,
      );

      const parsed = parseExpression(source);
      // Every generated vector types as a string property.
      const inferred = new ExprChecker({}, {}).infer(parsed, MilanoType.string());
      assert.ok(
        new ExprChecker({}, {}).accepts(MilanoType.string(), inferred),
        `${file}: ${source} does not type as a string`,
      );

      const { value, occurrences } = evaluate(source);
      assert.equal(value.stringValue, expected, `${file}: ${source}`);
      assert.deepEqual(occurrences, expectedOccurrences, `${file}: occurrences for ${source}`);
    }
  });
});

describe("expression typing", () => {
  it("resolves declared roots and rejects everything else", () => {
    const state = { count: MilanoType.int() };
    assert.equal(infer("state.count", state)?.name, "int");
    assert.throws(() => infer("state.missing", state), ExprError);
    assert.throws(() => infer("state", state), ExprError);
    assert.throws(() => infer("context", {}, {}), ExprError);
    assert.throws(() => infer("nope", {}), ExprError);
  });

  it("scopes event and result to their bindings", () => {
    const checker = new ExprChecker({}, {}, payloadScope(MilanoType.string()));
    assert.equal(checker.infer(parseExpression("event"))?.name, "string");
    assert.throws(() => checker.infer(parseExpression("result")), ExprError);
  });

  it("refines string literals in enum positions and rejects non-members", () => {
    const tone = MilanoType.enumeration(["info", "warning"]);
    assert.equal(infer("'info'", {}, {}, tone)?.name, "enum");
    assert.throws(() => infer("'loud'", {}, {}, tone), ExprError);
    // Outside an enum position a string literal stays a string.
    assert.equal(infer("'info'")?.name, "string");
  });

  it("applies the enum comparison rules", () => {
    const state = {
      tone: MilanoType.enumeration(["info", "warning"]),
      size: MilanoType.enumeration(["small"]),
      text: MilanoType.string(),
    };
    assert.equal(infer("state.tone == 'info'", state)?.name, "bool");
    assert.throws(() => infer("state.tone == 'loud'", state), ExprError);
    assert.throws(() => infer("state.tone == state.size", state), ExprError);
    assert.equal(infer("state.tone == state.text", state)?.name, "bool");
  });

  it("widens enums wherever a string is expected", () => {
    const state = { tone: MilanoType.enumeration(["info"]) };
    assert.equal(infer("concat(state.tone, '!')", state)?.name, "string");
    assert.equal(infer("str(state.tone)", state)?.name, "string");
    assert.equal(infer("length(state.tone)", state)?.name, "int");
    const checker = new ExprChecker(state, {});
    assert.ok(checker.accepts(MilanoType.string(), checker.infer(parseExpression("state.tone"))));
    assert.ok(
      !checker.accepts(
        MilanoType.enumeration(["info"]),
        checker.infer(parseExpression("'x'")),
      ),
    );
  });

  it("keeps optionals resolvable only through ??", () => {
    const state = { maybe: MilanoType.string(true) };
    assert.throws(() => infer("length(state.maybe)", state), ExprError);
    assert.equal(infer("state.maybe ?? 'x'", state)?.name, "string");
    assert.equal(infer("state.maybe == null", state)?.name, "bool");
  });

  it("makes a single null branch optional and rejects two", () => {
    assert.equal(infer("if(true, 'a', null)")?.name, "string?");
    assert.throws(() => infer("if(true, null, null)"), ExprError);
    assert.throws(() => infer("if(true, 1, 'a')"), ExprError);
  });

  it("rejects out-of-range int literals and malformed syntax", () => {
    assert.throws(() => infer("99999999999999999999"), ExprError);
    assert.throws(() => parseExpression("1 +"), ExprError);
    assert.throws(() => parseExpression("'unterminated"), ExprError);
    assert.throws(() => parseExpression("1 \n + 2"), ExprError);
    assert.throws(() => parseExpression("1.5.2"), ExprError);
    assert.throws(() => parseExpression("٥"), ExprError);
  });
});

describe("expression evaluation", () => {
  it("wraps 64-bit arithmetic instead of losing precision", () => {
    assert.equal(evaluate("9007199254740993 + 1").value.intValue, 9007199254740994n);
    assert.equal(
      evaluate("9223372036854775807 + 1").value.intValue,
      -9223372036854775808n,
    );
  });

  it("defines division and modulo by zero, and reports them", () => {
    const divided = evaluate("1 / 0");
    assert.equal(divided.value.intValue, 0n);
    assert.deepEqual(divided.occurrences, ["divisionByZero"]);
    const remainder = evaluate("1 % 0");
    assert.equal(remainder.value.intValue, 0n);
    assert.deepEqual(remainder.occurrences, ["divisionByZero"]);
    // Doubles follow IEEE instead, with no report.
    assert.equal(evaluate("1.0 / 0.0").value.doubleValue, Infinity);
    assert.deepEqual(evaluate("1.0 / 0.0").occurrences, []);
  });

  it("wraps the one quotient that leaves the range", () => {
    assert.equal(
      evaluate("(0 - 9223372036854775807 - 1) / (0 - 1)").value.intValue,
      -9223372036854775808n,
    );
    assert.equal(evaluate("(0 - 9223372036854775807 - 1) % (0 - 1)").value.intValue, 0n);
  });

  it("saturates int() and reports it", () => {
    const saturated = evaluate("int(100000000000000000000.0)");
    assert.equal(saturated.value.intValue, 9223372036854775807n);
    assert.deepEqual(saturated.occurrences, ["saturation"]);
    const nan = evaluate("int(0.0 / 0.0)");
    assert.equal(nan.value.intValue, 0n);
    assert.deepEqual(nan.occurrences, ["saturation"]);
  });

  it("evaluates only the taken branch, suppressing its guard's reports", () => {
    const guarded = evaluate("if(false, str(1 / 0), 'safe')");
    assert.equal(guarded.value.stringValue, "safe");
    assert.deepEqual(guarded.occurrences, []);
  });

  it("short-circuits && || and ??", () => {
    const state = { flag: MilanoValue.bool(false), maybe: MilanoValue.null };
    assert.equal(evaluate("state.flag && (1 / 0) == 0", state).occurrences.length, 0);
    assert.equal(evaluate("state.maybe ?? 'fallback'", state).value.stringValue, "fallback");
  });

  it("counts and trims in unicode scalars", () => {
    assert.equal(evaluate("length('😀')").value.intValue, 1n);
    assert.equal(evaluate("trim(' x ')").value.stringValue, "x");
    assert.equal(evaluate("isEmpty('')").value.boolValue, true);
  });
});
