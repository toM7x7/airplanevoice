import { parseWorkshop, type WorkshopRecipe } from "./workshop";
export interface HangarEntry {
  id: string;
  name: string;
  recipe: WorkshopRecipe;
}
export const HANGAR_LIMIT = 24;
export function checkedEntry(input: unknown): HangarEntry {
  const p = input as HangarEntry;
  if (
    !p ||
    typeof p.id !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(p.id) ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.trim().length > 40
  )
    throw new Error("機体名は1〜40文字で入力してください。");
  return {
    id: p.id,
    name: p.name.trim(),
    recipe: parseWorkshop(JSON.stringify(p.recipe)),
  };
}
