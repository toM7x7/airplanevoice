import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = 'output/pv-20260922';
await fs.mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-angle=d3d11','--auto-accept-this-tab-capture','--enable-usermedia-screen-capturing']});
const page = await browser.newPage({viewport:{width:1600,height:900}});
try {
  await page.goto('http://127.0.0.1:8787/?shared=1');
  await page.waitForTimeout(1500);
  console.log((await page.locator('body').innerText()).slice(0,3500));
  console.log(await page.evaluate(async()=>{
    const c=document.createElement('canvas'),gl=c.getContext('webgl2'),dbg=gl.getExtension('WEBGL_debug_renderer_info');
    let capture;
    try {const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:false,preferCurrentTab:true});capture=stream.getTracks().map(t=>t.getSettings());stream.getTracks().forEach(t=>t.stop());}catch(e){capture=String(e)}
    return {renderer:gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),capture};
  }));
  await page.screenshot({path:out+'/pc-entry.png'});
} finally {await browser.close();}
