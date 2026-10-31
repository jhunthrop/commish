import CommishAPI
import Foundation

/// A fixture run as the API's run routes answer it (Lane 185, api/internal/runs), for the tests: a
/// folder in the bucket's layout under shared/fixtures, its manifest, a format's board split as the API
/// splits it (the ranked rows, then the kickers and defenses, each in the file's order), the ADP's
/// sources, the clubs and the designations, each in the API's envelope. Two runs: the contract run (in season,
/// the rest of the season from week 7) and the stand-in before the draft (tiers, drops, the Gap).
public struct RunFixture: Sendable {
    /// The contract run, shared/fixtures/run: in season, four players.
    public static let contract = RunFixture(folder: "run")
    /// The stand-in, shared/fixtures/standin-run: the PPR board of the full season, before the draft.
    public static let standIn = RunFixture(folder: "standin-run")

    /// The environment variable naming a folder that stands in for shared/fixtures: the App Store
    /// screenshots read a copy with the recorded league's names replaced (apps/ios/scripts/store-shots.ts).
    public static let fixturesVariable = "COMMISH_FIXTURES"

    /// The repository's shared/fixtures, found from this file's place in it, or the folder
    /// `COMMISH_FIXTURES` names.
    public static let fixtures = ProcessInfo.processInfo.environment[fixturesVariable]
        .map { URL(fileURLWithPath: $0).standardized }
        ?? URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../../../../shared/fixtures")
        .standardized

    let folder: String

    /// The run the folder's latest pointer names.
    public var runID: String {
        get throws {
            let pointer = try object(at: "runs/latest.json")
            guard let runID = pointer["runId"] as? String else {
                throw FixtureError.unreadable("runs/latest.json")
            }
            return runID
        }
    }

    // MARK: The answers' bytes, envelope and all

    public func manifestAnswer() throws -> Data {
        try envelope(["run_id": runID, "manifest": runFile("manifest.json")])
    }

    /// The folder holds a board for the format.
    public func hasBoard(format: String) throws -> Bool {
        let url = try Self.fixtures.appendingPathComponent(folder)
            .appendingPathComponent("runs/\(runID)/boards/\(format).json")
        return FileManager.default.fileExists(atPath: url.path)
    }

    public func boardAnswer(format: String) throws -> Data {
        let file = try runFile("boards/\(format).json")
        let rows = file["rows"] as? [[String: Any]] ?? []
        let market = rows.filter { $0["orderBasis"] as? String == "market" }
        let ranked = rows.filter { $0["orderBasis"] as? String != "market" }
        return try envelope(["run_id": runID, "format": format, "rows": ranked, "market": market])
    }

    public func adpAnswer() throws -> Data {
        try envelope(["run_id": runID, "adp": runFile("adp.json")])
    }

    public func clubsAnswer() throws -> Data {
        try envelope(["run_id": runID, "clubs": runArray("clubs.json")])
    }

    public func designationsAnswer() throws -> Data {
        try envelope(["run_id": runID, "designations": runFile("designations.json")])
    }

    // MARK: The answers read as the app reads them

    public func manifest() throws -> RunManifest {
        try APIDecoding.envelopeData(Components.Schemas.RunManifestAnswer.self, from: manifestAnswer()).manifest
    }

    public func board(format: String) throws -> RunBoardAnswer {
        try APIDecoding.envelopeData(RunBoardAnswer.self, from: boardAnswer(format: format))
    }

    public func adpSources() throws -> [RunAdpSource] {
        try APIDecoding.envelopeData(Components.Schemas.RunAdpAnswer.self, from: adpAnswer()).adp.sources
    }

    public func clubs() throws -> [RunClub] {
        try APIDecoding.envelopeData(Components.Schemas.RunClubsAnswer.self, from: clubsAnswer()).clubs
    }

    public func designations() throws -> RunDesignations? {
        try APIDecoding.envelopeData(Components.Schemas.RunDesignationsAnswer.self, from: designationsAnswer())
            .designations?.value1
    }

    /// The ETag the API gives a file of this run: weak, the run id and the file.
    public func tag(_ file: String) throws -> String {
        try #"W/"\#(runID)/\#(file)""#
    }

    // MARK: Reading the folder

    private func runFile(_ path: String) throws -> [String: Any] {
        try object(at: "runs/\(runID)/\(path)")
    }

    private func runArray(_ path: String) throws -> [Any] {
        let url = try Self.fixtures.appendingPathComponent(folder).appendingPathComponent("runs/\(runID)/\(path)")
        guard let array = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [Any] else {
            throw FixtureError.unreadable(path)
        }
        return array
    }

    private func object(at path: String) throws -> [String: Any] {
        let url = Self.fixtures.appendingPathComponent(folder).appendingPathComponent(path)
        guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else {
            throw FixtureError.unreadable(path)
        }
        return object
    }

    private func envelope(_ data: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "ok": true, "data": data, "error": NSNull(), "request_id": "fixture",
        ])
    }

    public enum FixtureError: Error {
        case unreadable(String)
    }
}

/// The run routes over a fixture run, as the API answers them: each file with its ETag, unchanged
/// (304) when the read names that ETag, and every read failing with no signal while `offline`.
public struct StubRun: RunAPI {
    public let fixture: RunFixture
    public let offline: Bool

    public init(_ fixture: RunFixture, offline: Bool = false) {
        self.fixture = fixture
        self.offline = offline
    }

    public func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try read("manifest.json", tag: tag) { try fixture.manifest() }
    }

    public func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        // The API answers 404 for a format the run does not carry (Lane 185).
        guard try fixture.hasBoard(format: format) || offline else {
            throw APIError.envelope(code: "not_found", message: "The run has no board for this format.")
        }
        return try read("boards/\(format).json", tag: tag) { try fixture.board(format: format) }
    }

    public func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        try read("adp.json", tag: tag) { try fixture.adpSources() }
    }

    public func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try read("designations.json", tag: tag) { try fixture.designations() }
    }

    public func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        try read("clubs.json", tag: tag) { try fixture.clubs() }
    }

    private func read<Value: Sendable>(
        _ file: String, tag: String?, _ value: () throws -> Value
    ) throws -> RunRead<Value> {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        let current = try fixture.tag(file)
        return tag == current ? .unchanged(tag: current) : try .fresh(value(), tag: current)
    }
}
