import { isValidIdentifier } from "../core/identifier.ts";
import { emptyRecord, hasOwn, own } from "../core/lookup.ts";
import { unicodeScalarCount, utf8ByteLength } from "../core/text.ts";
import { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import { MilanoBuildError } from "../document/errors.ts";
import type {
  ActionSpec,
  DocValue,
  ParsedDocument,
  RawNode,
} from "../document/model.ts";
import { compareSemver, parseSemver } from "../document/model.ts";
import { parseDocument } from "../document/parser.ts";
import type { MilanoLimits, MilanoUnknownTypePolicy } from "../engine/configuration.ts";
import type { MilanoOccurrence } from "../engine/observer.ts";
import type { MilanoAction, MilanoFunction, MilanoVocabulary } from "../engine/vocabulary.ts";
import { featureVersion, hasFeature, isSupportedVersion, supportedRanges } from "../engine/vocabulary.ts";
import { ExprError, ExprFeatureError } from "../expression/ast.ts";
import type { RootScope } from "../expression/checker.ts";
import { ExprChecker, UNAVAILABLE, payloadScope } from "../expression/checker.ts";
import { parseExpression } from "../expression/parser.ts";

const BOOL_TYPE = MilanoType.bool();
const MILANO_NULL = MilanoValue.null;

/**
 * A validated node, post-policy. Deferred expressions remain unevaluated
 * until resolution; placeholder nodes carry their raw subtree for the
 * placeholder renderer.
 */
export interface BuiltNode {
  readonly type: string;
  readonly reference: string;
  readonly isPlaceholder: boolean;
  readonly rawSubtree: MilanoValue | null;
  readonly properties: Readonly<Record<string, DocValue>>;
  /** For a `$repeat`, the template. */
  readonly children: readonly BuiltNode[];
  readonly events: Readonly<Record<string, readonly ActionSpec[]>>;
  /** Present exactly when the node is a `$repeat` construct. */
  readonly repeat: BuiltRepeat | null;
  /** Present exactly when the node is an `$if` construct. */
  readonly conditional: BuiltConditional | null;
  /** Present exactly when the node is a `$switch` construct. */
  readonly choice: BuiltSwitch | null;
}

/**
 * A validated `$if`: its typed bool condition and the two branches, each
 * already validated. `otherwise` is empty when the document declared no
 * `else`, which materializes nothing.
 */
export interface BuiltConditional {
  readonly condition: DocValue;
  readonly then: readonly BuiltNode[];
  readonly otherwise: readonly BuiltNode[];
}

/**
 * A validated `$switch`: its typed enum subject, one validated branch per
 * member the document named, and the branch every other member takes.
 * `fallback` is null when the cases already cover every member.
 */
export interface BuiltSwitch {
  readonly subject: DocValue;
  readonly cases: Readonly<Record<string, readonly BuiltNode[]>>;
  readonly fallback: readonly BuiltNode[] | null;
}

/**
 * A validated `$repeat`: its typed `items` expression, binding name, and
 * typed `key` expression when it declares one (contract 2.1).
 */
export interface BuiltRepeat {
  readonly items: DocValue;
  readonly as: string;
  readonly key: DocValue | null;
}

const RESERVED_ROOTS = new Set(["state", "context", "event", "result", "failure"]);
const LIFECYCLE_SIGNALS = new Set(["appear", "disappear"]);
type Bindings = Readonly<Record<string, MilanoType>>;

export interface GateOptions {
  readonly vocabulary: MilanoVocabulary;
  readonly limits: MilanoLimits;
  readonly policy: MilanoUnknownTypePolicy;
  readonly viewIdentity: string;
  /**
   * The surface's granted custom actions: the vocabulary's declarations,
   * overridden and narrowed by the builder. Built-in `$` actions are
   * contract, not capabilities.
   */
  readonly grantedActions: Readonly<Record<string, MilanoAction>>;
  /**
   * The surface's declared host functions: the vocabulary's, overridden
   * by the builder's (contract 2.1).
   */
  readonly declaredFunctions: Readonly<Record<string, MilanoFunction>>;
  readonly report: (occurrence: MilanoOccurrence) => void;
}

/** Each array action's parameters, in the lexicographic order the walk visits them. */
const ARRAY_ACTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  $append: ["key", "value"],
  $remove: ["at", "key"],
  $update: ["at", "field", "key", "value"],
};

/**
 * The construction gate: the validation order from the document model
 * spec. Steps 1 to 5 need only the document and the engine; the builder
 * awaits the state data provider and completes the data checks.
 */
export class MilanoGate {
  private readonly options: GateOptions;
  /**
   * Set during the vocabulary walk when any custom action is bound: the
   * builder then requires an action handler.
   */
  usesCustomActions = false;
  /**
   * Every host function the document calls, collected during the walk:
   * the builder then requires a function handler on the engine.
   */
  readonly usedFunctions = new Set<string>();

