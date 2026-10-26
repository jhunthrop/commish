import CommishCore
import CommishDesign
import SwiftUI

/// The League home's draft word (SeasonPanel.svelte, pre_draft and draft_day): on the accent's edge, when
/// the draft is, that the site turns to the season after it, and the one verb: the Advisor on draft day,
/// a mock draft before it.
struct DraftDayPanel: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: DraftDayEntry
    let openAdvisor: () -> Void
    var openMock: () -> Void = {}

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                Text(entry.lead)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                Text(entry.line)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Verb(entry.verb, action: entry.opens == .advisor ? openAdvisor : openMock)
        }
        .padding(Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(
            theme.color(Tokens.Color.accent),
            lineWidth: 2
        ))
        .padding(.horizontal, Tokens.Space.s4)
    }
}
