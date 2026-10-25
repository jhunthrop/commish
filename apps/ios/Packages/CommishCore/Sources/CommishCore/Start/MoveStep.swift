import CommishAPI
import CommishDesign
import Foundation

/// Where the move's confirmation is (move.ts MoveStep): reading the lineup on the platform, the move
/// in the API's words to confirm with its token, on its way, what it came to, unavailable here (the
/// platform's page), or failed (the API's sentence, or ours when no answer came).
public enum MoveStep: Equatable, Sendable {
    case closed
    case planning
    case confirm(sentence: String, token: String)
    case sending(sentence: String)
    case answered(HostMoveResult)
    case unavailable(sentence: String, page: URL?)
    case failed(sentence: String, page: URL?)

    /// move.ts planStep: the move to confirm, or the platform's page when the API cannot make it.
    static func planned(_ plan: HostMovePlan) -> MoveStep {
        if plan.status.value1 == .ready, let token = plan.confirm {
            return .confirm(sentence: plan.sentence, token: token)
        }
        return .unavailable(sentence: plan.sentence, page: URL(string: plan.hostUrl))
    }

    /// move.ts resultStep: what the move came to, or the platform's page when it was unavailable.
    static func made(_ result: HostMoveResult) -> MoveStep {
        if result.outcome.value1 == .unavailable {
            return .unavailable(sentence: result.sentence, page: URL(string: result.hostUrl))
        }
        return .answered(result)
    }

    /// move.ts failedStep: the API's own sentence for a refusal it answered; with no answer, nothing
    /// was sent when the plan failed, and the move may have left when the make failed, so the member
    /// is sent to check the platform.
    static func failed(_ error: any Error, stage: Stage, platform: String, page: URL?) -> MoveStep {
        if case let APIError.envelope(_, message) = error, !message.isEmpty {
            return .failed(sentence: message, page: nil)
        }
        switch stage {
        case .plan: return .failed(sentence: Words.Move.notReached, page: nil)
        case .make: return .failed(sentence: StartWords.lost(platform), page: page)
        }
    }

    enum Stage {
        case plan
        case make
    }
}

/// The confirmation as the panel pinned above the bar draws it (MovePanel.svelte): its lines, the verb
/// that makes the move, the platform's page and the way out. Never a retry, never a second confirm.
public struct MovePanel: Equatable, Sendable {
    /// The move, what it came to, or why it cannot be made.
    public let line: String
    public let tone: Tone
    /// The platform's reason under a refusal, in its own words.
    public let said: String?
    /// The verb that makes the move ("Set it on ESPN", "Setting it on ESPN" while it is sent).
    public let verb: String?
    public let verbEnabled: Bool
    /// The platform's page: the solid verb where the move cannot be made here, else a quiet link
    /// ("Open ESPN") beside a refusal, a move not shown yet or a failure.
    public let page: FootRun?
    public let pageSolid: Bool
    /// The way out: Not now, or Done once the move has answered; nil while it is sent.
    public let close: String?

    public enum Tone: Equatable, Sendable {
        case plain
        case quiet
        case problem
    }

    public init?(step: MoveStep, platform: String) {
        let setIt = StartWords.setItOn(platform)
        let open = { (url: URL?) in url.map { FootRun(text: StartWords.open(platform), url: $0) } }
        switch step {
        case .closed:
            return nil
        case .planning:
            self.init(line: StartWords.reading(platform), tone: .quiet)
        case let .confirm(sentence, _):
            self.init(line: sentence, verb: setIt, verbEnabled: true, close: Words.Move.notNow)
        case let .sending(sentence):
            self.init(line: sentence, verb: StartWords.setting(platform))
        case let .answered(result):
            let refused = result.outcome.value1 == .refused
            let done = result.outcome.value1 == .done
            self.init(
                line: result.sentence,
                said: refused ? result.hostWords.map { StartWords.hostSaid(platform, $0) } : nil,
                page: done ? nil : open(URL(string: result.hostUrl)),
                close: Words.Move.done
            )
        case let .unavailable(sentence, page):
            self.init(
                line: sentence, page: page.map { FootRun(text: setIt, url: $0) }, pageSolid: true,
                close: Words.Move.notNow
            )
        case let .failed(sentence, page):
            self.init(line: sentence, tone: .problem, page: open(page), close: Words.Move.notNow)
        }
    }

    private init(
        line: String, tone: Tone = .plain, said: String? = nil, verb: String? = nil, verbEnabled: Bool = false,
        page: FootRun? = nil, pageSolid: Bool = false, close: String? = nil
    ) {
        self.line = line
        self.tone = tone
        self.said = said
        self.verb = verb
        self.verbEnabled = verbEnabled
        self.page = page
        self.pageSolid = pageSolid
        self.close = close
    }
}
