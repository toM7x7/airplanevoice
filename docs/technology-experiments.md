# 3D表現と仕組みの実験候補

初回調査: 2026-09-15 / 2026-09-16にXRのHTML UIとBANGEOリポジトリの調査を追記。人気順位ではなく、この体験に使えそうな公式機能を整理する。

## 今の技術を簡単に言うと

- **Three.js**: ブラウザに機体、空、光、カメラを描くための道具。
- **React Three Fiber**: 画面の設定とThree.jsのシーンをつなぐ。
- **TypeScript**: 機体や航路の設定項目、イベントの形をコードでそろえる。JSONなど外から入る値は、実行時の検証も行う。
- **自作部分**: 航路を整える計算、時刻による飛行、音の伝わり方、聴き方、生成レシピ、管制案内。

## 今回入れたもの

### 同じ部品をまとめて描く

1機52枚の窓をInstancedMeshでまとめた。寸法変更は部品を作り捨てず、配置と倍率を変える。距離が遠いときは窓・吸気口の細部・コックピットを省略し、近づいたときに戻す。境界には余裕を持たせ、細部が点滅することを避ける。

同じ1366×768、3機同時、シミュレーション18.5秒、同じカメラの比較で、描画呼び出しは**284→131**。三角形数は両方18,596。これは今回の場面での描画命令数の削減であり、フレームレートやQuestでの速度改善率の測定ではない。詳細は`output/workshop/budget-before.json`と`budget-after.json`。

