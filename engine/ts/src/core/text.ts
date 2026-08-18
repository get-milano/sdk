/**
 * Text and number formatting fixed by the expression language spec, never
 * the platform default: two runtimes must agree to the bit, so nothing
 * here delegates to JavaScript's locale-aware or UTF-16-shaped helpers.
 */

/** The Unicode White_Space table, shared verbatim by every runtime. */
const WHITE_SPACE: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

export function isWhitespaceScalar(scalar: number): boolean {
  return WHITE_SPACE.has(scalar);
}

/**
 * Unicode scalar count: `length()` and the expression-length limit are
 * defined in scalars, never UTF-16 code units. Iteration yields code
 * points, so a surrogate pair counts once and a lone surrogate counts as
 * the one scalar it is.
 */
export function unicodeScalarCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** Removes exactly the White_Space scalars above, from both ends. */
export function trimScalars(text: string): string {
  const scalars = Array.from(text);
  let start = 0;
  let end = scalars.length;
  while (start < end && isWhitespaceScalar((scalars[start] as string).codePointAt(0) as number)) {
    start += 1;
  }
  while (end > start && isWhitespaceScalar((scalars[end - 1] as string).codePointAt(0) as number)) {
    end -= 1;
  }
  return scalars.slice(start, end).join("");
}

/**
 * The Milano double format. Non-finite values are `nan`, `inf`, `-inf`.
 * Finite values use the shortest round-trip digits, rendered as plain
 * decimal (integral values keeping one fractional digit) while the
 * normalized exponent is within [-4, 15], and otherwise as scientific
 * `d[.ddd]e[-]NN`: lowercase `e`, no plus sign, no zero padding.
 *
 * JavaScript's own `toString` is shortest round-trip, so it supplies the
 * digits; everything about their presentation is re-derived here.
 */
export function formatDouble(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";

  const negative = value < 0;
  let repr = Math.abs(value).toString();
  let exponent10 = 0;

  const exponentIndex = repr.search(/[eE]/);
  if (exponentIndex >= 0) {
    exponent10 = Number.parseInt(repr.slice(exponentIndex + 1).replace("+", ""), 10);
    repr = repr.slice(0, exponentIndex);
  }

  let digits = repr;
  const dotIndex = repr.indexOf(".");
  if (dotIndex >= 0) {
    exponent10 -= repr.length - dotIndex - 1;
    digits = repr.replace(".", "");
  }

  // digits is now an integer string: value = digits * 10^exponent10.
  digits = digits.replace(/^0+/, "");
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent10 += 1;
  }

  const normalizedExponent = exponent10 + digits.length - 1;
  const sign = negative ? "-" : "";

  if (normalizedExponent >= -4 && normalizedExponent <= 15) {
    if (exponent10 >= 0) {
      return `${sign}${digits}${"0".repeat(exponent10)}.0`;
    }
    const fractionDigits = -exponent10;
    if (fractionDigits < digits.length) {
      const split = digits.length - fractionDigits;
      return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
    }
    return `${sign}0.${"0".repeat(fractionDigits - digits.length)}${digits}`;
  }

  const head = digits.slice(0, 1);
  const tail = digits.slice(1);
  const mantissa = tail.length === 0 ? head : `${head}.${tail}`;
  return `${sign}${mantissa}e${normalizedExponent}`;
}

/**
 * The UTF-8 byte length of a string, computed without a platform encoder
 * so the document-size limit means the same thing everywhere.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const scalar = character.codePointAt(0) as number;
    if (scalar < 0x80) bytes += 1;
    else if (scalar < 0x800) bytes += 2;
    else if (scalar < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
