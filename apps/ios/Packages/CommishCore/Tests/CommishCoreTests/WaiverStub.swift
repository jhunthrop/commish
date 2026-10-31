import CommishAPI
@testable import CommishCore
import Foundation

/// The Waivers routes as a stub over the fixture API's answers: each read answers the advice, the plan
/// the fixture's plan with the bid asked for, the make the fixture's outcome (or no answer at all); each
/// call kept.
actor WaiverStub: WaiversAPI {
    struct Made: Sendable {
        let move: HostMoveInput
        let token: String
    }

    private var advice: WaiverAdvice
    /// A position's own read, by position: the page's rows at that position where none is given.
    private var positions: [WaiverPosition: WaiverAdvice]
    private var failsPosition = false
    private var failsPage = false
    private(set) var asked: [WaiverPosition?] = []
    private let plan: HostMovePlan?
    private let result: HostMoveResult?
    private var failsMake = false
    private(set) var reads = 0
    private(set) var planned: [HostMoveInput] = []
    private(set) var made: [Made] = []

    init(
        advice: WaiverAdvice, positions: [WaiverPosition: WaiverAdvice] = [:], plan: HostMovePlan? = nil,
        result: HostMoveResult? = nil
    ) {
        self.advice = advice
        self.positions = positions
        self.plan = plan
        self.result = result
    }

    func failMake() {
        failsMake = true
    }

    /// The page's read fails (no signal) while set; a position's read is unchanged.
    func failPage(_ fails: Bool = true) {
        failsPage = fails
    }

    func failPosition(_ fails: Bool = true) {
        failsPosition = fails
    }

    /// The league as read from now on: the page's answer, and a position's own read.
    func answer(_ advice: WaiverAdvice, at position: WaiverPosition? = nil) {
        if let position {
            positions[position] = advice
        } else {
            self.advice = advice
        }
    }

    func waivers(id _: String, position: WaiverPosition?) async throws -> WaiverAdvice {
        asked.append(position)
        guard let position else {
            reads += 1
            if failsPage {
                throw URLError(.notConnectedToInternet)
            }
            return advice
        }
        if failsPosition {
            throw URLError(.notConnectedToInternet)
        }
        return positions[position] ?? advice
    }

    func planMove(id _: String, move: HostMoveInput) async throws -> HostMovePlan {
        planned.append(move)
        guard var answer = plan else {
            throw APIError.status(500)
        }
        if var bid = answer.bid?.value1, let asked = move.claim?.value1.bid {
            bid.amount = asked
            answer.bid = .init(value1: bid)
        }
        return answer
    }

    func makeMove(id _: String, move: HostMoveInput, confirm: String) async throws -> HostMoveResult {
        made.append(Made(move: move, token: confirm))
        guard !failsMake, let result else {
            throw URLError(.networkConnectionLost)
        }
        return result
    }
}
