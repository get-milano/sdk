import Foundation

/// A validated node, post-policy. Deferred expressions remain unevaluated
/// until resolution; placeholder nodes carry their raw subtree for the placeholder
/// renderer.
struct BuiltNode: Sendable {
    let type: String
    let reference: String
    let isPlaceholder: Bool
    let rawSubtree: MilanoValue?
    let properties: [String: DocValue]
    /// For a `$repeat`, the template.
    let children: [BuiltNode]
    let events: [String: [ActionSpec]]
    /// Present exactly when the node is a `$repeat` construct.
    var repeatSpec: BuiltRepeat?
    /// Present exactly when the node is an `$if` construct.
    var conditional: BuiltConditional?
    /// Present exactly when the node is a `$switch` construct.
    var choice: BuiltSwitch?
}

/// A validated `$switch`: its typed enum subject, one validated branch per
/// member the document named, and the branch every other member takes.
/// `fallback` is nil when the cases already cover every member.
struct BuiltSwitch: Sendable {
    let subject: DocValue
    let cases: [String: [BuiltNode]]
    let fallback: [BuiltNode]?
}

/// A validated `$if`: its typed bool condition and the two branches, each
/// already validated. `otherwise` is empty when the document declared no
/// `else`, which materializes nothing.
struct BuiltConditional: Sendable {
    let condition: DocValue
    let then: [BuiltNode]
    let otherwise: [BuiltNode]
}

/// A validated `$repeat`: its typed `items` expression, binding name, and
/// typed `key` expression when it declares one (contract 2.1).
struct BuiltRepeat: Sendable {
    let items: DocValue
    let `as`: String
    var key: DocValue?
}

/// What the gate produced for one document (steps 1 to 5): the parsed
/// document, the built root, and the validated lifecycle and watch
/// bindings. The data checks follow, in the builder.
struct ValidatedDocument: Sendable {
    let document: ParsedDocument
    let root: BuiltNode
    let lifecycle: [String: [ActionSpec]]
    let watch: [String: [ActionSpec]]
}

/// The construction gate: the five-step validation order from the document
/// model spec. Steps 1 to 5 need only the document and the engine; the
/// builder awaits the state data provider and completes the data checks.
struct MilanoGate {
    /// The contract majors this runtime supports.
    /// Per contract major, the highest minor this engine implements
    /// (Foundations, Versioning). A document's patch never matters.
    static let supportedVersions: [Int: Int] = [1: 0, 2: 1]

    /// The supported ranges as the error detail spells them: "1.0", "2.1".
    static var supportedRanges: [String] {
        supportedVersions.sorted { $0.key < $1.key }.map { "\($0.key).\($0.value)" }
    }

    static func isSupported(major: Int, minor: Int) -> Bool {
        guard let ceiling = supportedVersions[major] else { return false }
        return minor <= ceiling
    }

    let engine: MilanoEngine
    let policy: MilanoUnknownTypePolicy
    let viewIdentity: String
    /// The surface's granted custom actions: the vocabulary's declarations,
    /// overridden and narrowed by the builder. Built-in $ actions are
    /// contract, not capabilities.
    let grantedActions: [String: MilanoVocabulary.Action]
    /// The surface's declared host functions: the vocabulary's, overridden
    /// by the builder's (contract 2.1).
    let declaredFunctions: [String: MilanoVocabulary.Function]
    let report: (MilanoOccurrence) -> Void

    /// Set during the vocabulary walk: whether any custom action is bound
    /// (the builder then requires an action handler), and every host
    /// function the document calls (the builder then requires a function
    /// handler on the engine).
    final class Flags {
        var usesCustomActions = false
        var usedFunctions: Set<String> = []
    }
    let flags = Flags()

