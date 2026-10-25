import CommishAPI
import Foundation
import Observation

/// What a screen's member last asked for while its read may still be in flight: ADP's format, or
/// Compare's sides and format. Each tap builds on it, never on the screen still shown, so a tap made
/// during a read is not lost (review M1).
enum ScreenAsk: Equatable, Sendable {
    case adp(format: String)
    case compare(CompareAsk)
}

/// A reference screen's view model (ADP, compare, the clubs, a club, the schedule; the Board's pattern):
/// the run's routes, the cache and the clock injected; each file read naming the ETag kept, a 304
/// keeping the copy; with no answer the saved files stand, the screen stale with its stamp and reason;
/// a refused token signs out. What the screen is built from is its `build`; a chip or a pick builds
/// anew from the newest ask, a build that lands after a newer one is dropped, and one that fails over
/// a shown screen leaves that screen and its build standing with a one-line notice (review M2). The
/// view decides nothing.
@MainActor
@Observable
public final class RunScreenViewModel<Model: Equatable & Sendable> {
    public enum State: Equatable, Sendable {
        case loading
        case loaded(Model, Freshness)
        case failed(String)
    }

    typealias Build = @Sendable (RunReads) async throws -> BuiltScreen<Model>

    public private(set) var state: State = .loading
    /// Said over a shown screen when a chip or a pick could not be built: the web's words for a format
    /// the run lacks, or why the read failed. Cleared by the next screen built.
    public private(set) var notice: String?
    /// The member's newest ask, nil once the screen shown is the one asked for.
    private(set) var ask: ScreenAsk?
    private var build: Build
    private let reads: RunReads
    let zone: TimeZone
    var clock: any Clock {
        reads.files.clock
    }

    private let onSignedOut: @MainActor () -> Void
    /// The manifest of the screen shown: its day for the offline words.
    private var manifest: RunManifest?
    /// The newest build asked for; an older one's answer is not shown.
    private var generation = 0

    init(reads: RunReads, zone: TimeZone, onSignedOut: @escaping @MainActor () -> Void, build: @escaping Build) {
        self.reads = reads
        self.zone = zone
        self.onSignedOut = onSignedOut
        self.build = build
    }

    /// Said over a screen drawn from saved files: "You're offline, so this is the last board this
    /// device saved, updated Oct 21." with no connection, "Last read Sat 12:00 pm" when a read failed
    /// another way; nil for this open's read.
    public var stampWords: String? {
        guard case let .loaded(_, freshness) = state, let saved = freshness.saved, let manifest else {
            return nil
        }
        switch saved {
        case .offline: return RunWords.offline(manifest)
        case .failed: return AppWords.lastRead(freshness.stamp, zone: zone)
        }
    }

    /// What the screen's head says over it: the notice of a chip that failed, else the saved read's reason.
    public var staleWords: String? {
        notice ?? stampWords
    }

    /// The screen's files, read now or as last saved.
    public func load() async {
        await run(build, replacing: false)
    }

    /// Another build for the same screen (a format chip, a player picked) for the newest `ask`: drawn
    /// once its files are read; a failure over a shown screen keeps it, with `absent` said for a file
    /// the API refused (a format the run lacks), else why the read failed.
    func rebuild(_ build: @escaping Build, ask: ScreenAsk, absent: String? = nil) async {
        self.ask = ask
        await run(build, replacing: true, absent: absent)
    }

    private func run(_ build: @escaping Build, replacing: Bool, absent: String? = nil) async {
        generation += 1
        let mine = generation
        do {
            let built = try await build(reads)
            guard mine == generation else {
                return
            }
            self.build = build
            ask = nil
            notice = nil
            manifest = built.manifest
            state = .loaded(built.model, Freshness.of(built.reads) ?? Freshness(stamp: .distantPast, saved: nil))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard mine == generation else {
                return
            }
            ask = nil
            if replacing, case .loaded = state {
                notice = RunFiles.refused(error) ? absent ?? LeagueHomeViewModel.sentence(for: error)
                    : LeagueHomeViewModel.sentence(for: error)
            } else {
                self.build = build
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }
}

public extension [BoardChip<String>] {
    /// The chips with `value` pressed: the format the member last tapped while its read is in flight.
    func pressing(_ value: String?) -> [BoardChip<String>] {
        guard let value else {
            return self
        }
        return map { BoardChip(label: $0.label, value: $0.value, pressed: $0.value == value) }
    }
}
