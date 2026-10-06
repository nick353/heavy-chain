import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const wrapper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainMaterialWorkbenchPage');
test('material route keeps identity boundaries in both configured and local-only sessions',()=>{
 const code=ts.transpile(wrapper.getText(ast).replace('export ',''),{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 for(const client of [null,{origin:'https://api.example.test'}]){
  let auth={user:{id:'alice'},currentBrand:{id:'brand'}},location={pathname:'/tools/fabric'};
  const render=new Function('useAuthStore','useLocation','cloudflareDataPlane','LightchainMaterialWorkbenchSession','React',`${code};return LightchainMaterialWorkbenchPage;`)(()=>auth,()=>location,client,()=>{}, {createElement:(type,props)=>({type,...props})});
  const a=render();assert.equal(render().key,a.key);
  for(const next of [{user:{id:'bob'},currentBrand:{id:'brand'}},{user:{id:'alice'},currentBrand:{id:'other'}},{user:null,currentBrand:null}]){auth=next;assert.notEqual(render().key,a.key);}
  auth={user:{id:'alice'},currentBrand:{id:'brand'}};assert.equal(render().key,a.key);
  location={pathname:'/tools/printing'};assert.notEqual(render().key,a.key);
 }
});
