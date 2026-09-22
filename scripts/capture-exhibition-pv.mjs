// Captures the current local build in a separate local database, never production.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const out='output/pv-20260923',base=process.env.PV_URL||'http://127.0.0.1:8789/?shared=1';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--use-angle=d3d11','--autoplay-policy=no-user-gesture-required','--auto-accept-this-tab-capture','--enable-usermedia-screen-capturing','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
await context.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...rest){const v=connect.call(this,destination,...rest);if(destination instanceof AudioDestinationNode){window.pvAudio??=this.context.createMediaStreamDestination();connect.call(this,window.pvAudio)}return v;};});
const p=await context.newPage(),errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));
let reply=null,snapshot=null;
const status=()=>({enabled:true,configured:{openai:true,typesafe:true},observer:{on:false,note:'空の混雑や音の重なりを、必要に応じて観察します。',at:0},live:{status:'closed',seconds:0},used:{conversations:0,replies:0,observations:0},reply});
await p.route('**/api/ai/**',async r=>{const name=new URL(r.request().url()).pathname.split('/').pop(),body=r.request().postDataJSON();let data=status();if(name==='access')data={publicDemo:true};if(name==='context'){snapshot=body.context;data=status()}
 if(name==='ask'){reply={id:body.id,text:'Jevの案：尾翼の色とエンジン数を下書きに反映します。形は今の設定を保ちます。',guide:'none',revision:snapshot.revision,command:{id:crypto.randomUUID(),expiresAt:Date.now()+30000,action:{mode:'apply',control:'creation',value:'design:'+JSON.stringify({...snapshot.creation.aircraft,color:'#263c70',engineCount:2})}}};data=reply;}
 if(name==='action-result')data={text:'下書きに反映しました。保存と出発はご自身で選べます。'};
 await r.fulfill({json:data});});
let queue=Promise.resolve();await p.exposeBinding('pvChunk',(_,file,b64)=>{queue=queue.then(()=>fs.appendFile(path.join(out,file),Buffer.from(b64,'base64')));return queue;});
const hold=ms=>p.waitForTimeout(ms),button=name=>p.getByRole('button',{name,exact:true});
async function start(file,canvas=false){await fs.writeFile(path.join(out,file),'');await p.evaluate(async({file,canvas})=>{const video=canvas?document.querySelector('canvas').captureStream(30):await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30,width:1600,height:900},audio:false,preferCurrentTab:true});const stream=new MediaStream([...video.getVideoTracks(),...(window.pvAudio?.stream.getAudioTracks()??[])]);window.pvVideo=video;window.pvWrites=[];window.pvRecorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9,opus',videoBitsPerSecond:10000000,audioBitsPerSecond:192000});window.pvRecorder.ondataavailable=e=>{if(e.data.size)window.pvWrites.push((async()=>{const a=new Uint8Array(await e.data.arrayBuffer());let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));await window.pvChunk(file,btoa(s))})())};window.pvRecorder.start(1000)},{file,canvas});}
async function stop(){await p.evaluate(async()=>{await new Promise(r=>{window.pvRecorder.onstop=r;window.pvRecorder.stop()});await Promise.all(window.pvWrites);window.pvVideo.getVideoTracks().forEach(t=>t.stop())});await queue;}
try{
 await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).room.status==='connected');
 await p.getByRole('button',{name:'AI案内を閉じる'}).click();
 if(!process.env.PV_FLIGHT_ONLY){
 await button('つくる').click();await hold(500);
 await start('create.webm');await hold(1200);await button('長い翼の双発').click();await hold(1500);
 await p.getByRole('slider',{name:'翼の幅',exact:true}).fill('74');await hold(1200);
 await p.locator('.wb-categories button').filter({hasText:'色'}).click();await hold(700);
 const colors=p.locator('[data-creation-action^="color:"]');if(await colors.count())await colors.nth(3).click();
 await button('右へ回す').click();await hold(1800);await p.locator('.wb-categories button').filter({hasText:'名前'}).click();await hold(500);
 await p.getByRole('textbox',{name:'制作中の機体の名前',exact:true}).fill('ひびき');
 await p.keyboard.press('Tab');await hold(2200);await p.screenshot({path:out+'/create.png'});await stop();checks.push('current aircraft creation and naming');
 await button('AIと相談する').click();await p.getByPlaceholder('例：細身の双発機で、尾翼を紺色に').fill('尾翼を紺色に、双発にして');
 await start('ai.webm');await hold(1400);await button('Jevで機体案を作る').click();await hold(4500);await p.screenshot({path:out+'/ai.png'});await stop();checks.push('labelled fixture demonstrates real draft operation');
 await p.getByRole('button',{name:'AI案内を閉じる'}).click();await button('クラウド格納庫に保存').click();await hold(700);await button('この機体を飛ばす').click();await hold(1400);
 await button('空を眺める').click();if(await button('音を聴く').isVisible())await button('音を聴く').click();
 await button('空間づくり').click();await start('scenery.webm');await hold(1200);await button('都市').click();await p.getByLabel('景色の名前',{exact:true}).fill('ビルの間から見上げる空');await hold(1500);await p.getByLabel('建物の高さ（m）',{exact:true}).fill('72');await hold(1000);await p.getByLabel('緑の量',{exact:true}).fill('0.4');await hold(1600);await p.screenshot({path:out+'/scenery.png'});await stop();
 await p.getByRole('complementary',{name:'空間づくり'}).getByRole('button',{name:'閉じる',exact:true}).click();
 await start('radar.webm');await hold(2300);await button('音響マップ').focus();await button('音響マップ').click();await hold(3500);await p.screenshot({path:out+'/radar.png'});await stop();
 await button('レーダーを閉じる').focus();await button('レーダーを閉じる').click();
 } else {await button('空を眺める').click();if(await button('音を聴く').isVisible())await button('音を聴く').click();await button('レーダーを閉じる').focus();await button('レーダーを閉じる').click();}
 await p.locator('.flight-roster button').filter({hasText:'飛行中'}).first().click();
 await p.evaluate(()=>{window.pvFollow=true;const follow=()=>{if(!window.pvFollow)return;document.querySelectorAll('button').forEach(b=>{if(b.textContent?.trim()==='機体の方を向く')b.click()});requestAnimationFrame(follow)};follow()});
 await start('flight.webm',true);for(let i=0;i<30;i++){await hold(1000);if(i%10===0)console.log('Flight capture',i)}await stop();
 await p.evaluate(()=>{window.pvFollow=false});await p.screenshot({path:out+'/flight.png'});
 const s=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));await fs.writeFile(out+'/capture.json',JSON.stringify({checks,errors,ai:'fixture replay; no paid API calls',source:'current local build; cinematic camera uses existing look-at control',audio:s.audio},null,2));
 console.log('Capture complete',checks,errors);
}catch(e){await p.screenshot({path:out+'/failure.png'});console.error(await p.locator('button:visible').allTextContents());throw e;}finally{await browser.close();}

