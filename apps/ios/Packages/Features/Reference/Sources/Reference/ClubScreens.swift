import Board
import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// A strength figure in the number face with its caption under it (Figure.svelte).
struct StrengthFigureView: View {
    @Environment(\.colorScheme) private var colorScheme
    let value: String
    let caption: String
    var note: String?
    var size: Double = Tokens.TypeScale.xl

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            Text(value)
                .font(Faces.font(.num, size: size, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(caption)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            if let note {
                Text(note)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
    }
}

/// A club's card on the index (Tile.svelte): its name and line opening its page, its strength, its
/// lead player opening his sheet, and how many of its players our board ranks.
struct ClubCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: ClubCard
    let actions: ReferenceActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            Button { actions.club(card.abbr) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    SmallCaps(text: card.meta)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            if let strength = card.strength {
                StrengthFigureView(value: strength.value, caption: strength.caption, size: Tokens.TypeScale.lg)
            }
            if let lead = card.lead {
                Button { actions.open(lead.sheetPlayer) } label: {
                    HStack(spacing: Tokens.Space.s2) {
                        Headshot(lead.headshot, initials: lead.initials, side: 28)
                        Text(lead.name)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                            .foregroundStyle(theme.color(Tokens.Color.ink))
                        PositionPill(lead.pill)
                        Spacer(minLength: 0)
                        SmallCaps(text: lead.rank)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            SmallCaps(text: card.players)
        }
        .padding(Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(Tokens.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }
}

/// The clubs index at 390: the heading, its lead, the link to the schedule, every club's card.
public struct ClubsScreen: View {
    let model: ClubsModel
    let stamp: String?
    let actions: ReferenceActions
    var clubs: [ClubCard]?

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ReferenceHead(heading: model.title, stamp: model.stamp, lead: model.lead, stale: stamp)
            QuietButton(model.scheduleLink) { actions.link(SiteLinks.schedule) }
                .padding(.horizontal, Tokens.Space.s3)
            VStack(spacing: Tokens.Space.s3) {
                ForEach(clubs ?? model.clubs) { card in
                    ClubCardView(card: card, actions: actions)
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// A club's hero (HeroCard.svelte at 390): the way back to the clubs, its name and line, its strength
/// with its read and its rank.
struct ClubHeroView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: ClubPageModel
    let stamp: String?
    let actions: ReferenceActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            QuietButton(model.clubsLink) { actions.link(SiteLinks.clubs) }
            ReferenceHead(heading: model.name, stamp: model.stamp, lead: model.meta, stale: stamp)
                .padding(.horizontal, -Tokens.Space.s3)
            if let hero = model.hero {
                HStack(alignment: .top, spacing: Tokens.Space.s5) {
                    StrengthFigureView(
                        value: hero.value,
                        caption: hero.caption,
                        note: hero.note,
                        size: Tokens.TypeScale.xxl
                    )
                    StrengthFigureView(value: hero.hardest, caption: hero.hardestCaption, size: Tokens.TypeScale.head)
                }
                .padding(Tokens.Space.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.color(Tokens.Color.surface))
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// A club's schedule (Table.svelte with its caption): Week, the opponent at or against opening his
/// page, his expected wins; a game played set back.
struct ClubScheduleView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: ClubPageModel
    let actions: ReferenceActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            BasisText(model.scheduleCaption).padding(.horizontal, Tokens.Space.s3)
            TableFrame {
                HStack(spacing: Tokens.Space.s2) {
                    ColumnHead(words: model.scheduleHeads[0], alignment: .leading).frame(width: 64)
                    ColumnHead(words: model.scheduleHeads[1], alignment: .leading)
                    ColumnHead(words: model.scheduleHeads[2]).frame(width: 72)
                }
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 34)
                .overlay(alignment: .bottom) { Hairline() }
                ForEach(model.games) { game in
                    let ink = theme.color(game.played ? Tokens.Color.playedInk : Tokens.Color.ink)
                    HStack(spacing: Tokens.Space.s2) {
                        Text(game.weekWords).frame(width: 64, alignment: .leading)
                        Button { actions.club(game.club) } label: {
                            Text(game.opponent).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        Text(game.value).monospacedDigit().frame(width: 72, alignment: .trailing)
                    }
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .foregroundStyle(ink)
                    .padding(.horizontal, Tokens.Space.s3)
                    .frame(minHeight: 40)
                    .overlay(alignment: .bottom) { Hairline() }
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
        }
    }
}

/// A club's page at 390 in the web's order: the hero, the basis, its players on our board, its kickers
/// and defense, its schedule.
public struct ClubScreen: View {
    let model: ClubPageModel
    let stamp: String?
    let actions: ReferenceActions
    /// The sections a mock draws: the board's rows, the market's, the schedule.
    var parts: Set<ClubPart> = Set(ClubPart.allCases)

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if parts.contains(.hero) {
                ClubHeroView(model: model, stamp: stamp, actions: actions)
                BoardBasisView(lines: model.basis)
            }
            if parts.contains(.board) {
                VStack(spacing: 0) {
                    BoardSectionHead(title: model.boardHead)
                    if let nobody = model.nobody {
                        BasisText(nobody).padding(Tokens.Space.s3)
                    } else {
                        BoardHeadRow(columns: model.columns)
                        ForEach(model.rows) { row in
                            BoardRowView(row: row, columns: model.columns, open: actions.open, club: actions.club)
                        }
                    }
                }
            }
            if parts.contains(.market), !model.market.isEmpty {
                VStack(spacing: 0) {
                    BoardSectionHead(title: model.marketHead)
                    BoardHeadRow(columns: .draftOrder)
                    ForEach(model.market) { row in
                        BoardRowView(row: row, columns: .draftOrder, open: actions.open)
                    }
                }
            }
            if parts.contains(.schedule) {
                ClubScheduleView(model: model, actions: actions)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// A club page's parts, for a mock that draws some.
public enum ClubPart: CaseIterable, Hashable, Sendable {
    case hero
    case board
    case market
    case schedule
}

/// The clubs index with its view model.
public struct ClubsView: View {
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RunScreenViewModel<ClubsModel>

    public init(viewModel: RunScreenViewModel<ClubsModel>) {
        self.viewModel = viewModel
    }

    public var body: some View {
        RunScreenContainer(viewModel: viewModel) { model, stamp in
            ClubsScreen(model: model, stamp: stamp, actions: .live(sheet: sheet, openURL: openURL))
        } pin: { _ in
            EmptyView()
        }
    }
}

/// A club's page with its view model: its verb, Compare two of them, pinned above the bar.
public struct ClubView: View {
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RunScreenViewModel<ClubPageModel>

    public init(viewModel: RunScreenViewModel<ClubPageModel>) {
        self.viewModel = viewModel
    }

    public var body: some View {
        RunScreenContainer(viewModel: viewModel) { model, stamp in
            ClubScreen(model: model, stamp: stamp, actions: .live(sheet: sheet, openURL: openURL))
        } pin: { model in
            if let compare = model.compare {
                BoardPinView(title: compare.label) {
                    openURL(SiteLinks.compare(first: compare.slugs.first, second: compare.slugs.last))
                }
            }
        }
        .onChange(of: viewModel.state) { _, state in
            if case let .loaded(model, _) = state {
                sheet.parentRefreshed(model.rows.compactMap(\.sheetPlayer))
            }
        }
    }
}
