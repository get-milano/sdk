import Foundation

enum DocumentParser {

    /// Step 1 of the gate: parse. Envelope violations are `MalformedDocument`.
    static func parse(_ data: Data) throws -> ParsedDocument {
        let rawJSON: Any
        do {
            rawJSON = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw MilanoBuildError.malformedDocument(detail: "not well-formed JSON")
        }
        guard let rootValue = MilanoValue(json: rawJSON), case .record(let root) = rootValue else {
            throw MilanoBuildError.malformedDocument(detail: "document is not an object")
        }

        guard case .string(let versionString)? = root["version"] else {
            throw MilanoBuildError.malformedDocument(detail: "missing version")
        }
        let parts = versionString.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let major = Int(parts[0]), let minor = Int(parts[1]),
            let patch = Int(parts[2]), major >= 0, minor >= 0, patch >= 0
        else {
            throw MilanoBuildError.malformedDocument(detail: "version is not major.minor.patch")
        }

        var vocabularyRequirement: VocabularyRequirement?
        if let requirementEntry = root["vocabulary"] {
            guard case .record(let requirement) = requirementEntry,
                case .string(let requiredName)? = requirement["name"], !requiredName.isEmpty
            else {
                throw MilanoBuildError.malformedDocument(detail: "vocabulary requirement needs a name")
            }
            var minimum: String?
            if let minEntry = requirement["min"] {
                guard case .string(let minString) = minEntry, parseSemver(minString) != nil else {
                    throw MilanoBuildError.malformedDocument(
                        detail: "vocabulary min is not major.minor.patch")
                }
                minimum = minString
            }
            vocabularyRequirement = VocabularyRequirement(name: requiredName, min: minimum)
        }

        let contextDeclarations = try declarations(root["context"], section: "context")
        let stateDeclarations = try declarations(root["state"], section: "state")

        guard let rootNodeEntry = root["root"] else {
            throw MilanoBuildError.malformedDocument(detail: "missing root")
        }
        let rootNode = try node(rootNodeEntry, at: "root")
        // metadata is a JSON object: hosts read it as a map.
        if let metadata = root["metadata"], metadata.recordValue == nil {
            throw MilanoBuildError.malformedDocument(detail: "metadata must be an object")
        }

        return ParsedDocument(
            versionString: versionString, major: major, minor: minor,
            vocabularyRequirement: vocabularyRequirement,
            contextDeclarations: contextDeclarations,
            stateDeclarations: stateDeclarations,
            root: rootNode,
            // Lifecycle and watch bindings: maps of signal name, or state
            // key, to actions, like a node's on.
            lifecycle: try bindingMap(root["on"], section: "on"),
            hasLifecycle: root["on"] != nil,
            watch: try bindingMap(root["watch"], section: "watch"),
            hasWatch: root["watch"] != nil,
            metadata: root["metadata"])
    }

