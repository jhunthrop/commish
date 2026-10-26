import CommishCore
import CommishDesign
import SwiftUI

/// Signed out: the mark, what Commish is, and the one verb. The League tab's screen while the phone is
/// signed out, the public tabs beside it (B155), and where sign out returns the phone; the shell's
/// signed-out snapshot is its mock.
public struct SignInView: View {
    @Environment(\.colorScheme) private var colorScheme
    let working: Bool
    let problem: String?
    let signIn: () -> Void

    public init(working: Bool, problem: String?, signIn: @escaping () -> Void) {
        self.working = working
        self.problem = problem
        self.signIn = signIn
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            Spacer()
            Mark(side: 72)
            Text(AppWords.SignIn.title)
                .font(Faces.font(.ui, size: Tokens.TypeScale.display, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(AppWords.SignIn.lead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.lg))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            if let problem {
                BasisText(problem)
            }
            Spacer()
            Verb(working ? AppWords.SignIn.working : AppWords.SignIn.verb, action: signIn)
                .disabled(working)
        }
        .padding(Tokens.Space.s5)
        .background(theme.color(Tokens.Color.bg))
    }
}
