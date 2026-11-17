import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Real Postgres engine in memory + mocked Meta. Never touches production or sends a WhatsApp.
const sql = await readFile(new URL('./whatsapp-schema.sql', import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(sql);
class Client {
  async connect() {} async end() {}
  // real pg: query(text) without params = simple protocol (multi-statement OK). PGlite needs exec() for that.
  async query(q, p) {
    const r = p === undefined ? ((await db.exec(q)).at(-1) || { rows: [] }) : await db.query(q, p);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  }
}
let sends = [], medias = [], metaMode = 'ok';
const context = vm.createContext({ Response, Request, URL, console, crypto: webcrypto, TextEncoder, AbortController, FormData, Blob, setTimeout, clearTimeout,
  fetch: async (url, init) => {
    if (String(url).endsWith('/media')) { medias.push(init.body); return new Response(JSON.stringify({ id: 'MEDIA' + medias.length }), { status: 200 }); }
    const payload = JSON.parse(init.body); sends.push(payload);
    if (metaMode === 'textfail' && payload.type === 'text') return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 });
    if (metaMode === 'ok' || metaMode === 'textfail') return new Response(JSON.stringify({ messages: [{ id: 'wamid.' + sends.length }] }), { status: 200 });
    if (metaMode === 'params') return new Response(JSON.stringify({ error: { code: 132000, message: 'Number of parameters does not match' } }), { status: 400 });
    return new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 401 });
  } });
const cache = new Map();
async function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const url = new URL(rel, import.meta.url);
  const m = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
  cache.set(rel, m);
  await m.link(async spec => {
    if (spec === 'pg') return new vm.SyntheticModule(['Client'], function () { this.setExport('Client', Client); }, { context });
    return load(new URL(spec, url).href);
  });
  return m;
}
const sync = await load('./functions/api/sync.js'); await sync.evaluate();
const owner = await load('./functions/api/wa-owner.js'); await owner.evaluate();
const env = { DATABASE_URL: 'x', WA_TOKEN: 't', WA_PHONE_ID: 'p', WA_ADMIN_TOKEN: 'own', WA_RECEIPT_PARAMS: 'name,amount,date,mode', WA_RECEIPT_IMAGE: 'off' };

