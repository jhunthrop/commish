import CommishCore
import CommishDesign
import SwiftUI

/// A screen named until its lane lands: its title as a screen head and what it was opened for beside it
/// (the search's query).
public struct NamedScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String
    private let aside: String?

    public init(_ title: String, aside: String? = nil) {
        self.title = title
        self.aside = aside
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            SectionHead(title, aside: aside)
            Spacer()
        }
        .padding(Tokens.Space.s4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme(colorScheme).color(Tokens.Color.bg))
        .navigationTitle(title)
    }
}
