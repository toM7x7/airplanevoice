import { useEffect, useState } from "react";
import {
  checkedEntry,
  HANGAR_LIMIT,
  type HangarEntry,
} from "../../../packages/core/src/hangar";
import { DEFAULT_SOUND } from "../../../packages/core/src/sound-design";
import { overheadRecipe } from "../../../packages/core/src/overhead";
import type { WorkshopRecipe } from "../../../packages/core/src/workshop";

const KEY = "airplanevoice-hangar-v1";
export function CreationShelf({
  recipe,
  onLoad,
  enabled = true,
  shared,
  onPublish,
  onRemove,
  onLaunch,
  persistent = false,
}: {
  recipe: WorkshopRecipe;
  onLoad: (r: WorkshopRecipe) => void;
  enabled?: boolean;
  shared?: HangarEntry[];
  onPublish?: (e: HangarEntry) => void;
  onRemove?: (id: string) => void;
  onLaunch?: () => void;
  persistent?: boolean;
}) {
  const [items, setItems] = useState<HangarEntry[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(raw)
        ? raw.slice(0, HANGAR_LIMIT).map(checkedEntry)
        : [];
    } catch {
      return [];
    }
  });
  const [name, setName] = useState("私の旅客機");
  const [message, setMessage] = useState("");
  const [sound, setSound] = useState(recipe.aircraft.sound ?? DEFAULT_SOUND);
  useEffect(
    () => setSound(recipe.aircraft.sound ?? DEFAULT_SOUND),
    [recipe.aircraft.sound],
  );
  useEffect(() => {
    const refresh=()=>{try {const raw=JSON.parse(localStorage.getItem(KEY)??"[]");if(Array.isArray(raw))setItems(raw.slice(0,HANGAR_LIMIT).map(checkedEntry));}catch { /* Keep displayed values if storage is invalid. */ }};
    window.addEventListener("airplanevoice-hangar-change",refresh); window.addEventListener("storage",refresh);
    return ()=>{window.removeEventListener("airplanevoice-hangar-change",refresh);window.removeEventListener("storage",refresh);};
  },[]);
  function act(fn: () => void) {
    try {
      fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  function persist(next: HangarEntry[]) {
    if (next.length > HANGAR_LIMIT)
      throw new Error("保存は24機までです。不要な機体を削除してください。");
    localStorage.setItem(KEY, JSON.stringify(next));
    setItems(next);
    window.dispatchEvent(new Event("airplanevoice-hangar-change"));
  }
  function load(entry: HangarEntry) {
    onLoad(entry.recipe);
    setSound(entry.recipe.aircraft.sound ?? DEFAULT_SOUND);
    setName(entry.name);
  }
  function download(entry: HangarEntry) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "airplanevoice-aircraft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="creation-shelf" aria-label="音と格納庫">
      <h2>一機をつくって、同じ空へ。</h2>
      <button
        disabled={!enabled}
        onClick={() =>
          act(() => {
            onLoad(overheadRecipe({ x: 0, y: 1.7, z: 0 }, recipe));
            setMessage(
              "地上の原点から約220m上を通る航路を準備しました。飛行開始で見上げてみてください。",
            );
          })
        }
      >
        頭上を通る一機を準備
      </button>
      <p>実寸の機体で通過を楽しむ。音・形・航路を一緒に保存できます。</p>
      <fieldset disabled={!enabled}>
        <legend>旅客機の響き</legend>
        {(
          [
            ["body", "低い厚み"],
            ["fan", "ファンの響き"],
            ["air", "空気を切る音"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label} {Math.round(sound[key] * 100)}%
            <input
              aria-label={label}
              type="range"
              min="0"
              max="100"
              value={Math.round(sound[key] * 100)}
              onChange={(e) =>
                setSound({ ...sound, [key]: +e.target.value / 100 })
              }
            />
          </label>
        ))}
        <button
          onClick={() =>
            act(() => {
              onLoad({ ...recipe, aircraft: { ...recipe.aircraft, sound } });
              setMessage(
                "次の飛行に音色を反映しました。反映後に保存してください。",
              );
            })
          }
        >
          音色を次の飛行に反映
        </button>
      </fieldset>
      <h3>このブラウザの格納庫（{items.length}/24）</h3>
      <label>
        機体の名前
        <input
          aria-label="保存する機体の名前"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        onClick={() =>
          act(() => {
            persist([
              ...items,
              checkedEntry({ id: crypto.randomUUID(), name, recipe }),
            ]);
            setMessage("機体・航路・音をこのブラウザに保存しました。");
          })
        }
      >
        今の設定を名前付きで保存
      </button>
      <label>
        保存ファイルを読み込む
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";
            if (file.size > 16000) {
              setMessage("ファイルが大きすぎます。");
              return;
            }
            try {
              const entry = checkedEntry(JSON.parse(await file.text()));
              persist([...items.filter((i) => i.id !== entry.id), entry]);
              setMessage("格納庫に読み込みました。");
            } catch {
              setMessage("機体の保存ファイルを確認してください。");
            }
          }}
        />
      </label>
      <ul>
        {items.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.name}</strong>{" "}
            <button disabled={!enabled} onClick={() => act(() => load(entry))}>
              呼び出す
            </button>{" "}
            <button onClick={() => download(entry)}>ファイル保存</button>{" "}
            {onPublish && (
              <button disabled={!enabled} onClick={() => onPublish(entry)}>
                {persistent ? "クラウドへ登録" : "部屋へ登録"}
              </button>
            )}{" "}
            <button
              onClick={() =>
                act(() => persist(items.filter((i) => i.id !== entry.id)))
              }
            >
              削除
            </button>
          </li>
        ))}
      </ul>
      {shared && (
        <>
          <h3>{persistent ? "クラウド格納庫" : "この部屋のみんなの空"}（{shared.length}/24）</h3>
          <p>
            {persistent ? "PC・Questで共有し、ブラウザを閉じた後も保存します。" : "部屋が終了するまで共有。"}設定した機体数に合わせ、展示の自動飛行で順番に登場します。
          </p>
          <ul>
            {shared.map((entry) => (
              <li key={entry.id}>
                {entry.name}{" "}
                <button
                  disabled={!enabled}
                  onClick={() => act(() => load(entry))}
                >
                  設定を呼び出す
                </button>{" "}
                <button onClick={() => download(entry)}>ファイル保存</button>{" "}
                <button
                  disabled={!enabled}
                  onClick={() => onRemove?.(entry.id)}
                >
                  {persistent ? "クラウド格納庫から外す" : "部屋から外す"}
                </button>
              </li>
            ))}
          </ul>
          <button disabled={!enabled || !shared.length} onClick={onLaunch}>
            格納庫のみんなを飛ばす
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
