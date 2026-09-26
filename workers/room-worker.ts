import { DurableObject } from "cloudflare:workers";
import {
  changeRoom,
  advanceExhibition,
  nextRoomAlarm,
  newRoom,
  newCloudExhibition,
  CLOUD_EXHIBITION_ID,
  ROOM_PROTOCOL,
  type RoomState,
} from "../packages/core/src/shared-room";
import { visitorKey } from "../packages/core/src/room-access";
import {
  checkedPresence,
  type RoomParticipant,
  type SpatialPresence,
} from "../packages/core/src/room-presence";
import { handleAi } from "./ai-routes";
import {
  DEFAULT_TRAFFIC,
  recordTraffic,
  trafficGapMs,
} from "../packages/core/src/traffic";
import { requestTrafficDecision } from "./traffic-agent";
import { trafficAssessment } from "../packages/core/src/traffic-analysis";
export { AiTrial } from "./ai-trial";

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
  async openExhibition() {
    // Fixed instance. Synchronous write before any await prevents competing initializers.
    const existing = this.read();
    if (!existing) {
      const state = newCloudExhibition(Date.now());
      this.ctx.storage.sql.exec(
        "INSERT INTO room VALUES (1,?,?)",
        JSON.stringify(state),
        "public-exhibition",
      );
    } else if (!(JSON.parse(existing.state) as RoomState).persistent) {
      throw new Error("Exhibition instance mismatch");
    }
    const state = JSON.parse(this.read()!.state) as RoomState;
    if (!state.traffic) {
      state.traffic = { ...DEFAULT_TRAFFIC };
      state.revision++;
      this.ctx.storage.sql.exec(
        "UPDATE room SET state=? WHERE id=1",
        JSON.stringify(state),
      );
    }
    await this.ctx.storage.setAlarm(nextRoomAlarm(state, Date.now()));
    return { id: CLOUD_EXHIBITION_ID, persistent: true };
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
    const publicExhibition =
      state.persistent === true &&
      new URL(request.url).pathname === "/api/exhibition/connect";
    if (
      !protocols.includes(ROOM_PROTOCOL) ||
      (!publicExhibition && !/^[a-f0-9]{64}$/.test(key))
    )
      return json({ error: "招待URLを確認してください。" }, 403);
    const hash = await digest(key);
    const matches = (expected: string) =>
      expected.length === hash.length &&
      crypto.subtle.timingSafeEqual(
        new TextEncoder().encode(hash),
        new TextEncoder().encode(expected),
      );
    const editor = publicExhibition || matches(row.keyhash);
    const viewer = !publicExhibition && matches(viewhash ?? "0".repeat(64));
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
      id: crypto.randomUUID(),
      slot:
        [1, 2, 3, 4].find(
          (n) =>
            !this.ctx
              .getWebSockets()
              .some(
                (s) => s !== server && s.deserializeAttachment()?.slot === n,
              ),
        ) ?? 4,
      presence: null,
      updatedAt: Date.now(),
    });
    // Authentication yields: another socket may have edited in the meantime.
    this.broadcast(JSON.parse(this.read()!.state));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": ROOM_PROTOCOL },
    });
  }
  private participants(closed?: WebSocket): RoomParticipant[] {
    return this.ctx
      .getWebSockets()
      .filter((s) => s !== closed)
      .map((socket, i) => {
        const a = socket.deserializeAttachment() as Partial<RoomParticipant>;
        return {
          id: a.id ?? `legacy-${i}`,
          slot: a.slot ?? i + 1,
          role: a.role ?? "editor",
          presence: a.presence ?? null,
          updatedAt: a.updatedAt ?? 0,
        };
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
      participants: this.participants(closed),
    };
    for (const socket of sockets) {
      try {
        // Keep the v1 state envelope readable by already-open clients.
        const role =
          (socket.deserializeAttachment() as { role?: string }).role ??
          "editor";
        socket.send(
          JSON.stringify({
            ...body,
            role,
            selfId: socket.deserializeAttachment()?.id ?? "",
          }),
        );
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
      id?: string;
      slot?: number;
      presence?: SpatialPresence | null;
      updatedAt?: number;
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
    let op: {
      id?: string;
      type?: string;
      sentAt?: number;
      presence?: unknown;
    } = {};
    try {
      op = JSON.parse(message);
      if (op.type === "ping") {
        if (!Number.isFinite(op.sentAt)) throw new Error("Invalid ping");
        const presence =
          op.presence === undefined
            ? rate.presence
            : checkedPresence(op.presence);
        const changed =
          JSON.stringify(presence) !== JSON.stringify(rate.presence);
        rate.presence = presence;
        rate.updatedAt = Date.now();
        socket.serializeAttachment(rate);
        socket.send(
          JSON.stringify({
            type: "pong",
            sentAt: op.sentAt,
            serverNow: Date.now(),
            participants: this.participants(),
            selfId: rate.id ?? "",
            peers: this.ctx.getWebSockets().length,
          }),
        );
        // Presence does not edit the room or reschedule its flight alarm.
        if (changed) this.broadcast(state);
        return;
      }
      if (
        rate.role === "viewer" &&
        op.type !== "create-flight" &&
        op.type !== "create-entry"
      )
        throw new Error(
          "来場者の入口です。共有の設定変更は運営が行います。自分の一機は制作画面から飛ばせます。",
        );
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
  webSocketClose(socket: WebSocket) {
    // Compatibility date >= 2026-04-07 auto-replies to Close frames.
    // Echoing a peer's reserved code (e.g. 1005) throws before presence is broadcast.
    const row = this.read();
    if (row) this.broadcast(JSON.parse(row.state), undefined, socket);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Reconnect");
  }
  async alarm() {
    const row = this.read();
    if (!row) return;
    let state = JSON.parse(row.state) as RoomState;
    let now = Date.now();
    if (now < state.expiresAt) {
      if (
        state.traffic?.jev &&
        (state.traffic.automaticIds === undefined ||
          (state.hangar ?? []).some((e) =>
            state.traffic!.automaticIds!.includes(e.id),
          )) &&
        state.exhibition?.repeat &&
        this.ctx.getWebSockets().length &&
        now - (state.trafficAgent?.requestedAt ?? -Infinity) >= 30_000
      ) {
        // Persist the attempt before external I/O. Never hold the room lock across the provider call.
        const revision = state.revision;
        state.trafficAgent = {
          requestedAt: now,
          requests:
            (state.trafficAgent?.requests ?? 0) +
            (this.env.TYPESAFE_API_KEY ? 1 : 0),
          status: "waiting",
        };
        this.ctx.storage.sql.exec(
          "UPDATE room SET state=? WHERE id=1",
          JSON.stringify(state),
        );
        const assessment = trafficAssessment(state, now);
        let failure = "判断を取得できないため規則で継続";
        const decision = await requestTrafficDecision(
          state,
          now,
          this.env.TYPESAFE_API_KEY,
          (reason) => {
            failure = reason;
          },
        );
        const fresh = this.read();
        if (!fresh) return;
        state = JSON.parse(fresh.state) as RoomState;
        const valid =
          state.traffic?.jev &&
          state.exhibition?.repeat &&
          state.revision === revision;
        if (valid) state.trafficDecision = decision ?? undefined;
        if (state.trafficAgent)
          state.trafficAgent.status = !valid
            ? "stale"
            : decision
              ? "active"
              : "fallback";
        recordTraffic(state, {
          at: Date.now(),
          source: "jev",
          status: !valid ? "discarded" : decision ? "selected" : "fallback",
          note: !valid
            ? "判断中に運営設定が変わったため採用せず"
            : (decision?.note ?? failure),
          gapSec: valid && decision ? trafficGapMs(decision) / 1000 : undefined,
          closePairs: assessment.closePairs,
          soundOverlap: assessment.soundOverlap,
        });
        this.ctx.storage.sql.exec(
          "UPDATE room SET state=? WHERE id=1",
          JSON.stringify(state),
        );
        now = Date.now();
      }
      const next = advanceExhibition(state, now);
      if (next !== state) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET state=? WHERE id=1",
          JSON.stringify(next),
        );
      }
      this.broadcast(next);
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
      if (url.pathname.startsWith("/api/ai/"))
        return await handleAi(request, env);
      if (url.pathname === "/api/health")
        return json({ protocol: ROOM_PROTOCOL, status: "ready" });
      if (url.pathname === "/api/exhibition" && request.method === "POST")
        return json(
          await env.ROOMS.getByName(CLOUD_EXHIBITION_ID).openExhibition(),
        );
      if (url.pathname === "/api/exhibition/connect")
        return env.ROOMS.getByName(CLOUD_EXHIBITION_ID).fetch(request);
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
