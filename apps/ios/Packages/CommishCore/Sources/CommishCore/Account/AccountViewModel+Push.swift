import CommishAPI
import CommishDesign
import Foundation

/// The Account's push switches (Lane 288): the account's settings (GET and PATCH /me `notifications`)
/// behind the phone's permission, apart from the view model's body.
public extension AccountViewModel {
    /// The switches as drawn: the account's, every one off while this phone may not show a push.
    var shownPush: PushSettings {
        permission == .allowed ? push : push.allOff
    }

    /// A switch moved. On asks the phone first when it may not show a push yet (the system prompt once,
    /// never at launch), and stays off when it says no. The write is the account's stored switches with
    /// only this kind changed, so a phone that had not allowed push (every switch drawn off) never turns
    /// off the kinds the account keeps on (review M3); every one off takes this phone's token off.
    func set(_ kind: PushKind, isOn: Bool) async {
        if isOn {
            permission = await control.enable()
            guard permission == .allowed else {
                return
            }
        }
        let next = push.with(kind, isOn: isOn)
        guard await write(next), !next.anyOn else {
            return
        }
        await control.disable()
    }

    /// Quiet hours moved on the wheel: drawn at once, written once the wheel rests.
    func setQuiet(from: Int, to: Int) {
        push = push.with(quietFrom: from, quietTo: to)
        let settings = push
        quietWrite?.cancel()
        quietWrite = Task { [wait = self.wait] in
            await wait(Self.quietPause)
            guard !Task.isCancelled else {
                return
            }
            _ = await self.write(settings)
            if !Task.isCancelled {
                self.quietWrite = nil
            }
        }
    }

    /// The quiet hours' write under way, kept so a test can await it; the app never waits on it.
    var pendingQuietWrite: Task<Void, Never>? {
        quietWrite
    }

    /// Writes the settings to the account and shows what it holds after; a write that fails puts the
    /// account's last confirmed settings back (review M4) and says so beside the switches.
    internal func write(_ settings: PushSettings) async -> Bool {
        push = settings
        problem = nil
        do {
            try await held(api.updateNotifications(settings.change(zone: zone)))
            return true
        } catch where APIError.signsOut(error) {
            push = confirmed
            problem = AccountProblem(section: .notifications, text: AppWords.Failure.signedOut)
            signedOut()
        } catch let APIError.envelope(_, message) where !message.isEmpty {
            push = confirmed
            problem = AccountProblem(section: .notifications, text: message)
        } catch {
            push = confirmed
            problem = AccountProblem(section: .notifications, text: Words.Account.failed)
        }
        return false
    }

    /// The account as PATCH /me answered it: its settings confirmed and shown, the saved answer updated.
    internal func held(_ me: AccountAnswer) async {
        push = PushSettings(me.notifications?.value1)
        confirmed = push
        if let written = answer?.with(me: me) {
            answer = written
            await cache.write(written, route: Self.route, stamp: stamp)
        }
    }

    /// The account keeps quiet hours in a zone; when it is not this phone's (the API's New York default,
    /// or a trip), the phone's is written once, so quiet hours hold on the phone's clock (review M2). A
    /// failed write is logged and tried again the next time the Account opens.
    internal func writeZone(_ me: AccountAnswer) async {
        guard !zoneWritten, let held = me.notifications?.value1, held.timeZone != zone.identifier else {
            return
        }
        zoneWritten = true
        do {
            try await self.held(api.updateNotifications(NotificationSettingsChange(timeZone: zone.identifier)))
        } catch {
            zoneWritten = false
            Self.log.error("the zone did not save: \(String(describing: error), privacy: .public)")
        }
    }
}
