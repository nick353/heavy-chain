import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';

class Statement {
  values: SQLInputValue[] = [];
  db: DatabaseSync;
  sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: SQLInputValue[]) { this.values = values; return this; }
  async all() {
    const results = this.db.prepare(this.sql).all(...this.values);
    const meta = this.db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
    return { results, meta, success: true };
  }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null; }
  async run() { return { meta: this.db.prepare(this.sql).run(...this.values), success: true }; }
}
/** Selects Better Auth's actual D1 adapter, not the transactional Node adapter. */
export class TestD1 {
  sql = new DatabaseSync(':memory:');
  constructor(migration?: URL) {
    if (migration) this.sql.exec(readFileSync(migration, 'utf8'));
    else {
      const dir = new URL('../migrations/', import.meta.url);
      for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, dir), 'utf8'));
    }
  }
  prepare(sql: string) { return new Statement(this.sql, sql); }
  async exec(sql: string) { this.sql.exec(sql); }
  async batch(statements: Statement[]) {
    this.sql.exec('BEGIN');
    try { const results = await Promise.all(statements.map(s => s.all())); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

export function setup() {
  const db = new TestD1();
  const mail: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const email: SendEmail = { send: async builder => {
    const fields = builder as EmailMessageBuilder;
    const recipient = Array.isArray(fields.to) ? fields.to[0] : fields.to;
    const from = typeof fields.from === 'string' ? fields.from : fields.from.email;
    const to = typeof recipient === 'string' ? recipient : recipient?.email;
    if (!to) throw new Error('fixture_recipient_missing');
    mail.push({ from, to, subject: fields.subject, text: fields.text ?? '' });
    return { messageId: crypto.randomUUID() };
  } };
  const env = { AUTH_DB: db, AUTH_SECRET: 'only-for-local-tests-1234567890-abcdef',
    AUTH_BASE_URL: 'https://auth.test', WEB_ORIGINS: 'https://web.test', EMAIL_FROM: 'login@example.test',
    EMAIL: email, EMAIL_DAILY_ATTEMPT_LIMIT: '1000', EMAIL_TOTAL_ATTEMPT_LIMIT: '10000',
  } as unknown as Env;
  const request = (path: string, body?: unknown, token?: string, extra?: Record<string, string>) => handleRequest(
    new Request(`https://auth.test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://auth.test' }),
        'cf-connecting-ip': '192.0.2.1', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  const link = () => mail.at(-1)!.text.match(/https:\/\/\S+/)![0];
  const password = 'local-test-long-password-4829';
  const register = (email = 'alice@example.test') => request('/api/auth/sign-up/email', { email, password, name: 'Alice', callbackURL: 'https://web.test/login' });
  const login = (email = 'alice@example.test', pass = password) => request('/api/auth/sign-in/email', { email, password: pass });
  const verify = () => handleRequest(new Request(link()), env);
  return { db, mail, email, env, request, register, login, verify, link, password };
}
