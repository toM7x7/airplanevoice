import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=promisify(execFile),dir=path.resolve('output/pv-20260923'),bin=path.resolve('motion-film/node_modules/@remotion/compositor-win32-x64-msvc');
const ff=path.join(bin,'ffmpeg.exe'),probe=path.join(bin,'ffprobe.exe');
const exec=(cmd,args,extra={})=>run(cmd,args,{windowsHide:true,maxBuffer:64*1024*1024,...extra});
const results=[];
for(const seconds of [60,30]){
 const file=path.join(dir,`airplanevoice-${seconds}s.mp4`);
 const metadata=JSON.parse((await exec(probe,['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration','-of','json',file])).stdout);
 const v=metadata.streams.find(s=>s.codec_type==='video');assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.avg_frame_rate,'30/1');assert.equal(+v.duration,seconds);assert.equal(+v.nb_read_frames,seconds*30);assert(metadata.streams.some(s=>s.codec_type==='audio'));
 const audio=await exec(ff,['-v','error','-i',file,'-vn','-ac','2','-ar','48000','-c:a','pcm_s16le','-f','wav','pipe:1'],{encoding:'buffer'});
 let offset=12;while(offset+8<audio.stdout.length&&audio.stdout.toString('ascii',offset,offset+4)!=='data')offset+=8+audio.stdout.readUInt32LE(offset+4)+(audio.stdout.readUInt32LE(offset+4)%2);offset+=8;
 let peak=0,sum=0;for(let i=offset;i+1<audio.stdout.length;i+=2){const x=audio.stdout.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(x));sum+=x*x;}assert(peak>.005&&peak<.99,'silent or clipped audio');
 results.push({seconds,metadata,audio:{peak,rms:Math.sqrt(sum/((audio.stdout.length-offset)/2))}});
}
const scenes=[['concept',4],['create',14],['ai',22],['scenery',29],['radar',35],['quest',43],['closing',55]];
for(const [name,second] of scenes)await exec(ff,['-v','error','-y','-ss',String(second),'-i',path.join(dir,'airplanevoice-60s.mp4'),'-frames:v','1','-update','1',path.join(dir,`check-${name}.png`)]);
const timing=[];
for(const name of ['create','ai','scenery','radar','flight']){
 const data=JSON.parse((await exec(probe,['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',path.join(dir,name+'.webm')])).stdout);
 const ts=data.frames.map(f=>+f.best_effort_timestamp_time),gaps=ts.slice(1).map((t,i)=>t-ts[i]).sort((a,b)=>a-b);
 timing.push({source:name,frames:ts.length,observedFps:(ts.length-1)/(ts.at(-1)-ts[0]),p95GapMs:gaps[Math.floor(gaps.length*.95)]*1000});
}
const motion=[];
for(const [name,second] of [['flight',4],['quest',42]]){
 const {stdout}=await exec(ff,['-v','error','-ss',String(second),'-t','2','-i',path.join(dir,'airplanevoice-60s.mp4'),'-vf','scale=320:180','-pix_fmt','rgb24','-c:v','rawvideo','-f','image2pipe','pipe:1'],{encoding:'buffer'});
 const bytes=320*180*3,n=stdout.length/bytes;let changed=0;
 for(let i=1;i<n;i++){let sum=0;for(let j=0;j<bytes;j++)sum+=Math.abs(stdout[i*bytes+j]-stdout[(i-1)*bytes+j]);if(sum/bytes>.01)changed++;}
 assert(changed>n*.6);motion.push({scene:name,frames:n,changed});
}
await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({results,timing,motion,notes:['AI response is a labelled fixture; no AI voice is recorded','Quest footage was recorded 2026-09-22; its UI is older','Audio is edited from current PC app recording; not a physical Quest recording']},null,2));
await fs.writeFile(path.join(dir,'review.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIRPLANEVOICE 展示PV</title><style>body{background:#102e35;color:#f4f1e8;font:17px/1.7 'Yu Gothic',sans-serif;margin:0}main{max-width:1200px;margin:auto;padding:35px 24px}video{width:100%;border-radius:16px}section{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}img{width:100%}a{color:#e6cf99}h1{font-size:36px}</style><main><h1>空を見上げ、音の軌跡をたどる。</h1><p>2026年9月23日版。PCの実画面とQuest 3実機映像を編集しています。<br>AI応答は固定の再現映像、Quest操作UIは9月22日収録版です。音声はPC版のエンジン音です。</p><h2>60秒版</h2><video controls preload="metadata" poster="check-concept.png" src="airplanevoice-60s.mp4"></video><h2>30秒版</h2><video controls preload="metadata" poster="check-concept.png" src="airplanevoice-30s.mp4"></video><section>${scenes.map(([n,s])=>`<article><img src="check-${n}.png"><p>${s}秒 / ${n}</p></article>`).join('')}</section><a href="verification.json">書き出し検証結果</a></main>`);
console.log(JSON.stringify({results:results.map(r=>({seconds:r.seconds,audio:r.audio})),timing,motion},null,2));
