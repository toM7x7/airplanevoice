import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--autoplay-policy=no-user-gesture-required']});
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const emulation=await fs.readFile('node_modules/iwer/build/iwer.min.js','utf8');
 await context.addInitScript({content:emulation+"\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);"});
 const errors=[];const b=await context.newPage();b.on('pageerror',e=>errors.push(e.message));
 await b.goto(process.env.SHARED_URL ?? 'http://127.0.0.1:8787/?shared=1');
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
 await press('次へ');
 await press('この機体を飛ばす');
 await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.state?.flights.length > 0).catch(async error=>{const s=await state(b);console.log({status:s.room.status,error:s.room.error,message:s.creation.message,pending:s.creation.pending,phase:s.phase});throw error;});
 assert((await state(b)).room.state.flights.length === 1);assert.equal((await state(b)).vr.calibration,'none');
 await press('ARで見る'); await frames();
 assert.equal((await state(b)).vr.displayMode,'ar');
 await press('VRに戻る'); await frames();assert.equal((await state(b)).vr.displayMode,'vr');
 await press('ARで見る');await press('閉じて眺める');await frames();
 await press('手元に模型を出す');await frames();assert((await state(b)).vr.creationModel);
  const model = (await state(b)).vr.creationModel,
    origin = (await state(b)).vr.origin;
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
    { target: model.position, origin },
  );
  await frames();
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 1),
  );
  await frames();
  assert.equal((await state(b)).vr.creationModel.held, true);
  await b.evaluate(() => (xrDevice.controllers.right.position.x += 0.12));
  await frames();
  assert.notDeepEqual(
    (await state(b)).vr.creationModel.position,
    model.position,
  );
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 0),
  );
  await frames();
  assert.equal((await state(b)).vr.creationModel.held, false);

 await b.screenshot({path:'output/creation/09-ar-navigation.png'});
 await b.evaluate(() => {
   const current=JSON.parse(window.render_game_to_text()).creation.entry;
   const entries=Array.from({length:20},(_,i)=>({...current,id:crypto.randomUUID(),name:`テスト機${i+1}`}));
   localStorage.setItem('airplanevoice-hangar-v1',JSON.stringify(entries));
   window.dispatchEvent(new Event('airplanevoice-hangar-change'));
 });
 await press('閉じて眺める');await press('保存した機体');
 for(let i=0;i<4;i++) await press('次の4機');
 const targets=(await state(b)).vr.controls.targets;
 assert(targets.some(t=>t.label.includes('テスト機20')));
 await b.screenshot({path:'output/creation/10-hangar-page.png'});
 await press('次の4機');assert.equal((await state(b)).vr.controls.targets.find(t=>t.label==='次の4機').enabled,false);await press('前の4機');
 await press('20. テスト機20（このブラウザ）');
 assert.equal((await state(b)).creation.entry.name,'テスト機20');
 console.log('PASS exact model ray grab, translation/release and 20-aircraft pagination/recall');

 assert.deepEqual(errors,[]);
 console.log('PASS no-room VR fly creates room and launches once; VR/AR round trip and one-step AR model recall');
}finally{await browser.close()}
