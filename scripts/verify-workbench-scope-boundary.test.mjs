import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const wrapper=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainWorkbenchPage');
test('actual public route keys workspace by owner and brand while preserving execution adapter',()=>{
 const code=ts.transpile(wrapper.getText(ast).replace('export ',''),{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 let state={currentBrand:{id:'brand'},user:{id:'alice'}};const adapter={run:()=>{throw new Error('must_not_execute');}};
 const render=new Function('useAuthStore','LightchainWorkbenchWorkspace','React',`${code};return LightchainWorkbenchPage;`)(()=>state,()=>{}, {createElement:(type,props)=>({type,...props})});
 const initial=render({fittingBatchExecution:adapter});assert.equal(initial.fittingBatchExecution,adapter);
 assert.equal(render({fittingBatchExecution:adapter}).key,initial.key);
 for(const next of [{currentBrand:{id:'brand'},user:{id:'bob'}},{currentBrand:{id:'other'},user:{id:'alice'}},{currentBrand:null,user:null}]){state=next;assert.notEqual(render({fittingBatchExecution:adapter}).key,initial.key);}
 state={currentBrand:{id:'brand'},user:{id:'alice'}};assert.equal(render().key,initial.key);
});
