import Board
import CommishCore
import CommishDesign
import SwiftUI

/// What the room's controls do: the bar's verbs, a pool row's mark, queue and draft, a chip, the call's
/// one verb.
public struct MockRoomActions {
    let draft: (String?) -> Void
    let undo: () -> Void
    let autopick: () -> Void
    let finish: () -> Void
    let share: () -> Void
    let queue: (String) -> Void
    let mark: (String) -> Void
    let filter: (String) -> Void

    public init(
        draft: @escaping (String?) -> Void, undo: @escaping () -> Void, autopick: @escaping () -> Void,
        finish: @escaping () -> Void, share: @escaping () -> Void, queue: @escaping (String) -> Void,
        mark: @escaping (String) -> Void, filter: @escaping (String) -> Void
    ) {
        self.draft = draft
        self.undo = undo
        self.autopick = autopick
        self.finish = finish
        self.share = share
        self.queue = queue
        self.mark = mark
        self.filter = filter
    }

    /// Controls that do nothing: a snapshot's.
    public static var none: MockRoomActions {
        MockRoomActions(
            draft: { _ in }, undo: {}, autopick: {}, finish: {}, share: {}, queue: { _ in }, mark: { _ in },
            filter: { _ in }
        )
    }
}

/// The web's SoloBar as the room's bottom bar: the pick on the clock, big, the league's cells, Undo,
/// and More holding Pick for me, Finish the draft and Save and share (the phone's fold).
struct MockBarView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bar: MockBar
    let enabled: Bool
    let copied: Bool
    let actions: MockRoomActions
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            // The web's bar wraps (SoloBar's flex-wrap): the pick and its cells on one line where they
            // fit, the cells under the pick where they do not, closer together on the small phone, so your next
            // pick is never cut off.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: Tokens.Space.s4) {
                    head(theme)
                    Cells(cells: bar.cells)
                }
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    head(theme)
                    Cells(cells: bar.cells)
                }
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    head(theme)
                    Cells(cells: bar.cells, spacing: Tokens.Space.s2)
                }
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    head(theme)
                    if live {
                        ScrollView(.horizontal, showsIndicators: false) { Cells(cells: bar.cells) }
                    } else {
                        Cells(cells: bar.cells).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).clipped()
                    }
                }
            }
            HStack(spacing: Tokens.Space.s2) {
                QuietButton(Words.Mock.undo, action: actions.undo)
                    .disabled(!enabled || bar.undoPick == nil)
                Spacer(minLength: 0)
                if live {
                    Menu {
                        Button(bar.autopick, action: actions.autopick).disabled(!enabled)
                        Button(Words.Mock.finish, action: actions.finish).disabled(!enabled)
                        Button(copied ? Words.Mock.copied : Words.Mock.share, action: actions.share)
                    } label: {
                        more(theme)
                    }
                } else {
                    more(theme)
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .top) { Hairline() }
    }
}

extension MockBarView {
    /// The pick on the clock, the bar's head.
    func head(_ theme: Theme) -> some View {
        Text(bar.head)
            .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
            .textCase(.uppercase)
            .monospacedDigit()
            .fixedSize()
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .accessibilityAddTraits(.isHeader)
    }

    /// More's face: the phone's fold of the bar's other verbs, or "Link copied" for a moment.
    func more(_ theme: Theme) -> some View {
        Text(copied ? Words.Mock.copied : Words.Mock.more)
            .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.horizontal, Tokens.Space.s3)
            .frame(minHeight: 44)
            .overlay(Capsule().strokeBorder(theme.color(Tokens.Color.lineStrong)))
    }
}

/// Our call (RoomCall.svelte, CallPanel.svelte at 390): its tag, the heads, the call first then the next
/// two, and the one verb; while the next call is on its way the last frame as a quiet skeleton with
/// its words; with no call coming, the line and the verb that drafts the pool's top row.
struct MockCallView: View {
    @Environment(\.colorScheme) private var colorScheme
    let state: MockCallState
    let enabled: Bool
    let draft: (String?) -> Void

    var body: some View {
        switch state {
        case let .call(call, player):
            panel(call, tag: call.tag, reading: false) {
                Verb(call.verb, enabled: enabled) { draft(player) }
            }
        case let .reading(call, words):
            panel(call, tag: words, reading: true) {
                Verb(Words.Room.waitingOnCall, enabled: false) {}
            }
        case let .noCall(verb, player):
            RoomPanel {
                VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                    Note(text: Words.Mock.noCall)
                    if let verb {
                        Verb(verb, enabled: enabled) { draft(player) }
                    }
                }
            }
        }
    }

    private func panel(
        _ call: CallModel, tag: String, reading: Bool, @ViewBuilder verb: () -> some View
    ) -> some View {
        let theme = Theme(colorScheme)
        return RoomPanel(accent: !reading && !call.waiting) {
            VStack(alignment: .leading, spacing: 0) {
                Text(tag)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(reading ? Tokens.Color.ink3 : Tokens.Color.accentText))
                    .padding(.bottom, Tokens.Space.s2)
                HStack(spacing: 6) {
                    Head(text: Words.Room.player, alignment: .leading)
                    Head(text: Words.Room.overRepl).frame(width: RoomColumn.value, alignment: .trailing)
                    Head(text: call.chanceHead ?? "").frame(width: RoomColumn.chance, alignment: .trailing)
                }
                .padding(.leading, RoomColumn.face + 6)
                .frame(minHeight: 28)
                .accessibilityHidden(true)
                ForEach(Array(call.rows.enumerated()), id: \.element.id) { index, row in
                    HStack(spacing: 6) {
                        Who(player: row.player)
                        Figure(
                            text: row.value, width: RoomColumn.value,
                            ink: row.player.isMarket ? Tokens.Color.ink3 : Tokens.Color.ink2,
                            size: row.player.isMarket ? Tokens.TypeScale.xs : Tokens.TypeScale.lg
                        )
                        Figure(text: row.chance, width: RoomColumn.chance, size: Tokens.TypeScale.xl)
                    }
                    .padding(.vertical, 6)
                    .background(index == 0 && !reading ? theme.color(Tokens.Color.accentWash) : .clear)
                    .overlay(alignment: .top) { Hairline() }
                    .accessibilityElement(children: .combine)
                }
                verb().padding(.top, Tokens.Space.s2)
            }
            .opacity(reading ? 0.55 : 1)
        }
    }
}

