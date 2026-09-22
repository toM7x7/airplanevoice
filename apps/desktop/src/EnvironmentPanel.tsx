import {
  ENVIRONMENT_PRESETS,
  type EnvironmentRecipe,
  environmentPreset,
} from "../../../packages/core/src/environment";
export function EnvironmentPanel({
  value,
  set,
  apply,
  close,
  ready,
  message,
  consult,
}: {
  value: EnvironmentRecipe;
  set: (r: EnvironmentRecipe) => void;
  apply: () => void;
  close: () => void;
  ready: boolean;
  message: string;
  consult: () => void;
}) {
  return (
    <aside
      className="environment-panel"
      aria-label="空間づくり"
      data-ai-control="environment"
    >
      <header>
        <h2>空間づくり</h2>
        <button onClick={close}>閉じる</button>
      </header>
      <p>この画面で景色を試し、「みんなの空に反映」でQuestにも届けます。</p>
      <div className="wb-choices">
        {Object.entries(ENVIRONMENT_PRESETS).map(([id, p]) => (
          <button
            key={id}
            aria-pressed={value.preset === id}
            onClick={() =>
              set(environmentPreset(id as EnvironmentRecipe["preset"]))
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      {(
        [
          ["density", "建物の密度", 0, 1, 0.05],
          ["heightM", "建物の高さ（m）", 4, 120, 1],
          ["streetWidthM", "通りの広さ（m）", 20, 100, 1],
          ["greenery", "緑の量", 0, 1, 0.05],
          ["seed", "配置番号", 0, 9999, 1],
        ] as const
      ).map(([key, label, min, max, step]) => (
        <label key={key}>
          {label} <output>{Math.round(value[key] * 100) / 100}</output>
          <input
            aria-label={label}
            type={key === "seed" ? "number" : "range"}
            min={min}
            max={max}
            step={step}
            value={value[key]}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n))
                set({ ...value, [key]: Math.max(min, Math.min(max, n)) });
            }}
          />
        </label>
      ))}
      <button onClick={consult}>文字でAIに相談</button>
      <button className="primary" disabled={!ready} onClick={apply}>
        みんなの空に反映
      </button>
      <p role="status">{message}</p>
      <small>
        建物は軽量な試作です。ARでは背景を隠し、現実の景色を使います。音の反射・遮音はまだ再現しません。
      </small>
    </aside>
  );
}
