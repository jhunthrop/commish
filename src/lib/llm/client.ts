import Anthropic from "@anthropic-ai/sdk";
import { LLM_CONFIG } from "./config";

export class LlmUnavailableError extends Error {
  constructor(message = "AI features are unavailable: ANTHROPIC_API_KEY is not configured.") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export function isLLMEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.length > 0;
}

/** The narrow slice of the Anthropic SDK this module uses — injectable in tests. */
export interface AnthropicLike {
  readonly messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: readonly { role: "user"; content: string }[];
    }): Promise<{
      content: readonly { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface CompletionInput {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmClient {
  generateCompletion(input: CompletionInput): Promise<CompletionResult>;
}

interface Deps {
  readonly env?: Partial<NodeJS.ProcessEnv>;
  readonly sdk?: AnthropicLike;
}

export function createLlmClient({ env = process.env, sdk }: Deps = {}): LlmClient {
  const enabled = isLLMEnabled(env);
  // The SDK's messages.create takes a mutable MessageParam[]; AnthropicLike declares it readonly (test-injectable narrow slice). Structurally incompatible, so cast at this single construction site.
  const client: AnthropicLike | null = enabled ? (sdk ?? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) as unknown as AnthropicLike)) : null;

  return {
    async generateCompletion(input) {
      if (client === null) throw new LlmUnavailableError();
      const res = await client.messages.create({
        model: LLM_CONFIG.model,
        max_tokens: input.maxTokens ?? LLM_CONFIG.defaultMaxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      });
      const text = res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    },
  };
}

let singleton: LlmClient | undefined;

/** Process-wide client bound to process.env. Features call this; tests call createLlmClient with fakes. */
export function getLlmClient(): LlmClient {
  if (singleton === undefined) singleton = createLlmClient();
  return singleton;
}
