import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The live check, run by hand against a dev API serving the published run (LIVE_API_URL, as
/// http://localhost:18190): the run read once through the app's client, every view of every format the
/// run carries built, then read again naming the kept ETags, every file a 304. Skipped without the URL.
@MainActor
struct LiveRunTests {
    nonisolated static let api = ProcessInfo.processInfo.environment["LIVE_API_URL"].flatMap(URL.init(string:))

    struct NoToken: TokenSource {
        func token() async -> String? {
            nil
        }
    }

    @Test(.enabled(if: api != nil))
    func theLiveRunReadsDrawsEveryViewAndAnswers304sToItsETags() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: NoToken())
        let read = try await RunBoardReader.read(client, format: nil, kept: nil)
        let manifest = read.manifest.value
        print("live run \(manifest.runId), formats \(manifest.formats.map(\.id))")
        print("rows \(read.board.value.rows.count), market \(read.board.value.market.count)")
        let now = Date()
        for position in [nil] + BoardPosition.allCases.map(Optional.some) {
            let model = BoardModel(
                read: read, position: position, inSeason: true, following: false, now: now, zone: .current
            )
            #expect(!model.rows.isEmpty, "\(position?.rawValue ?? "All")")
            print("\(position?.rawValue ?? "All"): \(model.rows.count) rows, \(model.sections.count) sections")
            if let band = model.sections.first?.band {
                print("  \(band.name) \(band.count) \(band.cliff)")
            }
            print("  " + model.basis.joined(separator: " | "))
        }
        let all = BoardModel(read: read, position: nil, inSeason: true, following: false, now: now, zone: .current)
        print("head: \(all.words.heading) / \(all.stamp) / \(all.restLine ?? "-")")
        let counting = Counted(client)
        _ = try await RunBoardReader.read(counting, format: nil, kept: read)
        #expect(await counting.unchanged == 5)
    }
}

/// The client, counting the reads that came back unchanged.
actor Counted: RunAPI {
    let client: APIClient
    private(set) var unchanged = 0

    init(_ client: APIClient) {
        self.client = client
    }

    func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try await count(client.manifest(tag: tag))
    }

    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        try await count(client.board(format: format, tag: tag))
    }

    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        try await count(client.adpSources(tag: tag))
    }

    func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try await count(client.designations(tag: tag))
    }

    func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        try await count(client.clubs(tag: tag))
    }

    private func count<Value>(_ read: RunRead<Value>) -> RunRead<Value> {
        if case .unchanged = read {
            unchanged += 1
        }
        return read
    }
}
