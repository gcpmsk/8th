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

/* ---------- sg_store helpers (app के same format: value = {v:...}) ---------- */
async function sgGet(c, key, def) {
  const r = await c.query('SELECT value FROM sg_store WHERE key=$1', [key]);
  const v = r.rows[0]?.value;
  if (!v || v.__deleted) return def;
  return v.v === undefined ? def : v.v;
}
async function sgSet(c, key, val) {
  await c.query(
    `INSERT INTO sg_store (key,value,updated_at) VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at, synced_at=now()`,
    [key, JSON.stringify({ v: val }), Date.now()]);
}
async function sesGet(c, phone) {
  const r = await c.query('SELECT state FROM wa_sessions WHERE phone=$1', [phone]);
  return r.rows[0]?.state || {};
}
async function sesSet(c, phone, st) {
  await c.query(
    `INSERT INTO wa_sessions (phone,state,updated_at) VALUES ($1,$2::jsonb,now())
     ON CONFLICT (phone) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`, [phone, JSON.stringify(st)]);
}
async function log(c, phone, dir, body) {
  try { await c.query('INSERT INTO wa_log (phone,dir,body) VALUES ($1,$2,$3::jsonb)', [phone, dir, JSON.stringify(body)]); } catch (_) {}
}

/* ---------- date / money ---------- */
const IST = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const todayIST = () => { const d = IST(); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`; };
const nowTS = () => { const d = IST(); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${String(h).padStart(2, '0')}:${m} ${ap}`; };
const F = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const N = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ---------- Meta send ---------- */
async function waSend(env, to, payload, c) {
  const body = Object.assign({ messaging_product: 'whatsapp', to }, payload);
  const r = await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = await r.json().catch(() => ({}));
  if (c) await log(c, to, r.ok ? 'out' : 'err', { req: body, res: out });
  return out;
}
const text = (t) => ({ type: 'text', text: { body: t } });
const buttons = (body, btns, header) => ({
  type: 'interactive',
  interactive: Object.assign({ type: 'button', body: { text: body },
    action: { buttons: btns.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: cut(b.t, 20) } })) } },
    header ? { header: { type: 'text', text: cut(header, 60) } } : {})
});
const list = (body, rows, opt = {}) => ({
  type: 'interactive',
  interactive: Object.assign({ type: 'list', body: { text: body },
    action: { button: cut(opt.btn || '👇 चुनें', 20),
      sections: [{ title: cut(opt.section || 'Options', 24),
        rows: rows.slice(0, 10).map(r => Object.assign({ id: r.id, title: cut(r.t, 24) }, r.d ? { description: cut(r.d, 72) } : {})) }] } },
    opt.header ? { header: { type: 'text', text: cut(opt.header, 60) } } : {},
    opt.footer ? { footer: { text: cut(opt.footer, 60) } } : {})
});

/* ---------- rates (app के sg_rates से — Master → Area ± adj → Customer special) ---------- */
function rateFor(R, area, custKey, k) {
  R = R || {}; const master = N((R.master || {})[k]);
  const adj = N(((R.areaAdj || {})[area] || {})[k]);
  const av = ((R.area || {})[area] || {})[k];
  let base = (av !== undefined && av !== '' && av !== null) ? N(av) : Math.max(0, master + adj);
  const sp = ((R.cust || {})[custKey] || {})[k];
  if (sp !== undefined && sp !== '' && sp !== null) base = Math.max(0, base - N(sp));
  return base;
}
/* item + pack → {name, unitLabel, perUnitRate, qtyMul, qtyUnit} */
function packInfo(cfg, R, area, custKey, itemId, sizeG, pack) {
  const it = (cfg.items || []).find(x => x.id === itemId); if (!it) return null;
  const r = rateFor(R, area, custKey, it.rk);
  if (it.sizes) {                                   // Sattu / Besan — rate ₹/kg
    const sz = it.sizes.find(s => s.g === sizeG) || it.sizes[0];
    const pkt = r * sz.g / 1000;                     // 1 packet का rate
    const name = `${it.name} ${sz.g}g`;
    if (pack === 'bora') return { name, unit: 'बोरा', rate: pkt * sz.bora, mul: sz.bora, qtyUnit: 'packet', pktRate: pkt, note: `1 बोरा = ${sz.bora} packet` };
    return { name, unit: 'packet', rate: pkt, mul: 1, qtyUnit: 'packet', pktRate: pkt, note: '' };
  }
  if (pack === 'bora' && it.bora > 1) return { name: it.name, unit: 'बोरा', rate: r * it.bora, mul: it.bora, qtyUnit: 'थैला', pktRate: r, note: `1 बोरा = ${it.bora} थैला` };
  return { name: it.name, unit: it.unit || 'थैला', rate: r, mul: 1, qtyUnit: it.unit || 'थैला', pktRate: r, note: '' };
}
const custKeyOf = n => String(n || '').trim().toUpperCase().replace(/\s+/g, ' ');

