import CommishAPI
import Foundation

/// The position panel's controls (PositionPanel.svelte): the toggle, a card opened or closed, and a free
/// agent's Add, the screen's one verb on the add with the advice's drop.
public extension WaiverViewModel {
    /// The panel's cards in the toggle's figures, none before an answer or from one without the panel.
    var panel: [PanelCard] {
        model?.panel(panelMode) ?? []
    }

    /// The card whose list is open, if any.
    var openedCard: PanelCard? {
        panel.first { $0.key == openCard }
    }

    /// Whether the toggle is drawn: the answer reads this week's figures.
    var panelHasWeek: Bool {
        model?.panelHasWeek ?? false
    }

    /// The toggle: the panel's figures for the rest of the season or this week.
    func choose(panelMode mode: PanelMode) {
        panelMode = mode
    }

    /// A card tapped: its list opened under the row, or closed when it was the one open.
    func toggle(card key: String) {
        openCard = openCard == key ? nil : key
    }

    /// A free agent's Add on the panel (WaiverScreen.svelte addFromPanel): the add with the advice's drop,
    /// through the screen's one verb (the claim planned here, else the platform's page with his name).
    func addFromPanel(_ source: WaiverRow, leagueID: String) async {
        guard let model else {
            return
        }
        openRow = nil
        await act(on: model.panelPair(source), leagueID: leagueID)
    }
}
