// Local, synthetic browser verification only. No provider credentials, remote
// auth, production data, or model requests. Open the printed URL with the
// selected browser surface; keep the server alive across the explicit reload.
import {createServer} from 'vite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installPrintInputProbe} from './browser/print-input-probe-server.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.HEAVY_MASK_PROBE_PORT||'4176');
const origin=`http://127.0.0.1:${port}`;
const output=process.env.HEAVY_MASK_PROBE_REPORT_DIR;
const ui=process.env.HEAVY_MASK_PROBE_UI==='true';
const canvasSave=process.env.HEAVY_CANVAS_SAVE_PROBE==='true';
const printInput=process.env.HEAVY_PRINT_INPUT_PROBE==='true';
const canvasRuns=new Map();
const requests=new Map(),saves=new Map();
const counts={providerPosts:0,inferences:0,receiptReads:0,savePosts:0,saveReads:0};
const report={status:'not_started'};
const optimizeDeps=printInput?{entries:['scripts/browser/print-input-probe.tsx'],holdUntilCrawlEnd:true}:undefined;
const vite=await createServer({root,configFile:false,envFile:false,appType:'custom',
  define:ui?{'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED':'"true"','import.meta.env.VITE_CLOUDFLARE_API_ENABLED':'"true"','import.meta.env.VITE_CLOUDFLARE_API_BASE_URL':'"https://canvas-probe.invalid"'}:{},
  ...(optimizeDeps?{optimizeDeps}:{}),
  esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port,strictPort:true}});
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
if(printInput)installPrintInputProbe(vite,{root,origin,output});
vite.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,origin);
  if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'probe_origin_forbidden'});
  if(ui&&canvasSave&&(url.pathname==='/__canvas-save-probe'||url.pathname.startsWith('/canvas/'))){
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    return res.end(readFileSync(root+'/scripts/browser/canvas-save-reload-probe.html','utf8'));
  }
  if(ui&&url.pathname==='/__canvas-recovery-probe'){
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    return res.end(readFileSync(root+'/scripts/browser/canvas-recovery-probe.html','utf8'));
  }
  if(!url.pathname.startsWith('/__protected-probe')&&!url.pathname.startsWith('/__canvas-save-api/'))return next();
  try {
    if(url.pathname==='/__protected-probe'){
      res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
      return res.end(readFileSync(root+'/scripts/browser/protected-edit-probe.html','utf8'));
    }
    if(url.pathname==='/__protected-probe/state')return json(res,200,{counts,report});
    let body;if(req.method==='POST'||req.method==='PATCH'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>48*1024*1024)throw new Error('probe_body_too_large');chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks));}
    if(canvasSave&&url.pathname.startsWith('/__canvas-save-api/')){
      const [, ,runId,action]=url.pathname.split('/');
      if(!/^[0-9a-f-]{36}$/i.test(runId??''))return json(res,400,{error:'probe_run_invalid'});
      let run=canvasRuns.get(runId);
      if(action==='bootstrap'&&req.method==='POST'&&!run){run={fixture:body,document:null,creates:0,updates:0,reads:0,resumes:0,acks:0,pending:true,outage:false,mounts:0,mountWrites:[]};canvasRuns.set(runId,run);}
      if(!run)return json(res,404,{error:'not_found'});
      if(action==='bootstrap'){run.mounts++;run.outage=false;run.mountWrites.push([run.creates,run.updates]);return json(res,200,run);}
      if(action==='state')return json(res,200,run);
      if(action==='resume'){run.resumes++;return json(res,200,run);}
      if(action==='ack'){
        if(!run.document||run.document.revision<2||run.reads<3)return json(res,409,{error:'probe_early_ack'});
        run.acks++;run.pending=false;return json(res,200,run);
      }
      if(action==='document'&&req.method==='GET'){
        run.reads++;if(run.outage)return json(res,503,{error:'probe_readback_outage'});
        return json(res,run.document?200:404,run.document??{error:'not_found'});
      }
      if(action==='document'&&req.method==='POST'){
        run.creates++;
        if(run.document)return json(res,409,{error:'probe_duplicate_create'});
        run.document={id:body.id,ownerId:run.fixture.userId,brandId:run.fixture.brandId,title:body.title,snapshot:body.snapshot,snapshotVersion:1,revision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        run.outage=true;return json(res,503,{error:'probe_create_response_lost'});
      }
      if(action==='document'&&req.method==='PATCH'){
        run.updates++;
        if(body.documentId!==run.document?.id||body.expected_revision!==run.document.revision)return json(res,409,{error:'probe_revision_conflict'});
        run.document={...run.document,title:body.title,snapshot:body.snapshot,revision:run.document.revision+1,updatedAt:new Date().toISOString()};
        return json(res,run.updates===1?503:200,run.updates===1?{error:'probe_update_response_lost'}:run.document);
      }
      if(action==='report'){
        const final={...body,server:{creates:run.creates,updates:run.updates,reads:run.reads,resumes:run.resumes,acks:run.acks,mounts:run.mounts,mountWrites:run.mountWrites,documentId:run.document?.id,revision:run.document?.revision},at:new Date().toISOString()};
        if(output){mkdirSync(output,{recursive:true});writeFileSync(resolve(output,`${runId}-canvas-save-reload.json`),JSON.stringify(final,null,2)+'\n',{flag:'wx'});}
        run.report=final;process.stdout.write(JSON.stringify({canvasSaveReport:final})+'\n');return json(res,200,{ok:true});
      }
      return json(res,404,{error:'probe_canvas_route_missing'});
    }
    if(url.pathname.endsWith('/report')&&req.method==='POST'){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.runId??'')||
        !['initial','reload','canvas-ui'].includes(body?.phase))return json(res,400,{error:'probe_report_identity_invalid'});
      Object.assign(report,body,{counts:{...counts}});
      if(output){mkdirSync(output,{recursive:true});writeFileSync(resolve(output,`${body.runId}-${body.phase}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
      process.stdout.write(JSON.stringify({probeReport:report})+'\n');return json(res,200,{ok:true});
    }
    if(url.pathname.endsWith('/provider-actions/edit-image')){
      counts.providerPosts++;const id=req.headers['idempotency-key'];
      if(!requests.has(id)){counts.inferences++;requests.set(id,{...body.fixtureReceipt,requestId:id,jobId:'ai-'+id,images:[{...body.fixtureReceipt.images[0],imageId:`ai-${id}-0`,storagePath:`generated-images/ai-${id}-0`,jobId:'ai-'+id}],metadata:body.fixtureMetadata});}
      return json(res,200,requests.get(id));
    }
    if(url.pathname.includes('/image-ai/requests/')){counts.receiptReads++;const value=requests.get(url.pathname.split('/').at(-1));return json(res,value?200:404,value??{error:'image_request_not_found'});}
    if(url.pathname.endsWith('/workspace-artifacts')&&req.method==='POST'){
      counts.savePosts++;if(counts.savePosts===1)return json(res,503,{error:'fixture_final_save_outage'});
      saves.set(body.requestId,{success:true,remote:{jobId:'wa-'+body.requestId,imageId:'wa-'+body.requestId,storagePath:'generated-images/wa-'+body.requestId},metadata:body.metadata,imageUrl:body.imageUrl});
      if(counts.savePosts===2)return json(res,503,{error:'fixture_lost_final_save_response'});
      return json(res,200,saves.get(body.requestId));
    }
    if(url.pathname.includes('/workspace-artifacts/')){counts.saveReads++;const value=saves.get(url.pathname.split('/').at(-1));return json(res,value?200:404,value??{error:'workspace_artifact_not_found'});}
    if(url.pathname.endsWith('/media/read')){
      const value=[...saves.values()].find(saved=>saved.remote.storagePath===url.searchParams.get('path'));
      // Production finalizer requires HTTPS signed media URLs. The browser
      // test intercepts only its call() result below, never global fetch.
      return json(res,value?200:404,value?{url:'https://protected-probe.invalid/'+value.remote.imageId,imageUrl:value.imageUrl}:{error:'not_found'});
    }
    return json(res,404,{error:'probe_route_not_found'});
  }catch(error){return json(res,500,{error:String(error.message)});}
});
await vite.listen();process.stdout.write(`Protected-edit browser probe: ${origin}/${printInput?'__print-input-probe':canvasSave?'__canvas-save-probe':ui?'__canvas-recovery-probe':'__protected-probe'}\n`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await vite.close();process.exit(0);});
