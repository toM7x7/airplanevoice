import { useMemo, useState } from "react";
import { closestPass, type Experience } from "../../../packages/core/src";
import { FlightMap } from "./FlightMap";

export function ObservationDeck({ experience: e }: { experience: Experience }) {
  const [sound, setSound] = useState(false);
  const passes = useMemo(() => {
    const plans =
      e.compiledShow?.flights ??
      (e.flights.length
        ? e.flights.map((f) => ({
            ...f,
            startSec: (f.startAtMs - e.startAtMs) / 1000,
          }))
        : [{ id: "ST-01", route: e.route, startSec: 0 }]);
    return plans.map((f) => ({
      id: f.id,
      startSec: f.startSec,
      endSec: f.startSec + f.route.durationMs / 1000,
      ...closestPass(f.route, e.listener, f.startSec, e.recipe.delayScale),
    }));
  }, [
    e.compiledShow,
    e.route,
    e.flights,
    e.listener.x,
    e.listener.y,
    e.listener.z,
    e.recipe.delayScale,
  ]);
  const end =
    Math.max(...passes.map((p) => Math.max(p.endSec, p.soundSec))) + 4;
  const x = (sec: number) => 42 + (sec / end) * 216;
  return (
    <section className="observation-deck" aria-label="フライバイ観測所">
      <h3>フライバイ観測所</h3>
      <div className="segmented">
        <button aria-pressed={!sound} onClick={() => setSound(false)}>
          航路を見る
        </button>
        <button aria-pressed={sound} onClick={() => setSound(true)}>
          届いた音を見る
        </button>
      </div>
      <FlightMap experience={e} sound={sound} />
      <svg
        className="pass-timeline"
        viewBox={`0 0 280 ${passes.length * 26 + 34}`}
        role="img"
        aria-label="通過と音の到来の予測時刻"
      >
        {passes.map((p, i) => (
          <g key={p.id}>
            <text x={0} y={18 + i * 26}>
              {p.id}
            </text>
            <line
              x1={x(p.startSec)}
              x2={x(p.endSec)}
              y1={14 + i * 26}
              y2={14 + i * 26}
              stroke="#a9b9b1"
              strokeWidth={6}
            />
            <circle cx={x(p.passSec)} cy={14 + i * 26} r={4} fill="#205963" />
            <circle
              cx={x(p.soundSec)}
              cy={14 + i * 26}
              r={5}
              stroke="#9b5837"
              fill="none"
              strokeWidth={1.5}
            />
          </g>
        ))}
        {!e.canEdit && (
          <line
            x1={x(Math.min(end, e.snapshot.elapsedMs / 1000))}
            x2={x(Math.min(end, e.snapshot.elapsedMs / 1000))}
            y1={0}
            y2={passes.length * 26}
            stroke="#29443e"
            strokeDasharray="2 2"
          />
        )}
        <text x={42} y={passes.length * 26 + 18}>
          0秒
        </text>
        <text x={260} y={passes.length * 26 + 18} textAnchor="end">
          {Math.round(end)}秒
        </text>
      </svg>
      <p className="workshop-note">● 最接近　○ その場所の音が届く予測</p>
      <div className="pass-list">
        {passes.map((p) => (
          <div key={p.id}>
            <strong>{p.id}</strong>
            <span>
              {p.passSec.toFixed(1)}秒 → {p.soundSec.toFixed(1)}秒
              <small>最接近 約{Math.round(p.distanceM)}m</small>
            </span>
          </div>
        ))}
      </div>
      <p className="workshop-note">
        今の観察地点に立ち続けた場合の目安。音の点は実際の到来履歴で、音量分布の測定ではありません。
      </p>
    </section>
  );
}
