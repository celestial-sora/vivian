import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Zlib, zlibSync } from 'fflate';
import { downsamplePng } from '../lib/png-render-copy.ts';

function chunk(type, bytes) {
  const output = new Uint8Array(bytes.length + 12);
  new DataView(output.buffer).setUint32(0, bytes.length);
  output.set(new TextEncoder().encode(type), 4); output.set(bytes, 8);
  return output;
}
function png(width, height, compressed, color = 6, extra = [], interlace = 0) {
  const header = new Uint8Array(13); const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header.set([8, color, 0, 0, interlace], 8);
  return new Blob([new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...extra,
    ...compressed.map((bytes) => chunk('IDAT', bytes)), chunk('IEND', new Uint8Array())]);
}
const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c; };
test('streaming PNG copy reconstructs all five filters and preserves RGBA/alpha', async () => {
  const rows = Array.from({length:5}, (_,y)=>Uint8Array.from({length:16}, (_,i)=>(y*29+i*11)%256));
  const raw = [];
  rows.forEach((row,y) => {
    raw.push(y);
    row.forEach((value,x) => {
      const a=x>=4?row[x-4]:0, b=y?rows[y-1][x]:0, c=y&&x>=4?rows[y-1][x-4]:0;
      raw.push((value-(y===1?a:y===2?b:y===3?Math.floor((a+b)/2):y===4?paeth(a,b,c):0))&255);
    });
  });
  const compressed = zlibSync(Uint8Array.from(raw));
  const pieces = Array.from(compressed, (value) => new Uint8Array([value]));
  const full = await downsamplePng(png(4,5,pieces),4,5);
  assert.deepEqual([...full], rows.flatMap((row)=>[...row]));
});
test('palette transparency, grayscale, grayscale alpha and RGB transparency are preserved', async () => {
  const decode = (color, bytes, extra=[])=>downsamplePng(png(2,1,[zlibSync(new Uint8Array([0,...bytes]))],color,extra),2,1);
  assert.deepEqual([...await decode(3,[0,1],[chunk('PLTE',new Uint8Array([255,0,0,0,255,0])),chunk('tRNS',new Uint8Array([0,128]))])],[0,0,0,0,0,255,0,128]);
  assert.deepEqual([...await decode(0,[12,34])],[12,12,12,255,34,34,34,255]);
  assert.deepEqual([...await decode(4,[12,99,34,123])],[12,12,12,99,34,34,34,123]);
  assert.deepEqual([...await decode(2,[1,2,3,4,5,6],[chunk('tRNS',new Uint8Array([0,1,0,2,0,3]))])],[0,0,0,0,4,5,6,255]);
});
test('area filtering preserves thin features and smooths alternating edges instead of skipping pixels', async () => {
  const image=png(2,2,[zlibSync(new Uint8Array([0,0,0,0,255,255,255,255,255,0,255,255,255,255,0,0,0,255]))]);
  assert.deepEqual([...await downsamplePng(image,1,1)],[128,128,128,255]);
  const transparent=png(2,1,[zlibSync(new Uint8Array([0,255,0,0,0,255,255,255,255]))]);
  assert.deepEqual([...await downsamplePng(transparent,1,1)],[255,255,255,128]);
  const fractional=png(3,1,[zlibSync(new Uint8Array([0,0,0,0,255,120,120,120,255,240,240,240,255]))]);
  assert.deepEqual([...await downsamplePng(fractional,2,1)],[40,40,40,255,200,200,200,255]);
});
test('large compressed atlas uses scanline-sized source buffers and a small render result', async () => {
  const chunks=[]; const encoder=new Zlib((bytes)=>chunks.push(bytes.slice()));
  const row=new Uint8Array(8192*4+1); row.fill(255,1);
  for(let y=0;y<4097;y++) encoder.push(row,y===4096);
  const blob=png(8192,4097,chunks);
  assert.ok(blob.size<1024*1024);
  const result=await downsamplePng(blob,64,32);
  assert.equal(result.byteLength,64*32*4);
  assert.ok(result.every((value)=>value===255));
});
test('unsafe formats, incomplete data and cancelled work fail before native decoding', async () => {
  await assert.rejects(downsamplePng(png(2,1,[],6,[],1),1,1),/non-interlaced/);
  await assert.rejects(downsamplePng(png(2,1,[zlibSync(new Uint8Array([0,1]))]),1,1),/Incomplete/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(downsamplePng(new Blob(),1,1,controller.signal),{name:'AbortError'});
});
