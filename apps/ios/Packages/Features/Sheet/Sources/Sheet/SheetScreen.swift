import Board
import CommishCore
import CommishDesign
import SwiftUI

/// The sheet top to bottom as the web's page draws it at 390 (SheetPage.svelte): the name in the number
/// face with its format, count and save, the tools, the import panel when open, the empty sheet or the
/// position chips over the rows, each row's editor under it when open. `live` draws fields that type and
/// chips that scroll; a snapshot draws them still.
struct SheetScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let viewModel: CheatSheetViewModel
    let open: (SheetPlayer) -> Void
    let chooseFile: () -> Void
    var live = true
    /// The rows a snapshot draws, all of them on the screen.
    var rows: Int?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            head(theme).padding(.horizontal, Tokens.Space.s3)
            if viewModel.importing != .closed {
                SheetImportView(viewModel: viewModel, chooseFile: chooseFile, live: live)
                    .padding(.horizontal, Tokens.Space.s3)
            }
            if let model = viewModel.model, model.players > 0 {
                rowsView(model, theme: theme)
            } else if viewModel.importing == .closed {
                SheetEmptyView(viewModel: viewModel).padding(.horizontal, Tokens.Space.s3)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    private func head(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(viewModel.model?.name ?? SheetWords.defaultName)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .lineLimit(2)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Text(viewModel.model?.line ?? viewModel.formatLabel)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            if let stamp = viewModel.stampWords {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            tools(theme)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Import and the export, once the sheet has rows (SheetPage.svelte sheetTools); the export's state
    /// beside it.
    @ViewBuilder
    private func tools(_ theme: Theme) -> some View {
        if viewModel.model.map({ $0.players > 0 }) == true {
            HStack(spacing: Tokens.Space.s4) {
                // Not while a row's write is on its way, whose answer would land over the imported rows.
                QuietButton(SheetWords.importTool) { viewModel.openImport() }
                    .disabled(viewModel.save == .saving)
                    .opacity(viewModel.save == .saving ? 0.5 : 1)
                QuietButton(SheetWords.exportTool) { Task { await viewModel.exportFile() } }
                    .disabled(viewModel.unsaved)
                    .opacity(viewModel.unsaved ? 0.5 : 1)
                if viewModel.export == .writing {
                    ProgressView().controlSize(.small)
                }
            }
            if case let .failed(reason) = viewModel.export {
                Text(reason)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
            }
        }
    }

    private func rowsView(_ model: SheetModel, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            ChipRow(chips: model.positions, choose: { viewModel.choose(position: $0) }, live: live)
            if let shown = model.shown {
                Text(shown)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .padding(.horizontal, Tokens.Space.s3)
            }
            list(model)
        }
    }

    @ViewBuilder
    private func list(_ model: SheetModel) -> some View {
        let lines = rows.map { Array(model.lines.prefix($0)) } ?? model.lines
        let content = ForEach(lines) { line in
            SheetRowView(line: line, open: viewModel.openRow == line.id, actions: rowActions)
            if viewModel.openRow == line.id {
                SheetEditorView(line: line, ownTags: model.ownTags, actions: rowActions, live: live)
            }
        }
        if live {
            LazyVStack(spacing: 0) { content }
        } else {
            VStack(spacing: 0) { content }
        }
    }

    private var rowActions: SheetRowActions {
        let viewModel = viewModel
        return SheetRowActions(
            open: open,
            toggle: { viewModel.toggle(row: $0) },
            note: { id, text in Task { await viewModel.setNote(id, text) } },
            tag: { id, tag in await viewModel.toggleTag(id, tag) },
            addTag: { id, typed in await viewModel.addTag(id, typed) },
            remove: { id in Task { await viewModel.remove(id) } },
            retry: { Task { await viewModel.retry() } }
        )
    }
}

/// A sheet with no one on it (EmptySheet.svelte): our board's first players with their faces, so the
/// verb shows what it does before it is pressed, then Start from our board, or Import a sheet where we
/// have no board for the format.
struct SheetEmptyView: View {
    @Environment(\.colorScheme) private var colorScheme
    let viewModel: CheatSheetViewModel

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Text(SheetWords.startHead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Text(lead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            VStack(spacing: 0) {
                ForEach(viewModel.preview) { line in
                    SheetRowView(line: line, open: false, actions: .none, editable: false).allowsHitTesting(false)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            if viewModel.board == .loading {
                ProgressView().frame(maxWidth: .infinity)
            }
            verbs
            if let problem = viewModel.startProblem {
                Text(problem)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
            }
        }
        .padding(Tokens.Space.s3)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
    }

    private var lead: String {
        switch viewModel.board {
        case .none: SheetWords.boardNone(viewModel.formatLabel)
        case .failed: SheetWords.boardFailed
        case .loading, .ready: SheetWords.boardLead(viewModel.formatLabel)
        }
    }

    @ViewBuilder
    private var verbs: some View {
        if viewModel.board == .none {
            Verb(SheetWords.importSheet) { viewModel.openImport() }
        } else {
            Verb(SheetWords.start, enabled: !viewModel.starting && viewModel.board != .loading) {
                Task { await viewModel.start() }
            }
            QuietButton(SheetWords.importSheet) { viewModel.openImport() }
                .frame(maxWidth: .infinity)
        }
    }
}

/// The import panel (ImportPanel.svelte): a CSV file, or a CSV or a list of names pasted, what was refused,
/// what the import read and skipped by line, the verb that replaces the sheet and Cancel.
struct SheetImportView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Bindable var viewModel: CheatSheetViewModel
    let chooseFile: () -> Void
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Text(SheetWords.importHead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if case let .done(words) = viewModel.importing {
                result(words, theme: theme)
                Verb(SheetWords.done) { viewModel.finishImport() }
            } else {
                sources(theme)
                if case let .open(problem?) = viewModel.importing {
                    Text(problem)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(theme.color(Tokens.Color.lossInk))
                        .accessibilityAddTraits(.isStaticText)
                }
                actions
            }
        }
        .padding(Tokens.Space.s3)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
    }

    private var typed: String {
        viewModel.pasted
    }

    @ViewBuilder
    private func sources(_ theme: Theme) -> some View {
        label(SheetWords.fileLabel, theme: theme)
        QuietButton(SheetWords.chooseFile, action: chooseFile)
        label(SheetWords.pasteLabel, theme: theme)
        Group {
            if live {
                TextField(SheetWords.pastePlaceholder, text: $viewModel.pasted, axis: .vertical)
                    .lineLimit(4 ... 8)
                    .autocorrectionDisabled()
            } else {
                Text(typed.isEmpty ? SheetWords.pastePlaceholder : typed)
                    .lineLimit(4 ... 8)
                    .foregroundStyle(theme.color(typed.isEmpty ? Tokens.Color.ink3 : Tokens.Color.ink))
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
        .font(.system(size: Tokens.TypeScale.sm, design: .monospaced))
        .modifier(FieldFrame(theme: theme))
    }

    private func label(_ words: String, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }

    private var actions: some View {
        HStack(spacing: Tokens.Space.s3) {
            let sending = viewModel.importing == .sending
            Verb(viewModel.importVerb, enabled: !sending && !typed.trimmingCharacters(in: .whitespaces).isEmpty) {
                Task { await viewModel.importText(typed) }
            }
            QuietButton(SheetWords.cancel) { viewModel.closeImport() }
        }
    }

    private func result(_ words: SheetImportWords, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(words.read)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            if let kept = words.kept {
                Text(kept)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
            }
            if let shape = words.shape {
                Text(shape)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .regular))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            if let skipped = words.skipped {
                label(skipped, theme: theme)
                ForEach(words.lines, id: \.self) { line in
                    Text(line)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .regular))
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
