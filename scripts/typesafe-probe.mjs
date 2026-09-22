import { intentRequest } from "../packages/core/src/ai-intent.ts";
import { requestTypesafeIntent } from "../workers/typesafe-intent.ts";
const live = process.argv.includes("--live");
const utterance =
  process.argv.find((a) => a.startsWith("--utterance="))?.slice(12) ||
  "もう少し静かにして";
const context = { revision: 1, soundOn: true, volume: 35, audioPending: false };
if (!live) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        networkRequests: 0,
        request: intentRequest(utterance, context),
      },
      null,
      2,
    ),
  );
} else {
  if (!process.env.TYPESAFE_API_KEY)
    throw new Error(
      "Set TYPESAFE_API_KEY in the local process environment. Do not paste it into chat.",
    );
  const start = performance.now();
  const result = await requestTypesafeIntent({
    utterance,
    context,
    currentContext: () => context,
    apiKey: process.env.TYPESAFE_API_KEY,
  });
  console.log(
    JSON.stringify(
      {
        mode: "live-single-request",
        elapsedMs: Math.round(performance.now() - start),
        result,
      },
      null,
      2,
    ),
  );
}
