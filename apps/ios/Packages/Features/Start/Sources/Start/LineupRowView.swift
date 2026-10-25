import CommishCore
import CommishDesign
import SwiftUI

/// One player's row (web BoxLine.svelte and BoxPlayer.svelte at 390): the slot with the move's arrow,
/// his face, his name (whole where it fits, else his short form), his club, position and status, his
/// game in one line, the expected score and weather while it is to come, the evidence line, then Our
/// rank, Proj and Pts; a moved-in row tinted in the accent with the chevron that opens its evidence.
struct LineupRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let cells: RowCells
    let bench: Bool
    let actions: RowActions

    private var open: Bool {
        actions.opened.contains(cells.id)
    }

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                slot(theme)
                PlayerCell(cells: cells, open: actions.open)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(cells.rank)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(cells.rank == Words.Box.none ? Tokens.Color.ink3 : Tokens.Color.ink))
                    .frame(width: Column.rank, alignment: .leading)
                    .padding(.leading, Tokens.Space.s1)
                Figure(text: cells.proj, width: Column.proj, muted: cells.proj == Words.Box.none)
                Figure(text: cells.pts, width: Column.pts, muted: cells.pts == Words.Box.none)
                why(theme)
            }
            .padding(.horizontal, Tokens.Space.s2)
            .padding(.vertical, 6)
            if open, let why = cells.why {
                Text(why)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, Column.slot + Tokens.Space.s2)
                    .padding([.trailing, .bottom], Tokens.Space.s3)
            }
        }
        .background(background(theme))
        .overlay(alignment: .leading) { edge(theme) }
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func slot(_ theme: Theme) -> some View {
        HStack(spacing: 2) {
            if let move = cells.move {
                MoveMark(starts: move == .into, side: 18)
            }
            Text(cells.row.slot)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(theme.color(bench ? Tokens.Color.ink3 : Tokens.Color.ink2))
        }
        .frame(width: Column.slot, alignment: .leading)
    }

    @ViewBuilder
    private func why(_ theme: Theme) -> some View {
        if cells.why != nil {
            Button { actions.toggleWhy(cells.id) } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(width: 26, height: 30)
                    .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            }
            .buttonStyle(.plain)
            .frame(width: Column.why, alignment: .trailing)
            .accessibilityLabel([Words.Box.why, cells.row.name].joined(separator: " "))
            .accessibilityValue(open ? cells.why ?? "" : "")
        } else {
            Color.clear.frame(width: Column.why, height: 1)
        }
    }

    private func background(_ theme: Theme) -> Color {
        if cells.move == .into {
            return theme.mix(Tokens.Color.accent, 8, into: Tokens.Color.surface)
        }
        if cells.move == .out {
            return theme.mix(Tokens.Color.ink, 4, into: Tokens.Color.surface)
        }
        if cells.idle {
            return theme.mix(Tokens.Color.lossBg, 35, into: Tokens.Color.surface)
        }
        return theme.color(Tokens.Color.surface)
    }

    @ViewBuilder
    private func edge(_ theme: Theme) -> some View {
        switch cells.move {
        case .into?: Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 3)
        case .out?: Rectangle().fill(theme.color(Tokens.Color.lineStrong)).frame(width: 3)
        case nil: EmptyView()
        }
    }
}

/// The player cell: face, name, club line, game line, facts and evidence, folded as the phone folds
/// them. His name opens the player sheet where the site has a page for him.
struct PlayerCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let cells: RowCells
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        let row = cells.row
        HStack(alignment: .center, spacing: Tokens.Space.s2) {
            Avatar(row.clubMark ? row.club : Initials.of(row.name), side: Column.face)
            VStack(alignment: .leading, spacing: 1) {
                name(theme)
                club(theme)
                game(theme)
                facts(theme)
                Text(evidence(theme))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(theme.color(cells.idle ? Tokens.Color.ink3 : Tokens.Color.ink))
    }

    @ViewBuilder
    private func name(_: Theme) -> some View {
        let label = ViewThatFits(in: .horizontal) {
            nameText(cells.row.name)
            nameText(cells.row.fit)
        }
        if let player = cells.sheetPlayer {
            Button { open(player) } label: { label }
                .buttonStyle(.plain)
                .accessibilityLabel(cells.row.name)
        } else {
            label.accessibilityLabel(cells.row.name)
        }
    }

    private func nameText(_ words: String) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
            .lineLimit(1)
    }

    private func club(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s1) {
            Text(cells.row.club)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            Text(cells.row.position)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            if let status = cells.row.status {
                Pill(status.mark, tone: status.sits ? .loss : .quiet)
            }
        }
        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
        .lineLimit(1)
    }

    @ViewBuilder
    private func game(_ theme: Theme) -> some View {
        let font = Faces.font(.ui, size: Tokens.TypeScale.sm)
        if let note = cells.note {
            Text(note).font(font).foregroundStyle(theme.color(Tokens.Color.ink2)).lineLimit(1)
        } else {
            switch cells.game {
            case let .game(place, when):
                Text(gameLine(place: place, when: when, theme: theme))
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
    }

    @ViewBuilder
    private func facts(_ theme: Theme) -> some View {
        let row = cells.row
        if row.expected != nil || row.weather != nil {
            let expected = row.expected.map {
                Text($0)
                    .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            } ?? Text(verbatim: "")
            let weather = row.weather.map {
                Text(Image(systemName: Self.glyph($0.glyph))).font(.system(size: 10))
                    + Text(verbatim: " ") + Text($0.words).font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            } ?? Text(verbatim: "")
            let gap = row.expected != nil && row.weather != nil ? Text(verbatim: "  ") : Text(verbatim: "")
            // One text, so it wraps between its parts and never inside a word.
            (expected + gap + weather.foregroundStyle(theme.color(Tokens.Color.ink3)))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// "vs LAC Sun 3:25 pm": the opponent strong, the kickoff or the state's word in the second ink,
    /// wrapping between them where the cell is narrow.
    private func gameLine(place: String, when: String, theme: Theme) -> AttributedString {
        var opponent = AttributedString(place)
        opponent.font = Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold)
        var time = AttributedString(when)
        time.foregroundColor = theme.color(Tokens.Color.ink2)
        return opponent + AttributedString(" ") + time
    }

    /// "Opp 2nd, Avg 23.3, Last 19.0": the opponent's rank in the ease's ink while his game is to come.
    private func evidence(_ theme: Theme) -> AttributedString {
        var said = AttributedString(cells.evidence)
        said.foregroundColor = theme.color(Tokens.Color.ink2)
        if let rank = cells.oppRank, let range = said.range(of: rank), cells.ease != .even {
            said[range].foregroundColor = theme.color(cells.ease == .hard ? Tokens.Color.lossInk : Tokens.Color.gainInk)
            said[range].font = Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold)
        }
        return said
    }

    /// The weather glyph the web's WeatherGlyph draws, as the system's symbol.
    static func glyph(_ name: String) -> String {
        switch name {
        case "wind": "wind"
        case "indoors": "house"
        case "roof": "building.columns"
        case "abroad": "globe"
        default: "sun.max"
        }
    }
}
