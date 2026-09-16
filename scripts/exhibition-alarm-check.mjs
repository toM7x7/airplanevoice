import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

// Use only the test-owned room recorded by exhibition-check. Never accept an ambient invitation.
const out = process.env.EXHIBITION_OUTPUT || "output/exhibition";
const { operator } = JSON.parse(
  await fs.readFile(`${out}/invite.json`, "utf8"),
);
const url = new URL(operator);
const endpoint = new URL(
  `/api/rooms/${url.searchParams.get("room")}/connect`,
  url,
);
endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(endpoint, [
  "airplanevoice-room-v1",
  `key.${new URLSearchParams(url.hash.slice(1)).get("key")}`,
]);
const messages = [];
let disconnected = false;
socket.addEventListener("close", () => {
  disconnected = true;
});
socket.addEventListener("message", (e) => messages.push(JSON.parse(e.data)));
async function receive(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (disconnected)
      throw new Error(
        "Test socket disconnected; do not rebuild or reload Wrangler during the real alarm test",
      );
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Exhibition alarm response timed out");
}
let state;
async function send(operation) {
  const id = randomUUID();
  socket.send(JSON.stringify({ ...operation, id, revision: state.revision }));
  const response = await receive((m) => m.ack === id || m.id === id);
  assert.notEqual(response.type, "rejected", response.error);
  state = response.state;
}
try {
  state = (await receive((m) => m.type === "state")).state;
  const recipe = structuredClone(state.draft);
  Object.assign(recipe.route, {
    a: { x: -400, z: -600 },
    b: { x: 400, z: -600 },
    widthM: 400,
    variation: 0,
    altitudeM: 140,
  });
  recipe.flight.speedMps = 35;
  await send({ type: "edit", recipe });
  await send({ type: "repeat", enabled: true });
  const current = state.flights.at(-1);
  const timeout = current.clearAt - Date.now() + 30000;
  assert(
    timeout < 240000,
    "Test flight must be short enough for a bounded real alarm check",
  );
  console.log(
    "Waiting for the real server alarm; no client flight command will be sent.",
  );
  const next = (
    await receive(
      (m) => m.type === "state" && m.state.flights[0]?.id !== current.id,
      Math.max(30000, timeout),
    )
  ).state;
  assert.equal(next.flights.length, 1);
  assert(next.flights[0].startsAt >= current.clearAt);
  assert.deepEqual(next.flights[0].recipe, recipe);
  state = next;
  await send({ type: "repeat", enabled: false });
  console.log(
    "OK Real Durable Object alarm advances one flight using the edited recipe, then accepts stopping repetition",
  );
  await fs.writeFile(
    `${out}/alarm-result.json`,
    JSON.stringify(
      {
        automaticFlight: true,
        nextRecipe: true,
        stopped: !state.exhibition.repeat,
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
