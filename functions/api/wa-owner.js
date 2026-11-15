/* =====================================================================
   SATYAM GOLD — /api/wa-owner   (सिर्फ़ Owner; Authorization: Bearer WA_ADMIN_TOKEN)
   GET  ?view=receipts[&filter=failed|all]   → payment receipts की list (failed ऊपर)
   POST {action:'retry', id}                 → एक failed receipt दोबारा भेजो
   POST {action:'retry_all'}                 → सारी failed दोबारा भेजो
   GET  ?view=chats&date=DD-MM-YYYY          → उस दिन किन customers ने chat की
   GET  ?view=chat&phone=91xxxxxxxxxx&date=DD-MM-YYYY → उस customer की उस दिन की पूरी chat
   Chat data वही wa_log table है जो bot पहले से Postgres में लिखता है.
   ===================================================================== */
import { Client } from 'pg';
import { RECEIPT_DDL, sendQueued } from '../_lib/receipt.js';

const H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: H });
const authorized = (req, env) => !!env.WA_ADMIN_TOKEN && req.headers.get('Authorization') === 'Bearer ' + env.WA_ADMIN_TOKEN;
async function connect(env) {
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.PG_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 }); await c.connect(); return c;
}
const DMY = /^\d{2}-\d{2}-\d{4}$/;
const IST_DAY = "to_char(created_at AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY')";
const IST_TIME = "to_char(created_at AT TIME ZONE 'Asia/Kolkata','HH12:MI AM')";

const BTN = { m_due: '💰 मेरा बाक़ी', m_order: '🛒 नया Order', m_hisab: '📋 पूरा हिसाब', m_rate: '📈 आज का भाव', m_more: 'More Services',
  m_obj: '📣 Objection', m_owner: 'Owner से बात', m_talk: 'Owner से बात', m_home: '🏠 Menu', ok_order: '✅ Confirm', more_item: '➕ और Item', cancel: '❌ Cancel' };
const humanIn = t => { t = String(t || ''); return BTN[t] ? '🔘 ' + BTN[t] : /^(i_|s_|oit_|p_|pk_)/.test(t) ? '🔘 ' + t : t; };

