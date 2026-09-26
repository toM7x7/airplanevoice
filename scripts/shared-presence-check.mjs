import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Creates one temporary room. Uses no microphone and calls no AI provider.
const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const output = process.env.PRESENCE_OUTPUT || "output/presence/results.json";
const sockets = [];
const checks = [];
const ok = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
async function waitFor(peer, predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const found = peer.messages.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for room presence");
}
async function connect(id, key) {
  const url = new URL(`/api/rooms/${id}/connect`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url, ["airplanevoice-room-v1", `key.${key}`]);
  sockets.push(socket);
  const peer = { socket, messages: [] };
  socket.addEventListener("message", (e) =>
    peer.messages.push(JSON.parse(e.data)),
  );
  await waitFor(peer, (m) => m.type === "state");
  return peer;
}
try {
  const response = await fetch(new URL("/api/rooms?exhibition=1", base), {
    method: "POST",
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 201, "Could not create temporary room");
  const { id, key } = await response.json();
  const visitor = createHash("sha256")
    .update(`airplanevoice-visitor-v1:${key}`)
    .digest("hex");
  const editor = await connect(id, key);
  const viewer = await connect(id, visitor);
  const legacy = await connect(id, key);
  const initial = await waitFor(editor, (m) => m.peers === 3);
  assert.equal(new Set(initial.participants.map((p) => p.slot)).size, 3);
  ok("Three connections get distinct labels and a compatible state envelope");
  const send = (peer, body) => peer.socket.send(JSON.stringify(body));
  send(viewer, {
    type: "ping",
    sentAt: 17,
    id: initial.selfId,
    presence: {
      mode: "ar",
      calibration: "aligned",
      frame: "0.6/0.75",
      checkErrorM: 0.02,
      secret: "omit",
    },
  });
  const pong = await waitFor(
    viewer,
    (m) => m.type === "pong" && m.sentAt === 17,
  );
  const self = pong.participants.find((p) => p.id === pong.selfId);
  assert.equal(self.role, "viewer");
  assert.notEqual(self.id, initial.selfId);
  assert.equal(self.presence.secret, undefined);
  const broadcast = await waitFor(editor, (m) =>
    m.participants?.some(
      (p) => p.id === self.id && p.presence?.calibration === "aligned",
    ),
  );
  assert.deepEqual(broadcast.state, initial.state);
  ok(
    "Viewer reports its own calibration; shared revision and flight state stay unchanged",
  );
  send(legacy, { type: "ping", sentAt: 19 });
  assert.equal(
    (
      await waitFor(legacy, (m) => m.type === "pong" && m.sentAt === 19)
    ).participants.find((p) => p.id === legacy.messages[0].selfId).presence,
    null,
  );
  ok("Older clients can still ping without reporting spatial readiness");
  const invalidId = randomUUID();
  send(viewer, {
    type: "ping",
    id: invalidId,
    sentAt: 20,
    presence: { ...self.presence, checkErrorM: -1 },
  });
  await waitFor(viewer, (m) => m.type === "rejected" && m.id === invalidId);
  send(editor, { type: "ping", sentAt: 21 });
  assert.deepEqual(
    (
      await waitFor(editor, (m) => m.type === "pong" && m.sentAt === 21)
    ).participants.find((p) => p.id === self.id).presence,
    self.presence,
  );
  const editId = randomUUID();
  send(viewer, {
    type: "edit",
    id: editId,
    revision: initial.state.revision,
    recipe: initial.state.draft,
  });
  await waitFor(viewer, (m) => m.type === "rejected" && m.id === editId);
  ok(
    "Invalid diagnostics and viewer edits are rejected without corrupting presence",
  );
  send(viewer, { type: "ping", sentAt: 22, presence: { mode: "ar", calibration: "placed", frame: "1.2/0.75/0.6", checkErrorM: null } });
  const manual = await waitFor(viewer, m => m.type === "pong" && m.sentAt === 22);
  assert.deepEqual(manual.participants.find(p => p.id === self.id).presence,
    { mode: "ar", calibration: "placed", frame: "1.2/0.75/0.6", checkErrorM: null });
  const manualReport = await waitFor(editor, m => m.participants?.some(p => p.id === self.id && p.presence?.calibration === "placed"));
  assert.deepEqual(manualReport.state, initial.state);
  ok("Manual placement with rectangular dimensions stays distinct from measured alignment and preserves the room state");
  const closeEvent = new Promise((resolve) =>
    viewer.socket.addEventListener("close", resolve, { once: true }),
  );
  viewer.socket.close(1000);
  await closeEvent;
  await waitFor(
    editor,
    (m) => m.peers === 2 && !m.participants.some((p) => p.id === self.id),
  );
  const rejoined = await connect(id, visitor);
  const reentry = rejoined.messages[0];
  assert.notEqual(reentry.selfId, self.id);
  assert.equal(
    reentry.participants.find((p) => p.id === reentry.selfId).presence,
    null,
  );
  ok("Disconnect removes the report; a new connection starts uncalibrated");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify(
      { origin: new URL(base).origin, checks, aiCalls: 0 },
      null,
      2,
    ),
  );
} finally {
  for (const socket of sockets) socket.close(1000);
}
