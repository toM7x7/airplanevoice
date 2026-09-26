import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--autoplay-policy=no-user-gesture-required']});
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const emulation=await fs.readFile('node_modules/iwer/build/iwer.min.js','utf8');
 await context.addInitScript({content:emulation+"\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);"});
 const b=await context.newPage();b.on('pageerror',e=>console.log('ERROR',e.message));
 await b.goto('http://127.0.0.1:8787/?shared=1');
 await b.getByRole('button',{name:'一機をつくる',exact:true}).click();
 await b.locator('[data-creation-action="next"]').click();await b.locator('[data-creation-action="next"]').click();
 await b.locator('#vr-enter').click();await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).vr.frames>10);
  const frames = async (n = 4) => {
    const target = (await state(b)).vr.frames + n;
    await b.waitForFunction(
      (n) => JSON.parse(window.render_game_to_text()).vr.frames >= n,
      target,
    );
  };
  const press = async (label) => {
    await b.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.controls.progress === 1,
    );
    const { panel, origin, controls } = (await state(b)).vr;
    const t = controls.targets.find((t) => t.label === label);
    assert(t && t.enabled, label);
    const x = ((t.x + t.w / 2) / 1024 - 0.5) * panel.width,
      y = (0.5 - (t.y + t.h / 2) / 512) * panel.height,
      m = panel.matrix;
    const target = [
      m[0] * x + m[4] * y + m[12],
      m[1] * x + m[5] * y + m[13],
      m[2] * x + m[6] * y + m[14],
    ];
    await b.evaluate(
      ({ target, origin }) => {
        const c = xrDevice.controllers.right;
        c.position.set(0.25, 1.3, -0.2);
        const d = target.map((v, i) => v - origin[i] - [0.25, 1.3, -0.2][i]),
          l = Math.hypot(...d),
          [x, y, z] = d.map((v) => v / l),
          n = Math.hypot(y, -x, 1 - z);
        c.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
      },
      { target, origin },
    );
    await frames();
    await b.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 1),
    );
    await frames();
    await b.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 0),
    );
    await frames();
  };

 const before=(await state(b)).vr;assert(before.creationModel.position[1]>before.head.position[1]);
 await b.screenshot({path:'output/creation/07-final-model-placement.png'});
 await press('VR内で名前を入力');await frames();assert.equal((await state(b)).vr.creationModel,null);
 await b.screenshot({path:'output/creation/08-final-keyboard.png'});
 await press('取消');await frames();assert((await state(b)).vr.creationModel);assert.equal((await state(b)).vr.status,'presenting');
 console.log('PASS final model above menu; keyboard hides model; cancel restores it within XR');
}finally{await browser.close()}
