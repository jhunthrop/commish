import CommishCore
import CommishDesign
import SwiftUI

/// What the Account screen's rows do, handed in by the view that owns the view model (or nothing, for
/// a snapshot).
public struct AccountActions {
    public let openLeague: (String) -> Void
    public let detach: (String) -> Void
    public let restore: (String) -> Void
    public let unpair: (String) -> Void
    public let toggle: (PushKind, Bool) -> Void
    public let editQuiet: (QuietEnd) -> Void
    public let signOut: () -> Void
    /// Opens the confirmation sheet that deletes the account.
    public let deleteAccount: () -> Void
    public let openLink: (URL) -> Void

    public init(
        openLeague: @escaping (String) -> Void, detach: @escaping (String) -> Void,
        restore: @escaping (String) -> Void, unpair: @escaping (String) -> Void,
        toggle: @escaping (PushKind, Bool) -> Void, editQuiet: @escaping (QuietEnd) -> Void,
        signOut: @escaping () -> Void, deleteAccount: @escaping () -> Void, openLink: @escaping (URL) -> Void
    ) {
        self.openLeague = openLeague
        self.detach = detach
        self.restore = restore
        self.unpair = unpair
        self.toggle = toggle
        self.editQuiet = editQuiet
        self.signOut = signOut
        self.deleteAccount = deleteAccount
        self.openLink = openLink
    }

    /// Rows that do nothing: a snapshot's.
    public static var none: AccountActions {
        AccountActions(
            openLeague: { _ in }, detach: { _ in }, restore: { _ in }, unpair: { _ in }, toggle: { _, _ in },
            editQuiet: { _ in }, signOut: {}, deleteAccount: {}, openLink: { _ in }
        )
    }
}

/// Which end of quiet hours is being set.
public enum QuietEnd: String, Identifiable, Sendable {
    case from
    case to

    public var id: String {
        rawValue
    }
}

/// What the screen shows beside its model: the stamp over a saved read, the switches as drawn and
/// whether the phone may show a push, the row under way, and an action's failure.
public struct AccountScreenState {
    public let stamp: String?
    public let push: PushSettings
    public let permission: PushPermission
    public let busy: String?
    public let problem: AccountProblem?

    public init(
        stamp: String?, push: PushSettings, permission: PushPermission, busy: String?, problem: AccountProblem?
    ) {
        self.stamp = stamp
        self.push = push
        self.permission = permission
        self.busy = busy
        self.problem = problem
    }
}

/// The screen's runs, top to bottom, each a snapshot of its own: who with sign out, the leagues
/// followed and the plan; the push switches; the paired devices and the page's foot.
public enum AccountPart: String, CaseIterable, Sendable {
    case top
    case switches
    case devices
}

/// The Account as its model says it, in the web's order on a phone (AccountPage.svelte): who and sign
/// out, the leagues followed, the plan, then the switches the app adds, the paired devices and the foot.
/// Pure of state, so a snapshot draws it from the fixture.
public struct AccountScreen: View {
    let model: AccountModel
    let state: AccountScreenState
    let actions: AccountActions
    let parts: [AccountPart]

    public init(
        model: AccountModel, state: AccountScreenState, actions: AccountActions,
        parts: [AccountPart] = AccountPart.allCases
    ) {
        self.model = model
        self.state = state
        self.actions = actions
        self.parts = parts
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s6) {
            ForEach(parts, id: \.self) { part in
                switch part {
                case .top:
                    WhoView(model: model, stamp: state.stamp, busy: state.busy != nil, signOut: actions.signOut)
                    AccountLeaguesView(model: model, state: state, actions: actions)
                    if let plan = model.plan {
                        PlanView(plan: plan, openLink: actions.openLink)
                    }
                case .switches:
                    PushSwitchesView(
                        push: state.push, permission: state.permission,
                        problem: state.problem.flatMap { $0.section == .notifications ? $0.text : nil },
                        toggle: actions.toggle, editQuiet: actions.editQuiet
                    )
                case .devices:
                    AccountDevicesView(model: model, state: state, unpair: actions.unpair)
                    AccountFootView(deleteAccount: actions.deleteAccount, openLink: actions.openLink)
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s5)
    }
}

/// The account's name, the line under it, and sign out beside them (AccountPage.svelte .who).
struct WhoView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: AccountModel
    let stamp: String?
    let busy: Bool
    let signOut: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .bottom, spacing: Tokens.Space.s4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.name)
                    .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                Text(model.line)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
                if let stamp {
                    Text(stamp)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.accentText))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            QuietButton(Words.Account.signOut, action: signOut)
                .disabled(busy)
        }
    }
}

/// The plan in the free season (AccountPage.svelte's Plan section): its title, its line, and the way to
/// what is free.
struct PlanView: View {
    @Environment(\.colorScheme) private var colorScheme
    let plan: PlanCard
    let openLink: (URL) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Account.plan)
            KeyRow {
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan.title)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Text(plan.line)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .fixedSize(horizontal: false, vertical: true)
                }
            } trailing: {
                QuietButton(plan.see) { openLink(SiteLinks.pass) }
            }
        }
    }
}

/// A row of the web's key-value panels (.kvr): what it is on the left, its control on the right, a
/// hairline under it.
struct KeyRow<Leading: View, Trailing: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let leading: Leading
    let trailing: Trailing

    init(@ViewBuilder _ leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: Tokens.Space.s3) {
                leading.frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
            .padding(.vertical, Tokens.Space.s2)
            Hairline()
        }
    }
}

/// An action's failure, said under its list (web ProblemLine.svelte).
struct ProblemText: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.lossInk))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The page's foot (AccountFoot.svelte): the quiet Delete account verb, which opens the confirmation
/// sheet, then the two legal pages in the basis's quiet type, each link the site's.
struct AccountFootView: View {
    @Environment(\.colorScheme) private var colorScheme
    let deleteAccount: () -> Void
    let openLink: (URL) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            QuietButton(Words.AccountDeleteFoot.verb, action: deleteAccount)
            Text(foot(theme))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .fixedSize(horizontal: false, vertical: true)
                .environment(\.openURL, OpenURLAction { url in
                    openLink(url)
                    return .handled
                })
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.AccountFoot.label)
    }

    private func foot(_ theme: Theme) -> AttributedString {
        let link = { (text: String, url: URL) -> AttributedString in
            var part = AttributedString(text)
            part.link = url
            part.foregroundColor = theme.color(Tokens.Color.accentText)
            return part
        }
        let words = Words.AccountFoot.self
        return AttributedString(Words.AccountDeleteFoot.keep) + link(words.privacy, SiteLinks.privacy)
            + AttributedString(words.joint) + link(words.terms, SiteLinks.terms) + AttributedString(words.end)
    }
}
