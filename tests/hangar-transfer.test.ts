import { it, expect, vi, afterEach } from "vitest";
import { importCreations, exportCreations, HANGAR_KEY } from "../apps/desktop/src/creation-workspace";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
afterEach(()=>vi.unstubAllGlobals());
it("merges a transferred hangar without replacing a colliding aircraft",()=>{
 const data=new Map<string,string>();vi.stubGlobal("window",new EventTarget());vi.stubGlobal("localStorage",{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});
 const entry={id:"saved-aircraft",name:"そら",recipe:DEFAULT_WORKSHOP};data.set(HANGAR_KEY,JSON.stringify([entry]));
 expect(importCreations(JSON.stringify({version:1,aircraft:[entry,{...entry,name:"かなた"}]}))).toBe(2);
 const result=JSON.parse(exportCreations()).aircraft;expect(result[0]).toEqual(entry);expect(result[1].id).not.toBe(entry.id);
 const before=data.get(HANGAR_KEY);expect(()=>importCreations(JSON.stringify({version:1,aircraft:[{name:"invalid"}]}))).toThrow();expect(data.get(HANGAR_KEY)).toBe(before);
});
