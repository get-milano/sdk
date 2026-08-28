import { pythonJson } from "./json.ts";

/**
 * `milano diff`: the vocabulary compatibility diff, a port of the specs
 * repository's `tools/vocabulary_diff.py` producing the same lines and
 * exit status.
 *
 * Classifies every change between two vocabulary artifacts per the
 * evolution rules in the vocabulary schema spec (additive within a major;
 * anything that removes, retypes, or tightens requires a major bump) and
 * verifies the version bump matches. Semantic repurposing with unchanged
 * shape is undetectable by any tool; the spec forbids it in prose.
 */

export type Verdict = "ADDITIVE" | "BREAKING";
export type Change = readonly [Verdict, string];
type JsonObject = Record<string, unknown>;

/** `major.minor.patch` as a comparable triple; null when malformed. */
export function semver(text: unknown): readonly [number, number, number] | null {
  const parts = pyStr(text).split(".");
  if (parts.length === 3 && parts.every((part) => /^[0-9]+$/.test(part))) {
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }
  return null;
}

/** Python's `str()` of a JSON value, for messages that print one. */
function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

export function typeRepr(descriptor: unknown): string {
  return pythonJson(descriptor, { sortKeys: true });
}

export function enumMembers(descriptor: unknown): readonly [ReadonlySet<string>, boolean] | null {
  if (typeof descriptor === "object" && descriptor !== null && !Array.isArray(descriptor) && "enum" in descriptor) {
    const record = descriptor as JsonObject;
    return [new Set(record["enum"] as string[]), record["optional"] === true];
  }
  return null;
}

/**
 * Classifies one declared type moving from `old` to `next`: null when they
 * are the same type, `["ADDITIVE", gained members]` when an enum only
 * gained members, `["BREAKING", null]` for every other change. Enum member
 * additions are the one additive type change; removals and renames change
 * the type (evolution rules).
 */
export function typeChange(old: unknown, next: unknown): readonly [Verdict, readonly string[] | null] | null {
  if (typeRepr(old) === typeRepr(next)) return null;
  const before = enumMembers(old);
  const after = enumMembers(next);
  if (before !== null && after !== null && before[1] === after[1]) {
    // Enum identity is the member set, so a reordered list is the same
    // type: comparing the serialized descriptors alone would report a
    // change that is not one.
    const gained = [...after[0]].filter((member) => !before[0].has(member));
    const lost = [...before[0]].filter((member) => !after[0].has(member));
    if (gained.length === 0 && lost.length === 0) return null;
    if (lost.length === 0) return ["ADDITIVE", gained.sort()];
  }
  return ["BREAKING", null];
}

function describeChange(
  subject: string,
  old: unknown,
  next: unknown,
  change: readonly [Verdict, readonly string[] | null],
  changes: Change[],
): void {
  const [verdict, gained] = change;
  if (verdict === "ADDITIVE") {
    changes.push(["ADDITIVE", `${subject} enum gained: ${(gained ?? []).join(", ")}`]);
  } else {
    changes.push(["BREAKING", `${subject} type changed: ${typeRepr(old)} -> ${typeRepr(next)}`]);
  }
}

/** Compares name -> type-descriptor maps (properties, action parameters, event payloads). */
function diffDeclarations(kind: string, owner: string, old: JsonObject, next: JsonObject, changes: Change[]): void {
  for (const name of Object.keys(old)) {
    if (!(name in next)) {
      changes.push(["BREAKING", `${owner} ${kind} ${name} removed`]);
      continue;
    }
    const change = typeChange(old[name], next[name]);
    if (change !== null) describeChange(`${owner} ${kind} ${name}`, old[name], next[name], change, changes);
  }
  for (const name of Object.keys(next)) {
    if (!(name in old)) changes.push(["ADDITIVE", `${owner} ${kind} ${name} added`]);
  }
}

/**
 * The completion result is a declared type like any other (vocabulary
 * schema spec, Completion results): adding one is additive, since no
 * document could bind `result` before; removing or retyping it breaks
 * every document that reads `result` in that action's onSuccess; an enum
 * result may gain members.
 */
function diffResult(name: string, old: JsonObject, next: JsonObject, changes: Change[]): void {
  const before = old["result"] ?? null;
  const after = next["result"] ?? null;
  if (before === null && after === null) return;
  if (before === null) {
    changes.push(["ADDITIVE", `action ${name} result added`]);
  } else if (after === null) {
    changes.push(["BREAKING", `action ${name} result removed`]);
  } else {
    const change = typeChange(before, after);
    if (change !== null) describeChange(`action ${name} result`, before, after, change, changes);
  }
}

function declarations(owner: JsonObject, key: string): JsonObject {
  return (owner[key] ?? {}) as JsonObject;
}

