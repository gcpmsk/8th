/* =====================================================================
   SATYAM GOLD — /api/health   (Cloudflare Pages Function)
   ---------------------------------------------------------------------
   Browser में खोलें:  https://<आपकी-site>/api/health
   → बताता है कि DATABASE_URL set है या नहीं, और Postgres से
     connection बन रहा है या नहीं (साथ में sg_store की row count).
   ===================================================================== */

import { Client } from 'pg';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*'
};

export async function onRequestGet({ env }) {
  const out = {
    ok: false,
    database_url_set: false,
    db_connected: false,
    sg_store_rows: null,
    error: null,
    time: new Date().toISOString()
  };

  const url = env.DATABASE_URL || env.POSTGRES_URL || env.PG_URL;
  if (!url) {
    out.error = 'DATABASE_URL environment variable set नहीं है — Cloudflare Pages → Settings → Variables and Secrets में add करें';
    return new Response(JSON.stringify(out, null, 2), { status: 200, headers: JSON_HEADERS });
  }
  out.database_url_set = true;

  let client;
  try {
    client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
    await client.connect();
    out.db_connected = true;
    const r = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'sg_store'"
    );
    if (r.rows[0].n > 0) {
      const c = await client.query('SELECT count(*)::int AS n FROM sg_store');
      out.sg_store_rows = c.rows[0].n;
    } else {
      out.sg_store_rows = 'table नहीं बनी — schema.sql Adminer में चलाएँ';
    }
    out.ok = true;
  } catch (e) {
    out.error = String(e && e.message || e);
  } finally {
    try { await client?.end(); } catch (_) {}
  }

  return new Response(JSON.stringify(out, null, 2), { status: 200, headers: JSON_HEADERS });
}
