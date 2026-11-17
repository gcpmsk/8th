/* =====================================================================
   SATYAM GOLD — WhatsApp PAYMENT RECEIPT sender (approved template)
   यही file Notebook app और Collection app दोनों में same है.

   • queueReceipt()  : payment के साथ ही (same DB transaction में) queue row बनती है.
                       dedupe_key UNIQUE है → एक payment की receipt कभी दो बार नहीं जाती.
   • deliverReceipt(): queue row को "claim" करके Meta template भेजता है.
                       fail हो तो status='failed' + error → app में "Receipts" button में दिखता है.
   Env (Cloudflare): WA_TOKEN, WA_PHONE_ID  (+ optional)
     WA_RECEIPT_TEMPLATE  default satyam_payment_receipt
     WA_RECEIPT_LANG      default hi
     WA_RECEIPT_PARAMS    template {{1}},{{2}}... में क्या जाए, default: name,amount,date,mode
        चुन सकते हैं: name, amount, amount_rs, date, time, mode, rno, address, cash, online, by
        template में कोई {{variable}} नहीं है तो: none
     WA_RECEIPT_HEADER_IMAGE  (optional) अगर Meta template में Header = Image है तो उसका public https JPG/PNG link
     WA_RECEIPT_MODE      auto (default) | template | text
        auto     : customer ने पिछले 23 घंटे में bot को message किया है → सादा TEXT receipt (न template, न image, न Meta approval);
                   window बंद हो (या text fail हो) → approved template
        template : हमेशा template      text : हमेशा सादा text (सिर्फ़ 24 घंटे window में चलता है)
     WA_RECEIPT_IMAGE     on (default) | off  — ON: Collection जैसी PAYMENT RECEIPT की PNG image हर payment के नाम/तारीख़/रकम/mode से बनती है,
                        Meta /media पर upload होकर (1) 24 घंटे window में image+caption की तरह, (2) बाहर हो तो template के Header=Image में जाती है
     WA_RECEIPT_CAPTION   (optional) image के नीचे का text. {name} {amount} {date} {mode} {rno} {time} {address} चलते हैं
     WA_RECEIPT_TEXT      (optional) text receipt का अपना मज़मून. {name} {amount} {date} {mode} {rno} {time} {address} चलते हैं
   ===================================================================== */
const pad = n => String(n).padStart(2, '0');
const istDate = d => new Date(d.getTime() + 330 * 60000);

export const RECEIPT_DDL = `
CREATE TABLE IF NOT EXISTS wa_receipts (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'nb',
  name TEXT NOT NULL,
  phone TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  delivery TEXT,
  error TEXT,
  meta_id TEXT,
  tries INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_receipts_status_idx ON wa_receipts (status, id DESC);
CREATE INDEX IF NOT EXISTS wa_receipts_meta_idx ON wa_receipts (meta_id);
`;

