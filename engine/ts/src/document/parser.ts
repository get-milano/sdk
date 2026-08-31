import { emptyRecord } from "../core/lookup.ts";
import { isValidIdentifier } from "../core/identifier.ts";
import { MilanoJsonError, parseJson } from "../core/json.ts";
import { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoBuildError } from "./errors.ts";
import type {
  ActionSpec,
  ArrayActionName,
  ConditionalSpec,
  DocValue,
  ParsedDocument,
  RawNode,
  RepeatSpec,
  SwitchSpec,
  VocabularyRequirement,
} from "./model.ts";
import { parseSemver } from "./model.ts";

/** Step 1 of the gate: parse. Envelope violations are MalformedDocument. */
/**
 * Object members in lexicographic key order (document model spec,
 * Validation): JSON defines no order for them, so the gate must not
 * depend on the one the text happened to use. Building every record in
 * this order once, here, is what makes every later walk deterministic.
 */
export function sortedEntries<T>(object: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(object).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function parseDocument(text: string): ParsedDocument {
  let root: Readonly<Record<string, MilanoValue>> | null;
  try {
    root = parseJson(text).recordValue;
  } catch (error) {
    if (error instanceof MilanoJsonError) {
      throw MilanoBuildError.malformedDocument("not well-formed JSON");
    }
    throw error;
  }
  if (root === null) throw MilanoBuildError.malformedDocument("document is not an object");

  const versionString = root["version"]?.stringValue;
  if (versionString === undefined || versionString === null) {
    throw MilanoBuildError.malformedDocument("missing version");
  }
  const version = parseSemver(versionString);
  if (version === null) {
    throw MilanoBuildError.malformedDocument("version is not major.minor.patch");
  }

  let vocabularyRequirement: VocabularyRequirement | null = null;
  const requirementEntry = root["vocabulary"];
  if (requirementEntry !== undefined) {
    const requirement = requirementEntry.recordValue;
    const requiredName = requirement?.["name"]?.stringValue;
    if (requirement === null || requiredName === undefined || requiredName === null || requiredName.length === 0) {
      throw MilanoBuildError.malformedDocument("vocabulary requirement needs a name");
    }
    let minimum: string | null = null;
    const minEntry = requirement["min"];
    if (minEntry !== undefined) {
      const minString = minEntry.stringValue;
      if (minString === null || parseSemver(minString) === null) {
        throw MilanoBuildError.malformedDocument("vocabulary min is not major.minor.patch");
      }
      minimum = minString;
    }
    vocabularyRequirement = { name: requiredName, min: minimum };
  }

  const contextDeclarations = declarations(root["context"], "context");
  const stateDeclarations = declarations(root["state"], "state");

  const rootNodeEntry = root["root"];
  if (rootNodeEntry === undefined) throw MilanoBuildError.malformedDocument("missing root");
  // metadata is a JSON object: hosts read it as a map.
  const metadata = root["metadata"] ?? null;
  if (metadata !== null && metadata.recordValue === null) {
    throw MilanoBuildError.malformedDocument("metadata must be an object");
  }

  // Lifecycle bindings: a map of signal name to actions, like a node's on.
  const lifecycle = emptyRecord<readonly ActionSpec[]>();
  const lifecycleEntry = root["on"];
  if (lifecycleEntry !== undefined) {
    const entries = lifecycleEntry.recordValue;
    if (entries === null) throw MilanoBuildError.malformedDocument("on is not an object");
    for (const [signal, actions] of sortedEntries(entries)) {
      lifecycle[signal] = actionList(actions, `on.${signal}`);
    }
  }

  // Watch bindings: a map of state key to actions, like a node's on.
  const watch = emptyRecord<readonly ActionSpec[]>();
  const watchEntry = root["watch"];
  if (watchEntry !== undefined) {
    const entries = watchEntry.recordValue;
    if (entries === null) throw MilanoBuildError.malformedDocument("watch is not an object");
    for (const [key, actions] of sortedEntries(entries)) {
      watch[key] = actionList(actions, `watch.${key}`);
    }
  }

  return {
    versionString,
    major: version[0],
    minor: version[1],
    vocabularyRequirement,
    contextDeclarations,
    stateDeclarations,
    root: parseNode(rootNodeEntry, "root"),
    lifecycle,
    hasLifecycle: lifecycleEntry !== undefined,
    watch,
    hasWatch: watchEntry !== undefined,
    metadata,
  };
}

function declarations(
  entry: MilanoValue | undefined,
  section: string,
): Record<string, MilanoType> {
  if (entry === undefined) return {};
  const object = entry.recordValue;
  if (object === null) throw MilanoBuildError.malformedDocument(`${section} is not an object`);
  const result = emptyRecord<MilanoType>();
  for (const [key, descriptor] of sortedEntries(object)) {
    // A key that is not an identifier and a descriptor the contract does
    // not define are different defects, and the detail says which.
    if (!isValidIdentifier(key)) {
      throw MilanoBuildError.schemaViolation(`${section}-declaration`, null, "identifier", key);
    }
    const type = MilanoType.fromDescriptor(descriptor);
    if (type === null) {
      throw MilanoBuildError.schemaViolation(
        `${section}-declaration`,
        null,
        "type descriptor",
        key,
      );
    }
    result[key] = type;
  }
  return result;
}

function parseNode(entry: MilanoValue, path: string): RawNode {
  const object = entry.recordValue;
  if (object === null) throw MilanoBuildError.malformedDocument(`${path} is not an object`);

  const type = object["type"]?.stringValue;
  if (type === undefined || type === null) {
    throw MilanoBuildError.malformedDocument(`${path} has no type`);
  }

  let id: string | null = null;
  const idEntry = object["id"];
  if (idEntry !== undefined) {
    id = idEntry.stringValue;
    if (id === null) throw MilanoBuildError.malformedDocument(`${path} id is not a string`);
    // An empty id would be an empty reference in every report about the
    // node; the envelope requires a non-empty string.
    if (id.length === 0) throw MilanoBuildError.malformedDocument(`${path} id is empty`);
  }

  const properties = emptyRecord<DocValue>();
  const propertiesEntry = object["properties"];
  if (propertiesEntry !== undefined) {
    const entries = propertiesEntry.recordValue;
    if (entries === null) {
      throw MilanoBuildError.malformedDocument(`${path} properties is not an object`);
    }
    for (const [name, value] of sortedEntries(entries)) {
      properties[name] = docValue(value, `${path}.${name}`);
    }
  }

  const children: RawNode[] = [];
  const childrenEntry = object["children"];
  if (childrenEntry !== undefined) {
    const items = childrenEntry.arrayValue;
    if (items === null) {
      throw MilanoBuildError.malformedDocument(`${path} children is not an array`);
    }
    items.forEach((child, index) => {
      children.push(parseNode(child, `${path}/children[${index}]`));
    });
  }

  const events = emptyRecord<readonly ActionSpec[]>();
  const onEntry = object["on"];
  if (onEntry !== undefined) {
    const entries = onEntry.recordValue;
    if (entries === null) throw MilanoBuildError.malformedDocument(`${path} on is not an object`);
    for (const [event, actions] of sortedEntries(entries)) {
      events[event] = actionList(actions, `${path}.on.${event}`);
    }
  }

  // The construct's own keys travel as parsed; the gate applies its rules.
  let repeat: RepeatSpec | null = null;
  if (type === "$repeat") {
    const itemsEntry = object["items"];
    const keyEntry = object["key"];
    repeat = {
      items: itemsEntry === undefined ? null : docValue(itemsEntry, `${path}.items`),
      as: object["as"]?.stringValue ?? null,
      key: keyEntry === undefined ? null : docValue(keyEntry, `${path}.key`),
    };
  }

  let conditional: ConditionalSpec | null = null;
  if (type === "$if") {
    const branch = (name: string): readonly RawNode[] | null => {
      const list = object[name];
      if (list === undefined) return null;
      const items = list.arrayValue;
      if (items === null) {
        throw MilanoBuildError.malformedDocument(`${path} ${name} is not an array`);
      }
      return items.map((child, index) => parseNode(child, `${path}/${name}[${index}]`));
    };
    const conditionEntry = object["condition"];
    const declared = new Set(["type", "condition", "then", "else"]);
    conditional = {
      condition:
        conditionEntry === undefined ? null : docValue(conditionEntry, `${path}.condition`),
      then: branch("then"),
      otherwise: branch("else"),
      undeclared: Object.keys(object).filter((key) => !declared.has(key)).sort(),
    };
  }

  let choice: SwitchSpec | null = null;
  if (type === "$switch") {
    const nodeList = (value: MilanoValue, where: string): readonly RawNode[] => {
      const items = value.arrayValue;
      if (items === null) {
        throw MilanoBuildError.malformedDocument(`${path} ${where} is not an array`);
      }
      return items.map((child, index) => parseNode(child, `${path}/${where}[${index}]`));
    };
    const casesEntry = object["cases"];
    let cases: Record<string, readonly RawNode[]> | null = null;
    if (casesEntry !== undefined) {
      const members = casesEntry.recordValue;
      if (members === null) {
        throw MilanoBuildError.malformedDocument(`${path} cases is not an object`);
      }
      cases = emptyRecord<readonly RawNode[]>();
      for (const [member, branch] of sortedEntries(members)) {
        cases[member] = nodeList(branch, `cases[${member}]`);
      }
    }
    const fallbackEntry = object["default"];
    const subjectEntry = object["subject"];
    const declared = new Set(["type", "subject", "cases", "default"]);
    choice = {
      subject: subjectEntry === undefined ? null : docValue(subjectEntry, `${path}.subject`),
      cases,
      fallback: fallbackEntry === undefined ? null : nodeList(fallbackEntry, "default"),
      hasFallback: fallbackEntry !== undefined,
      undeclared: Object.keys(object).filter((key) => !declared.has(key)).sort(),
    };
  }

  return { type, id, properties, children, events, repeat, conditional, choice, raw: entry };
}

/**
 * A value is dynamic only when written as the reserved single-key `$expr`
 * wrapper. An object mixing `$expr` with other keys is invalid.
 */
function docValue(entry: MilanoValue, path: string): DocValue {
  const object = entry.recordValue;
  if (object !== null && object["$expr"] !== undefined) {
    const source = object["$expr"]?.stringValue;
    if (Object.keys(object).length !== 1 || source === undefined || source === null) {
      throw MilanoBuildError.malformedDocument(`${path} invalid $expr wrapper`);
    }
    return { kind: "expression", source };
  }
  return { kind: "literal", value: entry };
}

function actionList(entry: MilanoValue, path: string): ActionSpec[] {
  const items = entry.arrayValue;
  if (items !== null) {
    return items.map((item, index) => action(item, `${path}[${index}]`));
  }
  if (entry.recordValue !== null) return [action(entry, path)];
  throw MilanoBuildError.malformedDocument(`${path} is not an action or action list`);
}

function action(entry: MilanoValue, path: string): ActionSpec {
  const object = entry.recordValue;
  if (object === null) throw MilanoBuildError.malformedDocument(`${path} is not an object`);

  const name = object["action"]?.stringValue;
  if (name === undefined || name === null) {
    throw MilanoBuildError.schemaViolation("action-encoding", null, "action key", path);
  }
  const keys = Object.keys(object);
  const only = (...allowed: readonly string[]): boolean =>
    keys.every((key) => allowed.includes(key));

  switch (name) {
    case "$set": {
      const key = object["key"]?.stringValue;
      const valueEntry = object["value"];
      if (
        !only("action", "key", "value") ||
        key === undefined ||
        key === null ||
        valueEntry === undefined
      ) {
        throw MilanoBuildError.schemaViolation(
          "action-encoding",
          null,
          "$set key and value",
          path,
        );
      }
      return { kind: "set", key, value: docValue(valueEntry, `${path}.value`) };
    }

    case "$sequence": {
      const actionsEntry = object["actions"];
      if (!only("action", "actions") || actionsEntry === undefined || actionsEntry.arrayValue === null) {
        throw MilanoBuildError.schemaViolation(
          "action-encoding",
          null,
          "$sequence actions",
          path,
        );
      }
      return { kind: "sequence", actions: actionList(actionsEntry, `${path}.actions`) };
    }

    case "$when": {
      // Both branches are optional: a $when may carry only `else`.
      const conditionEntry = object["condition"];
      if (!only("action", "condition", "then", "else") || conditionEntry === undefined) {
        throw MilanoBuildError.schemaViolation("action-encoding", null, "$when condition", path);
      }
      const thenEntry = object["then"];
      const elseEntry = object["else"];
      return {
        kind: "when",
        condition: docValue(conditionEntry, `${path}.condition`),
        then: thenEntry === undefined ? [] : actionList(thenEntry, `${path}.then`),
        otherwise: elseEntry === undefined ? [] : actionList(elseEntry, `${path}.else`),
      };
    }

    case "$append":
    case "$remove":
    case "$update": {
      // The parameters travel as carried; the gate applies the encoding
      // rules, in the order the document model spec fixes.
      const allowed: Record<ArrayActionName, readonly string[]> = {
        $append: ["key", "value"],
        $remove: ["at", "key"],
        $update: ["at", "field", "key", "value"],
      };
      const takes = allowed[name];
      const fieldEntry = object["field"];
      const atEntry = object["at"];
      const valueEntry = object["value"];
      return {
        kind: "arrayAction",
        name,
        key: object["key"]?.stringValue ?? null,
        at: atEntry === undefined ? null : docValue(atEntry, `${path}.at`),
        field: fieldEntry?.stringValue ?? null,
        fieldFound: fieldEntry === undefined || fieldEntry.stringValue !== null ? null : fieldEntry.kind,
        value: valueEntry === undefined ? null : docValue(valueEntry, `${path}.value`),
        extra: keys.filter((key) => key !== "action" && !takes.includes(key)).sort(),
      };
    }

    default: {
      if (name.startsWith("$")) {
        throw MilanoBuildError.schemaViolation("action-encoding", null, "built-in action", name);
      }
      if (!isValidIdentifier(name)) {
        throw MilanoBuildError.schemaViolation("action-encoding", null, "identifier", name);
      }
      const parameters = emptyRecord<DocValue>();
      let onSuccess: readonly ActionSpec[] = [];
      let onFailure: readonly ActionSpec[] = [];
      for (const [key, value] of sortedEntries(object)) {
        if (key === "action") continue;
        if (key === "onSuccess") {
          onSuccess = actionList(value, `${path}.onSuccess`);
        } else if (key === "onFailure") {
          onFailure = actionList(value, `${path}.onFailure`);
        } else {
          parameters[key] = docValue(value, `${path}.${key}`);
        }
      }
      // The declared result and failure types are unknown until the gate
      // resolves the granted action set.
      return { kind: "custom", name, parameters, onSuccess, onFailure, result: null, failure: null };
    }
  }
}
