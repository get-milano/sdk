import Foundation

/// A parsed, validated vocabulary artifact: the consumer's component types,
/// events, global custom actions, and host functions, per the vocabulary
/// schema spec.
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
        /// The failure completion's payload type (contract 2.1); `nil`
        /// means a failure carries no data (vocabulary schema spec,
        /// failure payloads).
        var failure: MilanoType?
    }

    /// A host function declaration (contract 2.1; vocabulary schema spec,
    /// Function declarations): its argument types in order, and its
    /// return type.
    struct Function: Equatable, Sendable {
        let arguments: [MilanoType]
        let returns: MilanoType
    }

    /// The contract version the artifact targets (major, minor).
    let contractMajor: Int
    let contractMinor: Int
    let name: String
    /// Consumer-owned; surfaced in observability, never interpreted.
    let version: String
    let components: [String: Component]
    let actions: [String: Action]
    /// The declared host functions (contract 2.1), by name.
    var functions: [String: Function] = [:]
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
        // Same versioning rule as documents: an artifact targeting a contract
        // version the engine does not implement fails fast at creation.
        guard MilanoGate.isSupported(major: major, minor: minor) else {
            throw MilanoEngineError.invalidVocabulary(
                rule: "milano-version",
                detail: "unsupported contract version \(milano); supported: "
                    + MilanoGate.supportedRanges.joined(separator: ", "))
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
                actions[actionName] = try Self.action(
                    from: declaration, at: actionName, contract: (major, minor))
            }
        }

        self.init(
            contractMajor: major, contractMinor: minor,
            name: name, version: vocabularyVersion,
            components: components, actions: actions,
            functions: try Self.functions(from: root["functions"], contract: (major, minor)))
    }

    /// The artifact's `functions` section (contract 2.1): the declared
    /// version is a floor the artifact holds itself to, so a section in an
    /// artifact declaring an earlier contract is rejected before it is
    /// read. Names are walked in order, so the first defect wins.
    private static func functions(
        from entry: MilanoValue?, contract: (major: Int, minor: Int)
    ) throws -> [String: Function] {
        guard let entry else { return [:] }
        guard MilanoContractFeatures.has("functions", major: contract.major, minor: contract.minor) else {
            throw MilanoEngineError.invalidVocabulary(
                rule: "contract-feature",
                detail: "functions need contract " + MilanoContractFeatures.version(of: "functions"))
        }
        guard case .record(let functionsJSON) = entry else {
            throw MilanoEngineError.invalidVocabulary(rule: "functions", detail: "functions is not an object")
        }
        var functions: [String: Function] = [:]
        for (functionName, declaration) in functionsJSON.byKey {
            guard MilanoIdentifier.isValid(functionName) else {
                throw MilanoEngineError.invalidVocabulary(rule: "function-name", detail: functionName)
            }
            functions[functionName] = try function(from: declaration, at: functionName)
        }
        return functions
    }

    /// Parses one host function declaration. Any identifier will do: the
    /// contract's own functions are called through the `$` namespace, so a
    /// vocabulary declaring `round` gets its own `round(...)` beside
    /// `$round(...)` and can never be shadowed. An empty argument list is
    /// refused (`function-arguments`: a function of no arguments would be
    /// a constant, or would read what its arguments do not carry).
    static func function(from declaration: MilanoValue, at path: String) throws -> Function {
        guard case .record(let object) = declaration else {
            throw MilanoEngineError.invalidVocabulary(rule: "function", detail: "\(path) is not an object")
        }
        guard case .array(let descriptors)? = object["arguments"], !descriptors.isEmpty else {
            throw MilanoEngineError.invalidVocabulary(rule: "function-arguments", detail: path)
        }
        var arguments: [MilanoType] = []
        for descriptor in descriptors {
            guard let type = MilanoType(descriptor: descriptor) else {
                throw MilanoEngineError.invalidVocabulary(rule: "function-argument", detail: path)
            }
            arguments.append(type)
        }
        guard let returnsEntry = object["returns"], let returns = MilanoType(descriptor: returnsEntry) else {
            throw MilanoEngineError.invalidVocabulary(rule: "function-returns", detail: path)
        }
        return Function(arguments: arguments, returns: returns)
    }

    /// Parses one custom action declaration; shared with builder
    /// declarations, which use the same format. `contract` is the
    /// artifact's declared version, which gates the declarations a later
    /// minor introduced; builder declarations are code and always speak
    /// the engine's contract.
    static func action(
        from declaration: MilanoValue, at path: String,
        contract: (major: Int, minor: Int)? = nil
    ) throws -> Action {
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
        var failure: MilanoType?
        if let failureEntry = object["failure"] {
            // The artifact's declared version is a floor it holds itself
            // to: a failure payload needs contract 2.1.
            if let contract, !MilanoContractFeatures.has("failure", major: contract.major, minor: contract.minor) {
                throw MilanoEngineError.invalidVocabulary(
                    rule: "contract-feature",
                    detail: "\(path) declares a failure payload, which needs contract "
                        + MilanoContractFeatures.version(of: "failure"))
            }
            guard let type = MilanoType(descriptor: failureEntry) else {
                throw MilanoEngineError.invalidVocabulary(
                    rule: "action-failure", detail: path)
            }
            failure = type
        }
        return Action(parameters: parameters, result: result, failure: failure)
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
