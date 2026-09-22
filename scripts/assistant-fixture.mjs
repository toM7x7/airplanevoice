// Local UI fixture only. Serves the real build; never calls an AI provider.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("dist");
let context, reply = null;
const results = [];
const requests = [];
const status = () => ({ enabled: true, expiresAt: null,
  configured: { openai: true, typesafe: true },
  limits: { observations: null, replies: null, conversations: null, voiceSeconds: null, observationMs: 10000, staleMs: 20000 },
  used: { observations: 0, replies: requests.filter(r => r === "ask").length, conversations: 0 },
  observer: { on: false, note: "ローカル検証用の観察です。", at: 0, error: "" },
  live: { status: "idle", deadline: null, seconds: null, error: "" }, reply });
const commands = {
  "音量の変え方を教えて": { mode: "guide", control: "volume", value: "25" },
  "音量を25にして": { mode: "apply", control: "volume", value: "25" },
  "3機にして": { mode: "apply", control: "fleet", value: "3" },
  "飛ばして": { mode: "apply", control: "flight", value: "start" },
  "ひと休みして": { mode: "apply", control: "flight", value: "pause" },
  "ST-02を見せて": { mode: "apply", control: "aircraft", value: "ST-02" },
  "共有の飛行を開始して": { mode: "apply", control: "flight", value: "start" },
};
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname === "/__results") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/__results") return res.end(JSON.stringify({ context, results, requests }));
    const route = url.pathname.replace("/api/ai/", ""); requests.push(route);
    if (route.startsWith("live")) { res.statusCode = 503; return res.end(JSON.stringify({ error: "音声APIはこの検証では使いません。" })); }
    let data = ""; for await (const part of req) data += part;
    const body = data ? JSON.parse(data) : {};
    if (route === "context") context = body.context;
    if (route === "ask") {
      const action = commands[body.text];
      reply = { id: crypto.randomUUID(), guide: "none", revision: context.revision,
        text: "画面の操作を確認しています。", command: { id: crypto.randomUUID(), action, expiresAt: Date.now() + 30000 } };
      return res.end(JSON.stringify(reply));
    }
    if (route === "action-result") {
      results.push(body);
      reply = { ...reply, text: body.ok ? "操作結果を確認しました。" : "操作できませんでした。" };
      delete reply.command;
      return res.end(JSON.stringify({ text: reply.text }));
    }
    return res.end(JSON.stringify(status()));
  }
  const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(4894, "127.0.0.1", () => console.log("Local AI-free assistant fixture: http://127.0.0.1:4894/?ai=trial"));
