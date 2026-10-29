import Foundation
import OpenAPIRuntime

public typealias AccountAnswer = Components.Schemas.Account
public typealias AttachedLeague = Components.Schemas.AttachedLeague
public typealias PairedDeviceRow = Components.Schemas.Device

/// The Account screen's reads and writes (web/src/lib/account/AccountPage.svelte): the account, the
/// leagues followed with detach and restore (league/AccountLeagues.svelte), the paired devices with
/// unpair (hosts/AccountDevices.svelte). The seam the view model's tests replace with a stub. Sign out
/// is the session's (AppSession.signOut), which revokes this phone the same way. The push switches
/// write through NotificationSettingsAPI (PATCH /me).
public protocol AccountScreenAPI: NotificationSettingsAPI {
    func me() async throws -> AccountAnswer
    func attached() async throws -> [AttachedLeague]
    /// Stops following a league; the attachment is kept as detached, so `restore` takes it back.
    func detach(id: String) async throws
    /// Follows a detached league again; a second live league needs many_leagues (403, its sentence).
    func restore(id: String) async throws
    func devices() async throws -> [PairedDeviceRow]
    /// Unpairs a device: its token opens nothing from the next request on.
    func revokeDevice(id: String) async throws
    /// The founder's one switch, /billing/plans `free_season`: nil from an API older than the free
    /// season, which sends none. Only the flag is read; the app never shows a price.
    func freeSeasonFlag() async throws -> Bool?
    /// Deletes the account (POST /me/delete, Lane 233) with the email the member typed: nothing to read
    /// on a 204. A 400 throws the API's sentence for the email, a 409 its sentence (a membership that
    /// still renews), a 401 signs out.
    func deleteAccount(email: String) async throws
}

extension APIClient: AccountScreenAPI {
    public func me() async throws -> AccountAnswer {
        switch try await Self.unwrapped({ try await client.getMe() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .unauthorized(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func attached() async throws -> [AttachedLeague] {
        switch try await Self.unwrapped({ try await client.listAttached() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func detach(id: String) async throws {
        switch try await Self.unwrapped({ try await client.detachLeague(path: .init(id: id)) }) {
        case .ok:
            return
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func restore(id: String) async throws {
        switch try await Self.unwrapped({ try await client.restoreLeague(path: .init(id: id)) }) {
        case .ok:
            return
        case let .forbidden(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func freeSeasonFlag() async throws -> Bool? {
        switch try await Self.unwrapped({ try await client.getPlans() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data).freeSeason
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func deleteAccount(email: String) async throws {
        switch try await Self.unwrapped({ try await client.deleteMe(body: .json(.init(email: email))) }) {
        case .noContent:
            return
        case let .badRequest(answer):
            throw try Self.refusal(answer.body.json, field: "email")
        case let .unauthorized(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    /// A refused field's own sentence where the API names one ("Type the email you sign in with"), else
    /// the envelope's.
    static func refusal(_ envelope: Components.Schemas.Envelope, field: String) -> APIError {
        guard let error = envelope.error?.value1 else {
            return .emptyEnvelope
        }
        let sentence = error.fields?.additionalProperties[field] ?? error.message
        return .envelope(code: error.code, message: sentence)
    }

    public func devices() async throws -> [PairedDeviceRow] {
        switch try await Self.unwrapped({ try await client.listDevices() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
