import CommishAPI
import Foundation
import Security

/// Where the signed-in phone keeps its device token and device id: the Keychain in the app, memory in
/// a test. The token is never logged and never leaves the store except as the bearer header.
public protocol SessionStore: TokenSource {
    func deviceID() async -> String?
    func save(token: String, deviceID: String) async
    func clear() async
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

    public func save(token: String, deviceID: String) async {
        write("token", token)
        write("device", deviceID)
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

    private func write(_ account: String, _ value: String) {
        SecItemDelete(query(account) as CFDictionary)
        var item = query(account)
        item[kSecValueData] = Data(value.utf8)
        item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
