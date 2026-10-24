import CoreText
import Foundation
import SwiftUI

/// The site's three faces (tokens' `font`): Outfit for the interface, Big Shoulders Display for the
/// numbers, Newsreader for prose. Each ships in the package as the web's own latin subset, a
/// variable font drawn at the weight asked on its `wght` axis.
public enum Face: String, CaseIterable, Sendable {
    case ui
    case num
    case read

    /// The token's name for the face.
    public var family: String {
        switch self {
        case .ui: Tokens.Font.ui
        case .num: Tokens.Font.num
        case .read: Tokens.Font.read
        }
    }

    var resource: String {
        family.replacingOccurrences(of: " ", with: "")
    }
}

/// A face's weight on its `wght` axis, the CSS numbers the web asks for.
public enum FaceWeight: Double, Sendable {
    case regular = 400
    case medium = 500
    case semibold = 600
    case bold = 700
}

public enum Faces {
    /// Each face's PostScript name once registered, on first use. A face missing here draws in the
    /// system face, never in nothing.
    static let names: [Face: String] = Dictionary(
        uniqueKeysWithValues: Face.allCases.compactMap { face in register(face).map { (face, $0) } }
    )

    public static var registered: [Face] {
        Face.allCases.filter { names[$0] != nil }
    }

    private static func register(_ face: Face) -> String? {
        guard let url = Bundle.module.url(forResource: face.resource, withExtension: "woff2") else {
            return nil
        }
        var error: Unmanaged<CFError>?
        _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        let found = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]
        return found?.first.flatMap { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String }
    }

    /// The `wght` axis, as CoreText names an axis: its four letters as a number.
    static let weightAxis = 0x7767_6874

    /// The face at a size and weight as CoreText draws it, numbers in tabular figures so a
    /// column's digits line up; nil when the face did not register.
    public static func ctFont(_ face: Face, size: Double, weight: FaceWeight) -> CTFont? {
        guard let name = names[face] else {
            return nil
        }
        let base = CTFontDescriptorCreateWithNameAndSize(name as CFString, size)
        var attributes: [CFString: Any] = [kCTFontVariationAttribute: [weightAxis: weight.rawValue]]
        if face == .num {
            attributes[kCTFontFeatureSettingsAttribute] = [[
                kCTFontOpenTypeFeatureTag: "tnum",
                kCTFontOpenTypeFeatureValue: 1,
            ]]
        }
        let descriptor = CTFontDescriptorCreateCopyWithAttributes(base, attributes as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    /// The face for SwiftUI, the system face of the same weight where the face did not register.
    public static func font(_ face: Face, size: Double, weight: FaceWeight = .regular) -> Font {
        if let font = ctFont(face, size: size, weight: weight) {
            return Font(font)
        }
        let system = Font.system(size: size, weight: systemWeight(weight), design: face == .read ? .serif : .default)
        return face == .num ? system.monospacedDigit() : system
    }

    private static func systemWeight(_ weight: FaceWeight) -> Font.Weight {
        switch weight {
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        }
    }
}
