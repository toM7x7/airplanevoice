import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const b=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
try{const p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:8787/?shared=1');await p.getByRole('button',{name:'つくる',exact:true}).click();
const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).vr.creationModel);
const first=(await state()).vr.creationModel;await p.getByRole('button',{name:'右へ回す',exact:true}).click();await p.waitForTimeout(200);const turned=(await state()).vr.creationModel;assert.notDeepEqual(turned.rotation,first.rotation);
const box=await p.locator('canvas').first().boundingBox();await p.mouse.move(box.x+box.width/2-78,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2+12,box.y+box.height/2+20,{steps:8});await p.mouse.up();await p.waitForTimeout(200);
const dragged=(await state()).vr.creationModel;assert.notDeepEqual(dragged.rotation,turned.rotation,'drag should turn the model');
await p.getByRole('navigation',{name:'機体の編集項目'}).getByRole('button',{name:'02 色',exact:true}).click();await p.locator('.workbench [data-creation-action="color:2"]').click();await p.waitForTimeout(200);assert.equal((await state()).creation.entry.recipe.aircraft.color,'#a54840');assert.deepEqual(errors,[]);
await fs.mkdir('output/creation',{recursive:true});await p.screenshot({path:'output/creation/06-pc-model.png'});console.log('PASS PC rotation button, model drag and colour; no page errors');
}finally{await b.close()}
