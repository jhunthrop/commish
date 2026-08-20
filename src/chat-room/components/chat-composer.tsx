"use client";

import { useState } from "react";
import { CHAT_CONFIG } from "@/chat/config";
import type { ChatGif } from "@/chat/contract";
import { Button, Input } from "@/components/ui";
import type { GifResult } from "@/gifs/provider";
import type { SendOutcome } from "../hooks/use-league-chat";
import { GifPicker } from "./gif-picker";

export interface ChatComposerProps {
  readonly sending: boolean;
  readonly onSend: (body: string, gif?: ChatGif) => Promise<SendOutcome>;
  /**
   * `createGifProvider() !== null`, carried down from `ChatPageBody.gifSearchEnabled`. The "Add a
   * GIF" button renders only when this is true — no dead button pointing at a search that 404s,
   * the no-MVP switch rule.
   */
  readonly gifSearchEnabled: boolean;
  readonly onSearchGifs: (query: string) => Promise<readonly GifResult[]>;
}

/**
 * One field, one button, and — when the seam is configured — a second button that opens
 * `GifPicker`. The field is capped at `CHAT_CONFIG.maxBodyLength` — the SERVER's own limit,
 * imported rather than restated, so the two can't drift — and an empty message is refused here
 * without a round trip, because "type something first" is not news the server needs to deliver.
 *
 * A rejected send KEEPS the text: losing what somebody typed to a validation error is how a
 * chat box earns distrust. Picking a GIF sends immediately (there is nothing to type first), so a
 * rejected GIF send instead surfaces the same error banner the text path uses.
 *
 * The field's id is fixed (`chat-message-input`) rather than generated, so the empty-state's
 * "Say hello" link (`MessageList`) has a stable anchor to jump to.
 */
export function ChatComposer({ sending, onSend, gifSearchEnabled, onSearchGifs }: ChatComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const sendGif = async (gif: GifResult): Promise<void> => {
    setPickerOpen(false);
    setError(null);
    // The alt text rides as the message's body — a text fallback for a client that never
    // fetches the image, and for a screen reader over the wire's own plain body field.
    const outcome = await onSend(gif.alt, { url: gif.url, previewUrl: gif.previewUrl, alt: gif.alt, width: gif.width, height: gif.height });
    if (!outcome.ok) setError(outcome.reason);
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
      <div className={`flex items-center gap-2 ${gifSearchEnabled ? "justify-between" : "justify-end"}`}>
        {gifSearchEnabled ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
            Add a GIF
          </Button>
        ) : null}
        <Button type="submit" loading={sending} disabled={sending}>
          Send
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {gifSearchEnabled ? (
        <GifPicker open={pickerOpen} onClose={() => setPickerOpen(false)} search={onSearchGifs} onPick={(gif) => void sendGif(gif)} />
      ) : null}
    </form>
  );
}
