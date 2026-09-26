import { useState } from "react";
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
  consult: (text: string) => Promise<string>;
}) {
  const [question, setQuestion] = useState(""),
    [reply, setReply] = useState(""),
    [busy, setBusy] = useState(false);
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
      <label>
        景色の名前
        <input
          aria-label="景色の名前"
          maxLength={40}
          placeholder={ENVIRONMENT_PRESETS[value.preset].label}
          value={value.name ?? ""}
          onChange={(e) =>
            set({
              ...value,
              name: e.target.value.trim() ? e.target.value : undefined,
            })
          }
        />
      </label>
      <form
        className="environment-consult"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !question.trim()) return;
          setBusy(true);
          setReply("AIに相談しています…");
          try {
            setReply(await consult(question.trim()));
          } catch (error) {
            setReply(
              error instanceof Error
                ? error.message
                : "相談に接続できませんでした。",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          作りたい景色を文字で相談
          <textarea
            aria-label="作りたい景色を文字で相談"
            maxLength={500}
            placeholder="例：都市にして。建物は低めで、空が広く見える感じ"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? "相談中…" : "景色の案を相談する"}
        </button>
        {reply && <p role="status">{reply}</p>}
      </form>
      <div className="wb-choices">
        {Object.entries(ENVIRONMENT_PRESETS).map(([id, p]) => (
          <button
            key={id}
            aria-pressed={value.preset === id}
            onClick={() =>
              set({
                ...environmentPreset(id as EnvironmentRecipe["preset"]),
                name: value.name,
                buildingSound: value.buildingSound,
              })
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
      <label className="environment-sound">
        <input
          type="checkbox"
          checked={value.buildingSound ?? false}
          onChange={(e) => set({ ...value, buildingSound: e.target.checked })}
        />{" "}
        建物で音がこもる表現を試す
      </label>
      <button className="primary" disabled={!ready} onClick={apply}>
        みんなの空に反映
      </button>
      <p role="status">{message}</p>
      <small>
        自分と音源の間に建物があると、音量と高音を少し抑える簡易表現です。反射・残響は含みません。ARでは仮想の建物とこの効果を隠します。
      </small>
    </aside>
  );
}
