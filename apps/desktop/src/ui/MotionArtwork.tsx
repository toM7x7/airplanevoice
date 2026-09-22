import {
  menuMotion,
  type MenuMotionStyle,
} from "../../../../packages/core/src/menu-motion";
import { ICON_PATHS } from "./control-menu";

export const MOTION_COPY = {
  lift: {
    title: "翼がひらく",
    subtitle: "小さく畳まれた操作が、翼のように浮き上がる。",
    color: "#ba784a",
  },
  trail: {
    title: "フライバイ",
    subtitle: "旅客機が横切る。その航跡に、操作が生まれる。",
    color: "#397b85",
  },
  ripple: {
    title: "音の到着",
    subtitle: "先に機影。そのあと届く音の輪が、操作をひらく。",
    color: "#686a9f",
  },
};
const planePath =
  "M-76 0Q-62 -7 -12 -6L-40 -40 -26 -40 12 -7 67 -5Q91 0 67 5L12 7 -26 40 -40 40 -12 6 -62 6 -77 20 -88 20 -82 3 -90 0 -82 -3 -88 -20 -77 -20Z";
export function MotionEffects({
  style,
  progress,
}: {
  style: MenuMotionStyle;
  progress: number;
}) {
  const m = menuMotion(style, progress);
  const color = MOTION_COPY[style].color;
  return (
    <g fill="none" stroke={color} strokeWidth="2" pointerEvents="none">
      {style === "lift" && (
        <g opacity={m.effectOpacity * 0.65}>
          <path
            d={`M300 300 Q${300 - m.sweep * 350} ${290 - m.sweep * 320} 28 84`}
          />
          <path
            d={`M300 300 Q${300 + m.sweep * 350} ${290 - m.sweep * 320} 572 84`}
          />
          <ellipse
            cx="300"
            cy={304 - m.sweep * 80}
            rx={25 + m.sweep * 290}
            ry={8 + m.sweep * 18}
          />
        </g>
      )}
      {style === "trail" && (
        <g opacity={m.effectOpacity}>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M${-70 + m.sweep * 400} ${100 + i * 8} Q260 ${-30 + i * 10} ${-60 + m.sweep * 770} ${70 - m.sweep * 70 + i * 5}`}
              strokeWidth={3 - i * 0.7}
              opacity={1 - i * 0.25}
            />
          ))}
          <path
            d={planePath}
            transform={`translate(${-60 + m.sweep * 770} ${70 - m.sweep * 70}) scale(.48) rotate(-6)`}
            fill={color}
            stroke="none"
          />
        </g>
      )}
      {style === "ripple" &&
        m.rings.map((ring, i) => (
          <ellipse
            key={i}
            cx="300"
            cy="235"
            rx={20 + ring.radius * 355}
            ry={12 + ring.radius * 225}
            opacity={ring.opacity * 0.8}
            strokeWidth={3 - i * 0.6}
          />
        ))}
    </g>
  );
}
/** Same poses as DOM/spatial controls. Pure SVG makes every film frame deterministic. */
export function MenuArtwork({
  style,
  progress,
}: {
  style: MenuMotionStyle;
  progress: number;
}) {
  const m = menuMotion(style, progress);
  const b = m.board;
  return (
    <g>
      <g
        transform={`translate(${b.x * 600} ${b.y * 320}) translate(300 160) scale(${b.scale}) translate(-300 -160)`}
        opacity={b.opacity}
      >
        <rect
          width="600"
          height="320"
          rx="26"
          fill="#f9f6ec"
          stroke="#ffffff"
          strokeWidth="2"
        />
      </g>
      <g opacity={m.headerOpacity} fill="#214c50">
        <text x="26" y="30" fontSize="10" letterSpacing="3">
          AIRPLANEVOICE / SKY CONTROLS
        </text>
        <text x="26" y="67" fontSize="25" fontWeight="600">
          空のメニュー
        </text>
        <text x="565" y="49" fontSize="27">
          ×
        </text>
      </g>
      {[
        ["飛ばして眺める", "旅客機を、空へ。", "plane"],
        ["聴き方", "響きの大きさを変える", "sound"],
        ["見え方", "VR・ARを切り替える", "eye"],
        ["操作案内", "手・指でできること", "help"],
      ].map(([title, detail, icon], i) => {
        const c = m.cards[i];
        const x = 22 + (i % 2) * 284;
        const y = 87 + Math.floor(i / 2) * 103;
        return (
          <g
            key={title}
            opacity={c.opacity}
            transform={`translate(${x + 136 + c.x * 600} ${y + 46 + c.y * 320}) rotate(${c.rotation}) scale(${c.scale}) translate(-136 -46)`}
          >
            <rect
              width="272"
              height="92"
              rx="16"
              fill="#e3ece6"
              stroke="#bacfc6"
            />
            <path
              d={ICON_PATHS[icon as keyof typeof ICON_PATHS]}
              transform="translate(16 18)"
              fill="none"
              stroke="#345e60"
              strokeWidth="1.6"
            />
            <text x="52" y="36" fontSize="19" fill="#173f45" fontWeight="600">
              {title}
            </text>
            <text x="18" y="70" fontSize="14" fill="#526e65">
              {detail}
            </text>
          </g>
        );
      })}
      <MotionEffects style={style} progress={progress} />
      <g transform="translate(100 339)">
        <rect width="400" height="58" rx="29" fill="#f9f6ec" stroke="#c3d4cb" />
        <path
          d="M27 21h20M27 29h20M27 37h20"
          stroke="#345e60"
          strokeWidth="2"
        />
        <text x="62" y="36" fontSize="16" fill="#214c50">
          {progress > 0 ? "閉じる" : "メニュー"}
        </text>
        <text x="188" y="36" fontSize="16" fill="#214c50">
          音を聴く
        </text>
        <text x="305" y="36" fontSize="16" fill="#647e78">
          選択解除
        </text>
      </g>
    </g>
  );
}
export function MotionStage({
  style,
  progress,
  seconds,
  spatial = false,
}: {
  style: MenuMotionStyle;
  progress: number;
  seconds: number;
  spatial?: boolean;
}) {
  const copy = MOTION_COPY[style];
  const phaseLabel =
    seconds < 0.75
      ? "バーに触れる"
      : seconds < 2.4
        ? "ひらく"
        : seconds < 4.6
          ? "選ぶ・眺める"
          : seconds < 5.9
            ? "空に戻す"
            : "もう一度ひらく";
  const touch = [0.75, 4.6, 5.9].reduce(
    (m, t) => Math.max(m, Math.max(0, 1 - Math.abs(seconds - t) / 0.6)),
    0,
  );
  return (
    <svg
      viewBox="0 0 1280 720"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        fontFamily: '"Yu Gothic", "Meiryo", sans-serif',
      }}
      role="img"
      aria-label={`${spatial ? "VR" : "PC"} ${copy.title} 動作模型`}
    >
      <defs>
        <linearGradient id="review-sky" x2="0" y2="1">
          <stop stopColor="#91c5d4" />
          <stop offset=".65" stopColor="#e6e7ce" />
          <stop offset="1" stopColor="#eed7ad" />
        </linearGradient>
        <linearGradient id="review-plane">
          <stop stopColor="#e8f4ee" />
          <stop offset=".5" stopColor="#fffdf3" />
          <stop offset="1" stopColor="#b1c4c6" />
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#review-sky)" />
      <circle cx="1080" cy="156" r="80" fill="#fff4ca" opacity=".6" />
      <path
        d="M0 477 Q180 396 320 472T680 458T1000 445T1380 450V720H0Z"
        fill="#92ada2"
        opacity=".4"
      />
      <path
        d="M0 558Q220 482 480 557T880 551T1280 525V720H0Z"
        fill="#657f79"
        opacity=".23"
      />
      <g opacity=".5" fill="none" stroke="#fffaf0">
        <path d={`M${130 + seconds * 20} 230Q460 85 980 270`} strokeWidth="2" />
        <path d="M220 236Q470 110 940 280" strokeWidth=".8" />
      </g>
      <g
        transform={`translate(${830 + Math.sin(seconds * 0.3) * 80} ${225 - Math.sin(seconds * 0.3) * 20}) rotate(-12) scale(1.2 .8)`}
      >
        <path
          d={planePath}
          fill="url(#review-plane)"
          stroke="#849c9b"
          strokeWidth="1"
        />
        <path
          d="M-20 -10h16v-9h-16M-20 10h16v9h-16M-33 -23h13v-8h-13M-33 23h13v8h-13"
          fill="#698b8f"
        />
        <path
          d="M-60 -1h113"
          stroke="#8ca4a9"
          strokeWidth="2"
          strokeDasharray="2 5"
        />
      </g>
      <g fill="#214c50">
        <text x="46" y="44" fontSize="13" letterSpacing="3">
          AIRPLANEVOICE / MOTION STUDY 02
        </text>
        <text x="46" y="95" fontSize="36" fontWeight="600">
          {copy.title}
        </text>
        <text x="48" y="126" fontSize="16">
          {copy.subtitle}
        </text>
        <text x="1232" y="44" textAnchor="end" fontSize="14">
          {spatial ? "VR · 空間UIの動作模型" : "PC · 動きの比較"}
        </text>
      </g>
      {spatial && (
        <g stroke="#eef7e6" fill="none" opacity=".45">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M640 413L${-300 + i * 240} 720`} />
          ))}
          {[470, 530, 610, 705].map((y) => (
            <path key={y} d={`M0 ${y}H1280`} />
          ))}
          <ellipse cx="640" cy="655" rx="400" ry="35" />
        </g>
      )}
      <g
        transform={
          spatial
            ? "translate(350 239) skewY(-3) scale(.91)"
            : "translate(360 233) scale(.91)"
        }
      >
        {spatial && (
          <path
            d="M-12 -12H614V407H-12Z"
            fill="#315f69"
            opacity=".12"
            transform="translate(14 17)"
          />
        )}
        <MenuArtwork style={style} progress={progress} />
      </g>
      {spatial && (
        <g>
          <g transform={`translate(${-260 - touch * 96} ${35 - touch * 52})`}>
            <path
              d="M1050 748Q1010 660 942 625L873 553Q859 539 850 550Q843 559 857 578L882 614 830 587Q808 578 806 593Q806 607 830 620L881 652 864 681Q867 704 900 735"
              fill="#efc9a1"
              stroke="#b38367"
              strokeWidth="2"
            />
          </g>
          <circle
            cx="503"
            cy="540"
            r={8 + 12 * (1 - touch)}
            fill="none"
            stroke="#bc7e43"
            strokeWidth="2"
            opacity={touch}
          />
          <text x="962" y="570" fontSize="16" fill="#214c50">
            指先でバーに触れる
          </text>
          <path d="M315 248V603M310 248h10M310 603h10" stroke="#547974" />
          <text x="292" y="431" textAnchor="end" fontSize="13" fill="#214c50">
            手が届く距離
          </text>
          <text x="1232" y="691" textAnchor="end" fontSize="12" fill="#315b5c">
            実機撮影ではありません · 視点固定 / 操作盤だけが動く
          </text>
        </g>
      )}
      <g transform="translate(46 647)" fill="#214c50">
        <text fontSize="12" letterSpacing="2">
          {spatial ? "HAND INTERACTION" : "OPEN → REST → CLOSE"}
        </text>
        <text y="32" fontSize="23">
          {phaseLabel}
        </text>
        <rect x="0" y="43" width="170" height="2" fill="#faf5e5" />
        <rect
          x="0"
          y="43"
          width={170 * Math.min(1, seconds / 9)}
          height="2"
          fill={copy.color}
        />
      </g>
    </svg>
  );
}
