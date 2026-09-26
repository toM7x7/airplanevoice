// Real browser MediaStream meter and Web Audio gain path, synthetic tone only; no AI connection.
import {chromium} from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out=process.env.STAGES_OUTPUT||"output/stages12-2026-09-23";
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required","--use-angle=d3d11"]});
const p=await browser.newPage(),errors=[];p.on("pageerror",e=>errors.push(e.message));
await p.route("**/api/ai/**",r=>r.fulfill({status:403,json:{error:"fixture; no provider access"}}));
try{
 await p.goto("http://127.0.0.1:5173/");
 const result=await p.evaluate(async()=>{
   const {AircraftAudio}=await import("/src/audio.ts"),{RemoteSpeechMonitor}=await import("/src/ai/remote-speech.ts");
   const audio=new AircraftAudio();await audio.enable();audio.setVolume(.4);audio.setAmbience(false);
   const ctx=audio.context, oscillator=ctx.createOscillator(),gain=ctx.createGain(),analyser=ctx.createAnalyser();
   gain.gain.value=.05;oscillator.connect(gain).connect(audio.master);audio.master.connect(analyser);oscillator.start();
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const rms=()=>{const d=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(d);return Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length);};
   const changes=[],monitor=new RemoteSpeechMonitor(on=>{changes.push(on);audio.setSpeaking(on);});await monitor.prepare();
   const voice=ctx.createOscillator(),voiceGain=ctx.createGain(),destination=ctx.createMediaStreamDestination();
   voiceGain.gain.value=0;voice.connect(voiceGain).connect(destination);voice.start();monitor.attach(destination.stream);
   await wait(1800);const initial=rms();
   voiceGain.gain.value=.1;await wait(800);const during={rms:rms(),...audio.spaceSoundState};
   audio.setSpeechDucking(false);await wait(1600);const bypass=rms();
   audio.setSpeechDucking(true);voiceGain.gain.value=0;await wait(2400);const restored={rms:rms(),...audio.spaceSoundState};
   voiceGain.gain.value=.1;await wait(600);audio.setMuted(true);await wait(550);const muted=rms();
   monitor.dispose();await wait(50);const ended={...audio.spaceSoundState};
   audio.setMuted(false);await wait(1500);
   const cues=[];for(const kind of ["saved","accepted","error"]){audio.feedback(kind);cues.push(audio.spaceSoundState.lastCue);await wait(300);}
   oscillator.stop();voice.stop();gain.disconnect();voiceGain.disconnect();destination.stream.getTracks().forEach(t=>t.stop());audio.stop();await ctx.close();
   return {initial,during,bypass,restored,muted,ended,cues,changes};
 });
 assert(result.during.speaking);assert(result.during.rms<result.initial*.65);assert(result.during.rms>result.initial*.35);
 assert(result.bypass>result.initial*.9);assert(!result.restored.speaking);assert(result.restored.rms>result.initial*.9);
 assert(result.muted<1e-5);assert(!result.ended.speaking);assert.deepEqual(result.cues,["saved","accepted","error"]);assert.deepEqual(errors,[]);
 await fs.writeFile(out+"/voice-ducking.json",JSON.stringify({result,errors,checks:["received stream detects speech and silence","half gain only while enabled and speaking","silence and disconnect restore user volume","mute preserved","three acknowledgement cue kinds"]},null,2));
 console.log(JSON.stringify(result));
}finally{await browser.close();}
