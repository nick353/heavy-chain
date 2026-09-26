import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { handleRequest, type Env } from '../src/index.ts';

export const TEST_HEAVY_TERMS_VERSION = 'heavy-test-v1';
export const TEST_HEAVY_RIGHTS_VERSION = 'v1';
export const TEST_HEAVY_DOCUMENT_VERSION = 'heavy-document-v1';
export const TEST_HEAVY_DOCUMENT_DIGEST = 'd'.repeat(64);

class Statement {
  db: ImageDb; query: string; values: SQLInputValue[] = [];
  constructor(db: ImageDb,query: string) { this.db=db; this.query=query; }
  bind(...values: SQLInputValue[]) { this.values=values; return this; }
  async first<T>() { return (this.db.sql.prepare(this.query).get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.db.sql.prepare(this.query).all(...this.values) as T[] }; }
  sync() {
    const fail = this.db.fail?.query && this.query.includes(this.db.fail.query) ? this.db.fail : null;
    if (fail) this.db.fail=null;
    if (fail?.when === 'before') throw new Error('D1 unavailable');
    const meta=this.db.sql.prepare(this.query).run(...this.values);
    if (fail?.when === 'after') throw new Error('D1 response lost');
    return { meta };
  }
  async run() { return this.sync(); }
}
export class ImageDb {
  sql=new DatabaseSync(':memory:');
  fail: { query?: string; batch?: string; when: 'before' | 'after' } | null=null;
  constructor() {
    const folder=new URL('../migrations/',import.meta.url);
    for (const file of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file,folder),'utf8'));
    for (const id of ['alice','bob','viewer','other']) {
      this.sql.prepare('INSERT INTO user_identities VALUES(?,?,?,?)').run(id,'test-issuer',id,'2026-09-06');
      this.sql.prepare('INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?)').run(id,`${id}@example.test`,'2026-09-06','2026-09-06');
      this.sql.prepare(`INSERT INTO heavy_terms_acceptances
        (id,user_id,terms_version,document_version,document_digest,accepted_at,recorded_at,acceptance_source)
        VALUES(?,?,?,?,?,?,?,?)`).run(`terms-${id}-v1`,id,TEST_HEAVY_TERMS_VERSION,TEST_HEAVY_DOCUMENT_VERSION,TEST_HEAVY_DOCUMENT_DIGEST,
          '2026-09-06T00:00:00.000Z','2026-09-06T00:00:00.000Z','test-fixture');
    }
    this.sql.exec("INSERT INTO brands(id,owner_id,name,created_at,updated_at) VALUES('brand','alice','Brand','2026-09-06','2026-09-06')");
    for (const [id,role] of [['bob','editor'],['viewer','viewer']]) this.sql.prepare("INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES(?,'brand',?,?,?)").run(id,id,role,'2026-09-06');
  }
  prepare(query: string) { return new Statement(this,query); }
  async batch(statements: Statement[]) {
    const fail=this.fail?.batch && statements.some(s=>s.query.includes(this.fail!.batch!)) ? this.fail : null;
    if (fail) this.fail=null;
    if (fail?.when==='before') throw new Error('D1 batch unavailable');
    this.sql.exec('BEGIN'); let result;
    try { result=statements.map(s=>s.sync()); this.sql.exec('COMMIT'); }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
    if (fail?.when==='after') throw new Error('D1 batch response lost');
    return result;
  }
}
type ObjectRow={ bytes: Uint8Array; size: number; customMetadata: Record<string,string>; httpMetadata: { contentType: string } };
export class ImageBucket {
  rows=new Map<string,ObjectRow>(); puts=0; fail: 'before'|'after'|null=null;
  async head(key: string) { return this.rows.get(key) ?? null; }
  async put(key: string,bytes: Uint8Array,options: { onlyIf?: { etagDoesNotMatch: string }; customMetadata: Record<string,string>; httpMetadata: { contentType: string } }) {
    const fail=this.fail; this.fail=null;
    if (fail==='before') throw new Error('R2 unavailable');
    if (options.onlyIf?.etagDoesNotMatch==='*' && this.rows.has(key)) return null;
    this.puts++; this.rows.set(key,{ bytes: bytes.slice(),size: bytes.length,customMetadata: options.customMetadata,httpMetadata: options.httpMetadata });
    if (fail==='after') throw new Error('R2 response lost');
    return this.rows.get(key);
  }
  async get(key: string) {
    const row=this.rows.get(key);
    return row ? { ...row,body: row.bytes,writeHttpMetadata(headers: Headers) { headers.set('content-type',row.httpMetadata.contentType); } } : null;
  }
  async delete(key: string) { this.rows.delete(key); }
}
// A real, decodable synthetic PNG, not a fake header treated as a valid result.
export function pngFixture(width=256,height=256,color=[20,90,180]): Uint8Array {
  const crc=(bytes: Uint8Array) => { let value=0xffffffff; for(const byte of bytes) { value^=byte; for(let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0); } return (value^0xffffffff)>>>0; };
  const chunk=(type: string,data: Uint8Array) => { const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length); result.write(type,4,'ascii'); result.set(data,8); result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4); return result; };
  const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const raw=Buffer.alloc(height*(1+width*3));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) raw.set(color,y*(1+width*3)+1+x*3);
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())]));
}
export function imageSetup() {
  const db=new ImageDb(); const bucket=new ImageBucket(); const calls: Array<{ model: string; form: FormData }>=[];
  const output=pngFixture(); let hook: ((form: FormData)=>Promise<unknown>)|null=null;
  let autoProvisionEntitlement = true;
  const revoked=new Set<string>();
  const env={ DB: db,PRIVATE_MEDIA: bucket,MEDIA_READ_SECRET: 'local-image-test-only-secret-1234567890',FRONTEND_ORIGINS: 'https://heavy.test',
    AI_IMAGE_ENABLED: 'true',AI_IMAGE_ALLOWED_ACTIONS: 'generate-image,edit-image,model-matrix',
    HEAVY_IMAGE_ENTITLEMENT_ENABLED: 'true',HEAVY_TERMS_VERSION: TEST_HEAVY_TERMS_VERSION,
    HEAVY_RIGHTS_ATTESTATION_VERSION: TEST_HEAVY_RIGHTS_VERSION,
    HEAVY_TERMS_DOCUMENT_VERSION: TEST_HEAVY_DOCUMENT_VERSION,
    HEAVY_TERMS_DOCUMENT_DIGEST: TEST_HEAVY_DOCUMENT_DIGEST,
    HEAVY_RIGHTS_DOCUMENT_VERSION: TEST_HEAVY_DOCUMENT_VERSION,
    HEAVY_RIGHTS_DOCUMENT_DIGEST: TEST_HEAVY_DOCUMENT_DIGEST,
    MEDIA_TOKEN_VERIFIER: (request: Request) => { const user=request.headers.get('authorization')?.slice(7); return user && !revoked.has(user) ? { issuer: 'test-issuer',subject: user } : null; },
    AI: { run: async(model: string,input: { multipart: { body: ReadableStream<Uint8Array>; contentType: string } }) => {
      const form=await new Response(input.multipart.body,{ headers: { 'content-type': input.multipart.contentType } }).formData();
      calls.push({model,form}); return hook ? hook(form) : { image: Buffer.from(output).toString('base64') };
    } },
  } as unknown as Env;
  const provisionEntitlement = async (user: string, body: Record<string, unknown>, action: string, requestId: string): Promise<{ preparationId: string; inputDigest: string } | null> => {
    if (!autoProvisionEntitlement || env.HEAVY_IMAGE_ENTITLEMENT_ENABLED !== 'true' || !user || body.legalSafety && typeof body.legalSafety === 'object' &&
        (body.legalSafety as Record<string, unknown>).rightsConfirmed !== true) return null;
    const brandId = typeof body.brandId === 'string' ? body.brandId : typeof body.brand_id === 'string' ? body.brand_id : '';
    if (!brandId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(brandId)) return null;
    const preparedBody = { ...body, seed: body.seed ?? 172903 };
    const preparationResponse = await handleRequest(new Request('https://heavy.test/v1/heavy/entitlement/prepare', {
      method: 'POST',
      headers: { origin: 'https://heavy.test', authorization: `Bearer ${user}`, 'content-type': 'application/json' },
      body: JSON.stringify({ brandId, action, requestId, input: preparedBody }),
    }), env);
    if (preparationResponse.status !== 200) {
      if (![400, 401, 403, 404, 409, 422].includes(preparationResponse.status)) {
        throw new Error(`fixture_preparation_failed:${preparationResponse.status}:${await preparationResponse.text()}`);
      }
      return null;
    }
    const preparation = await preparationResponse.json() as { preparationId: string; inputDigest: string };
    const response = await handleRequest(new Request('https://heavy.test/v1/heavy/entitlement/attestation', {
      method: 'POST',
      headers: { origin: 'https://heavy.test', authorization: `Bearer ${user}`, 'content-type': 'application/json' },
      body: JSON.stringify({ brandId, action, requestId, termsAccepted: true, rightsAttested: true,
        preparationId: preparation.preparationId, inputDigest: preparation.inputDigest,
        rightsVersion: TEST_HEAVY_RIGHTS_VERSION,
        termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
        rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
        input: preparedBody }),
    }), env);
    // Invalid input, missing membership, and unauthenticated test cases must
    // reach the real provider route so its own validation remains the oracle.
    // Configuration/contract failures on an otherwise valid request are not
    // hidden: the provider request will fail closed on the same entitlement.
    if (response.status !== 200 && ![400, 401, 403, 404, 409, 422].includes(response.status)) {
      throw new Error(`fixture_attestation_failed:${response.status}:${await response.text()}`);
    }
    if (response.status !== 200) return null;
    return preparation;
  };
  const call=async (path: string,user='alice',body?: unknown,id?: string) => {
    const providerAction = /^\/v1\/provider-actions\/([^/]+)$/.exec(path);
    const requestBody = body !== undefined && providerAction && body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), seed: (body as Record<string, unknown>).seed ?? 172903 }
      : body;
    let effectiveRequestBody = requestBody;
    if (requestBody !== undefined && id && providerAction && requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)) {
      const preparation = await provisionEntitlement(user,requestBody as Record<string, unknown>,providerAction[1],id.toLowerCase());
      if (preparation) effectiveRequestBody = { ...(requestBody as Record<string, unknown>), preparationId: preparation.preparationId };
    }
    return handleRequest(new Request('https://heavy.test'+path,{
    method: effectiveRequestBody===undefined ? 'GET' : 'POST',headers: { origin: 'https://heavy.test',...(user?{authorization:`Bearer ${user}`} : {}),
      ...(effectiveRequestBody===undefined?{}:{'content-type':'application/json'}),...(id?{'Idempotency-Key':id}:{}) },...(effectiveRequestBody===undefined?{}:{body:JSON.stringify(effectiveRequestBody)}) }),env);
  };
  const input=()=>({brandId:'brand',prompt:'Original cotton shirt, clean studio product photo',width:256,height:256,legalSafety:{rightsConfirmed:true}});
  return { db,bucket,env,calls,output,revoked,call,input,
    setAutoProvisionEntitlement(value: boolean) { autoProvisionEntitlement=value; },
    provisionEntitlement,
    setHook(value: typeof hook) { hook=value; } };
}
