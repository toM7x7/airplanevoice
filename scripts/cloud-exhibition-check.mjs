import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const url = process.env.SHARED_URL || "http://127.0.0.1:8789/?shared=1";
const out = process.env.CLOUD_OUTPUT || "output/cloud-exhibition";
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true,args:["--use-angle=d3d11","--autoplay-policy=no-user-gesture-required","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const errors=[], checks=[];
const ok=(text)=>{checks.push(text);console.log("OK",text)};
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
const ready=p=>p.waitForFunction(()=>window.render_game_to_text && JSON.parse(window.render_game_to_text()).room.status==="connected" && !JSON.parse(window.render_game_to_text()).room.pending);
try {
  const pc=await browser.newContext({viewport:{width:1440,height:1000}}), quest=await browser.newContext({viewport:{width:1440,height:1000}});
  const emulation=await fs.readFile("node_modules/iwer/build/iwer.min.js","utf8");
  await quest.addInitScript({content:`${emulation}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);`});
  const a=await pc.newPage(),b=await quest.newPage();
  for(const p of [a,b]){p.setDefaultTimeout(60000);p.on("pageerror",e=>errors.push(e.message));}
  await a.goto(url);await ready(a);await b.goto(url);await ready(b);
  assert.equal((await state(a)).room.state.persistent,true);
  assert.equal((await state(a)).room.state.flights[0].id,(await state(b)).room.state.flights[0].id);
  assert.equal(new URL(a.url()).searchParams.has("room"),false);
  ok("independent PC and Quest sessions automatically join the same running exhibition without invitation keys");
  const legacy={...(await state(a)).creation.entry,id:crypto.randomUUID(),name:`端末内の旧機体${Date.now()}`};
  await a.evaluate(entry=>{localStorage.setItem("airplanevoice-hangar-v1",JSON.stringify([entry]));window.dispatchEvent(new Event("airplanevoice-hangar-change"));},legacy);
  await a.getByRole("button",{name:/この端末の1機をクラウドへ保存/}).click();
  await b.waitForFunction(id=>JSON.parse(window.render_game_to_text()).room.state.hangar?.some(e=>e.id===id),legacy.id);
  ok("legacy browser aircraft migrate to the cloud without deleting the local copy");
  await a.getByRole("button",{name:"この機体を編集",exact:true}).click();
  await a.getByRole("navigation",{name:"機体の編集項目"}).getByRole("button",{name:/名前/}).click();
  await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).fill(`PCから届いた翼${Date.now()}`);
  await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).press("Tab");
  await a.locator('.workbench [data-creation-action="save"]').click();
  await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).creation.message.includes("クラウド格納庫に保存しました"));
  const entry=(await state(a)).creation.entry;
  await b.waitForFunction(id=>JSON.parse(window.render_game_to_text()).room.state.hangar?.some(e=>e.id===id),entry.id);
  await b.locator(".wb-aircraft-list button").filter({hasText:entry.name}).click();
  await b.getByRole("button",{name:/^(この機体を使う|保存せず切り替える)$/}).click();
  assert.deepEqual((await state(b)).creation.entry,entry);
  ok("PC cloud save is immediately selectable from the other device's hangar");
  await b.locator("#vr-enter").click();
  await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).vr.frames>10);
  const frames = async (n = 4) => {
    const target = (await state(b)).vr.frames + n;
    await b.waitForFunction((n) => {
      const vr = JSON.parse(window.render_game_to_text()).vr;
      return vr.status !== "presenting" || vr.frames >= n;
    }, target);
  };
  const press = async (label) => {
    if (label !== "メニューを開く" && !(await state(b)).vr.controls.open) await press("メニューを開く");
    if (label !== "メニューを開く") await b.waitForFunction(
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

  await press("尾翼の色");
  const colors=(await state(b)).vr.controls.targets.map(t=>t.label);
  const gold=colors.find(t=>t.startsWith("金色"));assert(gold);
  await press(gold);await press("クラウドに保存");
  await a.waitForFunction(id=>JSON.parse(window.render_game_to_text()).room.state.hangar?.find(e=>e.id===id)?.recipe.aircraft.color==="#b9863b",entry.id);
  const updated=(await state(b)).creation.entry;
  assert.equal((await state(b)).vr.status,"presenting");
  await b.screenshot({path:`${out}/02-vr-cloud-save.png`});
  ok("immersive XR edits and saves the same aircraft without leaving VR; PC receives the revision");
  await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).fill("古い下書きからの変更");await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).press("Tab");
  await a.locator('.workbench [data-creation-action="save"]').click();
  await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).creation.message.includes("別の端末"));
  assert.equal((await state(a)).creation.dirty,true);
  assert.deepEqual((await state(a)).room.state.hangar.find(e=>e.id===entry.id),updated);
  ok("a stale PC draft cannot overwrite a newer Quest save");
  await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).vr.controls.targets.some(t=>t.label==="この機体を飛ばす" && t.enabled));
  await press("この機体を飛ばす");
  await a.waitForFunction(id=>JSON.parse(window.render_game_to_text()).room.state.flights.some(f=>f.departure && f.entryIds?.includes(id)),entry.id);
  const flight=(await state(a)).room.state.flights.find(f=>f.departure && f.entryIds?.includes(entry.id));
  assert.deepEqual((await state(b)).room.state.flights.find(f=>f.id===flight.id),flight);
  ok("VR launches the saved aircraft into the same server-timed flight seen on PC");
  await a.reload();await ready(a);
  await a.locator(".wb-aircraft-list button").filter({hasText:updated.name}).click();
  await a.getByRole("button",{name:"保存せず切り替える",exact:true}).click();
  assert.deepEqual((await state(a)).creation.entry,updated);
  await a.screenshot({path:`${out}/01-pc-cloud-hangar.png`});
  await pc.setOffline(true);
  await a.getByRole("navigation",{name:"機体の編集項目"}).getByRole("button",{name:/名前/}).click();
  await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).fill("通信復帰を待つ下書き");await a.getByRole("textbox",{name:"制作中の機体の名前",exact:true}).press("Tab");
  await a.locator('.workbench [data-creation-action="save"]').click();
  await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).creation.message.includes("接続"));
  assert.equal((await state(a)).creation.dirty,true);
  await pc.setOffline(false);await ready(a);
  assert.equal((await state(a)).creation.entry.name,"通信復帰を待つ下書き");
  assert.deepEqual((await state(a)).room.state.hangar.find(e=>e.id===entry.id),updated);
  ok("reload retains the cloud library; failed offline saves preserve the local draft and never report success");
  assert.deepEqual(errors,[]);
  await fs.writeFile(`${out}/results.json`,JSON.stringify({checks,errors,flight:{id:flight.id,startsAt:flight.startsAt},cloudAircraft:(await state(a)).room.state.hangar.length},null,2));
} finally { await browser.close(); }
