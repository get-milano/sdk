import Foundation

/// A parsed, validated vocabulary artifact: the consumer's component types,
/// events, and global custom actions, per the vocabulary schema spec.
struct MilanoVocabulary: Equatable, Sendable {
    struct Component: Equatable, Sendable {
        /// Property name to type.
        let properties: [String: MilanoType]
        /// Event name to payload type; `nil` payload means a payload-less event.
        let events: [String: MilanoType?]
        /// Whether nodes of this type accept `children`.
        let children: Bool
        /// When true, undeclared properties are a SchemaViolation instead of
        /// ignored-and-reported.
        let strict: Bool
    }

    struct Action: Equatable, Sendable {
        /// Parameter name to type.
        let parameters: [String: MilanoType]
        /// The success completion's value type; `nil` means completions
        /// carry no data (vocabulary schema spec, completion results).
        let result: MilanoType?
    }

    /// The contract version the artifact targets (major, minor).
    let contractMajor: Int
    let contractMinor: Int
    let name: String
    /// Consumer-owned; surfaced in observability, never interpreted.
    let version: String
    let components: [String: Component]
    let actions: [String: Action]
}

extension MilanoVocabulary {
    /// Parses and validates a vocabulary artifact from JSON bytes.
    /// Throws `MilanoEngineError.invalidVocabulary` on any rule violation.
    init(artifactJSON data: Data) throws {
        let raw: Any
        do {
            raw = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw MilanoEngineError.invalidVocabulary(rule: "json", detail: "not well-formed JSON")
        }
        guard let rootJSON = MilanoValue(json: raw), case .record(let root) = rootJSON else {
            throw MilanoEngineError.invalidVocabulary(rule: "structure", detail: "artifact is not an object")
        }

        // milano: contract version "major.minor"
        guard case .string(let milano)? = root["milano"] else {
            throw MilanoEngineError.invalidVocabulary(rule: "milano", detail: "missing contract version")
        }
        let versionParts = milano.split(separator: ".", omittingEmptySubsequences: false)
        guard versionParts.count == 3,
            let major = Int(versionParts[0]), let minor = Int(versionParts[1]),
            let patch = Int(versionParts[2]),
            major >= 0, minor >= 0, patch >= 0
        else {
            throw MilanoEngineError.invalidVocabulary(
                rule: "milano", detail: "expected major.minor.patch, found \(milano)")
        }
        // Same versioning rule as documents: an artifact targeting an
        // unsupported contract major fails fast at engine creation.
        guard MilanoGate.supportedMajors.contains(major) else {
            throw MilanoEngineError.invalidVocabulary(
                rule: "milano-version",
                detail: "unsupported contract major \(major); supported: \(MilanoGate.supportedMajors)")
        }

        guard case .string(let name)? = root["name"], MilanoIdentifier.isValid(name) else {
            throw MilanoEngineError.invalidVocabulary(rule: "name", detail: "missing or invalid identifier")
        }
        guard case .string(let vocabularyVersion)? = root["version"],
            parseSemver(vocabularyVersion) != nil
        else {
            throw MilanoEngineError.invalidVocabulary(
                rule: "version", detail: "vocabulary version must be major.minor.patch")
        }

        guard case .record(let componentsJSON)? = root["components"] else {
            throw MilanoEngineError.invalidVocabulary(rule: "components", detail: "missing components")
        }
        var components: [String: Component] = [:]
        for (typeName, declaration) in componentsJSON {
            guard MilanoIdentifier.isValid(typeName) else {
                throw MilanoEngineError.invalidVocabulary(rule: "component-name", detail: typeName)
            }
            components[typeName] = try Self.component(from: declaration, at: typeName)
        }

        var actions: [String: Action] = [:]
        if let actionsEntry = root["actions"] {
            guard case .record(let actionsJSON) = actionsEntry else {
                throw MilanoEngineError.invalidVocabulary(rule: "actions", detail: "actions is not an object")
            }
            for (actionName, declaration) in actionsJSON {
                guard MilanoIdentifier.isValid(actionName) else {
                    throw MilanoEngineError.invalidVocabulary(rule: "action-name", detail: actionName)
                }
                actions[actionName] = try Self.action(from: declaration, at: actionName)
            }
        }

        self.init(
            contractMajor: major, contractMinor: minor,
            name: name, version: vocabularyVersion,
            components: components, actions: actions)
    }

