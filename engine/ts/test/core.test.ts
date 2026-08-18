import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseJson, MilanoJsonError } from "../src/core/json.ts";
import { MilanoType } from "../src/core/type.ts";
import { MilanoValue } from "../src/core/value.ts";
import {
  formatDouble,
  trimScalars,
  unicodeScalarCount,
  utf8ByteLength,
} from "../src/core/text.ts";

describe("JSON parsing", () => {
  it("keeps the int and double distinction JSON.parse destroys", () => {
    const value = parseJson('{"a": 5.0, "b": 5, "c": 5e0}');
    const record = value.recordValue as Record<string, MilanoValue>;
    assert.equal(record["a"]?.kind, "double");
    assert.equal(record["b"]?.kind, "int");
    assert.equal(record["c"]?.kind, "double");
    assert.equal(record["b"]?.intValue, 5n);
  });

  it("carries the full 64-bit range exactly", () => {
    assert.equal(parseJson("9223372036854775807").intValue, 9223372036854775807n);
    assert.equal(parseJson("-9223372036854775808").intValue, -9223372036854775808n);
  });

  it("falls back to double for integers beyond the range", () => {
    const beyond = parseJson("9223372036854775808");
    assert.equal(beyond.kind, "double");
  });

  it("reads containers, strings, escapes, and literals", () => {
    const value = parseJson('{"s": "a\\"b\\\\c\\n\\u00e9", "l": [true, false, null]}');
    const record = value.recordValue as Record<string, MilanoValue>;
    assert.equal(record["s"]?.stringValue, 'a"b\\c\né');
    const list = record["l"]?.arrayValue as readonly MilanoValue[];
    assert.deepEqual(
      list.map((item) => item.kind),
      ["bool", "bool", "null"],
    );
  });

  it("keeps the last value for a repeated member name", () => {
    const record = parseJson('{"a": 1, "a": 2}').recordValue as Record<string, MilanoValue>;
    assert.equal(record["a"]?.intValue, 2n);
  });

  it("rejects malformed input", () => {
    const invalid = [
      "",
      "{",
      '{"a": 1,}',
      "[1 2]",
      "01",
      ".5",
      "5.",
      "+5",
      '"unterminated',
      '""',
      '"\\x"',
      "{} trailing",
      "tru",
    ];
    for (const text of invalid) {
      assert.throws(() => parseJson(text), MilanoJsonError, `expected a rejection for ${text}`);
    }
  });
});

describe("double formatting", () => {
  it("matches the conformance suite's expectations", () => {
    // Ground truth taken from conformance/generated-numeric.
    assert.equal(formatDouble(9223372036854775808), "9.223372036854776e18");
    assert.equal(formatDouble(-97), "-97.0");
    assert.equal(formatDouble(0), "0.0");
  });

  it("renders non-finite values by name", () => {
    assert.equal(formatDouble(Number.NaN), "nan");
    assert.equal(formatDouble(Infinity), "inf");
    assert.equal(formatDouble(-Infinity), "-inf");
    assert.equal(formatDouble(-0), "-0.0");
  });

  it("switches to scientific notation outside the plain range", () => {
    assert.equal(formatDouble(1e15), "1000000000000000.0");
    assert.equal(formatDouble(1e16), "1e16");
    assert.equal(formatDouble(0.0001), "0.0001");
    assert.equal(formatDouble(0.00001), "1e-5");
    assert.equal(formatDouble(1.5e300), "1.5e300");
    assert.equal(formatDouble(-2.5e-9), "-2.5e-9");
  });

  it("keeps one fractional digit for integral values", () => {
    assert.equal(formatDouble(5), "5.0");
    assert.equal(formatDouble(0.1), "0.1");
    assert.equal(formatDouble(9007199254740992), "9007199254740992.0");
  });
});

describe("text semantics", () => {
  it("counts unicode scalars, not UTF-16 units", () => {
    assert.equal(unicodeScalarCount("😀"), 1);
    assert.equal("😀".length, 2);
    assert.equal(unicodeScalarCount("é"), 2);
    assert.equal(unicodeScalarCount(""), 0);
  });

  it("trims exactly the White_Space table", () => {
    assert.equal(trimScalars(" x "), "x");
    assert.equal(trimScalars("x"), "x");
    assert.equal(trimScalars("　 x \t"), "x");
    // Not in the table: a zero-width space is content, not whitespace.
    assert.equal(trimScalars("​x"), "​x");
  });

  it("measures UTF-8 bytes without a platform encoder", () => {
    assert.equal(utf8ByteLength("abc"), 3);
    assert.equal(utf8ByteLength("é"), 2);
    assert.equal(utf8ByteLength("€"), 3);
    assert.equal(utf8ByteLength("😀"), 4);
  });
});

