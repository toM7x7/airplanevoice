import {
  intentRequest,
  validateIntentResponse,
  type IntentContext,
  type IntentDecision,
} from "../packages/core/src/ai-intent.ts";
/** Server-only adapter. No public route; no automatic retry; no model-controlled execution. */
export async function requestTypesafeIntent(options: {
  utterance: string;
  context: IntentContext;
  currentContext: () => IntentContext;
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<IntentDecision> {
  if (!options.apiKey) return { kind: "fallback", reason: "unavailable" };
  let body: string;
  const requested = { ...options.context };
  try {
    body = JSON.stringify(intentRequest(options.utterance, requested));
  } catch {
    return { kind: "fallback", reason: "invalid" };
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(
    50,
    Math.min(
      3000,
      Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 1500,
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IntentDecision>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "fallback", reason: "timeout" });
    }, timeoutMs);
  });
  const request = (async (): Promise<IntentDecision> => {
    try {
      const response = await (options.fetcher ?? fetch)(
        "https://api.typesafe.ai/v1/systemone",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) return { kind: "fallback", reason: "unavailable" };
      return validateIntentResponse(
        await response.json(),
        requested,
        options.currentContext(),
      );
    } catch {
      return {
        kind: "fallback",
        reason: controller.signal.aborted ? "timeout" : "unavailable",
      };
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
