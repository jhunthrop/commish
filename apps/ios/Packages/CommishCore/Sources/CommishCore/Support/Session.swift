import CommishAPI
import Foundation
import Security

/// Where the signed-in phone keeps its device token and device id: the Keychain in the app, memory in
/// a test. The token is never logged and never leaves the store except as the bearer header.
public protocol SessionStore: TokenSource {
    func deviceID() async -> String?
    /// Throws when the store refused the write, so a sign-in never "succeeds" with no token kept.
    func save(token: String, deviceID: String) async throws
    func clear() async
}

/// The Keychain refused a write, with its OSStatus.
public struct KeychainError: Error, Equatable {
    public let status: OSStatus
}

public actor MemorySessionStore: SessionStore {
    private var saved: (token: String, deviceID: String)?

    public init() {}

    public func token() async -> String? {
        saved?.token
    }

    public func deviceID() async -> String? {
        saved?.deviceID
    }

    public func save(token: String, deviceID: String) async {
        saved = (token, deviceID)
    }

    public func clear() async {
        saved = nil
    }
}

/// The Keychain, one generic password item per field under the app's service, readable after the
/// phone's first unlock and never synced to another device.
public actor KeychainSessionStore: SessionStore {
    private let service: String

    public init(service: String = "app.trycommish.ios.session") {
        self.service = service
    }

    public func token() async -> String? {
        read("token")
    }

    public func deviceID() async -> String? {
        read("device")
    }

    public func save(token: String, deviceID: String) async throws {
        try write("token", token)
        try write("device", deviceID)
    }

    public func clear() async {
        for account in ["token", "device"] {
            SecItemDelete(query(account) as CFDictionary)
        }
    }

    private func query(_ account: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }

    private func read(_ account: String) -> String? {
        var found: CFTypeRef?
        var ask = query(account)
        ask[kSecReturnData] = true
        ask[kSecMatchLimit] = kSecMatchLimitOne
        guard SecItemCopyMatching(ask as CFDictionary, &found) == errSecSuccess, let data = found as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ account: String, _ value: String) throws {
        let removed = SecItemDelete(query(account) as CFDictionary)
        guard removed == errSecSuccess || removed == errSecItemNotFound else {
            throw KeychainError(status: removed)
        }
        var item = query(account)
        item[kSecValueData] = Data(value.utf8)
        item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else {
            throw KeychainError(status: added)
        }
    }
}