/// The strip of picks since your last (SinceStrip.svelte, PickStrip.svelte): the count and its lines,
/// then each face with his last name and pick, the queued ringed; or the one line when your turn came
/// straight back.
struct SinceView: View {
    @Environment(\.colorScheme) private var colorScheme
    let strip: PickStripModel?
    let straight: String?
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        if let straight {
            RoomPanel { Note(text: straight) }
        } else if let strip {
            RoomPanel {
                HStack(alignment: .top, spacing: Tokens.Space.s3) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(strip.lead)
                            .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(theme.color(Tokens.Color.ink))
                        ForEach(strip.lines, id: \.self) { line in
                            Text(line)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                                .foregroundStyle(theme.color(Tokens.Color.ink3))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(width: 92, alignment: .leading)
                    if live {
                        ScrollView(.horizontal, showsIndicators: false) { faces(strip, theme) }
                    } else {
                        faces(strip, theme).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).clipped()
                    }
                }
            }
        }
    }

    private func faces(_ strip: PickStripModel, _ theme: Theme) -> some View {
        HStack(alignment: .top, spacing: Tokens.Space.s2) {
            ForEach(strip.picks) { pick in
                VStack(spacing: 2) {
                    Headshot(URL(string: pick.player.headshot), initials: Initials.of(pick.player.name), side: 36)
                        .overlay(Circle().strokeBorder(
                            theme.color(Tokens.Color.accent),
                            lineWidth: pick.strong ? 2 : 0
                        ))
                    Text(pick.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    ForEach(pick.lines, id: \.self) { line in
                        Text(line)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                            .lineLimit(1)
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                }
                .frame(width: 64)
                .accessibilityElement(children: .combine)
            }
        }
        .fixedSize()
    }
}

/// The pool (Pool.svelte at 390): its title and count, the chips, the basis, the heads, the rows (our
/// call washed); a tap marks a row and shows its Queue and Draft, as the web's phone row does.
struct MockPoolView: View {
    @Environment(\.colorScheme) private var colorScheme
    let pool: MockPool
    let shown: Int
    let enabled: Bool
    let actions: MockRoomActions
    let more: () -> Void
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Room.pool, aside: pool.model.line).padding(.horizontal, Tokens.Space.s3)
            ChipRow(chips: pool.chips, choose: actions.filter, live: live)
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).clipped()
            BasisText(pool.model.basis).padding(.horizontal, Tokens.Space.s3)
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Head(text: Words.Room.player, alignment: .leading)
                    Head(text: Words.Room.overRepl).frame(width: RoomColumn.value, alignment: .trailing)
                    if let head = pool.model.chanceHead {
                        Head(text: head).frame(width: RoomColumn.chance, alignment: .trailing)
                    }
                }
                .padding(.leading, RoomColumn.face + 6)
                .padding(.horizontal, Tokens.Space.s2)
                .frame(minHeight: 30)
                .overlay(alignment: .bottom) { Hairline() }
                .accessibilityHidden(true)
                ForEach(pool.rows.prefix(shown)) { row in
                    MockPoolRow(row: row, pool: pool, enabled: enabled, actions: actions)
                        .background(theme
                            .color(row.line.isCall || row.marked ? Tokens.Color.accentWash : Tokens.Color.surface))
                }
                if let empty = pool.empty {
                    Note(text: empty).padding(Tokens.Space.s3)
                }
            }
            if pool.rows.count > shown {
                QuietButton(RoomWords.showMore(min(PoolModel.moreRows, pool.rows.count - shown)), action: more)
                    .padding(.horizontal, Tokens.Space.s3)
            }
        }
    }
}

/// One pool row: face, player, Over repl on its tint, the chance; marked, its Queue and Draft under it.
struct MockPoolRow: View {
    let row: MockPoolLine
    let pool: MockPool
    let enabled: Bool
    let actions: MockRoomActions

    var body: some View {
        VStack(alignment: .trailing, spacing: Tokens.Space.s1) {
            HStack(spacing: 6) {
                Who(player: row.line.player)
                Value(text: row.line.value, heat: row.line.heat)
                if pool.model.chanceHead != nil {
                    Chance(chance: row.line.chance, label: pool.model.chanceLabel, missing: pool.model.missing)
                }
            }
            if row.marked, !pool.readOnly {
                HStack(spacing: Tokens.Space.s2) {
                    QuietButton(row.queued ? Words.Mock.queued : Words.Mock.queue) { actions.queue(row.id) }
                    if pool.draftShown {
                        Verb(Words.Mock.draft, enabled: enabled && pool.canDraft) { actions.draft(row.id) }
                            .fixedSize()
                    }
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
        .onTapGesture {
            if !pool.readOnly {
                actions.mark(row.id)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(pool.readOnly ? [] : .isButton)
    }
}
