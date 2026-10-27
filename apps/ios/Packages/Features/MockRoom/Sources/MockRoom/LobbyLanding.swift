import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The open house drafts (LobbyList.svelte at 390, on the setup page where the web's /lobby goes): the
/// list's head, a card a format with its title and clock, how many are in, and its one verb; a draft
/// the member holds a seat in reads "Your seat". Its problem in the API's words under it.
struct LobbyListView: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: String
    let cards: [LobbyCard]
    let problem: String?
    let enabled: Bool
    let join: (LobbyCard) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        RoomPanel {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(head)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                ForEach(cards) { card in
                    Button { join(card) } label: { row(card, theme) }
                        .buttonStyle(.plain)
                        .disabled(!enabled)
                }
                if let problem {
                    Note(text: problem)
                }
            }
        }
    }

    private func row(_ card: LobbyCard, _ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(card.clock)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(card.fill)
                .font(card.empty
                    ? Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium)
                    : Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.color(card.empty ? Tokens.Color.ink3 : Tokens.Color.ink2))
            Text(card.verb)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.accentText))
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .fill(theme.color(card.seat == nil ? Tokens.Color.surface : Tokens.Color.accentWash))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(card.seat == nil ? Tokens.Color.line : Tokens.Color.accent))
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// The handle a join needs first (HandlePrompt.svelte): the question, the field, Save and join, and the
/// API's word when it refused the last one.
struct LobbyHandleView: View {
    let problem: String?
    let busy: Bool
    let save: (String) -> Void
    @State private var handle = ""

    var body: some View {
        RoomPanel(accent: true) {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(Words.Lobby.handleAsk)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                TextField(Words.Lobby.handlePlaceholder, text: $handle)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                #endif
                    .accessibilityLabel(Words.Lobby.handleLabel)
                Verb(
                    Words.Lobby.saveAndJoin,
                    enabled: !busy && handle.trimmingCharacters(in: .whitespaces).count >= 3
                ) { save(handle) }
                if let problem {
                    Note(text: problem)
                }
            }
        }
    }
}
