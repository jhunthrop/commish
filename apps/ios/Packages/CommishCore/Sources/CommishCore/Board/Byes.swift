import CommishDesign

/// A club's bye as the web says it (web/src/lib/format/bye.ts), ported: a bye ahead of the week a
/// rest-of-season board ranks from prints its week, a bye already played draws nothing (Lane 223, B190),
/// since it costs him no game the board counts. `fromWeek` is nil on a board of the full season, where
/// every bye counts.
public enum Byes {
    /// bye.ts byeAhead: the bye still ahead, nil once played or where the run names none.
    public static func ahead(_ bye: Int?, fromWeek: Int?) -> Int? {
        guard let bye else {
            return nil
        }
        return fromWeek.map { bye < $0 } == true ? nil : bye
    }

    /// bye.ts BYE_WORDS.week: "Bye week 11".
    public static func week(_ week: Int) -> String {
        "Bye week \(week)"
    }

    /// bye.ts byeCell, the narrow Bye column's cell: the week while ahead, nothing once played, the empty
    /// figure where the run names none.
    public static func cell(_ bye: Int?, fromWeek: Int?) -> String {
        guard bye != nil else {
            return Words.Box.none
        }
        return ahead(bye, fromWeek: fromWeek).map(String.init) ?? ""
    }

    /// bye.ts byeLine, a phone row's bye beside his club: "Bye week 11" while ahead, nil once played or
    /// where the run names none.
    public static func line(_ bye: Int?, fromWeek: Int?) -> String? {
        ahead(bye, fromWeek: fromWeek).map(week)
    }

    /// Whether the run names a bye and it is played.
    public static func played(_ bye: Int?, fromWeek: Int?) -> Bool {
        bye != nil && ahead(bye, fromWeek: fromWeek) == nil
    }
}
