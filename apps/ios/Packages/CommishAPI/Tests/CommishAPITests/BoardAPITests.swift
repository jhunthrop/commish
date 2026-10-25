import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Board's route through the generated client: the API's PPR board as the fixture API answers it
/// (every player with his position rank, his figures and his status on the newest capture), the path
/// each format is read from, an older answer without the later fields, and a refusal in the API's words.
struct BoardAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    static let file = "boards-ppr.json"

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    @Test func thePPRBoardReadsEveryPlayerWithHisRankAndStatus() async throws {
        let board = try await Self.client(AnswerTransport(status: .ok, body: LineupAPITests.answered(Self.file)))
            .board(format: .ppr)
        #expect(board.format.value1 == .ppr)
        #expect(board.season == 2026)
        #expect(!board.basis.isEmpty)
        #expect(board.statusRead != nil)
        #expect(board.players.count > 1000)
        let first = try #require(board.players.first)
        #expect(first.positionRank == 1)
        #expect(board.players.contains { $0.status?.seasonLong == true })
        #expect(board.players.contains { $0.position.value1 == .def && $0.vor == nil })
    }

    @Test(arguments: [BoardFormat.ppr, .half, .std])
    func eachFormatIsReadFromItsPath(format: BoardFormat) async throws {
        let transport = try RecordingTransport(status: .ok, body: LineupAPITests.answered(Self.file))
        _ = try await Self.client(transport).board(format: format)
        let sent: [RecordingTransport.Sent] = await transport.sent
        #expect(sent.map(\.method) == [HTTPRequest.Method.get])
        #expect(sent.map(\.path) == ["/boards/\(format.rawValue)"])
    }

    @Test func anOlderAnswerWithoutTheStatusesAndTheGapStillReads() throws {
        let json = #"""
        {"ok":true,"data":{"format":"ppr","season":2026,"as_of":"2026-09-09T02:20:29Z","basis":"B","players":[
        {"id":"1","name":"A B","position":"WR","team":"DET","headshot":"","adp":null,"points":10.5,"vor":1.5,
        "position_rank":1,"bye":null}]},"error":null,"request_id":"r"}
        """#
        let board = try APIDecoding.envelopeData(RoomBoard.self, from: Data(json.utf8))
        #expect(board.statusRead == nil)
        #expect(board.players.first?.gap == nil)
        #expect(board.players.first?.status == nil)
    }

    @Test func aRefusalSaysTheAPIsSentence() async throws {
        let refused = LineupAPITests.problem("bad_request", "No such format.")
        await #expect(throws: APIError.envelope(code: "bad_request", message: "No such format.")) {
            _ = try await Self.client(AnswerTransport(status: .badRequest, body: refused)).board(format: .ppr)
        }
    }
}
