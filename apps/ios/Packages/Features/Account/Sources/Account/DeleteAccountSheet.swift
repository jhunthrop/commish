import CommishCore
import CommishDesign
import SwiftUI

/// The confirmation the Account's Delete account opens (DeleteView.svelte, in the web's words): what is
/// deleted and what is kept, who is signed in, the email typed by hand, and the one verb, held until the
/// email is the account's and while the delete runs; a refusal in the API's sentence under it. `live`
/// is false in a snapshot, which draws the field's text in place of the system's text field.
public struct DeleteAccountSheet: View {
    @Environment(\.colorScheme) private var colorScheme
    @Bindable private var viewModel: DeleteAccountViewModel
    private let live: Bool

    public init(viewModel: DeleteAccountViewModel, live: Bool = true) {
        self.viewModel = viewModel
        self.live = live
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(Words.DeleteAccount.heading)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.head, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                Text(Words.DeleteAccount.lead)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            DeleteList(head: Words.DeleteAccount.deletedHead, lines: Words.DeleteAccount.deleted)
            DeleteList(head: Words.DeleteAccount.keptHead, lines: Words.DeleteAccount.kept)
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                Text(viewModel.signedIn)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                field(theme)
                Verb(Words.DeleteAccount.sheetVerb, enabled: viewModel.canDelete) {
                    Task { await viewModel.delete() }
                }
                if let problem = viewModel.problem {
                    Text(problem)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.lossInk))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
        }
        .padding(Tokens.Space.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(Tokens.Color.bg))
    }

    /// The labelled field (Field.svelte): the label, then the line the email is typed in.
    private func field(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(Words.DeleteAccount.confirm)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            Group {
                if live {
                    TextField(Words.DeleteAccount.confirm, text: $viewModel.typed)
                        .modifier(EmailEntry())
                        .disabled(viewModel.busy)
                } else {
                    Text(viewModel.typed)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
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

/// One of the two lists, Deleted or Kept (DeleteView.svelte's sections): its head, then its lines.
struct DeleteList: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: String
    let lines: [String]

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(head.uppercased())
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .accessibilityAddTraits(.isHeader)
            ForEach(lines, id: \.self) { line in
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                    Circle()
                        .fill(theme.color(Tokens.Color.ink3))
                        .frame(width: 4, height: 4)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 4 }
                    Text(line)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// An email line: no capitals, no corrections, the email keyboard.
private struct EmailEntry: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            content
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
        #else
            content.autocorrectionDisabled()
        #endif
    }
}
