import {protectedImageDigest} from './protectedImageEditContract';
import {validateProtectedOpenAIProjectionPayload,protectedOpenAIProjectionProof,type ProtectedOpenAIProjectionPayload} from './protectedOpenAIProjection';
import {validateNativePrintFinalFrame,type NativePrintFinalFrame} from './nativePrintFinalFrame';
import type {PreparedProtectedCloudflareEdit} from './cloudflareProtectedImageEdit';
import {nativePrintFinalFrameFor} from './materialProtectedComposite';
const load=(url:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('protected_openai_projection_decode_failed'));image.src=url;});
/** Uses the actual drawImage dimensions recorded at preparation, including the
 * independently rounded axes. The frozen stage image/layout is never rewritten. */
export async function prepareProtectedOpenAIProjection(prepared:PreparedProtectedCloudflareEdit,body:Record<string,unknown>):Promise<{body:Record<string,unknown>;projection:ProtectedOpenAIProjectionPayload;native:NativePrintFinalFrame}>{
 const urls=body.imageUrls as string[];const transforms=body.referenceTransforms as Array<Record<string,number>&{renderingTransform?:{x:number;y:number;scaleX:number;scaleY:number}}>;
 const guideIndex=prepared.plan.guideIndex;const t=transforms?.[0],g=transforms?.[guideIndex];
 if(!t||!g||!t.renderingTransform||!g.renderingTransform||JSON.stringify(t.renderingTransform)!==JSON.stringify(g.renderingTransform)||t.renderingTransform.x!==0||t.renderingTransform.y!==0||t.renderingTransform.scaleX!==t.width/t.sourceWidth||t.renderingTransform.scaleY!==t.height/t.sourceHeight||t.index!==0||g.index!==guideIndex||t.sourceWidth!==prepared.plan.sourceWidth||t.sourceHeight!==prepared.plan.sourceHeight||['sourceWidth','sourceHeight','width','height'].some(k=>t[k]!==g[k]))throw new Error('protected_openai_preparation_transform_missing');
 const [primary,guide]=await Promise.all([load(urls[0]),load(urls[guideIndex])]);
 if(primary.naturalWidth!==t.width||primary.naturalHeight!==t.height||guide.naturalWidth!==t.width||guide.naturalHeight!==t.height)throw new Error('protected_openai_prepared_pair_geometry_mismatch');
 const [width,height]=t.width>t.height?[1536,1024]:t.height>t.width?[1024,1536]:[1024,1024];
 const scale=Math.min(width/t.width,height/t.height),x=(width-t.width*scale)/2,y=(height-t.height*scale)/2;
 const render=(image:HTMLImageElement)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('protected_openai_projection_canvas_unavailable');
  // Opaque black guide padding means protected under the established convention.
  context.fillStyle='#000';context.fillRect(0,0,width,height);context.drawImage(image,0,0,t.width,t.height,x,y,t.width*scale,t.height*scale);return canvas.toDataURL('image/png');};
 const primaryDataUrl=render(primary),guideDataUrl=render(guide);
 const stageGuide=(prepared.body.imageUrls as string[])[guideIndex];
 const projection:ProtectedOpenAIProjectionPayload={version:'protected-openai-contain-v1',digestScheme:'sha256-data-url-utf8-v1',stage:{width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight,primaryDigest:prepared.plan.sourceSha256,maskDigest:prepared.plan.maskSha256,guideDigest:await protectedImageDigest(stageGuide)},
  prepared:{width:t.width,height:t.height,primaryDigest:await protectedImageDigest(urls[0]),guideDigest:await protectedImageDigest(urls[guideIndex]),transform:{x:0,y:0,scaleX:t.width/t.sourceWidth,scaleY:t.height/t.sourceHeight}},
  candidate:{width,height},contain:{x,y,scale},projected:{primaryDigest:await protectedImageDigest(primaryDataUrl),guideDigest:await protectedImageDigest(guideDataUrl)},primaryDataUrl,guideDataUrl};
 await validateProtectedOpenAIProjectionPayload(projection,prepared.plan);
 const base=prepared.nativePrintFrameBinding ? await nativePrintFinalFrameFor(prepared.nativePrintFrameBinding) : {version:'native-print-contain-v1',original:{width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight,digest:prepared.plan.sourceSha256,digestScheme:'sha256-data-url-utf8-v1'},stage:{width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight,primaryDigest:prepared.plan.sourceSha256,maskDigest:prepared.plan.maskSha256},frame:{x:0,y:0,width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight},printingSnapshotDigest:await protectedImageDigest(JSON.stringify([])),candidateGeometry:{version:'stage-frame-v1',width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight}};
 const native=validateNativePrintFinalFrame({...base,version:'native-print-openai-contain-v1',mapping:protectedOpenAIProjectionProof(projection),candidateGeometry:{version:'openai-output-frame-v1',width,height}},prepared.plan);
 return {body:{...body,width,height,protectedOpenAIProjection:projection,nativePrintFinalFrame:native},projection,native};
}
