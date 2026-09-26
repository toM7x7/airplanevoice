# AIRPLANEVOICE — Motion Study 02

PCとVRの操作メニューの動きを、フレームごとに描画する比較映像です。

- 6 compositions: PC / VR × lift / trail / ripple
- 1280×720 / 60fps / 540 frames
- 共通の絵: `../apps/desktop/src/ui/MotionArtwork.tsx`
- 共通の動き: `../packages/core/src/menu-motion.ts`
- 音: `public/motion-audio/`（自作の合成音）
- 出力: `../docs/concepts/2026-09-18-motion-v2/`

## 開く

このフォルダーで `npm ci`、`npm run dev -- --no-open`。
表示されたStudioのURLを開く。フレーム0〜539で確認できる。

## 書き出す

リポジトリ直下で `npm run render:motion`。
一案だけなら `node scripts/render-motion-films.mjs VR-trail`。
検査は `npm run test:motion-films`（Windows用の同梱FFmpegを使用）。

背景と手は説明用の図形です。実機撮影・実際のQuestフレームレートの記録ではありません。
Remotionの利用条件は [公式ライセンス](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) を参照。
