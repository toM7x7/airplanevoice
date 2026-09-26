import { AiError, readJson } from "./ai-provider";
import { parseTrialContext, isRecord } from "../packages/core/src/ai-trial";
export const aiJson = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
export async function trialAuthorized(request: Request, secret?: string) {
  const token =
    request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 32 || token.length > 256) return false;
  const hash = async (v: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    );
  const [a, b] = await Promise.all([hash(token), hash(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function handleAi(request: Request, env: Env): Promise<Response> {
  const publicDemo = env.AI_PUBLIC_DEMO === "true";
  if (
    new URL(request.url).pathname === "/api/ai/access" &&
    request.method === "GET"
  )
    return aiJson({ publicDemo });
  if (!publicDemo && !(await trialAuthorized(request, env.AI_TRIAL_TOKEN)))
    return aiJson({ error: "AI試用の入場キーが必要です。" }, 401);
  const client = request.headers.get("X-AI-Client") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(client))
    return aiJson({ error: "試用画面を開き直してください。" }, 400);
  const route = new URL(request.url).pathname.replace("/api/ai", "");
  // Prepared PC and Quest tabs must not lock each other out before a conversation.
  const trial = env.AI_TRIAL.getByName(
    publicDemo ? `demo-${client}` : "operator-trial-v1",
  );
  try {
    if (route === "/status" && request.method === "GET")
      return aiJson(await trial.status());
    if (request.method !== "POST")
      return aiJson({ error: "この操作は対応していません。" }, 405);
    if (route === "/live/close") {
      await trial.close(client);
      return aiJson(await trial.status());
    }
    if (route === "/stop") {
      await trial.stop(client);
      return aiJson(await trial.status());
    }
    const body = await readJson(request);
    if (!isRecord(body)) throw new AiError("入力が不正です。", 400);
    if (route === "/context") {
      await trial.context(client, parseTrialContext(body.context));
      return aiJson(await trial.status());
    }
    if (route === "/observe") {
      await trial.observe(client, body.on === true);
      return aiJson(await trial.status());
    }
    if (route === "/action-result") {
      if (
        typeof body.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.id) ||
        typeof body.ok !== "boolean"
      )
        throw new AiError("操作結果が不正です。", 400);
      return aiJson(
        await trial.actionResult(
          client,
          body.id,
          body.ok,
          parseTrialContext(body.context),
        ),
      );
    }
    if (route === "/ask") {
      if (
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 500 ||
        typeof body.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.id)
      )
        throw new AiError("相談は500文字以内で入力してください。", 400);
      return aiJson(await trial.ask(client, body.id, body.text));
    }
    if (route === "/live") {
      if (
        typeof body.sdp !== "string" ||
        body.sdp.length > 32000 ||
        !body.sdp.startsWith("v=0") ||
        typeof body.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.id)
      )
        throw new AiError("音声の接続情報が不正です。", 400);
      return aiJson(await trial.live(client, body.id, body.sdp), 201);
    }
    if (route === "/check") return aiJson(await trial.check(client));
    return aiJson({ error: "見つかりません。" }, 404);
  } catch (e) {
    return aiJson(
      {
        error:
          e instanceof Error
            ? e.message.slice(0, 220)
            : "AI試用に接続できませんでした。",
      },
      e instanceof AiError ? e.status : 400,
    );
  }
}
