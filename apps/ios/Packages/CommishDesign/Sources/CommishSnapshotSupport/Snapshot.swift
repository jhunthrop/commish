import CommishDesign
import CoreGraphics
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// A phone a snapshot is drawn at: its width and its screen's height in points and its own pixel
/// scale, which the persona renders use. The references are drawn at 1x (review M3): small to keep,
/// and still every point. The height sizes what fills a part of the screen (a sheet at a detent).
public struct SnapshotDevice: Sendable, Equatable {
    public let name: String
    public let width: Double
    public let height: Double
    public let scale: Double

    public static let iPhone15 = SnapshotDevice(name: "iPhone15", width: 393, height: 852, scale: 3)
    public static let iPhone17Pro = SnapshotDevice(name: "iPhone17Pro", width: 402, height: 874, scale: 3)
    /// The 6.9-inch class the App Store's large screenshots are sized for (1320 x 2868 at 3x).
    public static let iPhone17ProMax = SnapshotDevice(name: "iPhone17ProMax", width: 440, height: 956, scale: 3)
    public static let iPhoneSE = SnapshotDevice(name: "iPhoneSE", width: 375, height: 667, scale: 2)
    public static let all = [iPhone15, iPhoneSE]
    /// The two phones the screens plan draws every screen at (plan 2026-10-24-mobile-screens).
    public static let screens = [iPhone17Pro, iPhoneSE]
}

/// What a comparison found.
public struct SnapshotResult: Sendable, Equatable {
    public let matches: Bool
    public let message: String
}

/// Each screen's mock is its snapshot: the view drawn at a phone's width in a theme, its whole
/// height, compared with the committed PNG. swift-snapshot-testing needs XCTest, which the Command
/// Line Tools do not carry, so this draws with SwiftUI's ImageRenderer and runs under Swift Testing
/// on any Mac. The references are CI's own: `SNAPSHOT_RECORD=1` writes them (ios.yml's record run
/// uploads them); a missing one is written and fails. `SNAPSHOT_SHOTS=<folder>` also writes each view
/// at its phone's own scale there, for the persona panel, never into git.
public enum Snapshot {
    /// A pixel differs when a channel moves more than this (of 255).
    public static let channelTolerance = 24
    /// The differing pixels a match allows, an absolute count whatever the image's height: room for the
    /// edge pixels a renderer moves between runs, not proof that every glyph matches (one changed digit
    /// at 1x can stay under it). A changed line or layout fails; the Core's tests pin each word and figure.
    public static let maxDifferingPixels = 300
    /// The largest reference a suite may commit, in bytes.
    public static let maxReferenceBytes = 300_000
    /// The references' pixel scale.
    public static let referenceScale: Double = 1

    @MainActor
    public static func render(
        _ view: some View, device: SnapshotDevice, scheme: Scheme, scale: Double = referenceScale
    ) -> CGImage? {
        let theme = Theme(scheme: scheme)
        let framed = view
            .frame(width: device.width)
            .background(theme.color(Tokens.Color.bg).ignoresSafeArea())
            .ignoresSafeArea()
            .environment(\.colorScheme, scheme == .dark ? .dark : .light)
        let renderer = ImageRenderer(content: framed)
        renderer.proposedSize = ProposedViewSize(width: device.width, height: nil)
        renderer.scale = scale
        return renderer.cgImage
    }

    /// Writes `view` at its phone's own scale to SNAPSHOT_SHOTS for the persona panel, when it is set.
    @MainActor
    public static func shoot(_ view: some View, named name: String, device: SnapshotDevice, scheme: Scheme) {
        guard let shots = ProcessInfo.processInfo.environment["SNAPSHOT_SHOTS"],
              let image = render(view, device: device, scheme: scheme, scale: device.scale)
        else {
            return
        }
        _ = write(image, to: URL(fileURLWithPath: shots).appendingPathComponent("\(name).png"))
    }

    /// Renders `view` at 1x and compares it with `<folder>/<name>.png`.
    @MainActor
    public static func verify(
        _ view: some View, named name: String, device: SnapshotDevice, scheme: Scheme, in folder: URL
    ) -> SnapshotResult {
        guard let image = render(view, device: device, scheme: scheme) else {
            return SnapshotResult(matches: false, message: "\(name): the view did not render")
        }
        return verify(image, named: name, in: folder)
    }

    /// Compares `image` with `<folder>/<name>.png`, recording it when asked or when it is missing.
    public static func verify(_ image: CGImage, named name: String, in folder: URL) -> SnapshotResult {
        let reference = folder.appendingPathComponent("\(name).png")
        let record = ProcessInfo.processInfo.environment["SNAPSHOT_RECORD"] == "1"
        guard !record, let committed = load(reference) else {
            let wrote = write(image, to: reference)
            let why = record ? "Recorded" : "No reference, so one was recorded. Run again"
            return SnapshotResult(matches: record && wrote, message: "\(why): \(reference.path)")
        }
        let differing = differingPixels(committed, image)
        guard differing > maxDifferingPixels else {
            return SnapshotResult(matches: true, message: "")
        }
        let failure = folder.appendingPathComponent("__Failures__/\(name).png")
        _ = write(image, to: failure)
        return SnapshotResult(
            matches: false,
            message: "\(name): \(differing) pixels differ (\(maxDifferingPixels) allowed), actual at \(failure.path)"
        )
    }

    /// The references in a folder over the size a suite may commit.
    public static func oversized(in folder: URL) -> [String] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.fileSizeKey]
        )) ?? []
        return files.filter { $0.pathExtension == "png" }.compactMap { file in
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return size > maxReferenceBytes ? "\(file.lastPathComponent): \(size) bytes" : nil
        }
    }

    /// The pixels that differ, every pixel when the sizes differ.
    public static func differingPixels(_ lhs: CGImage, _ rhs: CGImage) -> Int {
        guard lhs.width == rhs.width, lhs.height == rhs.height, let left = rgba(lhs), let right = rgba(rhs) else {
            return max(lhs.width * lhs.height, rhs.width * rhs.height)
        }
        var differing = 0
        for pixel in stride(from: 0, to: left.count, by: 4) {
            for channel in 0 ..< 4
                where abs(Int(left[pixel + channel]) - Int(right[pixel + channel])) > channelTolerance {
                differing += 1
                break
            }
        }
        return differing
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

    /// Writes `image` as an opaque 24-bit PNG (no alpha channel), its folder made as needed.
    public static func write(_ image: CGImage, to url: URL) -> Bool {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let opaque = opaque(image),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else {
            return false
        }
        // Every PNG filter tried per row: the smallest file for text on flat colour.
        let filters = [kCGImagePropertyPNGCompressionFilter: Self.allPNGFilters]
        CGImageDestinationAddImage(destination, opaque, [kCGImagePropertyPNGDictionary: filters] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }

    /// ImageIO's IMAGEIO_PNG_ALL_FILTERS (none, sub, up, average, Paeth), a C macro Swift does not import.
    static let allPNGFilters = 0x08 | 0x10 | 0x20 | 0x40 | 0x80

    /// The image without its alpha channel: a screen is opaque, and three channels keep a quarter less.
    static func opaque(_ image: CGImage) -> CGImage? {
        guard let context = CGContext(
            data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else {
            return nil
        }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return context.makeImage()
    }
}
