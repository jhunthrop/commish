@testable import CommishDesign
import CoreText
import SwiftUI
import Testing

struct ThemeTests {
    @Test func inkResolvesToEachThemesValue() {
        #expect(Tokens.Color.ink.value(in: .light) == 0x15120F)
        #expect(Tokens.Color.ink.value(in: .dark) == 0xF5F0EA)
        #expect(Theme(scheme: .light).scheme == .light)
        #expect(Theme(scheme: .dark).scheme == .dark)
    }

    @Test func aColourSplitsIntoItsChannels() {
        let rgb = RGB(0xC2470A)
        #expect(rgb.red == Double(0xC2) / 255)
        #expect(rgb.green == Double(0x47) / 255)
        #expect(rgb.blue == Double(0x0A) / 255)
    }
}

struct FacesTests {
    @Test func theThreeFacesRegisterFromTheBundle() {
        #expect(Faces.registered == [.ui, .num, .read])
    }

    @Test func aFaceDrawsAtTheWeightAskedOnItsAxis() throws {
        let font = try #require(Faces.ctFont(.ui, size: 15, weight: .semibold))
        #expect((CTFontCopyPostScriptName(font) as String).hasPrefix("Outfit"))
        #expect(CTFontGetSize(font) == 15)
        let variation = try #require(CTFontCopyVariation(font) as? [Int: Double])
        #expect(variation[Faces.weightAxis] == 600)
    }

    @Test func numbersDrawInTheNumberFace() throws {
        let font = try #require(Faces.ctFont(.num, size: 18, weight: .bold))
        #expect((CTFontCopyPostScriptName(font) as String).hasPrefix("BigShouldersDisplay"))
    }
}

struct BoxLayoutTests {
    private let columns = [
        BoxColumn(id: "rank", title: "#", width: .fixed(24), numeric: true),
        BoxColumn(id: "team", title: "Team", width: .flex, numeric: false),
        BoxColumn(id: "pf", title: "PF", width: .fixed(56), numeric: true),
    ]

    @Test func aFixedColumnHasItsWidthAndTheFlexOneTakesTheRest() {
        #expect(columns.map(\.fixedWidth) == [24, nil, 56])
    }

    @Test func numbersAlignTrailingAndWordsLeading() {
        #expect(columns.map(\.alignment) == [.trailing, .leading, .trailing])
    }
}

struct MarkTests {
    @Test func theOutlineStaysInsideItsBox() {
        let bounds = MarkShape.outline(in: CGRect(x: 0, y: 0, width: 256, height: 256)).boundingRect
        #expect(bounds.minX >= 0 && bounds.minY >= 0)
        #expect(bounds.maxX <= 256 && bounds.maxY <= 256)
        // The chamber's left edge and the tip sit on the box's sides.
        #expect(abs(bounds.minX - 5.6) < 1)
        #expect(abs(bounds.maxX - 250.4) < 0.01)
    }

    @Test func aSmallMarkTakesTheHeavierWeight() {
        #expect(MarkShape.stroke(forSide: 24) == MarkTrace.smallStroke)
        #expect(MarkShape.stroke(forSide: 120) == MarkTrace.stroke)
    }
}

/// FlowRow's rows: leading from the edge, or centred by half the slack as the web's
/// `justify-content: center` (the Matchup bug's top line, Lane 183 review M1).
struct FlowRowTests {
    @Test func aCentredRowStartsHalfItsSlackIn() {
        #expect(FlowRow.inset(row: 200, in: 360, alignment: .center) == 80)
        #expect(FlowRow.inset(row: 200, in: 360, alignment: .leading) == 0)
    }

    @Test func aRowWiderThanTheWidthStartsAtTheEdge() {
        #expect(FlowRow.inset(row: 400, in: 360, alignment: .center) == 0)
    }
}
