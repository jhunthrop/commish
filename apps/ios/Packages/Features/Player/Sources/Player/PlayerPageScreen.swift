import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The player page (web /players/[slug] at 390), drawn from its model in the web's order: his head, the
/// card (the next game and the six tiles, the sheet's card), before the season the facts, his season,
/// our read, his tier box or the held tier, the every-format table, the basis lines and the run's
/// stamp, with the league's one verb pinned above the bar.
public struct PlayerPageScreen: View {
    private let model: PlayerPageModel
    private let stamp: String?
    /// What the verb does in the app, nil where the app cannot follow it (the page then pins none).
    private let act: (CardVerb, String) -> (() -> Void)?

    public init(model: PlayerPageModel, stamp: String?, act: @escaping (CardVerb, String) -> (() -> Void)?) {
        self.model = model
        self.stamp = stamp
        self.act = act
    }

    public var body: some View {
        ScrollView {
            PageSectionsView(model: model, stamp: stamp)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let verb = model.verb, let action = act(verb, model.hero.name) {
                PinnedVerb(verb: verb, action: action)
            }
        }
    }
}

/// The page's sections, top to bottom.
public struct PageSectionsView: View {
    let model: PlayerPageModel
    let stamp: String?

    public init(model: PlayerPageModel, stamp: String?) {
        self.model = model
        self.stamp = stamp
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                PageHero(hero: model.hero, stamp: stamp)
                PlayerCardView(card: model.card, stamp: nil)
            }
            if let facts = model.facts {
                PageFacts(facts: facts)
            }
            SeasonBlock(season: model.season)
            if let read = model.read {
                PageRead(read: read)
            }
            if let held = model.heldTier {
                PanelTitle(held)
            } else if let tier = model.tier {
                TierBoxView(box: tier)
            }
            if let formats = model.formats {
                FormatsTableView(table: formats)
            }
            PageFoot(model: model)
        }
        .padding(Tokens.Space.s4)
    }
}

/// The page's head: his face, name, club, position pill and status.
public struct PageHero: View {
    @Environment(\.colorScheme) private var colorScheme
    let hero: PlayerPageModel.Hero
    let stamp: String?

    public init(hero: PlayerPageModel.Hero, stamp: String?) {
        self.hero = hero
        self.stamp = stamp
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            HStack(spacing: Tokens.Space.s3) {
                Headshot(hero.headshot, initials: hero.initials, side: 72)
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    Text(hero.name)
                        .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                        .textCase(.uppercase)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    HStack(spacing: Tokens.Space.s2) {
                        Text(hero.club)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                            .foregroundStyle(theme.color(Tokens.Color.ink2))
                        PositionPill(hero.pill)
                        if let status = hero.status {
                            Pill(status.mark, tone: status.sits ? .loss : .quiet)
                        }
                    }
                }
            }
        }
    }
}

/// A section's title in the number face (PanelHead.svelte), its aside under it.
struct PanelTitle: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let aside: String?

    init(_ title: String, aside: String? = nil) {
        self.title = title
        self.aside = aside
    }

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let aside {
                Text(aside)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Our read on his page: in season the week's read as the shelf prints it; before the season the
/// writer's capsule in the reading face, its stamp in the face's caption, its figures beside it, or the
/// words for a read not ready with what it will be built from.
public struct PageRead: View {
    @Environment(\.colorScheme) private var colorScheme
    let read: PlayerPageModel.Read

    public init(read: PlayerPageModel.Read) {
        self.read = read
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        switch read {
        case let .week(shown):
            WeekReadView(read: .shown(shown))
        case let .weekNone(words):
            WeekReadView(read: .none(words))
        case let .unwritten(words, lines):
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                SmallHead(Words.Card.ourRead).accessibilityAddTraits(.isHeader)
                Text(words)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(lines) { line in
                    UnwrittenRow(line: line)
                }
            }
        case let .prose(paragraphs, byline, figures):
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                SmallHead(Words.Card.ourRead).accessibilityAddTraits(.isHeader)
                if let byline {
                    Text(byline)
                        .font(Faces.font(.read, size: Tokens.TypeScale.sm).italic())
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                    Text(paragraph)
                        .font(Faces.font(.read, size: index == 0 ? ReadType.lead : ReadType.body))
                        .lineSpacing((index == 0 ? ReadType.lead : ReadType.body) * ReadType.leading)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .fixedSize(horizontal: false, vertical: true)
                    if index == 0, !figures.isEmpty {
                        ReadFiguresRow(figures: figures)
                    }
                }
            }
        }
    }
}

/// A fact the read will be built from (LineList.svelte): its lead and figure over its sentence.
struct UnwrittenRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: UnwrittenLine

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                SmallHead(line.lead)
                Spacer()
                Text(line.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
            }
            Text(line.text)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Tokens.Space.s2)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// The capsule's sizes (Capsule.svelte): its lead paragraph's, its body's (--t-read), and the room
/// between lines past the face's own.
enum ReadType {
    static let lead: Double = 22
    static let body: Double = 19
    static let leading: Double = 0.4
}

/// The figures set beside the capsule after its first paragraph, each naming its basis where it has one.
struct ReadFiguresRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let figures: [ReadFigure]

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .top, spacing: Tokens.Space.s4) {
            ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                VStack(alignment: .leading, spacing: 4) {
                    if let label = figure.label {
                        SmallHead(label)
                    }
                    Text(figure.figure)
                        .font(Faces.font(.read, size: Tokens.TypeScale.xxl, weight: .medium))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Text(figure.caption)
                        .font(Faces.font(.read, size: Tokens.TypeScale.sm).italic())
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, Tokens.Space.s3)
        .overlay(alignment: .top) { Hairline() }
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The page's foot: the basis lines once, then the run's stamp the page is from.
public struct PageFoot: View {
    let model: PlayerPageModel

    public init(model: PlayerPageModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            ForEach(model.basis, id: \.self, content: BasisText.init)
            BasisText(model.stamp)
        }
    }
}

/// The league's one verb pinned above the bar, the line under it where it has one.
public struct PinnedVerb: View {
    @Environment(\.colorScheme) private var colorScheme
    let verb: CardVerb
    let action: () -> Void

    public init(verb: CardVerb, action: @escaping () -> Void) {
        self.verb = verb
        self.action = action
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: Tokens.Space.s1) {
            Verb(verb.label, action: action)
            if let note = verb.note {
                Text(note)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s2)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .top) { Hairline() }
    }
}
