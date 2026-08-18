import { formatDouble } from "../../src/core/text.ts";
import type { MilanoValue } from "../../src/core/value.ts";

/**
 * Serializes a value back to JSON text with the int and double
 * distinction intact: ints print as bare integers, doubles always carry a
 * fractional part or an exponent, so re-parsing recovers the same types.
 * The conformance vectors embed documents as JSON objects, and this is how
 * one becomes document text without collapsing 5.0 into 5.
 */
export function stringifyMilanoValue(value: MilanoValue): string {
  switch (value.kind) {
    case "null":
      return "null";
    case "bool":
      return value.boolValue === true ? "true" : "false";
    case "int":
      return String(value.intValue);
    case "double": {
      const text = formatDouble(value.doubleValue as number);
      // Non-finite values cannot appear in a document literal.
      if (text === "nan" || text === "inf" || text === "-inf") {
        throw new Error(`non-finite double cannot be written as JSON: ${text}`);
      }
      return text;
    }
    case "string":
      return JSON.stringify(value.stringValue);
    case "array":
      return `[${(value.arrayValue as readonly MilanoValue[])
        .map(stringifyMilanoValue)
        .join(",")}]`;
    case "record": {
      const entries = Object.entries(
        value.recordValue as Record<string, MilanoValue>,
      ).map(([key, item]) => `${JSON.stringify(key)}:${stringifyMilanoValue(item)}`);
      return `{${entries.join(",")}}`;
    }
  }
}
