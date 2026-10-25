import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a name opens the player sheet, a row opens or closes its trade, a
/// verb copies the trade's offer, the chips and the gain heads reorder the finder, the picker narrows
/// it to a player, and the builder opens, picks, checks and copies.
public struct TradeActions {
    let open: (SheetPlayer) -> Void
    let toggle: (String) -> Void
    let press: (String) -> Void
    let showEvery: (Bool) -> Void
    let sort: (TradeSort) -> Void
    let pick: (String?) -> Void
    let builder: BuilderActions

    public init(
        open: @escaping (SheetPlayer) -> Void = { _ in }, toggle: @escaping (String) -> Void = { _ in },
        press: @escaping (String) -> Void = { _ in }, showEvery: @escaping (Bool) -> Void = { _ in },
        sort: @escaping (TradeSort) -> Void = { _ in }, pick: @escaping (String?) -> Void = { _ in },
        builder: BuilderActions = BuilderActions()
    ) {
        self.open = open
        self.toggle = toggle
        self.press = press
        self.showEvery = showEvery
        self.sort = sort
        self.pick = pick
        self.builder = builder
    }
}

/// What the builder's controls do: open it new or from a trade, close it, choose the team, tick a
/// player, press its verb.
public struct BuilderActions {
    let new: () -> Void
    let from: (String) -> Void
    let close: () -> Void
    let team: (Int) -> Void
    let tap: (TradePicks.Side, String) -> Void
    let press: () -> Void

    public init(
        new: @escaping () -> Void = {}, from: @escaping (String) -> Void = { _ in }, close: @escaping () -> Void = {},
        team: @escaping (Int) -> Void = { _ in }, tap: @escaping (TradePicks.Side, String) -> Void = { _, _ in },
        press: @escaping () -> Void = {}
    ) {
        self.new = new
        self.from = from
        self.close = close
        self.team = team
        self.tap = tap
        self.press = press
    }
}

/// What the member has done on the screen: the chips, the order, the trades opened, the lines under
/// the pressed verbs, a narrowing being read or refused, and the builder.
public struct TradesShown: Equatable {
    public let every: Bool
    public let sort: TradeSort
    public let opened: Set<String>
    public let copied: [String: CopiedLine]
    public let narrowing: Bool
    public let problem: String?
    public let builder: TradeBuilderModel?
    public let checking: Bool
    public let builderCopied: CopiedLine?

    public init(
        every: Bool = false, sort: TradeSort = .mine, opened: Set<String> = [], copied: [String: CopiedLine] = [:],
        narrowing: Bool = false, problem: String? = nil, builder: TradeBuilderModel? = nil, checking: Bool = false,
        builderCopied: CopiedLine? = nil
    ) {
        self.every = every
        self.sort = sort
        self.opened = opened
        self.copied = copied
        self.narrowing = narrowing
        self.problem = problem
        self.builder = builder
        self.checking = checking
        self.builderCopied = builderCopied
    }

    /// What the basis speaks to.
    var open: TradesOpened {
        builder != nil ? .builder : opened.isEmpty ? .none : .trade
    }
}

/// The Trades as its model says it, in the web's order (TradeScreen.svelte at 390): the strip of the
/// trades worth proposing, the builder while it is open, the picker with the chips and Build a trade,
/// the finder with any trade opened, the basis once at the foot with the record's link. Pure of state,
/// so a snapshot draws it from the fixture at the fixture's clock; the builder's pin is the caller's.
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
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ForEach(TradesPart.allCases, id: \.self) { part in
                TradesPartView(part: part, model: model, stamp: stamp, shown: shown, actions: actions)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The screen's runs, top to bottom: each a snapshot of its own, so no reference grows past what a
/// repository keeps.
public enum TradesPart: CaseIterable, Sendable {
    /// The strip, or the decision where no trade is worth proposing or none holds the player picked.
    case strip
    /// The builder, while it is open.
    case builder
    /// The picker, the chips, Build a trade, and the finder with any trade opened in it.
    case finder
    /// The basis and the record's link.
    case basis
}

struct TradesPartView: View {
    let part: TradesPart
    let model: TradesModel
    let stamp: String?
    let shown: TradesShown
    let actions: TradeActions

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch part {
            case .strip:
                if let strip = model.strip {
                    TradeStripView(
                        strip: strip, verb: model.verb, page: model.page, stamp: stamp, copied: shown.copied,
                        press: actions.press
                    )
                } else {
                    DecisionView(decision: model.decision, stamp: stamp)
                }
            case .builder:
                if let builder = shown.builder {
                    TradeBuilderView(builder: builder, checking: shown.checking, actions: actions)
                }
            case .finder:
                ToolsRow(model: model, every: shown.every, actions: actions)
                if let problem = shown.problem {
                    ProblemText(problem)
                }
                TradeFinderView(model: model, shown: shown, actions: actions)
                    .opacity(shown.narrowing ? 0.6 : 1)
            case .basis:
                BasisFoot(text: model.basis(shown.open))
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// No trade worth proposing, or none holding the player picked: the decision in the screen's large
/// face, the stamp of a saved read under.
struct DecisionView: View {
    @Environment(\.colorScheme) private var colorScheme
    let decision: String
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(decision)
                .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                StampText(stamp)
            }
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

/// A read that could not be made, in the loss's ink (ProblemLine.svelte).
struct ProblemText: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.lossInk))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// TradeScreen's tools: Trades holding with its choice (every trade, your players, their players), each
/// team's best or every trade with their counts, and Build a trade.
struct ToolsRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: TradesModel
    let every: Bool
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s2) {
                Text(Words.InSeason.tradesHolding)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                PlayerMenu(picker: model.picker, pick: actions.pick)
            }
            FlowRow(spacing: Tokens.Space.s2) {
                ChoiceChip(model.best, pressed: !every) { actions.showEvery(false) }
                ChoiceChip(model.every, pressed: every) { actions.showEvery(true) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Words.Trades.every)
            HStack {
                Spacer(minLength: 0)
                QuietButton(Words.Builder.open, action: actions.builder.new)
                    .padding(.horizontal, Tokens.Space.s3)
                    .overlay(
                        RoundedRectangle(cornerRadius: Tokens.Radius.md)
                            .strokeBorder(theme.color(Tokens.Color.lineStrong))
                    )
            }
        }
    }
}

/// The picker (TradeScreen's PickSelect): Every trade, then Your players and Their players, each under
/// its heading; the choice shown in its box.
struct PlayerMenu: View {
    let picker: TradePicker
    let pick: (String?) -> Void

    var body: some View {
        ChoiceField(
            label: Words.InSeason.tradesHolding, value: picker.label, chosen: picker.chosen ?? "",
            groups: [
                ChoiceGroup(title: nil, choices: [("", Words.TradePicker.every)]),
                ChoiceGroup(title: Words.InSeason.yourPlayers, choices: picker.yours.map { ($0.id, $0.name) }),
                ChoiceGroup(title: Words.InSeason.theirPlayers, choices: picker.theirs.map { ($0.id, $0.name) }),
            ]
        ) { key in pick(key.isEmpty ? nil : key) }
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
    var onBoard = false

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
        let quiet = theme.color(onBoard ? Tokens.Color.scoreboardInk2 : Tokens.Color.ink2)
        let strong = theme.color(onBoard ? Tokens.Color.scoreboardInk : Tokens.Color.ink)
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
