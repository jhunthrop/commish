import SwiftUI

/// The two themes, apart from SwiftUI's own type so a model or a test can name one.
public enum Scheme: Sendable, Equatable {
    case light
    case dark
}

public extension ThemedColor {
    /// The token's 0xRRGGBB in a theme.
    func value(in scheme: Scheme) -> UInt32 {
        scheme == .light ? light : dark
    }
}

/// A 0xRRGGBB value as three channels from 0 to 1.
public struct RGB: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(_ value: UInt32) {
        red = Double((value >> 16) & 0xFF) / 255
        green = Double((value >> 8) & 0xFF) / 255
        blue = Double(value & 0xFF) / 255
    }
}

/// The theme a view draws in: the system's appearance, honoured as the web honours
/// `prefers-color-scheme`. A view reads `colorScheme` from its environment and asks the theme for a
/// token's colour, so a snapshot renders either theme by setting the environment.
public struct Theme: Sendable, Equatable {
    public let scheme: Scheme

    public init(scheme: Scheme) {
        self.scheme = scheme
    }

    public init(_ colorScheme: ColorScheme) {
        self.init(scheme: colorScheme == .dark ? Scheme.dark : Scheme.light)
    }

    public func color(_ token: ThemedColor) -> Color {
        let rgb = RGB(token.value(in: scheme))
        return Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: 1)
    }
}
