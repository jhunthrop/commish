import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The player page (web /players/[slug] at 390), drawn from its model: the hero, the one big number
/// with its basis, the facts, our read and the foot, with the league's one verb pinned above the bar.
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
            VStack(alignment: .leading, spacing: Tokens.Space.s5) {
                PageTop(model: model, stamp: stamp)
                PageFacts(model: model)
                if let read = model.read {
                    PageRead(read: read)
                }
                PageFoot(model: model)
            }
            .padding(Tokens.Space.s4)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let verb = model.verb, let action = act(verb, model.hero.name) {
                PinnedVerb(verb: verb, action: action)
            }
        }
    }
}

/// The page's top: his face, name, club, position pill and status, then the one big number, its unit
/// and its basis.
public struct PageTop: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: PlayerPageModel
    let stamp: String?

    public init(model: PlayerPageModel, stamp: String?) {
        self.model = model
        self.stamp = stamp
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        let hero = model.hero
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
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
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                    Text(model.figure)
                        .font(Faces.font(.num, size: Tokens.TypeScale.xxxl, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Text(model.unit)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
                Text(model.caption)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// The facts beside the number (Fact.svelte): where drafters take him, his value over a pickup's with
/// its round's tint, and his floor, median and ceiling; a listed player's held tier under them.
public struct PageFacts: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: PlayerPageModel

    public init(model: PlayerPageModel) {
        self.model = model
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            FactRow(fact: model.drafters, tint: nil)
            FactRow(fact: model.overReplacement, tint: Self.tint(model.heat))
            if let outcomes = model.outcomes {
                OutcomesRow(outcomes: outcomes)
            }
            if let held = model.heldTier {
                Text(held)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .padding(.vertical, Tokens.Space.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Hairline() }
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
    }

    static func tint(_ heat: Heat) -> ThemedColor? {
        switch heat {
        case .round(1): Tokens.Color.heat1
        case .round(2): Tokens.Color.heat2
        case .round(3): Tokens.Color.heat3
        case .round: Tokens.Color.heat4
        case .below: Tokens.Color.heatNeg
        case .none: nil
        }
    }
}

/// One fact: its label, its figure (tinted where the board tints it) and the sentence under it.
struct FactRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let fact: PlayerPageModel.Fact
    let tint: ThemedColor?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(fact.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s1) {
                Text(fact.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .padding(.horizontal, tint == nil ? 0 : Tokens.Space.s1)
                    .background(tint.map { RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color($0)) })
                if let unit = fact.unit {
                    Text(unit)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
            Text(fact.words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// Floor, median and ceiling as the web's outcome bar: the range from his low case to his high case
/// with the median marked, each figure under its place.
struct OutcomesRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let outcomes: PlayerPageModel.Outcomes

    var body: some View {
        let theme = Theme(colorScheme)
        let span = max(outcomes.ceiling - outcomes.floor, 1)
        let median = (outcomes.median - outcomes.floor) / span
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(outcomes.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            GeometryReader { space in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.color(Tokens.Color.surface2)).frame(height: 8)
                    Capsule().fill(theme.color(Tokens.Color.ink2)).frame(width: 3, height: 16)
                        .offset(x: max(0, min(space.size.width - 3, space.size.width * median - 1.5)))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 16)
            HStack {
                Text(Formatting.fixed(outcomes.floor))
                Spacer()
                Text(Formatting.fixed(outcomes.median))
                Spacer()
                Text(Formatting.fixed(outcomes.ceiling))
            }
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
            .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(outcomes.caption)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Tokens.Space.s3)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// Our read on his page: in season the week's read as the shelf prints it; before the season the
/// writer's capsule in the reading face, its stamp in the face's caption, its figures beside it.
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
        case let .unwritten(words):
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                ReadHead()
                Text(words)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
        case let .prose(paragraphs, byline, figures):
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                ReadHead()
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

/// The capsule's sizes (Capsule.svelte): its lead paragraph's, its body's (--t-read), and the room
/// between lines past the face's own.
enum ReadType {
    static let lead: Double = 22
    static let body: Double = 19
    static let leading: Double = 0.4
}

/// The read's head: "Our read".
struct ReadHead: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Text(Words.Card.ourRead)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .accessibilityAddTraits(.isHeader)
    }
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
                        Text(label)
                            .font(Faces.font(.ui, size: 10, weight: .bold))
                            .textCase(.uppercase)
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
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

/// The page's foot: a held page's words, and the run's stamp the page is from.
public struct PageFoot: View {
    let model: PlayerPageModel

    public init(model: PlayerPageModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            if let held = model.heldBasis {
                BasisText(held)
            }
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
