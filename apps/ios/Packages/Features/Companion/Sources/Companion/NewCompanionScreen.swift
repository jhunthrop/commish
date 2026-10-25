import CommishCore
import CommishDesign
import SwiftUI

/// The start page as its view model says it (NewCompanion.svelte at 390): the title and its line, the
/// Sleeper draft link, the seat by slot (a chip a slot) or by Sleeper username, the one verb with what
/// the API said under it, and the drafts followed before, each a tap back to it.
public struct NewCompanionScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    @Bindable var viewModel: NewCompanionViewModel
    let follow: () -> Void
    let openDraft: (String) -> Void
    /// The screen's: fields that take typing; a snapshot draws them still.
    var live = true

    public init(
        viewModel: NewCompanionViewModel, follow: @escaping () -> Void, openDraft: @escaping (String) -> Void,
        live: Bool = true
    ) {
        self.viewModel = viewModel
        self.follow = follow
        self.openDraft = openDraft
        self.live = live
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(Words.CompanionNew.title)
                    .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                NoteText(text: Words.CompanionNew.lede)
            }
            field(
                Words.CompanionNew.linkLabel,
                text: $viewModel.link,
                prompt: Words.CompanionNew.linkPlaceholder,
                theme: theme
            )
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                HeadText(text: Words.CompanionNew.seatBy, alignment: .leading)
                HStack(spacing: Tokens.Space.s2) {
                    ChoiceChip(Words.CompanionNew.bySlot, pressed: viewModel.seat == .slot) { viewModel.seat = .slot }
                    ChoiceChip(Words.CompanionNew.byUsername, pressed: viewModel.seat == .username) {
                        viewModel.seat = .username
                    }
                }
                if viewModel.seat == .slot {
                    HeadText(text: Words.CompanionNew.slotLabel, alignment: .leading).padding(.top, Tokens.Space.s1)
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: Tokens.Space.s2), count: 7),
                        spacing: Tokens.Space.s2
                    ) {
                        ForEach(NewCompanionViewModel.slots, id: \.self) { slot in
                            ChoiceChip(String(slot), pressed: viewModel.slot == slot) { viewModel.slot = slot }
                        }
                    }
                } else {
                    field(Words.CompanionNew.usernameLabel, text: $viewModel.username, prompt: nil, theme: theme)
                }
            }
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Verb(Words.CompanionNew.verb, enabled: viewModel.ready, action: follow)
                if let problem = viewModel.problem {
                    NoteText(text: problem, ink: Tokens.Color.lossInk)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            if viewModel.recentFailed {
                NoteText(text: Words.CompanionNew.recentFailed)
            } else if !viewModel.recent.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    SectionHead(Words.CompanionNew.recentTitle).padding(.bottom, Tokens.Space.s2)
                    ForEach(viewModel.recent) { draft in
                        Button { openDraft(draft.id) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(draft.lead)
                                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                                    .multilineTextAlignment(.leading)
                                NoteText(text: draft.text, ink: Tokens.Color.ink3)
                            }
                            .padding(.vertical, Tokens.Space.s2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(alignment: .top) { Hairline() }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(Tokens.Space.s4)
    }

    /// A labelled field (Field.svelte): the label, then the line to type in.
    private func field(_ label: String, text: Binding<String>, prompt: String?, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HeadText(text: label, alignment: .leading)
            Group {
                if live {
                    TextField(label, text: text, prompt: prompt.map { Text($0) })
                        .modifier(PlainEntry())
                        .submitLabel(.go)
                        .onSubmit(follow)
                } else {
                    Text(text.wrappedValue.isEmpty ? prompt ?? "" : text.wrappedValue)
                        .foregroundStyle(theme.color(text.wrappedValue.isEmpty ? Tokens.Color.ink3 : Tokens.Color.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .font(Faces.font(.ui, size: Tokens.TypeScale.md))
            .padding(.horizontal, Tokens.Space.s3)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.lineStrong)))
        }
    }
}

/// The start page with its view model: the drafts followed before read on open; the verb follows the
/// draft and opens it.
public struct NewCompanionView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: NewCompanionViewModel
    private let opened: (String) -> Void

    public init(viewModel: NewCompanionViewModel, opened: @escaping (String) -> Void) {
        self.viewModel = viewModel
        self.opened = opened
    }

    public var body: some View {
        ScrollView {
            NewCompanionScreen(
                viewModel: viewModel,
                follow: {
                    Task {
                        if let id = await viewModel.follow() {
                            opened(id)
                        }
                    }
                },
                openDraft: opened
            )
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme(colorScheme).color(Tokens.Color.bg))
        .task { await viewModel.load() }
    }
}

/// A link or a username as typed: no capitals, no corrections, the keyboard that has the slash.
private struct PlainEntry: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            content
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
        #else
            content.autocorrectionDisabled()
        #endif
    }
}
