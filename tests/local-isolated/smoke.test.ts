import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { db, runInTenantTransaction, afterTenantCommit, isInTenantTransaction } from '../../src/db/client';

describe('disposable installed-driver smoke', () => {
  it('routes HTTP reads and Pool transactions to the same verified database', async () => {
    expect((await db.execute(sql`select current_database() as database`)).rows[0].database).toBe('pro_erp_test');
    let effects = 0;
    const effect = () => { expect(isInTenantTransaction()).toBe(false); effects++; };
    await runInTenantTransaction('local-infrastructure-smoke', async () => {
      const settings = await db.execute(sql`select current_setting('transaction_isolation') isolation, current_setting('lock_timeout') lock, current_setting('statement_timeout') statement`);
      expect(settings.rows[0]).toEqual({ isolation: 'read committed', lock: '5s', statement: '30s' });
      const lock = await db.execute(sql`select count(*)::int count from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted`);
      expect(lock.rows[0].count).toBe(1);
      await db.execute(sql`create temporary table infrastructure_smoke (id integer primary key)`);
      await db.batch([db.execute(sql`insert into infrastructure_smoke values (1)`), db.execute(sql`insert into infrastructure_smoke values (2)`)]);
      await expect(db.batch([db.execute(sql`insert into infrastructure_smoke values (3)`), db.execute(sql`insert into infrastructure_smoke values (1)`)] as never)).rejects.toMatchObject({ cause: { code: '23505' } });
      expect((await db.execute(sql`select id from infrastructure_smoke order by id`)).rows).toEqual([{ id: 1 }, { id: 2 }]);
      await afterTenantCommit(effect);
      await runInTenantTransaction('local-infrastructure-smoke', () => afterTenantCommit(effect));
      expect(effects).toBe(0);
    });
    expect(effects).toBe(1);
    await expect(runInTenantTransaction('local-infrastructure-smoke', async () => { await afterTenantCommit(effect); throw new Error('smoke rollback'); })).rejects.toThrow('smoke rollback');
    expect(effects).toBe(1);
  });

  it('executes actual HTTP atomic batches and preserves SQL error metadata', async () => {
    const http = neon(process.env.DATABASE_URL!);
    const result = await http.transaction([http.query('select $1::int as n', [7]), http.query('select $1::numeric as n', ['2.50'])]);
    expect(result).toEqual([[{ n: 7 }], [{ n: '2.50' }]]);
    const table = `local_http_rollback_${randomUUID().replaceAll('-', '')}`;
    // Identifier is generated internally from hex UUID only, never user input.
    try {
      await expect(http.transaction([http.query(`create table ${table} (id integer)`), http.query(`insert into ${table} values (1)`), http.query('select 1/0')])).rejects.toMatchObject({ code: '22012' });
      expect(await http.query('select to_regclass($1) as name', [table])).toEqual([{ name: null }]);
      expect(await http.query('select 8::int as n')).toEqual([{ n: 8 }]);
    } finally {
      await http.query(`drop table if exists ${table}`);
      expect(await http.query('select to_regclass($1) as name', [table])).toEqual([{ name: null }]);
    }
  });

  it('blocks external fetch and forged local target before network requests', async () => {
    await expect(fetch('https://example.com/send')).rejects.toThrow('blocked');
    await expect(fetch('http://127.0.0.1:55008/sql', { method: 'POST', headers: { 'neon-connection-string': 'postgresql://wrong@cloud.example/production' } })).rejects.toThrow('disposable');
  });
});
