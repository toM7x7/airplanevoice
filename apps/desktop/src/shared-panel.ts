import {
  AIRCRAFT_PATTERNS,
  ROUTE_PATTERNS,
  type WorkshopRecipe,
  type aircraftInfo,
} from "../../../packages/core/src";
import type { SharedFlight } from "../../../packages/core/src/shared-room";
import type { RoomClient } from "./room-client";
import type { AircraftAudio } from "./audio";
import type { SharedVrPanel, VrRuntime } from "./vr";
import type { Dispatch, SetStateAction } from "react";

export type SharedPage =
  "main" | "edit" | "points" | "audio" | "view" | "tower";
interface PanelInput {
  page: SharedPage;
  setPage: (page: SharedPage) => void;
  point: "a" | "b";
  setPoint: (point: "a" | "b") => void;
  room: RoomClient["snapshot"];
  recipe: WorkshopRecipe;
  vr: VrRuntime;
  vrState: VrRuntime["snapshot"];
  visitor: boolean;
  exhibition: boolean;
  repeating: boolean;
  next: SharedFlight | undefined;
  active: SharedFlight | undefined;
  enabled: boolean;
  resting: boolean;
  listen: () => Promise<void>;
  rest: () => void;
  launch: () => void;
  clear: () => void;
  update: (r: WorkshopRecipe) => void;
  adjust: (kind: "altitude" | "speed", amount: number) => void;
  movePoint: (axis: "x" | "z", amount: number) => void;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  audio: AircraftAudio;
  client: RoomClient;
  setNote: (note: string) => void;
  note: string;
  status: string;
  flightLabel: string;
  inspection: ReturnType<typeof aircraftInfo>;
  towerLines: string[];
  read: () => void;
  stopSpeech: () => void;
  canRead: boolean;
  speaking: boolean;
  speechMessage: string;
}
/** Presentation only: all effects go through the same actions as PC controls. */
export function sharedPanel({
  page,
  setPage,
  point,
  setPoint,
  room,
  recipe,
  vr,
  vrState,
  visitor,
  exhibition,
  repeating,
  next,
  active,
  enabled,
  resting,
  listen,
  rest,
  launch,
  clear,
  update,
  adjust,
  movePoint,
  volume,
  setVolume,
  audio,
  client,
  setNote,
  note,
  status,
  flightLabel,
  inspection,
  towerLines,
  read,
  stopSpeech,
  canRead,
  speaking,
  speechMessage,
}: PanelInput): SharedVrPanel {
  const buttons: SharedVrPanel["buttons"] = [];
  const add = (label: string, press: () => void, allowed = true) => {
    const n = buttons.length;
    buttons.push({
      label,
      press,
      enabled: allowed,
      x: 30 + (n % 2) * 497,
      y: 157 + Math.floor(n / 2) * 81,
      w: 467,
      h: 69,
    });
  };
  if (page === "tower") {
    add("状況を読み上げる", read, canRead);
    add("案内を止める", stopSpeech, speaking);
    add("空の操作へ", () => setPage("main"));
    add("見え方・操作案内", () => setPage("view"));
    buttons.forEach((b, i) => {
      b.y = 337 + Math.floor(i / 2) * 81;
    });
  } else if (page === "view") {
    add(
      vrState.displayMode === "ar" ? "仮想の空に戻る" : "現実に機体を重ねる",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("操作盤を閉じて眺める", () => vr.hidePanel());
    add("音の設定", () => setPage("audio"));
    add("選択を外す", clear);
    add("再接続", client.reconnect, room.status !== "connected");
    add("空の操作へ", () => setPage("main"));
    add("ブラウザに戻る", () => void vr.exit());
    add("状況・案内", () => setPage("tower"));
  } else if (page === "main" && visitor) {
    add("操作盤を閉じて眺める", () => vr.hidePanel());
    add(resting ? "音を聴く" : "自分の音を休む", () =>
      resting ? void listen() : rest(),
    );
    add("音の設定", () => setPage("audio"));
    add("選択を外す", clear);
    add("見え方・操作案内", () => setPage("view"));
    add("ブラウザに戻る", () => void vr.exit());
  } else if (page === "main") {
    add(
      exhibition
        ? repeating
          ? "繰り返しを止める"
          : "展示の飛行を始める"
        : next
          ? "次の便を取り消す"
          : active
            ? "次の便を予約"
            : "一緒に飛ばす",
      () =>
        exhibition
          ? client.send({ type: "repeat", enabled: !repeating })
          : next
            ? client.send({ type: "cancel-next" })
            : launch(),
      enabled,
    );
    add(resting ? "音を聴く" : "自分の音を休む", () =>
      resting ? void listen() : rest(),
    );
    add("機体・航路を変える", () => setPage("edit"), !!room.state);
    add("2地点を動かす", () => setPage("points"), !!room.state);
    add("音の設定", () => setPage("audio"));
    add("選択を外す", clear);
    add("見え方・操作案内", () => setPage("view"));
    add("ブラウザに戻る", () => void vr.exit());
  } else if (page === "edit") {
    add(
      `機体：${recipe.aircraft.engineCount}発 → 別の機体`,
      () => {
        const index = AIRCRAFT_PATTERNS.findIndex(
          (p) => p.aircraft.bodyLengthM === recipe.aircraft.bodyLengthM,
        );
        update({
          ...recipe,
          aircraft: AIRCRAFT_PATTERNS[(index + 1) % 3].aircraft,
        });
      },
      enabled,
    );
    add(
      "別の航路にする",
      () => {
        const index = ROUTE_PATTERNS.findIndex(
          (p) =>
            p.route.seed === recipe.route.seed &&
            p.route.altitudeM === recipe.route.altitudeM,
        );
        const pattern = ROUTE_PATTERNS[(index + 1) % 4];
        update({ ...recipe, route: pattern.route, flight: pattern.flight });
      },
      enabled,
    );
    add("高度 −20 m", () => adjust("altitude", -20), enabled);
    add("高度 ＋20 m", () => adjust("altitude", 20), enabled);
    add("速度 −5 m/s", () => adjust("speed", -5), enabled);
    add("速度 ＋5 m/s", () => adjust("speed", 5), enabled);
    add("空の操作へ", () => setPage("main"));
    add("2地点を動かす", () => setPage("points"));
  } else if (page === "points") {
    add(`A地点 ${point === "a" ? "選択中" : ""}`, () => setPoint("a"));
    add(`B地点 ${point === "b" ? "選択中" : ""}`, () => setPoint("b"));
    add("西へ 100 m", () => movePoint("x", -100), enabled);
    add("東へ 100 m", () => movePoint("x", 100), enabled);
    add("北へ 100 m", () => movePoint("z", -100), enabled);
    add("南へ 100 m", () => movePoint("z", 100), enabled);
    add("空の操作へ", () => setPage("main"));
    add("機体・航路へ", () => setPage("edit"));
  } else {
    add("音量 −5", () => setVolume((v) => Math.max(0, v - 5)));
    add("音量 ＋5", () => setVolume((v) => Math.min(70, v + 5)));
    add("本体スピーカー向け", () => {
      audio.setOutputProfile("speaker");
      setNote("本体スピーカー向け");
    });
    add("ヘッドホン向け", () => {
      audio.setOutputProfile("headphones");
      setNote("ヘッドホン向け");
    });
    add(resting ? "音を聴く" : "自分の音を休む", () =>
      resting ? void listen() : rest(),
    );
    add("空の操作へ", () => setPage("main"));
  }
  return {
    lines: page === "tower" ? towerLines : undefined,
    title:
      page === "tower"
        ? "管制 / 状況・案内"
        : page === "view"
          ? "見え方・操作案内（自分だけ）"
          : page === "main"
            ? "AIRPLANEVOICE / 共有する空"
            : page === "edit"
              ? "次の機体・航路をつくる"
              : page === "points"
                ? "次の航路 / 2地点を動かす"
                : "自分の音の設定",
    status: room.error || note || `${status} / ${flightLabel}`,
    detail:
      page === "tower"
        ? speechMessage
        : page === "view"
          ? vr.canShowAR
            ? "移動せず眺めよう。切り替えても同じ便が続きます。"
            : "この入場ではARに切り替えられません。"
          : inspection?.visible && page === "main"
            ? `${inspection.id} / ${Math.round(inspection.speedMps! * 3.6)} km/h / ${inspection.headingLabel} ${Math.round(inspection.headingDeg!)}°`
            : page === "points"
              ? `${point.toUpperCase()}：東西 ${recipe.route[point].x} m / 南北 ${recipe.route[point].z} m`
              : `${recipe.aircraft.engineCount}発 / 高度 ${recipe.route.altitudeM} m / 速度 ${recipe.flight.speedMps} m/s / 音量 ${volume}%`,
    buttons,
    hint: "人差し指のトリガー：決定 ／ 側面のグリップ：操作盤を呼ぶ",
  };
}
