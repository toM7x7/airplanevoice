# 開発PV / 2026-09-22

60秒 / 1920×1080 / 30fps。既存モーション比較動画とは独立したComposition。

## 再制作（リポジトリルート）

1. `npm run dev:shared` で8787を起動。
2. `node scripts/capture-development-pv.mjs` でPC制作操作を収録。専用のローカル展示部屋を新規作成する。AIは全てfixtureであり、有料APIへ接続しない。
3. `node scripts/capture-pv-flight.mjs` で頭上通過を収録。既存の「機体の方を向く」を撮影補助として連続実行する。自動追尾機能のリリースを示す映像ではない。
4. Quest映像はユーザー操作をADB screenrecordで収録したもの。元素材 `output/pv-20260922/quest-take2.mp4` が必要。新しいテイクへ差し替える場合は、採用区間にパススルーや無関係な個人情報がないか必ず見直す。
5. `node scripts/prepare-pv-media.mjs`。Questは確認した20〜32秒の左目のみ、PC観察は25〜41秒を採用。
6. motion-film内で `node node_modules/@remotion/cli/remotion-cli.js render Development-PV ../output/pv-20260922/airplanevoice-development-pv.mp4 --codec=h264 --crf=18 --concurrency=3`。
7. ルートで `node scripts/check-development-pv.mjs`。メタデータ、動き、音声、元録画のフレーム間隔、絵コンテ静止画、review.htmlを生成する。

## 注意点

元素材はgit対象外。新たに取得しない限り他環境ではレンダリングできない。固定API応答の録画はAI実音声会話ではない。Jevのカットは構想図。Questカットは無音。PCの音はWeb Audio出力から収録。今回のアプリUI改善指摘は docs/quest-playtest-2026-09-22.md で管理する。

## タイムライン

- 0–8秒：原点
- 8–17秒：PC制作
- 17–27秒：AI操作デモ（模擬応答）
- 27–37秒：Jevの役割（構想）
- 37–49秒：Quest実機
- 49–60秒：次の開発