    /// Steps 1 to 5: parse, version, requirement, limits, vocabulary walk,
    /// then the lifecycle and watch bindings.
    func validateDocument(_ data: Data) throws -> ValidatedDocument {
        // Gate limit: document size, checked before parsing.
        if data.count > engine.limits.maxDocumentBytes {
            throw MilanoBuildError.limitExceeded(
                limit: "maxDocumentBytes", value: engine.limits.maxDocumentBytes, actual: data.count)
        }

        // Step 1: parse.
        let document = try DocumentParser.parse(data)

        // Step 2: version.
        guard Self.isSupported(major: document.major, minor: document.minor) else {
            throw MilanoBuildError.unsupportedVersion(
                declared: document.versionString, supported: Self.supportedRanges)
        }

        // Step 3: vocabulary requirement, when the document declares one.
        if let requirement = document.vocabularyRequirement {
            guard requirement.name == engine.vocabulary.name else {
                throw MilanoBuildError.schemaViolation(
                    rule: "vocabulary-requirement", node: nil,
                    expected: requirement.name, found: engine.vocabulary.name)
            }
            if let minimum = requirement.min,
                let required = parseSemver(minimum),
                let held = parseSemver(engine.vocabulary.version),
                held < required {
                throw MilanoBuildError.schemaViolation(
                    rule: "vocabulary-requirement", node: nil,
                    expected: ">=\(minimum)", found: engine.vocabulary.version)
            }
        }

        // Gate limits: depth and node count over the document as written.
        let (depth, count) = measure(document.root, depth: 1)
        if depth > engine.limits.maxTreeDepth {
            throw MilanoBuildError.limitExceeded(
                limit: "maxTreeDepth", value: engine.limits.maxTreeDepth, actual: depth)
        }
        if count > engine.limits.maxNodeCount {
            throw MilanoBuildError.limitExceeded(
                limit: "maxNodeCount", value: engine.limits.maxNodeCount, actual: count)
        }

        // Steps 3 and 4: vocabulary walk and expression typing
        // (expression length is checked here too).
        var seenIds: Set<String> = []
        let built = try validate(document.root, in: document, path: "root", seenIds: &seenIds)
        // After the tree: the lifecycle bindings (document model spec,
        // Lifecycle bindings).
        let lifecycle = try validateLifecycle(document)
        // Then the watch bindings (document model spec, Watch bindings).
        let watch = try validateWatch(document)
        // The root itself may have been an unknown type under the skip
        // policy: an empty view is still a valid outcome.
        let root = built ?? BuiltNode(
            type: document.root.type, reference: document.root.id ?? "root",
            isPlaceholder: false, rawSubtree: nil,
            properties: [:], children: [], events: [:])
        return ValidatedDocument(document: document, root: root, lifecycle: lifecycle, watch: watch)
    }

    // MARK: - Node validation

    private static let reservedRoots: Set<String> = ["state", "context", "event", "result", "failure"]

