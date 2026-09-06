import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine in memory; never uses production DB or sends a WhatsApp.
const sql = await readFile(new URL('./whatsapp-schema.sql', import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(`
  CREATE TABLE wa_log (id BIGSERIAL PRIMARY KEY, phone TEXT, dir TEXT NOT NULL,
    body JSONB, created_at TIMESTAMPTZ DEFAULT now());
  INSERT INTO wa_log(phone,dir,body) VALUES ('919000000001','in','{"text":"keep this"}');
  CREATE TABLE wa_rates (note TEXT);
  INSERT INTO wa_rates VALUES ('keep old rates');
  CREATE TABLE wa_sessions (phone TEXT PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
  INSERT INTO wa_sessions(phone,state) VALUES ('919000000001','{"step":"keep"}');
`);
await db.exec(sql);

let sends = [], rejectMeta = false, dbUnavailable = false;
class Client {
  async connect() { if (dbUnavailable) throw new Error('test database unavailable'); }
  async end() {}
  async query(query, params) {
    const result = await db.query(query, params);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  }
}
const context = vm.createContext({
  Response, Request, URL, console,
  fetch: async (url, init) => {
    assert.match(url, /^https:\/\/graph.facebook.com\//);
    const payload = JSON.parse(init.body);
    sends.push(payload);
    const i = payload.interactive;
    if (i?.type === 'button') {
      assert.ok(i.action.buttons.length <= 3);
      i.action.buttons.forEach(b => assert.ok(b.reply.title.length <= 20));
      assert.ok(i.body.text.length <= 1024);
    }
    if (i?.type === 'list') {
      assert.ok(i.action.sections[0].rows.length <= 10);
      i.action.sections[0].rows.forEach(r => assert.ok(r.title.length <= 24));
    }
    return new Response(JSON.stringify(rejectMeta ? { error: { code: 190, message: 'Test expired token' } }
      : { messages: [{ id: 'out-' + sends.length }] }), { status: rejectMeta ? 401 : 200 });
  }
});
const mod = new vm.SourceTextModule(await readFile(new URL('./functions/api/wa.js', import.meta.url), 'utf8'), { context });
await mod.link(() => new vm.SyntheticModule(['Client'], function () { this.setExport('Client', Client); }, { context }));
await mod.evaluate();
const env = { DATABASE_URL: 'postgresql://test', WA_TOKEN: 'test', WA_PHONE_ID: 'test', WA_VERIFY_TOKEN: 'test-verify' };
const phone = '919000000002';
let seq = 0;
const msg = (input, type = 'text', id = 'test-' + (++seq)) => ({ from: phone, id, type,
  ...(type === 'text' ? { text: { body: input } } : type === 'interactive'
    ? { interactive: { button_reply: { id: input } } } : { button: { payload: input } }) });
async function post(body, vars = env) {
  const r = await mod.namespace.onRequestPost({ request: new Request('https://example.test/api/wa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env: vars });
  return { status: r.status, body: await r.json() };
}
async function send(input, type = 'text') { return post({ messages: [msg(input, type)] }); }
async function store(key, value) {
  await db.query(`INSERT INTO sg_store(key,value) VALUES ($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, JSON.stringify({ v: value })]);
}
async function session() { return (await db.query('SELECT state FROM wa_sessions WHERE phone=$1', [phone])).rows[0]?.state; }

await test('migration preserves old logs, sessions, rates and configured values on rerun', async () => {
  const cfg = (await db.query("SELECT value FROM sg_store WHERE key='sg_wa_cfg'")).rows[0].value.v;
  cfg.shop = 'TEST SHOP'; cfg.owner = '';
  await store('sg_wa_cfg', cfg);
  await store('sg_ord_01-01-2026', [{ no: '07', items: [] }]);
  await db.exec(sql);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM wa_log')).rows[0].n, 1);
  assert.equal((await db.query('SELECT note FROM wa_rates')).rows[0].note, 'keep old rates');
  assert.equal((await db.query('SELECT state FROM wa_sessions')).rows[0].state.step, 'keep');
  assert.equal((await db.query("SELECT value FROM sg_store WHERE key='sg_wa_cfg'")).rows[0].value.v.shop, 'TEST SHOP');
  assert.equal((await db.query("SELECT value FROM sg_store WHERE key='sg_ord_01-01-2026'")).rows[0].value.v[0].no, '07');
});
await test('log aliases work for old and new inserts and updates', async () => {
  const r = await db.query("INSERT INTO wa_log(mobile,direction,body) VALUES ('919000000003','out','\"hello\"') RETURNING *");
  assert.equal(r.rows[0].phone, r.rows[0].mobile);
  assert.equal(r.rows[0].dir, 'out');
  assert.deepEqual(r.rows[0].body, { text: 'hello' });
  const u = await db.query("UPDATE wa_log SET dir='err' WHERE id=$1 RETURNING direction", [r.rows[0].id]);
  assert.equal(u.rows[0].direction, 'err');
  const u2 = await db.query("UPDATE wa_log SET direction='in' WHERE id=$1 RETURNING dir", [r.rows[0].id]);
  assert.equal(u2.rows[0].dir, 'in');
});
await test('Hi and Hii reply with SBI-style buttons, direct Meta envelope works', async () => {
  sends = [];
  assert.equal((await send('Hi')).status, 200);
  assert.deepEqual(sends.at(-1).interactive.action.buttons.map(b => b.reply.id), ['m_due', 'm_order', 'm_more']);
  const r = await post({ entry: [{ changes: [{ value: { messages: [msg('Hii')] } }] }] });
  assert.equal(r.status, 200);
  assert.equal(sends.at(-1).interactive.type, 'button');
});
await test('button and list clicks route to More Services and Objection', async () => {
  await send('m_more', 'interactive');
  assert.ok(sends.at(-1).interactive.action.sections[0].rows.some(r => r.id === 'm_obj'));
  const r = await post({ messages: [{ ...msg(''), type: 'interactive', interactive: { list_reply: { id: 'm_obj' } } }] });
  assert.equal(r.status, 200);
  assert.match(sends.at(-1).text.body, /receipt/);
  await send('m_home', 'button');
  assert.equal(sends.at(-1).interactive.type, 'button');
});
await test('delivery statuses are ignored and all array messages are handled', async () => {
  const n = sends.length;
  assert.equal((await post({ statuses: [{ status: 'delivered' }] })).body.ignored, true);
  assert.equal(sends.length, n);
  assert.equal((await post([{ messages: [msg('Hi')] }, { messages: [msg('Hi')] }])).body.processed, 2);
});
await test('successful duplicate webhook does not send twice', async () => {
  const body = { messages: [msg('Hi')] };
  await post(body);
  const n = sends.length;
  assert.equal((await post(body)).body.duplicates, 1);
  assert.equal(sends.length, n);
});
await test('expired token fails visibly and the same Hi can retry', async () => {
  const body = { messages: [msg('Hi')] };
  rejectMeta = true;
  let r = await post(body);
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /190/);
  rejectMeta = false;
  r = await post(body);
  assert.equal(r.body.processed, 1);
});
await test('missing configuration and database errors are not reported as success', async () => {
  assert.equal((await post({ messages: [msg('Hi')] }, {})).status, 503);
  dbUnavailable = true;
  assert.equal((await send('Hi')).status, 502);
  dbUnavailable = false;
  const r = await mod.namespace.onRequestPost({ request: new Request('https://example.test/api/wa', { method: 'POST', body: '{bad' }), env });
  assert.equal(r.status, 400);
});
await test('Gold quantity proceeds to confirmation and adding another item preserves cart', async () => {
  await store('sg_wa_cust', { [phone.slice(-10)]: { name: 'TEST CUSTOMER', address: 'Test Area', key: 'TEST CUSTOMER', area: 'OTHER', due: 300, receipts: [] } });
  await store('sg_rates', { master: { gold: 100, a10: 200 } });
  await send('m_order', 'interactive');
  await send('it_gold', 'interactive');
  assert.equal((await session()).step, 'qty');
  await send('2');
  assert.equal((await session()).step, 'confirm');
  await send('more_item', 'interactive');
  await send('it_a10', 'interactive');
  assert.equal((await session()).lines.length, 1);
  await send('pk_thaila', 'interactive');
  await send('3');
  assert.equal((await send('ok_order', 'interactive')).status, 200);
  const rows = await db.query("SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%'");
  const orders = rows.rows.flatMap(r => r.value.v).filter(o => o.wa);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].no, '08');
  assert.deepEqual(orders[0].items.map(i => [i.name, i.qty]), [['Atta Gold', 2], ['Atta 10kg', 3]]);
});
await test('objection flows through receipt click and writes app-compatible record', async () => {
  await store('sg_wa_cust', { [phone.slice(-10)]: { name: 'TEST CUSTOMER', key: 'TEST CUSTOMER', receipts: [
    { rno: '11', rdate: '01-09-2026', sdate: '01-09-2026', idx: 0, total: 200, items: [{ name: 'Atta Gold', qty: 2, rate: 100 }] }
  ] } });
  await send('m_obj', 'interactive');
  await send('orc_0', 'interactive');
  await send('90');
  const obj = (await db.query("SELECT value FROM sg_store WHERE key='sg_wa_obj'")).rows[0].value.v[0];
  assert.equal(obj.status, 'open');
  assert.equal(obj.newRate, 90);
  assert.equal(obj.rno, '11');
});
await test('verification requires explicit matching secret', async () => {
  const request = new Request('https://example.test/api/wa?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123');
  assert.equal(await (await mod.namespace.onRequestGet({ request, env })).text(), '123');
  assert.equal((await mod.namespace.onRequestGet({ request, env: {} })).status, 403);
});
await test('wa_handle() text fallback works for old n8n Postgres node (msg column)', async () => {
  const r = await db.query("SELECT wa_handle('918252487551', 'Hi') AS reply");
  assert.match(r.rows[0].reply, /स्वागत है[\s\S]*6️⃣ Rate Objection/);
  assert.match((await db.query("SELECT wa_handle('918252487551', '1') AS reply")).rows[0].reply, /बाक़ी|खाते से जुड़ा नहीं/);
  await db.query("INSERT INTO wa_log (mobile, direction, msg) VALUES ('91', 'in', 'x')");
  const l = await db.query("SELECT phone, dir, body->>'text' AS t FROM wa_log WHERE msg='x'");
  assert.deepEqual(l.rows[0], { phone: '91', dir: 'in', t: 'x' });
});
await test('WhatsApp tile on Home + 💬 WhatsApp (Objection) button in Order Book header', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const admin = await readFile(new URL('./wa-admin.js', import.meta.url), 'utf8');
  assert.equal((html.match(/id="wa-main-btn"/g) || []).length, 1);
  assert.equal((html.match(/id="ob-wa-btn"/g) || []).length, 1);
  assert.ok(html.indexOf('id="ob-wa-btn"') > html.indexOf('id="orderbook-screen"'));
  assert.ok(admin.includes("'ob-wa-btn'"));
  assert.ok(html.indexOf('id="wa-main-btn"') > html.indexOf('id="home-screen"'));
  assert.ok(html.indexOf('id="wa-main-btn"') < html.indexOf('id="notebook-screen"'));
  assert.ok(!admin.includes("querySelector('#orderbook-screen .ob-top')"));
});
await db.close();
