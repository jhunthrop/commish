import Foundation

/// The one source of "now": every time-dependent function takes a clock, the app the system's and a
/// test a fixed one, so a screen drawn at a fixture clock is the same on every run.
public protocol Clock: Sendable {
    var now: Date { get }
}

public struct SystemClock: Clock {
    public init() {}

    public var now: Date {
        Date()
    }
}

public struct FixedClock: Clock {
    public let now: Date

    public init(_ now: Date) {
        self.now = now
    }
}
