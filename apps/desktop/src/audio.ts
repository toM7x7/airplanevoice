import {environmentObjects,type EnvironmentRecipe,type EnvironmentObject} from "../../../packages/core/src/environment";
import {buildingSound} from "../../../packages/core/src/building-sound";
import {
  DEFAULT_SOUND,
  type SoundDesign,
} from "../../../packages/core/src/sound-design";
import {
  clamp,
  type FlightArrival,
  type FlightId,
  type Vec3,
} from "../../../packages/core/src";
import { engineSignal } from "./engine-sound";
import { SpaceSound, type SoundCue } from "./space-sound";
import {
  aircraftVoiceBudget,
  MAX_AUDIO_VOICES,
} from "../../../packages/core/src/audio-budget";

export type OutputProfile = "speaker" | "headphones";
const PROFILES = {
  speaker: { refDistance: 550, rolloff: 1.1, presenceDb: 5 },
  headphones: { refDistance: 350, rolloff: 1.4, presenceDb: 0 },
};

// Separate stereo channels so opposite-phase samples cannot hide a signal.
function meter(ctx: AudioContext, node: AudioNode) {
  const split = ctx.createChannelSplitter(2);
  const channels = [0, 1].map((index) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    split.connect(analyser, index);
    return analyser;
  });
  node.connect(split);
  const data = new Float32Array(2048);
  return {
    read() {
      let energy = 0,
        peak = 0;
      for (const channel of channels) {
        channel.getFloatTimeDomainData(data);
        for (const value of data) {
          energy += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
      }
      const rms = Math.sqrt(energy / (2 * data.length));
      return {
        rms,
        peak,
        db: rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120,
      };
    },
    dispose() {
      node.disconnect(split);
      split.disconnect();
      channels.forEach((a) => a.disconnect());
    },
  };
}
type Meter = ReturnType<typeof meter>;
type Level = ReturnType<Meter["read"]>;

