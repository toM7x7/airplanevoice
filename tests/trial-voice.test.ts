import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TrialApi,
  TrialVoice,
  bindTrialPageLifecycle,
} from "../apps/desktop/src/ai/trial-client";
import { LiveTranscript } from "../packages/core/src/live-transcript";

class Events extends EventTarget {
  readyState = "open";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
  });
  emit(event: object) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
  }
}
function setup() {
  const events = new Events();
  const track = { enabled: true, stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  class Peer extends EventTarget {
    iceGatheringState = "complete";
    connectionState = "connected";
    localDescription = { sdp: "v=0" };
    addTrack = vi.fn();
    createDataChannel = () => events;
    createOffer = async () => ({ type: "offer", sdp: "v=0" });
    setLocalDescription = async () => {};
    setRemoteDescription = async () => {
      events.emit({ type: "session.started" });
    };
    close = vi.fn();
  }
  vi.stubGlobal("RTCPeerConnection", Peer);
  const api = new TrialApi("test-only");
  const request = vi.spyOn(api, "request").mockImplementation(async (path) => {
    return (
      path === "live"
        ? { transport: { sdp: "v=0" }, deadline: null }
        : { live: { status: "closed" } }
    ) as never;
  });
  const voice = new TrialVoice(
    api,
    { srcObject: null } as HTMLAudioElement,
    vi.fn(),
  );
  return { voice, request, events, track, getUserMedia };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("one continuous Live conversation", () => {
  it("keeps one connection across speech exchanges and beyond 90 seconds", async () => {
    const { voice, request, events, getUserMedia } = setup();
    await voice.start();
    events.emit({
      type: "session.input_transcript.delta",
      delta: "音を教えて",
    });
    events.emit({
      type: "session.output_transcript.delta",
      delta: "メニューから聴き方です。",
    });
    events.emit({
      type: "session.input_transcript.delta",
      delta: "次は飛行機について",
    });
    events.emit({
      type: "session.output_transcript.delta",
      delta: "いま一機が飛んでいます。",
    });
    await vi.advanceTimersByTimeAsync(95000);
    expect(voice.state.phase).toBe("connected");
    expect(voice.state.user).toContain("次は飛行機について");
    expect(request).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await voice.end();
    expect(voice.state.phase).toBe("ended");
  });
  it("mutes and resumes the existing microphone without creating another paid session", async () => {
    const { voice, request, track } = setup();
    await voice.start();
    voice.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(voice.state.muted).toBe(true);
    voice.setMuted(false);
    expect(track.enabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await voice.end();
    expect(track.stop).toHaveBeenCalled();
  });
  it("does not end at five minutes and stops only when requested", async () => {
    const { voice, request, track, events } = setup();
    await voice.start();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(voice.state.phase).toBe("connected");
    expect(track.stop).not.toHaveBeenCalled();
    expect(events.send).not.toHaveBeenCalled();
    await voice.end();
    expect(voice.state.phase).toBe("ended");
    expect(track.stop).toHaveBeenCalled();
    expect(events.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "session.close" }),
    );
    await vi.advanceTimersByTimeAsync(600000);
    expect(request.mock.calls.filter(([path]) => path === "live")).toHaveLength(
      1,
    );
  });
  it("keeps capture on tab visibility changes and closes on actual page exit", () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    const root = new EventTarget();
    const sync = vi.fn();
    const leave = vi.fn();
    const unbind = bindTrialPageLifecycle(
      sync,
      leave,
      page as never,
      root as never,
    );
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(leave).not.toHaveBeenCalled();
    root.dispatchEvent(new Event("pagehide"));
    expect(leave).toHaveBeenCalledTimes(1);
    unbind();
    root.dispatchEvent(new Event("pagehide"));
    expect(leave).toHaveBeenCalledTimes(1);
  });
});

describe("rolling voice context", () => {
  it("joins fragments without inserting role labels inside words, and retains timing", () => {
    const t = new LiveTranscript();
    t.append("user", "音量を", 100, 200);
    t.append("user", "下げたい", 200, 300);
    t.append("assistant", "メニューです", 290, 600);
    t.append("user", "やっぱり上げたい", 400, 800);
    expect(t.summary()).toBe(
      "利用者: 音量を下げたい\n音声案内: メニューです\n利用者: やっぱり上げたい",
    );
    expect(t.snapshot()[2].startMs).toBe(290);
    t.clear();
    expect(t.summary()).toBe("");
  });
});
