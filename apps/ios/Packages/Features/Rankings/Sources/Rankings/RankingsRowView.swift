import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The phone's columns (OrderTable.svelte and WeekTable.svelte at 390): the # cell, the week's figure
/// and the big Projected; the week's Proj.
enum RankingsColumn {
    static let rank: Double = 30
    static let week: Double = 40
    static let total: Double = 74
    static let proj: Double = 52
    static let face: Double = 28
}

/// A player's cell (BoxPlayer.svelte at 390): his face or his club's mark, his name whole where it fits
/// and else his short form (a link to his sheet where the site has his page), his club with his pill and
/// his status chip, his game with its zone, the expected score and the kickoff weather while it is to
/// come, and the line folded under it all.
struct RankingsPlayerView: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: RankingsPlayer
    let folded: String
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: Tokens.Space.s2) {
            Avatar(player.clubMark ? player.club : Initials.of(player.name), side: RankingsColumn.face)
            VStack(alignment: .leading, spacing: 1) {
                name
                club(theme)
                game(theme)
                facts(theme)
                Text(folded)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .fixedSize(horizontal: false, vertical: true)
            }
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

    private func club(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s1) {
            Text(player.club)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            if let pill = player.pill {
                PositionPill(pill)
            }
            if let status = player.status {
                Pill(status.mark, tone: status.sits ? .loss : .quiet)
            }
        }
        .lineLimit(1)
    }

    @ViewBuilder
    private func game(_ theme: Theme) -> some View {
        let font = Faces.font(.ui, size: Tokens.TypeScale.sm)
        switch player.game {
        case let .game(place, when):
            (Text(place).font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                + Text(verbatim: " ") + Text(when).foregroundStyle(theme.color(Tokens.Color.ink2)))
                .font(font)
                .fixedSize(horizontal: false, vertical: true)
        case .bye:
            Text(Words.Box.bye).font(font).foregroundStyle(theme.color(Tokens.Color.ink2))
        case .noClub:
            Text(Words.Box.noClub).font(font).foregroundStyle(theme.color(Tokens.Color.ink2))
        case .none:
            EmptyView()
        }
    }

    @ViewBuilder
    private func facts(_ theme: Theme) -> some View {
        if player.expected != nil || player.weather != nil {
            let expected = player.expected.map {
                Text($0)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            } ?? Text(verbatim: "")
            let weather = player.weather.map {
                Text(Image(systemName: PlayerCell.glyph($0.glyph))).font(.system(size: 10))
                    + Text(verbatim: " ") + Text($0.words).font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            } ?? Text(verbatim: "")
            let gap = player.expected != nil && player.weather != nil ? Text(verbatim: "  ") : Text(verbatim: "")
            // One text, so it wraps between its parts and never inside a word.
            (expected + gap + weather.foregroundStyle(theme.color(Tokens.Color.ink3)))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One row of our order (OrderTable.svelte at 390): the place, the player, the week's figure and his
/// Projected big.
struct RankingsRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: RankingsRow
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            Text(row.place)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .frame(width: RankingsColumn.rank, alignment: .trailing)
                .padding(.trailing, Tokens.Space.s2)
            RankingsPlayerView(player: row.player, folded: row.folded, open: open)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(row.week)
                .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .frame(width: RankingsColumn.week, alignment: .trailing)
            Text(row.total)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.color(row.total == Words.Box.none ? Tokens.Color.ink3 : Tokens.Color.ink))
                .frame(width: RankingsColumn.total, alignment: .trailing)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 7)
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .contain)
    }
}

/// One row of the kickers' or defenses' week (WeekTable.svelte at 390): the player and his Proj, big
/// while his game is to come.
struct WeekRankingsRowView: View {
    let row: WeekRankingsRow
    let proj: Bool
    let kicked: Bool
    let open: (SheetPlayer) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            RankingsPlayerView(player: row.player, folded: row.folded, open: open)
                .frame(maxWidth: .infinity, alignment: .leading)
            if proj {
                Figure(text: row.proj, width: RankingsColumn.proj, muted: kicked || row.proj == Words.Box.none)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 7)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The order's heads (OrderTable.svelte's cols at 390): #, Player, the week's head, Projected marked
/// as the column the # sorts on at a position (Over repl. folds under the name across positions).
struct RankingsHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let heads: RankingsHeads

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(heads.rank, theme).frame(width: RankingsColumn.rank, alignment: .trailing)
                .padding(.trailing, Tokens.Space.s2)
            head(Words.Box.player, theme).frame(maxWidth: .infinity, alignment: .leading)
            head(heads.week, theme).frame(width: RankingsColumn.week, alignment: .trailing)
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
