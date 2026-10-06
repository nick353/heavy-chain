/** Immutable mapping from frozen stage through the actually rendered 512px
 * preparation, then uniform contain into the OpenAI output canvas. */
export type ProtectedOpenAIProjectionProof = {
  version:'protected-openai-contain-v1';digestScheme:'sha256-data-url-utf8-v1';
  stage:{width:number;height:number;primaryDigest:string;guideDigest:string;maskDigest:string};
  prepared:{width:number;height:number;primaryDigest:string;guideDigest:string;transform:{x:0;y:0;scaleX:number;scaleY:number}};
  candidate:{width:number;height:number};
  contain:{x:number;y:number;scale:number};
  projected:{primaryDigest:string;guideDigest:string};
};
export type ProtectedOpenAIProjectionPayload = ProtectedOpenAIProjectionProof & {primaryDataUrl:string;guideDataUrl:string};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const size=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=4096;
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
function invalid():never{throw new Error('protected_openai_projection_invalid');}
export function validateProtectedOpenAIProjection(value:unknown,plan?:{sourceWidth:unknown;sourceHeight:unknown;sourceSha256:unknown;maskSha256:unknown}):ProtectedOpenAIProjectionProof {
 if(!obj(value)||value.version!=='protected-openai-contain-v1'||value.digestScheme!=='sha256-data-url-utf8-v1'||!obj(value.stage)||!obj(value.prepared)||!obj(value.candidate)||!obj(value.contain)||!obj(value.projected)||!obj(value.prepared.transform))invalid();
 const s=value.stage,p=value.prepared,c=value.candidate,t=p.transform as Record<string,unknown>,o=value.contain,r=value.projected;
 if(![s.width,s.height,p.width,p.height,c.width,c.height].every(size)||Number(p.width)>512||Number(p.height)>512||![s.primaryDigest,s.guideDigest,s.maskDigest,p.primaryDigest,p.guideDigest,r.primaryDigest,r.guideDigest].every(hash))invalid();
 if(![t.x,t.y,t.scaleX,t.scaleY,o.x,o.y,o.scale].every(v=>typeof v==='number'&&Number.isFinite(v)))invalid();
 if(t.x!==0||t.y!==0||t.scaleX!==Number(p.width)/Number(s.width)||t.scaleY!==Number(p.height)/Number(s.height))invalid();
 const expected=Number(p.width)>Number(p.height)?[1536,1024]:Number(p.height)>Number(p.width)?[1024,1536]:[1024,1024];
 const scale=Math.min(Number(c.width)/Number(p.width),Number(c.height)/Number(p.height));
 if(c.width!==expected[0]||c.height!==expected[1]||o.scale!==scale||Math.abs(Number(o.x)-(Number(c.width)-Number(p.width)*scale)/2)>1e-7||Math.abs(Number(o.y)-(Number(c.height)-Number(p.height)*scale)/2)>1e-7)invalid();
 if(plan&&(s.width!==plan.sourceWidth||s.height!==plan.sourceHeight||s.primaryDigest!==plan.sourceSha256||s.maskDigest!==plan.maskSha256))invalid();
 return {version:'protected-openai-contain-v1',digestScheme:'sha256-data-url-utf8-v1',stage:{width:Number(s.width),height:Number(s.height),primaryDigest:String(s.primaryDigest),guideDigest:String(s.guideDigest),maskDigest:String(s.maskDigest)},prepared:{width:Number(p.width),height:Number(p.height),primaryDigest:String(p.primaryDigest),guideDigest:String(p.guideDigest),transform:{x:0,y:0,scaleX:Number(t.scaleX),scaleY:Number(t.scaleY)}},candidate:{width:Number(c.width),height:Number(c.height)},contain:{x:Number(o.x),y:Number(o.y),scale:Number(o.scale)},projected:{primaryDigest:String(r.primaryDigest),guideDigest:String(r.guideDigest)}};
}
export async function validateProtectedOpenAIProjectionPayload(value:unknown,plan?:Parameters<typeof validateProtectedOpenAIProjection>[1]):Promise<ProtectedOpenAIProjectionPayload>{
 const proof=validateProtectedOpenAIProjection(value,plan);const payload=value as ProtectedOpenAIProjectionPayload;
 const digest=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),n=>n.toString(16).padStart(2,'0')).join('');
 for(const [url,expected] of [[payload.primaryDataUrl,proof.projected.primaryDigest],[payload.guideDataUrl,proof.projected.guideDigest]]){
  if(typeof url!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)||await digest(url)!==expected)invalid();
  const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));if(bytes.length<24||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')invalid();const view=new DataView(bytes.buffer);
  if(view.getUint32(16)!==proof.candidate.width||view.getUint32(20)!==proof.candidate.height)invalid();
 }
 return {...proof,primaryDataUrl:payload.primaryDataUrl,guideDataUrl:payload.guideDataUrl};
}
export function protectedOpenAIProjectionProof(payload:ProtectedOpenAIProjectionPayload):ProtectedOpenAIProjectionProof{
 return validateProtectedOpenAIProjection(payload);
}

/** Only actually submitted prepared/projected bytes are server-verifiable.
 * Stage and mask digests remain declared frontend identities in this contract. */
export async function verifyProtectedOpenAIProjectionRequest(value:unknown,body:Record<string,unknown>) {
 const plan=body.protectedEdit as {sourceWidth:unknown;sourceHeight:unknown;sourceSha256:unknown;maskSha256:unknown;guideIndex:number};
 const payload=await validateProtectedOpenAIProjectionPayload(value,plan);const urls=body.imageUrls as string[];
 const transforms=body.referenceTransforms as Array<Record<string,unknown>>;
 const a=transforms?.[0],b=transforms?.[plan.guideIndex];
 const t=payload.prepared.transform;
 if(!a||!b||['sourceWidth','sourceHeight','width','height'].some(k=>a[k]!==b[k])||a.sourceWidth!==payload.stage.width||a.sourceHeight!==payload.stage.height||a.width!==payload.prepared.width||a.height!==payload.prepared.height
   ||a.index!==0||b.index!==plan.guideIndex||JSON.stringify(a.renderingTransform)!==JSON.stringify(t)||JSON.stringify(b.renderingTransform)!==JSON.stringify(t))invalid();
 const digest=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),n=>n.toString(16).padStart(2,'0')).join('');
 if(!Array.isArray(urls)||await digest(urls[0])!==payload.prepared.primaryDigest||await digest(urls[plan.guideIndex])!==payload.prepared.guideDigest)invalid();
 return payload;
}
