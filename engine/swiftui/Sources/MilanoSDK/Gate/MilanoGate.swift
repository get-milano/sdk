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
    let children: [BuiltNode]
    let events: [String: [ActionSpec]]
}

/// The construction gate: the five-step validation order from the document
/// model spec. Steps 1 to 4 need only the document and the engine; the
/// builder awaits the state data provider and completes the cross-checks.
struct MilanoGate {
    /// The contract majors this runtime supports.
    static let supportedMajors: [Int] = [1]

    let engine: MilanoEngine
    let policy: MilanoUnknownTypePolicy
    let viewIdentity: String
    /// The surface's granted custom actions: the vocabulary's declarations,
    /// overridden and narrowed by the builder. Built-in $ actions are
    /// contract, not capabilities.
    let grantedActions: [String: MilanoVocabulary.Action]
    let report: (MilanoOccurrence) -> Void

    /// Set during the vocabulary walk when any custom action is bound:
    /// the builder then requires an action handler.
    final class Flags {
        var usesCustomActions = false
    }
    let flags = Flags()

    /// Steps 1 to 4: parse, version, limits, vocabulary walk.
    func validateDocument(_ data: Data) throws -> (ParsedDocument, BuiltNode) {
        // Gate limit: document size, checked before parsing.
        if data.count > engine.limits.maxDocumentBytes {
            throw MilanoBuildError.limitExceeded(
                limit: "maxDocumentBytes", value: engine.limits.maxDocumentBytes, actual: data.count)
        }

        // Step 1: parse.
        let document = try DocumentParser.parse(data)

        // Step 2: version.
        guard Self.supportedMajors.contains(document.major) else {
            throw MilanoBuildError.unsupportedVersion(
                declared: document.versionString, supported: Self.supportedMajors)
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
        guard let root = try validate(document.root, in: document, path: "root", seenIds: &seenIds)
        else {
            // The root itself was an unknown type under the skip policy:
            // an empty view is still a valid outcome.
            return (document, BuiltNode(
                type: document.root.type, reference: document.root.id ?? "root",
                isPlaceholder: false, rawSubtree: nil,
                properties: [:], children: [], events: [:]))
        }
        return (document, root)
    }

    /// Step 5, data half: validates supplied context values against the
    /// document's declarations. Returns the canonicalized context.
    func validateContext(
        _ document: ParsedDocument, supplied: [String: MilanoValue]
    ) throws -> [String: MilanoValue] {
        var canonical: [String: MilanoValue] = [:]
        for (key, type) in document.contextDeclarations {
            guard let value = supplied[key] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "context-declaration", node: nil, expected: key, found: nil)
            }
            guard let validated = type.validated(value) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "context-declaration", node: nil,
                    expected: Self.name(of: type), found: Self.name(of: value))
            }
            canonical[key] = validated
        }
        // Extra supplied keys are ignored: the document reads only what it declares.
        return canonical
    }

    /// Step 5, state half: validates provider values against declarations.
    func validateState(
        _ document: ParsedDocument, provided: [String: MilanoValue]
    ) throws -> [String: MilanoValue] {
        var canonical: [String: MilanoValue] = [:]
        for (key, type) in document.stateDeclarations {
            let value = provided[key] ?? .null
            guard let validated = type.validated(value) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "state-declaration", node: nil,
                    expected: Self.name(of: type), found: Self.name(of: value))
            }
            canonical[key] = validated
        }
        return canonical
    }

    // MARK: - Node validation

    private func validate(
        _ node: RawNode, in document: ParsedDocument, path: String, seenIds: inout Set<String>
    ) throws -> BuiltNode? {
        let reference = node.id ?? path

        if let id = node.id {
            guard seenIds.insert(id).inserted else {
                throw MilanoBuildError.schemaViolation(
                    rule: "id-uniqueness", node: reference, expected: "unique id", found: id)
            }
        }

        // v1 documents contain no construct nodes at all.
        if node.type.hasPrefix("$") {
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
                    kind: .unknownTypeSkipped, viewIdentity: viewIdentity, node: reference))
                return nil
            case .placeholder:
                report(MilanoOccurrence(
                    kind: .unknownTypePlaceholder, viewIdentity: viewIdentity, node: reference))
                return BuiltNode(
                    type: node.type, reference: reference, isPlaceholder: true,
                    rawSubtree: node.raw, properties: [:], children: [], events: [:])
            }
        }

        // Properties: declared ones type-checked; undeclared ones per strict
        // mode.
        var properties: [String: DocValue] = [:]
        for (name, value) in node.properties {
            guard let declaredType = component.properties[name] else {
                if component.strict {
                    throw MilanoBuildError.schemaViolation(
                        rule: "undeclared-property", node: reference, expected: nil, found: name)
                }
                report(MilanoOccurrence(
                    kind: .undeclaredProperty, viewIdentity: viewIdentity, node: reference))
                continue
            }
            properties[name] = try checked(
                value, against: declaredType, rule: "property-type",
                node: reference, in: document)
        }

        // Children acceptance is declared by the vocabulary schema.
        if !node.children.isEmpty, !component.children {
            throw MilanoBuildError.schemaViolation(
                rule: "children", node: reference, expected: "no children", found: node.type)
        }

        // Events: bindings against declared events; actions validated with
        // the event's payload type in scope.
        var events: [String: [ActionSpec]] = [:]
        for (event, actions) in node.events {
            guard let payload = component.events[event] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "event-binding", node: reference, expected: "declared event", found: event)
            }
            let scope: EventScope = payload.map { .payload($0) } ?? .unavailable
            events[event] = try actions.map {
                try validateAction(
                    $0, in: document, node: reference, eventScope: scope,
                    resultScope: .unavailable)
            }
        }

        var children: [BuiltNode] = []
        for (index, child) in node.children.enumerated() {
            if let built = try validate(
                child, in: document, path: "\(path)/children[\(index)]", seenIds: &seenIds) {
                children.append(built)
            }
        }

        return BuiltNode(
            type: node.type, reference: reference, isPlaceholder: false, rawSubtree: nil,
            properties: properties, children: children, events: events)
    }

    private func validateAction(
        _ action: ActionSpec, in document: ParsedDocument, node: String,
        eventScope: EventScope, resultScope: EventScope
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
                    resultScope: resultScope))

        case .sequence(let actions):
            return .sequence(
                try actions.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope)
                })

        case .when(let condition, let then, let otherwise):
            let checkedCondition = try checked(
                condition, against: MilanoType(.bool), rule: "action-encoding",
                node: node, in: document, eventScope: eventScope, resultScope: resultScope)
            return .when(
                condition: checkedCondition,
                then: try then.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope)
                },
                otherwise: try otherwise.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: resultScope)
                })

        case .custom(let name, let parameters, let onSuccess, let onFailure, _):
            flags.usesCustomActions = true
            guard let declaration = grantedActions[name] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-capability", node: node, expected: "granted action", found: name)
            }
            var checkedParameters: [String: DocValue] = [:]
            for (parameter, value) in parameters {
                guard let parameterType = declaration.parameters[parameter] else {
                    throw MilanoBuildError.schemaViolation(
                        rule: "action-encoding", node: node,
                        expected: "declared parameter", found: parameter)
                }
                checkedParameters[parameter] = try checked(
                    value, against: parameterType, rule: "action-encoding",
                    node: node, in: document, eventScope: eventScope,
                    resultScope: resultScope)
            }
            for (parameter, parameterType) in declaration.parameters
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
            // onSuccess, and is never available inside onFailure.
            let successScope: EventScope =
                declaration.result.map { EventScope.payload($0) } ?? .unavailable
            return .custom(
                name: name, parameters: checkedParameters,
                onSuccess: try onSuccess.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: successScope)
                },
                onFailure: try onFailure.map {
                    try validateAction(
                        $0, in: document, node: node, eventScope: eventScope,
                        resultScope: .unavailable)
                },
                result: declaration.result)
        }
    }

    /// Type-checks a literal or an expression against the declared type.
    /// Expressions are parsed and statically typed here: step 4 of the gate.
    private func checked(
        _ value: DocValue, against type: MilanoType, rule: String, node: String,
        in document: ParsedDocument, eventScope: EventScope = .unavailable,
        resultScope: EventScope = .unavailable
    ) throws -> DocValue {
        switch value {
        case .literal(let literal):
            guard let validated = type.validated(literal) else {
                throw MilanoBuildError.schemaViolation(
                    rule: rule, node: node,
                    expected: Self.name(of: type), found: Self.name(of: literal))
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
                let checker = ExprChecker(
                    state: document.stateDeclarations,
                    context: document.contextDeclarations,
                    eventScope: eventScope, resultScope: resultScope)
                inferred = try checker.infer(expr, expecting: type)
                guard checker.accepts(type, actual: inferred) else {
                    throw ExprError(detail: "type mismatch")
                }
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

    private func measure(_ node: RawNode, depth: Int) -> (depth: Int, count: Int) {
        var maxDepth = depth
        var count = 1
        for child in node.children {
            let (childDepth, childCount) = measure(child, depth: depth + 1)
            maxDepth = max(maxDepth, childDepth)
            count += childCount
        }
        return (maxDepth, count)
    }

    // MARK: - Names for error details

    static func name(of type: MilanoType) -> String {
        let base: String
        switch type.kind {
        case .bool: base = "bool"
        case .int: base = "int"
        case .double: base = "double"
        case .string: base = "string"
        case .enumeration: base = "enum"
        case .array: base = "array"
        case .record: base = "record"
        }
        return type.optional ? "\(base)?" : base
    }

    static func name(of value: MilanoValue) -> String {
        switch value {
        case .null: return "null"
        case .bool: return "bool"
        case .int: return "int"
        case .double: return "double"
        case .string: return "string"
        case .array: return "array"
        case .record: return "record"
        }
    }
}
