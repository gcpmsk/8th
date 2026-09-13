/* =====================================================================
   SATYAM GOLD — /api/sync   (Cloudflare Pages Function)
   ---------------------------------------------------------------------
   GET  /api/sync?full=1        → सारा data
   GET  /api/sync?since=<ms>    → उसके बाद बदला हुआ data
   POST /api/sync {items:[{key,value,updated_at}]}  → save

   Database connection Cloudflare के Environment Variable से आता है:
       DATABASE_URL = postgresql://postgres:PASSWORD@HOST:PORT/postgres
   (Cloudflare Dashboard → Pages project → Settings → Variables and Secrets)
   ===================================================================== */

import { Client } from 'pg';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const ok  = (o) => new Response(JSON.stringify({ ok: true,  ...o }), { headers: JSON_HEADERS });
const bad = (msg, status = 500) =>
  new Response(JSON.stringify({ ok: false, error: String(msg) }), { status, headers: JSON_HEADERS });

function dsn(env) {
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.PG_URL;
  if (!url) throw new Error('DATABASE_URL environment variable set नहीं है');
  return url;
}

async function connect(env) {
  const client = new Client({ connectionString: dsn(env), connectionTimeoutMillis: 8000 });
  await client.connect();
  return client;
}

const DDL = `
CREATE TABLE IF NOT EXISTS sg_store (
  key        TEXT PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sg_store_updated_at_idx ON sg_store (updated_at);
`;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

/* ---------------------------- READ ---------------------------- */
export async function onRequestGet({ request, env }) {
  let client;
  try {
    const u = new URL(request.url);
    const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;

    client = await connect(env);
    await client.query(DDL);

    const res = since > 0
      ? await client.query(
          'SELECT key, value, updated_at FROM sg_store WHERE updated_at > $1 ORDER BY updated_at ASC',
          [since])
      : await client.query('SELECT key, value, updated_at FROM sg_store ORDER BY updated_at ASC');

    const rows = res.rows.map(r => ({
      key: r.key,
      value: r.value && r.value.__deleted ? null : (r.value ? r.value.v : null),
      updated_at: Number(r.updated_at)
    }));

    return ok({ rows, count: rows.length });
  } catch (e) {
    return bad(e.message || e);
  } finally {
    try { await client?.end(); } catch (_) {}
  }
}

/* ---------------------------- WRITE --------------------------- */
export async function onRequestPost({ request, env }) {
  let client;
  try {
    const body = await request.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return ok({ saved: 0 });

    client = await connect(env);
    await client.query(DDL);
    await client.query('BEGIN');

    let saved = 0;
    for (const it of items) {
      const key = String(it?.key || '');
      if (!key || !key.startsWith('sg_') || key.length > 300 || key === 'sg_wa_obj') continue;

      const ts = Number(it.updated_at) || Date.now();
      const wrapped = (it.value === null || it.value === undefined)
        ? { __deleted: true }
        : { v: it.value };

      await client.query(
        `INSERT INTO sg_store (key, value, updated_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = EXCLUDED.updated_at,
               synced_at = now()
         WHERE sg_store.updated_at <= EXCLUDED.updated_at`,
        [key, JSON.stringify(wrapped), ts]
      );
      saved++;
    }

    await client.query('COMMIT');
    return ok({ saved });
  } catch (e) {
    try { await client?.query('ROLLBACK'); } catch (_) {}
    return bad(e.message || e);
  } finally {
    try { await client?.end(); } catch (_) {}
  }
}
