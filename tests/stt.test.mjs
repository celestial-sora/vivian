import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=ts.transpileModule(readFileSync(new URL('../app/api/stt/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function handler(fetch,{key='fixture-key',denied=null,limited=false}={}){
 const exports={};runInNewContext(source,{exports,fetch,File,FormData,Response,AbortSignal,process:{env:{ELEVENLABS_API_KEY:key}},console:{warn(){},info(){}},require(name){
  if(name==='@/lib/auth/server')return {requireApiAccess:async()=>denied};
  if(name==='@/lib/rate-limit')return {rateLimit:()=>({allowed:!limited,retryAfter:30}),rateLimitedResponse:()=>Response.json({error:'limit'},{status:429})};
  if(name==='next/server')return require('next/server');throw Error(name);
 }});return async(language='th',file=new File(['fixture audio'],'recording.m4a',{type:'audio/mp4'}))=>{const body=new FormData();if(file)body.append('file',file);body.append('language',language);return exports.POST(new Request('https://vivian.example/api/stt',{method:'POST',body}));};
}
test('Scribe v2 gets original Safari audio and selected language; no Whisper or paid extras',async()=>{
 for(const lang of ['th','en','ja','ko','zh','global']){
  const call=handler(async(url,options)=>{
   assert.equal(url,'https://api.elevenlabs.io/v1/speech-to-text');assert.equal(options.headers['xi-api-key'],'fixture-key');assert.equal(options.headers.Authorization,undefined);
   assert.equal(options.body.get('model_id'),'scribe_v2');assert.equal(options.body.get('language_code'),lang==='global'?null:lang);
   assert.equal(options.body.get('diarize'),'false');assert.equal(options.body.get('tag_audio_events'),'false');assert.equal(options.body.get('timestamps_granularity'),'none');
   assert.equal(options.body.get('keyterms'),null);assert.equal(options.body.get('transcript_edit'),null);
   assert.equal(options.body.get('file').type,'audio/mp4');assert.equal(await options.body.get('file').text(),'fixture audio');
   return Response.json({text:'ยังพูดไม่จบเลย'});
  });assert.deepEqual(await (await call(lang)).json(),{text:'ยังพูดไม่จบเลย'});
 }
});
test('access, rate limit, missing key and empty upload prevent provider calls',async()=>{
 const fetch=async()=>assert.fail('provider must not be called');
 assert.equal((await handler(fetch,{denied:Response.json({}, {status:401})})()).status,401);
 assert.equal((await handler(fetch,{limited:true})()).status,429);
 assert.equal((await handler(fetch,{key:''})()).status,500);
 assert.equal((await handler(fetch)('th',null)).status,400);
 assert.equal((await handler(fetch)('th',new File([],'empty.webm'))).status,400);
});
test('upstream rejection, network failure and invalid JSON remain controlled errors',async()=>{
 assert.equal((await handler(async()=>new Response('private provider error',{status:429}))()).status,429);
 assert.equal((await handler(async()=>{throw new Error('network');})()).status,504);
 assert.equal((await handler(async()=>new Response('not json'))()).status,504);
 const empty=await handler(async()=>Response.json({}))();assert.deepEqual(await empty.json(),{text:''});
});
