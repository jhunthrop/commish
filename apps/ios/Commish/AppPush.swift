import CommishCore
import os
import UIKit
import UserNotifications

/// The phone's push (Lane 288): the permission and its prompt through UNUserNotificationCenter, the
/// device token asked of Apple through UIApplication. The token arrives at the app delegate.
@MainActor
final class SystemPush: PushPlatform {
    func permission() async -> PushPermission {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .notAsked
        case .denied: .refused
        default: .allowed
        }
    }

    func ask() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            AppDelegate.log.error("push permission failed: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    func register() {
        UIApplication.shared.registerForRemoteNotifications()
    }
}

/// The app delegate push needs: the device token Apple hands over goes to the registrar, a push that
/// arrives while the app is open shows as a banner, and a tapped push opens the screen its payload
/// names. A push tapped before the shell listens (a cold launch) is held until it does.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    nonisolated static let log = Logger(subsystem: "app.trycommish.ios", category: "push")

    @MainActor var registrar: PushRegistrar?
    @MainActor private var held: PushTap?
    /// Where a tapped push goes, set by the app once its shell is up; a held one is delivered then.
    @MainActor var opened: ((PushTap) -> Void)? {
        didSet {
            if let held, let opened {
                self.held = nil
                opened(held)
            }
        }
    }

    func application(
        _: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await registrar?.tokenArrived(deviceToken) }
    }

    func application(_: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        Self.log.error("push token failed: \(String(describing: error), privacy: .public)")
    }

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter, willPresent _: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let tap = PushTap(route: PushRoute.of(response.notification.request.content.userInfo))
        await MainActor.run { open(tap) }
    }

    @MainActor private func open(_ tap: PushTap) {
        if let opened {
            opened(tap)
        } else {
            held = tap
        }
    }
}
