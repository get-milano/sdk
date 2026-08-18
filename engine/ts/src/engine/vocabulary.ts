import { emptyRecord } from "../core/lookup.ts";
import { isValidIdentifier } from "../core/identifier.ts";
import { MilanoJsonError, parseJson } from "../core/json.ts";
import { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoEngineError } from "../document/errors.ts";
import { parseSemver } from "../document/model.ts";

/** The contract majors this runtime supports. */
export const SUPPORTED_MAJORS: readonly number[] = [1];

export interface MilanoComponent {
  /** Property name to type. */
  readonly properties: Readonly<Record<string, MilanoType>>;
  /** Event name to payload type; a null payload means a payload-less event. */
  readonly events: Readonly<Record<string, MilanoType | null>>;
  /** Whether nodes of this type accept `children`. */
  readonly children: boolean;
  /**
   * When true, undeclared properties are a SchemaViolation instead of
   * ignored-and-reported.
   */
  readonly strict: boolean;
}

export interface MilanoAction {
  /** Parameter name to type. */
  readonly parameters: Readonly<Record<string, MilanoType>>;
  /**
   * The success completion's value type; null means completions carry no
   * data (vocabulary schema spec, completion results).
   */
  readonly result: MilanoType | null;
}

/**
 * A parsed, validated vocabulary artifact: the consumer's component types,
 * events, and global custom actions.
 */
export class MilanoVocabulary {
  readonly contractMajor: number;
  readonly contractMinor: number;
  readonly name: string;
  /** Consumer-owned; surfaced in observability, never interpreted. */
  readonly version: string;
  readonly components: Readonly<Record<string, MilanoComponent>>;
  readonly actions: Readonly<Record<string, MilanoAction>>;

  private constructor(
    contractMajor: number,
    contractMinor: number,
    name: string,
    version: string,
    components: Readonly<Record<string, MilanoComponent>>,
    actions: Readonly<Record<string, MilanoAction>>,
  ) {
    this.contractMajor = contractMajor;
    this.contractMinor = contractMinor;
    this.name = name;
    this.version = version;
    this.components = components;
    this.actions = actions;
    Object.freeze(this);
  }

  /**
   * Parses and validates a vocabulary artifact from JSON text. Throws
   * `MilanoEngineError` (InvalidVocabulary) on any rule violation.
   */
  static parse(artifactJson: string): MilanoVocabulary {
    let root: Readonly<Record<string, MilanoValue>> | null;
    try {
      root = parseJson(artifactJson).recordValue;
    } catch (error) {
      if (error instanceof MilanoJsonError) {
        throw MilanoEngineError.invalidVocabulary("json", "not well-formed JSON");
      }
      throw error;
    }
    if (root === null) {
      throw MilanoEngineError.invalidVocabulary("structure", "artifact is not an object");
    }

    const milano = root["milano"]?.stringValue;
    if (milano === undefined || milano === null) {
      throw MilanoEngineError.invalidVocabulary("milano", "missing contract version");
    }
    const contract = parseSemver(milano);
    if (contract === null) {
      throw MilanoEngineError.invalidVocabulary(
        "milano",
        `expected major.minor.patch, found ${milano}`,
      );
    }
    // Same versioning rule as documents: an artifact targeting an
    // unsupported contract major is rejected at creation.
    if (!SUPPORTED_MAJORS.includes(contract[0])) {
      throw MilanoEngineError.invalidVocabulary(
        "milano-version",
        `unsupported contract major ${contract[0]}; supported: ${SUPPORTED_MAJORS.join(", ")}`,
      );
    }

    const name = root["name"]?.stringValue;
    if (name === undefined || name === null || !isValidIdentifier(name)) {
      throw MilanoEngineError.invalidVocabulary("name", "missing or invalid identifier");
    }

    const version = root["version"]?.stringValue;
    if (version === undefined || version === null || parseSemver(version) === null) {
      throw MilanoEngineError.invalidVocabulary(
        "version",
        "vocabulary version must be major.minor.patch",
      );
    }

    const componentsEntry = root["components"]?.recordValue;
    if (componentsEntry === undefined || componentsEntry === null) {
      throw MilanoEngineError.invalidVocabulary("components", "missing components");
    }
    const components = emptyRecord<MilanoComponent>();
    for (const [typeName, declaration] of Object.entries(componentsEntry)) {
      if (!isValidIdentifier(typeName)) {
        throw MilanoEngineError.invalidVocabulary("component-name", typeName);
      }
      components[typeName] = parseComponent(declaration, typeName);
    }

    const actions = emptyRecord<MilanoAction>();
    const actionsEntry = root["actions"];
    if (actionsEntry !== undefined) {
      const declarations = actionsEntry.recordValue;
      if (declarations === null) {
        throw MilanoEngineError.invalidVocabulary("actions", "actions is not an object");
      }
      for (const [actionName, declaration] of Object.entries(declarations)) {
        if (!isValidIdentifier(actionName)) {
          throw MilanoEngineError.invalidVocabulary("action-name", actionName);
        }
        actions[actionName] = parseAction(declaration, actionName);
      }
    }

    return new MilanoVocabulary(
      contract[0],
      contract[1],
      name,
      version,
      components,
      actions,
    );
  }
}

