import {
  ROOM_PROTOCOL,
  type RoomState,
} from "../../../packages/core/src/shared-room";

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
    status: "idle",
    state: null as RoomState | null,
    peers: 0,
    error: "",
    pending: false,
    rtt: null as number | null,
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
  private disposed = false;
  private attempts = 0;
  private key = "";
  private pendingId = "";
  private anchor = Date.now() - performance.now();
  private samples: { rtt: number; anchor: number }[] = [];
  private lastReply = performance.now();
  id = "";
  now = () => this.anchor + performance.now();
  get ready() {
    return this.snapshot.status === "connected" && !this.snapshot.pending;
  }
  get invite() {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("shared", "1");
    url.searchParams.set("room", this.id);
    url.hash = `key=${this.key}`;
    return url.href;
  }
  async create() {
    this.update({ status: "connecting", error: "" });
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        signal: AbortSignal.timeout(12000),
      });
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
  join(id: string, key: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(key)) {
      this.update({ status: "failed", error: "招待URLを確認してください。" });
      return;
    }
    this.id = id;
    this.key = key;
    this.attempts = 0;
    this.connect();
  }
  reconnect = () => {
    if (!this.id) return;
    this.attempts = 0;
    this.connect();
  };
  private connect() {
    if (this.disposed) return;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.pendingId = "";
    this.samples = [];
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    this.update({ status: "connecting", pending: false });
    const url = new URL(`/api/rooms/${this.id}/connect`, location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, [ROOM_PROTOCOL, `key.${this.key}`]);
    this.socket = ws;
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
        JSON.stringify({ type: "ping", sentAt: performance.now() }),
      );
  }
  send(
    input:
      | { type: "edit"; recipe: RoomState["draft"] }
      | { type: "launch" | "cancel-next" },
  ): void;
  send(input: { type: string; recipe?: RoomState["draft"] }) {
    if (
      !this.ready ||
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
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    this.socket?.close(1000);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
  }
}