    // Internal for the same reason as `checker`: the construct
    // validators recurse back into the walk from their own files.
    func validate(
        _ node: RawNode, in document: ParsedDocument, path: String, seenIds: inout Set<String>,
        bindings: [String: MilanoType] = [:]
    ) throws -> BuiltNode? {
        let reference = node.id ?? path

        if let id = node.id {
            guard seenIds.insert(id).inserted else {
                throw MilanoBuildError.schemaViolation(
                    rule: "id-uniqueness", node: reference, expected: "unique id", found: id)
            }
        }

        // Constructs live in the `$` namespace; contract 2.0 admits `$repeat`.
        if node.type.hasPrefix("$") {
            if node.type == "$repeat", document.major >= 2 {
                return try validateRepeat(
                    node, in: document, path: path, reference: reference,
                    seenIds: &seenIds, bindings: bindings)
            }
            if node.type == "$switch", document.major >= 2 {
                try requireFeature(
                    "$switchConstruct", in: document, node: reference, reportedAs: "$switch")
                return try validateSwitch(
                    node, in: document, path: path, reference: reference,
                    seenIds: &seenIds, bindings: bindings)
            }
            if node.type == "$if", document.major >= 2 {
                try requireFeature(
                    "$ifConstruct", in: document, node: reference, reportedAs: "$if")
                return try validateConditional(
                    node, in: document, path: path, reference: reference,
                    seenIds: &seenIds, bindings: bindings)
            }
            throw MilanoBuildError.schemaViolation(
                rule: "construct", node: reference, expected: "component type", found: node.type)
        }

        // Unknown component type: detection at the gate, response per policy.
        guard let component = engine.vocabulary.components[node.type] else {
            switch policy {
            case .fail:
                throw MilanoBuildError.unknownComponentType(node: reference, unknownType: node.type)
            case .skip:
                report(MilanoOccurrence(
                    kind: .unknownTypeSkipped, viewIdentity: viewIdentity, node: reference,
                    name: node.type))
                return nil
            case .placeholder:
                report(MilanoOccurrence(
                    kind: .unknownTypePlaceholder, viewIdentity: viewIdentity, node: reference,
                    name: node.type))
                return BuiltNode(
                    type: node.type, reference: reference, isPlaceholder: true,
                    rawSubtree: node.raw, properties: [:], children: [], events: [:])
            }
        }

        // Properties: declared ones type-checked; undeclared ones per strict
        // mode.
        var properties: [String: DocValue] = [:]
        for (name, value) in node.properties.byKey {
            guard let declaredType = component.properties[name] else {
                if component.strict {
                    throw MilanoBuildError.schemaViolation(
                        rule: "undeclared-property", node: reference, expected: nil, found: name)
                }
                report(MilanoOccurrence(
                    kind: .undeclaredProperty, viewIdentity: viewIdentity, node: reference,
                    name: name))
                continue
            }
            properties[name] = try checked(
                value, against: declaredType, rule: "property-type",
                node: reference, in: document, bindings: bindings)
        }

        // Children acceptance is declared by the vocabulary schema.
        if !node.children.isEmpty, !component.children {
            throw MilanoBuildError.schemaViolation(
                rule: "children", node: reference, expected: "no children", found: "children")
        }

        // Events: bindings against declared events; actions validated with
        // the event's payload type in scope.
        var events: [String: [ActionSpec]] = [:]
        for (event, actions) in node.events.byKey {
            guard let payload = component.events[event] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "event-binding", node: reference, expected: "declared event", found: event)
            }
            let scope: EventScope = payload.map { .payload($0) } ?? .unavailable
            events[event] = try actions.map {
                try validateAction(
                    $0, in: document, node: reference, eventScope: scope,
                    resultScope: .unavailable, bindings: bindings)
            }
        }

        var children: [BuiltNode] = []
        for (index, child) in node.children.enumerated() {
            if let built = try validate(
                child, in: document, path: "\(path)/children[\(index)]", seenIds: &seenIds,
                bindings: bindings) {
                children.append(built)
            }
        }

        return BuiltNode(
            type: node.type, reference: reference, isPlaceholder: false, rawSubtree: nil,
            properties: properties, children: children, events: events)
    }

    /// The `$repeat` construct (document model spec, Constructs): never the
    /// root, no properties or bindings, an array expression as `items`, a
    /// fresh identifier as `as`, and a template validated with the element
    /// and its index in scope.
    private func validateRepeat(
        _ node: RawNode, in document: ParsedDocument, path: String, reference: String,
        seenIds: inout Set<String>, bindings: [String: MilanoType]
    ) throws -> BuiltNode {
        func violation(_ expected: String, _ found: String?) -> MilanoBuildError {
            MilanoBuildError.schemaViolation(rule: "repeat", node: reference, expected: expected, found: found)
        }
        if path == "root" { throw violation("child position", "root") }
        if !node.properties.isEmpty { throw violation("items, as, children", "properties") }
        if !node.events.isEmpty { throw violation("items, as, children", "on") }
        guard let spec = node.repeatSpec, let items = spec.items else {
            throw violation("items expression", nil)
        }
        if case .literal(let literal) = items {
            throw violation("items expression", Self.name(of: literal))
        }
        guard let alias = spec.as, MilanoIdentifier.isValid(alias), !Self.reservedRoots.contains(alias) else {
            throw violation("binding identifier", spec.as)
        }
        if bindings[alias] != nil || bindings["\(alias)_index"] != nil {
            throw violation("distinct binding", alias)
        }
        if node.children.isEmpty { throw violation("template", "no children") }

        // items: an expression typing to a non-optional array, in the
        // enclosing bindings' scope.
        guard case .expression(let source) = items else { throw violation("items expression", nil) }
        if source.unicodeScalars.count > engine.limits.maxExpressionLength {
            throw MilanoBuildError.limitExceeded(
                limit: "maxExpressionLength",
                value: engine.limits.maxExpressionLength,
                actual: source.unicodeScalars.count)
        }
        let expr: Expr
        let itemsType: MilanoType?
        do {
            expr = try ExprParser.parse(source)
            itemsType = try checker(
                document, eventScope: .unavailable, resultScope: .unavailable,
                failureScope: .unavailable, bindings: bindings
            ).infer(expr)
        } catch let error as ExprFeatureError {
            throw MilanoBuildError.schemaViolation(
                rule: "contract-feature", node: reference,
                expected: error.version, found: error.feature)
        } catch is ExprError {
            throw MilanoBuildError.schemaViolation(
                rule: "expression", node: reference, expected: "array", found: nil)
        }
        guard let itemsType, case .array(let element) = itemsType.kind, !itemsType.optional else {
            throw violation("array items", itemsType.map { Self.name(of: $0) } ?? "null")
        }

        var inner = bindings
        inner[alias] = element
        inner["\(alias)_index"] = MilanoType(.int)

        // key (contract 2.1): an expression over the template's roots whose
        // type is a non-optional string, int, or enum; checked after the
        // items type and before the template's nodes.
        let key = try spec.key.map { try validateKey($0, in: document, reference: reference, bindings: inner) }

        var template: [BuiltNode] = []
        for (index, child) in node.children.enumerated() {
            if let built = try validate(
                child, in: document, path: "\(path)/children[\(index)]", seenIds: &seenIds,
                bindings: inner) {
                template.append(built)
            }
        }
        return BuiltNode(
            type: node.type, reference: reference, isPlaceholder: false, rawSubtree: nil,
            properties: [:], children: template, events: [:],
            repeatSpec: BuiltRepeat(
                items: .typedExpression(source: source, expr: expr, expected: itemsType),
                as: alias, key: key))
    }

    func validateAction(
        _ action: ActionSpec, in document: ParsedDocument, node: String?,
        eventScope: EventScope, resultScope: EventScope,
        bindings: [String: MilanoType] = [:], failureScope: EventScope = .unavailable
    ) throws -> ActionSpec {
        switch action {
        case .set(let key, let value):
            guard let stateType = document.stateDeclarations[key] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: node, expected: "declared state key", found: key)
            }
            return .set(
                key: key,
                value: try checked(
                    value, against: stateType, rule: "action-encoding",
                    node: node, in: document, eventScope: eventScope,
                    resultScope: resultScope, bindings: bindings, failureScope: failureScope))

        case .arrayAction(let spec):
            return try validateArrayAction(
                spec, in: document, node: node, eventScope: eventScope,
                resultScope: resultScope, bindings: bindings, failureScope: failureScope)

        case .append, .remove, .update:
            // Already validated: the gate never sees these before it made them.
            return action

        case .sequence(let actions):
            return .sequence(
                try actions.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope, bindings: bindings, failureScope: failureScope)
                })

        case .when(let condition, let then, let otherwise):
            let checkedCondition = try checked(
                condition, against: MilanoType(.bool), rule: "action-encoding",
                node: node, in: document, eventScope: eventScope, resultScope: resultScope,
                bindings: bindings, failureScope: failureScope)
            return .when(
                condition: checkedCondition,
                then: try then.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope, bindings: bindings, failureScope: failureScope)
                },
                otherwise: try otherwise.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope, bindings: bindings, failureScope: failureScope)
                })

        case .custom(let name, let parameters, let onSuccess, let onFailure, _, _):
            flags.usesCustomActions = true
            guard let declaration = grantedActions[name] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-capability", node: node, expected: "granted action", found: name)
            }
            var checkedParameters: [String: DocValue] = [:]
            for (parameter, value) in parameters.byKey {
                guard let parameterType = declaration.parameters[parameter] else {
                    throw MilanoBuildError.schemaViolation(
                        rule: "action-encoding", node: node,
                        expected: "declared parameter", found: parameter)
                }
                checkedParameters[parameter] = try checked(
                    value, against: parameterType, rule: "action-encoding",
                    node: node, in: document, eventScope: eventScope,
                    resultScope: resultScope, bindings: bindings, failureScope: failureScope)
            }
            for (parameter, parameterType) in declaration.parameters.byKey
            where checkedParameters[parameter] == nil {
                guard parameterType.optional else {
                    throw MilanoBuildError.schemaViolation(
                        rule: "action-encoding", node: node, expected: parameter, found: nil)
                }
                checkedParameters[parameter] = .literal(.null)
            }
            // Event bindings inside onSuccess/onFailure evaluate against the
            // payload captured at dispatch: same static scope. The result
            // root rebinds to this action's declared result inside
            // onSuccess, and the failure root to its declared failure
            // payload inside onFailure; neither is available in the other.
            let successScope: EventScope =
                declaration.result.map { EventScope.payload($0) } ?? .unavailable
            let failedScope: EventScope =
                declaration.failure.map { EventScope.payload($0) } ?? .unavailable
            return .custom(
                name: name, parameters: checkedParameters,
                onSuccess: try onSuccess.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: successScope, bindings: bindings, failureScope: .unavailable)
                },
                onFailure: try onFailure.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: .unavailable, bindings: bindings, failureScope: failedScope)
                },
                result: declaration.result, failure: declaration.failure)
        }
    }

    /// Type-checks a literal or an expression against the declared type.
    /// Expressions are parsed and statically typed here: step 4 of the gate.
    func checked(
        _ value: DocValue, against type: MilanoType, rule: String, node: String?,
        in document: ParsedDocument, eventScope: EventScope = .unavailable,
        resultScope: EventScope = .unavailable, bindings: [String: MilanoType] = [:],
        failureScope: EventScope = .unavailable
    ) throws -> DocValue {
        switch value {
        case .literal(let literal):
            guard let validated = type.validated(literal) else {
                let detail = Self.mismatch(type, literal)
                throw MilanoBuildError.schemaViolation(
                    rule: rule, node: node,
                    expected: detail.expected, found: detail.found)
            }
            return .literal(validated)

        case .expression(let source):
            // Counted in Unicode scalars, per the document model's limits.
            if source.unicodeScalars.count > engine.limits.maxExpressionLength {
                throw MilanoBuildError.limitExceeded(
                    limit: "maxExpressionLength",
                    value: engine.limits.maxExpressionLength,
                    actual: source.unicodeScalars.count)
            }
            let expr: Expr
            let inferred: MilanoType?
            do {
                expr = try ExprParser.parse(source)
                let checker = checker(
                    document, eventScope: eventScope, resultScope: resultScope,
                    failureScope: failureScope, bindings: bindings)
                inferred = try checker.infer(expr, expecting: type)
                guard checker.accepts(type, actual: inferred) else {
                    throw ExprError(detail: "type mismatch")
                }
            } catch let error as ExprFeatureError {
                // A function or root from a later minor than the document
                // declares: the contract-feature rule, named after the feature.
                throw MilanoBuildError.schemaViolation(
                    rule: "contract-feature", node: node,
                    expected: error.version, found: error.feature)
            } catch let error as ExprError {
                throw MilanoBuildError.schemaViolation(
                    rule: "expression", node: node,
                    expected: Self.name(of: type), found: error.detail)
            }
            return .typedExpression(source: source, expr: expr, expected: type)

        case .typedExpression:
            return value
        }
    }

}

