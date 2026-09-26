import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
try {
 const p=await b.newPage();await p.goto('http://127.0.0.1:5173/');
 const result=await p.evaluate(async()=>{
 const {AircraftAudio}=await import('/src/audio.ts');const a=new AircraftAudio();
 await a.preview(4,{body:.5,fan:.4,air:.8},true);
 const source=a.audition,buf=source.buffer,d=buf.getChannelData(0),rate=buf.sampleRate;
 const rms=(start,end)=>{let s=0;for(let i=Math.round(start*rate);i<Math.round(end*rate);i++)s+=d[i]*d[i];return Math.sqrt(s/((end-start)*rate))};
 const result={duration:buf.duration,first:rms(.2,1.4),gap:rms(2,2.3),second:rms(2.55,3.75)};
 await a.preview(2);result.replaced=a.audition!==source;a.stop();result.stopped=a.audition===null;a.dispose();return result;
 });
 assert(Math.abs(result.duration-4.35)<.001);assert(result.first>.01&&result.second>.01);assert.equal(result.gap,0);assert(result.replaced&&result.stopped);
 await fs.mkdir('output/audio-comparison',{recursive:true});await fs.writeFile('output/audio-comparison/result.json',JSON.stringify(result,null,2));console.log(result);
} finally {await b.close()}
