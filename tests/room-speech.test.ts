import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomSpeech } from "../apps/desktop/src/room-speech";

const setup = (japanese = true) => {
  let voices = japanese ? [{ lang: "ja-JP" }] : [{ lang: "en-US" }];
  let refresh = () => {};
  const spoken: SpeechSynthesisUtterance[] = [];
  const synth = {
    getVoices: () => voices,
    addEventListener: (_: string, fn: () => void) => {
      refresh = fn;
    },
    removeEventListener: vi.fn(),
    speak: vi.fn((s: SpeechSynthesisUtterance) => spoken.push(s)),
    cancel: vi.fn(),
  };
  const adapter = new RoomSpeech(
    synth as unknown as SpeechSynthesis,
    (text) => ({ text }) as SpeechSynthesisUtterance,
  );
  return {
    adapter,
    synth,
    spoken,
    loadJapanese: () => {
      voices = [{ lang: "ja-JP" }];
      refresh();
    },
  };
};
afterEach(() => vi.useRealTimers());
describe("bounded Japanese speech", () => {
  it("keeps text available when speech or a Japanese voice is absent", () => {
    const missing = new RoomSpeech(null);
    expect(missing.snapshot.available).toBe(false);
    const { adapter, synth } = setup(false);
    adapter.say("飛行中です。");
    expect(synth.speak).not.toHaveBeenCalled();
    expect(adapter.snapshot.message).toContain("文字で確認");
  });
  it("detects Japanese voices delivered after initialization", () => {
    const { adapter, loadJapanese } = setup(false);
    loadJapanese();
    expect(adapter.snapshot.available).toBe(true);
    adapter.dispose();
  });
  it("replaces an old utterance and ignores its delayed completion", () => {
    const { adapter, synth, spoken } = setup();
    adapter.say("準備しています。");
    adapter.say("飛行中です。", 0.2);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    spoken[0].onend?.({} as SpeechSynthesisEvent);
    expect(adapter.snapshot.speaking).toBe(true);
    expect(spoken[1].volume).toBe(0.2);
    adapter.stop();
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(adapter.snapshot.speaking).toBe(false);
  });
  it("cancels stalled playback so it cannot start much later", () => {
    vi.useFakeTimers();
    const { adapter, synth } = setup();
    adapter.say("飛行中です。");
    vi.advanceTimersByTime(15000);
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(adapter.snapshot.speaking).toBe(false);
  });
  it("cleans up on disposal and never starts speech afterwards", () => {
    const { adapter, synth } = setup();
    adapter.say("飛行中です。");
    adapter.dispose();
    adapter.say("古い案内");
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(synth.removeEventListener).toHaveBeenCalledOnce();
  });
  it("reports a playback failure without throwing into the flight loop", () => {
    const { adapter, synth } = setup();
    synth.speak.mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => adapter.say("飛行中です。")).not.toThrow();
    expect(adapter.snapshot.speaking).toBe(false);
    expect(adapter.snapshot.message).toContain("開始できません");
  });
});
