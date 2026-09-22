import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const run=promisify(execFile),root=process.cwd();
const ff=path.join(root,'motion-film/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
const raw=path.join(root,'output/pv-20260922'),assets=path.join(root,'motion-film/public/development-pv');
await fs.mkdir(assets,{recursive:true});
for(const sec of [10,20,30,40,50,55])await run(ff,['-v','error','-y','-ss',String(sec),'-i',path.join(raw,'quest-take2.mp4'),'-frames:v','1','-update','1',path.join(raw,`quest-${sec}.png`)],{windowsHide:true});
for(const name of ['pc-creation','pc-flight']){
 const source=name==='pc-flight'?'flight-clean.webm':name+'.webm';
 const trim=name==='pc-flight'?['-ss','25','-t','16']:[];
 await run(ff,['-v','error','-y',...trim,'-i',path.join(raw,source),'-r','30','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',path.join(assets,name+'.mp4')],{windowsHide:true,maxBuffer:2e6});
 console.log('Prepared '+name);
}
// Only the verified in-app section is put in the media project. Raw headset footage stays local.
await run(ff,['-v','error','-y','-ss','20','-t','12','-i',path.join(raw,'quest-take2.mp4'),'-map','0:v:0','-vf','crop=900:1000:30:40,scale=720:800','-r','30','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-an','-movflags','+faststart',path.join(assets,'quest-creation.mp4')],{windowsHide:true});
console.log('Prepared Quest left-eye crop (silent)');
