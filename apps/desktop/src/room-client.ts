import type { HangarEntry } from "../../../packages/core/src/hangar";
import {
  ROOM_PROTOCOL,
  CLOUD_EXHIBITION_ID,
  type RoomState,
} from "../../../packages/core/src/shared-room";
import { visitorKey } from "../../../packages/core/src/room-access";
import type {
  RoomParticipant,
  SpatialPresence,
} from "../../../packages/core/src/room-presence";

export class RoomClient {
  constructor() {
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
  }
  private offline = () => {
    if (!this.id || this.disposed) return;
    this.update({
      status: "offline",
      pending: false,
      error:
        "通信が切れました。飛行は続きます。共有への変更は接続後に操作できます。",
    });
    this.socket?.close();
  };
  private online = () => {
    if (this.id && !this.disposed && this.snapshot.status !== "connected")
      this.reconnect();
  };
  snapshot = {
    role: "unknown" as "unknown" | "editor" | "viewer",
    status: "idle",
    state: null as RoomState | null,
    peers: 0,
    error: "",
    pending: false,
    rtt: null as number | null,
    participants: [] as RoomParticipant[],
    selfId: "",
  };
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private socket: WebSocket | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private attempts = 0;
  private key = "";
  private pendingId = "";
  private anchor = Date.now() - performance.now();
  private samples: { rtt: number; anchor: number }[] = [];
  private lastReply = performance.now();
  private presence: SpatialPresence | undefined;
  setPresence(presence: SpatialPresence) {
    if (JSON.stringify(presence) === JSON.stringify(this.presence)) return;
    this.presence = presence;
    this.ping();
  }
  id = "";
  get cloud() { return this.id === CLOUD_EXHIBITION_ID; }
  now = () => this.anchor + performance.now();
  get ready() {
    return this.snapshot.status === "connected" && !this.snapshot.pending;
  }
  get invite() {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("shared", "1");
    if (this.cloud) return url.href;
    url.searchParams.set("room", this.id);
    if (this.snapshot.role === "viewer") url.searchParams.set("visit", "1");
    url.hash = `key=${this.key}`;
    return url.href;
  }
  async visitorInvite() {
    if (this.cloud) return this.invite;
    if (this.snapshot.role !== "editor" || !this.snapshot.state?.exhibition)
      return "";
    const url = new URL(this.invite);
    url.searchParams.set("visit", "1");
    url.hash = `key=${await visitorKey(this.key)}`;
    return url.href;
  }
  async create(exhibition = false) {
    this.update({ status: "connecting", error: "" });
    try {
      const response = await fetch(
        exhibition ? "/api/rooms?exhibition=1" : "/api/rooms",
        {
          method: "POST",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error(
          "共有サーバーがまだ接続されていません。共有版のURLから開いてください。",
        );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      this.join(body.id, body.key);
      history.replaceState(null, "", this.invite);
    } catch (e) {
      this.update({
        status: "idle",
        error: e instanceof Error ? e.message : "部屋を作れませんでした。",
      });
    }
  }
  async openExhibition() {
    this.id = CLOUD_EXHIBITION_ID;
    this.key = "";
    this.update({ status: "connecting", error: "", role: "unknown", state: null });
    try {
      const response = await fetch("/api/exhibition", { method: "POST", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("展示空間へ接続できません。再接続をお試しください。");
      const body = await response.json();
      if (body.id !== CLOUD_EXHIBITION_ID) throw new Error("展示空間を確認できませんでした。");
      if (this.disposed) return;
      this.attempts = 0;
      this.connect();
    } catch (error) {
      this.update({ status: "failed", error: error instanceof Error ? error.message : "展示空間へ接続できませんでした。" });
    }
  }
  join(id: string, key: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(key)) {
      this.update({ status: "failed", error: "招待URLを確認してください。" });
      return;
    }
    this.id = id;
    this.key = key;
    this.update({ role: "unknown", state: null, participants: [], selfId: "" });
    this.attempts = 0;
    this.connect();
  }
  reconnect = () => {
    if (!this.id) return;
    if (this.cloud && !this.snapshot.state) { void this.openExhibition(); return; }
    this.attempts = 0;
    this.connect();
  };
  private connect() {
    if (this.disposed) return;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.handshake);
    clearInterval(this.heartbeat);
    this.pendingId = "";
    this.samples = [];
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    this.update({
      status: "connecting",
      pending: false,
      participants: [],
      selfId: "",
      rtt: null,
      error: "",
    });
    const url = new URL(this.cloud ? "/api/exhibition/connect" : `/api/rooms/${this.id}/connect`, location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, this.cloud ? [ROOM_PROTOCOL] : [ROOM_PROTOCOL, `key.${this.key}`]);
    this.socket = ws;
    // Opening a socket is not enough: wait for the authenticated room snapshot.
    this.handshake = setTimeout(() => {
      if (this.socket === ws && this.snapshot.status === "connecting") {
        this.update({ error: "部屋からの応答がありません。再接続を試しています。" });
        ws.close();
      }
    }, 12000);
    ws.onopen = () => {
      this.lastReply = performance.now();
      this.ping();
      this.heartbeat = setInterval(() => {
        if (performance.now() - this.lastReply > 45000) ws.close();
        else this.ping();
      }, 15000);
    };
    ws.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data);
        if (Array.isArray(body.participants))
          this.update({
            participants: body.participants,
            selfId: body.selfId ?? this.snapshot.selfId,
            peers: body.peers ?? this.snapshot.peers,
          });
        if (body.role !== undefined) {
          if (body.role !== "viewer" && body.role !== "editor")
            throw new Error("入室の種類を確認できませんでした。");
          this.update({ role: body.role });
        }
        this.lastReply = performance.now();
        if (body.type === "pong") {
          const rtt = performance.now() - body.sentAt;
          if (rtt < 0 || rtt > 10000 || !Number.isFinite(body.serverNow))
            return;
          this.samples = [
            ...this.samples.slice(-7),
            { rtt, anchor: body.serverNow + rtt / 2 - performance.now() },
          ];
          const best = this.samples.reduce((a, b) => (a.rtt < b.rtt ? a : b));
          this.anchor = best.anchor;
          this.update({ rtt: Math.round(rtt) });
          return;
        }
        if (body.state?.protocol !== ROOM_PROTOCOL)
          throw new Error(
            "共有版の更新が必要です。ページを読み込み直してください。",
          );
        if (this.snapshot.status !== "connected")
          this.anchor = body.serverNow - performance.now();
        clearTimeout(this.handshake);
        const acknowledged =
          body.ack === this.pendingId || body.id === this.pendingId;
        if (acknowledged) {
          this.pendingId = "";
          clearTimeout(this.timeout);
        }
        this.attempts = 0;
        this.update({
          status: "connected",
          state: body.state,
          peers: body.peers ?? this.snapshot.peers,
          pending: acknowledged ? false : this.snapshot.pending,
          error: body.type === "rejected" ? body.error : "",
        });
      } catch (e) {
        this.update({
          error:
            e instanceof Error ? e.message : "共有データを読めませんでした。",
        });
        ws.close(1008);
      }
    };
    ws.onclose = (event) => {
      clearTimeout(this.handshake);
      clearInterval(this.heartbeat);
      clearTimeout(this.timeout);
      if (this.disposed) return;
      this.attempts++;
      const expired =
        event.code === 1008 ||
        (this.snapshot.state && this.now() >= this.snapshot.state.expiresAt);
      const failed = expired || this.attempts >= 4;
      this.update({
        status: failed ? "failed" : "offline",
        pending: false,
        peers: 0,
        participants: [],
        error: expired
          ? "部屋が終了しました。新しい部屋から始められます。"
          : "接続が切れました。共有への変更は復帰後に操作してください。",
      });
      if (!failed)
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(15000, 1000 * 2 ** this.attempts),
        );
    };
    ws.onerror = () => {
      /* close handles bounded reconnection; never echo invitation credentials */
    };
  }
  private ping() {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({
          type: "ping",
          sentAt: performance.now(),
          presence: this.presence,
        }),
      );
  }
  send(
    input:
      | { type: "edit"; recipe: RoomState["draft"] }
      | { type: "launch" | "launch-hangar" | "cancel-next" },
  ): string | undefined;
  send(
    input:
      | {
          type: "hangar-save" | "create-flight" | "create-entry";
          entry: HangarEntry;
          expected?: HangarEntry | null;
        }
      | { type: "hangar-remove"; entryId: string },
  ): string | undefined;
  send(input: { type: "repeat"; enabled: boolean }): string | undefined;
  send(input:{type:"environment";environment:NonNullable<RoomState["environment"]>}):string|undefined;
  send(input: { type: "flight-instruction"; flightId: string; instruction: "overhead"|"wide"|"higher"; observer:{x:number;z:number} }): string | undefined;
  send(input: { type: "traffic"; settings: NonNullable<RoomState["traffic"]> }): string | undefined;
  send(input: {
    type: "venue";
    venue: NonNullable<RoomState["venue"]>;
  }): string | undefined;
  send(input: {
    type: string;
    entry?: HangarEntry;
    expected?: HangarEntry | null;
    entryId?: string;
    recipe?: RoomState["draft"];
    enabled?: boolean;
    environment?:NonNullable<RoomState["environment"]>;
    flightId?: string;
    instruction?: "overhead"|"wide"|"higher";
    observer?:{x:number;z:number};
    settings?: NonNullable<RoomState["traffic"]>;
    venue?: NonNullable<RoomState["venue"]>;
  }) {
    if (
      !this.ready ||
      (this.snapshot.role !== "editor" &&
        !(
          this.snapshot.role === "viewer" &&
          ["create-flight", "create-entry"].includes(input.type)
        )) ||
      !this.snapshot.state ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    const id = crypto.randomUUID();
    this.pendingId = id;
    this.update({ pending: true, error: "" });
    this.socket.send(
      JSON.stringify({ ...input, id, revision: this.snapshot.state.revision }),
    );
    this.timeout = setTimeout(() => {
      this.update({
        pending: false,
        error: "反映結果を確認しています。再接続後の状態を確認してください。",
      });
      this.socket?.close();
    }, 7000);
    return id;
  }
  async saveHangar(entry: HangarEntry, expected: HangarEntry | null) {
    const id = this.send({ type: "hangar-save", entry, expected });
    if (!id) throw new Error("クラウドに接続してから保存してください。下書きはこの端末に残っています。");
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.state?.recentOperations.includes(id)) finish();
        else if (!this.snapshot.pending) finish(this.snapshot.error || "保存を確認できませんでした。下書きは残っています。");
      });
      const timeout = setTimeout(() => finish("保存を確認できませんでした。再接続して格納庫を確認してください。"), 9000);
      function finish(error?: string) {
        unsubscribe(); clearTimeout(timeout);
        if (error) reject(new Error(error)); else resolve();
      }
    });
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearTimeout(this.handshake);
    this.socket?.close(1000);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
  }
}
