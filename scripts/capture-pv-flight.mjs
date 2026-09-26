import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const out='output/pv-20260922';
const b=await chromium.launch({headless:true,args:['--use-angle=d3d11','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
const p=await b.newPage({viewport:{width:1920,height:1080}});
await p.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...rest){const result=connect.call(this,destination,...rest);if(destination instanceof AudioDestinationNode){window.pvAudio??=this.context.createMediaStreamDestination();connect.call(this,window.pvAudio)}return result;}});
let queue=Promise.resolve();await fs.writeFile(out+'/flight-clean.webm','');
await p.exposeBinding('pvChunk',(_,base64)=>{queue=queue.then(()=>fs.appendFile(out+'/flight-clean.webm',Buffer.from(base64,'base64')));return queue;});
try{
 await p.goto('http://127.0.0.1:8787/?shared=1');
 await p.getByRole('button',{name:'展示用の部屋をつくる（8時間）',exact:true}).click();
 const ready=()=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).room.status==='connected'&&!JSON.parse(window.render_game_to_text()).room.pending);
 await ready();await p.getByRole('button',{name:'頭上を通る一機を準備',exact:true}).click();await ready();
 await p.getByRole('button',{name:'音を聴く',exact:true}).click();
 await p.getByRole('button',{name:'一緒に飛ばす',exact:true}).click();await ready();
 await p.waitForTimeout(1400);
 await p.evaluate(()=>{
  // Camera uses the existing "look at aircraft" button. This is a filming aid, not an advertised auto-follow feature.
  window.pvFollowing=true;function follow(){if(!window.pvFollowing)return;[...document.querySelectorAll('button')].find(x=>x.textContent==='機体の方を向く')?.click();requestAnimationFrame(follow)}follow();
  const video=document.querySelector('canvas').captureStream(30);
  const s=new MediaStream([...video.getVideoTracks(),...window.pvAudio.stream.getAudioTracks()]);
  window.pvR=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp9,opus',videoBitsPerSecond:12000000,audioBitsPerSecond:192000});window.pvWrites=[];
  window.pvR.ondataavailable=e=>{if(e.data.size)window.pvWrites.push((async()=>{const a=new Uint8Array(await e.data.arrayBuffer());let v='';for(let i=0;i<a.length;i+=8192)v+=String.fromCharCode(...a.subarray(i,i+8192));await window.pvChunk(btoa(v))})())};window.pvR.start(1000);
 });
 const samples=[],start=Date.now();
 for(let i=0;i<55;i++){await p.waitForTimeout(1000);const s=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));const q=s.aircraft.position,l=s.listener;samples.push({seconds:(Date.now()-start)/1000,distance:Math.hypot(q.x-l.x,q.y-l.y,q.z-l.z),phase:s.phase});if(i%10===0)console.log(samples.at(-1));}
 await p.evaluate(async()=>{window.pvFollowing=false;await new Promise(r=>{window.pvR.onstop=r;window.pvR.stop()});await Promise.all(window.pvWrites)});await queue;
 await fs.writeFile(out+'/flight-samples.json',JSON.stringify(samples,null,2));
}finally{await b.close();}
