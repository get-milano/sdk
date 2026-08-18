import { ExprError } from "./ast.ts";

export type Token =
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "double"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "punct"; readonly value: string }
  | { readonly kind: "end" };

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

const TWO_CHARACTER = new Set(["??", "||", "&&", "==", "!=", "<=", ">="]);
const ONE_CHARACTER = new Set([
  "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ".", ",",
]);

/** ASCII only: the grammar's letters and digits are not Unicode-wide. */
function isLetter(character: string): boolean {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * Tokenizes an expression. Whitespace between tokens is spaces and tabs
 * only: a newline inside an expression is an error, not formatting.
 */
export function tokenize(source: string): Token[] {
  // Scalars, so a non-BMP character is one unit of input and positions
  // never split a surrogate pair.
  const scalars = Array.from(source);
  const tokens: Token[] = [];
  let position = 0;

  const peek = (offset = 0): string | undefined => scalars[position + offset];

  for (;;) {
    while (position < scalars.length && (peek() === " " || peek() === "\t")) {
      position += 1;
    }
    if (position >= scalars.length) {
      tokens.push({ kind: "end" });
      return tokens;
    }

    const character = peek() as string;

    if (isLetter(character)) {
      let name = "";
      while (position < scalars.length) {
        const next = peek() as string;
        if (!isLetter(next) && !isDigit(next) && next !== "_") break;
        name += next;
        position += 1;
      }
      tokens.push({ kind: "identifier", value: name });
      continue;
    }

    if (isDigit(character)) {
      let text = "";
      while (position < scalars.length && isDigit(peek() as string)) {
        text += peek() as string;
        position += 1;
      }
      // A decimal point makes a double, but only when digits follow it:
      // there is no trailing-dot form.
      const afterDot = peek(1);
      if (peek() === "." && afterDot !== undefined && isDigit(afterDot)) {
        text += ".";
        position += 1;
        while (position < scalars.length && isDigit(peek() as string)) {
          text += peek() as string;
          position += 1;
        }
        tokens.push({ kind: "double", value: Number(text) });
        continue;
      }
      const value = BigInt(text);
      if (value < INT_MIN || value > INT_MAX) {
        throw new ExprError("int literal out of 64-bit range");
      }
      tokens.push({ kind: "int", value });
      continue;
    }

    if (character === "'") {
      position += 1;
      let text = "";
      for (;;) {
        if (position >= scalars.length) throw new ExprError("unterminated string");
        const next = peek() as string;
        if (next === "'") {
          position += 1;
          break;
        }
        if (next === "\\") {
          const escaped = peek(1);
          if (escaped !== "'" && escaped !== "\\") throw new ExprError("bad escape");
          text += escaped;
          position += 2;
          continue;
        }
        text += next;
        position += 1;
      }
      tokens.push({ kind: "string", value: text });
      continue;
    }

    const pair = character + (peek(1) ?? "");
    if (TWO_CHARACTER.has(pair)) {
      tokens.push({ kind: "punct", value: pair });
      position += 2;
      continue;
    }
    if (ONE_CHARACTER.has(character)) {
      tokens.push({ kind: "punct", value: character });
      position += 1;
      continue;
    }
    throw new ExprError(`unexpected character '${character}'`);
  }
}
