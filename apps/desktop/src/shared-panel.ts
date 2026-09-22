import { overheadRecipe } from "../../../packages/core/src/overhead";
import type { VoiceControls } from "./ai/AiTrialPanel";
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
import type { VenueMap } from "../../../packages/core/src/venue";
import { tableDepth } from "../../../packages/core/src/spatial-alignment";
import {
  alignedParticipants,
  participantStatus,
} from "../../../packages/core/src/room-presence";

export type SharedPage =
  | "flight-control"
  | "listening"
  | "fleet"
  | "connection"
  | "main"
  | "voice"
  | "hangar"
  | "edit"
  | "points"
  | "audio"
  | "sound-detail"
  | "view"
  | "tower"
  | "spatial"
  | "placement"
  | "placement-height"
  | "measurement"
  | "sync"
  | "venue"
  | "venue-view";
interface PanelInput {
  openCreation?: () => void;
  openShelf?: () => void;
  voiceControls?: VoiceControls | null;
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
  venue: VenueMap;
  saveVenue: (venue: VenueMap) => void;
}
/** Presentation only: all effects go through the same actions as PC controls. */
export function sharedPanel({
  openCreation,
  openShelf,
  voiceControls,
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
  venue,
  saveVenue,
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
  const aligned =
    room.status === "connected"
      ? alignedParticipants(room.participants, venue, client.now()).length
      : 0;
  if (page === "voice") {
    if (!voiceControls?.prepared)
      add(
        "AIを準備する",
        () => voiceControls?.prepare?.(),
        !!voiceControls?.authorized,
      );
    add(
      voiceControls?.active ? "会話を終える" : "会話を始める",
      () =>
        voiceControls?.active ? voiceControls.stop() : voiceControls?.start(),
      !!voiceControls && (voiceControls.active || voiceControls.ready),
    );
    add(
      voiceControls?.muted ? "マイクを戻す" : "マイクをミュート",
      () => voiceControls?.toggleMute(),
      !!voiceControls?.active,
    );
    if (openCreation)
      add(
        vrState.displayMode === "ar" ? "手元に模型を出す" : "一機をつくる",
        openCreation,
      );
    add("空のメニューに戻る", () => setPage("main"));
    add(
      voiceControls?.observing ? "Jevの観察を止める" : "Jevの観察を始める",
      () => voiceControls?.toggleObservation?.(),
      !!voiceControls?.observerReady,
    );
    return {
      title: "AI案内 · 会話と観察",
      status: voiceControls?.message ?? "AIの接続状態を確認しています。",
      detail:
        voiceControls?.observationNote ||
        `Jev: ${voiceControls?.observing ? "観察中" : "停止中"} / 保存と飛行は自分で決めます。`,
      buttons,
    };
  } else if (page === "sync") {
    add("机の位置合わせへ", () => setPage("spatial"));
    add("基準点を見て比べる", () => {
      if (!vrState.showCalibration) vr.toggleCalibrationMarkers();
      vr.hidePanel();
    });
    add("自分の位置合わせを解除", () => vr.clearAlignment());
    add(room.status === "connected" ? "空の操作へ" : "再接続", () =>
      room.status === "connected" ? setPage("main") : client.reconnect(),
    );
    buttons.forEach((b, i) => {
      b.y = 337 + Math.floor(i / 2) * 81;
    });
  } else if (page === "placement" || page === "placement-height") {
    const hasPlacement = ["placing", "placed"].includes(vrState.calibration);
    if (page === "placement") {
      add("← 左へ 5 cm", () => vr.adjustTable(-0.05), hasPlacement);
      add("右へ 5 cm →", () => vr.adjustTable(0.05), hasPlacement);
      add("手前へ 5 cm", () => vr.adjustTable(0, 0, 0.05), hasPlacement);
      add("奥へ 5 cm", () => vr.adjustTable(0, 0, -0.05), hasPlacement);
      add(
        "左回り 5°",
        () => vr.adjustTable(0, 0, 0, Math.PI / 36),
        hasPlacement,
      );
      add(
        "右回り 5°",
        () => vr.adjustTable(0, 0, 0, -Math.PI / 36),
        hasPlacement,
      );
      add("高さの調整・配置の確定", () => setPage("placement-height"));
      add("机と会場に戻る", () => setPage("spatial"));
    } else {
      add("↑ 高く 2 cm", () => vr.adjustTable(0, 0.02), hasPlacement);
      add("↓ 低く 2 cm", () => vr.adjustTable(0, -0.02), hasPlacement);
      add(
        "この位置で使う（目視）",
        () => vr.confirmTablePlacement(),
        vrState.calibration === "placing",
      );
      add("もう一度、目の前へ", () => vr.bringTableHere(), vr.canShowAR);
      add("前後・左右・向きを調整", () => setPage("placement"));
      add("基準点を隠す／見る", () => vr.toggleCalibrationMarkers());
      add("机と会場に戻る", () => setPage("spatial"));
      add("メニューを閉じて確認", () => vr.hidePanel());
    }
  } else if (page === "spatial") {
    add(
      "机の枠を目の前へ",
      () => {
        vr.bringTableHere();
        setPage("placement");
      },
      vr.canShowAR,
    );
    add(
      "配置の調整を続ける",
      () => setPage("placement"),
      ["placing", "placed"].includes(vrState.calibration),
    );
    add("A・B・Cで測る（詳細）", () => setPage("measurement"));
    add("PC・Questの接続状況", () => setPage("sync"));
    add("会場の地点へ", () => setPage("venue"));
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "現実に重ねる",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("見え方・操作案内", () => setPage("view"));
    add("メニューを閉じる", () => vr.hidePanel());
  } else if (page === "measurement") {
    add(
      vrState.inputMode === "hands"
        ? "測定にはコントローラーを使用"
        : "机の位置合わせを始める",
      () => vr.beginAlignment(),
      vr.canShowAR && vrState.inputMode !== "hands",
    );
    add(
      "重なりを確認",
      () => vr.confirmAlignment(),
      vrState.calibration === "checking" &&
        !!vrState.alignmentCheck?.acceptable,
    );
    add(vrState.showCalibration ? "基準点を隠す" : "基準点を見る", () =>
      vr.toggleCalibrationMarkers(),
    );
    add("机と会場に戻る", () => setPage("spatial"));
    add("会場の地点へ", () => setPage("venue"));
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "現実に重ねる",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("見え方・操作案内", () => setPage("view"));
    add("操作盤を閉じる", () => vr.hidePanel());
  } else if (page === "venue") {
    for (const p of venue.points.slice(0, 4))
      add(
        `${venue.selectedId === p.id ? "● " : ""}${p.name}`,
        () => saveVenue({ ...venue, selectedId: p.id }),
        enabled,
      );
    add("地図の見え方", () => setPage("venue-view"));
    add(
      "地点の選択を外す",
      () => saveVenue({ ...venue, selectedId: null }),
      enabled,
    );
    add("机の位置合わせへ", () => setPage("spatial"));
    add("空の操作へ", () => setPage("main"));
  } else if (page === "venue-view") {
    add("小さな地図で見る", () => vr.showVenue("overview"));
    add("実寸の地点を見る", () => vr.showVenue("space"));
    add("地図を隠す", () => vr.hideVenue(), vrState.showVenue);
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "現実に重ねる",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("地点を選ぶ", () => setPage("venue"));
    add("机の位置合わせへ", () => setPage("spatial"));
    add("空の操作へ", () => setPage("main"));
    add("操作盤を閉じる", () => vr.hidePanel());
  } else if (page === "tower") {
    add("状況を読み上げる", read, canRead);
    add("案内を止める", stopSpeech, speaking);
    add("空の操作へ", () => setPage("main"));
    add("見え方・操作案内", () => setPage("view"));
    buttons.forEach((b, i) => {
      b.y = 337 + Math.floor(i / 2) * 81;
    });
  } else if (page === "view") {
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "ARに切り替える",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("操作盤を閉じて眺める", () => vr.hidePanel());
    add(visitor ? "音の設定" : "運営の飛行設定", () =>
      setPage(visitor ? "audio" : "hangar"),
    );
    add("選択を外す", clear);
    add(room.status === "connected" ? "机と会場" : "再接続", () =>
      room.status === "connected" ? setPage("spatial") : client.reconnect(),
    );
    add("空の操作へ", () => setPage("main"));
    add("ブラウザに戻る", () => void vr.exit());
    add("状況・案内", () => setPage("tower"));
  } else if (page === "main" && visitor) {
    if (openCreation)
      add(
        vrState.displayMode === "ar" ? "手元に模型を出す" : "一機をつくる",
        openCreation,
      );
    if (openShelf) add("保存した機体", openShelf);
    add("操作盤を閉じて眺める", () => vr.hidePanel());
    add(resting ? "音を聴く" : "この端末の音を止める", () =>
      resting ? void listen() : rest(),
    );
    add("音の設定", () => setPage("audio"));
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "ARに切り替える",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
    add("見え方・操作案内", () => setPage("view"));
    add("AIと話す", () => setPage("voice"));
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
      enabled || !client.id,
    );
    add(resting ? "音を聴く" : "この端末の音を止める", () =>
      resting ? void listen() : rest(),
    );
    add(
      vrState.displayMode === "ar" ? "手元に模型を出す" : "一機をつくる",
      openCreation ?? (() => setPage("edit")),
    );
    add("保存した機体", openShelf ?? (() => setPage("hangar")));
    add("音の設定", () => setPage("audio"));
    add("AIと話す", () => setPage("voice"));
    add("見え方・操作案内", () => setPage("view"));
    add(
      vrState.displayMode === "ar" ? "VRに戻る" : "ARに切り替える",
      () => vr.toggleEnvironment(),
      vr.canShowAR,
    );
  } else if (page === "hangar") {
    add("機体・航路の詳細設定", () => setPage("edit"));
    add(
      "格納庫のみんなを飛ばす",
      () => {
        void listen();
        client.send({ type: "launch-hangar" });
      },
      enabled && !next && !!room.state?.hangar?.length,
    );
    add(
      "頭上を通る一機を準備",
      () => {
        try {
          update(overheadRecipe({ x: 0, y: 1.7, z: 0 }, recipe));
          setNote("原点の約220m上を通る航路です。準備後に一機を飛ばせます。");
        } catch (e) {
          setNote(e instanceof Error ? e.message : String(e));
        }
      },
      enabled,
    );
    add("準備した一機を飛ばす", launch, enabled && !next);
    add(
      repeating ? "自動飛行を止める" : "自動飛行を続ける",
      () => client.send({ type: "repeat", enabled: !repeating }),
      enabled && exhibition,
    );
    add("音の設定", () => setPage("audio"));
    add("空の操作へ", () => setPage("main"));
    add("メニューを閉じて眺める", () => vr.hidePanel());
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
    add(audio.ambienceOn ? "風の環境音を切る" : "風の環境音を入れる", () => {
      audio.setAmbience(!audio.ambienceOn);
      void listen();
      setNote(audio.ambienceOn ? "薄い風の環境音：オン" : "環境音：オフ");
    });
    add(audio.interfaceSoundOn ? "操作音を切る" : "操作音を入れる", () => {
      audio.interfaceSoundOn = !audio.interfaceSoundOn;
      setNote(audio.interfaceSoundOn ? "操作音：オン" : "操作音：オフ");
    });
    add(resting ? "音を聴く" : "この端末の音を止める", () =>
      resting ? void listen() : rest(),
    );
    add("空の操作へ", () => setPage("main"));
  }
  return {
    lines:
      page === "sync"
        ? room.participants.map(
            (p) =>
              `端末${p.slot}${p.id === room.selfId ? "（自分）" : ""} / ${room.status === "connected" ? participantStatus(p, venue, client.now()) : "接続待ち"}`,
          )
        : page === "tower"
          ? towerLines
          : undefined,
    title:
      page === "hangar"
        ? "格納庫 / みんなの空"
        : page === "sync"
          ? "PC・Questの接続状況"
          : page === "placement"
            ? "机を合わせる / 位置と向き"
            : page === "placement-height"
              ? "机を合わせる / 高さと確認"
              : page === "measurement"
                ? "詳細な位置合わせ / A・B・C測定"
                : page === "spatial"
                  ? "机の位置合わせ（この端末）"
                  : page === "venue-view"
                    ? "会場の見え方（自分だけ）"
                    : page === "venue"
                      ? "会場の地点 / 共有マップ"
                      : page === "tower"
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
    status:
      page === "sync"
        ? `${room.status === "connected" ? `${room.peers}台で接続中` : "接続待ち"} / 展示はPC＋Quest 3`
        : ["spatial", "placement", "placement-height", "measurement"].includes(
              page,
            )
          ? vrState.calibrationMessage
          : page === "venue-view"
            ? `地図：${!vrState.showVenue ? "非表示" : vrState.venueView === "overview" ? "縮小した配置図" : "実寸の地点"} / 背景：${vrState.displayMode.toUpperCase()}`
            : room.error || note || `${status} / ${flightLabel}`,
    detail:
      page === "hangar"
        ? `${room.state?.hangar?.length ?? 0}機を登録。同時飛行は${room.state?.traffic?.capacity ?? 3}機まで。`
        : page === "sync"
          ? `PCで運営、Questで体験。追加測定を確認済み：${aligned}台。`
          : [
                "spatial",
                "placement",
                "placement-height",
                "measurement",
              ].includes(page)
            ? `横幅 ${Math.round(venue.baselineM * 100)} cm / 奥行き ${Math.round(tableDepth(venue) * 100)} cm / 配置はこのQuestだけ`
            : page === "venue-view"
              ? "音は今いる場所のまま。実寸ARは机の位置合わせ後に確認。"
              : page === "venue"
                ? "地点を選ぶと全員に反映。ブース間の飛行は準備中です。"
                : page === "tower"
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
    hint:
      vrState.inputMode === "hands"
        ? "指で触れて離す ／ 指してつまむ ／ 下のバーでメニュー"
        : "トリガー：決定 ／ グリップ：メニューを呼ぶ",
  };
}
