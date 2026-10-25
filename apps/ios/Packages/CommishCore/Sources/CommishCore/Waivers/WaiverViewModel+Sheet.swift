import Foundation

public extension WaiverViewModel {
    /// The sheet's verb on his row: the platform's page for a stash with no drop, else his row opened
    /// with the advice's drop and the claim pressed, as the web's shelf acts on the pair.
    func claimFromSheet(row key: String, leagueID: String) async {
        guard let row = model?.rows.first(where: { $0.key == key }) else {
            return
        }
        if row.opensPage || openRow != key {
            tap(row: key)
        }
        if !row.opensPage {
            await press(leagueID: leagueID)
        }
    }
}