async function store(key, value) {
  await db.query(`INSERT INTO sg_store(key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, JSON.stringify({ v: value })]);
}
async function push(day, jama, e = env) {
  const bg = [];
  const r = await sync.namespace.onRequestPost({ env: e, waitUntil: p => bg.push(p),
    request: new Request('https://x/api/sync', { method: 'POST', body: JSON.stringify({ items: [{ key: 'sg_nb_' + day, value: { jama }, updated_at: Date.now() }] }) }) });
  await Promise.all(bg); return r.json();
}
const rid = (s = 'a') => 'j' + Date.now() + s;
const rows = async () => (await db.query('SELECT * FROM wa_receipts ORDER BY id')).rows;
const own = async (method, qs, body, key = 'own') => {
  const f = method === 'GET' ? owner.namespace.onRequestGet : owner.namespace.onRequestPost;
  const r = await f({ env, request: new Request('https://x/api/wa-owner' + qs, { method, headers: { Authorization: 'Bearer ' + key }, ...(body ? { body: JSON.stringify(body) } : {}) }) });
  return { status: r.status, body: await r.json() };
};

await store('sg_mobiles', { 'RAHUL KUMAR': '98765 43210' });

await test('Notebook jama → ek hi receipt, double submit pe bhi sirf ek baar', async () => {
  const j = { name: 'Rahul Kumar', address: 'Bikram', amount: 500, online: 0, ts: '10:00 AM', cut: false, rid: rid('a') };
  const a = await push('15-11-2026', [j]);
  assert.equal(a.receipts, 1);
  await push('15-11-2026', [j]);                       // same entry dobara sync (double click / 2 devices)
  await push('15-11-2026', [j, { ...j, ts: '10:01 AM' }]);
  const r = await rows();
  assert.equal(r.length, 1); assert.equal(r[0].status, 'sent'); assert.equal(sends.length, 1);
  assert.equal(sends[0].to, '919876543210');
  assert.equal(sends[0].template.name, 'satyam_payment_receipt');
  assert.deepEqual(sends[0].template.components[0].parameters.map(p => p.text), ['Rahul Kumar', '500', '15-11-2026', 'Cash']);
  assert.equal(JSON.parse(JSON.stringify(sends[0].template.language)).code, 'hi');
});
await test('Collection entry / cut / purani / bina rid wali entry ki receipt nahi', async () => {
  const before = (await rows()).length;
  await push('15-11-2026', [
    { name: 'Rahul Kumar', amount: 100, rid: rid('b'), fromColl: true },
    { name: 'Rahul Kumar', amount: 100, rid: rid('c'), cut: true },
    { name: 'Rahul Kumar', amount: 100, rid: 'j' + (Date.now() - 10 * 864e5) + 'd' },
    { name: 'Rahul Kumar', amount: 100 }]);
  assert.equal((await rows()).length, before);
});
await test('mobile nahi to Failed + karan; mobile bharne ke baad Retry se ek hi baar jaye', async () => {
  const n = sends.length;
  await push('15-11-2026', [{ name: 'Sunita Devi', amount: 250, online: 250, rid: rid('e'), ts: '11:00 AM' }]);
  let r = (await rows()).at(-1);
  assert.equal(r.status, 'failed'); assert.match(r.error, /number नहीं मिला/); assert.equal(sends.length, n);
  const list = await own('GET', '?view=receipts');
  assert.equal(list.body.counts.failed, 1); assert.equal(list.body.receipts[0].name, 'Sunita Devi');
  await store('sg_mobiles', { 'RAHUL KUMAR': '9876543210', 'SUNITA DEVI': '9123456780' });
  const a = await own('POST', '', { action: 'retry', id: r.id });
  assert.equal(a.body.sent, 1); assert.equal(sends.at(-1).to, '919123456780');
  assert.equal(JSON.parse(JSON.stringify(sends.at(-1).template.components[0].parameters[3])).text, 'Online');
  const b = await own('POST', '', { action: 'retry', id: r.id });   // double tap on Retry
  assert.equal(sends.length, n + 1); assert.equal(b.body.sent, 0);
  r = (await rows()).at(-1); assert.equal(r.status, 'sent');
});
await test('Meta error (param count) Failed me hint ke saath; retry_all', async () => {
  metaMode = 'params';
  await push('15-11-2026', [{ name: 'Rahul Kumar', amount: 75, rid: rid('f'), ts: '12:00 PM' }]);
  let r = (await rows()).at(-1);
  assert.equal(r.status, 'failed'); assert.match(r.error, /WA_RECEIPT_PARAMS/);
  metaMode = 'ok'; const n = sends.length;
  const all = await own('POST', '', { action: 'retry_all' });
  assert.equal(all.body.sent, 1); assert.equal(sends.length, n + 1);
  assert.equal((await own('GET', '?view=receipts')).body.counts.failed, 0);
});
await test('WA_RECEIPT_PARAMS=none → body me variable nahi; header image link optional', async () => {
  const n = sends.length;
  await push('15-11-2026', [{ name: 'Rahul Kumar', amount: 11, rid: rid('n'), ts: '12:05 PM' }], { ...env, WA_RECEIPT_PARAMS: 'none' });
  assert.equal(sends.length, n + 1);
  assert.equal(sends.at(-1).template.components, undefined);
  await push('15-11-2026', [{ name: 'Rahul Kumar', amount: 12, rid: rid('m'), ts: '12:06 PM' }], { ...env, WA_RECEIPT_PARAMS: 'none', WA_RECEIPT_HEADER_IMAGE: 'https://x.test/h.png' });
  const comps = JSON.parse(JSON.stringify(sends.at(-1).template.components));
  assert.equal(comps.length, 1); assert.equal(comps[0].type, 'header'); assert.equal(comps[0].parameters[0].image.link, 'https://x.test/h.png');
  await push('15-11-2026', [{ name: 'Rahul Kumar', amount: 13, rid: rid('o'), ts: '12:07 PM' }], { ...env, WA_RECEIPT_HEADER_IMAGE: 'https://x.test/h.png' });
  const c2 = JSON.parse(JSON.stringify(sends.at(-1).template.components));
  assert.deepEqual(c2.map(c => c.type), ['header', 'body']);
});
await test('Customer ki 24 ghante ki window khuli ho → sada TEXT receipt (template/image nahi); band ho → template', async () => {
  await store('sg_mobiles', { 'RAHUL KUMAR': '98765 43210', 'TEXT PARTY': '90000 11111' });
  await db.exec("DELETE FROM wa_log");
  let n = sends.length;
  await push('15-11-2026', [{ name: 'Text Party', amount: 21, rid: rid('t1'), ts: '01:00 PM' }]);   // window band → template
  assert.equal(sends.length, n + 1); assert.equal(sends.at(-1).type, 'template');
  await db.query("INSERT INTO wa_log(phone,dir,body,msg) VALUES ('919000011111','in','{\"text\":\"Hi\"}'::jsonb,'Hi')");
  n = sends.length;
  await push('15-11-2026', [{ name: 'Text Party', amount: 22, rid: rid('t2'), ts: '01:01 PM' }]);   // window khuli → text
  assert.equal(sends.length, n + 1);
  const m = JSON.parse(JSON.stringify(sends.at(-1)));
  assert.equal(m.type, 'text'); assert.equal(m.template, undefined); assert.equal(m.to, '919000011111');
  assert.match(m.text.body, /Text Party/); assert.match(m.text.body, /₹22/); assert.match(m.text.body, /15-11-2026/);
  const r = (await rows()).at(-1); assert.equal(r.status, 'sent'); assert.equal(r.data.via, 'text');
  const lg = (await db.query("SELECT body FROM wa_log WHERE dir='out' ORDER BY id DESC LIMIT 1")).rows[0].body;
  assert.equal(lg.receipt, true); assert.match(lg.text, /₹22/);     // Chatting me poora receipt dikhe
});
await test('text Meta ne reject kare to template par fallback; WA_RECEIPT_MODE=template/text', async () => {
  await db.query("INSERT INTO wa_log(phone,dir,body,msg) VALUES ('919000011111','in','{\"text\":\"Hi\"}'::jsonb,'Hi')");
    metaMode = 'textfail'; const n = sends.length;
  await push('15-11-2026', [{ name: 'Text Party', amount: 23, rid: rid('t3'), ts: '01:02 PM' }]);
  assert.deepEqual(sends.slice(n).map(x => x.type), ['text', 'template']);
  assert.equal((await rows()).at(-1).data.via, 'template');
  metaMode = 'ok';
  const k = sends.length;
  await push('15-11-2026', [{ name: 'Text Party', amount: 24, rid: rid('t4'), ts: '01:03 PM' }], { ...env, WA_RECEIPT_MODE: 'template' });
  assert.equal(sends.length, k + 1); assert.equal(sends.at(-1).type, 'template');
  await push('15-11-2026', [{ name: 'Text Party', amount: 25, rid: rid('t5'), ts: '01:04 PM' }], { ...env, WA_RECEIPT_MODE: 'text', WA_RECEIPT_TEXT: 'Namaste {name}, Rs {amount} mile.' });
  assert.equal(sends.at(-1).text.body, 'Namaste Text Party, Rs 25 mile.');
  await db.exec("DELETE FROM wa_log");
  const z = sends.length;
  await push('15-11-2026', [{ name: 'Text Party', amount: 26, rid: rid('t6'), ts: '01:05 PM' }], { ...env, WA_RECEIPT_MODE: 'text' });
  assert.equal(sends.length, z); assert.match((await rows()).at(-1).error, /24 घंटे/);
  await own('POST', '', { action: 'retry_all' });
});
await test('Meta delivery status failed → receipt Failed list me; delivered/read track hota hai', async () => {
  const r = (await rows()).at(-1);
  await db.query("SELECT wa_receipt_status($1,'delivered','')", [r.meta_id]);
  assert.equal((await rows()).at(-1).delivery, 'delivered');
  await db.query("SELECT wa_receipt_status($1,'failed','Message undeliverable')", [r.meta_id]);
  const x = (await rows()).at(-1); assert.equal(x.status, 'failed'); assert.match(x.error, /undeliverable/);
});
await test('owner key ke bina API band', async () => {
  assert.equal((await own('GET', '?view=receipts', null, 'bad')).status, 401);
  assert.equal((await own('POST', '', { action: 'retry_all' }, 'bad')).status, 401);
});
await test('Chatting: date-wise customers list aur poori history (receipt bhi)', async () => {
  await db.exec(`DELETE FROM wa_log;
    INSERT INTO wa_log(phone,dir,body,msg,created_at) VALUES
     ('919876543210','in','{"text":"Hi","via":"wa_handle"}','Hi','2026-11-14 04:30:00+00'),
     ('919876543210','out','{"messaging_product":"whatsapp","type":"interactive","interactive":{"type":"button","body":{"text":"नमस्ते Rahul जी"},"action":{"buttons":[{"type":"reply","reply":{"id":"m_due","title":"मेरा बाक़ी"}}]}}}',NULL,'2026-11-14 04:30:01+00'),
     ('919876543210','in','{"text":"m_order","via":"wa_handle"}','m_order','2026-11-14 04:31:00+00'),
     ('919876543210','in','{"type":"text","input":"Hi","id":"wamid.x"}',NULL,'2026-11-14 04:30:00+00'),
     ('919111111111','in','{"text":"Hi","via":"wa_handle"}','Hi','2026-11-15 04:30:00+00');`);
  const days = await own('GET', '?view=chats&date=14-11-2026');
  assert.equal(days.body.total, 1); assert.equal(days.body.chats[0].name, ''); assert.equal(days.body.chats[0].phone, '919876543210');
  assert.ok(days.body.days.some(d => d.d === '15-11-2026'));
  const chat = await own('GET', '?view=chat&phone=919876543210&date=14-11-2026');
  assert.deepEqual(chat.body.messages.map(m => m.dir), ['in', 'out', 'in']);
  assert.match(chat.body.messages[1].text, /नमस्ते Rahul जी/); assert.match(chat.body.messages[1].text, /मेरा बाक़ी/);
  assert.match(chat.body.messages[2].text, /नया Order/);
  assert.equal((await own('GET', '?view=chat&phone=919876543210&date=13-11-2026')).body.messages.length, 0);
  assert.equal((await own('GET', '?view=chat&phone=abc&date=14-11-2026')).status, 400);
});

await test('IMAGE receipt: 24h window me image+caption, bahar ho to template header=image (id), 132000 par body-bina retry', async () => {
  const envI = { ...env, WA_RECEIPT_IMAGE: 'on', __renderReceipt: async d => { renderedFor.push(d); return new Uint8Array([137, 80, 78, 71]); } };
  const renderedFor = [];
  await store('sg_mobiles', { 'IMG PARTY': '90000 22222' });
  await db.exec("DELETE FROM wa_log");
  let n = sends.length, m = medias.length;
  await push('15-11-2026', [{ name: 'Img Party', amount: 310, rid: rid('i1'), ts: '02:00 PM' }], envI);   // window band → template + image header
  assert.equal(medias.length, m + 1); assert.equal(sends.length, n + 1);
  let p = JSON.parse(JSON.stringify(sends.at(-1)));
  assert.equal(p.type, 'template'); assert.deepEqual(p.template.components[0], { type: 'header', parameters: [{ type: 'image', image: { id: 'MEDIA' + medias.length } }] });
  assert.equal(renderedFor.at(-1).name, 'Img Party'); assert.equal(renderedFor.at(-1).amount, '310'); assert.equal(renderedFor.at(-1).date, '15-11-2026');
  let r = (await rows()).at(-1); assert.equal(r.status, 'sent'); assert.equal(r.data.via, 'template');
  await db.query("INSERT INTO wa_log(phone,dir,body,msg) VALUES ('919000022222','in','{\"text\":\"Hi\"}'::jsonb,'Hi')");
  n = sends.length;
  await push('15-11-2026', [{ name: 'Img Party', amount: 320, rid: rid('i2'), ts: '02:01 PM' }], envI);   // window khuli → image + caption
  p = JSON.parse(JSON.stringify(sends.at(-1))); assert.equal(sends.length, n + 1);
  assert.equal(p.type, 'image'); assert.match(p.image.caption, /Img Party/); assert.match(p.image.caption, /₹320/); assert.ok(p.image.id.startsWith('MEDIA'));
  r = (await rows()).at(-1); assert.equal(r.data.via, 'image');
  const lg = (await db.query("SELECT body FROM wa_log WHERE dir='out' ORDER BY id DESC LIMIT 1")).rows[0].body; assert.equal(lg.receipt, true);
  // template me body variable nahi → 132000 → bina body ke dobara
  await db.exec("DELETE FROM wa_log"); metaMode = 'params';
  const origFetch = context.fetch; let calls = 0;
  context.fetch = async (url, init) => { if (String(url).endsWith('/media')) return origFetch(url, init); const pl = JSON.parse(init.body); sends.push(pl); calls++;
    const hasBody = (pl.template?.components || []).some(c => c.type === 'body');
    return hasBody ? new Response(JSON.stringify({ error: { code: 132000, message: 'params mismatch' } }), { status: 400 }) : new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }); };
  await push('15-11-2026', [{ name: 'Img Party', amount: 330, rid: rid('i3'), ts: '02:02 PM' }], envI);
  context.fetch = origFetch; metaMode = 'ok';
  assert.equal(calls, 2); assert.equal((await rows()).at(-1).status, 'sent');
  // image banane/upload me gadbad → receipt phir bhi text/template se jaye
  const bad = { ...envI, __renderReceipt: async () => { throw new Error('boom'); } };
  await db.query("INSERT INTO wa_log(phone,dir,body,msg) VALUES ('919000022222','in','{\"text\":\"Hi\"}'::jsonb,'Hi')");
  await push('15-11-2026', [{ name: 'Img Party', amount: 340, rid: rid('i4'), ts: '02:03 PM' }], bad);
  assert.equal(sends.at(-1).type, 'text'); r = (await rows()).at(-1); assert.equal(r.status, 'sent'); assert.equal(r.data.img_err, 'boom');
});
