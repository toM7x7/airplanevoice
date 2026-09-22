import { expect, it, vi } from "vitest";
import { newRoom } from "../../packages/core/src/shared-room";
vi.mock("cloudflare:workers",()=>({DurableObject:class {constructor(public ctx:unknown, public env:unknown){}}}));
const {SkyRoom}=await import("../room-worker");
it("broadcasts departure without echoing the reserved 1005 close code",()=>{
  const state=newRoom(Date.now());
  const attachment={id:"remaining",role:"editor",slot:1,presence:null,updatedAt:Date.now()};
  const closed={close:vi.fn(()=>{throw new Error("Invalid WebSocket close code: 1005");}),deserializeAttachment:()=>({...attachment,id:"left"})};
  const peer={send:vi.fn(),deserializeAttachment:()=>attachment};
  const ctx={storage:{sql:{exec:()=>({toArray:()=>[{state:JSON.stringify(state)}]})}},getWebSockets:()=>[closed,peer]};
  const room=new SkyRoom(ctx as never,{} as never);
  expect(()=>Reflect.apply(room.webSocketClose,room,[closed,1005,""])).not.toThrow();
  expect(closed.close).not.toHaveBeenCalled();
  const message=JSON.parse(peer.send.mock.calls[0][0]);
  expect(message.peers).toBe(1);expect(message.participants.map((p:{id:string})=>p.id)).toEqual(["remaining"]);
});
