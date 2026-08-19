"use client";

import { useState } from "react";
import { CHAT_CONFIG } from "@/chat/config";
import { Button, Input } from "@/components/ui";
import type { SendOutcome } from "../hooks/use-league-chat";

export interface ChatComposerProps {
  readonly sending: boolean;
  readonly onSend: (body: string) => Promise<SendOutcome>;
}

/**
 * One field, one button. The field is capped at `CHAT_CONFIG.maxBodyLength` — the SERVER's own
 * limit, imported rather than restated, so the two can't drift — and an empty message is
 * refused here without a round trip, because "type something first" is not news the server
 * needs to deliver.
 *
 * A rejected send KEEPS the text: losing what somebody typed to a validation error is how a
 * chat box earns distrust.
 *
 * The field's id is fixed (`chat-message-input`) rather than generated, so the empty-state's
 * "Say hello" link (`MessageList`) has a stable anchor to jump to.
 */
export function ChatComposer({ sending, onSend }: ChatComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setError(null);
    const outcome = await onSend(trimmed);
    if (outcome.ok) {
      setBody("");
      return;
    }
    setError(outcome.reason);
  };

  return (
    <form
      className="flex flex-col gap-2 border-t border-border pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        id="chat-message-input"
        label="Message"
        value={body}
        maxLength={CHAT_CONFIG.maxBodyLength}
        autoComplete="off"
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center justify-end">
        <Button type="submit" loading={sending} disabled={sending}>
          Send
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </form>
  );
}