公式: [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)、[LODの距離とヒステリシス](https://threejs.org/docs/pages/LOD.html)。現行コードの細部切り替えは距離判定を自作している。

## これから触って確かめたいもの

2026-09-16追記: 品質目標「見惚れる」に対する優先候補と比較条件を[体験品質の仕様案](absorbing-flight.md)へ具体化した。先に通常の観察距離で光・形の違いが届くかを確かめ、その結果から機体制作や描画技術を選ぶ。以下の候補は技術選択肢として残す。

| 候補 | この体験での使い道（提案） | 最初の小さな実験 |
| --- | --- | --- |
| WebGPU / TSL | 空の光、霞、エンジン後方の熱の揺らぎをパラメーター化 | 既存シーンと同じ1機で見た目とフレーム時間を比較 |
| 部品からの機体生成 | 翼形・胴体・エンジン位置を組み合わせ、固有のシルエットを作る | 現行の寸法変更から、翼の後退角と断面へ広げる |
| Blenderでの部品制作 | 胴体やエンジンの細部を作り、Web側で軽量な部品として使う | 1部品の見栄え・データ量・読み込み時間を比較 |
| WebXR | 頭の向きと音が一致する空、手での地点指定 | 1台のQuestで見上げ・見回し・音の追従を検証 |
| 予定から作る演目 | シードと時刻から同じ飛行を何台でも再現 | 2端末の時刻ずれと途中参加を記録 |

Three.jsのWebGPURendererはWebGPUを利用し、対応がないときはWebGL 2へ切り替える仕組みを持つ。TSLはJavaScriptの式からシェーダーを組み立てるための仕組み。現行アプリはWebGLRendererで動いており、移行はまだ行っていない。公式: [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)、[TSL仕様](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)。

WebGPUの存在だけでQuest上の品質・速度や既存の描画との互換性は判断しない。現行の空のシェーダー、音航跡、XRの表示を同条件で試す。気流の表現を追加する場合も、「見せる演出」と「流体を計算した結果」は分ける。

## 2026-09-16: HTMLで作るXRの操作盤

ユーザー提供: [BANGEO「WebXRでHTML UIを扱う未来」](https://www.bangeo.net/tech-articles/webxr-html-ui-dom-overlay-html-in-canvas-spatial-css)（記事日付2026-06-11）。記事本文とリンク先の一次資料を確認した。以下は採用候補の調査で、実装・Quest実機検証は行っていない。

### 現行との接点

`apps/desktop/src/vr.ts`では1024×512のCanvasへ文字とボタンを描き、`CanvasTexture`を空間内の板へ貼っている。コントローラーのレイと板の交点からボタンを判定する。日本語の複数行説明、長い部屋一覧、地図とブース詳細、将来のAIの案内文を増やすと、手動の描画・配置処理も増える。

記事を踏まえた設計案は、操作の意味と共有処理を共通にし、PCのHTML表示とXRの表示方法を選べるようにすること。HTML UI導入自体で、部屋の移動・AR切り替え・AI接続まで実装されるわけではない。

| 方法 | Airplanevoiceでの候補 | 現時点の判断 |
| --- | --- | --- |
| 現行の3D操作盤 | すぐ見る・音量・飛行開始など少数の操作 | 既存方式で入口の単純化を進められる |
| DOM Overlay | 対応端末のAR説明・短い設定・復旧案内 | 条件付き候補。仕様上は単一の2D DOM領域で、重ね合わせ位置はブラウザ側の方式に従う。任意の地図オブジェクト配置とは分ける |
| HTML-in-Canvas | 空間に置く地図、部屋カード、機体情報、AIの短い案内 | 小さな比較試作の第一候補。ブラウザAPIとXR入力の成立を確認してから採用 |
| Spatial CSS | 将来の空間対応ブラウザで見る入口・カタログ | 提案を追跡。現在のQuest向け飛行シーンの基盤変更には使わない |

DOM Overlayは`optionalFeatures`で要求し、`session.domOverlayState`で有効化を確認する。表示できるときは`beforexrselect`でUI操作と機体選択の二重発火を抑える。DOM Overlayの一般的な仕様対応を、そのままQuest 3での動作確認とは扱わない。[W3C仕様](https://immersive-web.github.io/dom-overlays/)

HTML-in-CanvasはDOMをCanvasやWebGL/WebGPUのテクスチャへ描く実験的API。Chrome公式の紹介では148〜150のOrigin Trialが記載されているが、この記事のバージョン範囲だけで現在のQuestブラウザへの一般提供を判断しない。WebXRの入力との統合は2026年5月の議事録でも検討対象。[Chrome公式](https://developer.chrome.com/blog/html-in-canvas-origin-trial) / [WICG提案](https://github.com/WICG/html-in-canvas) / [WebXRとの統合議論](https://www.w3.org/2026/05/19-immersive-web-minutes.html)

導入済みThree.jsの`src/textures/HTMLTexture.js`と`renderers/webgl/WebGLTextures.js`に対応処理があることを確認。現行WebGLRendererにもブラウザの`texElementImage2D`を呼ぶ経路があり、この候補を試すためにWebGPU移行を必須にする必要はない。ただし、ライブラリ内にコードがあることと、Questの表示・入力が成立することは別。[Three.js HTMLTexture](https://threejs.org/docs/pages/HTMLTexture.html)

Spatial CSSは文書自体へ奥行きを加える提案で、HTMLの説明やカードと3Dを同じ文書内に配置する方向。WebXRシーンの操作盤の直接的な置き換えとして採用しない。[WebKit提案](https://github.com/WebKit/explainers/blob/main/css-spatial/explainer.md)

### 最初に試すなら

**地図と3つの地点ボタンだけの小さなパネル**を、現行方式とHTML-in-Canvasで比較する案。最初は表示・選択までの検証とし、実ブースの測量、AI、公開ロビーの実装を一緒に完了した扱いにしない。

- PCでの表示に加え、Questの両眼表示・日本語の読みやすさ・レイのホバー／クリック・必要ならスクロールを確かめる。
- ブラウザAPI検出と実際の試験描画を行い、使えない環境では現行の操作盤で同じ操作を行える構成を検討する。来場者に実験フラグの変更を必須にしない。
- 機体選択との二重入力、VR／AR入退場後の復帰、表示更新時のフレーム間隔を確認する。
- フォーム入力やアクセシビリティは、HTMLを描画できたことだけで動作保証しない。必要な操作ごとに実機確認する。

表示方式を増やしても、通常は空を眺め、必要なときだけ小さなパネルを開く体験を維持する。関連: [展示入口](room-lobby-flow.md) / [ARと地図](ar-modes.md)。

## 2026-09-16: BANGEO全体から選ぶ実験

ユーザー提供: [サイト](https://www.bangeo.net/) / [リポジトリ](https://github.com/WebXR-JP/bangeo)。記事一覧・関連する記事本文・XRの実装例を調査した。参照したリポジトリの版は`bdfc9daef3183d0e5ab7cdb64f5b7f0b2d0f5ac6`。以下は優先候補で、導入済み一覧ではない。記事の日付と現在の公式仕様、ライブラリ内の対応コードとQuest実機での成立を分ける。

| 優先候補 | このサービスで楽しくなる瞬間 | 最初の検証と留意点 |
| --- | --- | --- |
| 会場図＋地点登録、平面・メッシュ・アンカー | 現実の展示のそばへ小さな旅客機が飛び、行き先を示す | 手動の3地点から開始。取得した室内形状は補助情報。図面との対応・ブースID・端末ごとの校正は別途必要 |
| Shared Spaces | 2人が「ここを飛んでいる」と同じ現実の場所を指せる | 管理下のQuest 2台で評価。実験的APIとして扱い、手動校正を残す |
| HTML-in-Canvas / HTMLTexture | 読みやすい日本語の地図パネルから、すぐ飛ばせる | 既述の3地点UI比較。API検出に加えXR入力・両眼表示を試す。現行Canvas操作盤へ戻せる構成 |
| GLB部品とKHR_interactivity | エンジンや翼を選んで、部品の動きや構造を触って確かめる | まずGLB 1部品と既存コードで操作。動作をモデルへ持たせる拡張は、対応ランタイムで別試験 |
| WebGPU / TSL | 旋回した機体の側面に光が走り、排気後方の空気がわずかに揺らぐ | 同じ1機・航路でWebGLと比較。QuestのXRでフレーム時間・材質・音を測る。流体解析済みとは呼ばない |
| IWSDKのAI開発支援・IWER | 開発中、AIが模擬コントローラーを動かして操作不具合を見つける | サービス内のAI管制と別の用途。既存IWER検証を活かし、R3Fから全面移行する前提にはしない |
| CloudXR.js | GPUサーバーで描く高精細な旅客機を、ブラウザのQuestで体験する | 将来の1日実験候補。別のGPUサーバーとOpenXRアプリが必要。遅延・会場回線・費用を測ってから採否を決める |

### ソースから確認できたこと

- **室内形状**: BANGEOの[xr-mesh-export](https://github.com/WebXR-JP/bangeo/tree/bdfc9daef3183d0e5ab7cdb64f5b7f0b2d0f5ac6/apps/xr-mesh-export)は`mesh-detection`を必須としてARを開始し、検出形状をThree.jsへ写してGLTFExporterでGLB保存する。会場全域の自動測量・ブース識別・複数台の位置合わせまで実装されたものではない。自アプリでは取得機能がない場合の代替操作が必要。[会場マッピングの段階](ar-modes.md#2026-09-16-会場マッピングの実現性と最初の検証)
- **位置合わせ**: [Shared Spacesの説明](https://github.com/cabanier/shared-spaces/tree/dev)は実験機能を明記。共通座標の確立前後や退出で状態が変わる。現行の部屋同期はこの機能を使用していない。[MetaのMR資料](https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/)の永続アンカーと、別端末への共通座標配布も同一機能として扱わない。
- **動作を含むモデル**: BANGEOの7月記事ではKHR_interactivityは批准候補だったが、9月16日に確認した[Khronosの拡張一覧](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md)では批准済みに掲載。導入済みThree.jsの`GLTFLoader.js`では`KHR_interactivity`の記載を確認できず、このアプリでそのまま動くとは判断しない。フライトの共有・権限・音の進行はモデル内動作とは別に保持する。
- **描画**: [Three.js公式](https://threejs.org/docs/pages/WebGPURenderer.html)にはWebGPUからWebGL 2への代替とXRのmultiview設定がある。既存WebGLRenderer用の独自シェーダーまで自動で互換になる保証ではない。現在使っている固定foveationやLODは既存施策として扱い、新規導入の成果に数えない。
- **開発用AI**: [IWSDK公式](https://iwsdk.dev/ai/)はMCP経由のXR入力・スクリーンショット・シーン確認などを提供。SDK固有の状態検査と、既存R3Fアプリでも使っているIWERの模擬入力を区別して導入判断する。エミュレーターの成功をQuestの実機品質に置き換えない。
- **遠隔描画**: [NVIDIA公式サンプル](https://github.com/NVIDIA/cloudxr-js-samples)にはR3Fクライアントもある。ただし必要なのはGPU上のCloudXR RuntimeとOpenXRアプリを含む構成。Cloudflareのプランを上げるだけで、現在のThree.js画面が自動で高精細になるものではない。

### 少し先の遊び方

- 手で行き先をつまんで置く、手元で翼・エンジンの部品を交換する操作。コントローラーの同じ操作を先に整え、手の追跡が切れても続けられるようにする。
- Gaussian Splattingで会場の見た目を残し、後日PC／VRからその日の展示を眺める案。写真のような見た目の再現と、測量済みの座標・当たり判定・通路データを分ける。最初の地図には不要。
- AIが「今は静かな通過がよさそう」と次便を提案する案。飛行は既存エンジン、提案・予約・停止は共通操作に通し、生成待ちでも手動で遊べるようにする。[AIなしの骨格](creation-and-ai.md#2026-09-16-追加方針-aiなしで成立する骨格)

**追加のユーザー指示で、次は固定机を基準に2台のQuestで位置・視点の一致を検証する。** 3地点の地図と会場への展開はその後にする。QR入室とマーカーの3D姿勢取得を区別し、まず手動での基準合わせを用意して、Shared Spaces等の自動化と比較する。[固定机の検証単位](ar-modes.md#追加の優先指示-固定机を囲む複数questの位置合わせ)。見惚れる機体の品質改善は通常の空でも継続する。

## 採用を決める小さな基準

1. 新しい機能で、どの瞬間が楽しくなるかを一文で決める。
2. 1つの機体・1つの航路で比較する。
3. 起動時のデータ量、CPUの計算時間、GPUの描画、音声数を別々に見る。
4. 良かった違いと負荷を記録し、必要なら元の方式へ戻せる状態で試す。

大きいJavaScriptチャンクは残っている。今回の改善は描画側であり、初回ダウンロードやQuestの実機性能を改善したという扱いにはしない。


## 2026-09-16: Meta VR CLIで実機を計測する

ユーザー提供のDilmerの投稿を起点に公式資料を調査。[適用範囲・Windows準備・Quest 2／3の比較手順](quest-test-tools.md)へ整理した。CLI/MCPは端末のログ・性能・画面記録に使う候補。既存IWERの操作回帰とChrome DevToolsを併用する。端末間の現実の座標を自動で揃える機能とは分け、実機C点の誤差を別に測る。導入・MCP設定変更・実機接続は未実施。