describe("type descriptors", () => {
  const descriptor = (text: string): MilanoType | null =>
    MilanoType.fromDescriptor(parseJson(text));

  it("parses every form", () => {
    assert.equal(descriptor('"int"')?.name, "int");
    assert.equal(descriptor('"string?"')?.name, "string?");
    assert.equal(descriptor('{"array": "int"}')?.name, "array");
    assert.equal(descriptor('{"record": {"a": "bool"}}')?.name, "record");
    assert.equal(descriptor('{"enum": ["a", "b"], "optional": true}')?.name, "enum?");
  });

  it("rejects invalid descriptors", () => {
    const invalid = [
      '"float"',
      '"int??"',
      "5",
      '{"enum": []}',
      '{"enum": ["a", "a"]}',
      '{"enum": ["with-dash"]}',
      '{"enum": [1]}',
      '{"enum": ["a"], "extra": 1}',
      '{"array": "int", "extra": 1}',
      '{"record": {"1bad": "int"}}',
    ];
    for (const text of invalid) {
      assert.equal(descriptor(text), null, `expected a rejection for ${text}`);
    }
  });

  it("compares enums by member set, not order", () => {
    const first = descriptor('{"enum": ["a", "b"]}') as MilanoType;
    const second = descriptor('{"enum": ["b", "a"]}') as MilanoType;
    assert.ok(first.equals(second));
    assert.ok(!first.equals(descriptor('{"enum": ["a"]}') as MilanoType));
  });
});

describe("value validation", () => {
  it("promotes int to double but never the reverse", () => {
    const promoted = MilanoType.double().validated(MilanoValue.int(3n));
    assert.equal(promoted?.kind, "double");
    assert.equal(promoted?.doubleValue, 3);
    assert.equal(MilanoType.int().validated(MilanoValue.double(3)), null);
  });

  it("accepts null only for optional types", () => {
    assert.equal(MilanoType.string(true).validated(MilanoValue.null)?.kind, "null");
    assert.equal(MilanoType.string().validated(MilanoValue.null), null);
  });

  it("enforces enum membership", () => {
    const tone = MilanoType.enumeration(["info", "warning"]);
    assert.equal(tone.validated(MilanoValue.string("info"))?.stringValue, "info");
    assert.equal(tone.validated(MilanoValue.string("loud")), null);
    assert.equal(tone.validated(MilanoValue.int(1n)), null);
  });

  it("validates records strictly and canonicalizes optionals", () => {
    const shape = MilanoType.record({ a: MilanoType.int(), b: MilanoType.string(true) });
    const canonical = shape.validated(MilanoValue.record({ a: MilanoValue.int(1n) }));
    assert.equal(canonical?.recordValue?.["b"]?.kind, "null");
    assert.equal(
      shape.validated(MilanoValue.record({ a: MilanoValue.int(1n), extra: MilanoValue.bool(true) })),
      null,
    );
    assert.equal(shape.validated(MilanoValue.record({ b: MilanoValue.string("x") })), null);
  });

  it("validates array elements", () => {
    const list = MilanoType.array(MilanoType.double());
    const canonical = list.validated(
      MilanoValue.array([MilanoValue.int(1n), MilanoValue.double(2.5)]),
    );
    assert.deepEqual(canonical?.arrayValue?.map((item) => item.kind), ["double", "double"]);
    assert.equal(list.validated(MilanoValue.array([MilanoValue.string("x")])), null);
  });
});

describe("values", () => {
  it("wraps ints into the 64-bit range by construction", () => {
    assert.equal(MilanoValue.int(2n ** 63n).intValue, -(2n ** 63n));
    assert.equal(MilanoValue.int(7).intValue, 7n);
  });

  it("compares structurally", () => {
    assert.ok(MilanoValue.record({ a: MilanoValue.array([MilanoValue.int(1n)]) })
      .equals(MilanoValue.record({ a: MilanoValue.array([MilanoValue.int(1n)]) })));
    assert.ok(!MilanoValue.int(1n).equals(MilanoValue.double(1)));
  });

  it("offers a number reader for the ordinary case", () => {
    assert.equal(MilanoValue.int(42n).numberValue, 42);
    assert.equal(MilanoValue.double(1.5).numberValue, 1.5);
    assert.equal(MilanoValue.string("x").numberValue, null);
  });
});
