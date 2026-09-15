import type { Experience } from "../../../packages/core/src";

export function EvolutionControls({
  experience: e,
}: {
  experience: Experience;
}) {
  const s = e.snapshot;
  return (
    <section className="evolution-controls" aria-label="周回の変化">
      <label className="evolution-toggle">
        <input
          type="checkbox"
          checked={s.evolution.enabled}
          onChange={(event) =>
            e.setEvolution({ ...e.evolution, enabled: event.target.checked })
          }
        />
        周回ごとに変化して飛び続ける
      </label>
      {s.evolution.enabled && (
        <>
          {e.canEdit ? (
            <label className="range-label evolution-amount">
              変化の幅 <span>{Math.round(s.evolution.amount * 100)}%</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                aria-label="周回の変化の幅"
                value={s.evolution.amount}
                onChange={(event) =>
                  e.setEvolution({
                    ...e.evolution,
                    amount: Number(event.target.value),
                  })
                }
              />
            </label>
          ) : (
            <div className="evolution-lap">
              <span>
                第 <strong>{s.lap + 1}</strong> 周
              </span>
              <span>
                {s.evolution.changed ? "少し違う航路へ" : "はじまりの航路"}
              </span>
            </div>
          )}
          <p className="evolution-note">
            {s.evolution.nextInSec !== null
              ? s.paused
                ? "次の飛行まで、ひと休み。"
                : `音の余韻を待ちました。あと${Math.ceil(s.evolution.nextInSec)}秒で次の航路へ。`
              : "旋回の幅と起伏が少しずつ変わります。全機の音の余韻を待って、次の飛行へ。"}
          </p>
        </>
      )}
      {s.evolution.error && (
        <p className="workshop-error" role="alert">
          {s.evolution.error}{" "}
          自動継続を止めました。変化の幅を下げるか、航路を調整してください。
        </p>
      )}
    </section>
  );
}
