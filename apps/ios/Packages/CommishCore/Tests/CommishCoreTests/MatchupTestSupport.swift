import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// Waits, a little at a time, until `condition` holds; fails the test after about two seconds.
@MainActor
func eventually(_ condition: () async -> Bool) async throws {
    for _ in 0 ..< 400 {
        if await condition() {
            return
        }
        try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("The condition never held.")
}

/// Lets every task that could run run.
@MainActor
func settle() async {
    for _ in 0 ..< 20 {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
}

/// The poll's timer by hand: each sleep is kept until the test ticks it, its interval recorded; a
/// cancelled sleep throws at once.
actor ManualTimer: PollTimer {
    private(set) var intervals: [Duration] = []
    private var waiting: [UUID: CheckedContinuation<Void, any Error>] = [:]
    private var cancelled: Set<UUID> = []

    var sleepers: Int {
        waiting.count
    }

    func sleep(for interval: Duration) async throws {
        intervals.append(interval)
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                if cancelled.remove(id) != nil {
                    continuation.resume(throwing: CancellationError())
                } else {
                    waiting[id] = continuation
                }
            }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }

    func tick() {
        let due = waiting.values
        waiting = [:]
        for continuation in due {
            continuation.resume()
        }
    }

    private func cancel(_ id: UUID) {
        if let continuation = waiting.removeValue(forKey: id) {
            continuation.resume(throwing: CancellationError())
        } else {
            cancelled.insert(id)
        }
    }
}

/// The Matchup's two reads as the fixture answers them at a clock, counted; or failing as told.
actor MatchupStub: MatchupAPI {
    private let answer: MatchupAnswer
    private let box: Bool
    private var failure: (any Error)?
    private(set) var reads = 0

    init(answer: MatchupAnswer, box: Bool = true) {
        self.answer = answer
        self.box = box
    }

    func fail(_ error: (any Error)?) {
        failure = error
    }

    func leagueSync(id _: String) async throws -> LeagueSync {
        reads += 1
        if let failure {
            throw failure
        }
        return answer.sync
    }

    func matchup(id _: String) async throws -> MatchupBox? {
        if let failure {
            throw failure
        }
        return box ? answer.box : nil
    }
}
