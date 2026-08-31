import { emptyRecord } from "../core/lookup.ts";
import { isValidIdentifier } from "../core/identifier.ts";
import { MilanoJsonError, parseJson } from "../core/json.ts";
import { MilanoType } from "../core/type.ts";
import { sortedEntries } from "../document/parser.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoEngineError } from "../document/errors.ts";
import { parseSemver } from "../document/model.ts";

/** The contract majors this runtime supports. */
/**
 * Per contract major, the highest minor this engine implements
 * (Foundations, Versioning). A document's patch never matters.
 */
export const SUPPORTED_VERSIONS: Readonly<Record<number, number>> = Object.freeze({ 1: 0, 2: 1 });

/**
 * The contract version that introduced each feature a document or a
 * vocabulary may use, by the name the `contract-feature` detail carries
 * (document model spec, Validation). A document declaring an earlier
 * minor of the same major may not use it.
 */
export const FEATURE_VERSIONS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  key: [2, 1],
  on: [2, 1],
  failure: [2, 1],
  $abs: [2, 1],
  $min: [2, 1],
  $max: [2, 1],
  $floor: [2, 1],
  $ceil: [2, 1],
  $round: [2, 1],
  $substring: [2, 1],
  $indexOf: [2, 1],
  $replace: [2, 1],
  $split: [2, 1],
  $join: [2, 1],
  // The construct, in its own key: `$if` is also a function, and that
  // one has been in the contract since 1.0.
  $ifConstruct: [2, 1],
  $switchConstruct: [2, 1],
  // A lookup has no name; `[]` is how a document spells it.
  "[]": [2, 1],
  watch: [2, 1],
  functions: [2, 1],
  $append: [2, 1],
  $remove: [2, 1],
  $update: [2, 1],
});


/** Whether a document declaring `major.minor` has the named feature. */
export function hasFeature(name: string, major: number, minor: number): boolean {
  const introduced = FEATURE_VERSIONS[name];
  if (introduced === undefined) return true;
  return major > introduced[0] || (major === introduced[0] && minor >= introduced[1]);
}

/** The `contract-feature` detail's spelling of the version a feature needs: "2.1". */
export function featureVersion(name: string): string {
  const introduced = FEATURE_VERSIONS[name] ?? [0, 0];
  return `${introduced[0]}.${introduced[1]}`;
}

/** The supported ranges as the error detail spells them: "1.0", "2.1". */
export function supportedRanges(): string[] {
  return Object.entries(SUPPORTED_VERSIONS).map(([major, minor]) => `${major}.${minor}`);
}

export function isSupportedVersion(major: number, minor: number): boolean {
  const ceiling = SUPPORTED_VERSIONS[major];
  return ceiling !== undefined && minor <= ceiling;
}

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

/**
 * A host function declaration (contract 2.1; vocabulary schema spec,
 * Function declarations): its argument types in order, and its return type.
 */
export interface MilanoFunction {
  readonly arguments: readonly MilanoType[];
  readonly returns: MilanoType;
}

export interface MilanoAction {
  /** Parameter name to type. */
  readonly parameters: Readonly<Record<string, MilanoType>>;
  /**
   * The success completion's value type; null means completions carry no
   * data (vocabulary schema spec, completion results).
   */
  readonly result: MilanoType | null;
  /**
   * The failure completion's payload type (contract 2.1); null means a
   * failure carries no data (vocabulary schema spec, failure payloads).
   */
  readonly failure: MilanoType | null;
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
  /** The declared host functions (contract 2.1), by name. */
  readonly functions: Readonly<Record<string, MilanoFunction>>;

