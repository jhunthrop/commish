import Foundation

/// What a sign-in sends to `POST /devices/pair`: the code the return link carried, what the phone calls
/// itself, its kind, and the PKCE verifier whose challenge went out on `/auth/login`.
public struct PairInput: Equatable, Sendable {
    public let code: String
    public let name: String
    public let kind: Components.Schemas.DeviceKind
    public let codeVerifier: String

    public init(code: String, name: String, kind: Components.Schemas.DeviceKind, codeVerifier: String) {
        self.code = code
        self.name = name
        self.kind = kind
        self.codeVerifier = codeVerifier
    }
}

/// What a pairing answers: the token, sent once, and the device's id, which sign-out revokes.
public struct PairedDevice: Equatable, Sendable {
    public let token: String
    public let deviceID: String

    public init(token: String, deviceID: String) {
        self.token = token
        self.deviceID = deviceID
    }
}

public protocol DevicePairing: Sendable {
    func pair(_ input: PairInput) async throws -> PairedDevice
}

/// `POST /devices/pair` through the generated client (the operation Lane 172 gave `kind` and
/// `code_verifier`). An app kind mints a token with the session scope.
public struct PairingClient: DevicePairing {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public init(baseURL: URL, tokens: any TokenSource) {
        self.init(client: Transport.client(baseURL: baseURL, tokens: tokens))
    }

    public func pair(_ input: PairInput) async throws -> PairedDevice {
        let body = Components.Schemas.PairInput(
            code: input.code, name: input.name, kind: input.kind, codeVerifier: input.codeVerifier
        )
        switch try await APIClient.unwrapped({ try await client.pairDevice(body: .json(body)) }) {
        case let .created(answer):
            let paired = try APIClient.payload(answer.body.json.value2.data)
            return PairedDevice(token: paired.token, deviceID: paired.device.id)
        case let .badRequest(answer):
            throw try APIClient.problem(answer.body.json)
        case let .conflict(answer):
            throw try APIClient.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
