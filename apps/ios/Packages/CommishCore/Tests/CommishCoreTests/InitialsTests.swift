@testable import CommishCore
import Testing

struct InitialsTests {
    @Test(arguments: [
        ("Ja'Marr Chase", "JC"), ("Kyle Juszczyk Jr.", "KJ"), ("Muttdogs", "MU"),
        ("Keeper? I Hardly Know Her", "KH"), ("", ""),
    ])
    func initialsAreTheWebs(name: String, letters: String) {
        #expect(Initials.of(name) == letters)
    }
}