/* wa_log की row → दिखाने लायक text */
function textOf(r) {
  let b = r.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = { text: b }; } }
  b = b || {};
  if (r.dir === 'in') return humanIn(typeof b.text === 'string' ? b.text : (b.input ?? r.msg ?? ''));
  if (b.receipt) return b.text || '🧾 Payment Receipt';
  const i = b.interactive;
  if (i) {
    const parts = [i.header?.text, i.body?.text].filter(Boolean);
    const btns = (i.action?.buttons || []).map(x => x.reply?.title).filter(Boolean);
    const rows = (i.action?.sections || []).flatMap(s => (s.rows || []).map(x => x.title));
    let t = parts.join('\n');
    if (btns.length) t += '\n\n' + btns.map(x => '▫️ ' + x).join('\n');
    if (rows.length) t += '\n\n' + rows.map(x => '▫️ ' + x).join('\n');
    return t;
  }
  if (b.template) return '🧾 Template: ' + (b.template.name || '');
  if (b.text?.body) return b.text.body;
  return r.reply || (typeof b.text === 'string' ? b.text : '') || '';
}
/* wa.js का technical log (req/res/id) और दोहराव chat में नहीं दिखाना */
const noisy = r => { const b = r.body && typeof r.body === 'object' ? r.body : {}; return !!(b.req || b.res || (r.dir === 'in' && b.input !== undefined && b.via === undefined)); };

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false, error: 'Owner access key required' }, 401);
  const u = new URL(request.url); const view = u.searchParams.get('view') || 'receipts';
  let c;
  try {
    c = await connect(env);
    if (view === 'receipts') {
      await c.query(RECEIPT_DDL);
      const all = u.searchParams.get('filter') === 'all';
      const r = await c.query(`SELECT id, source, name, phone, amount, status, delivery, error, tries, data,
          to_char(created_at AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY HH12:MI AM') AS at
        FROM wa_receipts ${all ? '' : "WHERE status IN ('failed','pending','sending')"}
        ORDER BY (status='failed') DESC, id DESC LIMIT 200`);
      const cnt = (await c.query(`SELECT count(*) FILTER (WHERE status='failed')::int AS failed,
        count(*) FILTER (WHERE status IN ('pending','sending') AND created_at < now() - interval '3 minutes')::int AS stuck,
        count(*) FILTER (WHERE status='sent')::int AS sent FROM wa_receipts`)).rows[0];
      return json({ ok: true, receipts: r.rows, counts: cnt });
    }
    if (view === 'chats') {
      const date = u.searchParams.get('date') || '';
      if (!DMY.test(date)) return json({ ok: false, error: 'date DD-MM-YYYY चाहिए' }, 400);
      const r = await c.query(`SELECT phone, count(*) FILTER (WHERE dir='in')::int AS msgs, max(created_at) AS last_at,
          to_char(max(created_at) AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') AS last_time
        FROM wa_log WHERE phone IS NOT NULL AND dir IN ('in','out') AND ${IST_DAY} = $1 GROUP BY phone ORDER BY max(created_at) DESC LIMIT 300`, [date]);
      const cust = (await c.query("SELECT value->'v' AS v FROM sg_store WHERE key='sg_wa_cust'")).rows[0]?.v || {};
      const days = (await c.query(`SELECT ${IST_DAY} AS d, count(DISTINCT phone)::int AS n FROM wa_log
        WHERE phone IS NOT NULL AND dir IN ('in','out') AND created_at > now() - interval '60 days' GROUP BY 1 ORDER BY max(created_at) DESC`)).rows;
      return json({ ok: true, date, total: r.rows.length, days,
        chats: r.rows.map(x => { const k = cust[String(x.phone).slice(-10)]; return { phone: x.phone, name: k?.name || '', address: k?.address || '', msgs: x.msgs, last: x.last_time }; }) });
    }
    if (view === 'chat') {
      const phone = String(u.searchParams.get('phone') || '').replace(/\D/g, ''); const date = u.searchParams.get('date') || '';
      if (!/^\d{10,15}$/.test(phone) || !DMY.test(date)) return json({ ok: false, error: 'phone और date चाहिए' }, 400);
      const r = await c.query(`SELECT id, dir, body, msg, reply, ${IST_TIME} AS t FROM wa_log
        WHERE phone=$1 AND dir IN ('in','out') AND ${IST_DAY}=$2 ORDER BY created_at, id LIMIT 1000`, [phone, date]);
      const cust = (await c.query("SELECT value->'v'->($1::text) AS c FROM sg_store WHERE key='sg_wa_cust'", [phone.slice(-10)])).rows[0]?.c;
      const msgs = r.rows.filter(x => !noisy(x)).map(x => ({ id: x.id, dir: x.dir, t: x.t, text: textOf(x) })).filter(x => x.text);
      return json({ ok: true, phone, date, name: cust?.name || '', address: cust?.address || '', messages: msgs });
    }
    return json({ ok: false, error: 'unknown view' }, 400);
  } catch (e) { return json({ ok: false, error: e.message }, 502); }
  finally { try { await c?.end(); } catch (_) {} }
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false, error: 'Owner access key required' }, 401);
  let c;
  try {
    const b = await request.json().catch(() => ({}));
    c = await connect(env); await c.query(RECEIPT_DDL);
    let ids = [];
    if (b.action === 'retry' && Number.isInteger(Number(b.id))) ids = [Number(b.id)];
    else if (b.action === 'retry_all') ids = (await c.query("SELECT id FROM wa_receipts WHERE status='failed' ORDER BY id LIMIT 30")).rows.map(x => x.id);
    else return json({ ok: false, error: 'action: retry / retry_all' }, 400);
    const results = [];
    for (const id of ids) {
      // advisory lock → दो बार Retry दबाने पर भी एक ही बार भेजा जाए
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['wa:receipt:' + id]);
      try { const r = (await sendQueued(env, () => connect(env), [id], true))[0]; results.push(r); }
      finally { await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['wa:receipt:' + id]); }
    }
    return json({ ok: true, results, sent: results.filter(r => r.ok).length, failed: results.filter(r => r.ok === false).length });
  } catch (e) { return json({ ok: false, error: e.message }, 502); }
  finally { try { await c?.end(); } catch (_) {} }
}