    private static func declarations(
        _ entry: MilanoValue?, section: String
    ) throws -> [String: MilanoType] {
        guard let entry else { return [:] }
        guard case .record(let object) = entry else {
            throw MilanoBuildError.malformedDocument(detail: "\(section) is not an object")
        }
        var result: [String: MilanoType] = [:]
        // Lexicographic key order, never dictionary order: a serializer
        // that reorders members must not change which defect is reported
        // (document model spec, Validation).
        for key in object.keys.sorted() {
            // A key that is not an identifier and a descriptor the
            // contract does not define are different defects.
            guard MilanoIdentifier.isValid(key) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "\(section)-declaration", node: nil, expected: "identifier", found: key)
            }
            guard let descriptor = object[key],
                  let type = MilanoType(descriptor: descriptor) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "\(section)-declaration", node: nil, expected: "type descriptor", found: key)
            }
            result[key] = type
        }
        return result
    }

    /// A top-level binding section (`on`, `watch`): a map from a name to
    /// one action or an action list; any other shape is malformed.
    private static func bindingMap(
        _ entry: MilanoValue?, section: String
    ) throws -> [String: [ActionSpec]] {
        switch entry {
        case nil:
            return [:]
        case .record(let entries):
            var bindings: [String: [ActionSpec]] = [:]
            for (name, actionsEntry) in entries {
                bindings[name] = try actionList(actionsEntry, at: "\(section).\(name)")
            }
            return bindings
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(section) is not an object")
        }
    }

    private static func node(_ entry: MilanoValue, at path: String) throws -> RawNode {
        guard case .record(let object) = entry else {
            throw MilanoBuildError.malformedDocument(detail: "\(path) is not an object")
        }
        guard case .string(let type)? = object["type"] else {
            throw MilanoBuildError.malformedDocument(detail: "\(path) has no type")
        }

        var id: String?
        switch object["id"] {
        case nil: break
        case .string(let value):
            // An empty id would be an empty reference in every report
            // about the node; the envelope requires a non-empty string.
            guard !value.isEmpty else {
                throw MilanoBuildError.malformedDocument(detail: "\(path) id is empty")
            }
            id = value
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(path) id is not a string")
        }

        var properties: [String: DocValue] = [:]
        switch object["properties"] {
        case nil: break
        case .record(let entries):
            for (name, value) in entries {
                properties[name] = try docValue(value, at: "\(path).\(name)")
            }
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(path) properties is not an object")
        }

        var children: [RawNode] = []
        switch object["children"] {
        case nil: break
        case .array(let entries):
            for (index, child) in entries.enumerated() {
                children.append(try node(child, at: "\(path)/children[\(index)]"))
            }
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(path) children is not an array")
        }

        var events: [String: [ActionSpec]] = [:]
        switch object["on"] {
        case nil: break
        case .record(let entries):
            for (event, actionsEntry) in entries {
                events[event] = try actionList(actionsEntry, at: "\(path).on.\(event)")
            }
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(path) on is not an object")
        }

        // The construct's own keys travel as parsed; the gate applies its rules.
        var repeatSpec: RepeatSpec?
        if type == "$repeat" {
            repeatSpec = RepeatSpec(
                items: try object["items"].map { try docValue($0, at: "\(path).items") },
                as: object["as"]?.stringValue,
                key: try object["key"].map { try docValue($0, at: "\(path).key") })
        }

        var conditionalSpec: ConditionalSpec?
        if type == "$if" {
            func branch(_ name: String) throws -> [RawNode]? {
                guard let list = object[name] else { return nil }
                guard case .array(let items) = list else {
                    throw MilanoBuildError.malformedDocument(
                        detail: "\(path) \(name) is not an array")
                }
                return try items.enumerated().map { index, child in
                    try node(child, at: "\(path)/\(name)[\(index)]")
                }
            }
            let declared: Set<String> = ["type", "condition", "then", "else"]
            conditionalSpec = ConditionalSpec(
                condition: try object["condition"].map { try docValue($0, at: "\(path).condition") },
                then: try branch("then"),
                otherwise: try branch("else"),
                undeclared: object.keys.filter { !declared.contains($0) }.sorted())
        }

        let switchSpec = try switchSpec(type, in: object, at: path)

        return RawNode(
            type: type, id: id, properties: properties,
            children: children, events: events, raw: entry, repeatSpec: repeatSpec,
            conditionalSpec: conditionalSpec, switchSpec: switchSpec)
    }

    /// The `$switch` construct's own keys, parsed out of the node walk:
    /// that function is at SwiftLint's body-length limit, and a construct
    /// with three keys of its own is what pushed it over.
    private static func switchSpec(
        _ type: String, in object: [String: MilanoValue], at path: String
    ) throws -> SwitchSpec? {
        guard type == "$switch" else { return nil }

            func nodeList(_ value: MilanoValue, _ slot: String) throws -> [RawNode] {
            guard case .array(let items) = value else {
                throw MilanoBuildError.malformedDocument(
                    detail: "\(path) \(slot) is not an array")
            }
            return try items.enumerated().map { index, child in
                try node(child, at: "\(path)/\(slot)[\(index)]")
            }
            }
            var cases: [String: [RawNode]]?
            if let casesEntry = object["cases"] {
            guard case .record(let members) = casesEntry else {
                throw MilanoBuildError.malformedDocument(
                    detail: "\(path) cases is not an object")
            }
            var built: [String: [RawNode]] = [:]
            for member in members.keys.sorted() {
                built[member] = try nodeList(members[member]!, "cases[\(member)]")
            }
            cases = built
            }
            let fallbackEntry = object["default"]
            let declared: Set<String> = ["type", "subject", "cases", "default"]
        return SwitchSpec(
            subject: try object["subject"].map { try docValue($0, at: "\(path).subject") },
            cases: cases,
            fallback: try fallbackEntry.map { try nodeList($0, "default") },
            hasFallback: fallbackEntry != nil,
            undeclared: object.keys.filter { !declared.contains($0) }.sorted())
    }

    /// A value is dynamic only when written as the reserved single-key
    /// `$expr` wrapper. An object mixing `$expr` with other keys is invalid.
    private static func docValue(_ entry: MilanoValue, at path: String) throws -> DocValue {
        if case .record(let object) = entry, object["$expr"] != nil {
            guard object.count == 1, case .string(let source)? = object["$expr"] else {
                throw MilanoBuildError.malformedDocument(detail: "\(path) invalid $expr wrapper")
            }
            return .expression(source)
        }
        return .literal(entry)
    }

    private static func actionList(_ entry: MilanoValue, at path: String) throws -> [ActionSpec] {
        switch entry {
        case .array(let items):
            return try items.enumerated().map { try action($0.element, at: "\(path)[\($0.offset)]") }
        case .record:
            return [try action(entry, at: path)]
        default:
            throw MilanoBuildError.malformedDocument(detail: "\(path) is not an action or action list")
        }
    }

    private static func action(_ entry: MilanoValue, at path: String) throws -> ActionSpec {
        guard case .record(let object) = entry else {
            throw MilanoBuildError.malformedDocument(detail: "\(path) is not an object")
        }
        guard case .string(let name)? = object["action"] else {
            throw MilanoBuildError.schemaViolation(
                rule: "action-encoding", node: nil, expected: "action key", found: path)
        }

        switch name {
        case "$set":
            guard object.keys.allSatisfy({ ["action", "key", "value"].contains($0) }),
                case .string(let key)? = object["key"],
                let valueEntry = object["value"]
            else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: nil, expected: "$set key and value", found: path)
            }
            return .set(key: key, value: try docValue(valueEntry, at: "\(path).value"))

        case "$append", "$remove", "$update":
            return try arrayAction(name, object: object, at: path)

        case "$sequence":
            guard object.keys.allSatisfy({ ["action", "actions"].contains($0) }),
                let actionsEntry = object["actions"], case .array = actionsEntry
            else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: nil, expected: "$sequence actions", found: path)
            }
            return .sequence(try actionList(actionsEntry, at: "\(path).actions"))

        case "$when":
            // Both branches are optional: a $when may carry only `else`.
            guard object.keys.allSatisfy({ ["action", "condition", "then", "else"].contains($0) }),
                let conditionEntry = object["condition"]
            else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: nil, expected: "$when condition", found: path)
            }
            let thenActions = try object["then"].map { try actionList($0, at: "\(path).then") } ?? []
            let otherwise = try object["else"].map { try actionList($0, at: "\(path).else") } ?? []
            return .when(
                condition: try docValue(conditionEntry, at: "\(path).condition"),
                then: thenActions,
                otherwise: otherwise)

        default:
            if name.hasPrefix("$") {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: nil, expected: "built-in action", found: name)
            }
            guard MilanoIdentifier.isValid(name) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "action-encoding", node: nil, expected: "identifier", found: name)
            }
            var parameters: [String: DocValue] = [:]
            var onSuccess: [ActionSpec] = []
            var onFailure: [ActionSpec] = []
            for (key, value) in object where key != "action" {
                switch key {
                case "onSuccess": onSuccess = try actionList(value, at: "\(path).onSuccess")
                case "onFailure": onFailure = try actionList(value, at: "\(path).onFailure")
                default: parameters[key] = try docValue(value, at: "\(path).\(key)")
                }
            }
            // The declared result and failure types are unknown until the
            // gate resolves the granted action set.
            return .custom(
                name: name, parameters: parameters, onSuccess: onSuccess, onFailure: onFailure,
                result: nil, failure: nil)
        }
    }

    /// An array action (contract 2.1): the parameters travel as carried;
    /// the gate applies the encoding rules, in the order the document
    /// model spec fixes.
    private static func arrayAction(
        _ name: String, object: [String: MilanoValue], at path: String
    ) throws -> ActionSpec {
        let takes: [String]
        switch name {
        case "$append": takes = ["key", "value"]
        case "$remove": takes = ["at", "key"]
        default: takes = ["at", "field", "key", "value"]
        }
        let fieldEntry = object["field"]
        var fieldFound: String?
        if let fieldEntry, fieldEntry.stringValue == nil {
            fieldFound = MilanoGate.name(of: fieldEntry)
        }
        return .arrayAction(ArrayActionSpec(
            name: name,
            key: object["key"]?.stringValue,
            at: try object["at"].map { try docValue($0, at: "\(path).at") },
            field: fieldEntry?.stringValue,
            fieldFound: fieldFound,
            value: try object["value"].map { try docValue($0, at: "\(path).value") },
            extra: object.keys.filter { $0 != "action" && !takes.contains($0) }.sorted()))
    }
}