// Temporary, locally synthesized sound. No recordings or external media.
// Each aircraft has its own bounded voice budget and a smoothly mixed bus.
export class AircraftAudio {
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private presence: BiquadFilterNode | null = null;
  private profile: OutputProfile = "speaker";
  private outputMeter: Meter | null = null;
  private busMeters = new Map<FlightId, Meter>();
  private meteredAt = -Infinity;
  private metered: {
    flights: Partial<Record<FlightId, Level>>;
    output: Level;
  } = { flights: {}, output: { rms: 0, peak: 0, db: -120 } };
  private buses = new Map<FlightId, GainNode>();
  private soundBuildings:EnvironmentObject[]=[];
  private environmentKey="";
  buildingSoundState={enabled:false,buildings:0,blocked:0,lastStrength:0};
  setEnvironment(recipe:EnvironmentRecipe,visible=true) {
    const enabled=visible&&recipe.buildingSound===true;
    const key=JSON.stringify([recipe.preset,recipe.seed,recipe.density,recipe.heightM,recipe.streetWidthM,recipe.greenery,enabled]);
    if(key===this.environmentKey)return;this.environmentKey=key;
    this.soundBuildings=enabled?environmentObjects(recipe).buildings:[];
    this.buildingSoundState={enabled,buildings:this.soundBuildings.length,blocked:0,lastStrength:0};
  }
  mixGains: Partial<Record<FlightId, number>> = { "ST-01": 1 };
  playedByFlight: Partial<Record<FlightId, number>> = {};
  private voices = new Set<{
    source: AudioBufferSourceNode;
    nodes: AudioNode[];
    flightId: FlightId;
  }>();
  private volume = 0.35;
  private muted = false;
  private audition: AudioBufferSourceNode | null = null;
  private spaceSound: SpaceSound | null = null;
  ambienceOn = false;
  interfaceSoundOn = true;
  speechDucking = true;
  private speaking = false;
  setSpeaking = (speaking: boolean) => {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.applyVolume();
  };
  setSpeechDucking(on: boolean) {
    this.speechDucking = on;
    this.applyVolume();
  }
  setAmbience(on: boolean) {
    this.ambienceOn = on;
    this.spaceSound?.ambience(on);
  }
  feedback(kind: SoundCue = "press", position?: Vec3) {
    if (
      this.interfaceSoundOn &&
      !this.muted &&
      this.context?.state === "running"
    )
      this.spaceSound?.cue(kind, position);
  }
  get spaceSoundState() {
    return {
      ambience: this.ambienceOn,
      interface: this.interfaceSoundOn,
      cues: this.spaceSound?.cues ?? 0,
      lastCue: this.spaceSound?.lastKind ?? null,
      speaking: this.speaking,
      ducking: this.speechDucking,
      gain: this.muted
        ? 0
        : this.volume * (this.speaking && this.speechDucking ? 0.5 : 1),
    };
  }
  played = 0;
  skipped = 0;
  get activeVoices() {
    return this.voices.size;
  }
  get activeByFlight() {
    return Object.fromEntries(
      [...this.buses.keys()].map((id) => [
        id,
        [...this.voices].filter((v) => v.flightId === id).length,
      ]),
    );
  }
  get outputProfile() {
    return this.profile;
  }
  get volumeLevel() {
    return Math.round(this.volume * 100);
  }
  setOutputProfile(profile: OutputProfile) {
    if (profile !== "speaker" && profile !== "headphones") return;
    this.profile = profile;
    const p = PROFILES[profile];
    if (this.context && this.presence)
      this.presence.gain.setTargetAtTime(
        p.presenceDb,
        this.context.currentTime,
        0.15,
      );
    // Existing grains retain their short envelope; subsequent grains adopt the
    // new distance curve, avoiding an abrupt level change in sounding sources.
  }
  get levels() {
    const now = this.context?.currentTime ?? 0;
    if (now - this.meteredAt < 0.1) return this.metered;
    this.meteredAt = now;
    this.metered = {
      flights: Object.fromEntries(
        [...this.busMeters].map(([id, meter]) => [id, meter.read()]),
      ),
      output: this.outputMeter?.read() ?? { rms: 0, peak: 0, db: -120 },
    };
    return this.metered;
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
      this.busMeters.set(id, meter(this.context!, bus));
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
      this.presence = this.context.createBiquadFilter();
      this.presence.type = "peaking";
      this.presence.frequency.value = 480;
      this.presence.Q.value = 0.65;
      this.presence.gain.value = PROFILES[this.profile].presenceDb;
      limiter.threshold.value = -16;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.2;
      this.master
        .connect(this.presence)
        .connect(limiter)
        .connect(this.context.destination);
      this.outputMeter = meter(this.context, limiter);
      this.spaceSound = new SpaceSound(this.context, this.master);
      this.spaceSound.ambience(this.ambienceOn);
      for (const count of [2, 4] as const) {
        const signal = engineSignal(this.context.sampleRate, count);
        const buffer = this.context.createBuffer(
          1,
          signal.length,
          this.context.sampleRate,
        );
        buffer.getChannelData(0).set(signal);
        this.buffers.set(JSON.stringify([count, DEFAULT_SOUND]), buffer);
      }
      this.setVolume(this.volume);
    }
    await this.context.resume();
  }
  setVolume(value: number) {
    this.audition?.stop();
    this.audition = null;
    this.volume = clamp(value, 0, 0.7);
    this.applyVolume();
  }
  setMuted(value: boolean) {
    if (value) {
      this.audition?.stop();
      this.audition = null;
    }
    this.muted = value;
    this.applyVolume();
  }
  private applyVolume() {
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.muted
          ? 0
          : this.volume * (this.speaking && this.speechDucking ? 0.5 : 1),
        this.context.currentTime,
        this.muted || this.volume === 0
          ? 0.03
          : this.speaking && this.speechDucking
            ? 0.08
            : 0.55,
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
  play(
    arrival: FlightArrival,
    nowMs: number,
    lowGain: number,
    engines: 2 | 4 = 4,
    sound: SoundDesign = DEFAULT_SOUND,
  ) {
    const key = JSON.stringify([engines, sound]);
    let buffer = this.buffers.get(key);
    if (!buffer && this.context) {
      const signal = engineSignal(this.context.sampleRate, engines, 4, sound);
      buffer = this.context.createBuffer(
        1,
        signal.length,
        this.context.sampleRate,
      );
      buffer.getChannelData(0).set(signal);
      if (this.buffers.size >= 24)
        this.buffers.delete(this.buffers.keys().next().value!);
      this.buffers.set(key, buffer);
    }
    if (
      !this.context ||
      !buffer ||
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
      this.voices.size >= MAX_AUDIO_VOICES ||
      ownVoices >= aircraftVoiceBudget(this.mixGains, arrival.flightId)
    ) {
      this.skipped++;
      return;
    }
    const ctx = this.context,
      time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = arrival.pitchRatio;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const obstruction=buildingSound(arrival.emission.position,{x:ctx.listener.positionX.value,y:ctx.listener.positionY.value,z:ctx.listener.positionZ.value},this.soundBuildings);
    this.buildingSoundState.lastStrength=obstruction.strength;if(obstruction.strength>0)this.buildingSoundState.blocked++;
    filter.frequency.value = Math.min(clamp(1900 - arrival.distanceM * 0.4, 450, 1800),obstruction.cutoffHz);
    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 150;
    bass.gain.value = lowGain * 5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.4*obstruction.gain, time + 0.09);
    gain.gain.setValueAtTime(0.4*obstruction.gain, time + 0.16);
    gain.gain.linearRampToValueAtTime(0, time + 0.34);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = PROFILES[this.profile].refDistance;
    panner.rolloffFactor = PROFILES[this.profile].rolloff;
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
  async preview(
    engines: 2 | 4,
    sound: SoundDesign = DEFAULT_SOUND,
    compare = false,
  ) {
    await this.enable();
    this.audition?.stop();
    const ctx = this.context!;
    const tones = compare ? [DEFAULT_SOUND, sound] : [sound];
    const duration = compare ? 4.35 : 2;
    const buffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate,
    );
    const channel = buffer.getChannelData(0);
    tones.forEach((tone, index) => {
      const data = engineSignal(ctx.sampleRate, engines, 2, tone);
      const offset = Math.round(index * 2.35 * ctx.sampleRate);
      for (let i = 0; i < data.length; i++) {
        const sec = i / ctx.sampleRate;
        const envelope = Math.max(
          0,
          Math.min(1, sec / 0.15, (1.9 - sec) / 0.4),
        );
        channel[offset + i] = data[i] * envelope;
      }
    });
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = this.volume * 0.5;
    source.connect(gain).connect(ctx.destination);
    this.audition = source;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.audition === source) this.audition = null;
    };
    source.start();
    source.stop(ctx.currentTime + duration);
  }
  stop() {
    this.audition?.stop();
    this.audition = null;
    for (const v of this.voices) {
      v.source.stop();
      v.nodes.forEach((n) => n.disconnect());
    }
    this.voices.clear();
  }
  dispose() {
    this.stop();
    this.spaceSound?.dispose();
    this.outputMeter?.dispose();
    this.busMeters.forEach((meter) => meter.dispose());
    this.busMeters.clear();
    this.buses.forEach((bus) => bus.disconnect());
    this.buses.clear();
    this.buffers.clear();
    void this.context?.close();
  }
}
