@testable import Sheet
import Testing

struct NoteDraftTests {
    @Test("a note changed elsewhere is shown and never written back on close")
    func refreshedNoteIsNotOverwritten() {
        var draft = NoteDraft(rowNote: "old")
        draft.follow(rowNote: "account's", focused: false)
        #expect(draft.text == "account's")
        #expect(draft.takeWrite() == nil)
    }

    @Test("a focused field keeps the member's typing and writes it once")
    func typingIsWrittenOnce() {
        var draft = NoteDraft(rowNote: "old")
        draft.type("mine")
        draft.follow(rowNote: "account's", focused: true)
        #expect(draft.text == "mine")
        #expect(draft.takeWrite() == "mine")
        #expect(draft.takeWrite() == nil)
    }

    @Test("an untouched focused field does not write a stale note")
    func untouchedFocusedFieldWritesNothing() {
        var draft = NoteDraft(rowNote: "old")
        draft.follow(rowNote: "account's", focused: true)
        #expect(draft.takeWrite() == nil)
    }

    @Test("blur with nothing typed re-syncs to the row's current note and writes nothing")
    func blurResyncsUntouchedField() {
        var draft = NoteDraft(rowNote: "old")
        draft.follow(rowNote: "account's", focused: true)
        #expect(draft.text == "old")
        #expect(draft.blur(rowNote: "account's") == nil)
        #expect(draft.text == "account's")
        #expect(draft.takeWrite() == nil)
    }

    @Test("blur after typing returns the typed note")
    func blurWritesTyping() {
        var draft = NoteDraft(rowNote: "old")
        draft.type("mine")
        #expect(draft.blur(rowNote: "account's") == "mine")
    }

    @Test("a row with no note opens empty and writes nothing")
    func noNote() {
        var draft = NoteDraft(rowNote: nil)
        #expect(draft.text.isEmpty)
        #expect(draft.takeWrite() == nil)
    }
}