/** Every change from `old` to `next`, classified, in declaration order. */
export function diff(old: JsonObject, next: JsonObject): Change[] {
  const changes: Change[] = [];

  const oldComponents = declarations(old, "components") as Record<string, JsonObject>;
  const newComponents = declarations(next, "components") as Record<string, JsonObject>;
  for (const [name, component] of Object.entries(oldComponents)) {
    const after = newComponents[name];
    if (after === undefined) {
      changes.push(["BREAKING", `component ${name} removed`]);
      continue;
    }
    diffDeclarations("property", name, declarations(component, "properties"), declarations(after, "properties"), changes);
    diffDeclarations("event", name, declarations(component, "events"), declarations(after, "events"), changes);
    const acceptedChildren = component["children"] === true;
    const acceptsChildren = after["children"] === true;
    if (acceptedChildren && !acceptsChildren) changes.push(["BREAKING", `component ${name} no longer accepts children`]);
    if (!acceptedChildren && acceptsChildren) changes.push(["ADDITIVE", `component ${name} now accepts children`]);
    const wasStrict = component["strict"] === true;
    const isStrict = after["strict"] === true;
    if (!wasStrict && isStrict) changes.push(["BREAKING", `component ${name} became strict`]);
    if (wasStrict && !isStrict) changes.push(["ADDITIVE", `component ${name} is no longer strict`]);
  }
  for (const name of Object.keys(newComponents)) {
    if (!(name in oldComponents)) changes.push(["ADDITIVE", `component ${name} added`]);
  }

  const oldActions = declarations(old, "actions") as Record<string, JsonObject>;
  const newActions = declarations(next, "actions") as Record<string, JsonObject>;
  for (const [name, action] of Object.entries(oldActions)) {
    const after = newActions[name];
    if (after === undefined) {
      changes.push(["BREAKING", `action ${name} removed`]);
    } else {
      diffDeclarations(
        "parameter",
        `action ${name}`,
        declarations(action, "parameters"),
        declarations(after, "parameters"),
        changes,
      );
      diffResult(name, action, after, changes);
    }
  }
  for (const name of Object.keys(newActions)) {
    if (!(name in oldActions)) changes.push(["ADDITIVE", `action ${name} added`]);
  }

  return changes;
}

/** What the command prints and returns. */
export interface DiffReport {
  readonly changes: readonly Change[];
  readonly problems: readonly string[];
  /** The lines for standard output, the tool's own text. */
  readonly stdout: string;
  /** The lines for standard error: one `error:` per problem. */
  readonly stderr: string;
  /** 0 when the bump matches the changes, 1 otherwise. */
  readonly status: 0 | 1;
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** The gate as CI uses it: the report `milano diff old.json new.json` prints. */
export function report(old: JsonObject, next: JsonObject): DiffReport {
  const problems: string[] = [];
  if (old["name"] !== next["name"]) {
    problems.push(`vocabulary name changed: ${pyStr(old["name"])} -> ${pyStr(next["name"])}`);
  }

  const oldVersion = semver(old["version"]);
  const newVersion = semver(next["version"]);
  if (oldVersion === null || newVersion === null) {
    problems.push("both artifacts must carry a major.minor.patch version");
  }

  const changes = diff(old, next);
  let stdout = "";
  for (const [verdict, message] of changes) stdout += `${verdict.padEnd(9)} ${message}\n`;

  const breaking = changes.filter(([verdict]) => verdict === "BREAKING").length;
  const additive = changes.filter(([verdict]) => verdict === "ADDITIVE").length;
  const bump = `${pyStr(old["version"])} -> ${pyStr(next["version"])}`;

  if (oldVersion !== null && newVersion !== null) {
    if (compare(newVersion, oldVersion) <= 0 && (breaking > 0 || additive > 0)) {
      problems.push(`version did not increase: ${bump}`);
    }
    if (breaking > 0 && newVersion[0] <= oldVersion[0]) {
      problems.push(`${breaking} breaking change(s) require a MAJOR bump; got ${bump}`);
    }
    if (additive > 0 && breaking === 0 && compare(newVersion.slice(0, 2), oldVersion.slice(0, 2)) <= 0) {
      problems.push(`${additive} additive change(s) require at least a MINOR bump; got ${bump}`);
    }
  }

  if (changes.length === 0) stdout += "no declaration changes\n";
  if (problems.length > 0) {
    stdout += "\n";
    return { changes, problems, stdout, stderr: problems.map((problem) => `error: ${problem}\n`).join(""), status: 1 };
  }
  stdout += `verdict: ok (${breaking} breaking, ${additive} additive)\n`;
  return { changes, problems, stdout, stderr: "", status: 0 };
}
