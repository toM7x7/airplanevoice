import { AIRCRAFT_PATTERNS } from "./show";
import { checkedEntry, type HangarEntry } from "./hangar";
import { overheadRecipe } from "./overhead";
import {validateAircraft} from "./workshop";

export const CREATION_STEPS = [
  "形を選ぶ",
  "音を選ぶ",
  "名前を付ける",
  "空へ送り出す",
] as const;
export const AIRCRAFT_COLORS = [
  { name: "青緑", color: "#205963" },
  { name: "金色", color: "#b9863b" },
  { name: "赤", color: "#a54840" },
  { name: "紺", color: "#263c70" },
  { name: "紫", color: "#735b99" },
  { name: "緑", color: "#44785b" },
] as const;
export const SOUND_CHOICES = [
  { name: "重く、深い響き", sound: { body: 1, fan: 0.15, air: 0.08 } },
  {
    name: "深い響き・ファン少し強め",
    sound: { body: 1, fan: 0.25, air: 0.08 },
  },
  { name: "深い響き・気流少し強め", sound: { body: 1, fan: 0.15, air: 0.14 } },
] as const;
export interface CreationState {
  entry: HangarEntry;
  step: number;
  open: boolean;
  lastAction: string;
  dirty: boolean;
}
export function newCreation(id: string): CreationState {
  return {
    entry: {
      id,
      name: "私の旅客機",
      recipe: overheadRecipe({ x: 0, y: 1.7, z: 0 }),
    },
    step: 0,
    open: false,
    lastAction: "",
    dirty: true,
  };
}
export function isCreationAction(value: string) {
  if(value.startsWith("design:")) {
    try { if(value.length>1800) return false;validateAircraft(JSON.parse(value.slice(7)));return true; } catch {return false;}
  }
  return (
    /^(open|restart|close|next|back|undo|save|share|fly|listen|compare|shape:[0-5]|tone:[012]|color:[0-5]|engines:[24])$/.test(
      value,
    ) ||
    /^(paint|accent):#[0-9a-fA-F]{6}$/.test(value) ||
    (()=>{const match=/^(width|sweep|engineSize|winglet):(\d+(?:\.\d{1,2})?)$/.exec(value); if(!match) return false;const limits:Record<string,number[]>={width:[4.5,8],sweep:[20,38],engineSize:[.8,1.3],winglet:[0,3]};const n=Number(match[2]),[min,max]=limits[match[1]];return n>=min&&n<=max;})() ||
    (/^(body|wings):\d+(\.\d)?$/.test(value) &&
      Number(value.split(":")[1]) >= (value.startsWith("body:") ? 50 : 45) &&
      Number(value.split(":")[1]) <= 85) ||
    (value.startsWith("name:") &&
      value.slice(5).trim().length > 0 &&
      value.slice(5).trim().length <= 40)
  );
}
/** Same commands for buttons, hand interaction and assistant tools. Effects are applied by the host. */
export function changeCreation(
  state: CreationState,
  value: string,
): CreationState {
  if (!isCreationAction(value))
    throw new Error("制作の操作を確認してください。");
  const next = structuredClone(state);
  if (value === "open") next.open = true;
  else if(value.startsWith("design:")) {next.entry.recipe.aircraft=JSON.parse(value.slice(7));next.dirty=true;next.open=true;next.step=0;}
  else if (value === "restart") {
    next.open = true;
    next.step = 0;
  } else if (value === "close") next.open = false;
  else if (value === "next") next.step = Math.min(3, next.step + 1);
  else if (value === "back") next.step = Math.max(0, next.step - 1);
  else if (value.startsWith("shape:")) {
    next.entry.recipe.aircraft = {
      ...AIRCRAFT_PATTERNS[+value.slice(-1)].aircraft,
      sound: next.entry.recipe.aircraft.sound,
      ...(next.entry.recipe.aircraft.bodyColor?{bodyColor:next.entry.recipe.aircraft.bodyColor}:{}),
      ...(next.entry.recipe.aircraft.color
        ? { color: next.entry.recipe.aircraft.color }
        : {}),
    };
    if (!next.entry.recipe.aircraft.sound)
      delete next.entry.recipe.aircraft.sound;
    next.dirty = true;
  } else if (value.startsWith("body:") || value.startsWith("wings:")) {
    next.entry.recipe.aircraft[
      value.startsWith("body:") ? "bodyLengthM" : "wingSpanM"
    ] = Number(value.split(":")[1]);
    next.dirty = true;
  } else if (/^(width|sweep|engineSize|winglet|engines|paint|accent):/.test(value)) {
    const [key,raw]=value.split(":");
    const fields={width:"bodyWidthM",sweep:"wingSweepDeg",engineSize:"engineScale",winglet:"wingletHeightM",engines:"engineCount",paint:"bodyColor",accent:"color"} as const;
    Object.assign(next.entry.recipe.aircraft,{[fields[key as keyof typeof fields]]:key==="paint"||key==="accent"?raw:Number(raw)});
    next.dirty=true;
  } else if (value.startsWith("tone:")) {
    next.entry.recipe.aircraft.sound = {
      ...SOUND_CHOICES[+value.slice(-1)].sound,
    };
    next.dirty = true;
  } else if (value.startsWith("color:")) {
    next.entry.recipe.aircraft.color = AIRCRAFT_COLORS[+value.slice(-1)].color;
    next.dirty = true;
  } else if (value.startsWith("name:")) {
    next.entry.name = value.slice(5).trim();
    next.dirty = true;
  }
  checkedEntry(next.entry);
  next.lastAction = value;
  return next;
}