  constructor(options: GateOptions) {
    this.options = options;
  }

  /** Steps 1 to 5: parse, version, requirement, limits, vocabulary walk. */
  validateDocument(
    text: string,
    rawByteCount: number | null = null,
  ): {
    document: ParsedDocument;
    root: BuiltNode;
    lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
    watch: Readonly<Record<string, readonly ActionSpec[]>>;
  } {
    const limits = this.options.limits;

    // Gate limit: document size, checked on the raw bytes before parsing;
    // when the host supplied bytes their exact count is used.
    const byteCount = rawByteCount ?? utf8ByteLength(text);
    if (byteCount > limits.maxDocumentBytes) {
      throw MilanoBuildError.limitExceeded(
        "maxDocumentBytes",
        limits.maxDocumentBytes,
        byteCount,
      );
    }

    const document = parseDocument(text);

    if (!isSupportedVersion(document.major, document.minor)) {
      throw MilanoBuildError.unsupportedVersion(document.versionString, supportedRanges());
    }

    const requirement = document.vocabularyRequirement;
    if (requirement !== null) {
      const vocabulary = this.options.vocabulary;
      if (requirement.name !== vocabulary.name) {
        throw MilanoBuildError.schemaViolation(
          "vocabulary-requirement",
          null,
          requirement.name,
          vocabulary.name,
        );
      }
      if (requirement.min !== null) {
        const required = parseSemver(requirement.min);
        const held = parseSemver(vocabulary.version);
        if (required !== null && held !== null && compareSemver(held, required) < 0) {
          throw MilanoBuildError.schemaViolation(
            "vocabulary-requirement",
            null,
            `>=${requirement.min}`,
            vocabulary.version,
          );
        }
      }
    }

    const measured = measure(document.root, 1);
    if (measured.depth > limits.maxTreeDepth) {
      throw MilanoBuildError.limitExceeded("maxTreeDepth", limits.maxTreeDepth, measured.depth);
    }
    if (measured.count > limits.maxNodeCount) {
      throw MilanoBuildError.limitExceeded("maxNodeCount", limits.maxNodeCount, measured.count);
    }

    const root = this.validateNode(document.root, document, "root", new Set());
    // After the tree: the lifecycle bindings (document model spec,
    // Lifecycle bindings).
    const lifecycle = this.validateLifecycle(document);
    // Then the watch bindings (document model spec, Watch bindings).
    const watch = this.validateWatch(document);
    if (root === null) {
      // The root itself was an unknown type under the skip policy: an
      // empty view is still a valid outcome.
      return {
        document,
        root: {
          type: document.root.type,
          reference: document.root.id ?? "root",
          isPlaceholder: false,
          rawSubtree: null,
          properties: {},
          children: [],
          events: {},
          repeat: null,
          conditional: null,
          choice: null,
        },
        lifecycle,
        watch,
      };
    }
    return { document, root, lifecycle, watch };
  }

  /**
   * The document's `watch` section: contract 2.1 only, each key a declared
   * state key, and each action list under the lifecycle rules, with no
   * `event` root and no node to anchor to.
   */
  private validateWatch(
    document: ParsedDocument,
  ): Readonly<Record<string, readonly ActionSpec[]>> {
    const watch = emptyRecord<readonly ActionSpec[]>();
    if (!document.hasWatch) return watch;
    this.requireFeature(document, "watch", null);
    for (const [key, actions] of Object.entries(document.watch)) {
      if (!hasOwn(document.stateDeclarations, key)) {
        throw MilanoBuildError.schemaViolation("watch", null, "declared state key", key);
      }
      watch[key] = actions.map((action) =>
        this.validateAction(action, document, null, UNAVAILABLE, UNAVAILABLE),
      );
    }
    return watch;
  }

  /**
   * The document's `on` section: contract 2.1 only, the two signal names,
   * and each action list under the event rules with no `event` root and
   * no node to anchor to.
   */
  private validateLifecycle(
    document: ParsedDocument,
  ): Readonly<Record<string, readonly ActionSpec[]>> {
    const lifecycle = emptyRecord<readonly ActionSpec[]>();
    if (!document.hasLifecycle) return lifecycle;
    this.requireFeature(document, "on", null);
    for (const [signal, actions] of Object.entries(document.lifecycle)) {
      if (!LIFECYCLE_SIGNALS.has(signal)) {
        throw MilanoBuildError.schemaViolation("event-binding", null, "lifecycle event", signal);
      }
      lifecycle[signal] = actions.map((action) =>
        this.validateAction(action, document, null, UNAVAILABLE, UNAVAILABLE),
      );
    }
    return lifecycle;
  }

  /**
   * A feature the document's declared minor does not have yet is the
   * `contract-feature` violation, named after the feature (document
   * model spec, Validation).
   */
  private requireFeature(document: ParsedDocument, name: string, node: string | null): void {
    if (!hasFeature(name, document.major, document.minor)) {
      throw MilanoBuildError.schemaViolation("contract-feature", node, featureVersion(name), name);
    }
  }

