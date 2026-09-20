import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';

const vite=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const persistence=await vite.ssrLoadModule('/src/lib/canvasDocumentPersistence.ts');
after(async()=>{await vite.close();});

const source = await (await import('node:fs/promises')).readFile(
  new URL('../src/lib/canvasDocumentPersistence.ts', import.meta.url),
  'utf8',
);
const pageSource = await (await import('node:fs/promises')).readFile(
  new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url),
  'utf8',
);

test('legacy canvas migration receipt does not duplicate the payload', () => {
  assert.match(source, /legacyKey:\s*LEGACY_CANVAS_KEY/);
  assert.match(source, /rawLength:\s*raw\.length/);
  assert.doesNotMatch(source, /capturedAt: new Date\(\)\.toISOString\(\), raw \}/);
});

test('legacy canvas migration receipt is quota-safe', () => {
  assert.match(source, /try \{\s*window\.localStorage\.setItem\(key, receipt\);\s*\} catch/s);
});

test('serialized image sources are validated after canonical source resolution', () => {
  assert.match(source, /export const validateCanvasDocumentSnapshot/);
  assert.match(source, /object\.type !== 'image'/);
  assert.match(source, /data\|blob/);
  assert.match(source, /local-canvas-asset:/);
  assert.match(source, /CanvasDocumentValidationError/);
  assert.match(source, /validateCanvasDocumentSnapshot\(input\.snapshot\)/g);
});

test('fitting-style empty image payload cannot be accepted as durable content', () => {
  const snapshot=persistence.buildCanvasDocumentSnapshot({name:'Board',objects:[{
    id:'fitting-result',type:'image',src:'',label:'fitting result',x:0,y:0,width:100,height:100,
    rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true,zIndex:0,
    metadata:{feature:'library-import',generation:0,galleryImageUrl:'',parameters:{sourceArtifactId:'fitting-draft-brand'}},
  }]});
  assert.equal(snapshot.objects[0].src,'');
  assert.throws(()=>persistence.validateCanvasDocumentSnapshot(snapshot),error=>{
    assert.equal(error.code,'canvas_image_source_invalid');
    assert.deepEqual(error.objectIds,['fitting-result']);
    assert.deepEqual(error.labels,['fitting result']);
    return true;
  });
});

test('invalid image schemes are rejected while durable sources and non-images pass',()=>{
  for(const src of ['', '   ', 'data:image/png;base64,AA==', 'blob:https://canvas.test/id', 'local-canvas-asset://sha256%3Aabc']) {
    const snapshot={version:1,objects:[{id:'image',type:'image',src,label:'invalid'}]};
    assert.throws(()=>persistence.validateCanvasDocumentSnapshot(snapshot),/canvas_image_source_invalid/);
  }
  const canvasObject=(object)=>({x:0,y:0,width:100,height:100,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true,zIndex:0,...object});
  for(const object of [
    canvasObject({id:'path',type:'image',src:'data:image/png;base64,AA==',metadata:{feature:'gallery-import',generation:0,storagePath:'generated-images/path.png'}}),
    canvasObject({id:'image-id',type:'image',src:'blob:https://canvas.test/id',metadata:{feature:'gallery-import',generation:0,imageId:'img_123'}}),
    canvasObject({id:'remote',type:'image',src:'https://cdn.example.test/image.png'}),
    canvasObject({id:'text',type:'text',src:''}),
  ]) {
    const snapshot=object.type==='image'
      ? persistence.buildCanvasDocumentSnapshot({name:'Board',objects:[object]})
      : {version:1,objects:[object]};
    assert.doesNotThrow(()=>persistence.validateCanvasDocumentSnapshot(snapshot));
  }
});

test('create and update wrappers reject invalid snapshots before any configured transport check',async()=>{
  const snapshot={version:1,objects:[{id:'broken',type:'image',src:''}]};
  await assert.rejects(persistence.createCanvasDocument({brandId:'brand',title:'Board',snapshot}),/canvas_image_source_invalid/);
  await assert.rejects(persistence.updateCanvasDocument({brandId:'brand',documentId:'doc',title:'Board',snapshot,expectedRevision:0}),/canvas_image_source_invalid/);
});

test('Canvas save reports source validation without acknowledging a server save',()=>{
  assert.match(pageSource,/validateCanvasDocumentSnapshot\(snapshot\);/);
  assert.match(pageSource,/canvasDocumentValidationMessage/);
  assert.match(pageSource,/toast\.error\(canvasDocumentValidationMessage\(error\)/);
  assert.match(pageSource,/const validationMessage = canvasDocumentValidationMessage\(error\)/);
  assert.match(pageSource,/validationMessage\s*\n\s*\? validationMessage/);
});
