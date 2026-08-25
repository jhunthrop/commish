import { afterEach, describe, expect, it } from "vitest";
import { PAYMENTS_PROVIDER_CONFIG } from "./config";
import {
  INGEST_REFUSALS,
  ingestProviderCallback,
  PAYMENTS_EVENT_TYPES,
  signProviderCallback,
} from "./ingest";

afterEach(() => {
  delete process.env[PAYMENTS_PROVIDER_CONFIG.envVars.webhookSecret];
});

/** A well-formed payload, signed the way the mock signs — the happy path every refusal varies. */
function signedCallback(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: signProviderCallback(body) };
}

const VALID_PAYLOAD = { type: "deposit_completed", ref: "transfer-1", amountCents: 25_00 } as const;

describe("ingestProviderCallback", () => {
  it("verifies a signed callback and answers the typed event, for every event type", () => {
    for (const type of PAYMENTS_EVENT_TYPES) {
      const outcome = ingestProviderCallback(signedCallback({ type, ref: `transfer-${type}`, amountCents: 12_34 }));
      expect(outcome).toEqual({ ok: true, event: { type, ref: `transfer-${type}`, amountCents: 12_34 } });
    }
  });

  it("refuses a callback with no signature header, distinctly from a wrong one", () => {
    const { body } = signedCallback(VALID_PAYLOAD);
    expect(ingestProviderCallback({ body, signature: undefined })).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.missingSignature,
    });
  });

  it("refuses a signature computed over different bytes", () => {
    const { signature } = signedCallback(VALID_PAYLOAD);
    const tampered = JSON.stringify({ ...VALID_PAYLOAD, amountCents: 999_99 });
    expect(ingestProviderCallback({ body: tampered, signature })).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.invalidSignature,
    });
  });

  it("refuses a signature that is not even hex of the right length", () => {
    const { body } = signedCallback(VALID_PAYLOAD);
    for (const signature of ["", "zz", "deadbeef", "not hex at all"]) {
      expect(ingestProviderCallback({ body, signature })).toEqual({
        ok: false,
        reason: INGEST_REFUSALS.invalidSignature,
      });
    }
  });

  it("refuses a correctly signed body that is not JSON at all", () => {
    const body = "not json";
    expect(ingestProviderCallback({ body, signature: signProviderCallback(body) })).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.malformedPayload,
    });
  });

  it("refuses a correctly signed event of an unknown type: the union is closed", () => {
    expect(ingestProviderCallback(signedCallback({ ...VALID_PAYLOAD, type: "deposit_failed" }))).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.malformedPayload,
    });
  });

  it("refuses unknown extra keys: a payload this boundary does not fully understand does not pass", () => {
    expect(ingestProviderCallback(signedCallback({ ...VALID_PAYLOAD, surprise: true }))).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.malformedPayload,
    });
  });

  it("refuses an empty ref and every non-positive-integer amount", () => {
    const badPayloads = [
      { ...VALID_PAYLOAD, ref: "" },
      { ...VALID_PAYLOAD, amountCents: 0 },
      { ...VALID_PAYLOAD, amountCents: -5_00 },
      { ...VALID_PAYLOAD, amountCents: 10.5 },
      { ...VALID_PAYLOAD, amountCents: 2 ** 53 },
      { ...VALID_PAYLOAD, amountCents: "2500" },
    ];
    for (const payload of badPayloads) {
      expect(ingestProviderCallback(signedCallback(payload))).toEqual({
        ok: false,
        reason: INGEST_REFUSALS.malformedPayload,
      });
    }
  });

  it("reads the shared secret from PAYMENTS_WEBHOOK_SECRET when set, so a real deployment's signatures verify", () => {
    const { body, signature: mockSecretSignature } = signedCallback(VALID_PAYLOAD);
    process.env[PAYMENTS_PROVIDER_CONFIG.envVars.webhookSecret] = "a-real-deployment-secret";
    // A signature minted under the mock's dev secret no longer verifies...
    expect(ingestProviderCallback({ body, signature: mockSecretSignature })).toEqual({
      ok: false,
      reason: INGEST_REFUSALS.invalidSignature,
    });
    // ...and signing again (now under the env secret) round-trips.
    expect(ingestProviderCallback({ body, signature: signProviderCallback(body) })).toEqual({
      ok: true,
      event: VALID_PAYLOAD,
    });
  });

  it("treats an empty PAYMENTS_WEBHOOK_SECRET as unset, the envOr law", () => {
    process.env[PAYMENTS_PROVIDER_CONFIG.envVars.webhookSecret] = "";
    const outcome = ingestProviderCallback(signedCallback(VALID_PAYLOAD));
    expect(outcome).toEqual({ ok: true, event: VALID_PAYLOAD });
  });
});
