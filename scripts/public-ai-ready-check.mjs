import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base='https://airplanevoice.pages.dev';
const html=await (await fetch(base+'/?shared=1')).text();assert(html.includes('index-CBsbP747.js'));
assert.equal((await fetch(base+'/assets/index-CBsbP747.js')).status,200);
assert.deepEqual(await (await fetch(base+'/api/ai/access')).json(),{publicDemo:true});
const b=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
try {const requests=[],responses=[],errors=[];const pages=[];
 for(let i=0;i<2;i++){const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();pages.push(p);p.on('request',r=>{if(r.url().includes('/api/ai/'))requests.push(new URL(r.url()).pathname)});p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().endsWith('/api/ai/context'))responses.push({code:r.status(),...(await r.json())});});await p.goto(base+'/?shared=1');await p.getByRole('button',{name:'GPTライブで相談',exact:true}).waitFor();await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='GPTライブで相談'&&!b.disabled));}
 await pages[0].waitForTimeout(5500);
 for(const p of pages) assert(await p.getByRole('button',{name:'GPTライブで相談',exact:true}).isEnabled());
 assert(responses.length>=2);assert(responses.every(r=>r.code===200&&r.configured.openai&&r.configured.typesafe));
 assert(!requests.some(p=>/\/(live|ask|observe)$/.test(p)));assert.deepEqual(errors,[]);
 await fs.mkdir('output/2026-09-23/public',{recursive:true});await pages[0].screenshot({path:'output/2026-09-23/public/ready.png'});
 await fs.writeFile('output/2026-09-23/public/result.json',JSON.stringify({checks:['deployed asset verified','keyless AI preparation','two clients ready without owner conflict','both provider keys configured','no paid API requests'],errors},null,2));console.log('PASS public ready; no provider invocation');
}finally{await b.close()}
