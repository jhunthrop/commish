import CommishCore
import CommishDesign
import SwiftUI

/// The sheet's body once his week is read (the web's PlayerShelf.svelte at 390): his status, his
/// week's game in the box's Game cell form, the six figures as cells three across, our read (the
/// writer's words in the sans face at the rows' size with its byline a caption, or the words that say
/// why none stands), and the basis once under it all.
public struct PlayerCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let card: PlayerCard
    private let stamp: String?

    public init(card: PlayerCard, stamp: String?) {
        self.card = card
        self.stamp = stamp
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if let status = card.status {
                Pill(status.mark, tone: status.sits ? .loss : .quiet)
            }
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            GameLine(head: card.head, cell: card.cell)
            TileGrid(tiles: card.tiles)
            if let read = card.read {
                WeekReadView(read: read)
            }
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                ForEach(card.basis, id: \.self, content: BasisText.init)
            }
        }
    }
}

/// His week's game under his name (CardNext.svelte folded): the week, the opponent and the kickoff or
/// the state's word, then the expected score and the weather while it is still to be played.
struct GameLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: CardHead
    let cell: NextCell?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 3) {
            Text(head.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(cell?.place ?? head.opponent)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                if let when = cell?.when {
                    Text(when)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
            let facts = [cell?.expected, cell?.weather?.words].compactMap(\.self)
            if !facts.isEmpty {
                Text(facts.joined(separator: "   "))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, Tokens.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// The figures as cells, three across in a box (CardTiles.svelte folded): each its label over its
/// figure, the week's figure in the accent and the opponent's ease in its tint, the change quiet.
struct TileGrid: View {
    @Environment(\.colorScheme) private var colorScheme
    let tiles: [CardTile]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 3)

    var body: some View {
        let theme = Theme(colorScheme)
        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(tiles) { tile in
                VStack(alignment: .leading, spacing: 4) {
                    Text(tile.label)
                        .font(Faces.font(.ui, size: 10, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.6)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                    Text(tile.value)
                        .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                        .foregroundStyle(theme.color(Self.ink(tile.tone)))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.s3)
                .padding(.vertical, Tokens.Space.s2)
                .overlay(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        Hairline()
                        Rectangle().fill(theme.color(Tokens.Color.line)).frame(width: 1)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).stroke(theme.color(Tokens.Color.line), lineWidth: 1))
    }

    static func ink(_ tone: CardTile.Tone?) -> ThemedColor {
        switch tone {
        case .lead: Tokens.Color.accentText
        case .easy: Tokens.Color.gainInk
        case .hard: Tokens.Color.lossInk
        case .quiet: Tokens.Color.ink2
        case .even, nil: Tokens.Color.ink
        }
    }
}

/// Our read in season (Capsule.svelte with `week`): the box-score paragraph in the sans face with its
/// byline as a caption above it, or the words that say why no read stands (founder ruling 2026-10-21:
/// sans in season, caption byline).
struct WeekReadView: View {
    @Environment(\.colorScheme) private var colorScheme
    let read: SheetRead

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(Words.Card.ourRead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .accessibilityAddTraits(.isHeader)
            switch read {
            case let .shown(.written(body, caption)):
                Text(caption)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Text(body)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .lineSpacing(Tokens.TypeScale.md * 0.25)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
            case let .shown(.withheld(words)), let .none(words):
                Text(words)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
