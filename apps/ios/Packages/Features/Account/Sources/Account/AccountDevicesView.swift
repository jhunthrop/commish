import CommishCore
import CommishDesign
import SwiftUI

/// The paired devices (hosts/AccountDevices.svelte): each device's name and line, this phone marked,
/// and Unpair. Shown once the account has a paired device, as the web's list is.
struct AccountDevicesView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: AccountModel
    let state: AccountScreenState
    let unpair: (String) -> Void

    var body: some View {
        if !model.devices.isEmpty {
            let theme = Theme(colorScheme)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                SectionHead(Words.Devices.title, aside: model.devicesAside)
                VStack(spacing: 0) {
                    ForEach(model.devices) { device in
                        KeyRow {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: Tokens.Space.s2) {
                                    Text(device.name)
                                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                                        .foregroundStyle(theme.color(Tokens.Color.ink))
                                    if device.thisPhone {
                                        Pill(Words.Devices.thisPhone, tone: .accent)
                                    }
                                }
                                Text(device.line)
                                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                            }
                        } trailing: {
                            QuietButton(state.busy == device.id ? Words.Devices.unpairing : Words.Devices.unpair) {
                                unpair(device.id)
                            }
                            .disabled(state.busy != nil)
                        }
                    }
                }
                if let problem = state.problem, problem.section == .devices {
                    ProblemText(text: problem.text)
                }
            }
        }
    }
}
