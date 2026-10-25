import Board
import CommishCore
import CommishDesign
import SwiftUI

/// The companion's head (CompanionBar.svelte at 390): the platform's pick count, big, where a mock
/// room's clock would be, the draft and the league, when you are up (in the accent at your turn), the
/// platform gone quiet, and the way back to its draft room.
struct CompanionBarView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bar: CompanionBar
    let openDraft: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Panel(edge: bar.onTurn ? .accent : .plain) {
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                Text(bar.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(bar.caption)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Text(bar.title)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .textCase(.uppercase)
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .padding(.top, Tokens.Space.s2)
                    .accessibilityAddTraits(.isHeader)
                NoteText(text: bar.league)
                Text(bar.turn)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: bar.onTurn ? .bold : .regular))
                    .foregroundStyle(theme.color(bar.onTurn ? Tokens.Color.accentText : Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
                if let stale = bar.stale {
                    NoteText(text: stale, ink: Tokens.Color.lossInk)
                }
                QuietButton(bar.open, action: openDraft)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(bar.section)
    }
}

/// Our call (CallPanel.svelte at 390): its tag, the heads, the call first then the next two, and the
/// one verb: solid at your turn, quiet while the call waits on the board.
struct CallPanelView: View {
    @Environment(\.colorScheme) private var colorScheme
    let call: CallModel
    let open: (SheetPlayer) -> Void
    let press: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Panel(edge: call.waiting ? .quiet : .accent) {
            VStack(alignment: .leading, spacing: 0) {
                Text(call.tag)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(call.waiting ? Tokens.Color.ink3 : Tokens.Color.accentText))
                    .padding(.bottom, Tokens.Space.s2)
                HStack(spacing: 6) {
                    HeadText(text: Words.Room.player, alignment: .leading)
                    HeadText(text: Words.Room.overRepl).frame(width: CompanionColumn.value, alignment: .trailing)
                    HeadText(text: call.chanceHead ?? "").frame(width: CompanionColumn.chance, alignment: .trailing)
                }
                .padding(.leading, CompanionColumn.face + 6)
                .frame(minHeight: 28)
                .accessibilityHidden(true)
                ForEach(Array(call.rows.enumerated()), id: \.element.id) { index, row in
                    HStack(spacing: 6) {
                        PlayerFace(player: row.player)
                        WhoCell(player: row.player)
                        FigureText(
                            text: row.value, width: CompanionColumn.value,
                            ink: row.player.isMarket ? Tokens.Color.ink3 : Tokens.Color.ink2,
                            size: row.player.isMarket ? Tokens.TypeScale.xs : Tokens.TypeScale.lg
                        )
                        FigureText(text: row.chance, width: CompanionColumn.chance, size: Tokens.TypeScale.xl)
                    }
                    .padding(.vertical, 6)
                    .background(index == 0 && !call.waiting ? theme.color(Tokens.Color.accentWash) : .clear)
                    .overlay(alignment: .top) { Hairline() }
                    .contentShape(Rectangle())
                    .onTapGesture { open(row.player.sheetPlayer) }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                }
                Group {
                    if call.waiting {
                        QuietButton(call.verb, action: press)
                    } else {
                        Verb(call.verb, action: press)
                    }
                }
                .padding(.top, Tokens.Space.s2)
            }
        }
    }
}

/// Who we would take next (Shortlist.svelte): each player after the call with his chance of lasting.
struct ShortlistView: View {
    let lines: [ShortlistLine]
    let open: (SheetPlayer) -> Void

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(Words.Companion.nextTitle, aside: Words.Companion.nextAside)
                    .padding(.bottom, Tokens.Space.s2)
                ForEach(lines) { line in
                    HStack(spacing: 6) {
                        PlayerFace(player: line.player, side: 40)
                        WhoCell(player: line.player)
                        ChanceCell(
                            chance: line.chance,
                            label: line.label,
                            missing: RoomWords.chanceMissing(gone: false, read: true)
                        )
                    }
                    .padding(.vertical, 6)
                    .overlay(alignment: .top) { Hairline() }
                    .contentShape(Rectangle())
                    .onTapGesture { open(line.player.sheetPlayer) }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
    }
}

/// The pool (Pool.svelte at 390): its title and count, the chips, the basis over it, the heads, the
/// rows (our call washed), more on a tap.
struct PoolView: View {
    @Environment(\.colorScheme) private var colorScheme
    let pool: PoolModel
    let shown: Int
    let choose: (String) -> Void
    let more: () -> Void
    let open: (SheetPlayer) -> Void
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Room.pool, aside: pool.line).padding(.horizontal, Tokens.Space.s3)
            ChipRow(
                chips: pool.chips,
                choose: choose, live: live
            )
            BasisText(pool.basis).padding(.horizontal, Tokens.Space.s3)
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    HeadText(text: Words.Room.player, alignment: .leading)
                    HeadText(text: Words.Room.overRepl).frame(width: CompanionColumn.value, alignment: .trailing)
                    if let head = pool.chanceHead {
                        HeadText(text: head).frame(width: CompanionColumn.chance, alignment: .trailing)
                    }
                }
                .padding(.leading, CompanionColumn.face + 6)
                .padding(.horizontal, Tokens.Space.s2)
                .frame(minHeight: 30)
                .overlay(alignment: .bottom) { Hairline() }
                .accessibilityHidden(true)
                ForEach(pool.rows.prefix(shown)) { row in
                    HStack(spacing: 6) {
                        PlayerFace(player: row.player)
                        WhoCell(player: row.player)
                        ValueCell(text: row.value, heat: row.heat)
                        if pool.chanceHead != nil {
                            ChanceCell(chance: row.chance, label: pool.chanceLabel, missing: pool.missing)
                        }
                    }
                    .padding(.horizontal, Tokens.Space.s2)
                    .padding(.vertical, 6)
                    .frame(minHeight: 52)
                    .background(theme.color(row.isCall ? Tokens.Color.accentWash : Tokens.Color.surface))
                    .overlay(alignment: .bottom) { Hairline() }
                    .contentShape(Rectangle())
                    .onTapGesture { open(row.player.sheetPlayer) }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                }
                if let empty = pool.empty {
                    NoteText(text: empty).padding(Tokens.Space.s3)
                }
            }
            if pool.rows.count > shown {
                QuietButton(RoomWords.showMore(min(PoolModel.moreRows, pool.rows.count - shown)), action: more)
                    .padding(.horizontal, Tokens.Space.s3)
            }
        }
    }
}

/// Your team (TeamPanel.svelte): the count, then each slot with who fills it and the pick that took
/// him, or open.
struct TeamView: View {
    @Environment(\.colorScheme) private var colorScheme
    let team: TeamModel
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Panel {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(Words.Room.yourTeam, aside: team.count).padding(.bottom, Tokens.Space.s2)
                ForEach(team.slots) { line in
                    HStack(spacing: 6) {
                        Text(line.slot)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                            .frame(width: CompanionColumn.slot, alignment: .leading)
                        if let player = line.player {
                            PlayerFace(player: player)
                            WhoCell(player: player)
                            FigureText(
                                text: line.pick ?? "",
                                width: CompanionColumn.pick,
                                ink: Tokens.Color.ink2,
                                size: Tokens.TypeScale.sm
                            )
                        } else {
                            Text(Words.Room.open)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                                .foregroundStyle(theme.color(Tokens.Color.ink3))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .frame(minHeight: line.player == nil ? 30 : 44)
                    .overlay(alignment: .top) { Hairline() }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if let player = line.player {
                            open(player.sheetPlayer)
                        }
                    }
                }
            }
        }
    }
}
