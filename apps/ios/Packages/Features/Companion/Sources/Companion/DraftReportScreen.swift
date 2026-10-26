import CommishCore
import CommishDesign
import SwiftUI

/// A part of the report, so a snapshot can frame the one it is of.
public enum ReportPart: CaseIterable, Sendable {
    case head
    case picks
    case runs
}

/// The report on the finished draft as a box score (Report.svelte at 390): the one big number and its
/// caption, the title, the finish and the draft as cells, the verb, the basis once, the field, pick by
/// pick, the same draft run again and who the runs land.
public struct DraftReportScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let report: DraftReportModel
    let actions: CompanionActions
    var parts = Set(ReportPart.allCases)

    public init(
        report: DraftReportModel,
        actions: CompanionActions,
        parts: Set<ReportPart> = Set(ReportPart.allCases)
    ) {
        self.report = report
        self.actions = actions
        self.parts = parts
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if parts.contains(.head) {
                head(theme)
            }
            if parts.contains(.picks) {
                PickByPickView(note: report.picksNote, picks: report.picks, open: actions.open)
            }
            if parts.contains(.runs) {
                RunsView(runs: report.runs)
                ExposureView(
                    title: report.exposureTitle,
                    aside: report.exposureAside,
                    lines: report.exposure,
                    open: actions.open
                )
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    /// The one big number, the title, the cells and the verb, the basis, the field.
    @ViewBuilder
    private func head(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            if let points = report.points {
                Text(points)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xxxl, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                NoteText(text: report.caption)
            }
            Text(report.title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            CellGrid(cells: report.cells)
            Verb(Words.Companion.followAnother, action: actions.followAnother)
        }
        .padding(.horizontal, Tokens.Space.s3)
        BasisText(report.basis).padding(.horizontal, Tokens.Space.s3)
        FieldView(note: report.fieldNote, field: report.field)
    }
}

/// The finish and the draft as cells (FactStrip.svelte): label over value, the seat's own in the accent.
struct CellGrid: View {
    @Environment(\.colorScheme) private var colorScheme
    let cells: [ReportCell]

    var body: some View {
        let theme = Theme(colorScheme)
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3),
            alignment: .leading,
            spacing: Tokens.Space.s2
        ) {
            ForEach(cells) { cell in
                VStack(alignment: .leading, spacing: 1) {
                    Text(cell.value)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(theme.color(cell.mine ? Tokens.Color.accentText : Tokens.Color.ink))
                    HeadText(text: cell.label, alignment: .leading)
                }
            }
        }
    }
}

/// The field (FieldBars.svelte): each team's place, name, bar and points, yours in the accent.
struct FieldView: View {
    @Environment(\.colorScheme) private var colorScheme
    let note: String
    let field: [FieldLine]

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            SectionHead(Words.Report.field, aside: note)
            ForEach(field) { team in
                HStack(spacing: Tokens.Space.s2) {
                    Text(String(team.rank))
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                        .frame(width: 20, alignment: .trailing)
                    Text(team.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: team.you ? .bold : .regular))
                        .lineLimit(1)
                        .frame(width: 128, alignment: .leading)
                    GeometryReader { box in
                        Capsule()
                            .fill(theme.color(team.you ? Tokens.Color.accent : Tokens.Color.lineStrong))
                            .frame(width: box.size.width * team.share, height: 8)
                            .frame(maxHeight: .infinity)
                    }
                    Text(team.points)
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .semibold))
                        .monospacedDigit()
                        .frame(width: 48, alignment: .trailing)
                }
                .foregroundStyle(theme.color(team.you ? Tokens.Color.accentText : Tokens.Color.ink))
                .frame(height: 24)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// Pick by pick at 390 (PickReview.svelte, the phone's columns): the pick, the player with who made
/// it, Over repl, Picks later against ADP and against our board in their tones, Still there.
struct PickByPickView: View {
    @Environment(\.colorScheme) private var colorScheme
    let note: String
    let picks: [ReportPickLine]
    let open: (SheetPlayer) -> Void

