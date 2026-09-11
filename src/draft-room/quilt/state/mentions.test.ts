import { describe, expect, it } from "vitest";
import { chatMessage } from "@/chat-room/test-fixtures";
import { latestMentionBy, mentionsMe } from "./mentions";

const me = "u-me";

describe("mentionsMe", () => {
  it("matches the full name or the first name as a word, case-blind", () => {
    expect(mentionsMe(chatMessage("m1", { authorUserId: "u-rey", body: "leave it, Dana" }), me, "Dana Whitfield")).toBe(true);
    expect(mentionsMe(chatMessage("m2", { authorUserId: "u-rey", body: "dana whitfield is on the clock" }), me, "Dana Whitfield")).toBe(true);
    expect(mentionsMe(chatMessage("m3", { authorUserId: "u-rey", body: "Danaher took him" }), me, "Dana Whitfield")).toBe(false);
  });

  it("never counts your own words, a removed message, or a two-letter first name alone", () => {
    expect(mentionsMe(chatMessage("m4", { authorUserId: me, body: "Dana here" }), me, "Dana Whitfield")).toBe(false);
    expect(mentionsMe(chatMessage("m5", { authorUserId: "u-rey", body: "Al is up", }), me, "Al Green")).toBe(false);
    expect(mentionsMe(chatMessage("m6", { authorUserId: "u-rey", body: "Al Green is up" }), me, "Al Green")).toBe(true);
    expect(mentionsMe(chatMessage("m7", { authorUserId: "u-rey", body: "Dana" }), me, null)).toBe(false);
  });

  it("names the latest person who said your name", () => {
    const messages = [
      chatMessage("m1", { authorUserId: "u-rey", authorName: "Rey Okafor", body: "Dana, no" }),
      chatMessage("m2", { authorUserId: "u-cp", authorName: "Coach Parker", body: "backs are going" }),
    ];
    expect(latestMentionBy(messages, me, "Dana Whitfield")).toBe("Rey");
    expect(latestMentionBy(messages, me, "Coach Parker")).toBeNull();
  });
});
