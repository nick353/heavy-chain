import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/FittingPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const wrapper=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FittingPage');
const workspace=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FittingWorkspace');
test('actual route wrapper remounts state on owner, brand, logout changes and keeps same scope stable',()=>{
 assert.ok(workspace,'workspace has a separate React state lifetime');
 const code=ts.transpile(wrapper.getText(ast).replace('export ',''),{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 let auth={currentBrand:{id:'brand'},user:{id:'alice'}};
 const render=new Function('useAuthStore','FittingWorkspace','React',`${code};return FittingPage;`)(()=>auth,()=>{}, {createElement:(type,props)=>({type,key:props.key})});
 const a=render();auth={...auth,currentBrand:{id:'brand',name:'renamed'},user:{id:'alice',email:'changed'}};assert.equal(render().key,a.key);
 for(const next of [{currentBrand:{id:'brand'},user:{id:'bob'}},{currentBrand:{id:'other'},user:{id:'alice'}},{currentBrand:null,user:null}]){auth=next;assert.notEqual(render().key,a.key);}
 auth={currentBrand:{id:'brand'},user:{id:'alice'}};assert.equal(render().key,a.key);
});
test('input/history/result/dialog state and scoped draft effects live inside keyed workspace',()=>{
 assert.ok(workspace);
 const body=workspace.getText(ast);
 for(const name of ['materialReference','modelReference','resultMatrix','history','showGallerySelector','showModelGallerySelector'])assert.match(body,new RegExp(`const \\[${name},`));
 assert.match(body,/scopeId: user.id/);assert.match(body,/saveWorkspaceArtifactPersisted/);
 assert.doesNotMatch(wrapper.getText(ast),/saveWorkspaceArtifact|setMaterialReference|saveFittingDraftCutout/);
});
