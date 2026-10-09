/**
 * Daily copy of the production D1 database to R2 (backups/d1/<date>/). Copies older than BACKUP_RETENTION_DAYS
 * are removed after each run, so a deleted account leaves no copy behind after 30 days (privacy policy).
 * Each table becomes one NDJSON file; manifest.json records the CREATE statements and row counts so a
 * restore can rebuild the schema first.
 */
const PAGE_SIZE = 500;
export const BACKUP_RETENTION_DAYS = 28;
const BACKUP_KEY = /^backups\/d1\/(\d{4}-\d{2}-\d{2})\//;

export type BackupResult = { prefix: string; tables: Array<{ name: string; rows: number; bytes: number }> };

export const backupPrefix = (now: Date) => `backups/d1/${now.toISOString().slice(0, 10)}`;

export async function backupDatabase(db: D1Database, bucket: R2Bucket, now = new Date()): Promise<BackupResult> {
  const prefix = backupPrefix(now);
  const schema = await db.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name",
  ).all<{ type: string; name: string; tbl_name: string; sql: string }>();
  const tables = schema.results.filter((row) => row.type === 'table').map((row) => row.name);
  const result: BackupResult = { prefix, tables: [] };
  for (const table of tables) {
    const lines: string[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" LIMIT ? OFFSET ?`).bind(PAGE_SIZE, offset).all();
      for (const row of page.results) lines.push(JSON.stringify(row));
      if (page.results.length < PAGE_SIZE) break;
    }
    const body = lines.length ? `${lines.join('\n')}\n` : '';
    await bucket.put(`${prefix}/${table}.ndjson`, body, { httpMetadata: { contentType: 'application/x-ndjson' } });
    result.tables.push({ name: table, rows: lines.length, bytes: new TextEncoder().encode(body).byteLength });
  }
  const manifest = { createdAt: now.toISOString(), database: 'heavy-chain-production-db', schema: schema.results, tables: result.tables };
  await bucket.put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 1), { httpMetadata: { contentType: 'application/json' } });
  return result;
}

/** Deletes backup copies whose date is more than BACKUP_RETENTION_DAYS before `now`. Only keys under backups/d1/<date>/ are touched. */
export async function pruneBackups(bucket: R2Bucket, now = new Date()): Promise<string[]> {
  const cutoff = backupPrefix(new Date(now.getTime() - BACKUP_RETENTION_DAYS * 86_400_000)).slice('backups/d1/'.length);
  const expired: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'backups/d1/', cursor });
    for (const object of page.objects) {
      const date = BACKUP_KEY.exec(object.key)?.[1];
      if (date && date < cutoff) expired.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < expired.length; i += 1000) await bucket.delete(expired.slice(i, i + 1000));
  return expired;
}