    static let pick: Double = 36
    static let figure: Double = 50
    static let later: Double = 50

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(Words.Report.pickByPick, aside: note).padding(.bottom, Tokens.Space.s2)
            HStack(spacing: 4) {
                HeadText(text: Words.Report.pick, alignment: .leading).frame(width: Self.pick, alignment: .leading)
                HeadText(text: Words.Report.player, alignment: .leading)
                HeadText(text: Words.Report.overRepl).frame(width: Self.figure, alignment: .trailing)
                HeadText(text: "\(Words.Report.adp) \(Words.Report.picksLater)", lines: 3).frame(
                    width: Self.later,
                    alignment: .trailing
                )
                HeadText(text: "\(Words.Report.ours) \(Words.Report.picksLater)", lines: 3).frame(
                    width: Self.later,
                    alignment: .trailing
                )
                HeadText(text: Words.Report.stillThere).frame(width: Self.later, alignment: .trailing)
            }
            .frame(minHeight: 34)
            .accessibilityHidden(true)
            ForEach(picks) { line in
                HStack(spacing: 4) {
                    Text(line.pick)
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .semibold))
                        .monospacedDigit()
                        .frame(width: Self.pick, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(line.name)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                            .lineLimit(2)
                        HStack(spacing: 4) {
                            if let player = line.player {
                                PositionPill(player.pill).fixedSize()
                                Text(player.team)
                                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                                    .fixedSize()
                                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                            }
                            Text(line.madeBy)
                                .lineLimit(1)
                                .font(Faces.font(
                                    .ui,
                                    size: Tokens.TypeScale.xs,
                                    weight: line.mine ? .semibold : .regular
                                ))
                                .foregroundStyle(theme.color(line.mine ? Tokens.Color.ink : Tokens.Color.ink3))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    FigureText(
                        text: line.figure,
                        width: Self.figure,
                        ink: line.figureMuted ? Tokens.Color.ink3 : Tokens.Color.ink,
                        size: line.figureMuted ? Tokens.TypeScale.xs : Tokens.TypeScale.md
                    )
                    FigureText(
                        text: line.adp?.text ?? "",
                        width: Self.later,
                        ink: Self.ink(line.adp?.tone),
                        size: Tokens.TypeScale.md
                    )
                    FigureText(
                        text: line.ours?.text ?? "",
                        width: Self.later,
                        ink: Self.ink(line.ours?.tone),
                        size: Tokens.TypeScale.md
                    )
                    FigureText(
                        text: line.still, width: Self.later,
                        ink: line.stillWait ? Tokens.Color.accentText : line.stillMuted ? Tokens.Color.ink3 : Tokens
                            .Color.ink,
                        size: line.stillMuted ? Tokens.TypeScale.xs : Tokens.TypeScale.md
                    )
                }
                .padding(.vertical, 6)
                .overlay(alignment: .top) { Hairline() }
                .contentShape(Rectangle())
                .onTapGesture {
                    if let player = line.player {
                        open(player.sheetPlayer)
                    }
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }

    /// The Picks later tone: plus is later than his place, green; minus rose.
    static func ink(_ tone: GapTone?) -> ThemedColor {
        switch tone {
        case .gain?: Tokens.Color.gainInk
        case .loss?: Tokens.Color.lossInk
        case .even?, nil: Tokens.Color.ink2
        }
    }
}

/// The same draft run again (RunsSection.svelte): the histogram with its median bar, the low, median
/// and high under it, the three figures, and how often each place came up, the draft's own ringed.
struct RunsView: View {
    @Environment(\.colorScheme) private var colorScheme
    let runs: ReportRunsModel

    var body: some View {
        let theme = Theme(colorScheme)
        let peak = max(runs.bins.max() ?? 1, 1)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(runs.title, aside: runs.note)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(runs.bins.enumerated()), id: \.offset) { index, count in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.color(index == runs.medianBin ? Tokens.Color.accent : Tokens.Color.lineStrong))
                        .frame(height: max(2, 64 * Double(count) / Double(peak)))
                }
            }
            .frame(height: 64, alignment: .bottom)
            .accessibilityHidden(true)
            HStack {
                HeadText(text: runs.low, alignment: .leading)
                Spacer()
                HeadText(text: "\(Words.Report.median) \(runs.median)")
                Spacer()
                HeadText(text: runs.high)
            }
            HStack(alignment: .top, spacing: Tokens.Space.s3) {
                stat(runs.median, Words.Report.medianPoints, theme)
                stat(runs.middle, Words.Report.middleRuns, theme)
                stat(runs.topShare, runs.topWords, theme)
            }
            HStack(spacing: 2) {
                ForEach(Array(runs.ranks.enumerated()), id: \.offset) { index, count in
                    VStack(spacing: 0) {
                        Text(String(count))
                            .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                        Text(Formatting.ordinal(index + 1))
                            .font(Faces.font(.ui, size: 9))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .background(
                        RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                            .strokeBorder(
                                index + 1 == runs.rank ? theme.color(Tokens.Color.accent) : .clear,
                                lineWidth: 2
                            )
                    )
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }

    private func stat(_ value: String, _ words: String, _ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Who the runs land (Exposure.svelte): each player with his share of the runs.
struct ExposureView: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let aside: String
    let lines: [ExposureLine]
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Panel {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(title, aside: aside).padding(.bottom, Tokens.Space.s2)
                ForEach(lines) { line in
                    HStack(spacing: 6) {
                        PlayerFace(player: line.player)
                        WhoCell(player: line.player)
                        GeometryReader { box in
                            Capsule().fill(theme.color(Tokens.Color.accent))
                                .frame(width: box.size.width * line.share, height: 6)
                                .frame(maxHeight: .infinity)
                        }
                        .frame(width: 60)
                        FigureText(text: line.percent, width: 44, size: Tokens.TypeScale.md)
                    }
                    .padding(.vertical, 4)
                    .overlay(alignment: .top) { Hairline() }
                    .contentShape(Rectangle())
                    .onTapGesture { open(line.player.sheetPlayer) }
                }
            }
        }
    }
}
