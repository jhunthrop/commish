import Board
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import RunFixtures
@testable import Sheet
import SwiftUI
import Testing

/// The Sheet's mock: the fixture sheet (shared/fixtures/parity/sheet.json) through the view model over a
/// stub account at the fixture's clock, both themes, iPhone 17 Pro and iPhone SE, at 1x. The sheet with
/// its rows and the mock verb pinned; a row open in its editor (his note, his tags pressed, his own tag's
/// field); a note edited with no signal, its row not saved with the reason and the retry, the head saying
/// the same; the empty sheet over the stand-in's PPR board; the import with a CSV pasted; and the import
/// refused with the API's sentence. A face draws its initials here (a snapshot loads no image). With
/// SNAPSHOT_SHOTS set each is also written at its phone's own scale for the persona panel.
@MainActor
struct SheetSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!

    enum Scene: String, CaseIterable, Sendable {
        case rows
        case edited
        case unsaved
        case empty
        case importing = "import"
        case refused
    }

    struct Case: Sendable {
        let scene: Scene
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { Case(scene: scene, scheme: scheme, device: $0) }
        }
    }

    /// The first lines of the fixture's CSV, as pasted.
    static func pasted() throws -> String {
        try SheetParity.load().csv.split(separator: "\n").prefix(4).joined(separator: "\n")
    }

    static func viewModel(_ scene: Scene) async throws -> CheatSheetViewModel {
        let stub = try SheetStub(scene == .empty ? nil : sheetDetail(parityRows()))
        let viewModel = CheatSheetViewModel(
            api: stub, run: StubRun(.standIn),
            cache: FileCache(folder: FileManager.default.temporaryDirectory
                .appendingPathComponent("sheet-snapshots-\(UUID().uuidString)")),
            clock: FixedClock(SheetClock.now), format: .ppr, zone: zone
        )
        await viewModel.load()
        switch scene {
        case .rows, .empty:
            break
        case .edited:
            viewModel.toggle(row: "4430807")
        case .unsaved:
            await stub.set(offline: true)
            await viewModel.setNote("4431299", "Two lines.\nTarget in round three")
        case .importing:
            viewModel.openImport()
            viewModel.pasted = try pasted()
        case .refused:
            viewModel.openImport()
            viewModel.pasted = "name,team\nJa'Marr Chase,CIN"
            await stub.set(
                importAnswer: nil,
                refusal: .envelope(
                    code: "invalid",
                    message: "The first line must name rank, player_id, name and position"
                )
            )
            await viewModel.importCSV(viewModel.pasted)
        }
        return viewModel
    }

    @Test(arguments: 0 ..< cases.count)
    func sheet(index: Int) async throws {
        let item = Self.cases[index]
        let name = "sheet-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await SheetMock(viewModel: Self.viewModel(item.scene), device: item.device)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theScenesAreTheStatesTheyName() async throws {
        let unsaved = try await Self.viewModel(.unsaved)
        #expect(unsaved.model?.lines[2].save == .unsaved(SheetWords.offline))
        let refused = try await Self.viewModel(.refused)
        #expect(refused.importing == .open(problem: "The first line must name rank, player_id, name and position"))
        let empty = try await Self.viewModel(.empty)
        #expect(empty.preview.count == 5)
        #expect(empty.model == nil)
    }
}

/// The screen as the phone's first screen draws it: the room between the top bar and the tab bar, the
/// sheet's top with the verb pinned over its foot where the sheet has rows and no panel is open.
struct SheetMock: View {
    let viewModel: CheatSheetViewModel
    let device: SnapshotDevice

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    private var pinned: Bool {
        (viewModel.model?.players ?? 0) > 0 && viewModel.importing == .closed
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetScreen(viewModel: viewModel, open: { _ in }, chooseFile: {}, live: false)
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: room - (pinned ? 64 : 0), alignment: .top)
                .clipped()
            if pinned {
                BoardPinView(verb: .mock) {}
            }
        }
        .frame(height: room, alignment: .top)
    }
}
