import CommishAPI
@testable import CommishCore
import Foundation

/// The fixture's trades and the checks, counted; or failing as told.
actor TradesStub: TradesAPI {
    private let advice: TradeAdvice
    private let check: TradeCheck?
    private var failure: (any Error)?
    private var checkFailure: (any Error)?
    private(set) var reads: [String?] = []
    private(set) var checked: [TradeCheckInput] = []

    init(advice: TradeAdvice, check: TradeCheck?) {
        self.advice = advice
        self.check = check
    }

    func fail(_ error: (any Error)?) {
        failure = error
    }

    func failCheck(_ error: (any Error)?) {
        checkFailure = error
    }

    func trades(id _: String, player: String?) async throws -> TradeAdvice {
        reads.append(player)
        if let failure {
            throw failure
        }
        return advice
    }

    func checkTrade(id _: String, trade: TradeCheckInput) async throws -> TradeCheck? {
        checked.append(trade)
        if let checkFailure {
            throw checkFailure
        }
        return check
    }
}

/// The fixture's check held at a gate per trade until the test lets it through, so two checks can land
/// out of order; a check whose task is cancelled while it waits is counted as cancelled.
actor GatedTrades: TradesAPI {
    private let advice: TradeAdvice
    private let check: TradeCheck
    private var open: Set<[String]> = []
    private(set) var asked: [[String]] = []
    private(set) var cancelled: [[String]] = []

    init(advice: TradeAdvice, check: TradeCheck) {
        self.advice = advice
        self.check = check
    }

    func release(_ get: [String]) {
        open.insert(get)
    }

    func trades(id _: String, player _: String?) async throws -> TradeAdvice {
        advice
    }

    func checkTrade(id _: String, trade: TradeCheckInput) async throws -> TradeCheck? {
        asked.append(trade.get)
        while !open.contains(trade.get) {
            do {
                try await Task.sleep(for: .milliseconds(2))
            } catch {
                cancelled.append(trade.get)
                throw error
            }
        }
        return check
    }
}