  /** Data check: supplied context values against the declarations. */
  validateContext(
    document: ParsedDocument,
    supplied: Readonly<Record<string, MilanoValue>>,
  ): Record<string, MilanoValue> {
    const canonical = emptyRecord<MilanoValue>();
    for (const [key, type] of Object.entries(document.contextDeclarations)) {
      const value = own(supplied, key);
      if (value === undefined) {
        throw MilanoBuildError.schemaViolation("context-declaration", null, key, null);
      }
      const validated = type.validated(value);
      if (validated === null) {
        const [expected, found] = mismatchDetail(type, value);
        throw MilanoBuildError.schemaViolation("context-declaration", null, expected, found);
      }
      this.checkValueSize(validated);
      canonical[key] = validated;
    }
    // Extra supplied keys are ignored: the document reads only what it declares.
    return canonical;
  }

  /** Data check: provider values against the state declarations. */
  validateState(
    document: ParsedDocument,
    provided: Readonly<Record<string, MilanoValue>>,
  ): Record<string, MilanoValue> {
    const canonical = emptyRecord<MilanoValue>();
    for (const [key, type] of Object.entries(document.stateDeclarations)) {
      const value = own(provided, key) ?? MILANO_NULL;
      const validated = type.validated(value);
      if (validated === null) {
        const [expected, found] = mismatchDetail(type, value);
        throw MilanoBuildError.schemaViolation("state-declaration", null, expected, found);
      }
      this.checkValueSize(validated);
      canonical[key] = validated;
    }
    return canonical;
  }

  /** A value entering state or context fits the value size limit. */
  private checkValueSize(value: MilanoValue): void {
    const size = value.size;
    if (size > this.options.limits.maxValueSize) {
      throw MilanoBuildError.limitExceeded("maxValueSize", this.options.limits.maxValueSize, size);
    }
  }

  private validateNode(
    node: RawNode,
    document: ParsedDocument,
    path: string,
    seenIds: Set<string>,
    bindings: Bindings = {},
  ): BuiltNode | null {
    const reference = node.id ?? path;

    if (node.id !== null) {
      if (seenIds.has(node.id)) {
        throw MilanoBuildError.schemaViolation("id-uniqueness", reference, "unique id", node.id);
      }
      seenIds.add(node.id);
    }

    // Constructs live in the `$` namespace; contract 2.0 admits `$repeat`.
    if (node.type.startsWith("$")) {
      if (node.type === "$repeat" && document.major >= 2) {
        return this.validateRepeat(node, document, path, reference, seenIds, bindings);
      }
      if (node.type === "$switch" && document.major >= 2) {
        if (!hasFeature("$switchConstruct", document.major, document.minor)) {
          throw MilanoBuildError.schemaViolation(
            "contract-feature", reference, featureVersion("$switchConstruct"), "$switch",
          );
        }
        return this.validateSwitch(node, document, path, reference, seenIds, bindings);
      }
      if (node.type === "$if" && document.major >= 2) {
        if (!hasFeature("$ifConstruct", document.major, document.minor)) {
          throw MilanoBuildError.schemaViolation(
            "contract-feature",
            reference,
            featureVersion("$ifConstruct"),
            "$if",
          );
        }
        return this.validateConditional(node, document, path, reference, seenIds, bindings);
      }
      throw MilanoBuildError.schemaViolation(
        "construct",
        reference,
        "component type",
        node.type,
      );
    }

    // Unknown component type: detection at the gate, response per policy.
    const component = own(this.options.vocabulary.components, node.type);
    if (component === undefined) {
      switch (this.options.policy) {
        case "fail":
          throw MilanoBuildError.unknownComponentType(reference, node.type);
        case "skip":
          this.reportOccurrence("unknownTypeSkipped", reference, node.type);
          return null;
        case "placeholder":
          this.reportOccurrence("unknownTypePlaceholder", reference, node.type);
          return {
            type: node.type,
            reference,
            isPlaceholder: true,
            rawSubtree: node.raw,
            properties: emptyRecord<DocValue>(),
            children: [],
            events: emptyRecord<readonly ActionSpec[]>(),
            repeat: null,
            conditional: null,
          choice: null,
          };
      }
    }

    // Properties: declared ones type-checked; undeclared ones per strict mode.
    const properties = emptyRecord<DocValue>();
    for (const [name, value] of Object.entries(node.properties)) {
      const declaredType = own(component.properties, name);
      if (declaredType === undefined) {
        if (component.strict) {
          throw MilanoBuildError.schemaViolation("undeclared-property", reference, null, name);
        }
        this.reportOccurrence("undeclaredProperty", reference, name);
        continue;
      }
      properties[name] = this.checked(
        value,
        declaredType,
        "property-type",
        reference,
        document,
        UNAVAILABLE,
        UNAVAILABLE,
        bindings,
      );
    }

    // Children acceptance is declared by the vocabulary schema.
    if (node.children.length > 0 && !component.children) {
      throw MilanoBuildError.schemaViolation("children", reference, "no children", "children");
    }

    // Events: bindings against declared events; actions validated with the
    // event's payload type in scope.
    const events = emptyRecord<readonly ActionSpec[]>();
    for (const [event, actions] of Object.entries(node.events)) {
      if (!hasOwn(component.events, event)) {
        throw MilanoBuildError.schemaViolation(
          "event-binding",
          reference,
          "declared event",
          event,
        );
      }
      const payload = own(component.events, event) ?? null;
      const scope: RootScope = payload === null ? UNAVAILABLE : payloadScope(payload);
      events[event] = actions.map((action) =>
        this.validateAction(action, document, reference, scope, UNAVAILABLE, bindings),
      );
    }

    const children: BuiltNode[] = [];
    node.children.forEach((child, index) => {
      const built = this.validateNode(child, document, `${path}/children[${index}]`, seenIds, bindings);
      if (built !== null) children.push(built);
    });

    return {
      type: node.type,
      reference,
      isPlaceholder: false,
      rawSubtree: null,
      properties,
      children,
      events,
      repeat: null,
      conditional: null,
      choice: null,
    };
  }

