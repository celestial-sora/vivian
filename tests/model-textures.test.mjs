import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTextures, readTextureSize } from '../lib/model-textures.ts';
const MB = 1024 * 1024;
test('32K source textures retain original dimensions while temporary render copies fit the GPU', async () => {
  const source = {width:32768,height:32768};
  const plan = planTextures([source], {maxDimension:8192,budgetBytes:128*MB});
  assert.deepEqual(plan[0].source, source);
  assert.ok(plan[0].render.width <= 8192);
  assert.ok(plan[0].render.width * plan[0].render.height * 4 <= 128*MB);
  assert.deepEqual(source, {width:32768,height:32768});
  const header = new Uint8Array(24); header.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(header.buffer); view.setUint32(16,32768); view.setUint32(20,32768);
  assert.deepEqual(await readTextureSize(new Blob([header])), source);
});

test('two 16K atlases fit desktop and mobile budgets without changing the source metadata', () => {
  const sizes = [{width:16384,height:16384},{width:16384,height:16384}];
  const desktop = planTextures(sizes, { maxDimension:16384,budgetBytes:512*MB });
  assert.deepEqual(desktop.map((item)=>item.render), [{width:8192,height:8192},{width:8192,height:8192}]);
  const mobile = planTextures(sizes, { maxDimension:8192,budgetBytes:128*MB });
  assert.deepEqual(mobile.map((item)=>item.render), [{width:4096,height:4096},{width:4096,height:4096}]);
  assert.equal(sizes[0].width,16384);
});
test('GPU limits and memory budgets both apply, including nonsquare atlases', () => {
  const plan = planTextures([{width:16000,height:8000},{width:4000,height:2000}], {maxDimension:4096,budgetBytes:64*MB});
  const total = plan.reduce((sum,item)=>sum+item.render.width*item.render.height*4,0);
  assert.ok(total<=64*MB);
  for(const {render} of plan) { assert.ok(render.width<=4096); assert.ok(render.height<=4096); assert.ok(Math.abs(render.width/render.height-2)<0.005); }
});
test('compatible 4K textures keep original dimensions and original quality respects the GPU limit', () => {
  const size = {width:4096,height:4096};
  assert.deepEqual(planTextures([size], {maxDimension:4096,budgetBytes:64*MB})[0].render,size);
  assert.deepEqual(planTextures([size,size], {maxDimension:8192,budgetBytes:128*MB}).map((item)=>item.render),[size,size]);
  assert.equal(planTextures([size], {maxDimension:8192,budgetBytes:128*MB,original:true})[0].render.width,4096);
  assert.throws(()=>planTextures([{width:16384,height:16384}], {maxDimension:16384,budgetBytes:128*MB,original:true}), /graphics memory budget/);
  assert.throws(()=>planTextures([{width:16384,height:16384}], {maxDimension:8192,budgetBytes:128*MB,original:true}), /Auto quality/);
  assert.throws(()=>planTextures([{width:0,height:1}], {maxDimension:8192,budgetBytes:128*MB}));
});
test('PNG dimensions are read from a small header without decoding or allocating a 16K image', async () => {
  const header = new Uint8Array(24); header.set([137,80,78,71,13,10,26,10]);
  const data = new DataView(header.buffer); data.setUint32(16,16384);data.setUint32(20,16384);
  assert.deepEqual(await readTextureSize(new Blob([header])), {width:16384,height:16384});
});
