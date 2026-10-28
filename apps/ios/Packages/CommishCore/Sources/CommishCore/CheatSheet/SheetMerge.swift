import Foundation

/// A row edited on the phone and the account's copy of it become one row (a port of web/src/lib/sheet
/// merge.ts mergeRow for the fields a phone edits): each field, his note and his tags, against the row the
/// edit was made over. A field changed on one side only takes that side's value. Changed on both sides to
/// different values, the account's copy stands and the row says what the phone had, in the web's words.
/// The phone never writes its whole row over the account's.
enum SheetMerge {
    /// The value that stands for one field, and whether the phone's value lost a conflict (merge.ts pick).
    static func pick<T: Equatable>(_ base: T, _ local: T, _ server: T) -> (value: T, overruled: Bool) {
        let localMoved = local != base
        let serverMoved = server != base
        if localMoved, !serverMoved {
            return (local, false)
        }
        return (server, localMoved && serverMoved && local != server)
    }

    /// The account's row with the phone's edit laid over it field by field, and a line for each field the
    /// account's copy won.
    static func row(base: SheetEntry, local: SheetEntry, server: SheetEntry) -> (entry: SheetEntry, notices: [String]) {
        let note = pick(base.note, local.note, server.note)
        let tags = pick(base.tags, local.tags, server.tags)
        let notices = [
            note.overruled ? SheetWords.noteReplaced(local.name) : nil,
            tags.overruled ? SheetWords.tagsReplaced(local.name) : nil,
        ].compactMap(\.self)
        return (server.with(tags: tags.value, note: note.value), notices)
    }
}
