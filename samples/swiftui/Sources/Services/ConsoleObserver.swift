import Foundation
import MilanoSDK

/// Logs every occurrence the engine reports: the sample's telemetry.
final class ConsoleObserver: MilanoObserver {
    func occurrence(_ occurrence: MilanoOccurrence) {
        print("[milano] \(occurrence.kind.rawValue) view=\(occurrence.viewIdentity) node=\(occurrence.node ?? "-")")
    }
}
