import CommishAPI
import Foundation
import Observation

/// A reference screen's view model (ADP, compare, the clubs, a club, the schedule; the Board's pattern):
/// the run's routes, the cache and the clock injected; each file read naming the ETag kept, a 304
/// keeping the copy; with no answer the saved files stand, the screen stale with its stamp and reason;
/// a refused token signs out. What the screen is built from is its `build`, which a chip or a pick
/// replaces; a build that lands after a newer one is dropped. The view decides nothing.
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

    /// The screen's files, read now or as last saved.
    public func load() async {
        generation += 1
        let mine = generation
        do {
            let built = try await build(reads)
            guard mine == generation else {
                return
            }
            manifest = built.manifest
            state = .loaded(built.model, Freshness.of(built.reads) ?? Freshness(stamp: .distantPast, saved: nil))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard mine == generation else {
                return
            }
            state = .failed(LeagueHomeViewModel.sentence(for: error))
        }
    }

    /// Another build for the same screen (a format chip, a player picked): drawn once its files are read.
    func rebuild(_ build: @escaping Build) async {
        self.build = build
        await load()
    }
}
