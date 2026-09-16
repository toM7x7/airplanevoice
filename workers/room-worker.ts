import { DurableObject } from "cloudflare:workers";
import {
  changeRoom,
  advanceExhibition,
  nextRoomAlarm,
  newRoom,
  ROOM_PROTOCOL,
  type RoomState,
} from "../packages/core/src/shared-room";
import { visitorKey } from "../packages/core/src/room-access";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const digest = async (key: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

// Allocation is separately bounded; per-room edits never go through this object.
export class RoomDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS allocations (ip TEXT, at INTEGER)",
    );
  }
  allocate(ip: string) {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM allocations WHERE at < ?",
      now - 86400000,
    );
    const total = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM allocations")
      .one().n;
    const personal = this.ctx.storage.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM allocations WHERE ip = ? AND at > ?",
        ip,
        now - 600000,
      )
      .one().n;
    if (total >= 24 || personal >= 4) return false;
    this.ctx.storage.sql.exec("INSERT INTO allocations VALUES (?, ?)", ip, now);
    return true;
  }
}

export class SkyRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, state TEXT, keyhash TEXT)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS visitor_access (id INTEGER PRIMARY KEY, keyhash TEXT)",
    );
  }
  private read() {
    return this.ctx.storage.sql
      .exec<{ state: string; keyhash: string }>(
        "SELECT state,keyhash FROM room WHERE id=1",
      )
      .toArray()[0];
  }
  async initialize(keyhash: string, viewhash?: string) {
    if (this.read()) throw new Error("Room already exists");
    const state = newRoom(Date.now(), !!viewhash);
    this.ctx.storage.sql.exec(
      "INSERT INTO room VALUES (1,?,?)",
      JSON.stringify(state),
      keyhash,
    );
    if (viewhash)
      this.ctx.storage.sql.exec(
        "INSERT INTO visitor_access VALUES (1,?)",
        viewhash,
      );
    await this.ctx.storage.setAlarm(state.expiresAt);
  }
  async fetch(request: Request) {
    const row = this.read();
    if (!row)
      return json({ error: "部屋が見つからないか、期限が切れました。" }, 404);
    const state = JSON.parse(row.state) as RoomState;
    if (state.expiresAt <= Date.now())
      return json({ error: "部屋の期限が切れました。" }, 410);
    const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
      .split(",")
      .map((s) => s.trim());
    const key = protocols.find((s) => s.startsWith("key."))?.slice(4) ?? "";
    const viewhash = this.ctx.storage.sql
      .exec<{ keyhash: string }>(
        "SELECT keyhash FROM visitor_access WHERE id=1",
      )
      .toArray()[0]?.keyhash;
    if (!protocols.includes(ROOM_PROTOCOL) || !/^[a-f0-9]{64}$/.test(key))
      return json({ error: "招待URLを確認してください。" }, 403);
    const hash = await digest(key);
    const matches = (expected: string) =>
      crypto.subtle.timingSafeEqual(
        new TextEncoder().encode(hash),
        new TextEncoder().encode(expected),
      );
    const editor = matches(row.keyhash);
    const viewer = matches(viewhash ?? "0".repeat(64));
    if (!editor && !viewer)
      return json({ error: "招待URLを確認してください。" }, 403);
    // Authentication can yield across the expiry alarm.
    const fresh = this.read();
    if (
      !fresh ||
      (JSON.parse(fresh.state) as RoomState).expiresAt <= Date.now()
    )
      return json({ error: "この展示は終了しました。" }, 410);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return json({ error: "WebSocket required" }, 426);
    if (this.ctx.getWebSockets().length >= 4)
      return json({ error: "この部屋は満員です。" }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      window: Date.now(),
      count: 0,
      role: editor ? "editor" : "viewer",
    });
    // Authentication yields: another socket may have edited in the meantime.
    this.broadcast(JSON.parse(this.read()!.state));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": ROOM_PROTOCOL },
    });
  }
  private broadcast(state: RoomState, ack?: string, closed?: WebSocket) {
    const sockets = this.ctx
      .getWebSockets()
      .filter((socket) => socket !== closed);
    const body = {
      type: "state",
      state,
      peers: sockets.length,
      serverNow: Date.now(),
      ack,
    };
    for (const socket of sockets) {
      try {
        // Keep the v1 state envelope readable by already-open clients.
        const role =
          (socket.deserializeAttachment() as { role?: string }).role ??
          "editor";
        socket.send(JSON.stringify({ ...body, role }));
      } catch {
        socket.close(1011, "Reconnect");
      }
    }
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 14000) {
      socket.close(1009, "Message too large");
      return;
    }
    const rate = socket.deserializeAttachment() as {
      window: number;
      count: number;
      role?: "editor" | "viewer";
    };
    if (Date.now() - rate.window > 10000) {
      rate.window = Date.now();
      rate.count = 0;
    }
    rate.count++;
    socket.serializeAttachment(rate);
    if (rate.count > 60) {
      socket.close(1008, "Too many operations");
      return;
    }
    const row = this.read();
    if (!row) {
      socket.close(1008, "Room expired");
      return;
    }
    const state = JSON.parse(row.state) as RoomState;
    if (Date.now() >= state.expiresAt) {
      socket.close(1008, "Room expired");
      return;
    }
    let op: { id?: string; type?: string; sentAt?: number } = {};
    try {
      op = JSON.parse(message);
      if (op.type === "ping") {
        if (!Number.isFinite(op.sentAt)) throw new Error("Invalid ping");
        socket.send(
          JSON.stringify({
            type: "pong",
            sentAt: op.sentAt,
            serverNow: Date.now(),
          }),
        );
        return;
      }
      if (rate.role === "viewer")
        throw new Error("観覧用の入口です。飛行の準備は運営が行います。");
      const now = Date.now();
      const next = advanceExhibition(changeRoom(state, op, now), now);
      if (next !== state)
        this.ctx.storage.sql.exec(
          "UPDATE room SET state=? WHERE id=1",
          JSON.stringify(next),
        );
      // Persist synchronously before yielding; the next alarm reads the newest state.
      await this.ctx.storage.setAlarm(nextRoomAlarm(next, now));
      this.broadcast(next, op.id);
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "rejected",
          id: op?.id,
          error:
            error instanceof Error
              ? error.message
              : "操作を反映できませんでした。",
          state: this.read() ? JSON.parse(this.read()!.state) : state,
          serverNow: Date.now(),
        }),
      );
    }
  }
  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
    const row = this.read();
    if (row) this.broadcast(JSON.parse(row.state), undefined, socket);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Reconnect");
  }
  async alarm() {
    const row = this.read();
    if (!row) return;
    const state = JSON.parse(row.state) as RoomState;
    const now = Date.now();
    if (now < state.expiresAt) {
      const next = advanceExhibition(state, now);
      if (next !== state) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET state=? WHERE id=1",
          JSON.stringify(next),
        );
        this.broadcast(next);
      }
      await this.ctx.storage.setAlarm(nextRoomAlarm(next, now));
      return;
    }
    for (const socket of this.ctx.getWebSockets())
      socket.close(1008, "Room expired");
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Same-origin only; Vite proxies local API requests without changing Origin.
    const origin = request.headers.get("Origin");
    if (
      origin &&
      origin !== url.origin &&
      !(
        url.hostname === "127.0.0.1" &&
        /^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(origin)
      )
    )
      return json({ error: "Origin not allowed" }, 403);
    try {
      if (url.pathname === "/api/health")
        return json({ protocol: ROOM_PROTOCOL, status: "ready" });
      if (url.pathname === "/api/rooms" && request.method === "POST") {
        const ip = await digest(
          request.headers.get("CF-Connecting-IP") ?? "local",
        );
        if (!(await env.DIRECTORY.getByName("allocation-v1").allocate(ip)))
          return json(
            {
              error:
                "部屋の作成上限です。既存の招待URLを使うか、時間をおいて試してください。",
            },
            429,
          );
        const id = crypto.randomUUID();
        const key = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        const exhibition = url.searchParams.get("exhibition") === "1";
        await env.ROOMS.getByName(id).initialize(
          await digest(key),
          exhibition ? await digest(await visitorKey(key)) : undefined,
        );
        return json({ id, key }, 201);
      }
      const id = /^\/api\/rooms\/([a-f0-9-]{36})\/connect$/.exec(
        url.pathname,
      )?.[1];
      if (id) return env.ROOMS.getByName(id).fetch(request);
      return json({ error: "Not found" }, 404);
    } catch {
      return json(
        {
          error:
            "共有サービスに接続できませんでした。時間をおいて試してください。",
        },
        503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
