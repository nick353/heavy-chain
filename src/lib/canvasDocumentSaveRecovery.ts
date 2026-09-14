import { validateCanvasDocumentSnapshot } from './canvasDocumentPersistence.ts';
import type {CanvasDocumentRecord,CanvasDocumentSnapshot} from './canvasDocumentPersistence.ts';

export type CanvasSaveScope = {origin:string;userId:string;brandId:string};
export type CanvasSaveContent = {title:string;snapshot:CanvasDocumentSnapshot};
type PendingWrite = CanvasSaveContent & {writeId:string;kind:'create'|'update';expectedRevision:number|null};
export type CanvasSaveRecovery = CanvasSaveContent & {
  version:1;scope:CanvasSaveScope;documentId:string;ownerId:string;revision:number|null;
  pending:PendingWrite|null;updatedAt:string;
};
export type CanvasSaveTransport = {
  get(documentId:string):Promise<CanvasDocumentRecord>;
  create(documentId:string,content:CanvasSaveContent):Promise<CanvasDocumentRecord>;
  update(documentId:string,revision:number,content:CanvasSaveContent):Promise<CanvasDocumentRecord>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CACHE_CHARS=2*1024*1024;
const pendingLocks=new Map<string,Promise<unknown>>();
const storage=()=>{if(typeof window==='undefined')throw new Error('canvas_save_storage_unavailable');return window.localStorage;};
const sameScope=(a:CanvasSaveScope,b:CanvasSaveScope)=>a.origin===b.origin&&a.userId===b.userId&&a.brandId===b.brandId;
const revisionValid=(value:unknown)=>value===null||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);
const contentValid=(value:unknown):value is CanvasSaveContent=>{
  const v=value as CanvasSaveContent|undefined;
  return !!v&&typeof v.title==='string'&&v.title.length<=160&&!!v.snapshot&&v.snapshot.version===1&&Array.isArray(v.snapshot.objects);
};
const validateContent=(content:CanvasSaveContent)=>validateCanvasDocumentSnapshot(content.snapshot);
// Older Canvas snapshots may serialize empty relationship fields as `null`,
// while the current serializer omits those optional fields. Treat the two
// representations as the same durable content so a readback does not turn a
// confirmed document into a false unsaved/conflict state.
const comparableSnapshot=(snapshot:CanvasDocumentSnapshot)=>({
  ...snapshot,
  objects:snapshot.objects.map((object)=>{
    const comparable={...object};
    if(comparable.parentId==null)delete comparable.parentId;
    if(comparable.derivedFrom==null)delete comparable.derivedFrom;
    return comparable;
  }),
});
export const sameCanvasSaveContent=(a:CanvasSaveContent,b:CanvasSaveContent)=>
  a.title===b.title&&JSON.stringify(comparableSnapshot(a.snapshot))===JSON.stringify(comparableSnapshot(b.snapshot));

export function canvasSaveRecoveryKey(scope:CanvasSaveScope,documentId:string) {
  if(!scope.origin||!scope.userId||!scope.brandId||!UUID.test(documentId))throw new Error('canvas_save_scope_invalid');
  return ['heavy-chain-canvas:save:v1',scope.origin,scope.userId,scope.brandId,documentId].map(encodeURIComponent).join(':');
}

/** A pre-existing local project always maps to the same app/user/brand-bound
 * document ID. Fresh, unrelated blank canvases still get separate random IDs. */
export async function initialCanvasDocumentId(scope:CanvasSaveScope,localProjectId:string|null) {
  if(!localProjectId)return crypto.randomUUID();
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
    JSON.stringify(['heavy-canvas-document-v1',scope.origin,scope.userId,scope.brandId,localProjectId]))));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function readCanvasSaveRecovery(scope:CanvasSaveScope,documentId:string):CanvasSaveRecovery|null {
  const raw=storage().getItem(canvasSaveRecoveryKey(scope,documentId));if(!raw)return null;
  if(raw.length>MAX_CACHE_CHARS)throw new Error('canvas_save_cache_invalid');
  let value:CanvasSaveRecovery;
  try{value=JSON.parse(raw);}catch{throw new Error('canvas_save_cache_invalid');}
  if(!value||value.version!==1||!value.scope||!sameScope(value.scope,scope)||value.documentId!==documentId||typeof value.ownerId!=='string'||!value.ownerId||
    !revisionValid(value.revision)||!contentValid(value)||!(value.pending===null||(contentValid(value.pending)&&UUID.test(value.pending.writeId)&&
      (value.pending.kind==='create'?value.pending.expectedRevision===null:value.pending.kind==='update'&&value.pending.expectedRevision!==null&&revisionValid(value.pending.expectedRevision))))) {
    throw new Error('canvas_save_cache_invalid');
  }
  return value;
}