  private constructor(
    contractMajor: number,
    contractMinor: number,
    name: string,
    version: string,
    components: Readonly<Record<string, MilanoComponent>>,
    actions: Readonly<Record<string, MilanoAction>>,
    functions: Readonly<Record<string, MilanoFunction>>,
  ) {
    this.contractMajor = contractMajor;
    this.contractMinor = contractMinor;
    this.name = name;
    this.version = version;
    this.components = components;
    this.actions = actions;
    this.functions = functions;
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
    // unsupported contract version is rejected at creation.
    if (!isSupportedVersion(contract[0], contract[1])) {
      throw MilanoEngineError.invalidVocabulary(
        "milano-version",
        `unsupported contract version ${milano}; supported: ${supportedRanges().join(", ")}`,
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
    for (const [typeName, declaration] of sortedEntries(componentsEntry)) {
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
        actions[actionName] = parseAction(declaration, actionName, contract);
      }
    }

    const functions = emptyRecord<MilanoFunction>();
    const functionsEntry = root["functions"];
    if (functionsEntry !== undefined) {
      // The artifact's declared version is a floor it holds itself to:
      // host functions need contract 2.1.
      if (!hasFeature("functions", contract[0], contract[1])) {
        throw MilanoEngineError.invalidVocabulary(
          "contract-feature",
          `functions need contract ${featureVersion("functions")}`,
        );
      }
      const declarations = functionsEntry.recordValue;
      if (declarations === null) {
        throw MilanoEngineError.invalidVocabulary("functions", "functions is not an object");
      }
      for (const [functionName, declaration] of sortedEntries(declarations)) {
        if (!isValidIdentifier(functionName)) {
          throw MilanoEngineError.invalidVocabulary("function-name", functionName);
        }
        functions[functionName] = parseFunction(declaration, functionName);
      }
    }

    return new MilanoVocabulary(
      contract[0],
      contract[1],
      name,
      version,
      components,
      actions,
      functions,
    );
  }
}

/**
 * Parses one host function declaration; shared with builder declarations.
 * Any identifier will do: the contract's own functions are called through
 * the `$` namespace, so a vocabulary declaring `round` gets its own
 * `round(...)` beside `$round(...)` and can never be shadowed. An empty
 * argument list is refused (`function-arguments`: a function of no
 * arguments would be a constant, or would read what its arguments do not
 * carry).
 */
export function parseFunction(declaration: MilanoValue, path: string): MilanoFunction {
  const object = declaration.recordValue;
  if (object === null) {
    throw MilanoEngineError.invalidVocabulary("function", `${path} is not an object`);
  }
  const argumentsEntry = object["arguments"]?.arrayValue;
  if (argumentsEntry === undefined || argumentsEntry === null || argumentsEntry.length === 0) {
    throw MilanoEngineError.invalidVocabulary("function-arguments", path);
  }
  const argumentTypes: MilanoType[] = [];
  for (const descriptor of argumentsEntry) {
    const type = MilanoType.fromDescriptor(descriptor);
    if (type === null) throw MilanoEngineError.invalidVocabulary("function-argument", path);
    argumentTypes.push(type);
  }
  const returnsEntry = object["returns"];
  const returns = returnsEntry === undefined ? null : MilanoType.fromDescriptor(returnsEntry);
  if (returns === null) throw MilanoEngineError.invalidVocabulary("function-returns", path);
  return { arguments: argumentTypes, returns };
}

/**
 * Parses one custom action declaration; shared with builder declarations,
 * which use the same format. `contract` is the artifact's declared
 * version, which gates the declarations a later minor introduced; builder
 * declarations are code and always speak the engine's contract.
 */
export function parseAction(
  declaration: MilanoValue,
  path: string,
  contract: readonly [number, number, number] | null = null,
): MilanoAction {
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

  let failure: MilanoType | null = null;
  const failureEntry = object["failure"];
  if (failureEntry !== undefined) {
    // The artifact's declared version is a floor it holds itself to: a
    // failure payload needs contract 2.1.
    if (contract !== null && !hasFeature("failure", contract[0], contract[1])) {
      throw MilanoEngineError.invalidVocabulary(
        "contract-feature",
        `${path} declares a failure payload, which needs contract ${featureVersion("failure")}`,
      );
    }
    failure = MilanoType.fromDescriptor(failureEntry);
    if (failure === null) throw MilanoEngineError.invalidVocabulary("action-failure", path);
  }

  return { parameters, result, failure };
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
