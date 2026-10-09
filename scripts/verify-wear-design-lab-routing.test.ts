import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import Reconciler from 'react-reconciler';
import * as hostConfig from 'react-konva/lib/ReactKonvaHostConfig.js';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createServer } from 'vite';
import ts from 'typescript';

// Real page, hooks/commits, navigation callbacks and MemoryRouter. The local
// renderer has no browser, image fetching or native-event proof; workspace and
// unrelated service imports are fail-closed boundaries, never handler mocks.
type Host = { type: string; props: Record<string, any>; children: Host[]; parent: Host | null; text?: string };
const host = (type: string, props: Record<string, any> = {}): Host => ({ type, props, children: [], parent: null });
const append = (parent: Host, child: Host, before?: Host) => {
  if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = parent;
  const index = before ? parent.children.indexOf(before) : -1;
  if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
};
const remove = (parent: Host, child: Host) => { parent.children.splice(parent.children.indexOf(child), 1); child.parent = null; };
const renderer = Reconciler({ ...hostConfig,
  createInstance: host, createTextInstance: (text: string) => ({ ...host('#text'), text }),
  appendInitialChild: append, appendChild: append, appendChildToContainer: append,
  insertBefore: append, insertInContainerBefore: append, removeChild: remove, removeChildFromContainer: remove,
  commitUpdate: (node: Host, _type: string, _old: unknown, props: Record<string, any>) => { node.props = props; },
  commitTextUpdate: (node: Host, _old: string, text: string) => { node.text = text; },
  getPublicInstance: (node: Host) => node, prepareForCommit: () => null, resetAfterCommit() {}, finalizeInitialChildren: () => false,
  clearContainer: (node: Host) => { node.children.length = 0; }, resetTextContent: (node: Host) => { node.children.length = 0; },
  hideInstance() {}, hideTextInstance() {}, unhideInstance() {}, unhideTextInstance() {},
});
const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
const previousFetch = globalThis.fetch;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw new Error('wear_routing_network_forbidden'); };

const pageSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('LightchainParityPages.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const mocks: Record<string, string> = {};
for (const statement of parsed.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
  const source = statement.moduleSpecifier.text;
  if (['react', 'react-router-dom', 'lucide-react'].includes(source)) continue;
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) continue;
  const names = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => (item.propertyName ?? item.name).text) : [];
  mocks[source] = `${clause.name ? "export default {error(){throw new Error('wear_routing_service_forbidden');}};" : ''}${names.map(name => `export const ${name}=()=>{throw new Error('wear_routing_unused_service:${name}');};`).join('')}`;
}
mocks['../hooks/useCanonicalImageWorkspace'] = `export function useCanonicalImageWorkspace(toolId,options){const f=globalThis.__wearRouting;f.workspaceCalls.push({toolId,identityConflict:options?.identityConflict===true});return {toolId,status:options?.identityConflict?'failed':'ready',pendingId:null,jobId:f.jobId,result:f.jobId?{jobId:f.jobId,imageUrl:'fixture-image'}:null,slots:f.primary?{primary:f.primary}:{},error:options?.identityConflict?'workspace_identity_conflict':null,originalInputsAvailable:true,inputsAvailable:true,continueHref:f.continueHref,generate(){f.effects.generation++;throw new Error('generation_forbidden');},upload(){f.effects.upload++;throw new Error('upload_forbidden');},setInputState(){f.effects.inputWrites++;throw new Error('input_write_forbidden');}};}`;
// The detail header names the project from its first file; with no file it reads Untitled.
mocks['../lib/projectNames'] = `export const projectNameFromFile=name=>name?String(name).replace(/\\.[^.]+$/,''):'Untitled';`;
// Card covers pass their URL through the grid-thumbnail helper, which is pure.
mocks['../lib/mediaThumbnail'] = `export const thumbnailImageUrl=url=>url??undefined;`;
mocks['../components/CanonicalImageWorkspaceControls'] = `import React from 'react';export const CanonicalImageWorkspaceControls=({workspace})=>React.createElement('section',{'data-testid':'workspace-boundary','data-feature':workspace.toolId,'data-conflict':String(workspace.error!==null)});`;
// The lab lists the brand's saved projects (five fixture rows here); a card reopens that project's own job.
mocks['./PatternProjectDashboardPage'] = `export const useFeatureProjects=()=>({projects:[1,2,3,4,5].map(n=>({id:'p'+n,jobId:'saved-job-'+n,title:'Project '+n,updatedAt:'2026-10-08T00:00:00.000Z',imageUrl:null})),status:'success'});export const formatProjectAge=()=>'';export const ProjectThumbnail=()=>null;`;
mocks['../features/lightchain/unifiedFeatureWorkflowContract'] = `export const UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION='fixture-catalog';export const getLightchainUnifiedFeatureWorkflowContract=()=>null;`;
const vite = await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},plugins:[{
  name:'wear-routing-service-boundaries',enforce:'pre',
  resolveId(source,importer){if(importer?.endsWith('/LightchainParityPages.tsx')&&mocks[source])return '\0wear-routing:'+source;},
  load(id){if(id.startsWith('\0wear-routing:'))return mocks[id.slice('\0wear-routing:'.length)];},
}]});
const {LightchainOrientedDesignPage,LightchainOrientedDesignDetailPage}=await vite.ssrLoadModule('/src/pages/LightchainParityPages.tsx');
after(async()=>{globalThis.fetch=previousFetch;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=previousAct;delete (globalThis as any).__wearRouting;await vite.close();});
const all=(node:Host):Host[]=>[node,...node.children.flatMap(all)];
const text=(node:Host):string=>node.text??node.children.map(text).join('');
function RouterState(){const location=useLocation();return React.createElement('output',{'data-testid':'router-state','data-pathname':location.pathname,'data-search':location.search,'data-hash':location.hash});}
async function fixture(initial:string,options:{jobId?:string;primary?:Record<string,string>}={}){
  const service={workspaceCalls:[] as {toolId:string;identityConflict:boolean}[],effects:{generation:0,upload:0,save:0,inputWrites:0},continueHref:'/existing-continue?keep=exact#unchanged',...options};
  (globalThis as any).__wearRouting=service;
  const container=host('root');
  const root=renderer.createContainer(container,ConcurrentRoot,null,false,null,'',(error:Error)=>{throw error;},(error:Error)=>{throw error;},(error:Error)=>{throw error;},null);
  await act(async()=>{renderer.updateContainer(React.createElement(MemoryRouter,{initialEntries:[initial]},React.createElement(RouterState),React.createElement(Routes,null,
    React.createElement(Route,{path:'/flow/orientedDesign',element:React.createElement(LightchainOrientedDesignPage)}),
    React.createElement(Route,{path:'/flow/orientedDesign/detail',element:React.createElement(LightchainOrientedDesignDetailPage)}),
    React.createElement(Route,{path:'*',element:React.createElement('span',null,'external route')}))),root,null,null);});
  const nodes=()=>all(container);
  const location=()=>{const n=nodes().find(n=>n.props['data-testid']==='router-state')!;return {pathname:n.props['data-pathname'],params:new URLSearchParams(n.props['data-search']),hash:n.props['data-hash']};};
  const card=(kind:'new'|'project'|'reference',index=0)=>{
    if(kind==='new')return nodes().find(n=>n.props.className==='oriented-design-new-card')!;
    if(kind==='project')return nodes().filter(n=>n.props.className==='oriented-design-project-card'&&n.parent?.props.className==='oriented-design-card-grid')[index];
    return nodes().filter(n=>n.props.className==='oriented-design-project-card'&&n.parent?.props.className==='oriented-design-reference-grid')[index];
  };
  const click=async(n:Host)=>{assert(n,'actual page click target');assert.equal(typeof n.props.onClick,'function');await act(async()=>{n.props.onClick({target:n,currentTarget:n,stopPropagation(){}});});};
  const back=()=>nodes().find(n=>n.type==='button'&&text(n)==='Untitled')!;
  return {service,location,card,click,back,nodes,unmount:async()=>{assert.deepEqual(service.effects,{generation:0,upload:0,save:0,inputWrites:0});await act(async()=>{renderer.updateContainer(null,root,null,null);});}};
}
const home='/flow/orientedDesign';
const detail=home+'/detail';
for(const kind of ['new','reference'] as const)test(`actual ${kind} card preserves resume/candidate/other query/hash and lab workspace through detail and Back`,async()=>{
  const f=await fixture(`${home}?resumeJob=wa-proof&candidate=3&other=a%2Fb&project=12&reference=2&tag=x&tag=y#keep-context`);
  try{
    assert.equal(f.service.workspaceCalls.at(-1)?.toolId,'wear-design-lab');await f.click(f.card(kind,kind==='project'?4:1));
    let l=f.location();assert.equal(l.pathname,detail);assert.equal(l.params.get('workspaceFeature'),'wear-design-lab');assert.equal(l.params.get('resumeJob'),'wa-proof');assert.equal(l.params.get('candidate'),'3');assert.equal(l.params.get('other'),'a/b');assert.deepEqual(l.params.getAll('tag'),['x','y']);assert.equal(l.hash,'#keep-context');
    assert.equal(l.params.get('project'),kind==='project'?'5':'12');assert.equal(l.params.get('reference'),'2');assert.equal(f.service.workspaceCalls.at(-1)?.toolId,'wear-design-lab');assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,false);
    const retained=l.params.toString();await f.click(f.back());l=f.location();assert.equal(l.pathname,home);assert.equal(l.params.toString(),retained);assert.equal(l.hash,'#keep-context');assert.equal(f.service.workspaceCalls.at(-1)?.toolId,'wear-design-lab');
  }finally{await f.unmount();}
});
test('actual project card reopens its saved job and drops the previous candidate and card indexes', async()=>{
  const f=await fixture(`${home}?resumeJob=wa-proof&candidate=3&other=a%2Fb&project=12&reference=2&tag=x&tag=y#keep-context`);
  try{
    await f.click(f.card('project',4));
    const l=f.location();assert.equal(l.pathname,detail);assert.equal(l.params.get('workspaceFeature'),'wear-design-lab');
    assert.equal(l.params.get('resumeJob'),'saved-job-5');assert.equal(l.params.get('candidate'),null);assert.equal(l.params.get('project'),null);assert.equal(l.params.get('reference'),null);
    assert.equal(l.params.get('other'),'a/b');assert.deepEqual(l.params.getAll('tag'),['x','y']);assert.equal(l.hash,'#keep-context');
  }finally{await f.unmount();}
});