export const nameKey = s => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
export function normPhone(v) {
  const t = String(v || '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(t) ? '91' + t : '';
}
const fmt = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export function istStamp(d = new Date()) {
  const x = istDate(d); let h = x.getUTCHours(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return { date: `${pad(x.getUTCDate())}-${pad(x.getUTCMonth() + 1)}-${x.getUTCFullYear()}`,
    time: `${pad(h)}:${pad(x.getUTCMinutes())} ${ap}`, h24: x.getUTCHours(), mm: pad(x.getUTCMinutes()) };
}
/* Collection receipt पर जो "रसीद संख्या" छपती है उसी formula से */
export function makeRno(createdAt, id) {
  const s = istStamp(new Date(createdAt || Date.now())); const h = s.h24;
  return `${h < 12 ? '00' : '000'}${h % 12 || 12}0${s.mm}0${String(id || 1).slice(-3).padStart(3, '0')}`;
}

export async function lookupPhone(c, name) {
  const r = await c.query("SELECT value->'v'->>($1::text) AS m FROM sg_store WHERE key='sg_mobiles'", [nameKey(name)]);
  return normPhone(r.rows[0]?.m);
}

/* Payment के transaction (BEGIN…COMMIT) के अंदर call करें. null = पहले से queue हो चुकी (दोबारा नहीं भेजनी) */
export async function queueReceipt(c, r) {
  const cash = Number(r.cash) || 0, online = Number(r.online) || 0, total = cash + online;
  if (!(total > 0) || !r.key || !r.name) return null;
  const now = istStamp(r.at ? new Date(r.at) : new Date());
  const data = { name: r.name, address: r.address || '', amount: fmt(total), amount_rs: '₹' + fmt(total), cash: fmt(cash), online: fmt(online),
    mode: r.mode || (online > 0 ? (cash > 0 ? 'Mix' : 'Online') : 'Cash'), date: r.date || now.date, time: r.time || now.time,
    rno: r.rno || '', by: r.by || '', phone: r.phone || '' };
  await c.query('SAVEPOINT wa_rq');          // receipt की कोई भी गड़बड़ी payment को fail न करे
  try {
    const ins = await c.query(`INSERT INTO wa_receipts (dedupe_key, source, name, amount, data) VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [String(r.key), r.source || 'nb', r.name, total, JSON.stringify(data)]);
    await c.query('RELEASE SAVEPOINT wa_rq');
    return ins.rows[0]?.id ?? null;
  } catch (e) { await c.query('ROLLBACK TO SAVEPOINT wa_rq'); return null; }
}

const DEFAULT_TEXT = `🧾 *भुगतान रसीद — SATYAM GOLD*

नमस्ते {name} जी,
आपका ₹{amount} का भुगतान सफलतापूर्वक प्राप्त हो गया है।

दिनांक: {date}
भुगतान का तरीका: {mode}
रसीद संख्या: {rno}

Satyam Gold पर विश्वास करने के लिए धन्यवाद।`;
const DEFAULT_CAPTION = `🧾 *भुगतान रसीद — SATYAM GOLD*

नमस्ते {name} जी, आपका ₹{amount} का भुगतान ({mode}) {date} को सफलतापूर्वक प्राप्त हो गया है।

Satyam Gold पर विश्वास करने के लिए धन्यवाद।`;
export const captionText = (env, d) => String(env.WA_RECEIPT_CAPTION || DEFAULT_CAPTION).replace(/\\n/g, '\n').replace(/\{(\w+)\}/g, (_, k) => clean(d[k]));
export function receiptText(env, d) {
  return String(env.WA_RECEIPT_TEXT || DEFAULT_TEXT).replace(/\\n/g, '\n').replace(/\{(\w+)\}/g, (_, k) => clean(d[k]));
}
const clean = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 100) || '-';

export async function deliverReceipt(env, c, id, force = false) {
  const row = (await c.query(`UPDATE wa_receipts SET status='sending', tries=tries+1, updated_at=now()
    WHERE id=$1 AND (status='pending' OR ($2::boolean AND (status='failed' OR (status='sending' AND updated_at < now() - interval '3 minutes'))))
    RETURNING *`, [id, !!force])).rows[0];
  if (!row) return { id, skipped: true };
  const fail = async msg => {
    await c.query("UPDATE wa_receipts SET status='failed', delivery='failed', error=$2, updated_at=now() WHERE id=$1", [id, String(msg).slice(0, 500)]);
    return { id, ok: false, error: String(msg) };
  };
  try {
    if (!env.WA_TOKEN || !env.WA_PHONE_ID) return await fail('WA_TOKEN / WA_PHONE_ID इस Cloudflare project में set नहीं हैं');
    const d = row.data || {};
    const phone = (await lookupPhone(c, row.name)) || normPhone(d.phone);
    if (!phone) return await fail('Customer का WhatsApp number नहीं मिला — Tally में mobile भरें, फिर Retry');
    d.rno = d.rno || makeRno(row.created_at, row.id);
    const rawParams = String(env.WA_RECEIPT_PARAMS ?? 'name,amount,date,mode').trim();
    const fields = /^(none|no|nil|-|0)$/i.test(rawParams) ? [] : rawParams.split(',').map(s => s.trim()).filter(Boolean);
    const hdrImg = String(env.WA_RECEIPT_HEADER_IMAGE || '').trim();
    const imgOn = !/^(off|no|none|false|0)$/i.test(String(env.WA_RECEIPT_IMAGE ?? 'on').trim());
    const GV = env.WA_GRAPH_VERSION || 'v23.0';
    const buildTemplate = (mediaId, flds) => {
      const template = { name: env.WA_RECEIPT_TEMPLATE || 'satyam_payment_receipt', language: { code: env.WA_RECEIPT_LANG || 'hi' } };
      const components = [];
      if (mediaId) components.push({ type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] });
      else if (hdrImg) components.push({ type: 'header', parameters: [{ type: 'image', image: { link: hdrImg } }] });
      if (flds.length) components.push({ type: 'body', parameters: flds.map(f => ({ type: 'text', text: clean(d[f]) })) });
      if (components.length) template.components = components;
      return template;
    };
    const send = async payload => {      // Meta को एक message भेजो → {ok, mid, code, msg}
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
      try {
        const r = await fetch(`https://graph.facebook.com/${GV}/${env.WA_PHONE_ID}/messages`, {
          method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, ...payload }) });
        const out = await r.json().catch(() => ({}));
        const mid = out?.messages?.[0]?.id;
        if (!r.ok || out?.error || !mid) return { ok: false, code: out?.error?.code || r.status, msg: out?.error?.error_data?.details || out?.error?.message || 'No message ID returned' };
        return { ok: true, mid };
      } finally { clearTimeout(tm); }
    };
    /* Receipt की PNG image बनाओ → Meta /media पर upload → media id. कुछ भी गड़बड़ हो तो '' (receipt बिना image के जाएगी) */
    let media = null, imgErr = '';
    const getMedia = async () => {
      if (media !== null) return media;
      media = '';
      if (!imgOn) return media;
      try {
        const render = env.__renderReceipt || (await import('./receipt-image.js')).renderReceiptPng;
        const png = await render(d, row.amount);
        const fd = new FormData();
        fd.append('messaging_product', 'whatsapp'); fd.append('type', 'image/png');
        fd.append('file', new Blob([png], { type: 'image/png' }), 'receipt.png');
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
        try {
          const r = await fetch(`https://graph.facebook.com/${GV}/${env.WA_PHONE_ID}/media`, { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + env.WA_TOKEN }, body: fd });
          const out = await r.json().catch(() => ({}));
          if (!r.ok || !out?.id) throw new Error(`media upload Meta ${out?.error?.code || r.status}: ${out?.error?.message || 'no id'}`);
          media = out.id;
        } finally { clearTimeout(tm); }
      } catch (e) { imgErr = String(e?.message || e).slice(0, 200); }
      return media;
    };
    const mode = String(env.WA_RECEIPT_MODE || 'auto').trim().toLowerCase();
    let res = null, via = 'template', textErr = '';
    if (mode === 'auto' || mode === 'text') {
      let open = false;
      { try { open = !!(await c.query("SELECT 1 FROM wa_log WHERE phone=$1 AND dir='in' AND created_at > now() - interval '23 hours' LIMIT 1", [phone])).rows[0]; } catch (_) {} }
      if (open) {
        const mid0 = await getMedia();
        res = await send(mid0 ? { type: 'image', image: { id: mid0, caption: captionText(env, d) } } : { type: 'text', text: { preview_url: false, body: receiptText(env, d) } });
        if (res.ok) via = mid0 ? 'image' : 'text'; else { textErr = `Meta ${res.code}: ${res.msg}`; if (mode !== 'text') res = null; }
      } else if (mode === 'text') return await fail('Customer ने 24 घंटे में WhatsApp पर message नहीं किया — सादा text नहीं जा सकता (WA_RECEIPT_MODE=auto रखें ताकि template जाए)');
    }
    if (!res || (!res.ok && mode !== 'text')) {
      const mid1 = await getMedia();
      res = await send({ type: 'template', template: buildTemplate(mid1, fields) });
      if (mid1) {   // template की बनावट अलग हो तो अपने-आप दूसरे combination आज़माओ (body variable / header image का mismatch = 132000)
        const tries = [];
        if (fields.length) tries.push([mid1, []]);
        tries.push(['', fields]);
        for (const [m2, f2] of tries) {
          if (res.ok || ![132000, 132012].includes(res.code)) break;
          res = await send({ type: 'template', template: buildTemplate(m2, f2) });
        }
      }
    }
    const mid = res.ok ? res.mid : null;
    if (!res.ok) {
      const code = res.code;
      const hint = code === 132000 || code === 132012
        ? ` → Template के {{1}},{{2}} की गिनती/क्रम से WA_RECEIPT_PARAMS मिलाएँ (हमने भेजा: body ${fields.length} variable, header ${hdrImg ? 'image' : 'none'}; template में Header=Image हो तो WA_RECEIPT_HEADER_IMAGE भरें)`
        : code === 132001 ? ' → WA_RECEIPT_TEMPLATE नाम / WA_RECEIPT_LANG (hi / hi_IN) जाँचें'
        : code === 131042 ? ' → Meta में Payment method जोड़ें (WhatsApp Manager → Add payment method)'
        : code === 131047 ? ' → Customer की 24 घंटे की window बंद है, template चाहिए'
        : code === 190 ? ' → WA_TOKEN expire — नया permanent token डालें' : '';
      return await fail(`Meta ${code}: ${res.msg}${hint}${textErr ? ' | text: ' + textErr : ''}${imgErr ? ' | image: ' + imgErr : ''}`);
    }
    await c.query("UPDATE wa_receipts SET status='sent', delivery='accepted', meta_id=$2, phone=$3, error=NULL, data=data || jsonb_build_object('via',$4::text,'img_err',$5::text), updated_at=now() WHERE id=$1", [id, mid, phone, via, imgErr]);
    try { // Chatting history में भी दिखे
      await c.query("INSERT INTO wa_log (phone, dir, body, msg) VALUES ($1,'out',$2::jsonb,'RECEIPT')",
        [phone, JSON.stringify({ receipt: true, via, text: via === 'text' ? receiptText(env, d) : via === 'image' ? '🖼 ' + captionText(env, d) : `🧾 Payment Receipt (template${media ? ' + image' : ''}) भेजी — ${d.name} · ₹${d.amount} · ${d.mode} · ${d.date}` })]);
    } catch (_) {}
    return { id, ok: true, phone, via };
  } catch (e) {
    try { return await fail(e.name === 'AbortError' ? 'Meta timeout — Retry करें' : (e.message || e)); } catch (_) { return { id, ok: false, error: String(e.message || e) }; }
  }
}

/* नया connection खोल कर भेजो (response के बाद background में — ctx.waitUntil) */
export async function sendQueued(env, connect, ids, force = false) {
  const results = []; let c;
  try {
    c = await connect();
    for (const id of ids) results.push(await deliverReceipt(env, c, id, force));
  } catch (e) { results.push({ ok: false, error: String(e.message || e) }); }
  finally { try { await c?.end(); } catch (_) {} }
  return results;
}
