import Foundation

/// The device kinds the API mints a token for: an app kind carries the session scope, so one token
/// opens every signed-in read.
public enum DeviceKind: String, Codable, Sendable {
    case ios
    case android
    case extensionBrowser = "extension"
}

/// The body of `POST /devices/pair` for an app: the code the sign-in return carried, what the phone
/// calls itself, its kind, and the PKCE verifier whose challenge went out on `/auth/login`.
///
/// Hand-written, not generated: the operation's `kind` and `code_verifier` arrive with Lane 172's
/// `api/openapi.yaml` (plan Task B). Once they are on main, `pairDevice` joins the generator's filter
/// and this call moves onto the generated client with the same shape.
public struct PairInput: Codable, Equatable, Sendable {
    public let code: String
    public let name: String
    public let kind: DeviceKind
    public let codeVerifier: String

    public init(code: String, name: String, kind: DeviceKind, codeVerifier: String) {
        self.code = code
        self.name = name
        self.kind = kind
        self.codeVerifier = codeVerifier
    }

    enum CodingKeys: String, CodingKey {
        case code, name, kind
        case codeVerifier = "code_verifier"
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

/// `POST /devices/pair` over URLSession.
public struct PairingClient: DevicePairing {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func pair(_ input: PairInput) async throws -> PairedDevice {
        let (body, response) = try await session.data(for: Self.request(input, baseURL: baseURL))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return try Self.answer(body, status: status)
    }

    public static func request(_ input: PairInput, baseURL: URL) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("devices/pair"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try APIDecoding.encoder().encode(input)
        return request
    }

    public static func answer(_ body: Data, status: Int) throws -> PairedDevice {
        let paired: Paired
        do {
            paired = try APIDecoding.envelopeData(Paired.self, from: body)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.status(status)
        }
        return PairedDevice(token: paired.token, deviceID: paired.device.id)
    }

    private struct Paired: Decodable {
        struct Device: Decodable {
            let id: String
        }

        let token: String
        let device: Device
    }
}
