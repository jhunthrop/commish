import CommishCore
import CommishDesign
import SwiftUI

/// A screen named until its lane lands: its title as a screen head, what it was opened for beside it
/// (the search's query), and the screen's verb when it has one already (the account's sign-out).
public struct NamedScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String
    private let aside: String?
    private let verb: (title: String, action: () -> Void)?

    public init(_ title: String, aside: String? = nil, verb: (title: String, action: () -> Void)? = nil) {
        self.title = title
        self.aside = aside
        self.verb = verb
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            SectionHead(title, aside: aside)
            if let verb {
                QuietButton(verb.title, action: verb.action)
            }
            Spacer()
        }
        .padding(Tokens.Space.s4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme(colorScheme).color(Tokens.Color.bg))
        .navigationTitle(title)
    }
}
