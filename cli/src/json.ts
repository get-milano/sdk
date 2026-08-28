/**
 * JSON the way Python's `json` module writes it. The specs tools this
 * package ports (`generate_document_schema.py`, `vocabulary_diff.py`,
 * `generate_bindings.py`) serialize with `json.dumps`, and the port must
 * produce the same bytes: `", "` and `": "` separators when compact, `","`
 * and `": "` when indented, ASCII-only output with lowercase `\uXXXX`
 * escapes for everything else, empty containers as `[]` and `{}`, keys in
 * insertion order or sorted.
 */
export interface DumpOptions {
  /** `sort_keys=True`: object keys in sorted order. */
  readonly sortKeys?: boolean;
  /** `indent=n`: one item per line, nested `n` spaces deeper. */
  readonly indent?: number;
}

export function pythonJson(value: unknown, options: DumpOptions = {}): string {
  return render(value, options, 0);
}

function render(value: unknown, options: DumpOptions, depth: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return wrap("[", value.map((item) => render(item, options, depth + 1)), "]", options, depth);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return "{}";
    if (options.sortKeys === true) keys.sort();
    const items = keys.map((key) => `${quote(key)}: ${render(record[key], options, depth + 1)}`);
    return wrap("{", items, "}", options, depth);
  }
  throw new TypeError(`not JSON: ${typeof value}`);
}

function wrap(open: string, items: readonly string[], close: string, options: DumpOptions, depth: number): string {
  if (options.indent === undefined) return `${open}${items.join(", ")}${close}`;
  const inner = " ".repeat(options.indent * (depth + 1));
  const outer = " ".repeat(options.indent * depth);
  return `${open}\n${items.map((item) => inner + item).join(",\n")}\n${outer}${close}`;
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/** `ensure_ascii=True`: every unit outside printable ASCII is escaped. */
function quote(text: string): string {
  let out = '"';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const char = text[index] as string;
    const short = SHORT_ESCAPES[char];
    if (short !== undefined) out += short;
    else if (unit < 0x20 || unit > 0x7e) out += `\\u${unit.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}
