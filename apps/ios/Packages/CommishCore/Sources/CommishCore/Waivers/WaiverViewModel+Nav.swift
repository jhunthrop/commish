import CommishAPI
import CommishDesign
import Foundation

/// The member's players at the chosen position over the free agents there (WaiverScreen.svelte compare):
/// the two heads and his rows.
public struct NavCompare: Equatable, Sendable {
    /// "Your TE".
    public let yours: String
    /// "Free at TE".
    public let free: String
    public let rows: [YoursRow]
}

/// The position cards as the screen's navigation (WaiverScreen.svelte, Lane 305): the cards in the toggle's
/// figures, the chosen one, the line over the comparison, the member's players there; a card chosen; the
/// toggle setting the cards and the list's order together; and the chosen position read again quietly
/// whenever the page's answer is replaced, so its list is never older than the cards.
public extension WaiverViewModel {
    /// The chosen card's key: a position, or All.
    var navKey: String {
        position?.rawValue ?? WaiverNav.all
    }

    /// The cards in the toggle's figures, none before an answer.
    var nav: [NavCard] {
        model?.nav(panelMode) ?? []
    }

    /// Whether the toggle is drawn: the answer reads this week's figures.
    var navHasWeek: Bool {
        model?.navHasWeek ?? false
    }

    /// The line over the comparison.
    var lead: NavLead? {
        model?.lead(navKey, mode: panelMode)
    }

    /// The member's players at the chosen position over its free agents; nil for All or a position the
    /// answer carries no card for.
    var compare: NavCompare? {
        guard let model, let position, model.advice.positions?.contains(where: {
            WaiverNav.position($0) == position.rawValue
        }) == true else {
            return nil
        }
        let word = StartRows.positionWord(position.rawValue)
        return NavCompare(
            yours: WaiverNav.yours(word), free: WaiverNav.freeAt(word),
            rows: model.yours(position.rawValue, mode: panelMode)
        )
    }

    /// The line the table says when it holds no row: a chosen position with no free agent there, else the
    /// search's none found.
    var empty: String {
        compare != nil && query.isEmpty ? Words.WaiverPanel.noneFree : Words.Waivers.noneFound
    }

    /// A card chosen: All, or a position read of its own.
    func choose(nav key: String, leagueID: String) async {
        userChose = true
        await choose(position: key == WaiverNav.all ? nil : WaiverPosition(rawValue: key), leagueID: leagueID)
    }

    /// The card the screen opens on: the answer's weakest Need, else All. A saved answer's opening gives way
    /// to the fresh one's (review 308 M1).
    func open(on advice: WaiverAdvice) {
        let opening = WaiverNav.opening(advice)
        let next = opening == WaiverNav.all ? nil : WaiverPosition(rawValue: opening)
        if next != position {
            narrowed = nil
        }
        position = next
    }

    /// The toggle: the cards' figures and the list's order together (ruling 4).
    func choose(panelMode mode: PanelMode) {
        panelMode = mode
        sort = WaiverNav.sort(mode)
    }

    /// The answer the table draws (WaiverScreen.svelte shown): the chosen position's own read, less anyone
    /// the page's fresher answer has on the member's roster; until it lands the page's rows at the position;
    /// the page's own for All.
    func shownAnswer(_ page: WaiverAdvice) -> WaiverAdvice? {
        if let narrowed {
            var kept = WaiverNav.withoutRostered(narrowed.advice, roster: page.roster)
            kept.roster = page.roster
            return kept
        }
        return position.map { WaiverNav.atPosition(page, key: $0.rawValue) }
    }

    /// The chosen position read again without dimming its rows or closing an open Add (WaiverScreen.svelte
    /// topUp): once a page's answer lands, after a claim too. An unchanged answer reads it no second time. A
    /// failed top-up keeps the position's own list where it has one, saying nothing; with none yet, the
    /// page's rows there stay and the line says so.
    func topUp(leagueID: String) async {
        guard let key = position, let page = pageAdvice else {
            return
        }
        let mark = WaiverNav.mark(page)
        guard mark != toppedFor else {
            return
        }
        toppedFor = mark
        latestNarrowing += 1
        let mine = latestNarrowing
        do {
            let answer = try await api.waivers(id: leagueID, position: key)
            guard mine == latestNarrowing, position == key else {
                return
            }
            reading = false
            narrowed = (answer, now)
            problem = nil
            redraw()
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            guard mine == latestNarrowing, position == key else {
                return
            }
            reading = false
            toppedFor = nil
            if narrowed == nil {
                problem = WaiverNav.firstRead(StartRows.positionWord(key.rawValue))
            }
        }
    }
}