/**
 * Parses one custom action declaration; shared with builder declarations,
 * which use the same format.
 */
export function parseAction(declaration: MilanoValue, path: string): MilanoAction {
  const object = declaration.recordValue;
  if (object === null) {
    throw MilanoEngineError.invalidVocabulary("action", `${path} is not an object`);
  }

  const parameters = emptyRecord<MilanoType>();
  const parametersEntry = object["parameters"];
  if (parametersEntry !== undefined) {
    const declarations = parametersEntry.recordValue;
    if (declarations === null) {
      throw MilanoEngineError.invalidVocabulary("action-parameters", path);
    }
    for (const [parameterName, descriptor] of Object.entries(declarations)) {
      const type = isValidIdentifier(parameterName)
        ? MilanoType.fromDescriptor(descriptor)
        : null;
      if (type === null) {
        throw MilanoEngineError.invalidVocabulary(
          "action-parameter",
          `${path}.${parameterName}`,
        );
      }
      parameters[parameterName] = type;
    }
  }

  let result: MilanoType | null = null;
  const resultEntry = object["result"];
  if (resultEntry !== undefined) {
    result = MilanoType.fromDescriptor(resultEntry);
    if (result === null) throw MilanoEngineError.invalidVocabulary("action-result", path);
  }

  return { parameters, result };
}

function parseComponent(declaration: MilanoValue, path: string): MilanoComponent {
  const object = declaration.recordValue;
  if (object === null) {
    throw MilanoEngineError.invalidVocabulary("component", `${path} is not an object`);
  }

  const properties = emptyRecord<MilanoType>();
  const propertiesEntry = object["properties"];
  if (propertiesEntry !== undefined) {
    const declarations = propertiesEntry.recordValue;
    if (declarations === null) {
      throw MilanoEngineError.invalidVocabulary("component-properties", path);
    }
    for (const [propertyName, descriptor] of Object.entries(declarations)) {
      const type = isValidIdentifier(propertyName)
        ? MilanoType.fromDescriptor(descriptor)
        : null;
      if (type === null) {
        throw MilanoEngineError.invalidVocabulary(
          "component-property",
          `${path}.${propertyName}`,
        );
      }
      properties[propertyName] = type;
    }
  }

  const events = emptyRecord<MilanoType | null>();
  const eventsEntry = object["events"];
  if (eventsEntry !== undefined) {
    const declarations = eventsEntry.recordValue;
    if (declarations === null) {
      throw MilanoEngineError.invalidVocabulary("component-events", path);
    }
    for (const [eventName, descriptor] of Object.entries(declarations)) {
      if (!isValidIdentifier(eventName)) {
        throw MilanoEngineError.invalidVocabulary("component-event", `${path}.${eventName}`);
      }
      if (descriptor.isNull) {
        events[eventName] = null; // declared, payload-less
        continue;
      }
      const type = MilanoType.fromDescriptor(descriptor);
      if (type === null) {
        throw MilanoEngineError.invalidVocabulary("component-event", `${path}.${eventName}`);
      }
      events[eventName] = type;
    }
  }

  const children = booleanFlag(object["children"], "component-children", path);
  const strict = booleanFlag(object["strict"], "component-strict", path);
  return { properties, events, children, strict };
}

function booleanFlag(entry: MilanoValue | undefined, rule: string, path: string): boolean {
  if (entry === undefined) return false;
  const flag = entry.boolValue;
  if (flag === null) throw MilanoEngineError.invalidVocabulary(rule, path);
  return flag;
}
