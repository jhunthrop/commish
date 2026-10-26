import CommishCore
import CommishDesign
import SwiftUI

/// The score bug (ScoreBug.svelte at 390): the round and the pick, who is on the clock, the room's clock
/// big, and your pick, on the scoreboard's dark. The pick and who is on the clock are announced as they
/// change; the ticking clock is hidden from a screen reader, which hears it only at ten and five seconds
/// on your own clock.
struct LobbyScoreBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: LobbyScoreBug

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            segment(theme, small: bug.round, big: bug.pick)
            segment(theme, small: Words.Lobby.onTheClock, big: bug.onClock, grow: true)
            VStack(spacing: 3) {
                label(Words.Lobby.clock, theme)
                Text(bug.clock)
                    .font(Faces.font(.num, size: 34, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.scoreboardNum))
            }
            .padding(.horizontal, Tokens.Space.s2)
            .frame(maxHeight: .infinity)
            .overlay(alignment: .trailing) { divider(theme) }
            .accessibilityHidden(true)
            segment(theme, small: Words.Lobby.yourPick, big: bug.yourPick, num: true, last: true)
        }
        .frame(minHeight: 56)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.scoreboard)))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.scoreboardLine))
        )
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .padding(.horizontal, Tokens.Space.s3)
        .accessibilityElement(children: .combine)
        .accessibilityValue(bug.yours ? Words.Lobby.yourPickIsNow : "")
        .overlay {
            if let spoken = bug.spoken {
                Text(spoken).accessibilityAddTraits(.updatesFrequently).opacity(0).allowsHitTesting(false)
            }
        }
    }

    private func segment(
        _ theme: Theme, small: String, big: String, grow: Bool = false, num: Bool = false, last: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            label(small, theme)
            Text(big)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(theme.color(num ? Tokens.Color.scoreboardNum : Tokens.Color.scoreboardInk))
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(maxWidth: grow ? .infinity : nil, maxHeight: .infinity, alignment: .leading)
        .fixedSize(horizontal: !grow, vertical: false)
        .overlay(alignment: .trailing) {
            if !last {
                divider(theme)
            }
        }
    }

    private func label(_ text: String, _ theme: Theme) -> some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(1)
            .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
    }

    private func divider(_ theme: Theme) -> some View {
        Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(width: 1)
    }
}

/// The seats strip (SeatsStrip.svelte): a person's seat names him and says how he is, a bot's or an open
/// seat a compact cell with its number; yours and the seat on the clock edged, scrolled into view.
struct LobbySeatsView: View {
    @Environment(\.colorScheme) private var colorScheme
    let seats: [LobbySeatCell]
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        Group {
            if live {
                ScrollViewReader { reader in
                    ScrollView(.horizontal, showsIndicators: false) { cells(theme) }
                        .onAppear { reveal(reader) }
                        .onChange(of: seats.first { $0.onClock }?.id) { reveal(reader) }
                }
            } else {
                // Drawn still, the strip shows its end when your seat is in its later half, as the live
                // strip scrolls to it.
                cells(theme)
                    .fixedSize()
                    .frame(minWidth: 0, maxWidth: .infinity, alignment: yoursLate ? .trailing : .leading)
                    .clipped()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Lobby.seats)
    }

    private var yoursLate: Bool {
        (seats.firstIndex(where: \.you) ?? 0) * 2 >= seats.count
    }

    /// The seat on the clock, then yours, so yours is always in view.
    private func reveal(_ reader: ScrollViewProxy) {
        if let clock = seats.first(where: \.onClock)?.id {
            reader.scrollTo(clock)
        }
        if let you = seats.first(where: \.you)?.id {
            reader.scrollTo(you)
        }
    }

    private func cells(_ theme: Theme) -> some View {
        HStack(spacing: 6) {
            ForEach(seats) { seat in
                cell(seat, theme).id(seat.id)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, 2)
    }

    private func cell(_ seat: LobbySeatCell, _ theme: Theme) -> some View {
        let edge = seat.onClock ? Tokens.Color.accent : seat.you ? Tokens.Color.ink : Tokens.Color.line
        return Group {
            if seat.compact {
                Text(String(seat.id))
                    .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                    .foregroundStyle(theme.color(seat.open ? Tokens.Color.ink3 : Tokens.Color.ink2))
                    .frame(width: 32, height: 40)
                    .accessibilityLabel(seat.label)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(seat.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .lineLimit(1)
                        .foregroundStyle(theme.color(seat.left ? Tokens.Color.ink3 : Tokens.Color.ink))
                    Text(seat.line)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .lineLimit(1)
                        .foregroundStyle(theme.color(seat.onClock ? Tokens.Color.accentText : Tokens.Color.ink3))
                }
                .padding(.horizontal, 8)
                .frame(minWidth: 92, maxWidth: 160, minHeight: 40, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .fill(theme.color(seat.onClock ? Tokens.Color.accentWash : Tokens.Color.surface))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .strokeBorder(theme.color(edge), lineWidth: seat.onClock || seat.you ? 2 : 1)
        )
    }
}

/// The filling room's line (LobbyRoomView.svelte .wait): the count in bold, then when it starts.
struct LobbyWaitView: View {
    @Environment(\.colorScheme) private var colorScheme
    let wait: LobbyWait

    var body: some View {
        let theme = Theme(colorScheme)
        RoomPanel {
            (Text(wait.count).bold().foregroundStyle(theme.color(Tokens.Color.ink))
                + Text(" " + wait.words).foregroundStyle(theme.color(Tokens.Color.ink2)))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The dock's line (LobbyRoomView.svelte .about): the lobby in bold, then who is in it and its clock.
struct LobbyAboutView: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: String
    let about: String

    var body: some View {
        let theme = Theme(colorScheme)
        RoomPanel {
            (Text(head).bold().foregroundStyle(theme.color(Tokens.Color.ink))
                + Text(", " + about).foregroundStyle(theme.color(Tokens.Color.ink2)))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A notice over the room (the room page's .notice panels): a line, and the way forward when there is
/// one.
struct LobbyNoticeView: View {
    let line: String
    var verb: (label: String, action: () -> Void)?
    var quiet = false

    var body: some View {
        RoomPanel {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Note(text: line)
                if let verb {
                    if quiet {
                        QuietButton(verb.label, action: verb.action)
                    } else {
                        Verb(verb.label, action: verb.action)
                    }
                }
            }
        }
    }
}
