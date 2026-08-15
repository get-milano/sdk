import Foundation
import Testing

@testable import MilanoSDK

/// Conformance groundwork: locate the specs repository, discover suites, and
/// decode every vector's envelope. Vector execution lives in VectorRunnerTests.
enum SpecsLocator {
    /// `MILANO_SPECS_DIR` wins; otherwise the sibling `specs` checkout.
    static func specsDirectory() -> URL? {
        let fm = FileManager.default
        if let env = ProcessInfo.processInfo.environment["MILANO_SPECS_DIR"], !env.isEmpty {
            let url = URL(fileURLWithPath: env, isDirectory: true)
            return fm.fileExists(atPath: url.path) ? url : nil
        }
        // #filePath: .../sdk/engine/swiftui/Tests/MilanoSDKTests/ConformanceHarnessTests.swift
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }  // -> .../get-milano (parent of both repos)
        url.appendPathComponent("specs", isDirectory: true)
        return fm.fileExists(atPath: url.path) ? url : nil
    }

    static func suiteDirectories() throws -> [URL] {
        guard let specs = specsDirectory() else { return [] }
        let conformance = specs.appendingPathComponent("conformance", isDirectory: true)
        let entries = try FileManager.default.contentsOfDirectory(
            at: conformance, includingPropertiesForKeys: [.isDirectoryKey])
        return entries.filter { url in
            (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                && FileManager.default.fileExists(
                    atPath: url.appendingPathComponent("vocabulary.json").path)
        }
    }
}

struct ConformanceHarnessTests {

    @Test func specsRepositoryIsDiscoverable() throws {
        let specs = try #require(SpecsLocator.specsDirectory())
        let conformance = specs.appendingPathComponent("conformance")
        #expect(FileManager.default.fileExists(atPath: conformance.path))
    }

    @Test func suitesExist() throws {
        let suites = try SpecsLocator.suiteDirectories()
        #expect(!suites.isEmpty)
    }

    @Test func everyVocabularyDecodes() throws {
        for suite in try SpecsLocator.suiteDirectories() {
            let data = try Data(contentsOf: suite.appendingPathComponent("vocabulary.json"))
            let json = try JSONSerialization.jsonObject(with: data)
            let artifact = try #require(json as? [String: Any])
            #expect(artifact["milano"] is String)
            #expect(artifact["name"] is String)
            #expect(artifact["version"] is String)
            #expect(artifact["components"] is [String: Any])
        }
    }

    @Test func everyVectorEnvelopeDecodes() throws {
        var vectorCount = 0
        for suite in try SpecsLocator.suiteDirectories() {
            let files = try FileManager.default.contentsOfDirectory(
                at: suite, includingPropertiesForKeys: nil
            )
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != "vocabulary.json" }

            for file in files {
                let data = try Data(contentsOf: file)
                let json = try JSONSerialization.jsonObject(with: data)
                let vector = try #require(
                    json as? [String: Any], "\(file.lastPathComponent) is not an object")

                #expect(vector["name"] is String, "\(file.lastPathComponent): name")
                #expect(vector["expect"] is [String: Any], "\(file.lastPathComponent): expect")

                let hasDocument = vector["document"] is [String: Any]
                let hasDocumentText = vector["documentText"] is String
                #expect(
                    hasDocument != hasDocumentText,
                    "\(file.lastPathComponent): exactly one of document/documentText")
                vectorCount += 1
            }
        }
        #expect(vectorCount > 0)
    }
}
