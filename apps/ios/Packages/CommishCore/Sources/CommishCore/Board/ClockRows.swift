import CommishAPI
import CommishDesign
import Foundation

/// A ranked view's rows at the order's clock (BoardModel's ViewRows): the rows the order does not place,
/// and the view's sections over them.
enum ClockRows {
    /// The view's rows the order does not place, in the run's order with no figure: those on a
    /// season-long list, those it returns with no figure, and on an uncut answer those it omits (drawn
    /// from the run and counted, Lane 280), each with the order's own row's status word, else the run's.
    static func unplaced(
        _ drawn: [RunBoardRow], statuses: BoardOrder.Statuses, cells: BoardCells, clock: ClockPlaces
    ) -> (rows: [BoardRow], fromRun: Int) {
        let ordered = BoardOrder.withStatuses(drawn, statuses)
        let omitted = Set(LiveOrder.omittedFromRun(ordered.map(\.id), returned: Set(clock.rows.keys), cut: clock.cut))
        let rows = ordered
            .filter { row in
                clock.places[row.id] == nil
                    && (BoardOrder.heldOut(row, statuses) || clock.rows[row.id] != nil || omitted.contains(row.id))
            }
            .map { row in cells.listed(row, said: clock.said(row.id) ?? cells.held(row.id)) }
        return (rows, omitted.count)
    }

    /// A view at the order's clock: the order's rows, then its players on a season-long list, after
    /// them in All and under the list's head in a position's view, as the run's view draws them.
    /// A position's held head sits over the rows on a season-long list alone; the other unplaced rows
    /// follow with no head (Lane 243 fix round 1, M1: a row on no list never sits under it).
    static func sections(_ rows: [BoardRow], listed: [BoardRow], position: BoardPosition?) -> [BoardSection] {
        guard let position else {
            return [BoardSection(id: "all", head: nil, band: nil, rows: rows + listed)]
        }
        let held = listed.filter { $0.status?.onList == true }
        let others = listed.filter { $0.status?.onList != true }
        return [BoardSection(id: position.rawValue, head: nil, band: nil, rows: rows)]
            + (held.isEmpty ? [] : [BoardSection(
                id: "\(position.rawValue)-held", head: Words.Board.heldHead, band: nil, rows: held
            )])
            + (others.isEmpty ? [] : [BoardSection(
                id: "\(position.rawValue)-unplaced", head: nil, band: nil, rows: others
            )])
    }
}
