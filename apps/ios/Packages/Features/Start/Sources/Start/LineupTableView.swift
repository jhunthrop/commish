import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The Lineup's one table (web LineupTable.svelte): the heads, the lineup the advice sets with its
/// evidence lines, the spots no one can play, the Team row lit like the score bug.
struct LineupTableView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: StartModel
    let actions: RowActions

    var body: some View {
        let theme = Theme(colorScheme)
        TableFrame {
            HeadRow()
            ForEach(model.starters) { cells in
                BoxRowView(cells: cells, bench: false, actions: actions)
            }
            ForEach(model.empty, id: \.self) { slot in
                EmptyRow(slot: slot)
            }
            TeamRowView(team: model.team)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.week)
        .background(theme.color(Tokens.Color.bg))
    }
}

/// The bench and the injured reserve (the table's second and third bodies on the web).
struct BenchView: View {
    let model: StartModel
    let actions: RowActions

    var body: some View {
        TableFrame {
            SectionRow(title: Words.Box.bench)
            if model.bench.isEmpty {
                NoteRow(text: Words.InSeason.noBench)
            }
            ForEach(model.bench) { cells in
                BoxRowView(cells: cells, bench: true, actions: actions)
            }
            if !model.reserve.isEmpty {
                SectionRow(title: Words.Box.reserve)
                ForEach(model.reserve) { cells in
                    BoxRowView(cells: cells, bench: true, actions: actions)
                }
            }
        }
    }
}

/// A spot empty on the platform that no one who can play fills: its slot, the sentence, no figures.
struct EmptyRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let slot: String

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            Text(slot)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .frame(width: Column.slot, alignment: .leading)
            Text(Words.Lineup.noOneHere)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .frame(maxWidth: .infinity, alignment: .leading)
            Figure(text: Words.Box.none, width: Column.proj, muted: true)
            Figure(text: Words.Box.none, width: Column.pts, muted: true)
            Color.clear.frame(width: Column.why, height: 1)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink3))
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 48)
        .background(theme.mix(Tokens.Color.lossBg, 35, into: Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
    }
}
