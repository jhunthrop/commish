import CommishAPI
import CommishCore
import Reference
import SwiftUI

/// A reference page pushed on the tab in view (ADP, compare, the clubs, a club, the schedule): owns its
/// view model for the route it shows.
struct ReferenceScreen: View {
    @State private var screen: Screen

    private enum Screen {
        case adp(RunScreenViewModel<AdpModel>)
        case compare(RunScreenViewModel<CompareModel>)
        case clubs(RunScreenViewModel<ClubsModel>)
        case club(RunScreenViewModel<ClubPageModel>)
        case schedule(RunScreenViewModel<ScheduleModel>)
    }

    init(
        route: ShellRoute, environment: AppEnvironment, league: FollowedLeague?,
        expired: @escaping @MainActor () -> Void
    ) {
        let (api, cache, clock) = (environment.api, environment.cache, environment.clock)
        let screen: Screen = switch route {
        case let .adp(format):
            .adp(.adp(format: format, run: api, pages: api, cache: cache, clock: clock, onSignedOut: expired))
        case let .compare(first, second):
            .compare(.compare(
                slugs: [first, second], league: league, run: api, pages: api, cache: cache, clock: clock,
                onSignedOut: expired
            ))
        case let .club(abbr):
            .club(.club(abbr, run: api, pages: api, cache: cache, clock: clock, onSignedOut: expired))
        case .schedule:
            .schedule(.schedule(run: api, pages: api, cache: cache, clock: clock, onSignedOut: expired))
        default:
            .clubs(.clubs(run: api, pages: api, cache: cache, clock: clock, onSignedOut: expired))
        }
        _screen = State(initialValue: screen)
    }

    var body: some View {
        switch screen {
        case let .adp(viewModel): AdpView(viewModel: viewModel)
        case let .compare(viewModel): CompareView(viewModel: viewModel)
        case let .clubs(viewModel): ClubsView(viewModel: viewModel)
        case let .club(viewModel): ClubView(viewModel: viewModel)
        case let .schedule(viewModel): ScheduleView(viewModel: viewModel)
        }
    }
}
