import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out='output/radar-2026-09-23/queue';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
try{
 await p.route('**/api/ai/**',r=>r.fulfill({status:403,json:{error:'test: AI disabled'}}));
 await p.goto('http://127.0.0.1:5173/');
 const root=`/@fs/${path.resolve('packages/core/src').replaceAll('\\','/')}`;
 const entry=await p.evaluate(async root=>(await import(root+'/creation.ts')).newCreation('queue-browser-entry').entry,root);
 await p.goto('http://127.0.0.1:8787/?shared=1');
 await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).room.status==='connected');
 await p.getByRole('button',{name:'部屋・運営',exact:true}).click();
 await p.getByRole('button',{name:'自動便だけ止める',exact:true}).click();
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state.traffic.automaticIds?.length===0);
 await p.getByLabel('同時に飛ばす機体数').selectOption('24');
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state.traffic.capacity===24&&!JSON.parse(window.render_game_to_text()).room.pending);
 const result=await p.evaluate(async entry=>{
  const ws=new WebSocket('ws://127.0.0.1:8787/api/exhibition/connect',['airplanevoice-room-v1']);let state,receive;ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.state)state=msg.state;receive?.(msg);};
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("test socket handshake timeout")),5000);ws.onerror=()=>{clearTimeout(t);reject(new Error("socket failed"));};receive=m=>{if(m.state){clearTimeout(t);resolve();}};});
  const ids=[];
  for(let i=0;i<5;i++){
   const id=crypto.randomUUID();ids.push(id);
   await new Promise((resolve,reject)=>{receive=m=>{if(m.type==='error')reject(new Error(m.error));else if(m.state?.recentOperations.includes(id))resolve();};ws.send(JSON.stringify({type:'create-flight',id,revision:state.revision,entry:{...entry,name:'予約テストの旅客機'}}));});
  }
  ws.close();return state.flights.filter(f=>ids.includes(f.id)).map(f=>({id:f.id,at:f.startsAt,name:f.names[0],automatic:f.automatic}));
 },entry);
 assert.equal(result.length,5);for(let i=1;i<5;i++)assert(result[i].at-result[i-1].at>=15000);assert(result.every(f=>!f.automatic));
 await p.getByText(/参加者の出発待ち（/).click();
 await p.getByLabel('運用コメント').fill('');
 await p.getByLabel('運用コメント').fill('音の余韻を聴ける空にしたい');
 await p.getByRole('button',{name:'コメントを反映'}).click();
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state.traffic.note==='音の余韻を聴ける空にしたい');
 const choice=p.getByLabel('予約テストの旅客機',{exact:true});await choice.click();
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state.traffic.automaticIds?.length===1);
 await p.getByRole('button',{name:'自動便だけ止める',exact:true}).click();
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state.traffic.automaticIds?.length===0);
 const s=await p.evaluate(()=>JSON.parse(window.render_game_to_text()).room.state);
 assert(s.flights.filter(f=>f.names?.[0]==='予約テストの旅客機').length>=5);
 await p.getByRole('region',{name:'空の運行管理'}).screenshot({path:out+'/operator-queue.png'});
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/result.json',JSON.stringify({result,errors,checks:['5 participant flights queued through the local Worker','15 second minimum departure intervals','automatic pool and stop preserve user flights','operator comment persists']},null,2));
 console.log('PASS: real Worker queue, automatic pool controls, comment persistence');
}finally{await browser.close();}
