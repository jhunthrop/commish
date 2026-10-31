import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The phone's Waivers columns (WaiverTable.svelte at 390): the player taking the rest, Proj, Beats and
/// the row's button.
enum WaiverColumn {
    static let proj: Double = 46
    static let beats: Double = 88
    static let act: Double = 44
}

/// What the table's rows do: a name opens the player sheet, a row's button its drop panel, a drop is
/// chosen; and the open panel's rows.
struct TableActions {
    let open: (SheetPlayer) -> Void
    let tap: (String) -> Void
    let chooseDrop: (String) -> Void
    let opened: String?
    let drops: [DropRow]
    let chosenDrop: String?
    let dropHead: (title: String, lead: String)?
    /// The rows in the sort and the search, the sort and what choosing a head does, and whether a
    /// position is being read (its last rows stand, quieter).
    let table: WaiverTable
    let sort: WaiverSort
    let onSort: (WaiverSortKey) -> Void
    let reading: Bool
    /// The member's players at the chosen position over its free agents, nil for All (Lane 305).
    var compare: NavCompare?
    /// What the table says with no row: no free agent at the chosen position, else none found.
    var empty = Words.Waivers.noneFound
}

/// The players free to add (WaiverTable.svelte at 390): the heads with the line under them said once,
/// the rows that gain, the rest under one divider, quiet, then the Stash group with its line; an open
/// row's drop panel under it.
struct WaiverTableView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: WaiverModel
    let groups: Groups
    let actions: TableActions

    /// Which of the table's groups a part draws: the whole table, or only its rows that gain.
    struct Groups: OptionSet {
        let rawValue: Int
        static let gaining = Groups(rawValue: 1)
        static let rest = Groups(rawValue: 2)
        static let stash = Groups(rawValue: 4)
        /// Only the open row with its drop panel, the heads over it.
        static let opened = Groups(rawValue: 8)
        static let all: Groups = [.gaining, .rest, .stash]
    }

    var body: some View {
        let table = actions.table
        TableFrame {
            WaiverHeadRow(projected: model.projected, sort: actions.sort, onSort: actions.onSort)
            HeadsLine(text: model.heads)
            if groups.contains(.gaining), let compare = actions.compare {
                // The member's players there, then the free agents: each head only over rows of its own.
                if !compare.rows.isEmpty {
                    SectionRow(title: compare.yours)
                    ForEach(compare.rows) { row in
                        YoursRowView(row: row, projected: model.projected, open: actions.open)
                    }
                }
                if !table.rows.isEmpty {
                    SectionRow(title: compare.free)
                }
            }
            if groups.contains(.gaining) {
                ForEach(table.gaining) { row in entry(row) }
            }
            if groups.contains(.opened) {
                ForEach(table.rows.filter { $0.key == actions.opened }) { row in entry(row) }
            }
            if groups.contains(.rest), !table.rest.isEmpty {
                SectionRow(title: Words.Waivers.noGain)
                ForEach(table.rest) { row in entry(row) }
            }
            if groups.contains(.gaining), table.gaining.isEmpty, table.rest.isEmpty {
                NoteRow(text: actions.empty)
            }
            if groups.contains(.stash), !table.stash.isEmpty || !model.stashLine.isEmpty {
                SectionRow(title: Words.Stash.head)
                if !model.stashLine.isEmpty {
                    NoteRow(text: model.stashLine.joined(separator: " "))
                }
                ForEach(table.stash) { row in entry(row) }
            }
        }
        .opacity(actions.reading ? 0.6 : 1)
        .accessibilityLabel(Words.InSeason.waiverAdds)
    }

    @ViewBuilder
    private func entry(_ row: PoolRow) -> some View {
        WaiverRowView(row: row, projected: model.projected, open: actions.opened == row.key, actions: actions)
        if actions.opened == row.key {
            DropPanel(projected: model.projected, actions: actions)
        }
    }
}

/// The columns' basis said once under the heads, each head in bold (Lane 98, B35).
struct HeadsLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    var body: some View {
        let theme = Theme(colorScheme)
        Text(bolded(theme))
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
            .overlay(alignment: .bottom) { Hairline() }
    }

    /// The heads named in the line drawn strong.
    private func bolded(_ theme: Theme) -> AttributedString {
        var said = AttributedString(text)
        said.foregroundColor = theme.color(Tokens.Color.ink2)
        let heads = [Words.Waivers.rest, Words.Box.avg, Words.Box.delta, Words.Waivers.beats]
        for head in heads {
            if let range = said.range(of: "\(head) ") ?? said.range(of: head) {
                said[range].font = Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold)
                said[range].foregroundColor = theme.color(Tokens.Color.ink)
            }
        }
        return said
    }
}

