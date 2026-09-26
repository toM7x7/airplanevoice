/** Quiet procedural ambience and short tactile UI cues; no external recordings. */
export type SoundCue = "press" | "open" | "saved" | "accepted" | "error";
export class SpaceSound {
  private wind: AudioBufferSourceNode;
  private windGain: GainNode;
  private lastCue = -1;
  cues = 0;
  lastKind: SoundCue | null = null;
  constructor(
    private ctx: AudioContext,
    private output: AudioNode,
  ) {
    const buffer = ctx.createBuffer(2, ctx.sampleRate * 6, ctx.sampleRate);
    let seed = 773;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        smooth = smooth * 0.975 + (seed / 4294967296 - 0.5) * 0.025;
        data[i] = smooth * Math.sin((Math.PI * i) / (data.length - 1)) ** 2;
      }
    }
    this.wind = ctx.createBufferSource();
    this.wind.buffer = buffer;
    this.wind.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 850;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(low).connect(this.windGain).connect(output);
    this.wind.start();
  }
  ambience(on: boolean) {
    this.windGain.gain.setTargetAtTime(
      on ? 0.18 : 0,
      this.ctx.currentTime,
      0.65,
    );
  }
  cue(kind: SoundCue, position?: { x: number; y: number; z: number }) {
    const t = this.ctx.currentTime;
    if (t - this.lastCue < 0.07 && (kind === "press" || kind === "open"))
      return;
    this.lastCue = t;
    this.cues++;
    this.lastKind = kind;
    const oscillator = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    const [from, to, duration] = {
      press: [560, 380, 0.065],
      open: [310, 440, 0.16],
      saved: [520, 650, 0.19],
      accepted: [390, 580, 0.27],
      error: [260, 210, 0.16],
    }[kind];
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, t);
    oscillator.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    oscillator.connect(gain);
    const pan = position ? this.ctx.createPanner() : null;
    if (pan && position) {
      pan.panningModel = "HRTF";
      pan.refDistance = 1;
      pan.positionX.value = position.x;
      pan.positionY.value = position.y;
      pan.positionZ.value = position.z;
      gain.connect(pan).connect(this.output);
    } else gain.connect(this.output);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      pan?.disconnect();
    };
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }
  dispose() {
    this.wind.stop();
    this.wind.disconnect();
    this.windGain.disconnect();
  }
}
