import Board
import CommishCore
import CommishDesign
import SwiftUI

/// ADP's phone columns (board-columns.ts in the drafters' order): the ADP leading, the player taking the
/// rest (no face: the phone's room goes to his name and where our board has him), then where our board has him, his
/// points, his value and the Gap.
enum AdpColumn {
    static let adp: Double = 40
    static let rank: Double = 32
    static let projected: Double = 52
    static let overReplacement: Double = 54
    static let gap: Double = 44
    static let spacing: Double = 4

    /// The figures after the player, in the heads' order.
    static func trailing(gap: Bool) -> [Double] {
        [rank, projected, overReplacement] + (gap ? [Self.gap] : [])
    }
}

/// The heads, said once over the rows.
struct AdpHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: AdpModel

    var body: some View {
        let heads = model.heads
        HStack(spacing: AdpColumn.spacing) {
            ColumnHead(words: heads[0]).frame(width: AdpColumn.adp)
            ColumnHead(words: heads[1], alignment: .leading)
            ForEach(Array(zip(heads.dropFirst(2), AdpColumn.trailing(gap: model.gap))), id: \.0) { words, width in
                ColumnHead(words: words).frame(width: width)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 34)
        .background(Theme(colorScheme).color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }
}

/// One row (AdpView.svelte's Row at 390): his ADP leading in the number face, his face, name, pill,
/// club chip and bye, his status, then Rk, Projected, Over repl on its round's tint and the Gap in its
/// tone. The row opens his sheet; a kicker's or a defense's, which has no page, opens his club.
struct AdpRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: AdpRow
    let gap: Bool
    let actions: ReferenceActions

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: AdpColumn.spacing) {
            RowFigure(text: row.adp, ink: Tokens.Color.ink).frame(width: AdpColumn.adp, alignment: .trailing)
            who(theme).frame(maxWidth: .infinity, alignment: .leading)
            RowFigure(text: row.rank, size: Tokens.TypeScale.md).frame(width: AdpColumn.rank, alignment: .trailing)
            RowFigure(text: row.row.projected, ink: Tokens.Color.ink)
                .frame(width: AdpColumn.projected, alignment: .trailing)
            RowFigure(text: row.row.overReplacement)
                .frame(width: AdpColumn.overReplacement, alignment: .trailing)
                .background(alignment: .trailing) { Tint(heat: row.row.heat) }
            if gap {
                RowFigure(text: row.row.gap, ink: GapInk.of(row.row.gapTone)).frame(
                    width: AdpColumn.gap,
                    alignment: .trailing
                )
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .background(theme.color(Tokens.Color.surface))
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Hairline() }
        .onTapGesture(perform: tap)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { tap() }
    }

    private func tap() {
        if let player = row.row.sheetPlayer {
            actions.open(player)
        } else if row.row.club != Words.Figure.freeAgentClub {
            actions.club(row.row.club)
        }
    }

    private func who(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.row.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
            HStack(spacing: 6) {
                PositionPill(row.row.pill).fixedSize()
                ClubChip(abbr: row.row.club, open: actions.club).fixedSize()
                if let bye = row.row.bye {
                    SmallCaps(text: bye).fixedSize()
                }
            }
            if let status = row.row.status {
                Pill(status.mark, tone: status.sits ? .loss : .quiet)
            }
        }
    }
}

/// The tile under Over repl: the round's tint, rounds 1 to 4, the rose below replacement.
struct Tint: View {
    @Environment(\.colorScheme) private var colorScheme
    let heat: Heat

    var body: some View {
        if let tint = BoardRowView.tint(heat) {
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .fill(Theme(colorScheme).color(tint))
                .frame(height: 26)
                .padding(.leading, -4)
        }
    }
}

/// The Gap's tone (gap-picks.ts): plus green, minus rose, zero neither.
enum GapInk {
    static func of(_ tone: GapTone?) -> ThemedColor {
        switch tone {
        case .gain?: Tokens.Color.gainInk
        case .loss?: Tokens.Color.lossInk
        case .even?, nil: Tokens.Color.ink2
        }
    }
}

/// A row's small caps: its club and bye (Row.svelte .club and .phone-bye).
struct SmallCaps: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .tracking(Tokens.TypeScale.xs * 0.06)
            .textCase(.uppercase)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
    }
}

/// A club chip: the club's page (links.ts club), its own tap inside a row; a free agent's is words.
struct ClubChip: View {
    let abbr: String
    let open: (String) -> Void

    var body: some View {
        if abbr == Words.Figure.freeAgentClub {
            SmallCaps(text: abbr)
        } else {
            Button { open(abbr) } label: { SmallCaps(text: abbr) }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
        }
    }
}

/// ADP as its model says it, top to bottom in the web's order at 390: the heading and stamp, the
/// format chips, the rows in the drafters' order, the basis. Pure of state, so a snapshot draws it from
/// the fixture.
public struct AdpScreen: View {
    let model: AdpModel
    let stamp: String?
    let actions: ReferenceActions
    let format: (String) -> Void
    var rows: [AdpRow]?
    var live = true

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ReferenceHead(heading: model.heading, stamp: model.stamp, stale: stamp)
            if model.formats.count > 1 {
                ChipRow(chips: model.formats, choose: format, live: live)
            }
            table
            BoardBasisView(lines: model.basis)
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    @ViewBuilder
    private var table: some View {
        let content = Group {
            AdpHeadRow(model: model)
            ForEach(rows ?? model.rows) { row in
                AdpRowView(row: row, gap: model.gap, actions: actions)
            }
        }
        if live {
            LazyVStack(spacing: 0) { content }
        } else {
            VStack(spacing: 0) { content }
        }
    }
}

/// ADP with its view model: the format carried from the Board, a chip choosing another, a row opening
/// the sheet with Compare as its verb, a club chip its club, the mock's verb pinned above the bar.
public struct AdpView: View {
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RunScreenViewModel<AdpModel>

    public init(viewModel: RunScreenViewModel<AdpModel>) {
        self.viewModel = viewModel
    }

    public var body: some View {
        RunScreenContainer(viewModel: viewModel) { model, stamp in
            AdpScreen(model: model, stamp: stamp, actions: .live(sheet: sheet, openURL: openURL)) { format in
                Task { await viewModel.choose(format: format) }
            }
        } pin: { model in
            PagePin(verb: model.verb)
        }
        .onChange(of: viewModel.state) { _, state in
            if case let .loaded(model, _) = state {
                sheet.parentRefreshed(model.rows.compactMap(\.row.sheetPlayer))
            }
        }
    }
}

@MainActor
extension ReferenceActions {
    /// The screen's: a row opens his sheet with Compare as its verb, a link pushes its page.
    static func live(sheet: PlayerSheetHost, openURL: OpenURLAction) -> ReferenceActions {
        ReferenceActions(
            open: { player in sheet.open(player, offer: .compare(player) { openURL($0) }) },
            link: { openURL($0) }
        )
    }
}
