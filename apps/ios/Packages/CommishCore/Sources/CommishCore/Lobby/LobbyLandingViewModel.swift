import CommishAPI
import CommishDesign
import Foundation
import Observation

/// A lobby card (LobbyList.svelte at 390): the format's title, its clock, how many are in the room
/// filling now, and its one verb; the card of a draft the member holds a seat in says "Your seat" and
/// opens that room.
public struct LobbyCard: Equatable, Sendable, Identifiable {
    public let id: String
    public let format: LobbyFormat
    public let title: String
    public let clock: String
    public let fill: String
    /// Nobody in yet: words, quiet, not a figure.
    public let empty: Bool
    public let verb: String
    /// The room the member is seated in for this format, which the card opens.
    public let seat: String?
}

/// The open house drafts (the lobby list on the web's /mock/new, where /lobby goes): every format with
/// how full its filling room is, a card each, one verb, Join. A join answers the room's id, which the
/// app opens; a join without a handle asks for one first (HandlePrompt.svelte). The rooms the member
/// joined this session are remembered so their card reads "Your seat" until the seat is gone.
@MainActor
@Observable
public final class LobbyLandingViewModel {
    public private(set) var lobbies: [LobbyFilling] = []
    /// The rooms joined, by format, while the API still seats the member in them.
    public private(set) var seated: [String: String] = [:]
    public private(set) var busy = false
    public private(set) var problem: String?
    /// The format a join waits on a handle for, and the API's word on the last handle tried.
    public private(set) var handleFor: LobbyFormat?
    public private(set) var handleProblem: String?
    public private(set) var read = false

    private let api: any LobbyAPI
    private let onSignedOut: @MainActor () -> Void

    public init(api: any LobbyAPI, onSignedOut: @escaping @MainActor () -> Void = {}) {
        self.api = api
        self.onSignedOut = onSignedOut
    }

    /// The list's head: "Lobbies filling now" from the first seat taken, else "Open lobbies".
    public var head: String {
        LobbyWords.listHead(lobbies.map(\.filling))
    }

    public var cards: [LobbyCard] {
        lobbies.map { lobby in
            let key = Self.key(lobby.format)
            let fill = LobbyWords.fill(lobby.filling)
            let seat = seated[key]
            return LobbyCard(
                id: key, format: lobby.format,
                title: LobbyWords.title(
                    teams: lobby.teams, preset: lobby.scoring.value1?.rawValue ?? lobby.scoring.value2 ?? "ppr",
                    lineup: lobby.lineup.value1?.rawValue ?? lobby.lineup.value2 ?? "standard"
                ),
                clock: LobbyWords.pickClock(lobby.clockSeconds), fill: fill.words, empty: fill.empty,
                verb: seat == nil ? Words.Lobby.join : Words.Lobby.yourSeat, seat: seat
            )
        }
    }

    static func key(_ format: LobbyFormat) -> String {
        format.value1?.rawValue ?? format.value2 ?? ""
    }

    /// The list read again (on appear and on pull), and each remembered seat checked: a seat the API
    /// no longer holds for the member (403, 404) or a room that closed unattended is forgotten.
    public func load() async {
        do {
            lobbies = try await api.lobbies()
            problem = nil
        } catch {
            problem = LobbyRefusal.sentence(error)
        }
        read = true
        for (format, room) in seated {
            do {
                let lobby = try await api.lobby(id: room)
                if lobby.status.value1 == .abandoned {
                    seated[format] = nil
                }
            } catch where LobbyRefusal.isFinal(error) {
                seated[format] = nil
            } catch {
                // Offline: the seat stays until a read says otherwise.
            }
        }
    }

    /// A card's verb: the room the member is seated in, or a seat in the format's filling room. Nil
    /// when the API refused (its words in `problem`) or a handle is needed first.
    public func join(_ format: LobbyFormat) async -> String? {
        if let seat = seated[Self.key(format)] {
            return seat
        }
        guard !busy else {
            return nil
        }
        busy = true
        defer { busy = false }
        problem = nil
        do {
            let seat = try await api.join(format)
            seated[Self.key(format)] = seat.roomId
            handleFor = nil
            return seat.roomId
        } catch is LobbyHandleNeeded {
            handleFor = format
            return nil
        } catch {
            if LobbyRefusal.status(error) == 401 {
                onSignedOut()
            }
            problem = LobbyRefusal.sentence(error)
            return nil
        }
    }

    /// The handle saved, then the join it waited on.
    public func saveHandle(_ handle: String) async -> String? {
        guard let format = handleFor else {
            return nil
        }
        do {
            try await api.setHandle(handle.trimmingCharacters(in: .whitespaces))
            handleProblem = nil
            handleFor = nil
            return await join(format)
        } catch let APIError.envelope(_, message) where !message.isEmpty {
            handleProblem = message
        } catch {
            handleProblem = Words.Lobby.handleFailed
        }
        return nil
    }

    /// The seat given up (Leave) or the room closed: its card offers Join again.
    public func forget(room: String) {
        seated = seated.filter { $0.value != room }
    }

    /// A room opened from elsewhere (Join another lobby): its card reads "Your seat".
    public func seat(_ room: String, format: LobbyFormat) {
        seated[Self.key(format)] = room
    }
}
