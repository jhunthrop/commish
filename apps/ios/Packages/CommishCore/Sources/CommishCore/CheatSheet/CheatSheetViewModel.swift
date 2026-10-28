import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The cheat sheet's view model (web/src/lib/sheet/store.svelte.ts and sync.ts, for a phone that keeps
/// nothing of its own): the API, the cache, the run and the clock injected; the account's most recently
/// changed sheet, the saved answer at once and then the API's; a note, a tag or a row taken off is an
/// edit held on the phone and written with every row in one request guarded by the sheet's stamp. An
/// edit never says saved before the account answers: while it is on its way its row says so, and when
/// the request fails (no signal, the sheet changed on another device) its row says it is not saved and
/// why, and a retry reads the sheet again and writes the edit over it field by field (merge.ts): a field
/// another device changed and the phone did not keeps the account's value, and a field both changed keeps
/// the account's with the row saying what the phone had.
@MainActor
@Observable
public final class CheatSheetViewModel {
    public enum Phase: Equatable, Sendable {
        case loading
        case ready
        case failed(String)
    }

    public private(set) var phase: Phase = .loading
    /// When the sheet shown was read, and whether it is a saved copy because the latest read failed.
    public internal(set) var stamp: Date?
    public internal(set) var stale = false
    public internal(set) var save: SheetSave = .idle
    /// The position the rows narrow to, nil for all.
    public private(set) var position: String?
    /// The row whose editor is open.
    public private(set) var openRow: String?
    /// The empty sheet's board, the import panel and the export.
    public internal(set) var board: SheetBoard = .loading
    public internal(set) var starting = false
    public internal(set) var startProblem: String?
    public internal(set) var importing: SheetImport = .closed
    /// The import's paste box: a CSV typed or pasted, or the file chosen, read.
    public var pasted = ""
    public internal(set) var export: SheetExport = .idle

    /// The account's sheet as last read or written, nil when the account has none.
    var detail: SheetDetail?
    /// The edits not yet saved, by player id, and the ones the write on its way carries.
    var edits: [String: SheetEdit] = [:]
    private var sending: [String: SheetEdit] = [:]
    /// By player id, what the phone had where the account's copy won a conflict.
    var notices: [String: [String]] = [:]

    let api: any SheetsAPI
    let run: any RunAPI
    let cache: any AnswerCache
    let clock: any Clock
    let zone: TimeZone
    /// The format an empty sheet starts in: the selected league's, else the account's.
    let format: Components.Schemas.BoardFormatKnown
    /// Where an export's file is written before the share sheet takes it.
    let exports: URL
    private let onSignedOut: @MainActor () -> Void

    public init(
        api: any SheetsAPI, run: any RunAPI, cache: any AnswerCache, clock: any Clock,
        format: Components.Schemas.BoardFormatKnown, zone: TimeZone = .current,
        exports: URL = FileManager.default.temporaryDirectory.appendingPathComponent("sheet-exports"),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.run = run
        self.cache = cache
        self.clock = clock
        self.format = format
        self.zone = zone
        self.exports = exports
        self.onSignedOut = onSignedOut
    }

    /// The cache key of the sheet the phone opens.
    public static let route = "/sheets/open"

    /// What the cache keeps: the sheet, or none when the account has none.
    struct Saved: Codable, Sendable {
        let detail: SheetDetail?
    }

    // MARK: what the screen draws

    /// The rows as the account holds them with the phone's unsaved edits laid over them.
    var entries: [SheetEntry] {
        (detail?.value2.rows ?? []).compactMap { row in
            let entry = SheetEntry(row)
            return edits[entry.id].map { $0.over(entry) } ?? entry
        }
    }

    /// The sheet as the screen draws it; nil while the account has no sheet.
    public var model: SheetModel? {
        guard let detail else {
            return nil
        }
        let entries = entries
        let status = SheetWords.status(
            save, changedAt: detail.value1.updatedAt, answeredAt: stamp ?? clock.now, players: entries.count,
            zone: zone
        )
        let line = SheetWords.headLine(format: formatLabel, players: entries.count, status: status)
        return SheetModel(
            name: detail.value1.name, line: line, entries: entries, saves: rowSaves, position: position,
            notices: notices
        )
    }

