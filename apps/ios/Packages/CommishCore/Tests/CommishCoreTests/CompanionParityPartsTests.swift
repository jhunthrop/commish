import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The parts the web draws at 390 beyond the room's call and pool: the wall at every moment, the
/// shortlist with our why's first sentence and the outcome ranges, and the League home's draft-day
/// entry (shared/fixtures/parity/companion.json).
@MainActor
extension CompanionParityTests {
    @Test(arguments: roomMoments)
    func theWallIsTheWebs(moment: CompanionFixture.Moment) async throws {
        let (_, model) = try await Self.room(through: moment)
        let wall = try #require(Self.web(moment)["wall"] as? JSON)
        #expect(model.wall.title == wall["title"] as? String)
        #expect(model.wall.label == wall["label"] as? String)
        #expect(model.wall.names == wall["names"] as? [String])
        #expect(model.wall.you == wall["you"] as? Int)
        let rows = wall["rows"] as? [[JSON]] ?? []
        #expect(model.wall.rows.count == rows.count)
        for (ours, theirs) in zip(model.wall.rows, rows) {
            #expect(ours.map(\.id) == theirs.map { $0["pick"] as? Int ?? 0 })
            #expect(ours.map { $0.player?.id } == theirs.map { $0["id"] as? String })
            #expect(ours.map(\.name) == theirs.map { $0["name"] as? String })
            #expect(ours.map(\.line) == theirs.map { $0["line"] as? String })
            #expect(ours.map(\.mine) == theirs.map { $0["mine"] as? Bool ?? false })
            #expect(ours.map { $0.now?.words } == theirs.map { ($0["now"] as? JSON)?["words"] as? String })
            #expect(ours.map { $0.now?.pick } == theirs.map { ($0["now"] as? JSON)?["pick"] as? String })
        }
    }

    @Test func ourWhysFirstSentenceIsTheWebs() throws {
        let web = try #require((Self.parity["edges"] as? JSON)?["whys"] as? [JSON])
        for why in web {
            let text = try #require(why["text"] as? String)
            #expect(Sentence.first(text) == why["first"] as? String, "\(text)")
        }
    }

    @Test func theShortlistWithOurWhyIsTheWebs() throws {
        let web = try #require(Self.parity["shortlistWhy"] as? [JSON])
        let whys = try #require((Self.parity["edges"] as? JSON)?["whys"] as? [JSON])
            .compactMap { $0["text"] as? String }
        let first = try CompanionFixture.answer(.waiting)
        let board = try RoomBoardView(#require(first.board?.value1), teams: first.teams)
        let turn = try CompanionFixture.answer(.turn)
        var card = try #require(turn.card?.value1)
        card.shortlist = card.shortlist.enumerated().map { index, entry in
            var entry = entry
            entry.why = whys[index % whys.count]
            return entry
        }
        let ours = CompanionModel.shortlist(
            card, board: board, teams: turn.teams, ranges: turn.ranges?.additionalProperties ?? [:]
        )
        Self.expectShortlist(ours, web)
    }

    @Test func theLeagueHomesDraftDayEntryIsTheWebs() throws {
        let web = try #require(Self.parity["draftDay"] as? JSON)
        let now = try #require(APIDecoding.parseDate(web["now"] as? String ?? ""))
        for (key, zone) in [("chicago", "America/Chicago"), ("newYork", "America/New_York")] {
            let lines = try #require(web[key] as? JSON)
            let zone = try #require(TimeZone(identifier: zone))
            func line(_ iso: String?) -> String {
                DraftDayEntry.draftLine(iso.flatMap(APIDecoding.parseDate), now: now, zone: zone)
            }
            #expect(line(nil) == lines["unset"] as? String)
            #expect(line("2026-09-06T14:00:00Z") == lines["onNow"] as? String)
            #expect(line("2026-09-06T23:00:00Z") == lines["today"] as? String)
            #expect(line("2026-09-07T23:30:00Z") == lines["tomorrow"] as? String)
            #expect(line("2026-09-10T00:00:00Z") == lines["later"] as? String)
            #expect(DraftDayEntry.zoneLine(zone) == lines["zone"] as? String)
            let entry = try #require(DraftDayEntry(phase: .draftDay, draftAt: nil, now: now, zone: zone))
            #expect(entry.verb == web["verb"] as? String)
            let turns = try #require(web["turns"] as? String)
            #expect(entry.line == ([turns] + [lines["zone"] as? String].compactMap(\.self)).joined(separator: " "))
        }
        // Before the draft the entry carries the mock draft instead (Lane 213).
        #expect(DraftDayEntry(phase: .preDraft, draftAt: nil, now: now, zone: .current)?.opens == .mock)
        #expect(DraftDayEntry(phase: .inSeason, draftAt: nil, now: now, zone: .current) == nil)
    }
}
