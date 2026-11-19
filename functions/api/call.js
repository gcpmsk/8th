/* =====================================================================
   SATYAM GOLD — /api/call   (📞 Call Wala + 🚨 Emergency Wala)
   सिर्फ़ Owner: Authorization: Bearer WA_ADMIN_TOKEN  (वही key जो WhatsApp admin में है)
   POST {view:'dash'|'calls'|'rate'|'stock', …}  या  {action:'enqueue'|'cancel_all'|…}
   सारा logic PostgreSQL function cw_api() में है (call-schema.sql).
   ===================================================================== */
import { Client } from 'pg';

const H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: H });

export async function onRequestPost({ request, env }) {
  if (!env.WA_ADMIN_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + env.WA_ADMIN_TOKEN)
    return json({ ok: false, error: 'Owner access key required' }, 401);
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.PG_URL;
  if (!url) return json({ ok: false, error: 'DATABASE_URL missing' }, 500);
  let c;
  try {
    const body = await request.json().catch(() => ({}));
    c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
    await c.connect();
    const out = (await c.query('SELECT public.cw_api($1::jsonb) AS o', [JSON.stringify(body || {})])).rows[0].o || {};
    return json(out, out.ok === false ? 400 : 200);
  } catch (e) {
    const m = String(e && e.message || e);
    return json({ ok: false, error: /cw_api|em_stock|does not exist/i.test(m)
      ? 'Database में Call Wala की tables नहीं बनीं — call-schema.sql को Adminer में paste करके Execute करें. (' + m + ')' : m }, 502);
  } finally { try { await c?.end(); } catch (_) {} }
}
