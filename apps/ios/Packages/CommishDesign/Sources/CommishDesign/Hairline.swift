import SwiftUI

/// The one-point line between a table's rows (the web's `border-bottom: 1px solid var(--line)`), shared
/// by every box score: the Lineup's and the Board's.
public struct Hairline: View {
    @Environment(\.colorScheme) private var colorScheme

    public init() {}

    public var body: some View {
        Rectangle().fill(Theme(colorScheme).color(Tokens.Color.line)).frame(height: 1)
    }
}
