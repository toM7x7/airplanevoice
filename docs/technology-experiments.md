# 3D表現と仕組みの実験候補

初回調査: 2026-09-15 / XRのHTML UI候補を2026-09-16に追記。人気順位ではなく、この体験に使えそうな公式機能を整理する。

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

## 採用を決める小さな基準

1. 新しい機能で、どの瞬間が楽しくなるかを一文で決める。
2. 1つの機体・1つの航路で比較する。
3. 起動時のデータ量、CPUの計算時間、GPUの描画、音声数を別々に見る。
4. 良かった違いと負荷を記録し、必要なら元の方式へ戻せる状態で試す。

大きいJavaScriptチャンクは残っている。今回の改善は描画側であり、初回ダウンロードやQuestの実機性能を改善したという扱いにはしない。
