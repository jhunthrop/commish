import CommishCore
import CommishDesign
import SwiftUI

/// The leagues followed (league/AccountLeagues.svelte) as the web's table reads on a phone: each
/// league's name and team, its record and place, its last read, and Open and Detach; a league detached
/// a moment ago keeps its row with "Detached." and Undo. With none, the web's way to follow one. The
/// follow verb is the app's connect step, so the not-affiliated line sits under it (Lane 310).
struct AccountLeaguesView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: AccountModel
    let state: AccountScreenState
    let actions: AccountActions

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Attached.title, aside: model.leaguesAside)
            if let leagues = model.leagues {
                if leagues.isEmpty {
                    BasisText(Words.Attached.none)
                    QuietButton(Words.LeagueSwitch.followFirst) { actions.openLink(SiteLinks.leagueStart) }
                    BasisText(Words.NotAffiliated.line)
                } else {
                    VStack(spacing: 0) {
                        ForEach(leagues) { league in
                            LeagueRowView(row: league, busy: state.busy, actions: actions)
                        }
                    }
                    if let problem = state.problem, problem.section == .leagues {
                        ProblemText(text: problem.text)
                    }
                    if model.followMore {
                        QuietButton(Words.LeagueSwitch.followAnother) { actions.openLink(SiteLinks.leagueStart) }
                        BasisText(Words.NotAffiliated.line)
                    }
                }
            } else {
                BasisText(Words.Attached.unread)
            }
        }
    }
}

/// One league: name and team over the record and place, the last read beside its verbs.
struct LeagueRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: AccountLeagueRow
    let busy: String?
    let actions: AccountActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                        .foregroundStyle(theme.color(row.detached ? Tokens.Color.ink3 : Tokens.Color.ink))
                        .lineLimit(2)
                    Text(row.team)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(row.record)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    if !row.place.isEmpty {
                        Text(row.place)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                }
            }
            HStack(spacing: Tokens.Space.s3) {
                Text(row.readLine)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .frame(maxWidth: .infinity, alignment: .leading)
                verbs(theme)
            }
        }
        .padding(.top, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func verbs(_ theme: Theme) -> some View {
        if row.detached {
            Text(Words.Attached.detached)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            QuietButton(Words.Attached.undo) { actions.restore(row.id) }
                .disabled(busy != nil)
        } else {
            QuietButton(Words.Attached.open) { actions.openLeague(row.id) }
            QuietButton(busy == row.id ? Words.Attached.detaching : Words.Attached.detach) { actions.detach(row.id) }
                .disabled(busy != nil)
        }
    }
}