test('actual reference index update leaves project and unrelated parameters unchanged',async()=>{
  const f=await fixture(`${home}?workspaceFeature=wear-design-lab&reference=99&project=7&resumeJob=same#reference`);
  try{await f.click(f.card('reference',0));const l=f.location();assert.equal(l.params.get('reference'),'1');assert.equal(l.params.get('project'),'7');assert.equal(l.params.get('resumeJob'),'same');assert.equal(l.hash,'#reference');}finally{await f.unmount();}
});
for(const feature of ['fashion-studio','wear-design-detail',''])test(`explicit conflicting feature ${JSON.stringify(feature)} blocks all actual lab cards without rewriting route or clearing conflict`,async()=>{
  const f=await fixture(`${home}?workspaceFeature=${feature}&resumeJob=foreign#conflict`);
  try{
    for(const kind of ['new','project','reference'] as const){
      assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,true);await f.click(f.card(kind,0));assert.equal(f.location().pathname,home);assert.equal(f.location().params.get('workspaceFeature'),feature);assert.equal(f.location().params.get('resumeJob'),'foreign');assert.equal(f.location().hash,'#conflict');assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,true);
    }
  }finally{await f.unmount();}
});
test('direct conflicting detail Back preserves the explicit foreign feature and remains blocked at home',async()=>{
  const f=await fixture(`${detail}?workspaceFeature=fashion-studio&resumeJob=foreign#conflict`);
  try{assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,true);await f.click(f.back());assert.equal(f.location().pathname,home);assert.equal(f.location().params.get('workspaceFeature'),'fashion-studio');assert.equal(f.location().params.get('resumeJob'),'foreign');assert.equal(f.location().hash,'#conflict');assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,true);}finally{await f.unmount();}
});
for(const feature of [null,'wear-design-detail'])test(`standalone detail ${feature??'without feature'} keeps detail default and existing plain Back target`,async()=>{
  const f=await fixture(`${detail}?${feature?'workspaceFeature='+feature+'&':''}resumeJob=standalone&project=9#old`);
  try{assert.equal(f.service.workspaceCalls.at(-1)?.toolId,'wear-design-detail');assert.equal(f.service.workspaceCalls.at(-1)?.identityConflict,false);await f.click(f.back());const l=f.location();assert.equal(l.pathname,home);assert.equal(l.params.toString(),'');assert.equal(l.hash,'');}finally{await f.unmount();}
});

test('saved-result Continue keeps exact pre-existing workspace.continueHref',async()=>{
  const f=await fixture(`${home}?workspaceFeature=wear-design-lab`,{jobId:'wa-saved'});
  try{await f.click(f.nodes().find(n=>n.type==='button'&&text(n)==='編集を続ける')!);const l=f.location();assert.equal(l.pathname,'/existing-continue');assert.equal(l.params.toString(),'keep=exact');assert.equal(l.hash,'#unchanged');}finally{await f.unmount();}
});
test('Library Continue keeps exact pre-existing workspace.continueHref',async()=>{
  const f=await fixture(`${home}?libraryArtifactId=image-proof`,{primary:{sourceImageId:'image-proof'}});
  try{await f.click(f.nodes().find(n=>n.props['data-testid']==='lightchain-wear-library-continue')!);const l=f.location();assert.equal(l.pathname,'/existing-continue');assert.equal(l.params.toString(),'keep=exact');assert.equal(l.hash,'#unchanged');}finally{await f.unmount();}
});
