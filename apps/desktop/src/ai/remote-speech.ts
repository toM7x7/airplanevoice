/** Meter the received stream without connecting it to a speaker (the media element owns playback). */
export class RemoteSpeechMonitor {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private speaking = false;
  constructor(private notify: (speaking: boolean) => void) {}
  async prepare() {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch {
      /* Conversation remains available without metering. */
    }
  }
  attach(stream: MediaStream) {
    this.detach();
    const ctx = this.context;
    if (!ctx || ctx.state === "closed") return;
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    const data = new Float32Array(1024);
    let lastVoice = -Infinity;
    this.timer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((sum, v) => sum + v * v, 0) / data.length,
      );
      const now = performance.now();
      if (rms > 0.008) lastVoice = now;
      this.set(now - lastVoice < 450);
    }, 70);
  }
  private set(value: boolean) {
    if (this.speaking !== value) {
      this.speaking = value;
      this.notify(value);
    }
  }
  private detach() {
    clearInterval(this.timer);
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.set(false);
  }
  dispose() {
    this.detach();
    const ctx = this.context;
    this.context = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }
}