function writeRecovery(entry:CanvasSaveRecovery) {
  const key=canvasSaveRecoveryKey(entry.scope,entry.documentId);const raw=JSON.stringify({...entry,updatedAt:new Date().toISOString()});
  if(raw.length>MAX_CACHE_CHARS)throw new Error('canvas_save_cache_too_large');
  storage().setItem(key,raw);
  if(storage().getItem(key)!==raw)throw new Error('canvas_save_cache_readback_failed');
  return readCanvasSaveRecovery(entry.scope,entry.documentId)!;
}

export function retainCanvasSaveDraft(scope:CanvasSaveScope,documentId:string,content:CanvasSaveContent,
  base?:{ownerId:string;revision:number|null}):CanvasSaveRecovery {
  if(!contentValid(content))throw new Error('canvas_save_content_invalid');
  const existing=readCanvasSaveRecovery(scope,documentId);
  if(!existing&&!base)throw new Error('canvas_save_recovery_missing');
  if(existing&&base&&existing.ownerId!==base.ownerId)throw new Error('canvas_save_owner_changed');
  // Working edits do not replace the immutable body of an uncertain request.
  return writeRecovery(existing?{...existing,...content}:{version:1,scope,documentId,...base!,...content,pending:null,updatedAt:''});
}

/** Used only for the explicit "reload latest" action, not automatic recovery
 * of a dirty draft. The caller checks its live user/brand/route fence first. */
export function acceptCanvasRemoteVersion(scope:CanvasSaveScope,document:CanvasDocumentRecord) {
  const existing=readCanvasSaveRecovery(scope,document.id);
  const entry:CanvasSaveRecovery=existing??{version:1,scope,documentId:document.id,ownerId:document.ownerId,revision:null,pending:null,
    title:document.title,snapshot:document.snapshot,updatedAt:''};
  assertDocument(scope,entry,document);
  return writeRecovery({...entry,title:document.title,snapshot:document.snapshot,revision:document.revision,pending:null});
}

function assertDocument(scope:CanvasSaveScope,entry:CanvasSaveRecovery,document:CanvasDocumentRecord) {
  if(document.id!==entry.documentId||document.brandId!==scope.brandId||document.ownerId!==entry.ownerId||
    !Number.isSafeInteger(document.revision)||document.revision<0||!contentValid(document))throw new Error('canvas_document_readback_mismatch');
}
const isMissing=(error:unknown)=>error instanceof Error&&/^cloudflare_api_404_not_found$/.test(error.message);
const isInvalidRequest=(error:unknown)=>error instanceof Error&&error.message==='cloudflare_api_400_invalid_canvas_document';
async function getOrMissing(transport:CanvasSaveTransport,id:string,assertCurrent:()=>void) {
  assertCurrent();
  try{const document=await transport.get(id);assertCurrent();return document;}
  catch(error){assertCurrent();if(isMissing(error))return null;throw error;}
}
const matchesPending=(entry:CanvasSaveRecovery,document:CanvasDocumentRecord)=>!!entry.pending&&
  sameCanvasSaveContent(entry.pending,document)&&
  (entry.pending.kind==='create'?document.revision===0:document.revision===entry.pending.expectedRevision!+1);

function settle(scope:CanvasSaveScope,entry:CanvasSaveRecovery,document:CanvasDocumentRecord) {
  const latest=readCanvasSaveRecovery(scope,entry.documentId);
  if(!latest||latest.ownerId!==entry.ownerId||latest.pending?.writeId!==entry.pending?.writeId)throw new Error('canvas_save_recovery_changed');
  // Preserve working edits made while the request/readback was outstanding.
  return writeRecovery({...latest,revision:document.revision,pending:null});
}

export async function inspectCanvasSaveRecovery(options:{scope:CanvasSaveScope;documentId:string;transport:CanvasSaveTransport;assertCurrent:()=>void}) {
  const {scope,documentId,transport,assertCurrent}=options;assertCurrent();
  return withSaveLock(canvasSaveRecoveryKey(scope,documentId),async()=>{
  assertCurrent();readCanvasSaveRecovery(scope,documentId);
  const document=await getOrMissing(transport,documentId,assertCurrent);
  // A user can keep editing while this GET is outstanding. Only the current
  // working draft may be reconciled; never write back its pre-GET snapshot.
  let entry=readCanvasSaveRecovery(scope,documentId);
  if(!entry)return{entry:null,document,state:document?'saved' as const:'missing' as const};
  if(entry.pending)validateContent(entry.pending);
  if(!document)return{entry,document:null,state:entry.revision===null?'draft' as const:'conflict' as const};
  assertDocument(scope,entry,document);
  if(entry.pending) {
    if(matchesPending(entry,document))entry=settle(scope,entry,document);
    else if(entry.pending.kind==='create'||document.revision!==entry.pending.expectedRevision)return{entry,document,state:'conflict' as const};
  } else if(entry.revision!==document.revision&&!sameCanvasSaveContent(entry,document))return{entry,document,state:'conflict' as const};
  if(!entry.pending&&sameCanvasSaveContent(entry,document))entry=writeRecovery({...entry,revision:document.revision});
  return{entry,document,state:!entry.pending&&sameCanvasSaveContent(entry,document)?'saved' as const:'draft' as const};
  });
}

