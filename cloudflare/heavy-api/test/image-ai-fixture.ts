import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { handleRequest, type Env } from '../src/index.ts';

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
  const revoked=new Set<string>();
  const env={ DB: db,PRIVATE_MEDIA: bucket,MEDIA_READ_SECRET: 'local-image-test-only-secret-1234567890',FRONTEND_ORIGINS: 'https://heavy.test',
    AI_IMAGE_ENABLED: 'true',AI_IMAGE_ALLOWED_ACTIONS: 'generate-image,edit-image,model-matrix',
    MEDIA_TOKEN_VERIFIER: (request: Request) => { const user=request.headers.get('authorization')?.slice(7); return user && !revoked.has(user) ? { issuer: 'test-issuer',subject: user } : null; },
    AI: { run: async(model: string,input: { multipart: { body: ReadableStream<Uint8Array>; contentType: string } }) => {
      const form=await new Response(input.multipart.body,{ headers: { 'content-type': input.multipart.contentType } }).formData();
      calls.push({model,form}); return hook ? hook(form) : { image: Buffer.from(output).toString('base64') };
    } },
  } as unknown as Env;
  const call=(path: string,user='alice',body?: unknown,id?: string) => handleRequest(new Request('https://heavy.test'+path,{
    method: body===undefined ? 'GET' : 'POST',headers: { origin: 'https://heavy.test',...(user?{authorization:`Bearer ${user}`} : {}),
      ...(body===undefined?{}:{'content-type':'application/json'}),...(id?{'Idempotency-Key':id}:{}) },...(body===undefined?{}:{body:JSON.stringify(body)}) }),env);
  const input=()=>({brandId:'brand',prompt:'Original cotton shirt, clean studio product photo',width:256,height:256,legalSafety:{rightsConfirmed:true}});
  return { db,bucket,env,calls,output,revoked,call,input,setHook(value: typeof hook) { hook=value; } };
}
