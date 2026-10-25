import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The player sheet's view model (the web's shelf, PlayerShelf.svelte): the run's routes, the week's,
/// the cache and the clock injected. It holds the player it opened on, by his id, whatever the list
/// under the sheet does (plan Review Focus 3); finds his page in the run by his slug; reads the run's
/// manifest and capture and his week (the league's with one followed), each run file naming the ETag
/// kept so an unchanged run costs 304s; and shows the card, with the saved reads and their stamp when
/// there is no answer. The view decides nothing.
@MainActor
@Observable
public final class PlayerSheetViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// His card, when its reads were made, and why they are saved ones, nil for this open's.
        case loaded(PlayerCard, Freshness)
        /// The basis the shelf says when his week cannot be read.
        case failed(String)
    }

    /// The player the sheet opened on: the sheet shows him until it closes.
    public let player: SheetPlayer
    public private(set) var state: State = .loading

    private let lookup: PlayerLookup
    private let weeks: WeekReader
    private let clock: any Clock
    private let league: FollowedLeague?
    private let zone: TimeZone
    private let onSignedOut: @MainActor () -> Void

    public init(
        player: SheetPlayer, run: any RunAPI, pages: any RunPagesAPI, weeks: any PlayerWeekAPI,
        cache: any AnswerCache, clock: any Clock, league: FollowedLeague?, zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.player = player
        let files = RunFiles(cache: cache, clock: clock)
        lookup = PlayerLookup(files: files, run: run, pages: pages)
        self.weeks = WeekReader(weeks: weeks, cache: cache, clock: clock)
        self.clock = clock
        self.league = league
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// "Last read Sun 3:05 pm" over a card drawn from saved reads; nil for this open's.
    public var stampWords: String? {
        guard case let .loaded(_, freshness) = state, freshness.saved != nil else {
            return nil
        }
        return AppWords.lastRead(freshness.stamp, zone: zone)
    }

    /// His card from the run and his week; a refused token signs out; with no week read and none saved,
    /// the shelf's words for a week that could not be read.
    public func load() async {
        do {
            let (index, entry) = try await lookup.entry(slug: player.slug)
            guard let entry else {
                state = .failed(PlayerSheetWords.unreadBasis(failed: true, weekTile: Words.Card.proj))
                return
            }
            async let manifest = lookup.manifest()
            async let capture = lookup.designations()
            async let week = weeks.read(player: entry.id, league: league)
            let (read, inLeague) = try await week
            let runManifest = try await manifest
            let runCapture = try? await capture
            let (source, sourceReads) = await (try? lookup.source(entry, manifest: runManifest.value)) ?? (nil, [])
            let page = Self.page(source)
            let format = page.flatMap { page in
                runManifest.value.formats.first { page.formats.additionalProperties[$0.id] != nil }
            }
            let card = PlayerCards.card(CardInput(
                week: read.value, page: page, format: format, season: runManifest.value.season,
                capture: runCapture.flatMap(\.value), league: inLeague, zone: zone, now: clock.now
            ))
            let reads = [(index.stamp, index.saved), (runManifest.stamp, runManifest.saved), (read.stamp, read.saved)]
                + sourceReads + (runCapture.map { [($0.stamp, $0.saved)] } ?? [])
            state = .loaded(card, Freshness.of(reads) ?? Freshness(stamp: clock.now, saved: nil))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            state = .failed(PlayerSheetWords.unreadBasis(failed: true, weekTile: Words.Card.proj))
        }
    }

    /// His page, or an earlier run's copy of it; nil for the board's figures alone, which hold no read.
    static func page(_ source: PageSource?) -> RunPlayer? {
        switch source {
        case let .page(page), let .copy(page, _): page
        case .facts, nil: nil
        }
    }
}
