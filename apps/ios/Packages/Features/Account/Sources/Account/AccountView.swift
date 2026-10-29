import CommishCore
import CommishDesign
import SwiftUI

/// The Account with its view model: the saved account at once, then the API's; a pull reads again.
/// Quiet hours are set in a sheet with the system's time wheel. The caller owns the view model and
/// says what opening a league and a site link do.
public struct AccountView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var editing: QuietEnd?
    /// The confirmation sheet Delete account opened, while it is up.
    @State private var deletion: DeleteAccountViewModel?
    private let viewModel: AccountViewModel
    private let openLeague: (String) -> Void
    private let openLink: (URL) -> Void

    public init(
        viewModel: AccountViewModel,
        openLeague: @escaping (String) -> Void,
        openLink: @escaping (URL) -> Void
    ) {
        self.viewModel = viewModel
        self.openLeague = openLeague
        self.openLink = openLink
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    AccountScreen(model: model, state: screenState, actions: actions)
                }
                .refreshable { await viewModel.load() }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence)
                    QuietButton(AppWords.Failure.tryAgain) { Task { await viewModel.load() } }
                    QuietButton(Words.Account.signOut) { Task { await viewModel.signOut() } }
                }
                .padding(Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .navigationTitle(PhoneRail.account.label)
        .task { await viewModel.load() }
        .onDisappear { viewModel.leave() }
        .sheet(item: $editing) { end in
            QuietHoursSheet(end: end, push: viewModel.push) { from, to in
                viewModel.setQuiet(from: from, to: to)
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: deleting) {
            if let deletion {
                ScrollView { DeleteAccountSheet(viewModel: deletion) }
                    .background(theme.color(Tokens.Color.bg))
                    .interactiveDismissDisabled(deletion.busy)
            }
        }
    }

    /// Whether the delete sheet is up; a swipe down lets it go.
    private var deleting: Binding<Bool> {
        Binding(get: { deletion != nil }, set: { isUp in
            if !isUp {
                deletion = nil
            }
        })
    }

    private var screenState: AccountScreenState {
        AccountScreenState(
            stamp: viewModel.stampWords, push: viewModel.shownPush, permission: viewModel.permission,
            busy: viewModel.busy, problem: viewModel.problem
        )
    }

    private var actions: AccountActions {
        AccountActions(
            openLeague: openLeague,
            detach: { id in Task { await viewModel.detach(id) } },
            restore: { id in Task { await viewModel.restore(id) } },
            unpair: { id in Task { await viewModel.unpair(id) } },
            toggle: { kind, isOn in Task { await viewModel.set(kind, isOn: isOn) } },
            editQuiet: { editing = $0 },
            signOut: { Task { await viewModel.signOut() } },
            deleteAccount: { deletion = viewModel.deletion() },
            openLink: openLink
        )
    }
}

/// One end of quiet hours on the system's time wheel, written as it turns.
struct QuietHoursSheet: View {
    @Environment(\.colorScheme) private var colorScheme
    let end: QuietEnd
    let push: PushSettings
    let save: (Int, Int) -> Void

    private static let utc = TimeZone(identifier: "UTC")!

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            SectionHead(Words.Push.quiet, aside: end == .from ? Words.Push.from : Words.Push.to)
            DatePicker(Words.Push.quiet, selection: time, displayedComponents: .hourAndMinute)
                .wheelOnPhone()
                .labelsHidden()
                .environment(\.timeZone, Self.utc)
                .frame(maxWidth: .infinity)
        }
        .padding(Tokens.Space.s5)
        .background(theme.color(Tokens.Color.bg))
    }

    /// The end's minutes after midnight as an instant on a fixed day in UTC, so the wheel shows the
    /// time itself whatever the phone's zone.
    private var time: Binding<Date> {
        Binding(
            get: { Date(timeIntervalSince1970: TimeInterval((end == .from ? push.quietFrom : push.quietTo) * 60)) },
            set: { date in
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = Self.utc
                let parts = calendar.dateComponents([.hour, .minute], from: date)
                let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
                save(end == .from ? minutes : push.quietFrom, end == .to ? minutes : push.quietTo)
            }
        )
    }
}

private extension View {
    /// The time wheel on the phone; the package's Mac test build has no wheel and takes its default.
    @ViewBuilder
    func wheelOnPhone() -> some View {
        #if os(iOS)
            datePickerStyle(.wheel)
        #else
            self
        #endif
    }
}