    /// The sheet's format chip: its own, else the one an empty sheet starts in.
    public var formatLabel: String {
        guard let format = detail?.value1.format else {
            return SheetWords.formatLabel(format)
        }
        return format.value1.map(SheetWords.formatLabel) ?? format.value2 ?? ""
    }

    /// Each unsaved row's state: on its way, or not saved with the reason.
    private var rowSaves: [String: RowSave] {
        edits.mapValues { _ in
            if case let .failed(reason, _) = save {
                return RowSave.unsaved(reason)
            }
            return .saving
        }
    }

    /// "Last read Sat 12:00 pm" while the sheet shown is a saved copy.
    public var stampWords: String? {
        guard stale, let stamp else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// Whether a write is held: an edit not yet on the account, which an export would leave out.
    public var unsaved: Bool {
        !edits.isEmpty
    }

    // MARK: reads

    /// The saved sheet at once on the first open, then the account's most recently changed; a failed read
    /// keeps the sheet shown, dated; a refused token signs out. An empty account reads our board for the
    /// empty sheet's preview.
    public func load() async {
        if phase == .loading, let saved = await cache.read(Saved.self, route: Self.route) {
            show(saved.value.detail, stamp: saved.stamp, stale: true)
        }
        do {
            var fresh: SheetDetail?
            if let latest = try await api.sheets().first {
                fresh = try await api.sheet(id: latest.id)
            }
            // A write on its way answers with the account's sheet itself; the read is left to it, so its
            // edits are not held against rows it is about to replace and sent a second time.
            guard save != .saving else {
                return
            }
            merge(into: fresh)
            // Every unsaved edit already on the account (or its row taken off there): nothing is left
            // unsaved, so the head stops saying so.
            if edits.isEmpty, case .failed = save {
                save = .idle
            }
            show(fresh, stamp: clock.now, stale: false)
            await keep()
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            if phase == .ready {
                stale = true
            } else {
                phase = .failed(Self.reason(error))
            }
        }
        if detail == nil {
            await readBoard()
        }
    }

    func show(_ detail: SheetDetail?, stamp: Date, stale: Bool) {
        self.detail = detail
        self.stamp = stamp
        self.stale = stale
        phase = .ready
    }

    /// The sheet as last read or written, kept for the next open.
    func keep() async {
        if let stamp {
            await cache.write(Saved(detail: detail), route: Self.route, stamp: stamp)
        }
    }

    // MARK: choices

    public func choose(position: String?) {
        self.position = position
    }

    /// A row's editor opened, or closed when it is the one open.
    public func toggle(row id: String) {
        openRow = openRow == id ? nil : id
    }

    // MARK: edits

    /// His note set, or cleared when empty (model.ts setNote); nothing when it reads the same.
    public func setNote(_ id: String, _ text: String) async {
        guard let entry = entries.first(where: { $0.id == id }) else {
            return
        }
        let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(SheetLimits.note))
        let note = trimmed.isEmpty ? nil : trimmed
        guard note != entry.note else {
            return
        }
        await annotate(entry, tags: entry.tags, note: note)
    }

    /// A tap on one of his tags; false when his row is full and the tag cannot go on.
    @discardableResult
    public func toggleTag(_ id: String, _ tag: String) async -> Bool {
        guard let entry = entries.first(where: { $0.id == id }) else {
            return true
        }
        guard let tags = SheetTags.toggled(entry.tags, tag) else {
            return false
        }
        await annotate(entry, tags: tags, note: entry.note)
        return true
    }

    /// His own tag typed and added: why it cannot be, or nil once it is on (RowEditor.svelte addOwn).
    public func addTag(_ id: String, _ typed: String) async -> String? {
        let tag = SheetTags.canonical(typed)
        if let problem = SheetTags.problem(tag) {
            return problem
        }
        guard let entry = entries.first(where: { $0.id == id }), !SheetTags.has(entry.tags, tag) else {
            return nil
        }
        return await toggleTag(id, tag) ? nil : SheetWords.full
    }

    /// His row taken off the sheet.
    public func remove(_ id: String) async {
        openRow = nil
        guard let account = accountRow(id) else {
            return
        }
        notices[id] = nil
        edits[id] = SheetEdit(base: edits[id]?.base ?? account, local: nil)
        await write()
    }

