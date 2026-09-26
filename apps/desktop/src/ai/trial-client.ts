import type {
  TrialStatus,
  TrialContext,
  TrialReply,
} from "../../../../packages/core/src/ai-trial";
import { RemoteSpeechMonitor } from "./remote-speech";
export class TrialApi {
  readonly client = crypto.randomUUID();
  constructor(private token: string) {}
  async request<T>(
    path: string,
    body?: unknown,
    keepalive = false,
  ): Promise<T> {
    const response = await fetch(`/api/ai/${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-AI-Client": this.client,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: keepalive ? undefined : AbortSignal.timeout(35000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "AIに接続できませんでした。");
    return result as T;
  }
  status = () => this.request<TrialStatus>("status");
  context = (context: TrialContext) =>
    this.request<TrialStatus>("context", { context });
  ask = (text: string) =>
    this.request<TrialReply>("ask", { id: crypto.randomUUID(), text });
  stop = () => this.request<TrialStatus>("stop", {}, true);
}
export type LiveClientState = {
  phase: "idle" | "connecting" | "connected" | "closing" | "ended" | "error";
  message: string;
  user: string;
  assistant: string;
  muted: boolean;
  speaking?: boolean;
};
/** Leaving the document ends capture; merely hiding the tab does not. */
export function bindTrialPageLifecycle(
  sync: () => void,
  leave: () => void,
  page: Document = document,
  root: Window = window,
) {
  page.addEventListener("visibilitychange", sync);
  root.addEventListener("online", sync);
  root.addEventListener("pagehide", leave);
  return () => {
    page.removeEventListener("visibilitychange", sync);
    root.removeEventListener("online", sync);
    root.removeEventListener("pagehide", leave);
  };
}
export class TrialVoice {
  private speech = new RemoteSpeechMonitor((speaking) =>
    this.update({ speaking }),
  );
  private peer: RTCPeerConnection | null = null;
  private events: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private generation = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private requested = false;
  private finalized = false;
  private stopReason = "";
  state: LiveClientState = {
    phase: "idle",
    message: "会話は停止中です。",
    user: "",
    assistant: "",
    muted: false,
  };
  constructor(
    private api: TrialApi,
    private audio: HTMLAudioElement,
    private notify: (state: LiveClientState) => void,
  ) {}
  private update(change: Partial<LiveClientState>) {
    this.state = { ...this.state, ...change };
    this.notify(this.state);
  }
  private cleanup() {
    this.speech.dispose();
    clearTimeout(this.closeTimer);
    clearTimeout(this.startupTimer);
    this.microphone?.getTracks().forEach((t) => t.stop());
    this.microphone = null;
    const events = this.events;
    this.events = null;
    events?.close();
    const peer = this.peer;
    this.peer = null;
    peer?.close();
    this.audio.srcObject = null;
  }
  async start() {
    if (["connecting", "connected", "closing"].includes(this.state.phase))
      return;
    const generation = ++this.generation;
    this.requested = false;
    this.finalized = false;
    this.stopReason = "";
    this.update({
      phase: "connecting",
      message: "マイクと会話を接続しています…",
      user: "",
      assistant: "",
      muted: false,
    });
    try {
      await this.speech.prepare();
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.microphone = stream;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      stream.getTracks().forEach((t) => peer.addTrack(t, stream));
      peer.addEventListener("track", (event) => {
        if (this.peer !== peer) return;
        this.audio.srcObject = new MediaStream([event.track]);
        this.speech.attach(this.audio.srcObject);
        void this.audio.play().catch(() =>
          this.update({
            message: "音声の再生ボタンを押すと案内を聴けます。",
          }),
        );
      });
      peer.addEventListener("connectionstatechange", () => {
        if (this.peer === peer && peer.connectionState === "failed")
          void this.end("接続が途切れたため、会話を終了しました。");
      });
      const events = peer.createDataChannel("oai-events");
      this.events = events;
      events.addEventListener("message", ({ data }) => {
        if (this.events !== events) return;
        let e;
        try {
          e = JSON.parse(data);
        } catch {
          return;
        }
        if (e.type === "session.started") {
          clearTimeout(this.startupTimer);
          if (this.state.phase === "closing") {
            events.send(JSON.stringify({ type: "session.close" }));
            return;
          }
          this.update({
            phase: "connected",
            message: "会話中です。そのまま続けて話しかけられます。",
          });
        }
        if (e.type === "session.closed") {
          this.finalized = true;
          this.update({
            phase: "ended",
            message:
              this.stopReason ||
              `音声の接続が終了しました${typeof e.reason === "string" ? `（${e.reason.slice(0, 100)}）` : ""}。もう一度開始できます。`,
          });
          this.cleanup();
        }
        if (
          e.type === "session.input_transcript.delta" &&
          typeof e.delta === "string"
        )
          this.update({ user: (this.state.user + e.delta).slice(-1200) });
        if (
          e.type === "session.output_transcript.delta" &&
          typeof e.delta === "string"
        )
          this.update({
            assistant: (this.state.assistant + e.delta).slice(-1600),
          });
      });
      events.addEventListener("close", () => {
        if (this.events === events && !this.finalized)
          void this.end(
            "音声の通信経路が閉じたため終了しました。もう一度開始できます。",
          );
      });
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            peer.removeEventListener("icegatheringstatechange", check);
          };
          const check = () => {
            if (peer.iceGatheringState === "complete") {
              cleanup();
              resolve();
            }
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("音声の接続準備が間に合いませんでした。"));
          }, 10000);
          peer.addEventListener("icegatheringstatechange", check);
          check();
        });
      if (generation !== this.generation) return;
      this.requested = true;
      const result = await this.api.request<{
        transport: { sdp: string };
      }>("live", { id: crypto.randomUUID(), sdp: peer.localDescription?.sdp });
      if (generation !== this.generation) {
        await this.api.request("live/close", {});
        return;
      }
      this.startupTimer = setTimeout(() => {
        if (this.state.phase === "connecting")
          void this.end(
            "接続の開始を確認できなかったため、会話を終了しました。",
          );
      }, 15000);
      await peer.setRemoteDescription({
        type: "answer",
        sdp: result.transport.sdp,
      });
    } catch (e) {
      if (generation !== this.generation) return;
      this.cleanup();
      if (this.requested)
        await this.api.request("live/close", {}).catch(() => {});
      this.update({
        phase: "error",
        message:
          e instanceof Error ? e.message : "音声を開始できませんでした。",
      });
    }
  }
  setMuted(muted: boolean) {
    if (this.state.phase !== "connected") return;
    this.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.update({
      muted,
      message: muted
        ? "マイクはミュート中です。会話の接続と利用時間は継続します。"
        : "会話中です。そのまま続けて話しかけられます。",
    });
  }
  async end(reason = "会話を終了しました。") {
    if (!["connecting", "connected", "closing"].includes(this.state.phase))
      return;
    if (this.state.phase === "closing") return;
    this.stopReason = reason;
    ++this.generation;
    // Stop capture immediately. Leave event/media transport available for final usage.
    this.microphone?.getTracks().forEach((t) => t.stop());
    this.update({ phase: "closing", message: "会話の終了を確認しています…" });
    if (this.events?.readyState === "open")
      this.events.send(JSON.stringify({ type: "session.close" }));
    if (!this.requested) {
      this.cleanup();
      this.update({ phase: "ended", message: "接続を中止しました。" });
      return;
    }
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      this.cleanup();
      this.update({
        phase: "ended",
        message: this.finalized
          ? this.stopReason
          : "マイクを停止しました。サーバー側で終了を確認中です。",
      });
    }, 15000);
    try {
      const status = await this.api.request<TrialStatus>("live/close", {});
      if (status.live.status === "closed") {
        this.finalized = true;
        this.cleanup();
        this.update({ phase: "ended", message: this.stopReason });
      }
    } catch {
      this.update({
        message: "マイクは停止しました。通信が戻ると終了状況を確認できます。",
      });
    }
  }
  dispose() {
    ++this.generation;
    this.cleanup();
    if (this.requested && !this.finalized)
      void this.api.request("live/close", {}, true).catch(() => {});
  }
}
