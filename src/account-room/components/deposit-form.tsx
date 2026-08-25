"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Panel, Select } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { MONEY_CONFIG, MONEY_REFUSALS, formatUsd } from "@/money/config";
import type { StateCode } from "@/money/states";
import type { DepositMethod, MethodDescriptor, TransferIntent } from "@/payments-provider/contract";
import { useAccountRoomDeps } from "../hooks/deps";
import { describeMethodFee, STATE_OF_ENTRY_OPTIONS } from "./money-copy";

/** `import type` only — `@/payments-provider` is server-only past its types (the client-boundary
 *  rule, `eslint.config.mjs`), so `DEPOSIT_METHODS` itself is not a legal value-import here. The
 *  method options are built from the `methods` PROP instead — which is also the honest source:
 *  the select only ever offers what `provider.listSupportedMethods()` actually named. */
const METHOD_LABEL: Readonly<Record<DepositMethod, string>> = { bank: "Bank transfer", card: "Debit card" };

interface InitiateDepositBody {
  readonly transfer: TransferIntent;
}

/** Parses the raw dollar-string field into whole cents, or `null` for anything that is not a
 *  positive finite number — never a `NaN`/`Infinity` cents value reaching the request body. */
function parseDollarsToCents(raw: string): number | null {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

export interface DepositFormProps {
  /** `provider.listSupportedMethods()`, computed server-side and handed down — the same
   *  "props, not a fetch" shape every other account-room form takes its read-only data in.
   *  `import type` only (`MethodDescriptor`'s own docblock: "every FIGURE arrives over the wire"). */
  readonly methods: readonly MethodDescriptor[];
}

/**
 * The deposit door's own form (Task 12). Amounts are client-validated against
 * `MONEY_CONFIG.deposit`'s bounds, in the SAME `MONEY_REFUSALS` sentences the server enforces
 * with (`depositRequestSchema`'s own construction) — never a second, hand-written bound that
 * could drift from the number the door actually checks. The server stays the trust boundary:
 * this is a courtesy that catches a mistake before a request, not the enforcement.
 *
 * The idempotency key is minted once PER SUBMIT ATTEMPT (`crypto.randomUUID()`, the route's own
 * edge-only-randomness idiom moved to the browser's edge instead), so a double-click and a
 * retried request become the SAME transfer at the provider (Seam A's replay law) rather than two.
 *
 * A DECLINE (`transfer.status === "failed"`) is a business outcome, never an exception — rendered
 * money-first (`No money moved. <reason>`), the same discipline `MONEY_REFUSALS` itself uses. A
 * server refusal (the envelope's own `error`) is already money-first from the door and rendered
 * verbatim.
 */
export function DepositForm({ methods }: DepositFormProps) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [amount, setAmount] = useState("");
  const [stateOfEntry, setStateOfEntry] = useState<StateCode | "">("");
  const [method, setMethod] = useState<DepositMethod>("bank");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const methodOptions = methods.map((descriptor) => ({ value: descriptor.method, label: METHOD_LABEL[descriptor.method] }));
  const selectedDescriptor = methods.find((descriptor) => descriptor.method === method) ?? null;

  const submit = async (): Promise<void> => {
    setStatus(null);
    const amountCents = parseDollarsToCents(amount);
    if (amountCents === null) {
      setError("Enter an amount in dollars.");
      return;
    }
    if (amountCents < MONEY_CONFIG.deposit.minCents) {
      setError(MONEY_REFUSALS.depositBelowMinimum);
      return;
    }
    if (amountCents > MONEY_CONFIG.deposit.maxPerTransferCents) {
      setError(MONEY_REFUSALS.depositAboveMaximum);
      return;
    }
    if (stateOfEntry === "") {
      setError("Choose your state.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/wallet/deposits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents, stateOfEntry, method, idempotencyKey: crypto.randomUUID() }),
      });
      const envelope = (await response.json()) as ApiEnvelope<InitiateDepositBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      const { transfer } = envelope.data;
      if (transfer.status === "failed") {
        setError(`No money moved. ${transfer.failureReason}`);
        return;
      }
      setStatus(`${formatUsd(transfer.amountCents)} is on its way to your wallet.`);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Add money">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Amount"
          inputMode="decimal"
          hint={`Between ${formatUsd(MONEY_CONFIG.deposit.minCents)} and ${formatUsd(MONEY_CONFIG.deposit.maxPerTransferCents)} per transfer.`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />

        <Select
          label="State"
          hint="Where you are entering from."
          options={[{ value: "", label: "Choose your state" }, ...STATE_OF_ENTRY_OPTIONS]}
          value={stateOfEntry}
          onChange={(event) => setStateOfEntry(event.target.value as StateCode | "")}
        />

        <Select
          label="Method"
          options={methodOptions}
          value={method}
          onChange={(event) => setMethod(event.target.value as DepositMethod)}
        />
        {selectedDescriptor === null ? null : <p className="text-sm text-text-muted">{describeMethodFee(selectedDescriptor)}</p>}

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
          <Button type="submit" loading={submitting} disabled={submitting}>
            Add money
          </Button>
        </div>
      </form>
    </Panel>
  );
}