    /// Parses one custom action declaration; shared with document-local
    /// declarations, which use the same format (document model spec).
    static func action(from declaration: MilanoValue, at path: String) throws -> Action {
        guard case .record(let object) = declaration else {
            throw MilanoEngineError.invalidVocabulary(rule: "action", detail: "\(path) is not an object")
        }
        var parameters: [String: MilanoType] = [:]
        if let parametersEntry = object["parameters"] {
            guard case .record(let parametersJSON) = parametersEntry else {
                throw MilanoEngineError.invalidVocabulary(rule: "action-parameters", detail: path)
            }
            for (parameterName, descriptor) in parametersJSON {
                guard MilanoIdentifier.isValid(parameterName),
                    let type = MilanoType(descriptor: descriptor)
                else {
                    throw MilanoEngineError.invalidVocabulary(
                        rule: "action-parameter", detail: "\(path).\(parameterName)")
                }
                parameters[parameterName] = type
            }
        }
        var result: MilanoType?
        if let resultEntry = object["result"] {
            guard let type = MilanoType(descriptor: resultEntry) else {
                throw MilanoEngineError.invalidVocabulary(
                    rule: "action-result", detail: path)
            }
            result = type
        }
        return Action(parameters: parameters, result: result)
    }

    private static func component(from declaration: MilanoValue, at path: String) throws -> Component {
        guard case .record(let object) = declaration else {
            throw MilanoEngineError.invalidVocabulary(rule: "component", detail: "\(path) is not an object")
        }

        var properties: [String: MilanoType] = [:]
        if let propertiesEntry = object["properties"] {
            guard case .record(let propertiesJSON) = propertiesEntry else {
                throw MilanoEngineError.invalidVocabulary(rule: "component-properties", detail: path)
            }
            for (propertyName, descriptor) in propertiesJSON {
                guard MilanoIdentifier.isValid(propertyName),
                    let type = MilanoType(descriptor: descriptor)
                else {
                    throw MilanoEngineError.invalidVocabulary(
                        rule: "component-property", detail: "\(path).\(propertyName)")
                }
                properties[propertyName] = type
            }
        }

        var events: [String: MilanoType?] = [:]
        if let eventsEntry = object["events"] {
            guard case .record(let eventsJSON) = eventsEntry else {
                throw MilanoEngineError.invalidVocabulary(rule: "component-events", detail: path)
            }
            for (eventName, descriptor) in eventsJSON {
                guard MilanoIdentifier.isValid(eventName) else {
                    throw MilanoEngineError.invalidVocabulary(
                        rule: "component-event", detail: "\(path).\(eventName)")
                }
                if descriptor == .null {
                    events[eventName] = MilanoType?.none
                } else if let payloadType = MilanoType(descriptor: descriptor) {
                    events[eventName] = payloadType
                } else {
                    throw MilanoEngineError.invalidVocabulary(
                        rule: "component-event", detail: "\(path).\(eventName)")
                }
            }
        }

        let children: Bool
        switch object["children"] {
        case nil: children = false
        case .bool(let flag): children = flag
        default:
            throw MilanoEngineError.invalidVocabulary(rule: "component-children", detail: path)
        }

        let strict: Bool
        switch object["strict"] {
        case nil: strict = false
        case .bool(let flag): strict = flag
        default:
            throw MilanoEngineError.invalidVocabulary(rule: "component-strict", detail: path)
        }

        return Component(properties: properties, events: events, children: children, strict: strict)
    }
}
