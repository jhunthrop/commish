import CommishCore
import CommishDesign
import Companion
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// The system clipboard, where there is one (the app; a Mac test has none to write).
enum UIPasteboardBridge {
    static func copy(_ text: String) {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
        #endif
    }
}

/// The report's verbs (the report page's): the solid one that runs the draft again, then the quiet
/// ones. A shared draft's report has its own lead and no link of its own to copy; a lobby's has its
/// own lead and quiet verb, and no link.
public struct MockReportVerbs {
    let lead: String
    let run: () -> Void
    let another: (() -> Void)?
    /// The quiet verb's words: Try another slot in a mock, the same draft against bots in a lobby.
    let anotherLabel: String
    let copied: Bool
    let copy: (() -> Void)?

    public init(
        lead: String, run: @escaping () -> Void, another: (() -> Void)?,
        anotherLabel: String = Words.Mock.tryAnother, copied: Bool, copy: (() -> Void)?
    ) {
        self.lead = lead
        self.run = run
        self.another = another
        self.anotherLabel = anotherLabel
        self.copied = copied
        self.copy = copy
    }

    public static func none(_ lead: String) -> MockReportVerbs {
        MockReportVerbs(lead: lead, run: {}, another: {}, copied: false, copy: {})
    }
}

/// A part of the report, so a snapshot can frame the one it is of.
public enum MockReportPart: CaseIterable, Sendable {
    case head
    case picks
    case runs
}

/// The report as a box score (Report.svelte at 390): the one big number and its caption, the title,
/// the finish and the draft as cells, the verbs, the basis once, the field; then pick by pick and the
/// same draft run again, drawn as the companion's report draws them.
public struct MockReportScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let report: DraftReportModel
    let verbs: MockReportVerbs
    var parts = Set(MockReportPart.allCases)

    public init(
        report: DraftReportModel,
        verbs: MockReportVerbs,
        parts: Set<MockReportPart> = Set(MockReportPart.allCases)
    ) {
        self.report = report
        self.verbs = verbs
        self.parts = parts
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if parts.contains(.head) {
                head
            }
            let rest =
                Set<ReportPart>((parts.contains(.picks) ? [.picks] : []) + (parts.contains(.runs) ? [.runs] : []))
            if !rest.isEmpty {
                DraftReportScreen(report: report, actions: .none, parts: rest)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    private var head: some View {
        let theme = Theme(colorScheme)
        return VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                if let points = report.points {
                    Text(points)
                        .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Note(text: report.caption)
                }
                Text(report.title)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                ReportCells(cells: report.cells)
                Verb(verbs.lead, action: verbs.run)
                HStack(spacing: Tokens.Space.s3) {
                    if let another = verbs.another {
                        QuietButton(verbs.anotherLabel, action: another)
                    }
                    if let copy = verbs.copy {
                        QuietButton(verbs.copied ? Words.Mock.copied : Words.Mock.copyLink, action: copy)
                    }
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            BasisText(report.basis).padding(.horizontal, Tokens.Space.s3)
            ReportField(note: report.fieldNote, field: report.field)
        }
    }
}

/// The finish and the draft as cells (FactStrip.svelte): value over label, the seat's own in the accent.
struct ReportCells: View {
    @Environment(\.colorScheme) private var colorScheme
    let cells: [ReportCell]

    var body: some View {
        let theme = Theme(colorScheme)
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3),
            alignment: .leading, spacing: Tokens.Space.s2
        ) {
            ForEach(cells) { cell in
                VStack(alignment: .leading, spacing: 1) {
                    Text(cell.value)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(theme.color(cell.mine ? Tokens.Color.accentText : Tokens.Color.ink))
                    Head(text: cell.label, alignment: .leading)
                }
            }
        }
    }
}

/// The field (FieldBars.svelte): each team's place, name, bar and points, yours in the accent.
struct ReportField: View {
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
                        .frame(width: 96, alignment: .leading)
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
