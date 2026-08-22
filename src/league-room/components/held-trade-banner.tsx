import { Badge, Card } from "@/components/ui";

export interface HeldTradeBannerProps {
  readonly leagueName: string;
  readonly counterpartyTeamName: string;
}

/**
 * What both managers see while a held trade waits on an operator (Plan D, Task 5). Says the
 * IDENTICAL sentence `trade_held_for_review`'s own notice says (`NOTICE_TEMPLATES`,
 * `@/integrity/notices`) — copied here rather than imported, because a room component may never
 * value-import `@/integrity` (the client boundary, `eslint.config.mjs`), and kept honest by
 * `src/integrity/rendered-copy.test.tsx`'s own sync check, which renders both and compares the
 * text directly. A member reading two different sentences about one fact would read one of them
 * as a euphemism, so this is not "similar" copy — it is the same words.
 *
 * "somebody at Commish looks at it", never "under investigation"; "this lopsided", never
 * "suspicious" — founder decision #10, as shipped.
 */
export function HeldTradeBanner({ leagueName, counterpartyTeamName }: HeldTradeBannerProps) {
  return (
    <Card as="section" aria-label="This trade is on hold">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Waiting on a fairness review</Badge>
        </div>
        <p className="text-sm font-medium text-text-primary">Your trade is waiting on a fairness review</p>
        <p className="text-sm text-text-muted">
          {`Your trade with ${counterpartyTeamName} in ${leagueName} is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.`}
        </p>
      </div>
    </Card>
  );
}
