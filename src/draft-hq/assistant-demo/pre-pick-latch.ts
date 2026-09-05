/**
 * REPRODUCES `use-assistant.ts`'S OWN `prePickCall` LATCH (see that hook's own docblock) over a
 * fixed, already-known SEQUENCE of calls, for the Assistant demo's stepped replay rather than a
 * live fetch loop. Every "fetch" the real hook would have made already exists ahead of time as
 * `calls[i]` (`AssistantDemoFixture.calls`), so the same transition rule just needs to be
 * replayed once, in array order, rather than driven by an effect that reacts to one arrival at a
 * time.
 *
 * The rule, unchanged from the hook: the call most recently seen with `onTheClock === true`
 * becomes the latch the MOMENT a later call arrives (this seat's pick resolved); the latch clears
 * the moment a call itself carries `onTheClock === true` again (this seat's next turn has
 * arrived, so any earlier beat is stale).
 */
import type { AssistantCallView } from "@/draft-service/assistant/call";

/** `result[i]` is what the real hook's own `prePickCall` would read immediately after processing
 *  `calls[i]` as its i-th fetch — the exact value the demo step wants to render its beat from. */
export function latchPrePickCalls(calls: readonly AssistantCallView[]): readonly (AssistantCallView | null)[] {
  const result: (AssistantCallView | null)[] = [];
  let prePickCall: AssistantCallView | null = null;
  let previous: AssistantCallView | null = null;

  for (const current of calls) {
    if (previous !== null && previous.onTheClock) {
      prePickCall = previous;
    } else if (current.onTheClock) {
      prePickCall = null;
    }
    result.push(prePickCall);
    previous = current;
  }

  return result;
}