  /**
   * The `$repeat` construct (document model spec, Constructs): never the
   * root, no properties or bindings, an array expression as `items`, a
   * fresh identifier as `as`, and a template validated with the element
   * and its index in scope.
   */
  /**
   * The `$switch` construct (document model spec, Constructs): an enum
   * subject and one branch per member, or a `default` for the rest. A
   * member that neither covers is the whole point: the gate says so
   * rather than the view rendering nothing.
   */
  private validateSwitch(
    node: RawNode,
    document: ParsedDocument,
    path: string,
    reference: string,
    seenIds: Set<string>,
    bindings: Bindings,
  ): BuiltNode {
    const violation = (expected: string, found: string | null): MilanoBuildError =>
      MilanoBuildError.schemaViolation("switch", reference, expected, found);
    const spec = node.choice;
    if (path === "root") throw violation("not the root", "root");
    if (Object.keys(node.properties).length > 0) throw violation("no properties", "properties");
    if (Object.keys(node.events).length > 0) throw violation("no on", "on");
    if (node.id !== null) throw violation("no id", node.id);
    if (spec === null) throw violation("subject expression", null);
    const undeclared = spec.undeclared[0];
    if (undeclared !== undefined) throw violation("declared key", undeclared);
    if (spec.subject === null) throw violation("subject expression", null);
    if (spec.subject.kind === "literal") {
      throw violation("subject expression", spec.subject.value.kind);
    }
    if (spec.cases === null || Object.keys(spec.cases).length === 0) {
      throw violation("cases", spec.cases === null ? null : "empty");
    }

    const scalarLength = unicodeScalarCount(spec.subject.source);
    if (scalarLength > this.options.limits.maxExpressionLength) {
      throw MilanoBuildError.limitExceeded(
        "maxExpressionLength", this.options.limits.maxExpressionLength, scalarLength,
      );
    }
    let subjectType: MilanoType | null;
    let expr;
    try {
      expr = parseExpression(spec.subject.source);
      subjectType = this.checker(document, UNAVAILABLE, UNAVAILABLE, UNAVAILABLE, bindings)
        .infer(expr);
    } catch (error) {
      if (error instanceof ExprFeatureError) {
        throw MilanoBuildError.schemaViolation(
          "contract-feature", reference, featureVersion(error.feature), error.feature,
        );
      }
      if (error instanceof ExprError) {
        throw MilanoBuildError.schemaViolation("expression", reference, "enum", null);
      }
      throw error;
    }
    if (subjectType === null || subjectType.kind.kind !== "enum" || subjectType.optional) {
      throw violation("enum subject", subjectType === null ? "null" : subjectType.name);
    }
    const members = subjectType.kind.members;

    const branch = (nodes: readonly RawNode[], name: string): readonly BuiltNode[] => {
      const built: BuiltNode[] = [];
      nodes.forEach((child, index) => {
        const one = this.validateNode(child, document, `${path}/${name}[${index}]`, seenIds, bindings);
        if (one !== null) built.push(one);
      });
      return built;
    };

    const cases = emptyRecord<readonly BuiltNode[]>();
    for (const [member, nodes] of Object.entries(spec.cases)) {
      if (!members.has(member)) throw violation("declared member", member);
      if (nodes.length === 0) throw violation("case branch", "empty");
      cases[member] = branch(nodes, `cases[${member}]`);
    }
    if (spec.hasFallback && (spec.fallback === null || spec.fallback.length === 0)) {
      throw violation("default branch", "empty");
    }
    if (!spec.hasFallback) {
      // Exhaustive without one: every member is covered, so no value of
      // the subject can reach a branch that is not there.
      for (const member of [...members].sort()) {
        if (own(spec.cases, member) === undefined) {
          throw violation("every member or a default", member);
        }
      }
    }

    return {
      type: node.type,
      reference,
      isPlaceholder: false,
      rawSubtree: null,
      properties: emptyRecord<DocValue>(),
      children: [],
      events: emptyRecord<readonly ActionSpec[]>(),
      repeat: null,
      conditional: null,
      choice: {
        subject: { kind: "typedExpression", source: spec.subject.source, expr, expected: subjectType },
        cases,
        fallback: spec.fallback === null ? null : branch(spec.fallback, "default"),
      },
    };
  }

