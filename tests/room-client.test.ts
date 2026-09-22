import { afterEach, expect, it, vi } from "vitest";
import { RoomClient } from "../apps/desktop/src/room-client";
import { newRoom, newCloudExhibition, CLOUD_EXHIBITION_ID } from "../packages/core/src/shared-room";
import {
  tableFrameId,
  type SpatialPresence,
} from "../packages/core/src/room-presence";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("joins the fixed cloud instance and waits for a save acknowledgement or rejection", async () => {
  class Socket {
    static OPEN = 1; static instance: Socket; readyState = 1;
    onmessage: ((event: {data: string}) => void) | null = null;
    send = vi.fn(); close = vi.fn();
    constructor(public url: URL, public protocols: string[]) { Socket.instance = this; }
    receive(body: unknown) { this.onmessage?.({data: JSON.stringify(body)}); }
  }
  vi.stubGlobal("window",new EventTarget()); vi.stubGlobal("WebSocket",Socket);
  vi.stubGlobal("location",new URL("https://test.invalid/?shared=1"));
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({id:CLOUD_EXHIBITION_ID,persistent:true})));
  const client = new RoomClient();
  try {
    await client.openExhibition();
    expect(Socket.instance.url.pathname).toBe("/api/exhibition/connect");
    expect(Socket.instance.protocols).toHaveLength(1);
    expect(client.invite).toBe("https://test.invalid/?shared=1");
    const state = newCloudExhibition(Date.now());
    Socket.instance.receive({type:"state",role:"editor",state,serverNow:Date.now()});
    const entry = {id:"saved-aircraft",name:"同期",recipe:state.draft};
    let finished = false;
    const saved = client.saveHangar(entry,null).then(()=>{finished=true});
    await Promise.resolve(); expect(finished).toBe(false);
    const op = JSON.parse(Socket.instance.send.mock.calls.at(-1)![0]);
    expect(op.expected).toBeNull();
    Socket.instance.receive({type:"state",state:{...state,hangar:[entry],recentOperations:[op.id]},ack:op.id,serverNow:Date.now()});
    await saved; expect(finished).toBe(true);
    const failed = client.saveHangar({...entry,name:"変更"},entry);
    const rejected = expect(failed).rejects.toThrow("競合");
    const id = JSON.parse(Socket.instance.send.mock.calls.at(-1)![0]).id;
    Socket.instance.receive({type:"rejected",id,error:"競合",state,serverNow:Date.now()});
    await rejected;
  } finally { client.dispose(); }
});

it("times out a socket that opens without receiving its room snapshot", () => {
  vi.useFakeTimers();
  class Socket {
    static OPEN = 1; static instance: Socket; readyState=1;
    onopen:(()=>void)|null=null; onclose:((event:{code:number})=>void)|null=null;
    send=vi.fn(); close=vi.fn(()=>this.onclose?.({code:1006}));
    constructor(){Socket.instance=this;}
  }
  vi.stubGlobal("window",new EventTarget()); vi.stubGlobal("WebSocket",Socket); vi.stubGlobal("location",new URL("https://test.invalid/"));
  const client=new RoomClient();client.join("12345678-1234-1234-1234-123456789012","0".repeat(64));
  Socket.instance.onopen?.();vi.advanceTimersByTime(12001);
  expect(Socket.instance.close).toHaveBeenCalled();expect(client.snapshot.status).toBe("offline");
  client.reconnect();expect(client.snapshot.error).toBe("");expect(client.snapshot.status).toBe("connecting");client.dispose();
});

it("sends only local presence on heartbeat, preserves pending edits, and clears peers on reconnect", () => {
  vi.useFakeTimers();
  class Socket {
    static OPEN = 1;
    static instance: Socket;
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      Socket.instance = this;
    }
    receive(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
  }
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", new URL("https://test.invalid/"));
  const client = new RoomClient();
  const presence: SpatialPresence = {
    mode: "ar",
    calibration: "aligned",
    frame: tableFrameId(),
    checkErrorM: 0.01,
  };
  client.setPresence(presence);
  client.join("12345678-1234-1234-1234-123456789012", "0".repeat(64));
  const socket = Socket.instance;
  socket.onopen?.();
  expect(JSON.parse(socket.send.mock.calls[0][0]).presence).toEqual(presence);
  const state = newRoom(Date.now());
  socket.receive({
    type: "state",
    role: "editor",
    state,
    serverNow: Date.now(),
    selfId: "one",
    participants: [{ id: "one", presence, updatedAt: Date.now() }],
    peers: 1,
  });
  client.send({ type: "launch" });
  expect(client.snapshot.pending).toBe(true);
  socket.receive({
    type: "pong",
    sentAt: performance.now(),
    serverNow: Date.now(),
    selfId: "one",
    participants: [{ id: "one", presence, updatedAt: Date.now() }],
    peers: 1,
  });
  expect(client.snapshot.pending).toBe(true);
  expect(client.snapshot.state).toEqual(state);
  expect(client.snapshot.participants).toHaveLength(1);
  client.reconnect();
  expect(client.snapshot.participants).toHaveLength(0);
  expect(client.snapshot.selfId).toBe("");
  Socket.instance.onopen?.();
  expect(JSON.parse(Socket.instance.send.mock.calls[0][0]).presence).toEqual(
    presence,
  );
  client.dispose();
});

it("blocks visitor operator mutations and permits participant work submission", () => {
  class Socket {
    static OPEN = 1;
    static instance: Socket;
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      Socket.instance = this;
    }
  }
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", new URL("https://test.invalid/"));
  const client = new RoomClient(),
    state = newRoom(Date.now(), true);
  client.join("12345678-1234-1234-1234-123456789012", "0".repeat(64));
  Socket.instance.onmessage?.({
    data: JSON.stringify({
      type: "state",
      role: "viewer",
      state,
      peers: 1,
      serverNow: Date.now(),
    }),
  });
  expect(client.snapshot.status).toBe("connected");
  expect(client.snapshot.role).toBe("viewer");
  expect(Socket.instance.close).not.toHaveBeenCalled();
  client.send({ type: "repeat", enabled: true });
  client.send({ type: "edit", recipe: state.draft });
  expect(Socket.instance.send).not.toHaveBeenCalled();
  const id = client.send({type:"create-entry",entry:{id:"local-aircraft",name:"そら",recipe:state.draft}});
  expect(id).toBeTruthy();
  expect(JSON.parse(Socket.instance.send.mock.calls[0][0]).type).toBe("create-entry");
  expect(client.snapshot.pending).toBe(true);
  client.dispose();
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
