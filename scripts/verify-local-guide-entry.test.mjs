import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const text=await fs.readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const evalExpression=(expression,bindings)=>new Function(...Object.keys(bindings),`return (${expression});`)(...Object.values(bindings));
for(const [family,handlerName,generateName] of [['PrintDesign','handlePrintDesignStart','handlePrintDesignGenerate'],['WearDesign','handleWearDesignStart','handleWearDesignGenerate']]){
 test(`${family}: guide/no-guide enter local editing while Provider unavailable; generation remains locked`,()=>{
  const start=nodes.find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&n.attributes.getText(ast).includes(`${handlerName}(item.mode)`));assert.ok(start);
  const disabled=start.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='disabled').initializer.expression.getText(ast);
  assert.equal(evalExpression(disabled,{specialProviderGenerationLocked:true,lightchainGenerationRunning:false}),false);
  assert.equal(evalExpression(disabled,{specialProviderGenerationLocked:true,lightchainGenerationRunning:true}),true);
  const generate=nodes.find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&n.attributes.getText(ast).includes(`onClick={${generateName}}`));
  const generationDisabled=generate.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='disabled').initializer.expression.getText(ast);assert.equal(evalExpression(generationDisabled,{specialProviderGenerationLocked:true}),true);
  const handler=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===handlerName).initializer.getText(ast);
  const code=ts.transpile(`return (${handler});`,{target:ts.ScriptTarget.ES2022});
  for(const mode of ['guide','no-guide']){const state={};const run=new Function(`set${family}Mode`,`set${family}DetailStarted`,code)(v=>state.mode=v,v=>state.started=v);run(mode);assert.deepEqual(state,{mode,started:true});}
 });
}