  /**
   * The `$if` construct (document model spec, Constructs): never the
   * root, no properties, bindings, or id, a bool expression as the
   * condition, and both branches validated, so a defect in the branch a
   * build does not take still fails that build.
   */
  private validateConditional(
    node: RawNode,
    document: ParsedDocument,
    path: string,
    reference: string,
    seenIds: Set<string>,
    bindings: Bindings,
  ): BuiltNode {
    const violation = (expected: string, found: string | null): MilanoBuildError =>
      MilanoBuildError.schemaViolation("conditional", reference, expected, found);
    const spec = node.conditional;
    if (path === "root") throw violation("not the root", "root");
    if (Object.keys(node.properties).length > 0) throw violation("no properties", "properties");
    if (Object.keys(node.events).length > 0) throw violation("no on", "on");
    if (node.id !== null) throw violation("no id", node.id);
    if (spec === null) throw violation("condition expression", null);
    const undeclared = spec.undeclared[0];
    if (undeclared !== undefined) throw violation("declared key", undeclared);
    if (spec.condition === null) throw violation("condition expression", null);
    if (spec.condition.kind === "literal") {
      throw violation("condition expression", spec.condition.value.kind);
    }
    if (spec.then === null || spec.then.length === 0) {
      throw violation("then branch", spec.then === null ? null : "empty");
    }
    if (spec.otherwise !== null && spec.otherwise.length === 0) {
      throw violation("else branch", "empty");
    }

    const scalarLength = unicodeScalarCount(spec.condition.source);
    if (scalarLength > this.options.limits.maxExpressionLength) {
      throw MilanoBuildError.limitExceeded(
        "maxExpressionLength",
        this.options.limits.maxExpressionLength,
        scalarLength,
      );
    }
    let conditionType: MilanoType | null;
    let expr;
    try {
      expr = parseExpression(spec.condition.source);
      conditionType = this.checker(document, UNAVAILABLE, UNAVAILABLE, UNAVAILABLE, bindings)
        .infer(expr);
    } catch (error) {
      if (error instanceof ExprFeatureError) {
        throw MilanoBuildError.schemaViolation(
          "contract-feature", reference, featureVersion(error.feature), error.feature,
        );
      }
      if (error instanceof ExprError) {
        throw MilanoBuildError.schemaViolation("expression", reference, "bool", null);
      }
      throw error;
    }
    if (conditionType === null || conditionType.kind.kind !== "bool" || conditionType.optional) {
      throw violation("bool condition", conditionType === null ? "null" : conditionType.name);
    }
    const condition: DocValue = {
      kind: "typedExpression",
      source: spec.condition.source,
      expr,
      expected: conditionType,
    };

    // Both branches are part of the document, so both are validated and
    // ids stay unique across them.
    const branch = (nodes: readonly RawNode[], name: string): readonly BuiltNode[] => {
      const built: BuiltNode[] = [];
      nodes.forEach((child, index) => {
        const one = this.validateNode(child, document, `${path}/${name}[${index}]`, seenIds, bindings);
        if (one !== null) built.push(one);
      });
      return built;
    };

    return {
      type: node.type,
      reference,
      isPlaceholder: false,
      rawSubtree: null,
      properties: emptyRecord<DocValue>(),
      children: [],
      events: emptyRecord<readonly ActionSpec[]>(),
      repeat: null,
      choice: null,
      conditional: {
        condition,
        then: branch(spec.then, "then"),
        otherwise: spec.otherwise === null ? [] : branch(spec.otherwise, "else"),
      },
    };
  }

