import { describe, it, expect } from "vitest";
import {
  intentRequest,
  validateIntentResponse,
  INTENT_CRITERIA,
  TYPESAFE_MODEL,
} from "../packages/core/src/ai-intent";
import { requestTypesafeIntent } from "../workers/typesafe-intent";
const context = { revision: 1, soundOn: true, volume: 35, audioPending: false };
const response = (choice = "quieter", confidence = 0.95) => ({
  model: TYPESAFE_MODEL,
  answers: {
    intent: {
      type: "choice",
      choice,
      confidence,
      probabilities: Object.fromEntries(
        Object.keys(INTENT_CRITERIA).map((k) => [
          k,
          k === choice ? 0.95 : 0.01,
        ]),
      ),
    },
  },
});
describe("optional TypeSafe language judgment", () => {
  it("sends a small device snapshot, with no room key or flight controls", () => {
    const input = { ...context, roomKey: "never-send" };
    const body = intentRequest("静かにして", input);
    expect(JSON.stringify(body)).not.toContain("never-send");
    expect(body.state.device).toEqual({
      soundOn: true,
      volume: 35,
      audioPending: false,
    });
  });
  it("only yields a reviewable suggestion for a valid finite choice", () => {
    expect(validateIntentResponse(response(), context, context)).toMatchObject({
      kind: "suggestion",
      intent: "quieter",
      revision: 1,
    });
    expect(
      validateIntentResponse(response("delete-room"), context, context),
    ).toMatchObject({ reason: "invalid" });
    expect(
      validateIntentResponse(response("quieter", 0.7), context, context),
    ).toMatchObject({ reason: "uncertain" });
    expect(
      validateIntentResponse(response("none"), context, context),
    ).toMatchObject({ reason: "uncertain" });
  });
  it("rejects corrupted probabilities and stale or inapplicable commands", () => {
    const broken = response();
    broken.answers.intent.probabilities.quieter = NaN;
    expect(validateIntentResponse(broken, context, context)).toMatchObject({
      reason: "invalid",
    });
    expect(
      validateIntentResponse(response(), context, { ...context, revision: 2 }),
    ).toMatchObject({ reason: "stale" });
    const muted = { ...context, soundOn: false };
    expect(
      validateIntentResponse(response("mute"), muted, muted),
    ).toMatchObject({ reason: "not-applicable" });
  });
  it("skips network without a key; validates input before spending", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw new Error("unexpected");
    }) as typeof fetch;
    const options = {
      utterance: "静かにして",
      context,
      currentContext: () => context,
      fetcher,
    };
    expect(await requestTypesafeIntent(options)).toMatchObject({
      reason: "unavailable",
    });
    expect(
      await requestTypesafeIntent({
        ...options,
        apiKey: "test",
        utterance: "",
      }),
    ).toMatchObject({ reason: "invalid" });
    expect(calls).toBe(0);
  });
  it("uses the documented endpoint and falls back without retry on quota errors", async () => {
    let calls = 0;
    const fetcher = (async (url, init) => {
      calls++;
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test",
      );
      return new Response("", { status: 429 });
    }) as typeof fetch;
    expect(
      await requestTypesafeIntent({
        utterance: "静かにして",
        context,
        currentContext: () => context,
        apiKey: "test",
        fetcher,
      }),
    ).toMatchObject({ reason: "unavailable" });
    expect(calls).toBe(1);
  });
  it("discards a reply when the device state changed during inference", async () => {
    const fetcher = (async () => Response.json(response())) as typeof fetch;
    expect(
      await requestTypesafeIntent({
        utterance: "静かにして",
        context,
        currentContext: () => ({ ...context, volume: 40 }),
        apiKey: "test",
        fetcher,
      }),
    ).toMatchObject({ reason: "stale" });
  });
  it("returns promptly even if a provider ignores abort", async () => {
    const fetcher = (() => new Promise<Response>(() => {})) as typeof fetch;
    expect(
      await requestTypesafeIntent({
        utterance: "静かにして",
        context,
        currentContext: () => context,
        apiKey: "test",
        fetcher,
        timeoutMs: 50,
      }),
    ).toMatchObject({ reason: "timeout" });
  });
});
