import Board
import CommishCore
import CommishDesign
import SwiftUI
import UniformTypeIdentifiers

/// The cheat sheet with its view model: the saved sheet at once, then the account's; a pull reads again;
/// a row's face and name open the player sheet, which keeps him when the sheet reads again under it; a
/// CSV chosen from Files fills the import's paste box; the export handed to the share sheet (the site's
/// print and download); the one verb, a mock draft, pinned above the bar while the sheet has rows and no
/// panel is open.
public struct CheatSheetView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: CheatSheetViewModel
    private let openMock: () -> Void
    @State private var picking = false

    public init(viewModel: CheatSheetViewModel, openMock: @escaping () -> Void) {
        self.viewModel = viewModel
        self.openMock = openMock
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .ready:
                ScrollView {
                    SheetScreen(viewModel: viewModel, open: { sheet.open($0) }, chooseFile: { picking = true })
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await viewModel.load() }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if (viewModel.model?.players ?? 0) > 0, viewModel.importing == .closed {
                        BoardPinView(verb: .mock, press: openMock)
                    }
                }
                .onChange(of: viewModel.model?.lines) { _, lines in
                    sheet.parentRefreshed((lines ?? []).map(\.player))
                }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence).padding(.horizontal, Tokens.Space.s3)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load() }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText]) { picked in
            if case let .success(url) = picked {
                read(url)
            }
        }
        .modifier(ShareExport(viewModel: viewModel))
    }

    /// The chosen file's bytes, read while the Files grant lasts.
    private func read(_ url: URL) {
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted {
                url.stopAccessingSecurityScopedResource()
            }
        }
        if let data = try? Data(contentsOf: url) {
            viewModel.chose(file: data)
        } else {
            viewModel.chose(file: Data([0xFF]))
        }
    }
}

/// The export's file handed to the phone's share sheet once it is written.
private struct ShareExport: ViewModifier {
    let viewModel: CheatSheetViewModel

    private var file: URL? {
        if case let .ready(url) = viewModel.export {
            return url
        }
        return nil
    }

    func body(content: Content) -> some View {
        #if os(iOS)
            content.sheet(
                isPresented: Binding(get: { file != nil }, set: {
                    if !$0 {
                        viewModel.finishExport()
                    }
                })
            ) {
                if let file {
                    ActivityView(items: [file]).ignoresSafeArea()
                }
            }
        #else
            content
        #endif
    }
}

#if os(iOS)
    import UIKit

    /// The system share sheet over the export's file.
    private struct ActivityView: UIViewControllerRepresentable {
        let items: [Any]

        func makeUIViewController(context _: Context) -> UIActivityViewController {
            UIActivityViewController(activityItems: items, applicationActivities: nil)
        }

        func updateUIViewController(_: UIActivityViewController, context _: Context) {}
    }
#endif
