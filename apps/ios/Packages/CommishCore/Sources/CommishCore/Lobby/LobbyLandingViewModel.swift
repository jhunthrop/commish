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

/// Where the landing keeps the rooms the member holds a seat in, by format, across a relaunch: the
/// phone's defaults in the app, memory in a test.
@MainActor
public protocol LobbySeatMemory: AnyObject {
    var seats: [String: String] { get set }
}

/// The phone's defaults, one dictionary of format to room id.
@MainActor
public final class DefaultsLobbySeats: LobbySeatMemory {
    static let key = "lobby.seats"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var seats: [String: String] {
        get { defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: Self.key) }
    }
}

/// Seats kept for the test's life only.
@MainActor
public final class MemoryLobbySeats: LobbySeatMemory {
    public var seats: [String: String]

    public init(_ seats: [String: String] = [:]) {
        self.seats = seats
    }
}

/// The open house drafts (the lobby list on the web's /mock/new, where /lobby goes): every format with
/// how full its filling room is, a card each, one verb, Join. A join answers the room's id, which the
/// app opens; a join without a handle asks for one first (HandlePrompt.svelte). The rooms the member
/// joined are remembered across a relaunch so their card reads "Your seat" while the seat is still
/// the member's in a room still drafting or filling; every read checks it (B243 is the API's flag).
@MainActor
@Observable
public final class LobbyLandingViewModel {
    public private(set) var lobbies: [LobbyFilling] = []
    /// The rooms joined, by format, while the API still seats the member in them.
    public var seated: [String: String] {
        memory.seats
    }

    public private(set) var busy = false
    public private(set) var problem: String?
    /// The format a join waits on a handle for, and the API's word on the last handle tried.
    public private(set) var handleFor: LobbyFormat?
    public private(set) var handleProblem: String?
    public private(set) var read = false

    private let api: any LobbyAPI
    private let memory: any LobbySeatMemory
    private let onSignedOut: @MainActor () -> Void

    public init(
        api: any LobbyAPI, memory: any LobbySeatMemory = MemoryLobbySeats(),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.memory = memory
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

    /// setup.ts nearestLobby: superflex drafts in the superflex room, ten teams or fewer in the ten-team
    /// one, the rest in the twelve-team PPR room.
    public static func nearest(_ settings: RoomSettings) -> LobbyFormat {
        if (settings.lineup.value1?.rawValue ?? settings.lineup.value2) == "superflex" {
            return LobbyFormat(value1: ._12HalfSuperflex)
        }
        return LobbyFormat(value1: settings.teams <= 10 ? ._10Ppr : ._12Ppr)
    }

    static func key(_ format: LobbyFormat) -> String {
        format.value1?.rawValue ?? format.value2 ?? ""
    }

    /// The list read again (on appear and on pull), and each remembered seat checked: one the API no
    /// longer holds for the member (403, 404), a room drafted to its end or closed unattended, or a seat
    /// the member left is forgotten, so the card offers Join again.
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
                if try await Self.over(api.lobby(id: room)) {
                    memory.seats[format] = nil
                }
            } catch where LobbyRefusal.isFinal(error) {
                memory.seats[format] = nil
            } catch {
                // Offline: the seat stays until a read says otherwise.
            }
        }
    }

    /// A room the member's seat is no longer in play in: drafted to its end, closed unattended, or left.
    static func over(_ room: LobbyRoom) -> Bool {
        let status = room.status.value1
        let mine = room.seats.first { $0.seat == room.you }.map(LobbySeats.kind)
        return status == .complete || status == .abandoned || mine == .left
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
            memory.seats[Self.key(format)] = seat.roomId
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

    /// The seat given up (Leave), the room drafted to its end, or its report's Join another lobby: its
    /// card offers Join again.
    public func forget(room: String) {
        memory.seats = seated.filter { $0.value != room }
    }

    /// A room opened from elsewhere (a closed lobby's Join another lobby): its card reads "Your seat".
    public func seat(_ room: String, format: LobbyFormat) {
        memory.seats[Self.key(format)] = room
    }
}
