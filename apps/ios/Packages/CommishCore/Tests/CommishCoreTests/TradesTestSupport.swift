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
