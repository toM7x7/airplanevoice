import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const run=promisify(execFile),root=process.cwd();
const ff=path.join(root,'motion-film/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
const raw=path.join(root,'output/pv-20260923'),assets=path.join(root,'motion-film/public/exhibition-20260923');
await fs.mkdir(assets,{recursive:true});
for(const name of ['create','ai','scenery','radar','flight']){
 await run(ff,['-v','error','-y','-i',path.join(raw,name+'.webm'),'-r','30','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',path.join(assets,name+'.mp4')],{windowsHide:true,maxBuffer:2e6});
 console.log('Prepared '+name);
}
await fs.copyFile(path.join(root,'motion-film/public/development-pv/quest-creation.mp4'),path.join(assets,'quest.mp4'));
await fs.copyFile(path.join(raw,'capture.json'),path.join(assets,'capture.json'));
