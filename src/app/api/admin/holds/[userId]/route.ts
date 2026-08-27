import { getDb } from "@/db/client";
import { confiscateHold, holdPreview, releaseHold } from "@/money-service/settlement";
import { holdOutcomeRequestSchema } from "@/money-service/schemas";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { withAdmin } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly userId: string }>;
}

interface HoldOutcomeBody {
  readonly userId: string;
  readonly action: "release" | "confiscate";
  readonly amountCents: number;
}

export interface HoldPreviewBody {
  readonly userId: string;
  readonly displayName: string;
  readonly heldCents: number;
}

/**
 * The read-then-confirm door (operator review, 2026-08-27, finding D1/D3): the member's own name
 * and the amount currently held, so `HoldsControl` can name the object and state which direction
 * money moves BEFORE the operator confirms either one-way `POST` below. `GET`, not `POST` — this
 * door moves no money.
 */
export async function GET(request: Request, { params }: RouteContext) {
  return withAdmin(request, async () => {
    const { userId } = await params;
    const preview = await holdPreview(getDb(), userId);
    if (!preview.ok) return fail(preview.reason, preview.status);
    return ok<HoldPreviewBody>({ userId, displayName: preview.displayName, heldCents: preview.heldCents });
  });
}

/**
 * The held-payout outcome door (Phase 4, Task 10): `withAdmin` -> `await params` -> `parseJson`
 * -> `releaseHold`/`confiscateHold` -> `fail`/`ok`. The member is named by the path, the outcome
 * by the body's one field, and the operator by `withAdmin`'s verified session — `resolveFlag`'s
 * own separation of who says what.
 *
 * No rate limiter, the dissolve route's own reasoning: both outcomes are one-way — the first
 * drains the held account to zero and every repeat answers the plain `nothingHeld` refusal — so
 * the action is already bounded by its own guard rather than a request budget.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withAdmin(request, async (operatorUserId, req) => {
    const { userId } = await params;
    const parsed = await parseJson(req, holdOutcomeRequestSchema);
    if (!parsed.ok) return parsed.response;

    const outcome = parsed.value.action === "release" ? releaseHold : confiscateHold;
    const result = await outcome(getDb(), { userId, operatorUserId });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<HoldOutcomeBody>({ userId, action: parsed.value.action, amountCents: result.amountCents });
  });
}
