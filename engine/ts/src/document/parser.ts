import { emptyRecord } from "../core/lookup.ts";
import { isValidIdentifier } from "../core/identifier.ts";
import { MilanoJsonError, parseJson } from "../core/json.ts";
import { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoBuildError } from "./errors.ts";
import type {
  ActionSpec,
  DocValue,
  ParsedDocument,
  RawNode,
  VocabularyRequirement,
} from "./model.ts";
import { parseSemver } from "./model.ts";

/** Step 1 of the gate: parse. Envelope violations are MalformedDocument. */
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

  return {
    versionString,
    major: version[0],
    minor: version[1],
    vocabularyRequirement,
    contextDeclarations,
    stateDeclarations,
    root: parseNode(rootNodeEntry, "root"),
    metadata: root["metadata"] ?? null,
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
  for (const [key, descriptor] of Object.entries(object)) {
    const type = isValidIdentifier(key) ? MilanoType.fromDescriptor(descriptor) : null;
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
  }

  const properties = emptyRecord<DocValue>();
  const propertiesEntry = object["properties"];
  if (propertiesEntry !== undefined) {
    const entries = propertiesEntry.recordValue;
    if (entries === null) {
      throw MilanoBuildError.malformedDocument(`${path} properties is not an object`);
    }
    for (const [name, value] of Object.entries(entries)) {
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
    for (const [event, actions] of Object.entries(entries)) {
      events[event] = actionList(actions, `${path}.on.${event}`);
    }
  }

  return { type, id, properties, children, events, raw: entry };
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
      for (const [key, value] of Object.entries(object)) {
        if (key === "action") continue;
        if (key === "onSuccess") {
          onSuccess = actionList(value, `${path}.onSuccess`);
        } else if (key === "onFailure") {
          onFailure = actionList(value, `${path}.onFailure`);
        } else {
          parameters[key] = docValue(value, `${path}.${key}`);
        }
      }
      // The declared result type is unknown until the gate resolves the
      // granted action set.
      return { kind: "custom", name, parameters, onSuccess, onFailure, result: null };
    }
  }
}
