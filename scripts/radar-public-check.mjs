// Read-only release smoke: real Pages/Worker state and simulated stereo entry, no edits or AI calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out=process.env.PUBLIC_OUTPUT||'output/radar-2026-09-23/public',base='https://airplanevoice.pages.dev';
await fs.mkdir(out,{recursive:true});
const local=await fs.readFile('dist/index.html','utf8'),html=await (await fetch(base+'/?shared=1')).text();
const entry=local.match(/src="([^"]+\.js)"/)[1];assert(html.includes(entry));assert.equal((await fetch(base+entry)).status,200);
const sw=await (await fetch(base+'/sw.js')).text(), localSw=await fs.readFile('dist/sw.js','utf8');assert.equal(sw,localSw);
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
const errors=[],calls=[];
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 const runtime=await fs.readFile('node_modules/iwer/build/iwer.min.js','utf8');
 await ctx.addInitScript({content:`${runtime}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);`});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/ai/')) calls.push(new URL(r.url()).pathname)});
 await p.goto(base+'/?shared=1');await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).room.status==='connected');
 const get=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
 const s=await get();assert([3,6,9,12,18,24].includes(s.room.state.traffic.capacity));assert.equal(typeof s.room.state.traffic.jev,"boolean");
 await p.getByRole('button',{name:'部屋・運営',exact:true}).click();
 assert.equal(await p.getByLabel('同時に飛ばす機体数').inputValue(),String(s.room.state.traffic.capacity));
 await p.getByText('空の混み具合と判断の履歴',{exact:true}).click();
 assert(await p.getByText('巡航の近接予測：',{exact:false}).isVisible());
 await p.getByRole('region',{name:'空の運行管理'}).screenshot({path:out+'/operator.png'});
 assert.equal(await p.getByLabel('同時に飛ばす機体数').locator('option').count(),6);
 assert(await p.getByRole('button',{name:'自動便だけ止める',exact:true}).isVisible());
 await p.getByRole('button',{name:'空を眺める',exact:true}).click();
 await p.getByRole('button',{name:'フライトレーダー',exact:true}).click();
 await p.getByRole('button',{name:'音響マップ',exact:true}).focus();await p.keyboard.press('Enter');
 await p.waitForTimeout(500);await p.locator('.flight-radar').screenshot({path:out+'/radar-sound.png'});
 await p.getByRole('button',{name:'レーダーを閉じる',exact:true}).focus();await p.keyboard.press('Enter');
 await p.locator('#vr-enter').click();await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).vr.frames>20);
 const xr=(await get()).vr;assert.equal(xr.views,2);assert(xr.controls.targets.some(t=>t.label==='ARで見る'));assert(xr.controls.targets.some(t=>t.label==='手元へ呼ぶ'));assert(xr.controls.targets.some(t=>t.label==='フライトレーダー'));assert(xr.radar);
 await p.screenshot({path:out+'/xr.png'});
 assert(!calls.some(p=>/\/(live|ask|observe)$/.test(p)));assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/result.json',JSON.stringify({checks:['Pages HTML, JS and offline bundle match local build','persistent exhibition retains existing operator settings','six capacity choices, automatic pool controls and PC acoustic map available','VR dock and separate radar control render in stereo','no paid client AI requests or page errors'],entry,errors},null,2));
 console.log('PASS public deployment, shared server settings and simulated stereo menu');
}finally{await browser.close();}
