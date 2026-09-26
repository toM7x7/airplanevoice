// Local-only regression: no OpenAI/TypeSafe calls or credentials.
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { WebSocketServer } from "ws";
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve) => server.once("listening", resolve));
server.on("connection", (socket) => socket.on("error", () => {}));
let mf;
try {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2026-09-16",
    script: `export default {async fetch(req) {
      const fixed = new URL(req.url).pathname === '/fixed';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 400);
      const response = await fetch('http://127.0.0.1:${server.address().port}', {
        headers: {Upgrade:'websocket'}, signal:controller.signal
      });
      if (fixed) clearTimeout(timer);
      const socket = response.webSocket;
      const events = [];
      socket.addEventListener('close',e => events.push('close:' + e.code));
      socket.addEventListener('error',() => events.push('error'));
      socket.accept();
      await new Promise(resolve => setTimeout(resolve, 1100));
      const result = {fixed, aborted:controller.signal.aborted, state:socket.readyState, events};
      try {socket.close();} catch {}
      return Response.json(result);
    }}`,
  }));
  const before = await (await mf.dispatchFetch("http://test/old")).json();
  const after = await (await mf.dispatchFetch("http://test/fixed")).json();
  console.log(JSON.stringify({ before, after }, null, 2));
  assert.equal(after.aborted, false);
  assert.equal(after.state, 1);
  assert.deepEqual(after.events, []);
} finally {
  await mf?.dispose();
  for (const client of server.clients) client.terminate();
  await new Promise((resolve) => server.close(resolve));
}
