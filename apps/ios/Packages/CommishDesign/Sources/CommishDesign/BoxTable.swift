import SwiftUI

/// A column's width: fixed in points, or the one column that takes the row's room left.
public enum BoxWidth: Sendable, Equatable {
    case fixed(Double)
    case flex
}

/// A box score's column: its head (a word from the screen's word table), its width, and whether it
/// holds numbers, which sit trailing in the number face with tabular figures.
public struct BoxColumn: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let width: BoxWidth
    public let numeric: Bool

    public init(id: String, title: String, width: BoxWidth, numeric: Bool) {
        self.id = id
        self.title = title
        self.width = width
        self.numeric = numeric
    }

    public var alignment: HorizontalAlignment {
        numeric ? .trailing : .leading
    }

    public var fixedWidth: Double? {
        if case let .fixed(points) = width {
            return points
        }
        return nil
    }
}

/// How a cell reads: plain ink, muted, strong (the row's lead), the member's own, a gain or a loss.
public enum BoxTone: Sendable, Equatable {
    case plain
    case muted
    case strong
    case gain
    case loss
}

public struct BoxCell: Sendable, Equatable {
    public let text: String
    public let tone: BoxTone
    /// A line under the text in the small face: the streak under a team's name.
    public let sub: String?
    /// The initials of a face drawn before the text: someone on every row.
    public let face: String?

    public init(_ text: String, tone: BoxTone = .plain, sub: String? = nil, face: String? = nil) {
        self.text = text
        self.tone = tone
        self.sub = sub
        self.face = face
    }
}

public struct BoxRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let cells: [BoxCell]
    /// The member's own row: washed in the accent, as the web marks "you".
    public let mine: Bool
    /// A rule under the row (the playoff line under the last seed).
    public let ruleBelow: Bool

    public init(id: String, cells: [BoxCell], mine: Bool = false, ruleBelow: Bool = false) {
        self.id = id
        self.cells = cells
        self.mine = mine
        self.ruleBelow = ruleBelow
    }
}

/// The box score: a head row of column words, then one row per line, hairlines between, the
/// member's row washed. Numbers in the number face, words in the interface face.
public struct BoxTable: View {
    @Environment(\.colorScheme) private var colorScheme
    private let columns: [BoxColumn]
    private let rows: [BoxRow]

    public init(columns: [BoxColumn], rows: [BoxRow]) {
        self.columns = columns
        self.rows = rows
    }

    /// The face's side in a row.
    static let faceSide: Double = 26

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            line(columns.map { BoxCell($0.title, tone: .muted) }, head: true, mine: false, theme: theme)
                .padding(.vertical, Tokens.Space.s1)
            ForEach(rows) { row in
                Rectangle().fill(theme.color(Tokens.Color.line)).frame(height: 1)
                line(row.cells, head: false, mine: row.mine, theme: theme)
                    .padding(.vertical, Tokens.Space.s2)
                    .background(row.mine ? theme.color(Tokens.Color.accentWash) : .clear)
                if row.ruleBelow {
                    Rectangle().fill(theme.color(Tokens.Color.lineStrong)).frame(height: 2)
                }
            }
        }
    }

    private func line(_ cells: [BoxCell], head: Bool, mine: Bool, theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(Array(zip(columns, cells)), id: \.0.id) { column, cell in
                HStack(spacing: Tokens.Space.s2) {
                    if let face = cell.face {
                        Avatar(face, side: Self.faceSide, mine: mine)
                    }
                    VStack(alignment: column.alignment, spacing: 0) {
                        Text(cell.text)
                            .font(font(column: column, cell: cell, head: head))
                            .foregroundStyle(theme.color(ink(cell.tone)))
                            .lineLimit(1)
                            // A figure keeps its size in every row; a long name gives way.
                            .fixedSize(horizontal: column.numeric, vertical: false)
                        if let sub = cell.sub, !sub.isEmpty {
                            Text(sub)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                                .foregroundStyle(theme.color(Tokens.Color.ink3))
                        }
                    }
                }
                .frame(
                    minWidth: column.fixedWidth.map { CGFloat($0) },
                    maxWidth: column.fixedWidth.map { CGFloat($0) } ?? .infinity,
                    alignment: Alignment(horizontal: column.alignment, vertical: .center)
                )
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
    }

    private func font(column: BoxColumn, cell: BoxCell, head: Bool) -> Font {
        if head {
            return Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium)
        }
        if column.numeric {
            return Faces.font(.num, size: Tokens.TypeScale.lg, weight: cell.tone == .strong ? FaceWeight.bold : .medium)
        }
        return Faces.font(.ui, size: Tokens.TypeScale.md, weight: cell.tone == .strong ? FaceWeight.semibold : .regular)
    }

    private func ink(_ tone: BoxTone) -> ThemedColor {
        switch tone {
        case .plain, .strong: Tokens.Color.ink
        case .muted: Tokens.Color.ink3
        case .gain: Tokens.Color.gainInk
        case .loss: Tokens.Color.lossInk
        }
    }
}
