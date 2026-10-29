import CommishCore
import CommishDesign
import SwiftUI

/// One group of choices: its heading (none for the first), each choice's key and words.
struct ChoiceGroup: Identifiable {
    let title: String?
    let choices: [(id: String, label: String)]

    var id: String {
        title ?? ""
    }
}

/// A select as the phone draws it (the web's PickSelect at 390): a box with the choice in it and the
/// chevrons; a tap opens the choices in a sheet, each group under its heading, the chosen one ticked.
struct ChoiceField: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var open = false
    let label: String
    let value: String
    let chosen: String?
    let groups: [ChoiceGroup]
    let choose: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button { open = true } label: {
            HStack(spacing: Tokens.Space.s2) {
                // The choice whole, on a second line where it is long.
                Text(value)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Tokens.Space.s2)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.horizontal, Tokens.Space.s3)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.lineStrong))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(value)
        .sheet(isPresented: $open) {
            NavigationStack {
                List {
                    ForEach(groups) { group in
                        Section {
                            ForEach(group.choices, id: \.id) { choice in
                                Button {
                                    open = false
                                    choose(choice.id)
                                } label: {
                                    HStack {
                                        Text(choice.label)
                                        Spacer()
                                        if choice.id == chosen {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        } header: {
                            if let title = group.title {
                                Text(title)
                            }
                        }
                    }
                }
                .navigationTitle(label)
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
            }
            .presentationDetents([.medium, .large])
        }
    }
}
