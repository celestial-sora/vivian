import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoiceActivity, updateVoiceActivity} from '../lib/voice-activity.ts';
const feed=(state,rms,from,to)=>{let ended=false;for(let t=from;t<=to;t+=20)ended=updateVoiceActivity(state,rms,t);return ended;};
test('natural pauses stay in one utterance and only sustained quiet commits',()=>{
 const state=createVoiceActivity();feed(state,.035,0,500);assert.equal(state.heardSpeech,true);
 assert.equal(feed(state,.002,520,2000),false); // longer than the old 900ms cutoff
 assert.equal(feed(state,.015,2020,2600),false); // soft continuation resets silence
 assert.equal(feed(state,.002,2620,5100),false);
 assert.equal(updateVoiceActivity(state,.002,5120),true);
});
test('speech immediately after mic activation and long speech never become the noise floor',()=>{
 const state=createVoiceActivity();feed(state,.08,0,120000);
 assert.equal(state.heardSpeech,true);assert.equal(state.noiseFloor,.003);
 assert.equal(feed(state,.015,120020,125000),false);
});
test('silence and brief clicks never become a message',()=>{
 const state=createVoiceActivity();assert.equal(feed(state,.003,0,10000),false);
 feed(state,.2,10020,10060);assert.equal(feed(state,.003,10080,18000),false);assert.equal(state.heardSpeech,false);
});
test('a short spoken word can finish and a new recording starts fresh',()=>{
 const state=createVoiceActivity();feed(state,.025,0,220);assert.equal(state.heardSpeech,true);
 assert.equal(feed(state,.003,240,2720),false);assert.equal(updateVoiceActivity(state,.003,2740),true);
 assert.equal(createVoiceActivity().heardSpeech,false);
});