  private validateRepeat(
    node: RawNode,
    document: ParsedDocument,
    path: string,
    reference: string,
    seenIds: Set<string>,
    bindings: Bindings,
  ): BuiltNode {
    const violation = (expected: string, found: string | null): MilanoBuildError =>
      MilanoBuildError.schemaViolation("repeat", reference, expected, found);
    const spec = node.repeat;
    if (path === "root") throw violation("child position", "root");
    if (Object.keys(node.properties).length > 0) throw violation("items, as, children", "properties");
    if (Object.keys(node.events).length > 0) throw violation("items, as, children", "on");
    if (spec === null || spec.items === null) throw violation("items expression", null);
    if (spec.items.kind === "literal") throw violation("items expression", spec.items.value.kind);
    const as = spec.as;
    if (as === null || !isValidIdentifier(as) || RESERVED_ROOTS.has(as)) {
      throw violation("binding identifier", as);
    }
    if (own(bindings, as) !== undefined || own(bindings, `${as}_index`) !== undefined) {
      throw violation("distinct binding", as);
    }
    if (node.children.length === 0) throw violation("template", "no children");

    // items: an expression typing to a non-optional array, in the
    // enclosing bindings' scope.
    if (spec.items.kind !== "expression") throw violation("items expression", null);
    const scalarLength = unicodeScalarCount(spec.items.source);
    if (scalarLength > this.options.limits.maxExpressionLength) {
      throw MilanoBuildError.limitExceeded(
        "maxExpressionLength",
        this.options.limits.maxExpressionLength,
        scalarLength,
      );
    }
    let itemsType: MilanoType | null;
    let expr;
    try {
      expr = parseExpression(spec.items.source);
      itemsType = this.checker(document, UNAVAILABLE, UNAVAILABLE, UNAVAILABLE, bindings).infer(expr);
    } catch (error) {
      if (error instanceof ExprFeatureError) {
        throw MilanoBuildError.schemaViolation(
          "contract-feature", reference, featureVersion(error.feature), error.feature,
        );
      }
      if (error instanceof ExprError) {
        throw MilanoBuildError.schemaViolation("expression", reference, "array", null);
      }
      throw error;
    }
    if (itemsType === null || itemsType.kind.kind !== "array" || itemsType.optional) {
      throw violation("array items", itemsType === null ? "null" : itemsType.name);
    }
    const items: DocValue = {
      kind: "typedExpression",
      source: spec.items.source,
      expr,
      expected: itemsType,
    };

    const inner: Record<string, MilanoType> = { ...bindings };
    inner[as] = itemsType.kind.element;
    inner[`${as}_index`] = MilanoType.int();

    // key (contract 2.1): an expression over the template's roots whose
    // type is a non-optional string, int, or enum; checked after the items
    // type and before the template's nodes.
    let key: DocValue | null = null;
    if (spec.key !== null) {
      this.requireFeature(document, "key", reference);
      if (spec.key.kind === "literal") throw violation("key expression", spec.key.value.kind);
      if (spec.key.kind !== "expression") throw violation("key expression", null);
      const keyLength = unicodeScalarCount(spec.key.source);
      if (keyLength > this.options.limits.maxExpressionLength) {
        throw MilanoBuildError.limitExceeded(
          "maxExpressionLength",
          this.options.limits.maxExpressionLength,
          keyLength,
        );
      }
      let keyType: MilanoType | null;
      let keyExpr;
      try {
        keyExpr = parseExpression(spec.key.source);
        keyType = this.checker(document, UNAVAILABLE, UNAVAILABLE, UNAVAILABLE, inner).infer(keyExpr);
      } catch (error) {
        if (error instanceof ExprFeatureError) {
          throw MilanoBuildError.schemaViolation(
            "contract-feature", reference, featureVersion(error.feature), error.feature,
          );
        }
        if (error instanceof ExprError) {
          throw MilanoBuildError.schemaViolation("expression", reference, "string or int", null);
        }
        throw error;
      }
      const keyKind = keyType?.kind.kind;
      if (
        keyType === null ||
        keyType.optional ||
        (keyKind !== "string" && keyKind !== "int" && keyKind !== "enum")
      ) {
        throw violation("key type", keyType === null ? "null" : keyType.name);
      }
      key = { kind: "typedExpression", source: spec.key.source, expr: keyExpr, expected: keyType };
    }

    const template: BuiltNode[] = [];
    node.children.forEach((child, index) => {
      const built = this.validateNode(child, document, `${path}/children[${index}]`, seenIds, inner);
      if (built !== null) template.push(built);
    });

    return {
      type: node.type,
      reference,
      isPlaceholder: false,
      rawSubtree: null,
      properties: emptyRecord<DocValue>(),
      children: template,
      events: emptyRecord<readonly ActionSpec[]>(),
      conditional: null,
      choice: null,
      repeat: { items, as, key },
    };
  }

  /** An expression checker for this document's contract and the given scopes. */
  private checker(
    document: ParsedDocument,
    eventScope: RootScope,
    resultScope: RootScope,
    failureScope: RootScope,
    bindings: Bindings,
  ): ExprChecker {
    return new ExprChecker(
      document.stateDeclarations,
      document.contextDeclarations,
      eventScope,
      resultScope,
      bindings,
      failureScope,
      [document.major, document.minor],
      this.options.declaredFunctions,
      this.usedFunctions,
    );
  }

