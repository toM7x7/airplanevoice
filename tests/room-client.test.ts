import { afterEach, expect, it, vi } from "vitest";
import { RoomClient } from "../apps/desktop/src/room-client";
import { newRoom } from "../packages/core/src/shared-room";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("re-anchors time after a suspended client reconnects and forgets old latency samples", () => {
  vi.useFakeTimers();
  let tick = 100;
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor() {
      Socket.instances.push(this);
    }
    send() {}
    close() {}
    receive(value: unknown) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("performance", { now: () => tick });
  vi.stubGlobal("location", new URL("https://test.invalid/"));
  const client = new RoomClient(),
    epoch = 1_800_000_000_000,
    state = newRoom(epoch);
  client.join("12345678-1234-1234-1234-123456789012", "0".repeat(64));
  const first = Socket.instances[0];
  first.receive({ type: "state", state, peers: 1, serverNow: epoch });
  first.receive({ type: "pong", sentAt: 99, serverNow: epoch });
  expect(client.now()).toBe(epoch + 0.5);
  // The device slept, but its performance clock advanced only a little.
  tick += 100;
  client.reconnect();
  const second = Socket.instances[1];
  second.receive({ type: "state", state, peers: 1, serverNow: epoch + 600000 });
  expect(client.now()).toBe(epoch + 600000);
  // A fresh slower RTT must replace the old fast pre-sleep clock sample.
  second.receive({ type: "pong", sentAt: 190, serverNow: epoch + 600020 });
  expect(client.now()).toBe(epoch + 600025);
  first.receive({ type: "state", state, peers: 1, serverNow: epoch });
  expect(client.now()).toBe(epoch + 600025);
  client.dispose();
});
