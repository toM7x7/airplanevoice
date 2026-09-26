import { AIRCRAFT, type Experience } from "../../../packages/core/src";

export function AirspaceControls({
  experience: e,
}: {
  experience: Experience;
}) {
  const { airspace, fleet, focusId, mixMode } = e.snapshot;
  return (
    <section className="airspace-controls" aria-label="空のにぎわいと聴き方">
      <div className="airspace-heading">
        <h2>空のにぎわい</h2>
        <span>LOCAL SKY</span>
      </div>
      <div
        className="segmented"
        aria-label="飛ばす機数"
        data-ai-control="fleet"
      >
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            disabled={!e.canEdit || !!e.show}
            aria-pressed={airspace.aircraftCount === n}
            onClick={() => e.setAirspace({ ...airspace, aircraftCount: n })}
          >
            {n}機
          </button>
        ))}
      </div>
      {airspace.aircraftCount > 1 && (
        <>
          {!e.show && (
            <label className="spacing-label">
              飛び始める間隔
              <select
                aria-label="飛び始める間隔"
                disabled={!e.canEdit}
                value={airspace.spacingSec}
                onChange={(event) =>
                  e.setAirspace({
                    ...airspace,
                    spacingSec: Number(event.target.value) as 0 | 8 | 16,
                  })
                }
              >
                <option value={0}>同時に</option>
                <option value={8}>8秒ずつ</option>
                <option value={16}>16秒ずつ</option>
              </select>
            </label>
          )}
          <div
            className="segmented listening-mode"
            aria-label="聴き方"
            data-ai-control="mix"
          >
            <button
              aria-pressed={mixMode === "focus"}
              onClick={() => e.setMix("focus")}
            >
              注目機を聴く
            </button>
            <button
              aria-pressed={mixMode === "balanced"}
              onClick={() => e.setMix("balanced")}
            >
              空全体を聴く
            </button>
          </div>
          <div className="flight-picker" aria-label="注目する機体">
            {AIRCRAFT.slice(0, airspace.aircraftCount).map((a) => {
              const f = fleet.find((f) => f.id === a.id);
              const state = f
                ? {
                    waiting: "待機",
                    flying: "飛行中",
                    tail: "音の余韻",
                    complete: "終了",
                  }[f.state]
                : "準備";
              return (
                <button
                  key={a.id}
                  aria-label={`${a.id}に注目`}
                  aria-pressed={mixMode === "focus" && focusId === a.id}
                  onClick={() => e.setMix("focus", a.id)}
                >
                  <i style={{ background: a.accent }} />
                  <strong>{a.id}</strong>
                  <small>{state}</small>
                </button>
              );
            })}
          </div>
          <p className="airspace-hint">
            尾翼の色が目印。注目機を変えると、ほかの響きがそっと引きます。
          </p>
        </>
      )}
      <label className="checkbox tower-toggle">
        <input
          type="checkbox"
          checked={e.tower.enabled}
          onChange={(event) => e.setTower(event.target.checked)}
        />
        管制案内を表示する
      </label>
    </section>
  );
}
