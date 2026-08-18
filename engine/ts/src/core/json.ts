import { emptyRecord } from "./lookup.ts";
import { MilanoValue } from "./value.ts";

/**
 * JSON parsing, written by hand because `JSON.parse` cannot express the
 * contract: it collapses `5.0` into `5`, destroying the int/double
 * distinction the type system depends on (a JSON number with a fractional
 * part never satisfies an `int` declaration, and `str(5.0)` is `"5.0"`
 * while `str(5)` is `"5"`).
 *
 * A number written without a fractional part or exponent becomes `int`
 * when it fits the 64-bit range, and `double` otherwise; anything written
 * with a fractional part or an exponent is always `double`.
 */
export class MilanoJsonError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} at position ${position}`);
    this.name = "MilanoJsonError";
    this.position = position;
  }
}

/**
 * How deep the scanner will recurse. Nesting is checked properly by the
 * gate against `maxTreeDepth`, but that check runs after parsing, and a
 * runaway recursion here would be a stack overflow rather than a typed
 * error. This bound is far above any real document and far below the
 * engine's stack.
 */
const MAX_NESTING = 512;

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

const CODE_TAB = 0x09;
const CODE_NEWLINE = 0x0a;
const CODE_RETURN = 0x0d;
const CODE_SPACE = 0x20;
const CODE_QUOTE = 0x22;
const CODE_PLUS = 0x2b;
const CODE_COMMA = 0x2c;
const CODE_MINUS = 0x2d;
const CODE_DOT = 0x2e;
const CODE_ZERO = 0x30;
const CODE_NINE = 0x39;
const CODE_COLON = 0x3a;
const CODE_BACKSLASH = 0x5c;
const CODE_OPEN_BRACKET = 0x5b;
const CODE_CLOSE_BRACKET = 0x5d;
const CODE_OPEN_BRACE = 0x7b;
const CODE_CLOSE_BRACE = 0x7d;
const CODE_LOWER_E = 0x65;
const CODE_UPPER_E = 0x45;

class Scanner {
  private readonly text: string;
  private index: number;
  private depth: number;

  constructor(text: string) {
    this.text = text;
    this.index = 0;
    this.depth = 0;
  }

  parseDocument(): MilanoValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new MilanoJsonError("unexpected trailing content", this.index);
    }
    return value;
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (
        code === CODE_SPACE ||
        code === CODE_TAB ||
        code === CODE_NEWLINE ||
        code === CODE_RETURN
      ) {
        this.index += 1;
      } else {
        return;
      }
    }
  }

  private parseValue(): MilanoValue {
    if (this.index >= this.text.length) {
      throw new MilanoJsonError("unexpected end of input", this.index);
    }
    const code = this.text.charCodeAt(this.index);
    switch (code) {
      case CODE_OPEN_BRACE:
        return this.parseObject();
      case CODE_OPEN_BRACKET:
        return this.parseArray();
      case CODE_QUOTE:
        return MilanoValue.string(this.parseString());
      default:
        break;
    }
    if (code === CODE_MINUS || (code >= CODE_ZERO && code <= CODE_NINE)) {
      return this.parseNumber();
    }
    if (this.text.startsWith("true", this.index)) {
      this.index += 4;
      return MilanoValue.bool(true);
    }
    if (this.text.startsWith("false", this.index)) {
      this.index += 5;
      return MilanoValue.bool(false);
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return MilanoValue.null;
    }
    throw new MilanoJsonError("unexpected character", this.index);
  }

  private parseObject(): MilanoValue {
    this.enter();
    this.index += 1; // {
    // A prototype-free map: `__proto__` is an ordinary member name in
    // JSON, and assigning it on a plain object would invoke the prototype
    // setter and lose the member instead of storing it.
    const entries = emptyRecord<MilanoValue>();
    this.skipWhitespace();
    if (this.text.charCodeAt(this.index) === CODE_CLOSE_BRACE) {
      this.index += 1;
      this.leave();
      return MilanoValue.record(entries);
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text.charCodeAt(this.index) !== CODE_QUOTE) {
        throw new MilanoJsonError("expected a member name", this.index);
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.text.charCodeAt(this.index) !== CODE_COLON) {
        throw new MilanoJsonError("expected ':'", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
      // A repeated name keeps the last value, as every JSON reader the
      // other runtimes use does.
      entries[key] = this.parseValue();
      this.skipWhitespace();
      const code = this.text.charCodeAt(this.index);
      if (code === CODE_COMMA) {
        this.index += 1;
        continue;
      }
      if (code === CODE_CLOSE_BRACE) {
        this.index += 1;
        this.leave();
        return MilanoValue.record(entries);
      }
      throw new MilanoJsonError("expected ',' or '}'", this.index);
    }
  }

  private parseArray(): MilanoValue {
    this.enter();
    this.index += 1; // [
    const items: MilanoValue[] = [];
    this.skipWhitespace();
    if (this.text.charCodeAt(this.index) === CODE_CLOSE_BRACKET) {
      this.index += 1;
      this.leave();
      return MilanoValue.array(items);
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue());
      this.skipWhitespace();
      const code = this.text.charCodeAt(this.index);
      if (code === CODE_COMMA) {
        this.index += 1;
        continue;
      }
      if (code === CODE_CLOSE_BRACKET) {
        this.index += 1;
        this.leave();
        return MilanoValue.array(items);
      }
      throw new MilanoJsonError("expected ',' or ']'", this.index);
    }
  }

  private parseString(): string {
    this.index += 1; // opening quote
    let result = "";
    for (;;) {
      if (this.index >= this.text.length) {
        throw new MilanoJsonError("unterminated string", this.index);
      }
      const code = this.text.charCodeAt(this.index);
      if (code === CODE_QUOTE) {
        this.index += 1;
        return result;
      }
      if (code === CODE_BACKSLASH) {
        this.index += 1;
        result += this.parseEscape();
        continue;
      }
      if (code < CODE_SPACE) {
        throw new MilanoJsonError("unescaped control character in string", this.index);
      }
      result += this.text[this.index] as string;
      this.index += 1;
    }
  }

  private parseEscape(): string {
    if (this.index >= this.text.length) {
      throw new MilanoJsonError("unterminated escape", this.index);
    }
    const character = this.text[this.index] as string;
    this.index += 1;
    switch (character) {
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const hex = this.text.slice(this.index, this.index + 4);
        if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new MilanoJsonError("invalid unicode escape", this.index);
        }
        this.index += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        throw new MilanoJsonError("invalid escape", this.index - 1);
    }
  }

  private parseNumber(): MilanoValue {
    const start = this.index;
    if (this.text.charCodeAt(this.index) === CODE_MINUS) this.index += 1;

    // Integer part: a lone zero, or a non-zero digit followed by digits.
    if (this.text.charCodeAt(this.index) === CODE_ZERO) {
      this.index += 1;
    } else if (this.isDigit(this.text.charCodeAt(this.index))) {
      while (this.isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    } else {
      throw new MilanoJsonError("expected a digit", this.index);
    }

    let fractional = false;
    if (this.text.charCodeAt(this.index) === CODE_DOT) {
      fractional = true;
      this.index += 1;
      if (!this.isDigit(this.text.charCodeAt(this.index))) {
        throw new MilanoJsonError("expected a digit after '.'", this.index);
      }
      while (this.isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }

    const exponentCode = this.text.charCodeAt(this.index);
    if (exponentCode === CODE_LOWER_E || exponentCode === CODE_UPPER_E) {
      fractional = true;
      this.index += 1;
      const signCode = this.text.charCodeAt(this.index);
      if (signCode === CODE_PLUS || signCode === CODE_MINUS) this.index += 1;
      if (!this.isDigit(this.text.charCodeAt(this.index))) {
        throw new MilanoJsonError("expected a digit in the exponent", this.index);
      }
      while (this.isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }

    const raw = this.text.slice(start, this.index);
    if (!fractional) {
      const wide = BigInt(raw);
      // Written as an integer but beyond the 64-bit range: a double, the
      // same fallback the other runtimes make.
      if (wide >= INT_MIN && wide <= INT_MAX) return MilanoValue.int(wide);
    }
    return MilanoValue.double(Number(raw));
  }

  private isDigit(code: number): boolean {
    return code >= CODE_ZERO && code <= CODE_NINE;
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_NESTING) {
      throw new MilanoJsonError("nesting too deep", this.index);
    }
  }

  private leave(): void {
    this.depth -= 1;
  }
}

/** Parses JSON text into a `MilanoValue`; throws `MilanoJsonError`. */
export function parseJson(text: string): MilanoValue {
  return new Scanner(text).parseDocument();
}
