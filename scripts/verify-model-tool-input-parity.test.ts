import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import Reconciler from 'react-reconciler';
import * as existingHostConfig from 'react-konva/lib/ReactKonvaHostConfig.js';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { createServer } from 'vite';

// Existing UI suites launch Chromium. This accepted package forbids browser
// operations/installations, so use the already installed React renderer stack
// with a local host adapter. React hooks, commits, callbacks and refs are real;
// host keyboard bubbling/focus is the isolated boundary, not native-browser proof.
type Host = { type: string; props: Record<string, any>; children: Host[]; parent: Host | null; text?: string; focus(): void };
let activeElement: Host | null = null;
let focusCalls = 0;
const link = (parent: Host, child: Host, before?: Host) => {
  if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = parent;
  const at = before ? parent.children.indexOf(before) : -1;
  if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child);
};
const remove = (parent: Host, child: Host) => { parent.children.splice(parent.children.indexOf(child), 1); child.parent = null; };
const host = (type: string, props: Record<string, any> = {}): Host => ({ type, props, children: [], parent: null, focus() { activeElement = this; focusCalls++; } });
const renderer = Reconciler({
  ...existingHostConfig,
  createInstance: (type: string, props: Record<string, any>) => host(type, props),
  createTextInstance: (text: string) => ({ ...host('#text'), text }),
  appendInitialChild: link, appendChild: link, appendChildToContainer: link,
  insertBefore: link, insertInContainerBefore: link, removeChild: remove, removeChildFromContainer: remove,
  commitUpdate: (instance: Host, _type: string, _oldProps: unknown, newProps: Record<string, any>) => { instance.props = newProps; },
  commitTextUpdate: (instance: Host, _old: string, text: string) => { instance.text = text; },
  getPublicInstance: (instance: Host) => instance,
  prepareForCommit: () => null, resetAfterCommit() {}, finalizeInitialChildren: () => false,
  clearContainer: (container: Host) => { container.children.length = 0; }, resetTextContent: (instance: Host) => { instance.children.length = 0; },
  hideInstance() {}, hideTextInstance() {}, unhideInstance() {}, unhideTextInstance() {},
});
const originalAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { MemoryRouter } from 'react-router-dom';
const previousFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('model_inputs_network_forbidden');};
const mocks: Record<string,string>={
 '../../hooks/useCanonicalImageWorkspace':`import React from 'react';export function useCanonicalImageWorkspace(tool,config){const f=globalThis.__modelInput;const[inputState,set]=React.useState(f.missing?{}:f.initial??(f.legacy?{aspectRatio:'4:5',resolution:'2K',...(tool==='body-shape'?{gender:'女性',bodyShape:'筋肉質'}:{})}:config.initialInputState));const[slots,setSlots]=React.useState(f.slots);f.state=inputState;f.slots=slots;return{toolId:tool,inputState,setInputState:next=>{f.writes++;set(next);},status:f.locked?'running':'ready',pendingId:null,brief:'',slots,sourceSelectionScope:tool+':'+f.contextRevision,selectModelReference:async selection=>{f.librarySelections.push(selection);setSlots(s=>({...s,secondary:{name:selection.imageId,kind:'secondary',imageUrl:selection.imageUrl,sourceImageId:selection.imageId,sourceStoragePath:selection.storagePath}}));},clearSource:key=>{f.clears.push(key);setSlots(s=>({...s,[key]:null}));},candidates:[],selectedCandidateId:null,jobId:null,generate:()=>{f.generates++;},upload:()=>{throw new Error('upload_not_requested');}};}`,
 '../CanonicalImageWorkspaceControls':`import React from 'react';export const CanonicalImageWorkspaceControls=()=>React.createElement('section');`,
 '../GallerySelector':`import React from 'react';export const GallerySelector=props=>{globalThis.__modelInput.libraryProps=props;return props.isOpen?React.createElement('section',{role:'dialog','aria-label':props.title}):null;};`,
};
const vite=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},plugins:[{name:'model-input-boundaries',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/SourceModelToolSurface.tsx')&&mocks[source])return '\0model-input:'+source;},load(id){if(id.startsWith('\0model-input:'))return mocks[id.slice('\0model-input:'.length)];}}]});
const{SourceModelToolSurface}=await vite.ssrLoadModule('/src/components/lightchain/SourceModelToolSurface.tsx');
const{MODEL_TOOL_FEATURES,MODEL_TOOL_FIELDS,MODEL_ASPECT_OPTIONS,MODEL_RESOLUTION_OPTIONS,defaultModelToolSettings}=await vite.ssrLoadModule('/src/lib/modelToolSettings.ts');
after(async()=>{globalThis.fetch=previousFetch;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=originalAct;delete(globalThis as any).__modelInput;await vite.close();});
const forms:Record<string,string>={'model-face':'head-form','model-change':'model-change-form','body-shape':'body-form','clothing-size':'size-form','pose-change':'pose-form','background-change':'background-form','angle-change':'perspective-form'};
const all=(n:Host):Host[]=>[n,...n.children.flatMap(all)];
const text=(n:Host):string=>n.text??n.children.map(text).join('');
async function fixture(feature:string,locked=false,missing=false,legacy=false,initial?:Record<string,string|boolean>){
 const f={path:'/model-library/'+forms[feature],locked,missing,legacy,initial,contextRevision:0,libraryProps:null as any,librarySelections:[] as any[],clears:[] as string[],slots:{primary:{name:'source',imageUrl:'local:source'},secondary:{name:'reference',imageUrl:'local:reference',sourceImageId:'reference-id',sourceStoragePath:'generated-images/reference-id'}},state:{} as Record<string,unknown>,writes:0,generates:0};(globalThis as any).__modelInput=f;
 const container=host('root');const root=renderer.createContainer(container,ConcurrentRoot,null,false,null,'',(e:Error)=>{throw e;},(e:Error)=>{throw e;},(e:Error)=>{throw e;},null);
 await act(async()=>{renderer.updateContainer(React.createElement(MemoryRouter,{initialEntries:[f.path]},React.createElement(SourceModelToolSurface)),root,null,null);});
 const nodes=()=>all(container);const trigger=(label:string)=>{const n=nodes().find(n=>n.props.role==='combobox'&&n.props['aria-label']===label);assert(n);return n;};
 const click=async(n:Host)=>{const e={target:n,currentTarget:n,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};await act(async()=>{if(!n.props.disabled)n.props.onClick?.(e);});return e;};
 const key=async(n:Host,k:string)=>{const e={key:k,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};await act(async()=>{for(let p:Host|null=n;p&&!e.stopped;p=p.parent)p.props.onKeyDown?.(e);});return e;};
 const select=async(label:string,option:string)=>{await click(trigger(label));const n=nodes().find(n=>n.props.role==='option'&&text(n)===option);assert(n);await click(n);assert.equal(trigger(label).props['aria-expanded'],false);};
 return{f,nodes,trigger,click,key,select,render:async()=>{await act(async()=>{renderer.updateContainer(React.createElement(MemoryRouter,{initialEntries:[f.path]},React.createElement(SourceModelToolSurface)),root,null,null);});},close:async()=>{await act(async()=>{renderer.updateContainer(null,root,null,null);});}};
}
for(const feature of MODEL_TOOL_FEATURES)test(`${feature}: mounted observed defaults, all aspect/resolution choices, Escape and focus preserve settings`,async()=>{
 const t=await fixture(feature);try{assert.deepEqual(t.f.state,defaultModelToolSettings(feature));
 for(const[label,key,choices]of [['画像比率','aspectRatio',MODEL_ASPECT_OPTIONS],['解像度','resolution',MODEL_RESOLUTION_OPTIONS]] as const){for(const value of choices){await t.select(label,value);assert.equal(t.f.state[key],value);}
 const before=structuredClone(t.f.state),writes=t.f.writes;await t.click(t.trigger(label));const descendant=t.nodes().find(n=>n.props.role==='option')!;const e=await t.key(descendant,'Escape');assert(e.prevented&&e.stopped);assert.equal(t.trigger(label).props['aria-expanded'],false);assert.equal(activeElement,t.trigger(label));assert.deepEqual(t.f.state,before);assert.equal(t.f.writes,writes);await t.key(t.trigger(label),'Escape');assert.equal(t.trigger(label).props['aria-expanded'],false);}
 assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
for(const feature of ['body-shape','clothing-size','angle-change'])test(`${feature}: every observed feature option updates only its own setting, no generic reference substitute`,async()=>{
 const t=await fixture(feature);try{for(const field of MODEL_TOOL_FIELDS[feature])for(const value of field.options){const before=structuredClone(t.f.state);await t.select(field.label,value);assert.deepEqual(t.f.state,{...before,[field.key]:value});}
 assert.equal(t.nodes().filter(n=>n.type==='input'&&n.props.type==='file').length,1);assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
test('model-change keep-apparel-size initially off, boolean toggle preserves every other field',async()=>{const t=await fixture('model-change');try{const n=()=>t.nodes().find(n=>n.props.role==='switch')!;assert.equal(n().props['aria-checked'],false);await t.click(n());assert.deepEqual(t.f.state,{...defaultModelToolSettings('model-change'),keepApparelSize:true});await t.click(n());assert.equal(t.f.state.keepApparelSize,false);}finally{await t.close();}});
for(const feature of MODEL_TOOL_FEATURES)test(`${feature}: locked controls/submit preserve inputs; invalid saved inputs show unavailable instead of inferred defaults`,async()=>{
 const t=await fixture(feature,true);try{for(const n of t.nodes().filter(n=>n.props.role==='combobox'||n.props.role==='switch')){assert.equal(n.props.disabled,true);await t.click(n);}assert.equal(t.f.writes,0);assert.deepEqual(t.f.state,defaultModelToolSettings(feature));}finally{await t.close();}
 const u=await fixture(feature,false,true);try{assert.deepEqual(u.f.state,{});assert.equal(text(u.trigger('画像比率')),'設定未取得');assert.equal(u.trigger('画像比率').props.disabled,true);assert.equal(u.nodes().find(n=>n.props['data-testid']==='heavy-model-tool-generate')!.props.disabled,true);if(feature==='model-change'){const toggle=u.nodes().find(n=>n.props.role==='switch')!;assert.equal(toggle.props['aria-checked'],undefined);assert(text(toggle).includes('設定未取得'));}assert.equal(u.f.writes,0);}finally{await u.close();}
});

for(const feature of ['pose-change','background-change'])test(`${feature}: actual reference/custom pane, exact placeholder/counter800, hidden reference retention and no dispatch`,async()=>{
 const t=await fixture(feature);try{
 const button=(label:string)=>{const n=t.nodes().find(n=>n.type==='button'&&text(n)===label);assert(n);return n;};
 const secondary=t.f.slots.secondary;assert.equal(button('参考画像').props['aria-pressed'],true);assert.equal(t.f.state.inputMode,'reference');assert.equal(t.f.state.customDescription,'');assert.equal(t.nodes().filter(n=>n.type==='input'&&n.props.type==='file').length,2);assert.equal(t.nodes().filter(n=>n.type==='textarea').length,0);
 await t.click(button('カスタム'));assert.equal(t.f.state.inputMode,'custom');const textarea=()=>t.nodes().find(n=>n.type==='textarea')!;assert.equal(textarea().props.placeholder,'背景の説明をここに記入してください');assert.equal(textarea().props.maxLength,800);assert.equal(textarea().props.required,undefined);assert.equal(t.nodes().filter(n=>n.type==='input'&&n.props.type==='file').length,1);
 await act(async()=>{textarea().props.onChange({target:{value:'a'.repeat(805)}});});assert.equal(String(t.f.state.customDescription).length,800);assert.equal(text(t.nodes().find(n=>n.props['aria-label']==='説明文字数')!),'800/800');assert.equal(t.f.slots.secondary,secondary);
 await t.click(button('参考画像'));assert.equal(t.f.state.inputMode,'reference');assert.equal(String(t.f.state.customDescription).length,800);assert.equal(t.nodes().filter(n=>n.type==='textarea').length,0);assert.equal(t.nodes().filter(n=>n.type==='input'&&n.props.type==='file').length,2);await t.click(button('カスタム'));assert.equal(textarea().props.value,'a'.repeat(800));assert.equal(t.f.generates,0);assert.equal(t.f.slots.secondary,secondary);
 }finally{await t.close();}
});
for(const feature of ['model-face','model-change','pose-change','background-change'])test(`${feature}: actual Library link opens shared selector; cancel/pick/replace/clear preserve primary and never upload or generate`,async()=>{
 const t=await fixture(feature);try{const link=()=>t.nodes().find(n=>n.type==='button'&&text(n)==='参考画像ライブラリ')!;const primary=t.f.slots.primary,original=t.f.slots.secondary;assert(link());const event=await t.click(link());assert(event.prevented&&event.stopped);assert.equal(t.f.libraryProps.isOpen,true);assert.equal(t.f.libraryProps.title,'素材を選択');await act(async()=>t.f.libraryProps.onClose());assert.equal(t.f.libraryProps.isOpen,false);assert.equal(t.f.slots.secondary,original);assert.equal(t.f.librarySelections.length,0);
 await t.click(link());await act(async()=>t.f.libraryProps.onSelect('https://fixture.invalid/one','reference-one','generated-images/reference-one'));assert.equal(t.f.libraryProps.isOpen,false);assert.deepEqual(t.f.librarySelections[0],{imageUrl:'https://fixture.invalid/one',imageId:'reference-one',storagePath:'generated-images/reference-one',name:'参考画像'});assert.equal(t.f.slots.secondary.sourceImageId,'reference-one');assert.equal(t.f.slots.primary,primary);
 await t.click(link());await act(async()=>t.f.libraryProps.onSelect('https://fixture.invalid/two','reference-two','generated-images/reference-two'));assert.equal(t.f.slots.secondary.sourceImageId,'reference-two');await t.click(t.nodes().find(n=>n.type==='button'&&text(n)==='参考画像を削除')!);assert.equal(t.f.slots.secondary,null);assert.equal(t.f.slots.primary,primary);assert.deepEqual(t.f.clears,['secondary']);assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
test('Library closes on source scope/custom-mode changes; all four locked links and clear controls are inert',async()=>{
 const t=await fixture('pose-change');try{const link=()=>t.nodes().find(n=>n.type==='button'&&text(n)==='参考画像ライブラリ')!;await t.click(link());t.f.contextRevision++;await t.render();assert.equal(t.f.libraryProps.isOpen,false);await t.click(link());await t.click(t.nodes().find(n=>n.type==='button'&&text(n)==='カスタム')!);assert.equal(t.f.libraryProps.isOpen,false);assert.equal(t.nodes().filter(n=>n.type==='button'&&text(n)==='参考画像ライブラリ').length,0);assert.equal(t.f.slots.secondary.sourceImageId,'reference-id');assert.equal(t.f.librarySelections.length,0);}finally{await t.close();}
 for(const feature of ['model-face','model-change','pose-change','background-change']){const u=await fixture(feature,true);try{for(const n of u.nodes().filter(n=>n.type==='button'&&['参考画像ライブラリ','参考画像を削除'].includes(text(n)))){assert.equal(n.props.disabled,true);await u.click(n);}assert.equal(u.f.libraryProps.isOpen,false);assert.equal(u.f.librarySelections.length,0);assert.equal(u.f.clears.length,0);assert.equal(u.f.generates,0);}finally{await u.close();}}
});

const observedBodies = [
 { gender:'男性', height:'175cm', heights:['160cm','165cm','170cm','175cm','180cm','185cm','190cm'], bounds:[[86,143],[62,145],[88,132]] },
 { gender:'男の子', height:'130cm', heights:['100cm','110cm','120cm','130cm','140cm','150cm','160cm','170cm'], bounds:[[65,89],[58,82],[68,86]] },
 { gender:'女性', height:'165cm', heights:['160cm','165cm','170cm','175cm','180cm'], bounds:[[79,119],[26,104],[90,122]] },
 { gender:'女の子', height:'130cm', heights:['100cm','110cm','120cm','130cm','140cm','150cm','160cm'], bounds:[[67,96],[57,84],[70,92]] },
];
for(const observed of observedBodies)test(`body ${observed.gender}: real controls/height options/range boundaries, OFF hides and retains, preset disabled only while ON`,async()=>{
 const t=await fixture('body-shape');try{
 await t.select('性別',observed.gender);const toggle=()=>t.nodes().find(n=>n.props.role==='switch'&&n.props['aria-label']==='カスタムボディ')!;
 assert.equal(toggle().props['aria-checked'],false);assert.equal(t.nodes().filter(n=>n.props.type==='number').length,0);assert.equal(t.trigger('体型').props.disabled,false);assert(!Object.hasOwn(t.f.state,'chest'));
 await t.click(toggle());assert.equal(toggle().props['aria-checked'],true);assert.equal(t.trigger('体型').props.disabled,true);assert.equal(t.f.state.height,observed.height);
 const measurements=t.nodes().filter(n=>n.props.type==='number'),ranges=t.nodes().filter(n=>n.props.type==='range');assert.equal(measurements.length,3);assert.equal(ranges.length,3);
 for(let i=0;i<3;i++){assert.equal(measurements[i].props.value,String(observed.bounds[i][0]));assert.equal(measurements[i].props.min,observed.bounds[i][0]);assert.equal(measurements[i].props.max,observed.bounds[i][1]);assert.equal(ranges[i].props.min,observed.bounds[i][0]);assert.equal(ranges[i].props.max,observed.bounds[i][1]);}
 await t.click(t.trigger('身長'));assert.deepEqual(t.nodes().filter(n=>n.props.role==='option').map(text),observed.heights);await t.key(t.trigger('身長'),'Escape');await t.select('身長',observed.heights.at(-1)!);
 await act(async()=>{ranges[1].props.onChange({target:{value:String(observed.bounds[1][1])}});});const before=structuredClone(t.f.state);assert.equal(before.waist,String(observed.bounds[1][1]));await t.click(toggle());assert.equal(t.nodes().filter(n=>n.props.type==='number'||n.props.type==='range').length,0);assert.equal(t.trigger('体型').props.disabled,false);assert.deepEqual(t.f.state,{...before,customBody:false});await t.click(toggle());assert.deepEqual(t.f.state,before);assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
test('body gender transition resets while ON; OFF gender transition retains measurements then clamps upon ON',async()=>{
 const t=await fixture('body-shape');try{
 const toggle=()=>t.nodes().find(n=>n.props.role==='switch')!;await t.select('性別','女性');await t.click(toggle());assert.deepEqual(t.f.state,{...defaultModelToolSettings('body-shape'),gender:'女性',customBody:true,height:'165cm',chest:'79',waist:'26',hip:'90'});
 await t.select('性別','女の子');assert.deepEqual(t.f.state,{...defaultModelToolSettings('body-shape'),gender:'女の子',customBody:true,height:'130cm',chest:'67',waist:'57',hip:'70'});
 await t.click(toggle());await t.select('性別','女性');assert.equal(t.f.state.waist,'57');assert.equal(t.f.state.chest,'67');assert.equal(t.f.state.hip,'70');await t.click(toggle());assert.equal(t.f.state.waist,'57');assert.equal(t.f.state.chest,'79');assert.equal(t.f.state.hip,'90');assert.equal(t.f.state.height,'165cm');assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
test('body numeric editing allows partial typing, blocks submit during invalid draft, blur clamps/reverts and slider clears draft',async()=>{
 const t=await fixture('body-shape');try{
 await t.click(t.nodes().find(n=>n.props.role==='switch')!);const input=()=>t.nodes().find(n=>n.props.type==='number'&&n.props['aria-label']==='バスト/胸囲')!;const submit=()=>t.nodes().find(n=>n.props['data-testid']==='heavy-model-tool-generate')!;
 for(const value of ['1','13']){await act(async()=>input().props.onChange({target:{value}}));assert.equal(input().props.value,value);assert.equal(t.f.state.chest,'86');assert.equal(submit().props.disabled,true);}
 await act(async()=>input().props.onChange({target:{value:'138'}}));assert.equal(t.f.state.chest,'138');assert.equal(submit().props.disabled,false);await act(async()=>input().props.onBlur());assert.equal(input().props.value,'138');
 await act(async()=>input().props.onChange({target:{value:'999'}}));assert.equal(t.f.state.chest,'138');await act(async()=>input().props.onBlur());assert.equal(t.f.state.chest,'143');await act(async()=>input().props.onChange({target:{value:''}}));assert.equal(submit().props.disabled,true);await act(async()=>input().props.onBlur());assert.equal(input().props.value,'143');
 await act(async()=>input().props.onChange({target:{value:'1'}}));const range=t.nodes().find(n=>n.props.type==='range'&&n.props['aria-label']==='バスト/胸囲スライダー')!;await act(async()=>range.props.onChange({target:{value:'100'}}));assert.equal(input().props.value,'100');assert.equal(submit().props.disabled,false);assert.equal(t.f.generates,0);
 }finally{await t.close();}
});
test('body legacy4 does not infer custom mode; explicit current preset/custom choice and locked numeric state are safe',async()=>{
 const t=await fixture('body-shape',false,false,true);try{const before=structuredClone(t.f.state);assert(!Object.hasOwn(before,'customBody'));assert.equal(t.nodes().filter(n=>n.props.type==='number').length,0);assert.equal(t.nodes().find(n=>n.props['data-testid']==='heavy-model-tool-generate')!.props.disabled,true);const preset=t.nodes().find(n=>n.type==='button'&&text(n)==='体型プリセット')!;await t.click(preset);assert.deepEqual(t.f.state,{...before,customBody:false});assert.equal(t.f.generates,0);}finally{await t.close();}
 const u=await fixture('body-shape',false,false,true);let initialized:any;try{await u.click(u.nodes().find(n=>n.type==='button'&&text(n)==='カスタムボディ')!);assert.equal(u.f.state.chest,'79');assert.equal(u.f.state.waist,'26');initialized=structuredClone(u.f.state);}finally{await u.close();}
 const v=await fixture('body-shape',true,false,false,initialized);try{for(const n of v.nodes().filter(n=>n.props.type==='number'||n.props.type==='range')){assert.equal(n.props.disabled,true);await act(async()=>n.props.onChange({target:{value:'100'}}));}assert.equal(v.f.writes,0);assert.deepEqual(v.f.state,initialized);}finally{await v.close();}
});

for(const feature of ['pose-change','background-change'])test(`${feature}: legacy2 ratio/res readable, prior mode unavailable, explicit draft choice only; locked choice stays inert`,async()=>{
 const t=await fixture(feature,false,false,true);try{assert.deepEqual(t.f.state,{aspectRatio:'4:5',resolution:'2K'});assert(text(t.trigger('画像比率')).includes('4:5'));assert(text(t.trigger('解像度')).includes('2K'));const modes=t.nodes().filter(n=>n.type==='button'&&['参考画像','カスタム'].includes(text(n)));assert.equal(modes.length,2);assert(modes.every(n=>n.props['aria-pressed']===false));assert.equal(t.nodes().filter(n=>n.type==='textarea').length,0);assert.equal(t.nodes().filter(n=>n.type==='input'&&n.props.type==='file').length,1);await t.click(modes.find(n=>text(n)==='カスタム')!);assert.deepEqual(t.f.state,{aspectRatio:'4:5',resolution:'2K',inputMode:'custom',customDescription:''});assert.equal(t.f.generates,0);}finally{await t.close();}
 const u=await fixture(feature,true,false,true);try{for(const n of u.nodes().filter(n=>n.type==='button'&&['参考画像','カスタム'].includes(text(n)))){assert.equal(n.props.disabled,true);await u.click(n);}assert.deepEqual(u.f.state,{aspectRatio:'4:5',resolution:'2K'});assert.equal(u.f.writes,0);}finally{await u.close();}
});
