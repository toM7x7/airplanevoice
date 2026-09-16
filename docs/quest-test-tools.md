# Quest実機テストとMeta VR CLI

調査: 2026-09-16。ユーザー提供の[Dilmerの投稿](https://x.com/Dilmerv/status/2099738468389929373)を起点に、Meta公式資料を確認。動画そのものは未確認。CLI・MCP・Muse Codeの導入や実機接続はまだ行っていない。

## 今回の判断

**Meta VR CLIは実機の計測・記録に採用する候補。既存のIWERとChrome DevToolsを併用する。** Muse Codeは別のコーディングエージェントで、CLI利用の必須条件ではない。現在のCodexにもMCP設定先が用意されている。[公式CLI導入](https://developers.meta.com/horizon/essentials/metavr-install/) / [MetaのMuse Code紹介](https://ai.meta.com/llama/)

| 調べること | 使う道具 | Airplanevoiceでの具体的な確認 |
| --- | --- | --- |
| 機種・OS・電池・接続状態 | Meta VR CLI | Quest 2と3を端末IDで分け、結果の取り違えを防ぐ |
| カクつき・CPU/GPU・フレーム時間 | CLI＋Perfetto | 同じ部屋・航路で、仮想の空／AR／地点表示の負荷を比較 |
| JavaScript・WebSocket・音声状態 | Chrome DevTools＋アプリの診断情報 | 部屋の版、便の開始時刻、追跡状態、音声開始失敗を調べる |
| 再現性のある操作回帰 | 既存のPlaywright＋IWER | 模擬Quest 2／3でレイ操作、AR切替、座標変換、再入場を確認 |
| 現実の位置一致・日本語の読みやすさ・音 | 2台の実機＋人 | A/B/Cのずれを実測し、頭を動かしたときの位置・音を比較 |

CLIの画面取得・UI操作は、OS側のUI階層と座標入力を扱う。Three.jsのCanvasに描いた空間内ボタンが、そのまま「日本語のボタン名」で取得できるとは確認されていない。XRのレイや物理コントローラー入力の自動化も実機で成立を確認する。[公式デバイス操作](https://developers.meta.com/horizon/essentials/metavr-devices-and-apps/)

**位置同期・座標校正・負荷計測はそれぞれ別。** CLIの導入では2台の座標は揃わない。Perfettoの成功でも「同じ現実の位置に機体が見えた」とは判断しない。スクリーンショットにパススルー映像が含まれるかもOS・取得方法で確認し、写らない場合は現物の目印と人による記録を使う。

補助候補として、GUIで操作したい場合はMeta Quest Developer HubにもPerfetto・OVR Metricsの記録機能がある。CLIに統一すること自体を目的にせず、取得できる指標と再現性で選ぶ。[MQDHの計測資料](https://developers.meta.com/horizon/documentation/unity/ts-mqdh-logs-metrics/)

Meta Spatial Simulatorは公式には2Dパネル向けで、VRランタイムを持たない。今回の没入型体験を実機相当として置き換える道具にはしない。[公式ツール資料](https://developers.meta.com/horizon/essentials/metavr-environment/)

## 最初の実機テスト

1. Quest 3とQuest 2で同じ部屋を開く。アプリ版、OS、ブラウザ版、機種、電池残量、取得時刻を記録。
2. A/Bでそれぞれ位置合わせし、独立したCで左右・上下・奥行きのずれをcmで記録。左右の立ち位置を変えても同じ物を指せるか確認。
3. 同じ便で仮想の空、AR、会場の地点表示を各30〜60秒観察。静止／見回し／操作盤を開く場面を分ける。体感とアプリのフレーム間隔、実機トレースを対応づける。
4. 一方だけで地点を選び、もう一方とPCへの反映を確認。物理的なずれと通信の遅れを別々に記録。
5. 原点リセット、片方の退出・再入場で、再校正の案内と共有状態の復元を確認。

アプリ内のフレーム間隔はGPU時間そのものではない。端末間で別々に取ったスクリーンショットの機体位置差は取得時刻差を含む。比較には同じ便・共有時刻を残す。CLIのGPUカウンターは標本不足の場合に仮の数値を返すという公式注意もあるため、測定できた項目と欠測を明示する。[性能計測の公式手順](https://developers.meta.com/horizon/essentials/metavr-performance/)

## Windowsでの準備案

必要なものは開発者モード、データ通信対応USBケーブル、ヘッドセット内のUSBデバッグ許可。2台を同時接続する場合はコマンドごとに端末IDを指定する。現在のPowerShellのPATHでは`metavr`、`hzdb`、`adb`は見つからなかった。これは未導入の断定や、端末未接続の判定ではない。

導入する段階で公式配布元とバージョンを確認する。投稿中のインストールコマンドは今回実行していない。公式にはWindowsインストーラーとnpm経由の方法がある。[導入手順](https://developers.meta.com/horizon/essentials/metavr-install/)

導入後の確認例（以下は未実行）:

```powershell
metavr --version
metavr device list
metavr -d <端末ID> device info <端末ID>
metavr -d <端末ID> app list -f browser
```

ブラウザのパッケージ名は実機で確認し、取得対象を決める。WebXRではアプリ独自のAPKをインストールする工程は通常不要。ネイティブアプリ向けの資料例を、そのまま本サービスの導入手順にはしない。

```powershell
metavr -d <端末ID> perf capture --app <確認したブラウザのパッケージ名> --mode vr --duration 10000 --output <機種と日時入りの名前>
metavr perf analyze-trace <返されたセッションID> --focus frames
```

ブラウザは複数プロセスで動くため、必要なレンダラースレッドやGPU情報が取得できたか確認する。上記は実行候補で、Quest Browserの全指標を取得できるという保証ではない。初回解析にはtrace processorの取得が発生する。実験ごとに異なる保存名を使い、前のトレースを上書きしない。[性能計測](https://developers.meta.com/horizon/essentials/metavr-performance/)

Web側はMeta公式のリモートデバッグ手順でChromeの`chrome://inspect/#devices`から検査できる。ローカル版を使う場合の`adb reverse`も記載されている。今のクラウド共有版を開いて調べる場合は、そのローカル転送を必須にしない。[Quest Browserのリモートデバッグ](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)

MCPを使う場合は`metavr mcp install codex`が公式にある。ただしエージェント設定を変更する工程なので、実機のCLI接続ができた段階で接続方法を選ぶ。今はドキュメント調査とテスト設計まで。Muse Codeの契約・モデル利用、サービス内AIへの接続は別件として扱う。

関連: [机の位置合わせ](table-alignment.md) / [技術実験](technology-experiments.md)
