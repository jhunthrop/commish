import CommishCore
import CommishDesign
import SwiftUI

/// The phone's five as the system tab bar draws them, for a render that cannot draw the native bar
/// (ImageRenderer: the shell's snapshots and the App Store screenshots). The app itself draws the
/// system tab bar (RootTabs). `lit` names the tab in view; nil lights none, as for a page pushed over
/// the bar in the store shots.
public struct TabStrip: View {
    @Environment(\.colorScheme) private var colorScheme
    private let tabs: [RailTab]
    private let lit: String?

    public init(tabs: [RailTab], lit: String?) {
        self.tabs = tabs
        self.lit = lit
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            ForEach(tabs) { tab in
                VStack(spacing: 3) {
                    Image(systemName: TabSymbols.symbol(tab.key)).font(.system(size: 20))
                    Text(tab.label).font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(theme.color(tab.key == lit ? Tokens.Color.accentText : Tokens.Color.ink3))
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 6)
        .frame(height: 50)
        .background(theme.color(Tokens.Color.shell))
        .overlay(alignment: .top) { Rectangle().fill(theme.color(Tokens.Color.shellLine)).frame(height: 1) }
    }
}