    /// His tags and note as set, held against the account's row the first unsaved edit was made over.
    private func annotate(_ entry: SheetEntry, tags: [String], note: String?) async {
        guard let account = accountRow(entry.id) else {
            return
        }
        notices[entry.id] = nil
        let local = entry.with(tags: tags, note: note)
        let same = account.tags == tags && account.note == note
        edits[entry.id] = same ? nil : SheetEdit(base: edits[entry.id]?.base ?? account, local: local)
        await write()
    }

    /// His row as the account holds it.
    func accountRow(_ id: String) -> SheetEntry? {
        detail?.value2.rows.first { $0.playerId == id }.map(SheetEntry.init)
    }

    /// The unsaved edits laid over a sheet read afresh (merge.ts mergeRow): a row taken off on the account
    /// stays off; a row the phone took off stays off; each field the phone changed keeps the phone's value
    /// unless the account's changed too, when the account's stands and the row says what the phone had.
    /// Each edit is then held against the fresh row.
    func merge(into fresh: SheetDetail?) {
        let rows = Dictionary(
            (fresh?.value2.rows ?? []).map { ($0.playerId, SheetEntry($0)) }, uniquingKeysWith: { first, _ in first }
        )
        var next: [String: SheetEdit] = [:]
        for (id, edit) in edits {
            guard let server = rows[id] else {
                continue
            }
            guard let local = edit.local else {
                next[id] = SheetEdit(base: server, local: nil)
                continue
            }
            let merged = SheetMerge.row(base: edit.base, local: local, server: server)
            if !merged.notices.isEmpty {
                notices[id] = merged.notices
            }
            if merged.entry.tags != server.tags || merged.entry.note != server.note {
                next[id] = SheetEdit(base: server, local: merged.entry)
            }
        }
        edits = next
    }

    /// Every row written in one request guarded by the sheet's stamp; an edit made while it is on its way
    /// is written after it.
    func write() async {
        guard let detail, !edits.isEmpty, save != .saving else {
            return
        }
        sending = edits
        save = .saving
        do {
            let fresh = try await api.replaceRows(
                id: detail.value1.id, rows: entries.map(\.input), ifUpdatedAt: detail.value1.updatedAt
            )
            // An edit made while the write was on its way is held against the rows just written.
            let written = Dictionary(
                fresh.value2.rows.map { ($0.playerId, SheetEntry($0)) }, uniquingKeysWith: { first, _ in first }
            )
            edits = edits.filter { sending[$0.key] != $0.value }.reduce(into: [:]) { held, pair in
                held[pair.key] = written[pair.key].map { SheetEdit(base: $0, local: pair.value.local) }
            }
            sending = [:]
            show(fresh, stamp: clock.now, stale: false)
            save = .saved
            await keep()
            await write()
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            sending = [:]
            save = .failed(reason: Self.reason(error), changed: Self.changed(error))
        }
    }

    /// The unsaved edits written again over the account's sheet read afresh: it may have changed on
    /// another device while the edit waited, signal or not, so the edits are merged into it field by field
    /// before they are written.
    public func retry() async {
        guard case let .failed(_, changed) = save, let id = detail?.value1.id else {
            return
        }
        do {
            let fresh = try await api.sheet(id: id)
            merge(into: fresh)
            show(fresh, stamp: clock.now, stale: false)
            await keep()
        } catch where APIError.signsOut(error) {
            signedOut()
            return
        } catch {
            save = .failed(reason: Self.reason(error), changed: changed)
            return
        }
        save = .idle
        await write()
    }

    // MARK: failures

    func signedOut() {
        phase = .failed(AppWords.Failure.signedOut)
        onSignedOut()
    }

    /// A failure in words: the API's own sentence, no connection, else try again.
    static func reason(_ error: any Error) -> String {
        switch error {
        case _ where APIError.signsOut(error):
            AppWords.Failure.signedOut
        case let APIError.envelope(_, message) where !message.isEmpty:
            message
        case is URLError:
            SheetWords.offline
        default:
            SheetWords.unknown
        }
    }

    /// The account refused a guarded write: the sheet changed since it was read.
    static func changed(_ error: any Error) -> Bool {
        if case APIError.envelope(code: "conflict", _) = error {
            return true
        }
        return false
    }
}
