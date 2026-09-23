# 別PC・別Codexでの再開入口

更新：2026-09-24。

## 最初に開くURL

- **展示・PC・Quest共通： https://airplanevoice.pages.dev/?shared=1**
- ソース：https://github.com/toM7x7/airplanevoice
- 最新開発ブランチ：`feat/exhibition-flight-studio`
- 作業PR：https://github.com/toM7x7/airplanevoice/pull/1
- [現在地とロードマップ](ROADMAP.md) / [当日の運用](docs/exhibition-runbook.md)
- 動画・A4横の印刷物：[展示持ち込み版](https://github.com/toM7x7/airplanevoice/releases/tag/exhibition-2026-09-23)。`exhibition-kit.zip` に完成品と手順をまとめている。

公開体験はCloudflareで動く。この開発PCを閉じても公開サービスは動く。`localhost` / `127.0.0.1` はその端末自身なので、別PCやQuestへそのまま引き継ぐURLではない。

**mainだけをcloneすると古い実装になる。** PR #1は未マージ。以下のブランチを取得する。

## 別のWindowsノートPCで準備

GitとNode.js 22.12以降、Codexを用意し、PowerShellで実行する。

```powershell
git clone --branch feat/exhibition-flight-studio https://github.com/toM7x7/airplanevoice.git
cd airplanevoice
npm ci
npx playwright install chromium
npm run check:worker
npm run build
npx wrangler dev --port 8787
```

ローカル版： http://127.0.0.1:8787/?shared=1 。共有用DBはこのPCのローカル状態であり、本番の格納庫とは別。

Codexの「プロジェクトを追加」で、この `airplanevoice` フォルダを開く。会話履歴が別端末へ必ず復元される前提にせず、下の依頼文を新しいタスクへ貼る。

### 再開用の依頼文

```text
AIRPLANEVOICEの開発をこのPCで再開します。
まず HANDOFF.md、ROADMAP.md、docs/exhibition-runbook.md と git status / branch / log を確認してください。
最新は feat/exhibition-flight-studio、PR #1は未マージです。mainを最新と扱わないでください。
Quest 3一台＋運営PCが今回の展示構成です。原点は、旅客機を見上げ、遅れて届く音に見惚れることです。
公開URLは https://airplanevoice.pages.dev/?shared=1 です。
クラウド格納庫、公開中の機体、予約、運営設定、AIの既存Secretsを初期化しないでください。
今回は「ここに直したい症状や希望を書く」を改善したいです。
既存の手操作とVR/ARの動線を確認し、小さく修正→関連テスト→PC操作→可能ならQuest実機確認まで進めてください。
AIの失敗や未確認事項を区別し、保存・共有・出発の最終決定は利用者に残してください。
会期中メモとして、QuestでVRへ入った直後のAI操作案内（押す場所の説明・対象ボタンの強調）を検討してください。これは未実装です。画面ガイドの表示とGPT-Liveのマイク／音声対話の開始は分け、利用者が音声対話を選べる形にしてください。
GitHubへコミット・pushし、PRを更新してください。公開は既存Cloudflareアカウントを確認してから行ってください。
```

## 更新を公開する場合

GitHubへのpushとCloudflareへのデプロイは別。現在のGitHub ActionsのPagesは旧単体版用で、共有版の自動公開ではない。

1. GitHubへpushする認証を用意（Git Credential Manager、または `gh auth login`）。APIキーをチャットやGitへ貼らない。
2. `npx wrangler login` → `npx wrangler whoami`。配置先Account IDは **754acbe167d743ab44593f5f828f42ee**。別アカウントなら公開せず切り替える。
3. 公開APIキーは既存WorkerのSecretsにある。PCへコピーしなくても通常の再デプロイで保持される。ローカルAIを使いたい時だけ `.dev.vars` に設定し、Gitへ入れない。
4. 以下を実行する。

```powershell
npm test
npm run check:worker
npm run build
npx wrangler deploy --keep-vars
node scripts/prepare-pages.mjs
Push-Location pages
$env:CLOUDFLARE_ACCOUNT_ID='754acbe167d743ab44593f5f828f42ee'
npx wrangler pages deploy ../output/pages-release --project-name airplanevoice --branch main --commit-dirty=true
Pop-Location
```

共有Worker名は `airplanevoice-shared-sky`、Pages名は `airplanevoice`。PagesからWorkerへのService Bindingを維持する。

公開後、ページの最新版と共有接続、格納庫、音、VR入口を確認する。使用中タブを勝手に終了させない。`scripts/radar-public-check.mjs`は読む中心の確認だが、4接続枠を一つ使う。

### ローカル版をUSB接続のQuestで確認

Android Platform Toolsのadbが別途必要。Questの開発者モードとUSBデバッグ許可を確認後：

```powershell
adb devices
adb reverse tcp:8787 tcp:8787
```

Questブラウザで `http://localhost:8787/?shared=1` を開く。USBを外せばこの転送は使えない。会場ではまずHTTPSの公開URLを使う。

## 引き継がれるもの／別途必要なもの

- Git：ソース、テスト、設計、手順、Remotion編集コード。
- Cloudflare：公開格納庫・共有状態・Secrets。ローカルDBと混同しない。
- リリース添付：完成動画と印刷用画像/PDF。別PCへ事前にダウンロードする。
- このPC固有：未追跡の `.dev.vars`、`.wrangler`、`node_modules`、録画素材、Word原本、ログ。原資料の要点は `docs/source-analysis.md` とメモに残している。
- 動画の再編集：`cd motion-film; npm ci`。今回のメディア素材はリリースの素材ZIPを `motion-film/public/exhibition-20260923` へ展開する。

元のPCとノートPCで同時編集する場合は、作業開始前にfetch/pullし、同じファイルを別々に書き換えたまま進めない。最新のpush済みコミットと公開バージョンを都度記録する。

## 今回の固定版

タグ：`exhibition-2026-09-23`。公開Worker `91cbcb3d-f9cc-423e-a41b-b214c0688393`、Pages `ce3b5de9`、オフラインbundle `15c380617e8ec952`。

258件のテスト、型検査、PC操作、公開の配信物・共有・模擬ステレオ表示を確認。公開AIへ景色案を1回問い合わせ、複数パラメータの下書きが返ることを確認。今回のQuest実機チェックは未実施。

動画の再書き出し：素材ZIPの中身を前記フォルダへ展開後、`motion-film` で `npm ci` → `npx remotion studio --no-open`。

```powershell
npx remotion render src/index.ts Exhibition-PV-60 out/airplanevoice-60s.mp4
npx remotion render src/index.ts Exhibition-PV-30 out/airplanevoice-30s.mp4
```

素材と表記の詳細：[展示素材の記録](docs/exhibition-media/2026-09-23/README.md)。AI応答の再現映像と9月22日のQuest収録を区別している。
