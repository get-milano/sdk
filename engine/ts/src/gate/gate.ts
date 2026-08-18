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
import type { MilanoAction, MilanoVocabulary } from "../engine/vocabulary.ts";
import { SUPPORTED_MAJORS } from "../engine/vocabulary.ts";
import { ExprError } from "../expression/ast.ts";
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
  readonly children: readonly BuiltNode[];
  readonly events: Readonly<Record<string, readonly ActionSpec[]>>;
}

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
  readonly report: (occurrence: MilanoOccurrence) => void;
}

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

  constructor(options: GateOptions) {
    this.options = options;
  }

  /** Steps 1 to 5: parse, version, requirement, limits, vocabulary walk. */
  validateDocument(
    text: string,
    rawByteCount: number | null = null,
  ): { document: ParsedDocument; root: BuiltNode } {
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

    if (!SUPPORTED_MAJORS.includes(document.major)) {
      throw MilanoBuildError.unsupportedVersion(document.versionString, SUPPORTED_MAJORS);
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
        },
      };
    }
    return { document, root };
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
        throw MilanoBuildError.schemaViolation(
          "context-declaration",
          null,
          type.name,
          value.kind,
        );
      }
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
        throw MilanoBuildError.schemaViolation("state-declaration", null, type.name, value.kind);
      }
      canonical[key] = validated;
    }
    return canonical;
  }

  private validateNode(
    node: RawNode,
    document: ParsedDocument,
    path: string,
    seenIds: Set<string>,
  ): BuiltNode | null {
    const reference = node.id ?? path;

    if (node.id !== null) {
      if (seenIds.has(node.id)) {
        throw MilanoBuildError.schemaViolation("id-uniqueness", reference, "unique id", node.id);
      }
      seenIds.add(node.id);
    }

    // v1 documents contain no construct nodes at all.
    if (node.type.startsWith("$")) {
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
          this.reportOccurrence("unknownTypeSkipped", reference);
          return null;
        case "placeholder":
          this.reportOccurrence("unknownTypePlaceholder", reference);
          return {
            type: node.type,
            reference,
            isPlaceholder: true,
            rawSubtree: node.raw,
            properties: emptyRecord<DocValue>(),
            children: [],
            events: emptyRecord<readonly ActionSpec[]>(),
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
        this.reportOccurrence("undeclaredProperty", reference);
        continue;
      }
      properties[name] = this.checked(
        value,
        declaredType,
        "property-type",
        reference,
        document,
      );
    }

    // Children acceptance is declared by the vocabulary schema.
    if (node.children.length > 0 && !component.children) {
      throw MilanoBuildError.schemaViolation("children", reference, "no children", node.type);
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
        this.validateAction(action, document, reference, scope, UNAVAILABLE),
      );
    }

    const children: BuiltNode[] = [];
    node.children.forEach((child, index) => {
      const built = this.validateNode(child, document, `${path}/children[${index}]`, seenIds);
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
    };
  }

  private validateAction(
    action: ActionSpec,
    document: ParsedDocument,
    node: string,
    eventScope: RootScope,
    resultScope: RootScope,
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
          ),
        };
      }

      case "sequence":
        return {
          kind: "sequence",
          actions: action.actions.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope),
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
          ),
          then: action.then.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope),
          ),
          otherwise: action.otherwise.map((nested) =>
            this.validateAction(nested, document, node, eventScope, resultScope),
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
        // rebinds to this action's declared result inside onSuccess, and is
        // never available inside onFailure.
        const successScope: RootScope =
          declaration.result === null ? UNAVAILABLE : payloadScope(declaration.result);
        return {
          kind: "custom",
          name: action.name,
          parameters: checkedParameters,
          onSuccess: action.onSuccess.map((nested) =>
            this.validateAction(nested, document, node, eventScope, successScope),
          ),
          onFailure: action.onFailure.map((nested) =>
            this.validateAction(nested, document, node, eventScope, UNAVAILABLE),
          ),
          result: declaration.result,
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
    node: string,
    document: ParsedDocument,
    eventScope: RootScope = UNAVAILABLE,
    resultScope: RootScope = UNAVAILABLE,
  ): DocValue {
    switch (value.kind) {
      case "literal": {
        const validated = type.validated(value.value);
        if (validated === null) {
          throw MilanoBuildError.schemaViolation(rule, node, type.name, value.value.kind);
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
          const checker = new ExprChecker(
            document.stateDeclarations,
            document.contextDeclarations,
            eventScope,
            resultScope,
          );
          const inferred = checker.infer(expr, type);
          if (!checker.accepts(type, inferred)) throw new ExprError("type mismatch");
          return { kind: "typedExpression", source: value.source, expr, expected: type };
        } catch (error) {
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
  ): void {
    this.options.report({ kind, viewIdentity: this.options.viewIdentity, node });
  }
}

function measure(node: RawNode, depth: number): { depth: number; count: number } {
  let deepest = depth;
  let count = 1;
  for (const child of node.children) {
    const measured = measure(child, depth + 1);
    if (measured.depth > deepest) deepest = measured.depth;
    count += measured.count;
  }
  return { depth: deepest, count };
}
