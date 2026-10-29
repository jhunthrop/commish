import CommishCore
import CommishDesign
import SwiftUI

/// The push switches (spec §5.3): one per kind with what it sends, then quiet hours with their two
/// ends, and under them where the switches are kept and, while the phone may not show a push, what a
/// switch does or where to allow it; a write that failed says so. The switch is drawn here rather than
/// the system's, so the snapshot draws it as the phone does.
struct PushSwitchesView: View {
    @Environment(\.colorScheme) private var colorScheme
    let push: PushSettings
    let permission: PushPermission
    let problem: String?
    let toggle: (PushKind, Bool) -> Void
    let editQuiet: (QuietEnd) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Push.title)
            VStack(spacing: 0) {
                ForEach(PushKind.allCases, id: \.self) { kind in
                    KeyRow {
                        named(Self.name(kind), Self.line(kind), theme: theme)
                    } trailing: {
                        Toggle(Self.name(kind), isOn: Binding(get: { push.on(kind) }, set: { toggle(kind, $0) }))
                            .labelsHidden()
                            .toggleStyle(DrawnSwitch())
                    }
                }
                KeyRow {
                    named(Words.Push.quiet, Words.Push.quietLine, theme: theme)
                } trailing: {
                    EmptyView()
                }
                HStack(spacing: Tokens.Space.s3) {
                    QuietEndButton(label: Words.Push.from, time: AccountWords.clockTime(push.quietFrom)) {
                        editQuiet(.from)
                    }
                    QuietEndButton(label: Words.Push.to, time: AccountWords.clockTime(push.quietTo)) {
                        editQuiet(.to)
                    }
                }
                .padding(.vertical, Tokens.Space.s2)
            }
            if let problem {
                ProblemText(text: problem)
            }
            BasisText(AccountWords.pushFoot(permission))
        }
    }

    private func named(_ name: String, _ line: String, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(line)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    static func name(_ kind: PushKind) -> String {
        switch kind {
        case .thursday: Words.Push.thursday
        case .status: Words.Push.status
        case .waivers: Words.Push.waivers
        }
    }

    static func line(_ kind: PushKind) -> String {
        switch kind {
        case .thursday: Words.Push.thursdayLine
        case .status: Words.Push.statusLine
        case .waivers: Words.Push.waiversLine
        }
    }
}

/// One end of quiet hours: its label over its time, a tap opens the time picker.
struct QuietEndButton: View {
    @Environment(\.colorScheme) private var colorScheme
    let label: String
    let time: String
    let action: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Text(time)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).stroke(theme.color(Tokens.Color.line)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(time)
    }
}

/// A switch drawn in the theme: the accent's track when on, the surface's when off, the knob in place.
struct DrawnSwitch: ToggleStyle {
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        let theme = Theme(colorScheme)
        let isOn = configuration.isOn
        return Button { configuration.isOn.toggle() } label: {
            Capsule()
                .fill(theme.color(isOn ? Tokens.Color.accent : Tokens.Color.surface2))
                .overlay(Capsule().stroke(theme.color(isOn ? Tokens.Color.accent : Tokens.Color.lineStrong)))
                .frame(width: 51, height: 31)
                .overlay(alignment: isOn ? .trailing : .leading) {
                    Circle()
                        .fill(theme.color(isOn ? Tokens.Color.accentInk : Tokens.Color.bg))
                        .frame(width: 27, height: 27)
                        .padding(2)
                }
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }
}
