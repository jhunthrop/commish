import CommishCore
import CommishDesign
import SwiftUI

/// His season (the page's "This season" over GameLog.svelte at 390): the head with its aside, the game
/// log (the week and opponent pinned, then Pts and the position's columns, the frame scrolling sideways
/// for the rest), the season line, his earlier seasons folded under it, and the weeks still to play
/// with their days; the one sentence in the log's place with no line.
struct SeasonBlock: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var earlier = false
    let season: SeasonView

    /// The week and opponent's column; the figures share the rest of the width.
    static let pinned: Double = 76

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            PanelTitle(Words.PlayerPage.thisSeason, aside: season.aside)
            if let line = season.line {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        LogLine(
                            lead: Words.Figure.week,
                            sub: Words.Box.opp,
                            values: [season.pointsHead.short] + season.heads.map(\.short),
                            head: true
                        )
                        ForEach(season.rows) { row in
                            LogLine(
                                lead: String(row.week),
                                sub: row.note.isEmpty ? row.opponent : "\(row.opponent) \(row.note)",
                                values: [row.points ?? ""] + (row.cells ?? []), head: false, quiet: row.tone != .played
                            )
                        }
                        LogLine(
                            lead: line.lead,
                            sub: line.sub,
                            values: [line.total] + line.cells.map(\.value),
                            head: false,
                            total: true
                        )
                        if !season.prior.isEmpty {
                            Button { earlier.toggle() } label: {
                                Label(
                                    Words.Card.earlierSeasons,
                                    systemImage: earlier ? "chevron.down" : "chevron.right"
                                )
                                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                                .foregroundStyle(theme.color(Tokens.Color.ink2))
                                .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(earlier ? .isSelected : [])
                            if earlier {
                                ForEach(season.prior) { prior in
                                    LogLine(
                                        lead: String(prior.season),
                                        sub: prior.sub,
                                        values: [prior.total] + prior.cells,
                                        head: false
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                Text(season.none)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            if !season.ahead.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    SmallHead(Words.PlayerPage.stillToPlay).accessibilityAddTraits(.isHeader)
                    ForEach(season.ahead) { week in
                        HStack(spacing: Tokens.Space.s2) {
                            Text(String(week.week))
                                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                                .frame(width: 28, alignment: .leading)
                            Text(week.opponent)
                                .font(Faces.font(
                                    .ui,
                                    size: Tokens.TypeScale.sm,
                                    weight: week.bye ? .regular : .semibold
                                ))
                            Spacer()
                            Text(week.day)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        }
                        .foregroundStyle(theme.color(week.bye ? Tokens.Color.ink3 : Tokens.Color.ink))
                        .frame(minHeight: 32)
                        .overlay(alignment: .bottom) { Hairline() }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if let basis = season.basis {
                BasisText(basis)
            }
        }
    }
}

/// One line of the game log: the pinned lead and its sub, then each figure in its column.
struct LogLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let lead: String
    let sub: String
    let values: [String]
    let head: Bool
    var quiet = false
    var total = false

    var body: some View {
        let theme = Theme(colorScheme)
        let ink = theme.color(head || quiet ? Tokens.Color.ink3 : Tokens.Color.ink)
        HStack(spacing: 0) {
            // A total's sub goes under its lead; a week's opponent beside its week.
            let layout = total ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
                : AnyLayout(HStackLayout(spacing: Tokens.Space.s1))
            layout {
                Text(lead)
                    .font(Faces.font(
                        head ? .ui : .num,
                        size: head ? Tokens.TypeScale.xs : Tokens.TypeScale.md,
                        weight: .bold
                    ))
                Text(sub)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: total ? .semibold : .regular))
                    .lineLimit(total ? 2 : 1)
                    .minimumScaleFactor(0.8)
            }
            .frame(width: SeasonBlock.pinned, alignment: .leading)
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                Text(value)
                    .font(head ? Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold)
                        : Faces.font(.num, size: Tokens.TypeScale.md, weight: index == 0 ? .bold : .medium))
                    .lineLimit(head ? 3 : 1)
                    .minimumScaleFactor(0.7)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .textCase(head ? .uppercase : nil)
        .foregroundStyle(ink)
        .frame(minHeight: head ? 28 : 34)
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// The tier box (TierMates.svelte): the band with his tier and the line under it, his tier's players
/// with their figures (his own marked), and the basis at its foot.
struct TierBoxView: View {
    @Environment(\.colorScheme) private var colorScheme
    let box: TierBox

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(box.title)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                if let drop = box.drop {
                    Text(drop)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
            .padding(Tokens.Space.s3)
            ForEach(box.mates) { mate in
                HStack(spacing: Tokens.Space.s2) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mate.name)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: mate.current ? .bold : .medium))
                        Text([mate.team, mate.span].compactMap(\.self).joined(separator: ", "))
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                    Spacer()
                    Text(mate.projected)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                }
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 40)
                .background(mate.current ? theme.color(Tokens.Color.accentWash) : .clear)
                .overlay(alignment: .top) { Hairline() }
                .accessibilityElement(children: .combine)
            }
            BasisText(box.basis).padding(Tokens.Space.s3)
        }
        .background(theme.color(Tokens.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).stroke(theme.color(Tokens.Color.line), lineWidth: 1))
    }
}

/// The every-format table (Table.svelte): each format with his position rank, his points, his value
/// over a pickup's and his tier, why the formats need not line up, and at the read's clock the formats
/// that show no position rank.
struct FormatsTableView: View {
    @Environment(\.colorScheme) private var colorScheme
    let table: FormatsTable

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            LogLine(
                lead: Words.PlayerPage.format, sub: "",
                values: [table.rankHead, table.head, Words.PlayerPage.overReplacement, Words.PlayerPage.tier],
                head: true
            )
            ForEach(table.rows) { row in
                LogLine(lead: "", sub: row.label, values: [row.rank, row.points, row.vor, row.tier], head: false)
            }
            if let note = table.note {
                BasisText(note).padding(.top, Tokens.Space.s2)
            }
            if let footnote = table.footnote {
                BasisText(footnote).padding(.top, Tokens.Space.s2)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
    }
}