async function withSaveLock<T>(key:string,run:()=>Promise<T>):Promise<T> {
  const previous=pendingLocks.get(key)??Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request(key,async()=>await run());
    return await run();
  });
  pendingLocks.set(key,task);
  try{return await task;}finally{if(pendingLocks.get(key)===task)pendingLocks.delete(key);}
}

/** Only an explicit Save calls this function. A page load uses inspect above
 * and never dispatches a POST/PATCH. There is no auth-refresh write replay. */
export async function saveCanvasDocumentRecoverably(options:{
  scope:CanvasSaveScope;documentId:string;ownerId:string;expectedRevision:number|null;content:CanvasSaveContent;
  transport:CanvasSaveTransport;assertCurrent:()=>void;
}):Promise<CanvasDocumentRecord> {
  const {scope,documentId,ownerId,expectedRevision,transport,assertCurrent}=options;
  // Copy the click-time body before any asynchronous work. Later working
  // edits are retained separately and are never silently included in this save.
  const desired=JSON.parse(JSON.stringify(options.content)) as CanvasSaveContent;
  validateContent(desired);
  assertCurrent();retainCanvasSaveDraft(scope,documentId,desired,{ownerId,revision:expectedRevision});
  return withSaveLock(canvasSaveRecoveryKey(scope,documentId),async()=>{
    assertCurrent();
    let entry=readCanvasSaveRecovery(scope,documentId)!;
    if(entry.pending)validateContent(entry.pending);
    let document=await getOrMissing(transport,documentId,assertCurrent);
    if(document)assertDocument(scope,entry,document);
    const dispatch=async(pending:PendingWrite)=>{
      validateContent(pending);
      assertCurrent();
      entry=writeRecovery({...readCanvasSaveRecovery(scope,documentId)!,pending});
      assertCurrent();
      try {
        validateContent(pending);
        const response=pending.kind==='create'?await transport.create(documentId,pending):await transport.update(documentId,pending.expectedRevision!,pending);
        assertCurrent();assertDocument(scope,entry,response);
      } catch(error) {
        assertCurrent();
        // Observe the exact destination after every uncertain response. A
        // second write is never dispatched in this catch path.
        const recovered=await getOrMissing(transport,documentId,assertCurrent);
        if(recovered)assertDocument(scope,entry,recovered);
        if(isInvalidRequest(error)&&(pending.kind==='create'?!recovered:recovered?.revision===pending.expectedRevision)) {
          const latest=readCanvasSaveRecovery(scope,documentId);
          if(!latest||latest.pending?.writeId!==pending.writeId)throw new Error('canvas_save_recovery_changed');
          // This exact server validation error is before SQL. An unchanged
          // destination also proves no commit: let a later explicit Save use
          // corrected input, retaining the same ID and current working edits.
          writeRecovery({...latest,pending:null});throw error;
        }
        if(!recovered)throw error;assertDocument(scope,entry,recovered);
        if(!matchesPending(entry,recovered))throw new Error('canvas_save_conflict');
        entry=settle(scope,entry,recovered);return recovered;
      }
      const readback=await getOrMissing(transport,documentId,assertCurrent);
      if(!readback)throw new Error('canvas_save_readback_missing');assertDocument(scope,entry,readback);
      if(!matchesPending(entry,readback))throw new Error('canvas_save_conflict');
      entry=settle(scope,entry,readback);return readback;
    };
    const hadPending=!!entry.pending;
    if(entry.pending) {
      if(document&&matchesPending(entry,document))entry=settle(scope,entry,document);
      else if(entry.pending.kind==='create'?!document:!!document&&document.revision===entry.pending.expectedRevision)document=await dispatch(entry.pending);
      else throw new Error('canvas_save_conflict');
    }
    if(document&&sameCanvasSaveContent(desired,document)) {
      entry=writeRecovery({...readCanvasSaveRecovery(scope,documentId)!,revision:document.revision});return document;
    }
    const revision=hadPending?entry.revision:expectedRevision??entry.revision;
    if(document&&(revision===null||document.revision!==revision))throw new Error('canvas_save_conflict');
    if(!document&&revision!==null)throw new Error('canvas_save_remote_missing');
    const pending:PendingWrite={...desired,writeId:crypto.randomUUID(),kind:document?'update':'create',expectedRevision:document?.revision??null};
    return dispatch(pending);
  });
}
