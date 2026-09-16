import { useEffect, useState } from "react";
import type { RoomClient } from "./room-client";

export function RoomInvite({
  client,
  exhibition,
  expiresAt,
  onNote: setNote,
}: {
  client: RoomClient;
  exhibition: boolean;
  expiresAt: number;
  onNote: (text: string) => void;
}) {
  const [qr, setQr] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [visitorQr, setVisitorQr] = useState(true);
  useEffect(() => {
    if (!client.id || client.snapshot.role !== "editor") return;
    let live = true;
    setQr("");
    setInviteUrl("");
    void Promise.all([
      import("qrcode"),
      exhibition && visitorQr
        ? client.visitorInvite()
        : Promise.resolve(client.invite),
    ])
      .then(([QR, url]) => {
        if (live) setInviteUrl(url);
        return QR.toDataURL(url, {
          width: 440,
          margin: 3,
          errorCorrectionLevel: "M",
        });
      })
      .then((image) => {
        if (live) setQr(image);
      })
      .catch(() => {
        if (live) setNote("QRを生成できません。招待URLをコピーして渡せます。");
      });
    return () => {
      live = false;
    };
  }, [client, client.id, exhibition, visitorQr, setNote]);

  return (
    <details className="room-invite">
      <summary>
        {exhibition ? "展示のQR・編集者の招待" : "Quest・もう一台を招待"}
      </summary>
      {exhibition && (
        <label>
          招待する人
          <select
            aria-label="招待する人"
            value={visitorQr ? "visitor" : "editor"}
            onChange={(event) => setVisitorQr(event.target.value === "visitor")}
          >
            <option value="visitor">来場者（観覧のみ）</option>
            <option value="editor">運営（飛行を編集できる）</option>
          </select>
        </label>
      )}
      {exhibition && (
        <p>
          {visitorQr
            ? "来場者用QR。展示時間中は何度でも入り直せます。"
            : "運営用です。来場者には観覧用QRを渡してください。"}
        </p>
      )}
      {qr && <img src={qr} alt="共有する部屋の招待QR" />}
      <input aria-label="部屋の招待URL" readOnly value={inviteUrl} />
      <button
        onClick={() => {
          void navigator.clipboard
            .writeText(inviteUrl)
            .then(() => setNote("招待URLをコピーしました。"))
            .catch(() => setNote("URL欄を選択してコピーしてください。"));
        }}
      >
        招待URLをコピー
      </button>
      <p>
        同じURLで入り直せます。部屋の期限は{" "}
        {new Date(expiresAt).toLocaleTimeString("ja-JP")}
        。QRの読み取りには{" "}
        <a href="https://xrqr.net/" target="_blank" rel="noreferrer">
          XRQR
        </a>{" "}
        も使えます。
      </p>
    </details>
  );
}
