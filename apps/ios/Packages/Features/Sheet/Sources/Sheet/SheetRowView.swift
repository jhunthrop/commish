import CommishCore
import CommishDesign
import SwiftUI

/// What a row's controls do: his face and name open the player sheet, the disclosure opens his editor,
/// the editor writes his note, his tags and his removal, and an unsaved row's retry writes again.
struct SheetRowActions {
    let open: (SheetPlayer) -> Void
    let toggle: (String) -> Void
    let note: (String, String) -> Void
    let tag: (String, String) async -> Bool
    let addTag: (String, String) async -> String?
    let remove: (String) -> Void
    let retry: () -> Void

    /// Controls that do nothing: a snapshot's.
    static var none: SheetRowActions {
        SheetRowActions(
            open: { _ in }, toggle: { _ in }, note: { _, _ in }, tag: { _, _ in true }, addTag: { _, _ in nil },
            remove: { _ in }, retry: {}
        )
    }
}

/// One player's row at 390 (SheetRow.svelte's compact row): his face, his name the biggest thing with his
/// marks beside it (a count of his tags in their tone, a mark for his note), his position, tier and club
/// under it, his place on the sheet; under the row, an edit not saved said with its reason and a retry.
struct SheetRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: SheetLine
    let open: Bool
    let actions: SheetRowActions
    /// The editor's disclosure; none on a row that only previews (the empty sheet's).
    var editable = true

    static let face: Double = 40

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Tokens.Space.s2) {
                who(theme)
                    .contentShape(Rectangle())
                    .onTapGesture { actions.open(line.player) }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint(Words.Shelf.fullPage)
                if editable {
                    place(theme)
                } else {
                    Text(String(line.place))
                        .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, 6)
            .frame(minHeight: 56)
            if let words = line.save.words {
                saveLine(words, theme: theme)
            }
            ForEach(line.notices, id: \.self) { notice in
                noticeLine(notice, theme: theme)
            }
        }
        .background(theme.color(open ? Tokens.Color.surface2 : Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func who(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            Headshot(line.headshot, initials: line.initials, side: Self.face, club: line.clubMark ? line.team : nil)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(line.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    marks(theme)
                }
                HStack(spacing: 6) {
                    PositionPill(line.position)
                    if let tier = line.tier {
                        TierChip(tier)
                    }
                    if let team = line.team, !line.clubMark {
                        Text(team)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                            .tracking(Tokens.TypeScale.xs * 0.06)
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// His tags folded into a count in their tone (Avoid's loss tone over the rest) and a mark for a note.
    @ViewBuilder
    private func marks(_ theme: Theme) -> some View {
        if !line.tags.isEmpty {
            let avoids = line.tags.contains { $0.tone == .loss }
            HStack(spacing: 3) {
                Image(systemName: "tag.fill").font(.system(size: 9, weight: .bold))
                Text(String(line.tags.count))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            }
            .foregroundStyle(theme.color(avoids ? Tokens.Color.lossInk : Tokens.Color.accentText))
            .padding(.horizontal, 6)
            .frame(height: 20)
            .background(Capsule().fill(theme.color(avoids ? Tokens.Color.lossBg : Tokens.Color.surface2)))
            .accessibilityLabel(SheetWords.tagsSaid(line.tags))
        }
        if line.note != nil {
            Image(systemName: "note.text")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .accessibilityLabel(SheetWords.hasNote)
        }
    }

    /// His place on the sheet and the editor's disclosure.
    private func place(_ theme: Theme) -> some View {
        Button { actions.toggle(line.id) } label: {
            HStack(spacing: 6) {
                Text(String(line.place))
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                Image(systemName: open ? "chevron.up" : "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            .frame(minWidth: 56, minHeight: 44, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SheetWords.edit(line.name))
    }

    /// What the phone had where the account's copy won (merge.ts's notice), under the row.
    private func noticeLine(_ words: String, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Tokens.Space.s3 + Self.face + Tokens.Space.s2)
            .padding(.trailing, Tokens.Space.s3)
            .padding(.bottom, Tokens.Space.s1)
    }

    /// The row's save: on its way, or not saved with the reason and the retry.
    private func saveLine(_ words: String, theme: Theme) -> some View {
        let unsaved = if case .unsaved = line.save {
            true
        } else {
            false
        }
        return HStack(spacing: Tokens.Space.s2) {
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(unsaved ? Tokens.Color.lossInk : Tokens.Color.ink3))
                .frame(maxWidth: .infinity, alignment: .leading)
            if unsaved {
                QuietButton(SheetWords.tryAgain, action: actions.retry)
            }
        }
        .padding(.leading, Tokens.Space.s3 + Self.face + Tokens.Space.s2)
        .padding(.trailing, Tokens.Space.s3)
        .padding(.bottom, Tokens.Space.s1)
    }
}

/// The open row's editor (RowEditor.svelte): his note, the fixed tags and the drafter's own as chips, a
/// field for a tag of his own, and taking him off the sheet. A snapshot draws the note as it reads.
struct SheetEditorView: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: SheetLine
    let ownTags: [String]
    let actions: SheetRowActions
    var live = true

    @State private var note = ""
    @State private var newTag = ""
    @State private var problem: String?
    @FocusState private var noteFocused: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            noteField(theme)
            FlowChips(chips: chips) { tag in
                Task { problem = await actions.tag(line.id, tag) ? nil : SheetWords.full }
            }
            if line.tags.count < SheetLimits.tags {
                HStack(spacing: Tokens.Space.s2) {
                    field(SheetWords.ownTagPlaceholder, text: $newTag, theme: theme)
                        .onSubmit(addOwn)
                    QuietButton(SheetWords.addTag, action: addOwn)
                }
            }
            if let problem {
                Text(problem)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
            }
            QuietButton(SheetWords.remove) { actions.remove(line.id) }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s3)
        .background(theme.color(Tokens.Color.surface2))
        .overlay(alignment: .bottom) { Hairline() }
        .onAppear { note = line.note ?? "" }
        .onChange(of: noteFocused) { _, focused in
            if !focused {
                actions.note(line.id, note)
            }
        }
        .onDisappear { actions.note(line.id, note) }
    }

    private var chips: [BoardChip<String>] {
        SheetModel.tagChips(line, ownTags: ownTags)
    }

    @ViewBuilder
    private func noteField(_ theme: Theme) -> some View {
        if live {
            TextField(SheetWords.notePlaceholder, text: $note, axis: .vertical)
                .lineLimit(2 ... 4)
                .focused($noteFocused)
                .modifier(FieldFrame(theme: theme))
        } else {
            Text(line.note ?? SheetWords.notePlaceholder)
                .foregroundStyle(theme.color(line.note == nil ? Tokens.Color.ink3 : Tokens.Color.ink))
                .lineLimit(2 ... 4)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .modifier(FieldFrame(theme: theme))
        }
    }

    @ViewBuilder
    private func field(_ placeholder: String, text: Binding<String>, theme: Theme) -> some View {
        if live {
            TextField(placeholder, text: text).modifier(FieldFrame(theme: theme))
        } else {
            Text(placeholder)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .frame(maxWidth: .infinity, alignment: .leading)
                .modifier(FieldFrame(theme: theme))
        }
    }

    private func addOwn() {
        let typed = newTag
        Task {
            problem = await actions.addTag(line.id, typed)
            if problem == nil {
                newTag = ""
            }
        }
    }
}

/// A text field's frame (Field.svelte): the surface, a hairline border, the body face.
struct FieldFrame: ViewModifier {
    let theme: Theme

    func body(content: Content) -> some View {
        content
            .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .regular))
            .padding(.horizontal, Tokens.Space.s2)
            .padding(.vertical, Tokens.Space.s2)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.sm).stroke(theme.color(Tokens.Color.line), lineWidth: 1)
            )
    }
}

/// Chips that wrap onto as many lines as they need (ChipGroup.svelte's loose variant).
struct FlowChips: View {
    let chips: [BoardChip<String>]
    let choose: (String) -> Void

    var body: some View {
        Flow(spacing: Tokens.Space.s2) {
            ForEach(chips) { chip in
                ChoiceChip(chip.label, pressed: chip.pressed) { choose(chip.value) }
            }
        }
    }
}

/// Lays its views in rows from the leading edge, a new row where the next would pass the trailing one.
struct Flow: Layout {
    let spacing: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews, width: width)
        let height = rows.map(\.height).reduce(0, +) + spacing * Double(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var top = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            var edge = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: edge, y: top), proposal: ProposedViewSize(size))
                edge += size.width + spacing
            }
            top += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: Double = 0
        var height: Double = 0
    }

    private func rows(_ subviews: Subviews, width: Double) -> [Row] {
        var rows = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let next = rows[rows.count - 1].width + (rows[rows.count - 1].indices.isEmpty ? 0 : spacing) + size.width
            if next > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let gap = rows[rows.count - 1].indices.isEmpty ? 0 : spacing
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
