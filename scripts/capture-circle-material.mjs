import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const b=await chromium.launch({headless:true});const p=await b.newPage({viewport:{width:1600,height:1200}});
p.on('pageerror',e=>console.log(e.message));
await p.goto('http://127.0.0.1:5173/');
await p.evaluate(async()=>{const m=await import('/@fs/D:/personal_dev/airplanevoice/scripts/circle-material.tsx');m.renderPlane()});
await p.waitForTimeout(4000);
const data=await p.locator('canvas').evaluate(c=>c.toDataURL());
await fs.writeFile('output/circle-cut-layered/aircraft-transparent.png',Buffer.from(data.split(',')[1],'base64'));await b.close();
