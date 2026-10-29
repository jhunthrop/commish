import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a name opens the player sheet, an idea loads its ticks, "N more" shows
/// every idea, the switch shows a roster, the choice picks the team, a tick picks a player, the verb
/// copies the offer and Share the trade as text.
public struct TradeActions {
    let open: (SheetPlayer) -> Void
    let idea: (String) -> Void
    let more: () -> Void
    let show: (TradePicks.Side) -> Void
    let team: (Int) -> Void
    let tap: (TradePicks.Side, String) -> Void
    let press: () -> Void
    let share: () -> Void

    public init(
        open: @escaping (SheetPlayer) -> Void = { _ in }, idea: @escaping (String) -> Void = { _ in },
        more: @escaping () -> Void = {}, show: @escaping (TradePicks.Side) -> Void = { _ in },
        team: @escaping (Int) -> Void = { _ in }, tap: @escaping (TradePicks.Side, String) -> Void = { _, _ in },
        press: @escaping () -> Void = {}, share: @escaping () -> Void = {}
    ) {
        self.open = open
        self.idea = idea
        self.more = more
        self.show = show
        self.team = team
        self.tap = tap
        self.press = press
        self.share = share
    }
}

/// What the member has done on the screen: the builder at its picks and answer, the roster drawn, a
/// check being read, and the lines under the pressed verbs.
public struct TradesShown: Equatable {
    public let builder: TradeBuilderModel
    public let drawn: TradePicks.Side
    public let checking: Bool
    public let copied: CopiedLine?
    public let shared: String?

    public init(
        builder: TradeBuilderModel, drawn: TradePicks.Side = .give, checking: Bool = false,
        copied: CopiedLine? = nil, shared: String? = nil
    ) {
        self.builder = builder
        self.drawn = drawn
        self.checking = checking
        self.copied = copied
        self.shared = shared
    }
}

/// The Trades as one experience (TradeScreen.svelte at 390, builder-first since Lane 260, dense since
/// Lane 268): a saved read's stamp, our ideas row, the roster switch, the roster shown with a tick on
/// every row (the team chosen at the head of theirs), the verdict and its lines under it, the basis once
/// at the foot with the record's link. Pure of state, so a snapshot draws it from the fixture at the
/// fixture's clock; the pin above the bar (BuilderPin) is the caller's.
public struct TradesScreen: View {
    let model: TradesModel
    let stamp: String?
    let shown: TradesShown
    let actions: TradeActions

    public init(model: TradesModel, stamp: String?, shown: TradesShown, actions: TradeActions = TradeActions()) {
        self.model = model
        self.stamp = stamp
        self.shown = shown
        self.actions = actions
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            TradesTop(stamp: stamp, shown: shown, actions: actions)
            BuilderBoxView(shown: shown, actions: actions)
            VerdictView(builder: shown.builder, checking: shown.checking)
            BasisFoot(text: model.basis)
                .padding(.top, Tokens.Space.s2)
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s3)
    }
}

/// The screen's head: a saved read's stamp, our ideas, the roster switch.
struct TradesTop: View {
    let stamp: String?
    let shown: TradesShown
    let actions: TradeActions
    /// Drawn still, for a snapshot (TradeIdeasView's still).
    var still = false

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            if let stamp {
                StampText(stamp)
            }
            if !shown.builder.ideas.isEmpty {
                TradeIdeasView(builder: shown.builder, actions: actions, still: still)
            }
            RosterSwitchView(rosters: shown.builder.rosters, drawn: shown.drawn, show: actions.show)
        }
    }
}

/// "Last read Sat 12:00 pm": a saved read's stamp, in the accent's ink.
struct StampText: View {
    @Environment(\.colorScheme) private var colorScheme
    let stamp: String

    init(_ stamp: String) {
        self.stamp = stamp
    }

    var body: some View {
        Text(stamp)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.accentText))
    }
}

/// The basis, then "How the order has done", which opens our record.
struct BasisFoot: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let text: String

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            BasisText(text)
            Button { openURL(SiteLinks.record) } label: {
                Text(Words.InSeason.orderRecord)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .underline()
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        }
    }
}

/// The line under a pressed verb: "Copied. Propose it on FFPC's trade page.", the page its link when
/// the platform's page is known.
struct CopiedText: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let line: CopiedLine
    let page: URL?

    var body: some View {
        let theme = Theme(colorScheme)
        Button {
            if let page {
                openURL(page)
            }
        } label: {
            Text(words(theme))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(page == nil)
        .accessibilityLabel(line.words)
    }

    private func words(_ theme: Theme) -> AttributedString {
        let quiet = theme.color(Tokens.Color.ink2)
        let strong = theme.color(Tokens.Color.ink)
        var said = AttributedString("\(line.said) \(Words.Trades.proposeItOn) ")
        said.foregroundColor = quiet
        var link = AttributedString(line.page)
        link.foregroundColor = strong
        link.font = Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold)
        if page != nil {
            link.underlineStyle = .single
        }
        var stop = AttributedString(".")
        stop.foregroundColor = quiet
        return said + link + stop
    }
}
