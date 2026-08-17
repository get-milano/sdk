import Foundation

/// The quick path's construction: engine, registry, and builder in one
/// call, with declared state synthesized as zero-values so a first
/// integration is a single view. The full architecture (shared engine,
/// explicit providers) remains the recommended shape for real apps.
enum MilanoQuickStart {

    static func builder(
        document: Data,
        vocabulary: Data,
        renderers: [String: any MilanoRenderer],
        context: [String: MilanoValue],
        state: [String: MilanoValue],
        onAction: (@Sendable (MilanoAction) async throws -> MilanoValue?)?
    ) throws -> MilanoViewBuilder {
        var registry = MilanoRegistry()
        for (type, renderer) in renderers {
            registry.register(renderer, for: type)
        }
        let engine = try MilanoEngine(vocabularyJSON: vocabulary, registry: registry)
        let builder = engine.viewBuilder(document: document)
        builder.context(context)
        builder.stateData { declarations in
            synthesized(declarations, overriding: state)
        }
        if let onAction {
            builder.actionHandler(onAction)
        }
        return builder
    }

    /// Zero-values per declaration, overridden by supplied values: false,
    /// 0, 0.0, empty string; null for optionals; empty arrays; records
    /// recursed.
    static func synthesized(
        _ declarations: [String: MilanoType], overriding supplied: [String: MilanoValue]
    ) -> [String: MilanoValue] {
        var values: [String: MilanoValue] = [:]
        for (key, type) in declarations {
            values[key] = supplied[key] ?? zeroValue(for: type)
        }
        return values
    }

    private static func zeroValue(for type: MilanoType) -> MilanoValue {
        if type.optional { return .null }
        switch type.kind {
        case .bool: return .bool(false)
        case .int: return .int(0)
        case .double: return .double(0)
        case .string: return .string("")
        // The zero-value of an enum is its alphabetically first member:
        // deterministic, and always a valid member.
        case .enumeration(let members): return .string(members.sorted()[0])
        case .array: return .array([])
        case .record(let fields): return .record(fields.mapValues(zeroValue(for:)))
        }
    }
}
