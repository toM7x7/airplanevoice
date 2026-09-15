import {
  clamp,
  type FlightArrival,
  type FlightId,
  type Vec3,
} from "../../../packages/core/src";

// Temporary, locally synthesized sound. No recordings or external media.
// Each aircraft has its own bounded voice budget and a smoothly mixed bus.
export class AircraftAudio {
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private buses = new Map<FlightId, GainNode>();
  mixGains: Partial<Record<FlightId, number>> = { "ST-01": 1 };
  playedByFlight: Partial<Record<FlightId, number>> = {};
  private voices = new Set<{
    source: AudioBufferSourceNode;
    nodes: AudioNode[];
    flightId: FlightId;
  }>();
  private volume = 0.35;
  private muted = false;
  played = 0;
  skipped = 0;
  get activeVoices() {
    return this.voices.size;
  }
  setMix(gains: Partial<Record<FlightId, number>>) {
    this.mixGains = { ...gains };
    if (this.context)
      for (const [id, bus] of this.buses) {
        bus.gain.setTargetAtTime(
          gains[id] ?? 0,
          this.context.currentTime,
          0.25,
        );
      }
  }
  private bus(id: FlightId): GainNode {
    let bus = this.buses.get(id);
    if (!bus) {
      bus = this.context!.createGain();
      bus.gain.value = this.mixGains[id] ?? 0;
      bus.connect(this.master!);
      this.buses.set(id, bus);
    }
    return bus;
  }
  get busLevels() {
    return Object.fromEntries(
      [...this.buses].map(([id, bus]) => [id, bus.gain.value]),
    );
  }
  async enable(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -16;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.2;
      this.master.connect(limiter).connect(this.context.destination);
      const frames = this.context.sampleRate * 4;
      this.buffer = this.context.createBuffer(
        1,
        frames,
        this.context.sampleRate,
      );
      const channel = this.buffer.getChannelData(0);
      let seed = 92821,
        low = 0;
      for (let i = 0; i < frames; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        low = low * 0.96 + noise * 0.04;
        const t = i / this.context.sampleRate;
        channel[i] =
          low * 1.7 +
          noise * 0.1 +
          Math.sin(t * Math.PI * 2 * 61) * 0.07 +
          Math.sin(t * Math.PI * 2 * 123) * 0.03;
      }
      this.setVolume(this.volume);
    }
    await this.context.resume();
  }
  setVolume(value: number) {
    this.volume = clamp(value, 0, 0.7);
    this.applyVolume();
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.applyVolume();
  }
  private applyVolume() {
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
        0.03,
      );
  }
  setListener(position: Vec3, forward: Vec3, up: Vec3) {
    if (!this.context) return;
    const l = this.context.listener;
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  }
  get listenerPose() {
    const l = this.context?.listener;
    return l
      ? {
          position: [l.positionX.value, l.positionY.value, l.positionZ.value],
          forward: [l.forwardX.value, l.forwardY.value, l.forwardZ.value],
          up: [l.upX.value, l.upY.value, l.upZ.value],
        }
      : null;
  }
  play(arrival: FlightArrival, nowMs: number, lowGain: number) {
    if (
      !this.context ||
      !this.buffer ||
      !this.master ||
      this.context.state !== "running"
    )
      return;
    // Drop stale events after suspension/tab throttling, never burst old audio.
    const ownVoices = [...this.voices].filter(
      (v) => v.flightId === arrival.flightId,
    ).length;
    if (
      nowMs - arrival.arrivalAtMs > 250 ||
      this.voices.size >= 18 ||
      ownVoices >= 6
    ) {
      this.skipped++;
      return;
    }
    const ctx = this.context,
      time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = arrival.pitchRatio;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = clamp(2600 - arrival.distanceM * 0.55, 400, 2400);
    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 150;
    bass.gain.value = lowGain * 5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.4, time + 0.09);
    gain.gain.setValueAtTime(0.4, time + 0.16);
    gain.gain.linearRampToValueAtTime(0, time + 0.34);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 350;
    panner.rolloffFactor = 1.4;
    panner.maxDistance = 10000;
    // The source remains at the emission position, never at the current aircraft.
    panner.positionX.value = arrival.emission.position.x;
    panner.positionY.value = arrival.emission.position.y;
    panner.positionZ.value = arrival.emission.position.z;
    source
      .connect(filter)
      .connect(bass)
      .connect(gain)
      .connect(panner)
      .connect(this.bus(arrival.flightId));
    const voice = {
      source,
      nodes: [source, filter, bass, gain, panner],
      flightId: arrival.flightId,
    };
    this.voices.add(voice);
    source.onended = () => {
      voice.nodes.forEach((n) => n.disconnect());
      this.voices.delete(voice);
    };
    source.start(
      time,
      (arrival.emission.id * 0.1 + Number(arrival.flightId.slice(-1)) * 0.37) %
        3,
    );
    source.stop(time + 0.35);
    this.played++;
    this.playedByFlight[arrival.flightId] =
      (this.playedByFlight[arrival.flightId] ?? 0) + 1;
  }
  stop() {
    for (const v of this.voices) {
      v.source.stop();
      v.nodes.forEach((n) => n.disconnect());
    }
    this.voices.clear();
  }
  dispose() {
    this.stop();
    this.buses.forEach((bus) => bus.disconnect());
    this.buses.clear();
    void this.context?.close();
  }
}
