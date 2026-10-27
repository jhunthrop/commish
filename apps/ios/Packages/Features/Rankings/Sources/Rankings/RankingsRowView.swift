import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The phone's columns (OrderTable.svelte and WeekTable.svelte at 390): the # cell, the face, the
/// pill's slot and the club's, so the pills line up down the list, the big Projected and the week's
/// Proj.
enum RankingsColumn {
    static let rank: Double = 30
    static let face: Double = 28
    /// The pill's slot: as wide as the widest pill the order prints ("WR 149"), so a three-digit rank
    /// is never cut and the club column starts at one x on every row (review H1).
    static let pill: Double = 56
    /// The pill's least width (the web's --line-pill), so short pills ("K", "RB") are one size.
    static let pillLeast: Double = 50
    static let club: Double = 34
    /// The big figure's column: the widest Projected the order prints (three digits and a tenth; the
    /// number face's tabular figures make every such figure one width) at the name's size, plus the
    /// strip's gap before it, so the rest of the line is the name's (re-review M-A).
    static let total: Double = FigureWidth.of(
        StartWords.number(widestTotal), face: .num, size: Tokens.TypeScale.md, weight: .bold
    ) + FigureStrip.gap
    /// A rest-of-season Projected under a thousand points, the most a season holds.
    static let widestTotal = 999.9
    static let proj: Double = 52
}

/// The first line of a row (BoxPlayer.svelte's line at 390): his face or his club's mark, his name the
/// biggest thing on it, whole where it fits and else his short form (a link to his sheet where the site
/// has his page), then his pill and club as a column of fixed width.
struct RankingsNameLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: RankingsPlayer
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            Avatar(Initials.of(player.name), side: RankingsColumn.face, club: player.clubMark ? player.club : nil)
                .padding(.trailing, Tokens.Space.s2)
            name.frame(maxWidth: .infinity, alignment: .leading)
            Group {
                if let pill = player.pill {
                    // Its ideal width, never squeezed: the words are a fact (review H1).
                    PositionPill(pill, minWidth: RankingsColumn.pillLeast).fixedSize()
                } else {
                    Color.clear.frame(height: 1)
                }
            }
            .frame(width: RankingsColumn.pill, alignment: .leading)
            Text(player.club)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .lineLimit(1)
                .frame(width: RankingsColumn.club, alignment: .leading)
                .padding(.leading, Tokens.Space.s1)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
    }

    @ViewBuilder
    private var name: some View {
        let label = ViewThatFits(in: .horizontal) {
            nameText(player.name)
            nameText(player.fit)
        }
        if let sheet = player.sheetPlayer {
            Button { open(sheet) } label: { label }
                .buttonStyle(.plain)
                .accessibilityLabel(player.name)
        } else {
            label.accessibilityLabel(player.name)
        }
    }

    private func nameText(_ words: String) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
            .lineLimit(1)
    }
}

/// The second line (BoxGame.svelte with its glyph, then StatusChip): his game as one cell, the
/// opponent strong and the kickoff or the state's word after it, the kickoff weather as its glyph alone
/// (its words the glyph's label), then his status chip whole. Where the two do not fit one line the
/// status takes a second, as the web's game line wraps; nothing is cut.
struct RankingsGameLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: RankingsPlayer

    var body: some View {
        let theme = Theme(colorScheme)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Tokens.Space.s2) {
                game(theme)
                status
            }
            VStack(alignment: .leading, spacing: 2) {
                game(theme)
                status
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var status: some View {
        if let status = player.status {
            Pill(status.mark, tone: status.sits ? .loss : .quiet).fixedSize()
        }
    }

    @ViewBuilder
    private func game(_ theme: Theme) -> some View {
        let font = Faces.font(.ui, size: Tokens.TypeScale.sm)
        switch player.game {
        case let .game(place, when):
            HStack(spacing: Tokens.Space.s1) {
                Text(place).font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                Text(when).font(font).foregroundStyle(theme.color(Tokens.Color.ink2))
                if let weather = player.weather {
                    Image(systemName: PlayerCell.glyph(weather.glyph))
                        .font(.system(size: 10))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                        .accessibilityLabel(weather.words)
                }
            }
            .lineLimit(1)
            .fixedSize()
        case .bye:
            Text(Words.Box.bye).font(font).foregroundStyle(theme.color(Tokens.Color.ink2)).fixedSize()
        case .noClub:
            Text(Words.Box.noClub).font(font).foregroundStyle(theme.color(Tokens.Color.ink2)).fixedSize()
        case .none:
            EmptyView()
        }
    }
}

