import { describe, it, expect } from "vitest";
import { parseChatFrame } from "./parse";

const MESSAGE = {
  type: "chat.message",
  payload: {
    message: {
      id: "7",
      authorUserId: "u1",
      authorName: "Alex Rivera",
      authorAvatarUrl: null,
      body: "wheels up",
      createdAt: "2026-08-18T12:00:00.000Z",
      reactions: [{ emoji: "🔥", userId: "u2" }],
      gif: null,
      removal: null,
    },
  },
};

const REMOVAL = { at: "2026-08-20T00:00:00.000Z" };

const GIF = { url: "https://media.giphy.com/g.gif", previewUrl: "https://media.giphy.com/g-preview.gif", alt: "Touchdown", width: 480, height: 270 };

const REACTION = {
  type: "chat.reaction",
  payload: { messageId: "7", emoji: "🔥", userId: "u2", action: "added" },
};

describe("parseChatFrame", () => {
  it("parses a chat.message frame into a message", () => {
    const frame = parseChatFrame(JSON.stringify(MESSAGE));
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("parses a chat.reaction frame into a reaction", () => {
    expect(parseChatFrame(JSON.stringify(REACTION))).toEqual({ kind: "reaction", reaction: REACTION.payload });
  });

  it("returns null for a frame that isn't JSON", () => {
    expect(parseChatFrame("{not json")).toBeNull();
  });

  it("returns null for an event type this fold doesn't own", () => {
    expect(parseChatFrame(JSON.stringify({ type: "draft.pick", payload: {} }))).toBeNull();
  });

  it("returns null when a message field is missing or the wrong type", () => {
    expect(parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: { id: 7 } } }))).toBeNull();
    expect(parseChatFrame(JSON.stringify({ type: "chat.message", payload: null }))).toBeNull();
  });

  it("returns null when a reaction field is missing or the action is unknown", () => {
    expect(parseChatFrame(JSON.stringify({ type: "chat.reaction", payload: { ...REACTION.payload, action: "shrugged" } }))).toBeNull();
    expect(parseChatFrame(JSON.stringify({ type: "chat.reaction", payload: { emoji: "🔥" } }))).toBeNull();
  });

  it("drops a malformed reaction entry rather than the whole message", () => {
    const frame = parseChatFrame(
      JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, reactions: [{ emoji: 1, userId: "u2" }] } } }),
    );
    expect(frame).toEqual({ kind: "message", message: { ...MESSAGE.payload.message, reactions: [] } });
  });

  it("treats a missing reactions field as no reactions", () => {
    const messageWithoutReactions = {
      id: MESSAGE.payload.message.id,
      authorUserId: MESSAGE.payload.message.authorUserId,
      authorName: MESSAGE.payload.message.authorName,
      authorAvatarUrl: MESSAGE.payload.message.authorAvatarUrl,
      body: MESSAGE.payload.message.body,
      createdAt: MESSAGE.payload.message.createdAt,
    };
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: messageWithoutReactions } }));
    expect(frame).toEqual({ kind: "message", message: { ...messageWithoutReactions, reactions: [], gif: null, removal: null } });
  });

  it("parses a well-formed gif field", () => {
    const withGif = { ...MESSAGE.payload.message, gif: GIF };
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: withGif } }));
    expect(frame).toEqual({ kind: "message", message: withGif });
  });

  it("treats a missing gif field as no gif", () => {
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: MESSAGE.payload.message } }));
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("drops a gif field that isn't an object, rather than failing the whole message", () => {
    const frame = parseChatFrame(
      JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, gif: "not an object" } } }),
    );
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("drops a gif field missing any one of its required properties", () => {
    const incompleteGifs = [
      { previewUrl: GIF.previewUrl, alt: GIF.alt, width: GIF.width, height: GIF.height },
      { url: GIF.url, alt: GIF.alt, width: GIF.width, height: GIF.height },
      { url: GIF.url, previewUrl: GIF.previewUrl, width: GIF.width, height: GIF.height },
      { url: GIF.url, previewUrl: GIF.previewUrl, alt: GIF.alt, height: GIF.height },
      { url: GIF.url, previewUrl: GIF.previewUrl, alt: GIF.alt, width: GIF.width },
    ];
    for (const gif of incompleteGifs) {
      const frame = parseChatFrame(
        JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, gif } } }),
      );
      expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
    }
  });

  it("drops a gif field whose dimensions are not finite numbers", () => {
    const frame = parseChatFrame(
      JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, gif: { ...GIF, width: "480" } } } }),
    );
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("parses a well-formed removal field", () => {
    const withRemoval = { ...MESSAGE.payload.message, removal: REMOVAL };
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: withRemoval } }));
    expect(frame).toEqual({ kind: "message", message: withRemoval });
  });

  it("treats a missing removal field as no removal", () => {
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: MESSAGE.payload.message } }));
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("drops a removal field that isn't an object, rather than failing the whole message", () => {
    const frame = parseChatFrame(
      JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, removal: "not an object" } } }),
    );
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  it("drops a removal field with no `at` — the only property a real removal has", () => {
    const frame = parseChatFrame(JSON.stringify({ type: "chat.message", payload: { message: { ...MESSAGE.payload.message, removal: { at: 7 } } } }));
    expect(frame).toEqual({ kind: "message", message: MESSAGE.payload.message });
  });

  /**
   * Final review, HIGH 1: the removal reason is off the wire, and this parser is the client-side
   * half of keeping it off. A frame that carried one anyway — a regressed server, a replayed old
   * Redis entry from before the fix, anything — has it dropped here rather than folded into
   * client state where a later render could reach it.
   */
  it("keeps only `at` off a removal, dropping any reason a frame carries", () => {
    const frame = parseChatFrame(
      JSON.stringify({
        type: "chat.message",
        payload: { message: { ...MESSAGE.payload.message, removal: { ...REMOVAL, phrase: "spam or fake content", reason: "spam" } } },
      }),
    );
    expect(frame).toEqual({ kind: "message", message: { ...MESSAGE.payload.message, removal: REMOVAL } });
    expect(JSON.stringify(frame)).not.toContain("spam");
  });

  it("returns null when the reaction payload isn't an object", () => {
    expect(parseChatFrame(JSON.stringify({ type: "chat.reaction", payload: null }))).toBeNull();
  });

  it("returns null when the parsed frame itself isn't an object", () => {
    expect(parseChatFrame(JSON.stringify("just a string"))).toBeNull();
  });
});