  /**
   * An array action's encoding (document model spec, Actions): the target
   * a declared, non-optional array key (records for `$update`), no
   * undeclared parameter, every parameter present, `at` an int, `field` a
   * declared field, `value` typed as the element or the field; each rule
   * an `action-encoding` violation, in the order the spec fixes. A
   * document declaring 2.0 may not carry one at all.
   */
  private validateArrayAction(
    action: Extract<ActionSpec, { kind: "arrayAction" }>,
    document: ParsedDocument,
    node: string | null,
    eventScope: RootScope,
    resultScope: RootScope,
    bindings: Bindings,
    failureScope: RootScope,
  ): ActionSpec {
    this.requireFeature(document, action.name, node);
    const violation = (expected: string | null, found: string | null): MilanoBuildError =>
      MilanoBuildError.schemaViolation("action-encoding", node, expected, found);
    const declared = action.key === null ? undefined : own(document.stateDeclarations, action.key);
    if (declared === undefined) throw violation("declared state key", action.key);
    const key = action.key as string;
    if (declared.kind.kind !== "array" || declared.optional) throw violation("array state key", key);
    const element = declared.kind.element;
    if (action.name === "$update" && (element.kind.kind !== "record" || element.optional)) {
      throw violation("record element", key);
    }
    const takes = ARRAY_ACTION_KEYS[action.name] as readonly string[];
    const extra = action.extra[0];
    if (extra !== undefined) throw violation("declared parameter", extra);
    for (const parameter of takes) {
      const present =
        parameter === "key" ||
        (parameter === "at" && action.at !== null) ||
        (parameter === "field" && (action.field !== null || action.fieldFound !== null)) ||
        (parameter === "value" && action.value !== null);
      if (!present) throw violation(parameter, null);
    }
    const check = (value: DocValue, type: MilanoType): DocValue =>
      this.checked(value, type, "action-encoding", node, document, eventScope, resultScope, bindings, failureScope);
    const at = action.at === null ? null : check(action.at, MilanoType.int());
    if (action.name === "$update") {
      const field = action.field;
      const fieldType = field === null ? undefined : own((element.kind as { fields: Readonly<Record<string, MilanoType>> }).fields, field);
      if (field === null || fieldType === undefined) {
        throw violation("declared field", field ?? action.fieldFound);
      }
      return {
        kind: "update",
        key,
        at: at as DocValue,
        field,
        value: check(action.value as DocValue, fieldType),
      };
    }
    if (action.name === "$remove") return { kind: "remove", key, at: at as DocValue };
    return { kind: "append", key, value: check(action.value as DocValue, element) };
  }

  private validateAction(
    action: ActionSpec,
    document: ParsedDocument,
    node: string | null,
    eventScope: RootScope,
    resultScope: RootScope,
    bindings: Bindings = {},
    failureScope: RootScope = UNAVAILABLE,
  ): ActionSpec {
    switch (action.kind) {
      case "set": {
        const stateType = own(document.stateDeclarations, action.key);
        if (stateType === undefined) {
          throw MilanoBuildError.schemaViolation(
            "action-encoding",
            node,
            "declared state key",
            action.key,
          );
        }
        return {
          kind: "set",
          key: action.key,
          value: this.checked(
            action.value,
            stateType,
            "action-encoding",
            node,
            document,
            eventScope,
            resultScope,
            bindings,
            failureScope,
          ),
        };
      }

      case "arrayAction":
        return this.validateArrayAction(action, document, node, eventScope, resultScope, bindings, failureScope);

      case "append":
      case "remove":
      case "update":
        // Already validated: the gate never sees these before it made them.
        return action;

      case "sequence":
        return {
          kind: "sequence",
          actions: action.actions.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope, bindings, failureScope),
          ),
        };

