/// The open editor's note: the text in the field and the text it last matched the row on. The editor
/// writes only what the member typed, so a note that changed elsewhere (a refresh, a merge, an import) is
/// never overwritten by a stale copy.
struct NoteDraft: Equatable {
    private(set) var text: String
    private var synced: String

    init(rowNote: String?) {
        text = rowNote ?? ""
        synced = rowNote ?? ""
    }

    /// The row's note arrived. An unfocused field follows it; a field being typed in keeps the typing.
    mutating func follow(rowNote: String?, focused: Bool) {
        guard !focused else { return }
        text = rowNote ?? ""
        synced = text
    }

    mutating func type(_ typed: String) {
        text = typed
    }

    /// The text to write on blur or disappear: only a note the member changed, and only once.
    mutating func takeWrite() -> String? {
        guard text != synced else { return nil }
        synced = text
        return text
    }
}
