import { clamp, distance, dot, mul, normalize, sub } from "./math";
import { flightPose } from "./flight";
import type { CompiledRoute, SoundArrival, SoundEmission, Vec3 } from "./types";

export const SPEED_OF_SOUND_MPS = 343;
export function arrivalFor(
  emission: SoundEmission,
  listener: Vec3,
  delayScale = 1,
): SoundArrival {
  const distanceM = distance(emission.position, listener);
  const radialVelocity = dot(
    emission.velocity,
    normalize(sub(listener, emission.position)),
  );
  return {
    emission,
    distanceM,
    arrivalAtMs:
      emission.emitAtMs +
      (distanceM / SPEED_OF_SOUND_MPS) * 1000 * clamp(delayScale, 1, 3),
    pitchRatio: clamp(
      SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS - radialVelocity),
      0.75,
      1.35,
    ),
  };
}
export function createEmissions(
  route: CompiledRoute,
  startAtMs: number,
  intervalMs = 100,
): SoundEmission[] {
  if (!Number.isFinite(intervalMs) || intervalMs < 20)
    throw new Error("Emission interval must be at least 20 ms");
  const count = Math.ceil(route.durationMs / intervalMs);
  return Array.from({ length: count }, (_, id) => {
    const pose = flightPose(route, id * intervalMs);
    return {
      id,
      emitAtMs: startAtMs + id * intervalMs,
      position: pose.position,
      velocity: mul(pose.tangent, route.speedMps),
    };
  });
}

// Recompute pending arrivals against the current listener. Once arrived,
// emissions remain consumed even if the listener moves or the clock advances.
export class ArrivalQueue {
  private consumed = new Set<number>();
  // Emissions are in emit order and every emitted sound eventually arrives, so skip the consumed prefix.
  private cursor = 0;
  constructor(
    readonly emissions: SoundEmission[],
    readonly delayScale: number,
  ) {}
  advance(nowMs: number, listener: Vec3): SoundArrival[] {
    const arrived: SoundArrival[] = [];
    while (
      this.cursor < this.emissions.length &&
      this.consumed.has(this.emissions[this.cursor].id)
    )
      this.cursor++;
    for (let i = this.cursor; i < this.emissions.length; i++) {
      const emission = this.emissions[i];
      if (emission.emitAtMs > nowMs) break;
      if (this.consumed.has(emission.id)) continue;
      const arrival = arrivalFor(emission, listener, this.delayScale);
      if (arrival.arrivalAtMs <= nowMs) {
        arrived.push(arrival);
        this.consumed.add(emission.id);
      }
    }
    return arrived.sort((a, b) => a.arrivalAtMs - b.arrivalAtMs);
  }
  get remaining(): number {
    return this.emissions.length - this.consumed.size;
  }
  /** Keep emitted/pending sound at its original position while replacing future motion. */
  replaceFuture(emissions: SoundEmission[], nowMs: number) {
    for(let i=0;i<this.emissions.length;i++)
      if(this.emissions[i].emitAtMs>nowMs && !this.consumed.has(this.emissions[i].id) && emissions[i]) this.emissions[i]=emissions[i];
  }
}
