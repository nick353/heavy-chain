// One-shot real provider probe using the PRODUCT multipart and raster contract.
// Only new synthetic/product-owned fixtures; not production app auth/E2E proof.
import { readFile, writeFile, open, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_MODEL, parseImageInput, modelMultipart, decodeImage, sha256, imageEstimate } from '../src/image-ai-contracts.ts';
const [action,inputPath,reportPath,...referencePaths]=process.argv.slice(2);
if (!['generate-image','edit-image','model-matrix'].includes(action) || !inputPath?.startsWith('/') || !reportPath?.startsWith('/') || referencePaths.some(p=>!p.startsWith('/'))) throw Error('usage: ACTION ABS_INPUT_JSON ABS_NEW_REPORT_JSON [ABS_REFERENCE_IMAGES...]');
const body=JSON.parse(await readFile(inputPath,'utf8'));
const refs=[];
for (const file of referencePaths) {
  const bytes=await readFile(file); const image=decodeImage(bytes.toString('base64'));
  refs.push(`data:${image.contentType};base64,${bytes.toString('base64')}`);
}
if (action==='model-matrix' && refs.length) { body.imageUrl=refs[0]; body.modelReferenceImageUrl=refs[1]; }
else if (refs.length) body.imageUrls=refs;
const input=parseImageInput(action,body);
if (input.candidates.length!==1) throw Error('live_probe_requires_exactly_one_candidate');
const multipart=modelMultipart(input,input.candidates[0]);
const account='ffa9a931fec21b22273fd2c311bb771d';
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${IMAGE_MODEL}`;
const config=await readFile('/Users/nichikatanaka/Library/Preferences/.wrangler/config/default.toml','utf8');
const token=/oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1]; if(!token) throw Error('existing_wrangler_oauth_unavailable');
await mkdir(path.dirname(reportPath),{recursive:true});
const marker=await open(reportPath,'wx'); await marker.close();
const report={action,model:IMAGE_MODEL,account,endpoint,inputPath,referencePaths,startedAt:new Date().toISOString(),status:'dispatch_pending',
  inputSHA256:await sha256(JSON.stringify(body)),candidateSeed:input.candidates[0].seed,
  scope:'real provider synthetic-fixture contract/visual QA, not authenticated production app or persistence proof'};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n'); const started=Date.now();
try {
  const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':multipart.contentType},body:multipart.body,duplex:'half',signal:AbortSignal.timeout(110000)});
  const raw=await response.text();
  const rawPath=reportPath.replace(/\.json$/,'.provider.json');
  await writeFile(rawPath,raw,{flag:'wx'});
  let payload; try{payload=JSON.parse(raw);}catch{payload={};}
  Object.assign(report,{httpStatus:response.status,providerRequestId:response.headers.get('cf-ray'),latencyMs:Date.now()-started,completedAt:new Date().toISOString(),
    providerSuccess:payload.success,errors:payload.errors??null,rawPath,rawSHA256:await sha256(raw),status:'provider_or_contract_failed',usageEstimate:null});
  if(response.ok && payload.success && typeof payload.result?.image==='string') {
    const image=decodeImage(payload.result.image,false);
    const imagePath=reportPath.replace(/\.json$/,image.contentType==='image/png'?'.png':'.jpg');
    await writeFile(imagePath,image.bytes,{flag:'wx'});
    Object.assign(report,{imagePath,imageSHA256:await sha256(image.bytes),bytes:image.bytes.length,width:image.width,height:image.height,
      usageEstimate:{...imageEstimate(input),billing:'estimate_not_invoice'},status:image.width===input.width&&image.height===input.height?'inference_and_raster_contract_pass':'provider_dimensions_mismatch'});
  }
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
  if(report.status!=='inference_and_raster_contract_pass')process.exitCode=1;
} catch(error) {
  Object.assign(report,{status:report.httpStatus?'response_recorded_contract_or_artifact_error':'outcome_unknown_do_not_replay',latencyMs:Date.now()-started,completedAt:new Date().toISOString(),errorClass:error?.name??'Error'});
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=2;
}
