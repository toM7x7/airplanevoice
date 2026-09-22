import { useEffect, useRef, useState } from "react";
import {
  reviewProgress,
  type MenuMotionStyle,
} from "../../../packages/core/src/menu-motion";
import { MOTION_COPY, MotionStage } from "./ui/MotionArtwork";
import "./ui/motion-lab.css";

export function MotionLab() {
  const [style, setStyle] = useState<MenuMotionStyle>("trail");
  const [spatial, setSpatial] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const audio = useRef<HTMLAudioElement>(null);
  const clock = useRef(0);
  const time = useRef(0);
  const seek = (n: number) => {
    time.current = n;
    setSeconds(n);
    if (audio.current) audio.current.currentTime = n;
  };
  const pause = () => {
    setPlaying(false);
    audio.current?.pause();
  };
  const play = (sound: boolean) => {
    seek(0);
    clock.current = performance.now();
    setPlaying(true);
    if (audio.current) {
      audio.current.pause();
      audio.current.muted = !sound;
      if (sound)
        void audio.current.play().catch(() => {
          setPlaying(false);
        });
    }
  };
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(9, (now - clock.current) / 1000);
      time.current = next;
      setSeconds(next);
      if (next >= 9) {
        setPlaying(false);
        audio.current?.pause();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const hidden = () => {
      if (document.hidden) {
        setPlaying(false);
        audio.current?.pause();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [playing]);
  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        mode: "motion-review",
        style,
        spatial,
        seconds,
        reduced,
        playing,
      });
  }, [style, spatial, seconds, reduced, playing]);
  const p = reviewProgress(seconds);
  return (
    <main className="av-motion-theatre">
      <header>
        <a href="?ui=components">実際の空で操作する ↗</a>
        <span>動きの比較 / 第2稿</span>
        <a href="?">ホーム</a>
      </header>
      <div className="av-theatre-screen">
        <MotionStage
          style={style}
          spatial={spatial}
          progress={reduced ? (p > 0 ? 1 : 0) : p}
          seconds={seconds}
        />
      </div>
      <section className="av-theatre-controls" aria-label="比較する動き">
        <div className="av-theatre-options">
          {(Object.keys(MOTION_COPY) as MenuMotionStyle[]).map((s) => (
            <button
              key={s}
              aria-pressed={style === s}
              onClick={() => {
                pause();
                setStyle(s);
                seek(0);
              }}
            >
              {MOTION_COPY[s].title}
            </button>
          ))}
        </div>
        <div className="av-theatre-options">
          <button aria-pressed={!spatial} onClick={() => setSpatial(false)}>
            PC
          </button>
          <button aria-pressed={spatial} onClick={() => setSpatial(true)}>
            VRの見え方
          </button>
        </div>
        <div className="av-theatre-play">
          <button onClick={() => (playing ? pause() : play(false))}>
            {playing ? "一時停止" : "▶ 最初から再生"}
          </button>
          <button onClick={() => play(true)}>♪ 音付きで再生</button>
          <label>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => setReduced(e.target.checked)}
            />
            動きを減らす
          </label>
        </div>
        <label className="av-theatre-seek">
          コマ送り{" "}
          <input
            aria-label="再生位置"
            type="range"
            min="0"
            max="540"
            step="1"
            value={Math.round(seconds * 60)}
            onChange={(e) => {
              pause();
              seek(Number(e.target.value) / 60);
            }}
          />
          <output>{seconds.toFixed(2)}秒</output>
        </label>
        <p>
          旅客機の通過・翼の浮き上がり・遅れて届く音。形と時間の違いを比較する模型です。VRは実機映像ではありません。
        </p>
        <p>
          音付き再生は低い風音の試作です。実機エンジンの録音や音声AIは使っていません。
        </p>
      </section>
      <audio ref={audio} src={`./motion-audio/${style}.wav`} preload="none" />
    </main>
  );
}
