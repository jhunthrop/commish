import Foundation

public typealias NotificationSettingsAnswer = Components.Schemas.NotificationSettings
public typealias NotificationSettingsChange = Components.Schemas.NotificationSettingsUpdate

/// This phone's push registration (Lane 288 over Lane 262's PUT and DELETE /devices/{id}/push): its APNs
/// device token on its own device, and taking it off. The seam the registrar's tests replace.
public protocol PushAPI: Sendable {
    /// Registers the APNs device token (hex) on this phone's device.
    func registerPush(device: String, token: String) async throws
    /// Takes this phone's token off: it receives no push from then on.
    func removePush(device: String) async throws
}

/// The account's push settings (PATCH /me `notifications`), the Account's switches and quiet hours.
public protocol NotificationSettingsAPI: Sendable {
    /// Writes the change and answers the account as the API now holds it.
    func updateNotifications(_ change: NotificationSettingsChange) async throws -> AccountAnswer
}

extension APIClient: PushAPI {
    public func registerPush(device: String, token: String) async throws {
        let body = Components.Schemas.PushRegistration(platform: .init(value1: .apns), token: token)
        switch try await Self.unwrapped({ try await client.registerPush(path: .init(id: device), body: .json(body)) }) {
        case .ok:
            return
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .unauthorized(answer):
            throw try Self.problem(answer.body.json)
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

    public func removePush(device: String) async throws {
        switch try await Self.unwrapped({ try await client.removePush(path: .init(id: device)) }) {
        case .ok:
            return
        case let .unauthorized(answer):
            throw try Self.problem(answer.body.json)
        case let .forbidden(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}

extension APIClient: NotificationSettingsAPI {
    public func updateNotifications(_ change: NotificationSettingsChange) async throws -> AccountAnswer {
        let body = Components.Schemas.AccountUpdate(notifications: change)
        switch try await Self.unwrapped({ try await client.updateMe(body: .json(body)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