      case "when":
        return {
          kind: "when",
          condition: this.checked(
            action.condition,
            BOOL_TYPE,
            "action-encoding",
            node,
            document,
            eventScope,
            resultScope,
            bindings,
            failureScope,
          ),
          then: action.then.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope, bindings, failureScope),
          ),
          otherwise: action.otherwise.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope, bindings, failureScope),
          ),
        };

      case "custom": {
        this.usesCustomActions = true;
        const declaration = own(this.options.grantedActions, action.name);
        if (declaration === undefined) {
          throw MilanoBuildError.schemaViolation(
            "action-capability",
            node,
            "granted action",
            action.name,
          );
        }

        const checkedParameters = emptyRecord<DocValue>();
        for (const [parameter, value] of Object.entries(action.parameters)) {
          const parameterType = own(declaration.parameters, parameter);
          if (parameterType === undefined) {
            throw MilanoBuildError.schemaViolation(
              "action-encoding",
              node,
              "declared parameter",
              parameter,
            );
          }
          checkedParameters[parameter] = this.checked(
            value,
            parameterType,
            "action-encoding",
            node,
            document,
            eventScope,
            resultScope,
            bindings,
            failureScope,
          );
        }
        for (const [parameter, parameterType] of Object.entries(declaration.parameters)) {
          if (own(checkedParameters, parameter) !== undefined) continue;
          if (!parameterType.optional) {
            throw MilanoBuildError.schemaViolation("action-encoding", node, parameter, null);
          }
          checkedParameters[parameter] = { kind: "literal", value: MILANO_NULL };
        }

        // Event bindings inside onSuccess/onFailure evaluate against the
        // payload captured at dispatch: same static scope. The result root
        // rebinds to this action's declared result inside onSuccess, and
        // the failure root to its declared failure payload inside
        // onFailure; neither is available in the other list.
        const successScope: RootScope =
          declaration.result === null ? UNAVAILABLE : payloadScope(declaration.result);
        const failedScope: RootScope =
          declaration.failure === null ? UNAVAILABLE : payloadScope(declaration.failure);
        return {
          kind: "custom",
          name: action.name,
          parameters: checkedParameters,
          onSuccess: action.onSuccess.map((nested) =>
            this.validateAction(nested, document, node, eventScope, successScope, bindings, UNAVAILABLE),
          ),
          onFailure: action.onFailure.map((nested) =>
            this.validateAction(nested, document, node, eventScope, UNAVAILABLE, bindings, failedScope),
          ),
          result: declaration.result,
          failure: declaration.failure,
        };
      }
    }
  }

  /**
   * Type-checks a literal or an expression against the declared type.
   * Expressions are parsed and statically typed here.
   */
  private checked(
    value: DocValue,
    type: MilanoType,
    rule: string,
    node: string | null,
    document: ParsedDocument,
    eventScope: RootScope = UNAVAILABLE,
    resultScope: RootScope = UNAVAILABLE,
    bindings: Bindings = {},
    failureScope: RootScope = UNAVAILABLE,
  ): DocValue {
    switch (value.kind) {
      case "literal": {
        const validated = type.validated(value.value);
        if (validated === null) {
          const [expected, found] = mismatchDetail(type, value.value);
          throw MilanoBuildError.schemaViolation(rule, node, expected, found);
        }
        return { kind: "literal", value: validated };
      }

      case "expression": {
        // Counted in Unicode scalars, per the document model's limits.
        const scalarLength = unicodeScalarCount(value.source);
        if (scalarLength > this.options.limits.maxExpressionLength) {
          throw MilanoBuildError.limitExceeded(
            "maxExpressionLength",
            this.options.limits.maxExpressionLength,
            scalarLength,
          );
        }
        try {
          const expr = parseExpression(value.source);
          const checker = this.checker(document, eventScope, resultScope, failureScope, bindings);
          const inferred = checker.infer(expr, type);
          if (!checker.accepts(type, inferred)) throw new ExprError("type mismatch");
          return { kind: "typedExpression", source: value.source, expr, expected: type };
        } catch (error) {
          if (error instanceof ExprFeatureError) {
            // A function or root from a later minor than the document
            // declares: the contract-feature rule, named after the feature.
            throw MilanoBuildError.schemaViolation(
              "contract-feature", node, error.version, error.feature,
            );
          }
          if (error instanceof ExprError) {
            throw MilanoBuildError.schemaViolation("expression", node, type.name, error.detail);
          }
          throw error;
        }
      }

      case "typedExpression":
        return value;
    }
  }

  private reportOccurrence(
    kind: MilanoOccurrence["kind"],
    node: string | null,
    name: string,
  ): void {
    this.options.report({
      kind,
      viewIdentity: this.options.viewIdentity,
      node,
      name,
      expected: null,
      found: null,
    });
  }
}

/**
 * The detail a value mismatch carries (document model spec, rule tables):
 * the declared type against the value's kind, except a string that is not
 * a member of a declared enum, where naming the type would say "enum" and
 * hide which string was rejected.
 */
function mismatchDetail(type: MilanoType, value: MilanoValue): [string, string] {
  if (type.kind.kind === "enum" && value.stringValue !== null) {
    return ["enum member", value.stringValue];
  }
  return [type.name, value.kind];
}

function measure(node: RawNode, depth: number): { depth: number; count: number } {
  let deepest = depth;
  let count = 1;
  // A construct's branches are part of the document even though only one
  // materializes, so the limits see them: a subtree hidden in a branch is
  // still a subtree the gate has to walk and validate.
  const children = [
    ...node.children,
    ...(node.conditional?.then ?? []),
    ...(node.conditional?.otherwise ?? []),
    ...Object.values(node.choice?.cases ?? {}).flat(),
    ...(node.choice?.fallback ?? []),
  ];
  for (const child of children) {
    const measured = measure(child, depth + 1);
    if (measured.depth > deepest) deepest = measured.depth;
    count += measured.count;
  }
  return { depth: deepest, count };
}
