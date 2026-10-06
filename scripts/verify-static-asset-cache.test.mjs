import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

let fixtureRoot, child, port;
const asset = 'globalThis.cacheFixture = true;';
function get(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ host:'127.0.0.1', port, path, method },res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.setTimeout(2000,()=>req.destroy(new Error('fixture request timeout')));req.end();
  });
}
before(async()=>{
  fixtureRoot=await mkdtemp(join(tmpdir(),'heavy-static-cache-'));
  await mkdir(join(fixtureRoot,'assets'));
  await mkdir(join(fixtureRoot,'scene-assets'));
  await writeFile(join(fixtureRoot,'index.html'),'<html>fresh application entry</html>');
  await writeFile(join(fixtureRoot,'assets/index.ABcd1234.js'),asset);
  await writeFile(join(fixtureRoot,'assets/theme.XYzw5678.css'),'body { color: white; }');
  await writeFile(join(fixtureRoot,'assets/model.onnx'),'unhashed model fixture');
  await writeFile(join(fixtureRoot,'scene-assets/fabric1.jpg'),'scene fixture');
  const allocator=createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
  child=spawn(process.execPath,[new URL('./serve-zeabur.mjs',import.meta.url).pathname],{
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DIST_DIR:fixtureRoot,AUTH_BASE_URL:''},stdio:['ignore','pipe','pipe'],
  });
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('fixture server not ready')),5000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('heavy-chain-zeabur-server listening')){clearTimeout(timeout);resolve();}});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('fixture server exited '+code));});
  });
});
after(async()=>{
  if(child && child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}
  if(fixtureRoot)await rm(fixtureRoot,{recursive:true,force:true});
});

test('existing fingerprinted JS and CSS retain exact bytes and immutable cache policy',async()=>{
  const js=await get('/assets/index.ABcd1234.js');assert.equal(js.status,200);assert.equal(js.body,asset);
  assert.equal(js.headers['cache-control'],'public, max-age=31536000, immutable');
  assert.equal(Number(js.headers['content-length']),Buffer.byteLength(asset));
  const css=await get('/assets/theme.XYzw5678.css');assert.equal(css.status,200);assert.match(css.headers['content-type'],/text\/css/);
  assert.equal(css.headers['cache-control'],'public, max-age=31536000, immutable');
});
test('HEAD shares cache metadata and sends no body',async()=>{
  const head=await get('/assets/index.ABcd1234.js','HEAD');assert.equal(head.body,'');assert.equal(head.status,200);
  assert.equal(head.headers['cache-control'],'public, max-age=31536000, immutable');assert.equal(Number(head.headers['content-length']),Buffer.byteLength(asset));
});
test('SPA route and index HTML are revalidated on release updates',async()=>{
  for(const path of ['/model-library','/index.html']){
    const result=await get(path);assert.equal(result.body,'<html>fresh application entry</html>');assert.equal(result.headers['cache-control'],'no-cache');
  }
});
test('missing fingerprinted asset fallback cannot be stored as an immutable JS response',async()=>{
  const result=await get('/assets/missing.ZZxx1122.js');assert.match(result.headers['content-type'],/text\/html/);
  assert.equal(result.headers['cache-control'],'no-cache');
});
test('unhashed ONNX and scene assets do not gain a year-long stale cache',async()=>{
  for(const path of ['/assets/model.onnx','/scene-assets/fabric1.jpg']){
    const result=await get(path);assert.equal(result.status,200);assert.equal(result.headers['cache-control'],undefined);
  }
});
test('password reset HTML and disabled auth proxy remain no-store',async()=>{
  const reset=await get('/reset-password?token=fixture');assert.equal(reset.headers['cache-control'],'no-store');assert.equal(reset.headers['referrer-policy'],'no-referrer');
  const auth=await get('/api/auth/get-session');assert.equal(auth.status,503);assert.equal(auth.headers['cache-control'],'no-store');
});
test('traversal and unsupported scene query remain rejected and noncacheable',async()=>{
  const traversal=await get('/assets/%2e%2e/index.html');assert.equal(traversal.status,400);assert.equal(traversal.headers['cache-control'],'no-store');
  const scene=await get('/scene-assets/fabric1.jpg?probe=1');assert.equal(scene.status,404);assert.equal(scene.headers['cache-control'],'no-store');
});
