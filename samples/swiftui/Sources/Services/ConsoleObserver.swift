import Foundation
import MilanoSDK

/// Logs every occurrence the engine reports: the sample's telemetry.
final class ConsoleObserver: MilanoObserver {
    func occurrence(_ occurrence: MilanoOccurrence) {
        print("[milano] \(occurrence.kind.rawValue) view=\(occurrence.viewIdentity) node=\(occurrence.node ?? "-")")
    }
}

/// The sample's analytics sink: a real app would forward each record to
/// its tracker; the sample logs it. Milano implements no tracker.
final class ConsoleAnalytics: MilanoUserInteractionObserver {
    func interaction(_ interaction: MilanoUserInteraction) {
        let node = interaction.node ?? "-"
        let name = interaction.name ?? "-"
        print("[analytics] \(interaction.kind) view=\(interaction.viewIdentity) node=\(node) name=\(name)")
    }
}