/* ---------- customer lookup (app हर 30s में sg_wa_cust लिखता है) ---------- */
async function findCust(c, phone) {
  const p10 = phone.slice(-10);
  const all = await sgGet(c, 'sg_wa_cust', {}) || {};
  if (all[p10]) return Object.assign({ known: true }, all[p10]);
  const link = await sgGet(c, 'sg_wa_link', {}) || {};
  if (link[p10]) return Object.assign({ known: false, due: 0, receipts: [], paid: [] }, link[p10]);
  return null;
}

/* =====================================================================
   MENU screens
   ===================================================================== */
function mainMenu(cust, cfg) {
  const hello = cust ? `🙏 नमस्ते *${cust.name}* जी!\n` : '🙏 नमस्ते!\n';
  const due = cust && cust.known ? `\n🔴 आपका बाक़ी: *${F(cust.due)}*\n` : '';
  return list(`${hello}🌾 *${cfg.shop || 'SATYAM GOLD'}* में आपका स्वागत है${due}\nनीचे बटन दबा कर चुनें 👇`, [
    { id: 'm_due', t: '💰 मेरा बाक़ी (Due)', d: 'अभी कितना बाक़ी है' },
    { id: 'm_order', t: '🛒 नया Order करें', d: 'Atta · Sattu · Besan — touch कर के' },
    { id: 'm_stmt', t: '📋 पूरा हिसाब (Statement)', d: 'पिछली receipts और payment' },
    { id: 'm_rate', t: '📈 आज का भाव', d: 'आपके लिए आज का rate' },
    { id: 'm_obj', t: '⚠️ Rate Objection', d: 'receipt में rate ज़्यादा लगा? यहाँ बताएँ' },
    { id: 'm_talk', t: '📞 बात करें', d: 'मालिक से सीधे बात' }
  ], { header: cfg.shop || 'SATYAM GOLD', btn: '📋 Menu', section: 'Main Menu', footer: 'कभी भी "Hi" लिखें → Menu' });
}
function itemMenu(cfg, R, cust) {
  const area = cust?.area || 'OTHER', ck = custKeyOf(cust?.name);
  const rows = (cfg.items || []).map(it => {
    const r = rateFor(R, area, ck, it.rk);
    const d = it.sizes ? `200g / 500g · ${F(r)}/kg` : `${F(r)} / ${it.unit || 'थैला'}${it.bora > 1 ? ` · बोरा(${it.bora}) ${F(r * it.bora)}` : ''}`;
    return { id: 'it_' + it.id, t: it.name, d };
  });
  rows.push({ id: 'm_home', t: '🏠 Main Menu' });
  return list('🛒 *नया Order*\nकौन सा item? 👇', rows, { header: 'Item चुनें', btn: '🌾 Item', section: 'Items' });
}

/* =====================================================================
   FLOW
   ===================================================================== */
