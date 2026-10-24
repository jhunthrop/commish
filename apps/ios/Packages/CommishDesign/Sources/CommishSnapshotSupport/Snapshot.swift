import CommishDesign
import CoreGraphics
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// A phone a snapshot is drawn at: its width in points and its pixel scale.
public struct SnapshotDevice: Sendable, Equatable {
    public let name: String
    public let width: Double
    public let scale: Double

    public static let iPhone15 = SnapshotDevice(name: "iPhone15", width: 393, scale: 3)
    public static let iPhoneSE = SnapshotDevice(name: "iPhoneSE", width: 375, scale: 2)
    public static let all = [iPhone15, iPhoneSE]
}

/// What a comparison found.
public struct SnapshotResult: Sendable, Equatable {
    public let matches: Bool
    public let message: String
}

/// Each screen's mock is its snapshot: the view drawn at a phone's width in a theme, its whole
/// height, compared with the committed PNG. swift-snapshot-testing needs XCTest, which the Command
/// Line Tools do not carry, so this draws with SwiftUI's ImageRenderer and runs under Swift Testing
/// on any Mac. `SNAPSHOT_RECORD=1` writes the references; a missing one is written and fails once.
public enum Snapshot {
    /// A pixel differs when a channel moves more than this (of 255): antialiasing on another macOS.
    public static let channelTolerance = 24
    /// The share of differing pixels a match allows.
    public static let pixelTolerance = 0.01

    @MainActor
    public static func render(_ view: some View, device: SnapshotDevice, scheme: Scheme) -> CGImage? {
        let theme = Theme(scheme: scheme)
        let framed = view
            .frame(width: device.width)
            .background(theme.color(Tokens.Color.bg).ignoresSafeArea())
            .ignoresSafeArea()
            .environment(\.colorScheme, scheme == .dark ? .dark : .light)
        let renderer = ImageRenderer(content: framed)
        renderer.proposedSize = ProposedViewSize(width: device.width, height: nil)
        renderer.scale = device.scale
        return renderer.cgImage
    }

    /// Compares `image` with `<folder>/<name>.png`, recording it when asked or when it is missing.
    public static func verify(_ image: CGImage, named name: String, in folder: URL) -> SnapshotResult {
        let reference = folder.appendingPathComponent("\(name).png")
        let record = ProcessInfo.processInfo.environment["SNAPSHOT_RECORD"] == "1"
        guard !record, let committed = load(reference) else {
            let wrote = write(image, to: reference)
            let why = record ? "Recorded" : "No reference, recorded one; run again"
            return SnapshotResult(matches: record && wrote, message: "\(why): \(reference.path)")
        }
        let share = differingShare(committed, image)
        guard share > pixelTolerance else {
            return SnapshotResult(matches: true, message: "")
        }
        let failure = folder.appendingPathComponent("__Failures__/\(name).png")
        _ = write(image, to: failure)
        let percent = String(format: "%.2f", share * 100)
        return SnapshotResult(
            matches: false,
            message: "\(name): \(percent)% of pixels differ, actual at \(failure.path)"
        )
    }

    /// The share of pixels that differ, 1 when the sizes differ.
    public static func differingShare(_ lhs: CGImage, _ rhs: CGImage) -> Double {
        guard lhs.width == rhs.width, lhs.height == rhs.height, let left = rgba(lhs), let right = rgba(rhs) else {
            return 1
        }
        var differing = 0
        for pixel in stride(from: 0, to: left.count, by: 4) {
            for channel in 0 ..< 4
                where abs(Int(left[pixel + channel]) - Int(right[pixel + channel])) > channelTolerance {
                differing += 1
                break
            }
        }
        return Double(differing) / Double(lhs.width * lhs.height)
    }

    static func rgba(_ image: CGImage) -> [UInt8]? {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else {
                return false
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        return drawn ? bytes : nil
    }

    static func load(_ url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            return nil
        }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    static func write(_ image: CGImage, to url: URL) -> Bool {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else {
            return false
        }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination)
    }
}
