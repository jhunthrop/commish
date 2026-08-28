"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Panel, Select } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { MONEY_CONFIG, MONEY_REFUSALS, formatUsd } from "@/money/config";
import type { StateCode } from "@/money/states";
import type { MethodDescriptor, TransferIntent } from "@/payments-provider/contract";
import { useAccountRoomDeps } from "../hooks/deps";
import { describeMethodFee, STATE_OF_ENTRY_OPTIONS } from "./money-copy";

interface InitiateWithdrawalBody {
  readonly transfer: TransferIntent;
  readonly feeCents: number;
  readonly feePercentBasisPoints: number;
  readonly etaDescription: string;
}

/** Parses the raw dollar-string field into whole cents, or `null` for anything that is not a
 *  positive finite number — the same guard `DepositForm` uses. */
function parseDollarsToCents(raw: string): number | null {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

export interface WithdrawalFormProps {
  /** `provider.listSupportedMethods()`'s `"bank"` entry, computed server-side and handed down —
   *  `WithdrawalDestination` is bank ONLY, permanently (`@/payments-provider/contract`'s own
   *  docblock: "the closed-loop wallet has no card withdrawals"), so this form has no method
   *  choice to render, only the one rail's own fee and ETA, before commit. */
  readonly bankMethod: MethodDescriptor;
}

/**
 * The withdrawal door's own form (Task 12), `DepositForm`'s sibling. No method selector — bank
 * only, permanently — but the same client-bound / server-trusted discipline: `amountCents` is
 * checked against `MONEY_CONFIG.withdrawal.minCents` in the exact `MONEY_REFUSALS` sentence the
 * server enforces with; there is no client-side MAXIMUM to check, because the true ceiling is the
 * member's own locked available balance, which only the writer's balance floor can answer
 * (`withdrawalRequestSchema`'s own docblock) — a refusal past that line comes back from the
 * server, `MONEY_REFUSALS.insufficientBalance` or `.withdrawalSettledInFull`, rendered verbatim.
 *
 * `destination.externalAccountRef` has no linking flow yet (out of this task's scope): the field
 * below is a plain, opaque reference a member already holds from their payments provider.
 */
export function WithdrawalForm({ bankMethod }: WithdrawalFormProps) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [amount, setAmount] = useState("");
  const [stateOfEntry, setStateOfEntry] = useState<StateCode | "">("");
  const [externalAccountRef, setExternalAccountRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setStatus(null);
    const amountCents = parseDollarsToCents(amount);
    if (amountCents === null) {
      setError("Enter an amount in dollars.");
      return;
    }
    if (amountCents < MONEY_CONFIG.withdrawal.minCents) {
      setError(MONEY_REFUSALS.withdrawalBelowMinimum);
      return;
    }
    if (stateOfEntry === "") {
      setError("Choose your state.");
      return;
    }
    if (externalAccountRef.trim().length === 0) {
      setError("Enter your linked bank account reference.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/wallet/withdrawals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents,
          stateOfEntry,
          destination: { externalAccountRef: externalAccountRef.trim() },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const envelope = (await response.json()) as ApiEnvelope<InitiateWithdrawalBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      const { transfer } = envelope.data;
      if (transfer.status === "failed") {
        setError(`No money moved. ${transfer.failureReason}`);
        return;
      }
      setStatus(`${formatUsd(transfer.amountCents)} is on its way to your bank.`);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Withdraw">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-text-muted">{describeMethodFee(bankMethod)}</p>

        <Input
          label="Amount"
          inputMode="decimal"
          hint={`At least ${formatUsd(MONEY_CONFIG.withdrawal.minCents)}. Bounded above by your available balance.`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />

        <Select
          label="State"
          hint="Where you are withdrawing from."
          options={[{ value: "", label: "Choose your state" }, ...STATE_OF_ENTRY_OPTIONS]}
          value={stateOfEntry}
          onChange={(event) => setStateOfEntry(event.target.value as StateCode | "")}
        />

        <Input
          label="Bank account reference"
          hint="Your linked bank account's reference from your payments provider."
          value={externalAccountRef}
          onChange={(event) => setExternalAccountRef(event.target.value)}
        />

        {error === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        {status === null ? null : (
          <p role="status" className="text-sm text-positive">
            {status}
          </p>
        )}

        <div>
          {/* GAMEDAY, LAW 1: *"money is also the fill of the verb, because pressing it is how
              money moves."* Moving money in or out is the literal case that clause names, so both
              of the wallet's money verbs take `verb` (the money fill) rather than the ink pill.
              That is also what makes law 5 hold on the live wallet, which used to render THREE
              ink pills at once — add, withdraw and verify — and force a reader to choose between
              three loud things on the one surface where being sure matters most. The single ink
              action left on the page is `KycPanel`'s, which is the one ceremonial act here: the
              gate you pass once before any of this is available to you at all. */}
          <Button type="submit" variant="verb" loading={submitting} disabled={submitting}>
            Withdraw
          </Button>
        </div>
      </form>
    </Panel>
  );
}