/// A Rankings row's frame: its lines, its padding and the hairline under it.
private struct RankingsRowFrame: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, Tokens.Space.s2)
            .padding(.vertical, Tokens.Space.s2)
            .overlay(alignment: .bottom) { Hairline() }
            .accessibilityElement(children: .contain)
    }
}

/// One row of our order (OrderTable.svelte at 390), two lines and a strip: the place, the player and
/// his Projected; his game under his name; his figures as labelled cells across the row.
struct RankingsRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: RankingsRow
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(alignment: .center, spacing: 0) {
                Text(row.place)
                    .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: RankingsColumn.rank, alignment: .trailing)
                    .padding(.trailing, Tokens.Space.s2)
                RankingsNameLine(player: row.player, open: open)
                // The name's size, its weight for emphasis: the player stays the biggest thing.
                Text(row.total)
                    .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .foregroundStyle(theme.color(row.total == Words.Box.none ? Tokens.Color.ink3 : Tokens.Color.ink))
                    .frame(width: RankingsColumn.total, alignment: .trailing)
            }
            RankingsGameLine(player: row.player)
                .padding(.leading, RankingsColumn.rank + Tokens.Space.s2 + RankingsColumn.face + Tokens.Space.s2)
            FigureStrip(cells: row.cells)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .modifier(RankingsRowFrame())
    }
}

/// One row of the kickers' or defenses' week (WeekTable.svelte at 390), as the order's: the player and
/// his Proj, quiet once his game kicks off; his game; Opp rank, Avg and Last as labelled cells.
struct WeekRankingsRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: WeekRankingsRow
    let proj: Bool
    let kicked: Bool
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(alignment: .center, spacing: 0) {
                RankingsNameLine(player: row.player, open: open)
                if proj {
                    Text(row.proj)
                        .font(Faces.font(.num, size: kicked ? Tokens.TypeScale.sm : Tokens.TypeScale.md, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(theme.color(
                            kicked || row.proj == Words.Box.none ? Tokens.Color.ink3 : Tokens.Color.ink
                        ))
                        .frame(width: RankingsColumn.proj, alignment: .trailing)
                }
            }
            RankingsGameLine(player: row.player)
                .padding(.leading, RankingsColumn.face + Tokens.Space.s2)
            FigureStrip(cells: row.cells)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .modifier(RankingsRowFrame())
    }
}

/// The order's heads (OrderTable.svelte's cols at 390): #, Player and Projected; the week's figure and
/// Over repl. head their own cells in each row's strip.
struct RankingsHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let heads: RankingsHeads

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(heads.rank, theme).frame(width: RankingsColumn.rank, alignment: .trailing)
                .padding(.trailing, Tokens.Space.s2)
            head(Words.Box.player, theme).frame(maxWidth: .infinity, alignment: .leading)
            head(heads.total, theme).frame(width: RankingsColumn.total, alignment: .trailing)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 32)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String, _ theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }
}

/// The week's heads: Player, and Proj once the week's projection is in.
struct WeekHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let proj: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(Words.Box.player).frame(maxWidth: .infinity, alignment: .leading)
            if proj {
                head(Words.Box.proj).frame(width: RankingsColumn.proj, alignment: .trailing)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 32)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
    }
}
