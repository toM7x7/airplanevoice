// Records the actual local application. AI replies are fixtures, labelled in the edit.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const out='output/pv-20260922';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--use-angle=d3d11','--autoplay-policy=no-user-gesture-required','--auto-accept-this-tab-capture','--enable-usermedia-screen-capturing','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-position=40,40']});
const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
await context.addInitScript(()=>{
  sessionStorage.setItem('av-ai-trial','pv-fixture');
  const original=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...rest){
    const result=original.call(this,destination,...rest);
    if(destination instanceof AudioDestinationNode){
      window.pvAudio??=this.context.createMediaStreamDestination();
      original.call(this,window.pvAudio);
    }
    return result;
  };
});
const page=await context.newPage();
const checks=[],errors=[],markers=[];
page.on('pageerror',e=>errors.push(e.message));
let reply=null,aiContext=null;
const results=[];
await page.route('**/api/ai/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1);
  const data=route.request().postDataJSON()??{};
  if(name==='context')aiContext=data.context;
  if(name==='ask') reply={id:crypto.randomUUID(),text:data.text.includes('場所')?'「この機体を飛ばす」を光らせました。最後はご自身で決められます。':'音を、低く厚い響きの候補に変えました。試してみましょう。',guide:'none',revision:aiContext.revision,command:{id:crypto.randomUUID(),action:data.text.includes('場所')?{mode:'guide',control:'creation',value:'fly'}:{mode:'apply',control:'creation',value:'tone:0'},expiresAt:Date.now()+30000}};
  if(name==='action-result'){results.push(data);reply={...reply};delete reply.command;}
  await route.fulfill({status:200,json:name==='ask'?reply:name==='action-result'?{text:reply.text}:{enabled:true,expiresAt:null,configured:{openai:true,typesafe:true},limits:{observations:null,replies:null,conversations:null,voiceSeconds:null,observationMs:10000,staleMs:20000},used:{observations:0,replies:0,conversations:0},observer:{on:false,note:'撮影用。観察APIは呼んでいません。',at:0,error:''},live:{status:'idle',deadline:null,seconds:null,error:''},reply}});
});
let writeQueue=Promise.resolve(),started=0;
await page.exposeBinding('pvChunk',(_,file,base64)=>{writeQueue=writeQueue.then(()=>fs.appendFile(path.join(out,file),Buffer.from(base64,'base64')));return writeQueue;});
const ready=()=>page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).room.status==='connected'&&!JSON.parse(window.render_game_to_text()).room.pending);
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const hold=ms=>page.waitForTimeout(ms);
const mark=name=>{markers.push({name,seconds:(Date.now()-started)/1000});console.log(name);};
async function start(file,canvas=false){
 await fs.writeFile(path.join(out,file),'');
 await page.evaluate(async({file,canvas})=>{
   const video=canvas?document.querySelector('canvas').captureStream(30):await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1600,max:1600},height:{ideal:900,max:900},frameRate:{ideal:30,max:30}},audio:false,preferCurrentTab:true});
   const stream=new MediaStream([...video.getVideoTracks(),...(window.pvAudio?.stream.getAudioTracks()??[])]);
   window.pvStream=video;
   window.pvRecorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9,opus',videoBitsPerSecond:10000000,audioBitsPerSecond:192000});
   window.pvWrites=[];
   window.pvRecorder.ondataavailable=e=>{if(!e.data.size)return;window.pvWrites.push((async()=>{const bytes=new Uint8Array(await e.data.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));await window.pvChunk(file,btoa(text));})());};
   window.pvRecorder.start(1000);
 },{file,canvas});
 started=Date.now();
}
async function stop(){await page.evaluate(async()=>{await new Promise(resolve=>{window.pvRecorder.onstop=resolve;window.pvRecorder.stop()});await Promise.all(window.pvWrites);window.pvStream.getVideoTracks().forEach(t=>t.stop());});await writeQueue;}
try{
 await page.goto('http://127.0.0.1:8787/?shared=1&ai=guide');
 await page.getByRole('button',{name:'展示用の部屋をつくる（8時間）',exact:true}).click();await ready();
 await page.getByRole('button',{name:'頭上を通る一機を準備',exact:true}).click();await ready();
 await page.getByRole('button',{name:'音を聴く',exact:true}).click();await hold(300);
 await page.getByRole('button',{name:'一機をつくる',exact:true}).click();
 await page.locator('.creation-workspace').scrollIntoViewIfNeeded();
 await page.screenshot({path:out+'/creation-start.png'});
 await start('pc-creation.webm');mark('shape');await hold(1200);
 await page.locator('[data-creation-action="shape:1"]').click();await hold(1800);
 await page.locator('[data-creation-action="next"]').click();mark('sound');await hold(1500);
 await page.locator('[data-creation-action="tone:2"]').click();await page.locator('[data-creation-action="listen"]').click();await hold(2500);
 await page.locator('[data-creation-action="next"]').click();mark('name');
 await page.getByLabel('制作中の機体の名前').fill('こだま');await page.getByLabel('制作中の機体の名前').press('Tab');await hold(1500);
 checks.push('shape, sound audition, name changed through real UI');
 mark('ai-draft');await page.getByLabel('操作や飛行について').fill('音を重くして');await hold(700);await page.getByRole('button',{name:'相談する',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).creation.entry.recipe.aircraft.sound.body===1);await hold(3000);
 await page.getByRole('button',{name:'案内を開く',exact:true}).click();
 mark('ai-guide');await page.getByLabel('操作や飛行について').fill('飛ばす場所を教えて');await hold(700);await page.getByRole('button',{name:'相談する',exact:true}).click();
 await page.locator('[data-creation-action="fly"][data-ai-highlight="true"]').waitFor();await hold(3500);
 await page.screenshot({path:out+'/ai-guide.png'});
 if((await state()).room.state.flights.length!==0)throw Error('AI launched unexpectedly');
 checks.push('fixture tool applies draft and highlights launch; no automatic launch');
 mark('human-launch');await page.locator('[data-creation-action="save"]').click();await hold(800);await page.locator('[data-creation-action="fly"]').click();await ready();await hold(1000);
 await stop();
 await fs.writeFile(out+'/markers.json',JSON.stringify(markers,null,2));
 // Flight footage uses the app canvas and the same Web Audio output, with no UI chrome.
 await page.getByRole('button',{name:'機体の方を向く',exact:true}).click();await hold(400);
 await start('pc-flight.webm',true);
 for(let i=0;i<22;i++){await hold(700);await page.getByRole('button',{name:'機体の方を向く',exact:true}).click();}
 await page.screenshot({path:out+'/flight.png'});await stop();
 const snapshot=await state();
 checks.push('named aircraft launched and audio enabled');
 await fs.writeFile(out+'/capture-report.json',JSON.stringify({checks,errors,ai:'fixture; no provider calls',toolResults:results,flight:{phase:snapshot.phase,audio:snapshot.audio,name:snapshot.creation.entry.name},recording:'actual local build; hardware WebGL; canvas flight and browser-tab UI'},null,2));
 console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}
