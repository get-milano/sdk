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

        return ParsedDocument(
            versionString: versionString, major: major, minor: minor,
            vocabularyRequirement: vocabularyRequirement,
            contextDeclarations: contextDeclarations,
            stateDeclarations: stateDeclarations,
            root: rootNode,
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
        for (key, descriptor) in object {
            guard MilanoIdentifier.isValid(key), let type = MilanoType(descriptor: descriptor) else {
                throw MilanoBuildError.schemaViolation(
                    rule: "\(section)-declaration", node: nil, expected: "type descriptor", found: key)
            }
            result[key] = type
        }
        return result
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
        case .string(let value): id = value
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

        return RawNode(
            type: type, id: id, properties: properties,
            children: children, events: events, raw: entry)
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
            // The declared result type is unknown until the gate resolves
            // the granted action set.
            return .custom(
                name: name, parameters: parameters, onSuccess: onSuccess, onFailure: onFailure,
                result: nil)
        }
    }
}
