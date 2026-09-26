import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=promisify(execFile),root=process.cwd(),dir=path.join(root,'output/pv-20260922');
const bin=path.join(root,'motion-film/node_modules/@remotion/compositor-win32-x64-msvc');
const ff=path.join(bin,'ffmpeg.exe'),probe=path.join(bin,'ffprobe.exe'),file=path.join(dir,'airplanevoice-development-pv.mp4');
const exec=(cmd,args,extra={})=>run(cmd,args,{windowsHide:true,maxBuffer:50*1024*1024,...extra});
const metadata=JSON.parse((await exec(probe,['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration,sample_rate,channels','-of','json',file])).stdout);
const v=metadata.streams.find(x=>x.codec_type==='video');assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.avg_frame_rate,'30/1');assert.equal(+v.nb_read_frames,1800);assert.equal(+v.duration,60);assert(metadata.streams.some(x=>x.codec_type==='audio'));
const scenes=[['concept',3,'見上げた空に、あなたの一機'],['creation',12,'形・音・名前を選ぶ'],['assistant',22,'AIの操作支援（応答は模擬）'],['context',31,'Jevの役割（構想）'],['quest',42,'Quest 3 実機収録'],['closing',54,'次の開発へ']];
for(const [name,sec]of scenes)await exec(ff,['-v','error','-y','-ss',String(sec),'-i',file,'-frames:v','1','-update','1',path.join(dir,name+'.png')]);
const motion=[];
for(const [name,sec]of [['flight',3],['pc-ui',10],['quest',40]]){
 const {stdout}=await exec(ff,['-v','error','-ss',String(sec),'-t','3','-i',file,'-vf','scale=320:180','-pix_fmt','rgb24','-c:v','rawvideo','-f','image2pipe','pipe:1'],{encoding:'buffer'});
 const bytes=320*180*3,n=stdout.length/bytes,deltas=[];
 for(let i=1;i<n;i++){let delta=0;for(let j=0;j<bytes;j++)delta+=Math.abs(stdout[i*bytes+j]-stdout[(i-1)*bytes+j]);deltas.push(delta/bytes)}
 const changing=deltas.filter(x=>x>.01).length;
 assert(changing>(name==='pc-ui'?0:n*.35),`${name}: too few changing frames`);
 motion.push({name,frames:n,changingFrames:changing,meanAbsoluteDelta:deltas.reduce((a,b)=>a+b,0)/deltas.length});
}
const audio=await exec(ff,['-v','error','-i',file,'-vn','-c:a','pcm_s16le','-ar','48000','-ac','2','-f','wav','pipe:1'],{encoding:'buffer'});
// Locate PCM data chunk, rather than assuming a fixed WAV header length.
let offset=12;
while(offset+8<audio.stdout.length&&audio.stdout.toString('ascii',offset,offset+4)!=='data')offset+=8+audio.stdout.readUInt32LE(offset+4)+(audio.stdout.readUInt32LE(offset+4)%2);
offset+=8;let peak=0,squares=0,count=0;
for(let i=offset;i+1<audio.stdout.length;i+=2){const x=audio.stdout.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(x));squares+=x*x;count++}
assert(peak>.005&&peak<.99,'Audio missing or clipping');
const sourceTiming=[];
for(const src of ['flight-clean.webm','pc-creation.webm','quest-take2.mp4']){
 const data=JSON.parse((await exec(probe,['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',path.join(dir,src)])).stdout);
 const ts=data.frames.map(f=>+f.best_effort_timestamp_time),gaps=ts.slice(1).map((t,i)=>t-ts[i]).sort((a,b)=>a-b);
 sourceTiming.push({file:src,frames:ts.length,observedFps:(ts.length-1)/(ts.at(-1)-ts[0]),p95GapMs:1000*gaps[Math.floor(gaps.length*.95)],maxGapMs:1000*gaps.at(-1)});
}
const result={metadata,motion,audio:{peak,rms:Math.sqrt(squares/count),note:'App audio on PC shots only; Quest capture and AI mock demo are silent.'},sourceTiming,aiProviderCalls:0,limitations:['AI replies are fixtures','Jev segment is a design explanation','Quest clip has no audio','UI suggestions are documented, not implemented']};
await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(result,null,2));
await fs.writeFile(path.join(dir,'review.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIRPLANEVOICE 開発PV</title><style>body{margin:0;background:#102e35;color:#f4f1e8;font:17px/1.7 'Yu Gothic',sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:34px;margin:8px 0}p{color:#c0d5d1}video{width:100%;border-radius:16px;background:black}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-top:28px}article{background:#20464b;border-radius:12px;overflow:hidden}img{width:100%;display:block}article div{padding:16px}a{color:#ead6a6}</style><main><small>DEVELOPMENT FILM / 2026.09.22</small><h1>見上げた空に、あなたの一機。</h1><p>60秒・1080p・30fps。PCの実画面とQuest 3の実機映像を編集。AI応答は模擬、Jev部分は構想として明記しています。</p><video controls preload="metadata" poster="concept.png" src="airplanevoice-development-pv.mp4"></video><p>PCカットはアプリのエンジン音。Questカットは無音です。現時点のレビュー用で、公開はしていません。</p><section>${scenes.map(([n,t,label])=>`<article><img src="${n}.png" alt="${label}"><div>${String(t).padStart(2,'0')}秒 / ${label}</div></article>`).join('')}</section><h2>今回の試遊を次へ</h2><p>VRの命名はキーボードで自由入力。設定候補と戻る／次へを分離。QuestのVR入口を明確に。音色の違いが分かる比較へ。アプリ側の改修は次工程です。</p><a href="verification.json">書き出し検証</a></main>`);
console.log(JSON.stringify({video:v,motion,audio:result.audio,sourceTiming},null,2));
