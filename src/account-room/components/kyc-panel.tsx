"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Panel, Select, StatPill } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { KycStatus } from "@/db/schema";
import type { StateCode } from "@/money/states";
import type { KycProviderStatus } from "@/payments-provider/kyc-contract";
import { useAccountRoomDeps } from "../hooks/deps";
import { STATE_OF_ENTRY_OPTIONS } from "./money-copy";

interface SubmitKycBody {
  readonly status: KycProviderStatus;
}

/** The one-line headline for a status that opens with an action or a plain fact — `pending` and
 *  `verified` need no separate headline, since their own `STATUS_SENTENCE` already says the
 *  whole thing in one line. */
const STATUS_HEADLINE: Readonly<Partial<Record<KycStatus, string>>> = {
  none: "Verify your identity",
  failed: "Verification did not go through.",
};

/** What each status tells the reader, in one sentence — no jargon, and no reason `KycPanel`
 *  invents a fifth status of its own: these are `KYC_STATUSES` (`@research/db/schema`), verbatim. */
const STATUS_SENTENCE: Readonly<Record<KycStatus, string>> = {
  none: "Federal rules require this before you can hold a balance.",
  pending: "Your verification is in review.",
  verified: "You can deposit, withdraw and hold a balance.",
  failed: "Update your details and try again.",
};

/** Whether this status gets a form: `none` (never tried) and `failed` (the concrete next action
 *  the brief asks for). `pending` and `verified` both render a status sentence and stop —
 *  nothing for the reader to do in either case. */
function showsForm(status: KycStatus): boolean {
  return status === "none" || status === "failed";
}

export interface KycPanelProps {
  /** `walletAccountFlags(db, userId).kycStatus`, computed server-side and handed down. */
  readonly status: KycStatus;
}

/**
 * The KYC door's own panel (Task 12): renders all four `KYC_STATUSES`, and gives `failed` its
 * concrete next action — the identical resubmit form `none` gets, with a sentence explaining what
 * happened first. `pending` and `verified` are statements, not forms: there is nothing for the
 * reader to do in either case (`showsForm`).
 *
 * `dateOfBirth` is a native `<input type="date">` rather than free text: the browser's own picker
 * already emits `YYYY-MM-DD`, `kycSubmissionRequestSchema`'s one accepted shape, so there is no
 * hand-written date parser here to disagree with the server's regex.
 */
export function KycPanel({ status }: KycPanelProps) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [stateOfEntry, setStateOfEntry] = useState<StateCode | "">("");
  const [error, setError] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitNotice(null);
    if (legalName.trim().length === 0 || dateOfBirth.length === 0 || stateOfEntry === "") {
      setError("Fill in every field.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/wallet/kyc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalName: legalName.trim(), dateOfBirth, stateOfEntry, idempotencyKey: crypto.randomUUID() }),
      });
      const envelope = (await response.json()) as ApiEnvelope<SubmitKycBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setSubmitNotice(`Submitted. ${STATUS_SENTENCE[envelope.data.status === "verified" ? "verified" : "pending"]}`);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Identity verification" meta={status === "verified" ? <StatPill label="Verified" tone="positive" /> : undefined}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          {STATUS_HEADLINE[status] === undefined ? null : <p className="font-medium text-text-primary">{STATUS_HEADLINE[status]}</p>}
          <p className="text-sm text-text-muted">{STATUS_SENTENCE[status]}</p>
        </div>

        {!showsForm(status) ? null : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input label="Legal name" hint="The name on your identity document." value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
            <Select
              label="State"
              hint="Where you are entering from."
              options={[{ value: "", label: "Choose your state" }, ...STATE_OF_ENTRY_OPTIONS]}
              value={stateOfEntry}
              onChange={(event) => setStateOfEntry(event.target.value as StateCode | "")}
            />

            {error === null ? null : (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            {submitNotice === null ? null : (
              <p role="status" className="text-sm text-positive">
                {submitNotice}
              </p>
            )}

            <div>
              <Button type="submit" loading={submitting} disabled={submitting}>
                {status === "failed" ? "Try again" : "Verify identity"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}