/// One player free to add: his cell with the evidence line and A game, Proj, Beats and his button. The
/// strip's own move is tinted in the accent; a row that gains nothing is quiet.
struct WaiverRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: PoolRow
    let projected: Bool
    let open: Bool
    let actions: TableActions

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            PlayerCell(
                cells: row.cells, sheetPlayer: row.sheetPlayer, evidence: row.evidence, facts: false,
                clears: row.clears, note: row.away, open: actions.open
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            if projected {
                Figure(text: row.cells.proj, width: WaiverColumn.proj, muted: row.cells.proj == Words.Box.none)
            }
            BeatsView(beats: row.beats, quiet: !row.gains)
                .frame(width: WaiverColumn.beats, alignment: .trailing)
            button(theme)
                .frame(width: WaiverColumn.act, alignment: .trailing)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(theme.color(row.named || open ? Tokens.Color.accentWash : Tokens.Color.surface))
        .overlay(alignment: .leading) {
            if row.named {
                Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 3)
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func button(_ theme: Theme) -> some View {
        let word = row.button != Words.InSeason.add
        return Button { actions.tap(row.key) } label: {
            Group {
                if word {
                    Text(row.button)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                } else {
                    Image(systemName: open ? "chevron.up" : "plus")
                        .font(.system(size: 13, weight: .semibold))
                }
            }
            .foregroundStyle(theme.color(open ? Tokens.Color.accentText
                    : row.gains ? Tokens.Color.ink : Tokens.Color.ink3))
            .frame(minWidth: 30, minHeight: 30)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .strokeBorder(theme.color(open ? Tokens.Color.accent : Tokens.Color.lineStrong)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(open ? Words.Waivers.close : row.button) \(row.cells.row.name)")
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}

/// One of the member's players at the chosen position (WaiverTable.svelte's Your rows): his cell with the
/// evidence line and A game, Proj, and Starter or Bench where a free agent's Beats is; no verb.
struct YoursRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: YoursRow
    let projected: Bool
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            PlayerCell(
                cells: row.cells, sheetPlayer: row.sheetPlayer, evidence: row.evidence, facts: false, open: open
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            if projected {
                Figure(text: row.cells.proj, width: WaiverColumn.proj, muted: row.cells.proj == Words.Box.none)
            }
            Text(row.role)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: row.starts ? .bold : .regular))
                .foregroundStyle(theme.color(row.starts ? Tokens.Color.ink : Tokens.Color.ink3))
                .frame(width: WaiverColumn.beats, alignment: .trailing)
            Color.clear.frame(width: WaiverColumn.act, height: 1)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(theme.color(Tokens.Color.surface2))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The Beats cell: whom his move replaces with his place, then the season Gain, loud on a row that gains,
/// and the strip's move's week figure under it.
struct BeatsView: View {
    @Environment(\.colorScheme) private var colorScheme
    let beats: BeatsCell
    let quiet: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .trailing, spacing: 1) {
            if let who = beats.who {
                Text(who.name)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(who.place)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .lineLimit(1)
            }
            if let figure = beats.figure {
                Text(figure)
                    .font(Faces.font(
                        .num,
                        size: beats.loud ? Tokens.TypeScale.md : Tokens.TypeScale.sm,
                        weight: beats.loud ? .bold : .medium
                    ))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(beats.loud ? Tokens.Color.gainInk
                            : quiet ? Tokens.Color.ink3 : Tokens.Color.ink2))
            }
            if let week = beats.week {
                Text(week)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
        }
    }
}

/// An add's drop panel: "Drop one for Mason Taylor" with its lead, then each player of the member's he
/// could replace in the same columns, the advice's drop first, a radio to choose one; the pair the verb
/// makes is pinned above the bar.
struct DropPanel: View {
    @Environment(\.colorScheme) private var colorScheme
    let projected: Bool
    let actions: TableActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            if let head = actions.dropHead {
                VStack(alignment: .leading, spacing: 2) {
                    Text(head.title)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Text(head.lead)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.s3)
                .padding(.vertical, Tokens.Space.s2)
                .background(theme.color(Tokens.Color.surface2))
                .overlay(alignment: .bottom) { Hairline() }
            }
            ForEach(actions.drops) { drop in
                DropRowView(
                    drop: drop, projected: projected,
                    chosen: drop.key == (actions.chosenDrop ?? actions.drops.first?.key),
                    actions: actions
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(actions.dropHead?.title ?? "")
    }
}

/// One player the add could replace: his cell, Proj, the season Gain with him dropped (and the week's
/// where the drops differ), Starter where this week's lineup starts him, and the radio.
struct DropRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let drop: DropRow
    let projected: Bool
    let chosen: Bool
    let actions: TableActions

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            PlayerCell(
                cells: drop.cells, sheetPlayer: drop.cells.sheetPlayer, evidence: drop.evidence, facts: false,
                open: actions.open
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Tokens.Space.s3)
            if projected {
                Figure(text: drop.cells.proj, width: WaiverColumn.proj, muted: drop.cells.proj == Words.Box.none)
            }
            VStack(alignment: .trailing, spacing: 2) {
                if let starter = drop.starter {
                    Pill(starter, tone: .quiet)
                }
                Text(drop.gain)
                    .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(drop.gain.hasPrefix("+") ? Tokens.Color.gainInk
                            : drop.gain.hasPrefix("\u{2212}") ? Tokens.Color.lossInk : Tokens.Color.ink2))
                if let week = drop.week {
                    Text(week)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
            .frame(width: WaiverColumn.beats, alignment: .trailing)
            Button { actions.chooseDrop(drop.key) } label: {
                Circle()
                    .strokeBorder(theme.color(chosen ? Tokens.Color.accent : Tokens.Color.lineStrong), lineWidth: 2)
                    .background(Circle().fill(theme.color(chosen ? Tokens.Color.accent : Tokens.Color.surface))
                        .padding(5))
                    .frame(width: 22, height: 22)
                    .frame(width: WaiverColumn.act, height: 30, alignment: .trailing)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(Words.Stash.drop) \(drop.cells.row.name)")
            .accessibilityAddTraits(chosen ? [.isSelected, .isButton] : .isButton)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(theme.color(chosen ? Tokens.Color.accentWash : Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
    }
}