// MARK: - Lifecycle, watches, features, and the checker

extension MilanoGate {
    private static let lifecycleSignals: Set<String> = ["appear", "disappear"]

    /// The document's `on` section: contract 2.1 only, the two signal
    /// names, and each action list under the event rules with no `event`
    /// root and no node to anchor to.
    private func validateLifecycle(_ document: ParsedDocument) throws -> [String: [ActionSpec]] {
        guard document.hasLifecycle else { return [:] }
        try requireFeature("on", in: document, node: nil)
        var lifecycle: [String: [ActionSpec]] = [:]
        for (signal, actions) in document.lifecycle.byKey {
            guard Self.lifecycleSignals.contains(signal) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "event-binding", node: nil, expected: "lifecycle event", found: signal)
            }
            lifecycle[signal] = try actions.map {
                try validateAction(
                    $0, in: document, node: nil, eventScope: .unavailable, resultScope: .unavailable)
            }
        }
        return lifecycle
    }

    /// The document's `watch` section: contract 2.1 only, each key a
    /// declared state key, and each action list under the lifecycle rules,
    /// with no `event` root and no node to anchor to.
    private func validateWatch(_ document: ParsedDocument) throws -> [String: [ActionSpec]] {
        guard document.hasWatch else { return [:] }
        try requireFeature("watch", in: document, node: nil)
        var watch: [String: [ActionSpec]] = [:]
        for (key, actions) in document.watch.byKey {
            guard document.stateDeclarations[key] != nil else {
                throw MilanoBuildError.schemaViolation(
                    rule: "watch", node: nil, expected: "declared state key", found: key)
            }
            watch[key] = try actions.map {
                try validateAction(
                    $0, in: document, node: nil, eventScope: .unavailable, resultScope: .unavailable)
            }
        }
        return watch
    }

    /// A feature the document's declared minor does not have yet is the
    /// `contract-feature` violation, named after the feature (document
    /// model spec, Validation).
    func requireFeature(
        _ name: String, in document: ParsedDocument, node: String?, reportedAs: String? = nil
    ) throws {
        if !MilanoContractFeatures.has(name, major: document.major, minor: document.minor) {
            throw MilanoBuildError.schemaViolation(
                rule: "contract-feature", node: node,
                expected: MilanoContractFeatures.version(of: name), found: reportedAs ?? name)
        }
    }

    /// An expression checker for this document's contract and the given
    /// scopes. Internal rather than private: the construct validators live
    /// in their own files, which the gate's length limit is what forced.
    func checker(
        _ document: ParsedDocument, eventScope: EventScope, resultScope: EventScope,
        failureScope: EventScope, bindings: [String: MilanoType]
    ) -> ExprChecker {
        var checker = ExprChecker(
            state: document.stateDeclarations, context: document.contextDeclarations,
            eventScope: eventScope, resultScope: resultScope)
        checker.failureScope = failureScope
        checker.bindings = bindings
        checker.contract = (document.major, document.minor)
        checker.functions = declaredFunctions
        let flags = flags
        checker.onFunctionUse = { flags.usedFunctions.insert($0) }
        return checker
    }

    /// A `$repeat`'s key (contract 2.1): an expression over the template's
    /// roots whose type is a non-optional string, int, or enum.
    private func validateKey(
        _ keySpec: DocValue, in document: ParsedDocument, reference: String,
        bindings: [String: MilanoType]
    ) throws -> DocValue {
        func violation(_ expected: String, _ found: String?) -> MilanoBuildError {
            MilanoBuildError.schemaViolation(rule: "repeat", node: reference, expected: expected, found: found)
        }
        try requireFeature("key", in: document, node: reference)
        guard case .expression(let keySource) = keySpec else {
            if case .literal(let literal) = keySpec {
                throw violation("key expression", Self.name(of: literal))
            }
            throw violation("key expression", nil)
        }
        if keySource.unicodeScalars.count > engine.limits.maxExpressionLength {
            throw MilanoBuildError.limitExceeded(
                limit: "maxExpressionLength",
                value: engine.limits.maxExpressionLength,
                actual: keySource.unicodeScalars.count)
        }
        let keyExpr: Expr
        let keyType: MilanoType?
        do {
            keyExpr = try ExprParser.parse(keySource)
            keyType = try checker(
                document, eventScope: .unavailable, resultScope: .unavailable,
                failureScope: .unavailable, bindings: bindings
            ).infer(keyExpr)
        } catch let error as ExprFeatureError {
            throw MilanoBuildError.schemaViolation(
                rule: "contract-feature", node: reference,
                expected: error.version, found: error.feature)
        } catch is ExprError {
            throw MilanoBuildError.schemaViolation(
                rule: "expression", node: reference, expected: "string or int", found: nil)
        }
        let scalarKey: Bool
        switch keyType?.kind {
        case .string?, .int?, .enumeration?: scalarKey = true
        default: scalarKey = false
        }
        guard let keyType, !keyType.optional, scalarKey else {
            throw violation("key type", keyType.map { Self.name(of: $0) } ?? "null")
        }
        return .typedExpression(source: keySource, expr: keyExpr, expected: keyType)
    }
}

// MARK: - Measuring and naming

extension MilanoGate {
    private func measure(_ node: RawNode, depth: Int) -> (depth: Int, count: Int) {
        var maxDepth = depth
        var count = 1
        // A construct's branches are part of the document even though
        // only one materializes, so the limits see them.
        let children =
            node.children
            + (node.conditionalSpec?.then ?? []) + (node.conditionalSpec?.otherwise ?? [])
            + (node.switchSpec?.cases?.values.flatMap { $0 } ?? [])
            + (node.switchSpec?.fallback ?? [])
        for child in children {
            let (childDepth, childCount) = measure(child, depth: depth + 1)
            maxDepth = max(maxDepth, childDepth)
            count += childCount
        }
        return (maxDepth, count)
    }
}
