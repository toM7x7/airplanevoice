import type { FlightId } from "./airspace";

// Facts, not model-generated assertions. A future provider can consume this
// boundary without owning flight clocks, sound propagation or clearance rules.
export interface TowerFact {
  type: "scheduled" | "started" | "first-arrival" | "ended" | "clear";
  atMs: number;
  flightId?: FlightId;
  count?: number;
  spacingSec?: number;
}
export interface TowerCue {
  text: string;
  fact: TowerFact;
  expiresAtMs: number;
}
export class TowerDirector {
  enabled = false;
  cue: TowerCue | null = null;
  private pending: TowerFact[] = [];
  private lastShownAtMs = -Infinity;
  reset() {
    this.cue = null;
    this.pending = [];
    this.lastShownAtMs = -Infinity;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  accept(fact: TowerFact) {
    if (!this.enabled) return;
    this.pending.push(fact);
    this.pending = this.pending.slice(-12);
  }
  advance(nowMs: number, quiet: boolean) {
    this.pending = this.pending.filter(
      (f) => nowMs >= f.atMs && nowMs - f.atMs < 8000,
    );
    if (this.cue && (nowMs >= this.cue.expiresAtMs || quiet)) this.cue = null;
    if (!this.enabled || quiet || this.cue || nowMs - this.lastShownAtMs < 8000)
      return;
    const priority = {
      scheduled: 5,
      clear: 4,
      started: 3,
      "first-arrival": 2,
      ended: 1,
    };
    this.pending.sort(
      (a, b) => priority[b.type] - priority[a.type] || a.atMs - b.atMs,
    );
    const fact = this.pending.shift();
    if (!fact) return;
    const text = {
      scheduled: `${fact.count}機の飛行を準備しました。${fact.count === 1 ? "まもなく開始します。" : fact.spacingSec === 0 ? "各機、同時に開始します。" : `${fact.spacingSec}秒ずつ間隔を空けます。`}`,
      started: `${fact.flightId}、飛行を開始しました。`,
      "first-arrival": `${fact.flightId}の音が届き始めました。機体が通った場所からの響きです。`,
      ended: `${fact.flightId}、一周を終えました。残る音を待ちます。`,
      clear: "全機の飛行と音の到来が終わりました。次の空をどうぞ。",
    }[fact.type];
    this.cue = { text, fact, expiresAtMs: nowMs + 5500 };
    this.lastShownAtMs = nowMs;
  }
}
