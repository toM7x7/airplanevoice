/** Device/browser voice adapter. No LLM or cloud TTS credentials are used here. */
export interface SpeechOutput {
  readonly snapshot: { available: boolean; speaking: boolean; message: string };
  subscribe: (fn: () => void) => () => void;
  say(text: string, volume?: number): void;
  stop(): void;
  dispose(): void;
}

export class RoomSpeech implements SpeechOutput {
  snapshot = {
    available: false,
    speaking: false,
    message: "日本語の音声を確認しています。",
  };
  private subscribers = new Set<() => void>();
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private synthesis: SpeechSynthesis | null = typeof window !== "undefined" &&
    "speechSynthesis" in window
      ? window.speechSynthesis
      : null,
    private utterance: (text: string) => SpeechSynthesisUtterance = (text) =>
      new SpeechSynthesisUtterance(text),
  ) {
    synthesis?.addEventListener("voiceschanged", this.refresh);
    this.refresh();
  }
  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  private update(patch: Partial<typeof this.snapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.subscribers.forEach((fn) => fn());
  }
  private voice = () =>
    this.synthesis?.getVoices().find((v) => /^ja(?:[-_]|$)/i.test(v.lang));
  private refresh = () => {
    const available = !!this.voice();
    this.update({
      available,
      message: available
        ? "端末の日本語音声で、短く案内します。"
        : "このブラウザでは日本語の読み上げを使えません。文字で確認できます。",
    });
  };
  say(text: string, volume = 0.35) {
    if (this.disposed) return;
    this.stop();
    const voice = this.voice();
    if (!voice || !this.synthesis) {
      this.refresh();
      return;
    }
    const generation = this.generation;
    const speech = this.utterance(text.slice(0, 120));
    speech.voice = voice;
    speech.lang = "ja-JP";
    speech.volume = Math.max(0, Math.min(0.7, volume));
    speech.rate = 1;
    const finish = (message: string) => {
      if (generation !== this.generation || this.disposed) return;
      clearTimeout(this.timer);
      this.update({ speaking: false, message });
    };
    speech.onend = () => finish("案内を終えました。");
    speech.onerror = () =>
      finish("読み上げを開始できませんでした。文字で確認できます。");
    this.update({ speaking: true, message: "状況の案内中です。" });
    // A browser can leave an utterance pending indefinitely. Never replay it later.
    this.timer = setTimeout(() => this.stop(), 15000);
    try {
      this.synthesis.speak(speech);
    } catch {
      this.stop();
      this.update({
        message: "読み上げを開始できませんでした。文字で確認できます。",
      });
    }
  }
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    if (this.snapshot.speaking) {
      this.synthesis?.cancel();
      this.update({ speaking: false, message: "案内を止めました。" });
    }
  };
  dispose() {
    this.stop();
    this.disposed = true;
    this.synthesis?.removeEventListener("voiceschanged", this.refresh);
    this.subscribers.clear();
  }
}
