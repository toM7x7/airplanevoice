// Opt-in live smoke: one paid text request in an isolated AI client. No shared-room writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
if(process.env.VERIFY_PAID_AI !== '1') throw Error('Set VERIFY_PAID_AI=1 for the single paid request.');
const base='https://airplanevoice.pages.dev', client=crypto.randomUUID();
async function request(path,body){const r=await fetch(base+'/api/ai/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-AI-Client':client},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});const data=await r.json();if(!r.ok)throw Error(`${r.status}: ${data.error}`);return data;}
const context={revision:1,phase:'EDIT',paused:false,volume:30,soundOn:false,menuOpen:false,menuPage:'home',selected:false,fleet:[],controls:['environment'],ui:{mode:'pc',place:'observe',tab:'shape',canFly:false,flightHelp:'景色の下書きを編集中です。'},environment:{preset:'airfield',seed:7,density:0,heightM:12,streetWidthM:60,greenery:0.2,buildingSound:false}};
let prepared=false;
try {
 await request('context',{context});
 prepared=true;
 const t=Date.now(),result=await request('ask',{id:crypto.randomUUID(),text:'【景色案】パリの街並みと東京の高層ビル群の特徴が混ざった都市景観を作ってください。'});
 assert.equal(result.command.action.control,'environment');
 assert(result.command.action.value.startsWith('recipe:'));
 const draft=JSON.parse(result.command.action.value.slice(7));
 assert(draft.name&&draft.preset==='city');assert(draft.heightM>=4&&draft.heightM<=120);assert(draft.density>=0&&draft.density<=1);
 await request('action-result',{id:result.command.id,ok:true,context:{...context,environment:draft}});
 const evidence={requestCount:1,elapsedMs:Date.now()-t,text:result.text,draft,sharedRoomWrites:0};
 await fs.mkdir('output/scenery-recipe-check',{recursive:true});await fs.writeFile('output/scenery-recipe-check/live-provider.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
}finally{if(prepared)await request('stop',{}).catch(e=>console.error('Cleanup:',e.message));}
