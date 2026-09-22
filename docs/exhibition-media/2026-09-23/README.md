# 展示用の映像とA4横の印刷物

配布先：[exhibition-2026-09-23](https://github.com/toM7x7/airplanevoice/releases/tag/exhibition-2026-09-23)。

## 完成品

- `airplanevoice-60s.mp4`：60秒、1920×1080、30fps、1800フレーム。
- `airplanevoice-30s.mp4`：30秒、1920×1080、30fps、900フレーム。
- `airplanevoice-concept-a4-landscape.png / .pdf`：サービス説明。原点、体験3ステップ、GPT-Live・Jev / Typesafeの役割、クラウドとCodexでの制作。
- `airplanevoice-away-a4-landscape.png / .pdf`：大きな「離席中」と飛行機イラスト。
- `exhibition-kit.zip`：上記完成品、映像レビュー画面、現在地・運用・再開手順。
- `exhibition-media-source.zip`：再編集用の映像素材。`motion-film/public/exhibition-20260923` へ展開する。

## 映像の絵コンテ

| 秒（60秒版） | 場面 | メッセージ |
|---|---|---|
| 0–10 | 現在の飛行映像 | 空を見上げ、音の軌跡をたどる。 |
| 10–19 | PCの形・色・名前の編集 | 形も、響きも、自分の一機に。 |
| 19–25 | AI下書き反映の再現 | 「こうしたい」を、形にする。GPT-LiveとJevの役割。 |
| 25–32 | 景色の手動編集 | どんな場所から、見上げよう。 |
| 32–38 | フライトレーダー／音響マップ | 飛ぶ姿と、音の広がりを眺める。 |
| 38–48 | Quest 3のVR実機映像 | その空に、立ってみる。 |
| 48–60 | 現在の飛行映像とコンセプト | 見上げた空に、あなたの一機。 |

30秒版は同じ順で4・4・5・4・4・5・4秒。見出しを主に読む短縮版。

動画微修正：両方の動画末尾からURL表記を削除。配布リリースのMP4と完成品ZIPも差し替えた。印刷物・手順書のURLは変更していない。

## 証拠と演出の区別

PCは9月23日のローカル実装を収録。AIカットは固定応答を使った再現で、下書きへの反映は実コード。撮影中に有料AIを呼んでいない。公開の景色AIは別途1回の実API呼び出しで確認した。

Questは9月22日に利用者が操作した映像の再利用。UIが旧版である旨を映像内に明記した。ARの新規実機録画ではない。

音声はPC版で収録したエンジン音を編集して使用。AI音声やQuest実機音を収録したものではない。音の到来と映像の厳密な比較には実アプリを使う。映像の追尾カメラは収録補助。

原録画の実測は約29.6〜30.0fps。飛行とQuestの2秒区間は60フレーム中59回の画面変化を確認。完成品の尺・解像度・音声波形・代表フレームを検査した。物理ヘッドセットの性能試験は別途必要。

## 印刷

用紙はA4、向きは横、白黒、1ページを片面印刷。PDFは297×210mm、絵の外に約6mm以上の余白を付けた。「実際のサイズ」で印刷し、プリンター固有の欠けがある場合は「用紙に合わせる」を使う。

PNGは1491×1055の生成画像。300dpiの原稿ではないため、極端に拡大しない。日本語・GPT-Liveの綴り・構成は目視確認済み。

内蔵image_genで生成したイラスト。[生成指示](image-prompts.md)を保存している。生成したコンセプト画であり、アプリ画面ではない。

## 再現

- 撮影：`scripts/capture-exhibition-pv.mjs`。別のローカルDBで起動した8789番を対象。公開ルームを書き換えない。
- 素材変換：`scripts/prepare-exhibition-media.mjs`。
- 編集：`motion-film/src/exhibition-pv`。場面ごとのReactコンポーネント。
- 検査：`scripts/check-exhibition-pv.mjs`。
- PDF：`scripts/prepare-exhibition-print.py`（reportlab、pypdf、Pillow、Popplerが必要）。
