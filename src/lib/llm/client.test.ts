import { describe, it, expect, vi } from "vitest";
import { createLlmClient, isLLMEnabled, LlmUnavailableError, type AnthropicLike } from "./client";

describe("isLLMEnabled", () => {
  it("is false when the key is missing or empty", () => {
    expect(isLLMEnabled({})).toBe(false);
    expect(isLLMEnabled({ ANTHROPIC_API_KEY: "" })).toBe(false);
  });
  it("is true when the key is set", () => {
    expect(isLLMEnabled({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(true);
  });
});

describe("createLlmClient", () => {
  it("rejects with LlmUnavailableError and never calls the SDK when disabled", async () => {
    const create = vi.fn();
    const client = createLlmClient({ env: {}, sdk: { messages: { create } } });
    await expect(client.generateCompletion({ system: "s", user: "u" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns text and token usage from the SDK when enabled", async () => {
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Start Mahomes." }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
      },
    };
    const client = createLlmClient({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, sdk });
    const out = await client.generateCompletion({ system: "You are a fantasy advisor.", user: "Who do I start?" });
    expect(out).toEqual({ text: "Start Mahomes.", inputTokens: 12, outputTokens: 4 });
    expect(sdk.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ system: "You are a fantasy advisor.", messages: [{ role: "user", content: "Who do I start?" }] }),
    );
  });

  it("concatenates multiple text blocks and ignores non-text blocks", async () => {
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "A" }, { type: "tool_use" }, { type: "text", text: "B" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };
    const client = createLlmClient({ env: { ANTHROPIC_API_KEY: "k" }, sdk });
    expect((await client.generateCompletion({ system: "s", user: "u" })).text).toBe("AB");
  });
});
