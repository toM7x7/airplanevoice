import { useEffect, useRef, useState } from "react";
import { OBSERVERS, type Experience } from "../../../packages/core/src";
import {
  captureSky,
  decodeSky,
  encodeSky,
  type SkyRecipe,
} from "./sky-transfer";

export function SkyTransfer({
  experience,
  delay,
  observer,
  code,
  onApply,
  onClose,
}: {
  experience: Experience;
  delay: number;
  observer: string;
  code?: string;
  onApply: (sky: SkyRecipe) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const linkField = useRef<HTMLTextAreaElement>(null);
  const [sky, setSky] = useState<SkyRecipe | null>(null);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [qrNote, setQrNote] = useState("");
  const [status, setStatus] = useState("");
  const receiving = code !== undefined;
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    let active = true;
    setSky(null);
    setError("");
    setUrl("");
    setQr("");
    setQrNote("");
    setStatus("");
    async function prepare() {
      try {
        const data = receiving
          ? await decodeSky(code!)
          : captureSky(experience, delay, observer);
        if (!active) return;
        setSky(data);
        if (receiving) return;
        const base = import.meta.env.DEV
          ? "https://tom7x7.github.io/airplanevoice/"
          : new URL(import.meta.env.BASE_URL, location.href).href;
        const link = `${base}#sky=${await encodeSky(data)}`;
        if (!active) return;
        setUrl(link);
        if (link.length > 1800) {
          setQrNote("この航路はQRに収まりません。URLをコピーして渡せます。");
          return;
        }
        try {
          const QRCode = await import("qrcode");
          const image = await QRCode.toDataURL(link, {
            width: 800,
            margin: 4,
            errorCorrectionLevel: "M",
          });
          if (active) setQr(image);
        } catch {
          if (active)
            setQrNote("QRを作れませんでした。URLをコピーして渡せます。");
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "設定を読み込めませんでした。",
          );
      }
    }
    void prepare();
    return () => {
      active = false;
    };
  }, [experience, delay, observer, code, receiving]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("URLをコピーしました。");
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setStatus("URLを選択しました。コピーして渡してください。");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="sky-transfer"
      aria-labelledby="transfer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="info-eyebrow">空を持っていく</span>
          <h2 id="transfer-title">
            {receiving ? "受け取った空" : "この空をQuestへ"}
          </h2>
        </div>
        <button onClick={onClose} aria-label="空の受け渡しを閉じる">
          ×
        </button>
      </header>
      <p>
        {receiving
          ? "内容を確認して取り込むと、この端末の機体・航路・飛び方を置き換えます。"
          : "QRを対応端末で読むか、URLをQuestのブラウザへ送って開いてください。"}
      </p>
      {!sky && !error && <p role="status">設定を準備しています…</p>}
      {error && <p role="alert">{error}</p>}
      {sky && (
        <dl className="transfer-summary">
          <div>
            <dt>機体</dt>
            <dd>
              翼幅 {sky.aircraft.wingSpanM} m · {sky.aircraft.engineCount}
              エンジン
            </dd>
          </div>
          <div>
            <dt>航路</dt>
            <dd>
              {sky.route.generator ? "2地点を通る航路" : "描いた航路"} ·{" "}
              {sky.route.rawPoints.length}点
            </dd>
          </div>
          <div>
            <dt>飛ばし方</dt>
            <dd>
              {sky.airspace.aircraftCount}機 ·{" "}
              {sky.airspace.spacingSec
                ? `${sky.airspace.spacingSec}秒ずつ`
                : "同時に"}{" "}
              · {sky.evolution.enabled ? "変化して周回" : "1周ずつ"}
            </dd>
          </div>
          <div>
            <dt>観察席</dt>
            <dd>{OBSERVERS.find((o) => o.id === sky.observer)?.name}</dd>
          </div>
        </dl>
      )}
      {qr && (
        <>
          <p className="transfer-guide">
            Questのブラウザで{" "}
            <a
              href="https://xrqr.net/"
              target="_blank"
              rel="noopener noreferrer"
            >
              XRQRを開く ↗
            </a>{" "}
            → カメラを許可して、このQRを読む →「ブラウザで開く」。
            開いた画面で「この空を取り込む」を押します。
          </p>
          <img
            className="transfer-qr"
            src={qr}
            alt="この空の設定を開くQRコード"
          />
        </>
      )}
      {qrNote && <p>{qrNote}</p>}
      {url && (
        <>
          <label>
            渡すURL
            <textarea
              ref={linkField}
              aria-label="渡すURL"
              readOnly
              value={url}
              rows={2}
            />
          </label>
          <button className="primary" onClick={() => void copy()}>
            URLをコピー
          </button>
        </>
      )}
      {receiving && sky && (
        <button
          className="primary"
          disabled={!experience.canEdit}
          onClick={() => {
            try {
              onApply(sky);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "取り込めませんでした。",
              );
            }
          }}
        >
          この空を取り込む
        </button>
      )}
      {receiving && !experience.canEdit && (
        <p>飛行を終えて編集画面へ戻ると取り込めます。</p>
      )}
      <p className="transfer-note">
        機体・航路・機数・周回・音の遅れ・観察席を渡します。飛行は各端末で開始します。音量や装着位置は各端末で調整できます。
      </p>
      <p className="transfer-note">
        設定はURLに含まれます。あとで編集しても、このURLの内容は変わりません。
      </p>
      {status && <p role="status">{status}</p>}
      <button className="secondary" onClick={onClose}>
        {receiving ? "今の空を続ける" : "閉じる"}
      </button>
    </dialog>
  );
}
