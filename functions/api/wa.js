/* =====================================================================
   SATYAM GOLD — WhatsApp Bot  (Meta Cloud API webhook)  →  /api/wa
   ---------------------------------------------------------------------
   Cloudflare Pages → Settings → Variables:
     DATABASE_URL     postgresql://postgres:PASS@HOST:5432/postgres
     WA_TOKEN         Meta permanent access token
     WA_PHONE_ID      WhatsApp Business phone-number-id
     WA_VERIFY_TOKEN  कोई भी secret (Meta webhook verify में same डालें)
   Meta → App → WhatsApp → Configuration → Callback URL:
     https://<your-pages-domain>/api/wa      (subscribe: messages)

   सब कुछ "touch" वाला — List / Button (SBI जैसा). type करना सिर्फ़ qty / rate में.
   Data सीधे Postgres sg_store में (app वाली same keys) → Order Book में दिखता है.
   ===================================================================== */
import { Client } from 'pg';

const J = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ok = (o = {}) => new Response(JSON.stringify({ ok: true, ...o }), { headers: J });

async function db(env) {
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.PG_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await c.connect();
  return c;
}

async function log(c, phone, dir, body) {
  await c.query('INSERT INTO wa_log(phone,dir,body) VALUES($1,$2,$3::jsonb)',[phone,dir,JSON.stringify(body)]);
}

/* ---------- Meta send ---------- */
async function waSend(env, to, payload, c) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) throw new Error('WA_TOKEN / WA_PHONE_ID missing');
  const body = Object.assign({ messaging_product: 'whatsapp', to }, payload);
  const r = await fetch(`https://graph.facebook.com/${env.WA_GRAPH_VERSION || 'v23.0'}/${env.WA_PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = await r.json().catch(() => ({}));
  if (c) await log(c, to, r.ok ? 'out' : 'err', { req: body, res: out });
  if (!r.ok || out.error) throw new Error(`WhatsApp API ${out.error?.code || r.status}: ${out.error?.message || 'Message rejected'}`);
  return out;
}
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (env.WA_VERIFY_TOKEN && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === env.WA_VERIFY_TOKEN) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost({ request, env }) {
  const fail = (error, status) => new Response(JSON.stringify({ ok: false, error }), { status, headers: J });
  const raw = await request.text();
  // Only a signed Meta webhook or authenticated n8n relay may assert a sender.
  const relay = env.WA_RELAY_SECRET && request.headers.get('X-WA-Relay-Secret') === env.WA_RELAY_SECRET;
  let signed = false;
  if (!relay && env.WA_APP_SECRET) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WA_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = request.headers.get('X-Hub-Signature-256') || '';
    if (/^sha256=[a-f0-9]{64}$/.test(signature)) {
      const bytes = Uint8Array.from(signature.slice(7).match(/../g), h => parseInt(h,16));
      signed = await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(raw));
    }
  }
  if (!relay && !signed) return fail('Valid Meta signature or X-WA-Relay-Secret required', 401);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return fail('Invalid JSON body', 400); }
  // Meta envelope, n8n Trigger output, arrays and a single message are supported.
  const values = (Array.isArray(body) ? body : [body]).flatMap(b =>
    b?.entry ? b.entry.flatMap(e => (e.changes || []).map(ch => ch.value)) : [b]);
  const messages = values.flatMap(v => v?.messages || (v?.from && v?.type ? [v] : []))
    .filter(m => m?.from && ['text', 'interactive', 'button'].includes(m.type));
  if (!messages.length) return ok({ ignored: true }); // Delivery/read statuses must not reply.
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return fail('WA_TOKEN / WA_PHONE_ID missing in deployed app', 503);
  let c, current, processed = 0, duplicates = 0;
  try {
    c = await db(env);
    await c.query("SET lock_timeout = '8s'");
    for (const msg of messages) {
      current = msg;
      const phone = String(msg.from);
      if (!/^91[0-9]{10}$/.test(phone) || !msg.id) return fail('Valid sender and message ID required',400);
      const input = msg.type === 'text' ? (msg.text?.body || '')
        : msg.type === 'interactive' ? (msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || '')
        : (msg.button?.payload || msg.button?.text || '');
      // Serialize a customer's simultaneous deliveries. Connection close also releases the lock.
      await c.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['wa:' + phone]);
      try {
        if (msg.id) {
          const dup = await c.query("SELECT 1 FROM wa_log WHERE dir='processed' AND body->>'id'=$1 LIMIT 1", [msg.id]);
          if (dup.rowCount) { duplicates++; continue; }
        }
        await log(c, phone, 'in', { type: msg.type, input, id: msg.id });
        const result = await c.query('SELECT wa_receive($1,$2,$3) AS reply', [phone,input,msg.id]);
        await waSend(env, phone, result.rows[0].reply, c);
        // Only successful processing is deduplicated: a failed Hi can be retried.
        if (msg.id) await log(c, phone, 'processed', { id: msg.id });
        processed++;
      } finally {
        await c.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['wa:' + phone]);
      }
    }
  } catch (e) {
    const error = String(e.message || e);
    try { if (c) await log(c, current?.from, 'err', { error, id: current?.id }); } catch (_) {}
    return fail(error, 502); // n8n must show database/token/Meta errors, never a fake success.
  } finally { try { await c?.end(); } catch (_) {} }
  return ok({ processed, duplicates });
}
