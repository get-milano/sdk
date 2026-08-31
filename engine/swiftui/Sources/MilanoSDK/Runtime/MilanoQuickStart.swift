import Foundation

/// The quick path's construction: engine, registry, and builder in one
/// call, with declared state synthesized as zero-values so a first
/// integration is a single view. The full architecture (shared engine,
/// explicit providers) remains the recommended shape for real apps; the
/// synthesis itself is public, for providers that have nothing better
/// than a zero-value for some keys.
public enum MilanoQuickStart {

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
            synthesizedState(for: declarations, overriding: state)
        }
        if let onAction {
            builder.actionHandler(onAction)
        }
        return builder
    }

    /// Zero-values per declaration, overridden by supplied values. The
    /// zero is the contract's own (`MilanoType.zeroValue`), so a
    /// synthesized value is the same value an invalid function result of
    /// that type would produce. Enums are why that matters: this once
    /// took the alphabetically first member while the contract takes the
    /// first declared, so a preview could differ from the engine over the
    /// same declaration. Every value satisfies its declaration, so a
    /// provider built on this never fails the gate's data check. The same
    /// function on every engine.
    public static func synthesizedState(
        for declarations: [String: MilanoType], overriding supplied: [String: MilanoValue] = [:]
    ) -> [String: MilanoValue] {
        var values: [String: MilanoValue] = [:]
        for (key, type) in declarations {
            values[key] = supplied[key] ?? type.zeroValue
        }
        return values
    }

}