async function handle(env, c, phone, input) {
  const cfg = (await sgGet(c, 'sg_wa_cfg', null)) || { items: [], shop: 'SATYAM GOLD' };
  const R = (await sgGet(c, 'sg_rates', {})) || {};
  let st = await sesGet(c, phone);
  const cust = await findCust(c, phone);
  const say = p => waSend(env, phone, p, c);
  const reset = async () => { st = {}; await sesSet(c, phone, st); };
  const raw = String(input || '').trim();
  const low = raw.toLowerCase();
  const free = !st.step;                       // कोई step चालू नहीं → 1-5 number shortcut चलेंगे

  /* --- hi / menu / cancel --- */
  if ((/^(hi|hello|hii+|menu|start|namaste|नमस्ते|hy)$/.test(low) || (free && low==='0')) || low === 'm_home') {
    await reset(); return say(mainMenu(cust, cfg));
  }
  if (/^(cancel|रद्द|x|✖)$/i.test(low) || low === 'cancel') { await reset(); return say(text('❌ रद्द कर दिया।\n"Hi" लिखें → Menu')); }

  /* --- नाम / पता (unknown number) --- */
  if (st.step === 'ask_name') {
    if (raw.length < 2) return say(text('कृपया अपना *नाम* लिखें:'));
    st.newName = raw; st.step = 'ask_addr'; await sesSet(c, phone, st);
    return say(text(`धन्यवाद *${raw}* जी!\n📍 अब अपना *पता / एरिया* लिखें (जैसे Khagaria, Mansi…):`));
  }
  if (st.step === 'ask_addr') {
    const link = (await sgGet(c, 'sg_wa_link', {})) || {};
    link[phone.slice(-10)] = { name: st.newName, address: raw, area: 'OTHER', ts: nowTS(), date: todayIST() };
    await sgSet(c, 'sg_wa_link', link);
    const nxt = st.after || 'm_home'; await reset();
    return handle(env, c, phone, nxt);
  }
  const needCust = async (after) => {
    if (cust) return false;
    st = { step: 'ask_name', after }; await sesSet(c, phone, st);
    await say(text('🙏 आपका नंबर हमारे पास save नहीं है।\nकृपया अपना *नाम* लिखें:'));
    return true;
  };

  /* ---------------- MAIN MENU items ---------------- */
  if (low === 'm_due' || (free && low === '1')) {
    if (!cust || !cust.known) return say(text('ℹ️ आपका नंबर किसी खाते से जुड़ा नहीं है।\n📞 मालिक से बात करें: +91 ' + (cfg.owner || '').slice(-10) + '\n\n"Hi" → Menu'));
    return say(buttons(`💰 *${cust.name}* जी\n📍 ${cust.address || ''}\n\n🔴 कुल बाक़ी: *${F(cust.due)}*\n🕐 ${nowTS()} · ${todayIST()}`,
      [{ id: 'm_stmt', t: '📋 पूरा हिसाब' }, { id: 'm_order', t: '🛒 नया Order' }, { id: 'm_home', t: '🏠 Menu' }]));
  }
  if (low === 'm_stmt' || (free && low === '3')) {
    if (!cust || !cust.known) return say(text('ℹ️ आपका खाता नहीं मिला। "Hi" → Menu'));
    const rc = (cust.receipts || []).slice(0, 8).map(r => `🧾 ${r.rdate} · R.No ${r.rno}\n   ${(r.items || []).map(i => `${i.name} ${i.qty}×${i.rate}`).join(', ')}\n   = *${F(r.total)}*${r.cut ? ' ✂ CUT' : ''}`).join('\n');
    const pd = (cust.paid || []).slice(0, 5).map(p => `✅ ${p.date} · ${F(p.amt)} (${p.mode || 'Cash'})`).join('\n');
    return say(text(`📋 *${cust.name}* — हिसाब\n\n*पिछली Receipts:*\n${rc || '—'}\n\n*Payment:*\n${pd || '—'}\n\n🔴 बाक़ी: *${F(cust.due)}*\n\n"Hi" → Menu`));
  }
  if (low === 'm_rate' || (free && low === '4')) {
    const area = cust?.area || 'OTHER', ck = custKeyOf(cust?.name);
    const lines = (cfg.items || []).map(it => { const r = rateFor(R, area, ck, it.rk);
      return it.sizes ? `• ${it.name}: ${F(r)}/kg  (200g ${F(r * .2)} · 500g ${F(r * .5)})` : `• ${it.name}: *${F(r)}* / ${it.unit || 'थैला'}${it.bora > 1 ? `  · बोरा ${F(r * it.bora)}` : ''}`; });
    return say(buttons(`📈 *आज का भाव* (${todayIST()})${cust ? `\n👤 ${cust.name}` : ''}\n\n${lines.join('\n')}`,
      [{ id: 'm_order', t: '🛒 Order करें' }, { id: 'm_home', t: '🏠 Menu' }]));
  }
  if (low === 'm_talk' || (free && low === '5')) {
    return say(text(`📞 मालिक से बात करें:\n+91 ${(cfg.owner || '').slice(-10)}\n\nया यहीं message लिखें — हम जवाब देंगे।\n\n"Hi" → Menu`));
  }

  /* ---------------- ORDER ---------------- */
  if (low === 'm_order' || (free && low === '2')) {
    if (await needCust('m_order')) return;
    st = { step: 'item' }; await sesSet(c, phone, st);
    return say(itemMenu(cfg, R, cust));
  }
  if (low.startsWith('it_')) {
    const it = (cfg.items || []).find(x => 'it_' + x.id === low); if (!it) return say(itemMenu(cfg, R, cust));
    st = { step: 'pack', item: it.id }; 
    if (it.sizes) { st.step = 'size'; await sesSet(c, phone, st);
      const r = rateFor(R, cust?.area || 'OTHER', custKeyOf(cust?.name), it.rk);
      return say(buttons(`*${it.name}* — packet size चुनें\n\n📦 200g = ${F(r * .2)} / packet\n📦 500g = ${F(r * .5)} / packet`,
        it.sizes.map(s => ({ id: 'sz_' + s.g, t: `${s.g}g` })).concat([{ id: 'm_order', t: '↩ Items' }])));
    }
    await sesSet(c, phone, st);
    return askPack(say, cfg, R, cust, st);
  }
  if (low.startsWith('sz_') && st.item) {
    st.size = parseInt(low.slice(3), 10); st.step = 'pack'; await sesSet(c, phone, st);
    return askPack(say, cfg, R, cust, st);
  }
  if ((low === 'pk_thaila' || low === 'pk_bora') && st.item) {
    st.pack = low === 'pk_bora' ? 'bora' : 'thaila'; st.step = 'qty'; await sesSet(c, phone, st);
    const pi = packInfo(cfg, R, cust?.area || 'OTHER', custKeyOf(cust?.name), st.item, st.size, st.pack);
    return say(text(`✏️ *${pi.name}* — कितना *${pi.unit}*?\n💵 Rate: ${F(pi.rate)} / ${pi.unit}${pi.note ? `  (${pi.note})` : ''}\n\n👉 सिर्फ़ *संख्या* लिखें (जैसे 5)`));
  }
  if (st.step === 'qty' && st.item) {
    const q = N(raw.replace(/[^\d.]/g, ''));
    if (!(q > 0)) return say(text('❗ सिर्फ़ संख्या लिखें (जैसे 5)'));
    const pi = packInfo(cfg, R, cust?.area || 'OTHER', custKeyOf(cust?.name), st.item, st.size, st.pack);
    st.qty = q; st.step = 'confirm'; st.pi = pi; await sesSet(c, phone, st);
    const total = q * pi.rate, units = q * pi.mul;
    return say(buttons(`🧾 *Order Confirm करें*\n\n${pi.name}\n${q} ${pi.unit}${pi.mul > 1 ? ` (= ${units} ${pi.qtyUnit})` : ''} × ${F(pi.rate)}\n= *${F(total)}*\n\n👤 ${cust?.name || ''} · ${cust?.address || ''}`,
      [{ id: 'ok_order', t: '✅ Confirm' }, { id: 'more_item', t: '➕ और Item' }, { id: 'cancel', t: '❌ Cancel' }]));
  }
  if ((low === 'ok_order' || low === 'more_item') && st.step === 'confirm' && st.pi) {
    const pi = st.pi, q = st.qty;
    const lines = st.lines || [];
    lines.push({ name: pi.name, qty: q * pi.mul, rate: pi.pktRate, pack: `${q} ${pi.unit}`, note: pi.note });
    if (low === 'more_item') { st = { step: 'item', lines }; await sesSet(c, phone, st); return say(itemMenu(cfg, R, cust)); }
    /* ---- Order Book में save (app की same key sg_ord_<date>) ---- */
    const date = todayIST(), key = 'sg_ord_' + date;
    await c.query('BEGIN');
    try {
      const r = await c.query('SELECT value FROM sg_store WHERE key=$1 FOR UPDATE', [key]);
      const cur = (r.rows[0]?.value && !r.rows[0].value.__deleted) ? (r.rows[0].value.v || []) : [];
      let mx = 0; const nr = await c.query(`SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%'`);
      nr.rows.forEach(x => ((x.value && x.value.v) || []).forEach(o => { const n = parseInt(o.no, 10); if (n > mx) mx = n; }));
      const order = {
        id: 'w' + Date.now() + Math.floor(Math.random() * 99), no: String(mx + 1).padStart(2, '0'), ts: nowTS(),
        name: cust.name, nameHi: cust.nameHi || '', address: cust.address || '', addressHi: cust.addressHi || '',
        items: lines.map(l => ({ name: l.name, qty: l.qty, rate: String(l.rate), note: l.pack + (l.note ? ' · ' + l.note : '') })),
        ordered: lines.map(l => ({ name: l.name, qty: l.qty })), deliv: [], wa: true, phone
      };
      cur.push(order);
      await c.query(
        `INSERT INTO sg_store (key,value,updated_at) VALUES ($1,$2::jsonb,$3)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at, synced_at=now()`,
        [key, JSON.stringify({ v: cur }), Date.now()]);
      await c.query('COMMIT');
      const tot = lines.reduce((a, l) => a + l.qty * l.rate, 0);
      const body = lines.map(l => `• ${l.name} — ${l.pack} (${l.qty} × ${F(l.rate)}) = ${F(l.qty * l.rate)}`).join('\n');
      await reset();
      await say(buttons(`✅ *Order No ${order.no} book हो गया!*\n\n${body}\n\n💰 कुल: *${F(tot)}*\n🕐 ${order.ts} · ${date}\n\nधन्यवाद 🙏 माल जल्दी पहुँचेगा।`,
        [{ id: 'm_order', t: '🛒 और Order' }, { id: 'm_home', t: '🏠 Menu' }]));
      if (cfg.owner) await waSend(env, cfg.owner, text(`🛒 *WhatsApp Order #${order.no}*\n👤 ${cust.name} · ${cust.address || ''}\n📱 +${phone}\n${body}\n💰 ${F(tot)}\n🕐 ${order.ts}`), c);
      return;
    } catch (e) { await c.query('ROLLBACK'); await reset(); return say(text('❌ Order save नहीं हुआ, फिर से कोशिश करें। "Hi" → Menu')); }
  }

  /* ---------------- RATE OBJECTION ---------------- */
  if (low === 'm_obj') {
    if (!cust || !cust.known || !(cust.receipts || []).length) return say(text('ℹ️ आपकी कोई receipt नहीं मिली।\n📞 मालिक: +91 ' + (cfg.owner || '').slice(-10) + '\n\n"Hi" → Menu'));
    st = { step: 'obj_rc' }; await sesSet(c, phone, st);
    const rows = cust.receipts.filter(r => !r.cut).slice(0, 9).map((r, i) => ({ id: 'orc_' + i, t: `R.No ${r.rno} · ${r.rdate}`, d: `${(r.items || []).map(x => `${x.name} ${x.qty}×${x.rate}`).join(', ')} = ${F(r.total)}` }));
    rows.push({ id: 'm_home', t: '🏠 Main Menu' });
    return say(list('⚠️ *Rate Objection*\nकिस receipt पर rate ज़्यादा लगा? 👇', rows, { header: 'Receipt चुनें', btn: '🧾 Receipt', section: 'आपकी Receipts' }));
  }
  if (low.startsWith('orc_') && st.step === 'obj_rc') {
    const rc = cust.receipts.filter(r => !r.cut)[parseInt(low.slice(4), 10)]; if (!rc) return say(text('❗ फिर से चुनें। "Hi" → Menu'));
    st.rc = rc;
    if ((rc.items || []).length > 1) { st.step = 'obj_it'; await sesSet(c, phone, st);
      return say(list(`🧾 R.No ${rc.rno} · ${rc.rdate}\nकौन सा item? 👇`, rc.items.slice(0, 10).map((x, i) => ({ id: 'oit_' + i, t: x.name, d: `${x.qty} × ${F(x.rate)} = ${F(x.amount || x.qty * x.rate)}` })), { header: 'Item चुनें', btn: '📦 Item' }));
    }
    st.ii = 0; st.step = 'obj_rate'; await sesSet(c, phone, st);
    const x = rc.items[0];
    return say(text(`🧾 R.No ${rc.rno} · ${rc.rdate}\n📦 *${x.name}* — ${x.qty} × *${F(x.rate)}*\n\n✏️ आपके हिसाब से सही *rate* क्या होना चाहिए? (सिर्फ़ संख्या)`));
  }
  if (low.startsWith('oit_') && st.step === 'obj_it') {
    st.ii = parseInt(low.slice(4), 10); st.step = 'obj_rate'; await sesSet(c, phone, st);
    const x = st.rc.items[st.ii];
    return say(text(`📦 *${x.name}* — ${x.qty} × *${F(x.rate)}*\n\n✏️ आपके हिसाब से सही *rate* क्या होना चाहिए? (सिर्फ़ संख्या)`));
  }
  if (st.step === 'obj_rate' && st.rc) {
    const nr = N(raw.replace(/[^\d.]/g, '')); if (!(nr > 0)) return say(text('❗ सिर्फ़ संख्या लिखें (जैसे 320)'));
    const x = st.rc.items[st.ii || 0];
    const objs = (await sgGet(c, 'sg_wa_obj', [])) || [];
    const ob = { id: 'ob' + Date.now(), phone, name: cust.name, address: cust.address || '', custKey: cust.key || custKeyOf(cust.name),
      sdate: st.rc.sdate, rdate: st.rc.rdate, rno: st.rc.rno, rcIdx: st.rc.idx, item: x.name, qty: x.qty, oldRate: N(x.rate), newRate: nr,
      total: N(st.rc.total), status: 'open', ts: nowTS(), date: todayIST() };
    objs.push(ob); await sgSet(c, 'sg_wa_obj', objs.slice(-500));
    await reset();
    await say(buttons(`📨 *Objection दर्ज हो गई*\n\n🧾 R.No ${ob.rno} · ${ob.rdate}\n📦 ${ob.item} ${ob.qty}\nReceipt rate: ${F(ob.oldRate)}  →  आपका rate: *${F(nr)}*\n\nमालिक देख कर जवाब देंगे 🙏`,
      [{ id: 'm_home', t: '🏠 Menu' }]));
    if (cfg.owner) await waSend(env, cfg.owner, text(`⚠️ *Rate Objection*\n👤 ${cust.name} · ${cust.address || ''}\n🧾 R.No ${ob.rno} · ${ob.rdate}\n📦 ${ob.item} ${ob.qty} × ${F(ob.oldRate)} → चाहते हैं *${F(nr)}*\n\nApp → Order Book → 📣 Objection में देखें`), c);
    return;
  }

  /* --- कुछ समझ न आये → menu --- */
  await reset();
  return say(mainMenu(cust, cfg));
}
async function askPack(say, cfg, R, cust, st) {
  const area = cust?.area || 'OTHER', ck = custKeyOf(cust?.name);
  const th = packInfo(cfg, R, area, ck, st.item, st.size, 'thaila');
  const bo = packInfo(cfg, R, area, ck, st.item, st.size, 'bora');
  if (!bo || bo.mul <= 1) return say(text(`✏️ *${th.name}* — कितना *${th.unit}*?\n💵 Rate: ${F(th.rate)} / ${th.unit}\n\n👉 सिर्फ़ *संख्या* लिखें (जैसे 5)`)).then(() => null);
  return say(buttons(`*${th.name}* — ${th.unit === 'packet' ? 'Packet' : 'थैला'} या बोरा?\n\n${th.unit === 'packet' ? '📦 Packet' : '👜 थैला'} = ${F(th.rate)}\n🧺 बोरा = ${F(bo.rate)}  (${bo.note})`,
    [{ id: 'pk_thaila', t: th.unit === 'packet' ? '📦 Packet' : '👜 थैला' }, { id: 'pk_bora', t: '🧺 बोरा' }, { id: 'm_order', t: '↩ Items' }]));
}

/* =====================================================================
   HTTP
   ===================================================================== */
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === (env.WA_VERIFY_TOKEN || 'satyamgold')) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch (_) { return ok(); }
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return ok();
  let c;
  try {
    c = await db(env);
    const phone = String(msg.from || '');
    let input = '';
    if (msg.type === 'text') input = msg.text?.body || '';
    else if (msg.type === 'interactive') input = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || '';
    else if (msg.type === 'button') input = msg.button?.payload || msg.button?.text || '';
    await log(c, phone, 'in', { type: msg.type, input, id: msg.id });
    /* डुप्लीकेट webhook (Meta दोबारा भेजता है) */
    const dup = await c.query(`SELECT 1 FROM wa_log WHERE dir='in' AND body->>'id'=$1 LIMIT 2`, [msg.id || '']);
    if (dup.rowCount > 1) return ok({ dup: true });
    /* qty / rate step में कोई भी text सीधे handle हो — बाक़ी में state-step check अंदर है */
    await handle(env, c, phone, input);
  } catch (e) {
    try { await log(c, msg.from, 'err', { error: String(e.message || e) }); } catch (_) {}
  } finally { try { await c?.end(); } catch (_) {} }
  return ok();
}
