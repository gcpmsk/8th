import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto, createHmac } from 'node:crypto';
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
  Response, Request, URL, console, crypto:webcrypto, TextEncoder,
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
const adminMod = new vm.SourceTextModule(await readFile(new URL('./functions/api/wa-send.js', import.meta.url),'utf8'),{context});
await adminMod.link(()=>new vm.SyntheticModule(['Client'],function(){this.setExport('Client',Client);},{context}));
await adminMod.evaluate();
const env = { WA_RELAY_SECRET:'test-relay', WA_ADMIN_TOKEN:'test-owner', DATABASE_URL: 'postgresql://test', WA_TOKEN: 'test', WA_PHONE_ID: 'test', WA_VERIFY_TOKEN: 'test-verify' };
const phone = '919000000002';
let seq = 0;
const msg = (input, type = 'text', id = 'test-' + (++seq)) => ({ from: phone, id, type,
  ...(type === 'text' ? { text: { body: input } } : type === 'interactive'
    ? { interactive: { button_reply: { id: input } } } : { button: { payload: input } }) });
async function post(body, vars = env) {
  const r = await mod.namespace.onRequestPost({ request: new Request('https://example.test/api/wa', {
    method: 'POST', headers: { 'Content-Type': 'application/json','X-WA-Relay-Secret':'test-relay' }, body: JSON.stringify(body)
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
  assert.match(sends.at(-1).text.body, /Receipt/);
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
  assert.equal((await post({ messages: [msg('Hi')] }, {WA_RELAY_SECRET:'test-relay'})).status, 503);
  dbUnavailable = true;
  assert.equal((await send('Hi')).status, 502);
  dbUnavailable = false;
  const r = await mod.namespace.onRequestPost({ request: new Request('https://example.test/api/wa', { method: 'POST', headers:{'X-WA-Relay-Secret':'test-relay'}, body: '{bad' }), env });
  assert.equal(r.status, 400);
});
await test('Gold quantity proceeds to confirmation and adding another item preserves cart', async () => {
  await store('sg_wa_cust', { [phone.slice(-10)]: { name: 'TEST CUSTOMER', address: 'Test Area', key: 'TEST CUSTOMER', area: 'OTHER', due: 300, receipts: [] } });
  await store('sg_rates', { master: { gold: 100, a10: 200 } });
  await send('m_order', 'interactive');
  await send('i_atta', 'interactive');
  await send('s_gold', 'interactive');
  assert.equal((await session()).step, 'qty');
  await send('2');
  assert.equal((await session()).step, 'confirm');
  await send('more_item', 'interactive');
  await send('i_atta', 'interactive');
  await send('s_a10', 'interactive');
  assert.equal((await session()).lines.length, 1);
  await send('3');
  assert.equal((await send('ok_order', 'interactive')).status, 200);
  const rows = await db.query("SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%'");
  const orders = rows.rows.flatMap(r => r.value.v).filter(o => o.wa);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].no, '08');
  assert.deepEqual(orders[0].items.map(i => [i.name, i.qty]), [['Atta Gold', 2], ['Atta 10kg', 15]]);
});
const customer={name:'TEST CUSTOMER',address:'Test Area',key:'TEST CUSTOMER',area:'OTHER',due:300};
const receiptDate='01-09-2026';
const receiptKey='sg_arcpt_'+receiptDate;
async function value(key){return (await db.query('SELECT value FROM sg_store WHERE key=$1',[key])).rows[0]?.value.v;}
async function fixture(){
  await db.query("DELETE FROM sg_store WHERE key='sg_arcpt_02-09-2026'");
  await store('sg_wa_cust',{[phone.slice(-10)]:customer});
  await store(receiptKey,[
    {no:'11',name:customer.name,address:customer.address,total:'400',items:[{name:'Atta Gold',qty:2,rate:'100',amount:'200'},{name:'Atta Gold',qty:2,rate:'100',amount:'200'}]},
    {no:'22',name:'OTHER CUSTOMER',address:'Other Area',total:'900',items:[{name:'Besan',qty:1,rate:'900',amount:'900'}]},
    {no:'33',name:customer.name,address:customer.address,cancelled:true,items:[]}
  ]);
  await store('sg_wa_obj',[]); await db.exec('DELETE FROM wa_decisions');
  await send('Hi');
}
async function object(rate='90',index=0){
  await send('m_obj','interactive'); await send('11'); await send('oit_'+index,'interactive'); await send(rate);
  assert.equal((await session()).step,'obj_confirm');
  await send('obj_submit','interactive');
  return (await value('sg_wa_obj')).at(-1);
}
async function admin(body,vars=env,auth='test-owner'){
  const r=await adminMod.namespace.onRequestPost({env:vars,request:new Request('https://example.test/api/wa-send',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)})});
  return {status:r.status,...await r.json()};
}
await test('receipt number checks actual owner; summary cannot lend someone else a receipt',async()=>{
  await fixture(); await send('m_obj','interactive');
  for(const no of ['22','33','999']){await send(no);assert.equal((await session()).step,'obj_receipt');assert.match(sends.at(-1).text.body,/नहीं मिली/);}
  await send('11');assert.equal((await session()).step,'obj_items');
  await send('oit_99','interactive');assert.equal((await session()).step,'obj_items');
  await send('oit_1','interactive');await send('95.50');
  assert.equal((await value('sg_wa_obj')).length,0);
  assert.match(sends.at(-1).interactive.body.text,/95.50/);
  await send('obj_submit','interactive');
  const o=(await value('sg_wa_obj'))[0];assert.equal(o.itemIdx,1);assert.equal(o.newRate,95.5);assert.equal(o.rcIdx,0);
});
await test('objection edit, cancel, malformed rate and Hi never create records',async()=>{
  await fixture(); await send('m_obj');await send('11');await send('oit_0');
  for(const text of ['-1','abc','10abc','0','10.123','1e3']){await send(text);assert.equal((await session()).step,'obj_rate');}
  await send('90');await send('obj_edit');await send('92');await send('cancel');
  assert.equal((await value('sg_wa_obj')).length,0);assert.deepEqual(await session(),{});
  await send('m_order');await send('i_chokar');await send('Hii');assert.deepEqual(await session(),{});
});
await test('receipt change after quote blocks objection submission',async()=>{
  await fixture();await send('m_obj');await send('11');await send('oit_0');await send('90');
  const rs=await value(receiptKey);rs[0].items[0].rate='110';await store(receiptKey,rs);
  await send('obj_submit');assert.equal((await value('sg_wa_obj')).length,0);assert.match(sends.at(-1).interactive.body.text,/बदल गई/);
});
await test('duplicate receipt numbers ask date and never silently choose a receipt',async()=>{
  await fixture();const rs=await value(receiptKey);await store('sg_arcpt_02-09-2026',[rs[0]]);
  await send('m_obj');await send('11');assert.equal((await session()).step,'obj_date');
  await send('garbage');assert.equal((await session()).step,'obj_date');
  await send('02-09-2026');assert.equal((await session()).rc.sdate,'02-09-2026');
  await db.query("DELETE FROM sg_store WHERE key='sg_arcpt_02-09-2026'");
});
await test('receipt item list paginates beyond ten without exposing other receipts',async()=>{
  await fixture();const rs=await value(receiptKey);rs[0].items=Array.from({length:12},(_,i)=>({name:'Item '+i,qty:1,rate:'10',amount:'10'}));await store(receiptKey,rs);
  await send('m_obj');await send('11');assert.equal(sends.at(-1).interactive.action.sections[0].rows.length,10);
  await send('obj_next');await send('oit_11');assert.equal((await session()).ii,11);
});
await test('accept changes only selected duplicate-name line and decision retry is idempotent',async()=>{
  await fixture();const o=await object('90',1);
  const r=await admin({id:o.id,action:'accept'});assert.equal(r.ok,true,r.error);assert.equal(r.sent,true);
  const rs=await value(receiptKey);assert.equal(rs[0].items[0].rate,'100');assert.equal(rs[0].items[1].rate,'90');
  assert.equal(Number(rs[0].total),380);assert.equal(rs[0].tvAmtOld,400);assert.match(rs[0].tvEts,/WA/);
  const n=sends.length;await admin({id:o.id,action:'set',rate:1});assert.equal(sends.length,n);assert.equal(Number((await value(receiptKey))[0].total),380);
  assert.equal((await value('sg_wa_obj'))[0].decision,'accept');
});
await test('owner new rate and reject each notify; reject leaves receipt unchanged',async()=>{
  await fixture();let o=await object();let r=await admin({id:o.id,action:'set',rate:85.5});assert.equal(r.ok,true,r.error);
  assert.match(sends.at(-1).text.body,/85.50/);assert.equal(Number((await value(receiptKey))[0].total),371);
  await fixture();o=await object();const before=await value(receiptKey);r=await admin({id:o.id,action:'deny'});assert.equal(r.sent,true,r.error);
  assert.deepEqual(await value(receiptKey),before);assert.match(sends.at(-1).text.body,/Rejected/);
});
await test('owner API blocks unauthenticated and stale receipt decisions',async()=>{
  await fixture();const o=await object();assert.equal((await admin({id:o.id,action:'accept'},env,'bad')).status,401);
  assert.equal((await admin({id:o.id,action:'set',rate:-1})).status,400);
  const rs=await value(receiptKey);rs[0].items[0].rate='150';await store(receiptKey,rs);
  assert.equal((await admin({id:o.id,action:'accept'})).status,409);assert.equal((await value('sg_wa_obj'))[0].status,'open');
});
await test('failed notification stays saved and Retry sends without applying rate twice',async()=>{
  await fixture();const o=await object();rejectMeta=true;
  let r=await admin({id:o.id,action:'accept'});assert.equal(r.saved,true);assert.equal(r.sent,false);assert.match(r.error,/190/);
  const before=await value(receiptKey);rejectMeta=false;r=await admin({id:o.id,action:'retry'});assert.equal(r.sent,true,r.error);assert.deepEqual(await value(receiptKey),before);
});
await test('outside 24 hours requires approved template or new customer Hi then retry',async()=>{
  await fixture();const o=await object();await db.query("UPDATE wa_inbox SET created_at=now()-interval '25 hours' WHERE phone=$1",[phone]);
  let r=await admin({id:o.id,action:'deny'});assert.equal(r.sent,false);assert.match(r.error,/24-hour/);
  r=await admin({id:o.id,action:'retry'},{...env,WA_OBJECTION_TEMPLATE:'objection_result',WA_TEMPLATE_LANG:'hi'});assert.equal(r.sent,true,r.error);
  assert.equal(sends.at(-1).template.name,'objection_result');assert.equal(sends.at(-1).template.components[0].parameters.length,7);
});
await test('admin list includes failed/accepted notification status',async()=>{
  const r=await adminMod.namespace.onRequestGet({env,request:new Request('https://example.test/api/wa-send',{headers:{Authorization:'Bearer test-owner'}})});
  const j=await r.json();assert.equal(j.ok,true,j.error);assert.equal(j.objects[0].delivery,'accepted');
});
await test('all product packing paths and customer pricing are correct',async()=>{
  await fixture();await store('sg_rates',{master:{gold:100,a18:200,a10:300,a5:400,sattu:100,besan:120,chokar:500}});
  for(const [size,mul] of [['gold',1],['a18',3],['a10',5],['a5',10]]){
    await send('m_order');await send('i_atta');await send('s_'+size);assert.equal((await session()).step,'qty');
    await send('2');assert.equal((await session()).qty,2);assert.equal((await session()).mul,mul);await send('cancel');
  }
  for(const item of ['sattu','besan'])for(const size of ['200','500'])for(const pack of ['thaila','bora']){
    await send('m_order');await send('i_'+item);await send('g_'+size);await send('p_'+pack);await send('2');
    const st=await session();assert.equal(st.step,'confirm');assert.equal(st.mul,pack==='bora'?(size==='200'?50:20):(size==='200'?10:4));
    assert.equal(st.urate,pack==='bora'?(item==='sattu'?1000:1200):(item==='sattu'?200:240));await send('cancel');
  }
  await send('m_order');await send('i_chokar');await send('3');assert.equal((await session()).urate,500);
});
await test('quantity rejects fractions, suffix text, negatives, zero and huge numbers',async()=>{
  await send('m_order');await send('i_chokar');
  for(const q of ['-1','0','2.5','5 bags','501','abc']){await send(q);assert.equal((await session()).step,'qty');}
  await send('2');assert.equal((await session()).step,'confirm');await send('cancel');
});
await test('master wheat displayed for creditors including dual debtor/creditor',async()=>{
  await store('sg_rates',{master:{wheat:1500},areaAdj:{OTHER:{wheat:100}},cust:{[customer.key]:{wheat:50}}});
  for(const roles of [{type:'cred'},{isCreditor:true}]){
    await store('sg_wa_cust',{[phone.slice(-10)]:{...customer,...roles}});
    await send('Hii');assert.match(sends.at(-1).interactive.body.text,/1,500.00/);
    await send('m_rate');assert.match(sends.at(-1).interactive.body.text,/1,500.00/);assert.doesNotMatch(sends.at(-1).interactive.body.text,/Atta/);
  }
});
await test('unknown customer cannot create blank orders or use forged item IDs',async()=>{
  await store('sg_wa_cust',{});await send('Hi');await send('m_order');assert.deepEqual(await session(),{});
  await send('i_chokar');await send('2');await send('ok_order');assert.notEqual((await session()).step,'confirm');
});
await test('SQL receive retries return cached confirmation without duplicate order writes',async()=>{
  await fixture();await send('m_order');await send('i_chokar');await send('2');
  const message=msg('ok_order','interactive');rejectMeta=true;assert.equal((await post({messages:[message]})).status,502);
  const count=async()=> (await db.query("SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%'")).rows.flatMap(r=>r.value.v).length;
  const before=await count();rejectMeta=false;assert.equal((await post({messages:[message]})).status,200);assert.equal(await count(),before);
  assert.match(sends.at(-1).interactive.body.text,/Order No/);
});
await test('webhook requires relay secret or verifies HMAC over raw body',async()=>{
  const raw=JSON.stringify({messages:[msg('Hi')]});
  const req=headers=>new Request('https://example.test/api/wa',{method:'POST',body:raw,headers});
  let r=await mod.namespace.onRequestPost({env,request:req({})});assert.equal(r.status,401);
  const signature='sha256='+createHmac('sha256','app-secret').update(raw).digest('hex');
  r=await mod.namespace.onRequestPost({env:{...env,WA_APP_SECRET:'app-secret'},request:req({'X-Hub-Signature-256':signature})});assert.equal(r.status,200);
  r=await mod.namespace.onRequestPost({env:{...env,WA_APP_SECRET:'other'},request:req({'X-Hub-Signature-256':signature})});assert.equal(r.status,401);
});
await test('verification requires explicit matching secret', async () => {
  const request = new Request('https://example.test/api/wa?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123');
  assert.equal(await (await mod.namespace.onRequestGet({ request, env })).text(), '123');
  assert.equal((await mod.namespace.onRequestGet({ request, env: {} })).status, 403);
});
await test('wa_handle returns interactive JSON for n8n, and log aliases still work', async () => {
  const r = await db.query("SELECT wa_handle('918252487551', 'Hi') AS reply");
  assert.equal(JSON.parse(r.rows[0].reply).interactive.type,'button');
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

await test('order numbers do not truncate at 100 and missing rates remain pending',async()=>{
  await fixture();await store('sg_ord_01-01-2026',[{no:'99',items:[]}]);
  await store('sg_rates',{master:{gold:100}});
  await send('m_order');await send('i_chokar');await send('2');
  assert.match(sends.at(-1).interactive.body.text,/मालिक बताएँगे/);
  await send('ok_order');
  assert.match(sends.at(-1).interactive.body.text,/Order No 100/);
  assert.match(sends.at(-1).interactive.body.text,/rate pending/);
  const rows=(await db.query("SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%'")).rows;
  const order=rows.flatMap(r=>r.value.v).find(o=>o.no==='100');
  assert.equal(order.items[0].rate,'');
});
await test('unlinking customer after quotation blocks order confirmation',async()=>{
  await fixture();await send('m_order');await send('i_chokar');await send('1');
  await store('sg_wa_cust',{});await send('ok_order');
  assert.match(sends.at(-1).interactive.body.text,/link नहीं/);
  assert.deepEqual(await session(),{});
});
await test('four-line confirmation retains all items and cart total',async()=>{
  await fixture();await store('sg_rates',{master:{chokar:100.5}});
  await send('m_order');
  for(let n=1;n<=4;n++) {
    await send('i_chokar');await send(String(n));
    const body=sends.at(-1).interactive.body.text;
    assert.match(body,/Cart total/);
    assert.equal((body.match(/Chokar/g)||[]).length,n);
    if(n<4) await send('more_item');
  }
  await send('more_item');assert.match(sends.at(-1).interactive.body.text,/अधिकतम 4/);
  assert.equal((await session()).step,'confirm');await send('cancel');
});
await test('n8n import normalizes text and interactive messages and ignores statuses',async()=>{
  const workflow=JSON.parse(await readFile(new URL('./n8n-whatsapp.json',import.meta.url),'utf8'));
  assert.equal(workflow.active,false);assert.equal(workflow.nodes.length,4);
  const code=workflow.nodes.find(n=>n.type==='n8n-nodes-base.code').parameters.jsCode;
  const extract=new Function('$input',code);
  const output=extract({all:()=>[
    {json:{messages:[msg('Hi'),msg('m_order','interactive')]}},
    {json:{entry:[{changes:[{value:{messages:[{...msg(''),type:'interactive',interactive:{list_reply:{id:'i_atta'}}}]}}]}]}},
    {json:{statuses:[{status:'delivered'}]}}
  ]});
  assert.deepEqual(output.map(x=>x.json.input),['Hi','m_order','i_atta']);
  assert.ok(output.every(x=>x.json.messageId));
  const postgres=workflow.nodes.find(n=>n.type==='n8n-nodes-base.postgres');
  assert.match(postgres.parameters.query,/wa_receive\(\$1::text, \$2::text, \$3::text\)/);
});
await test('documented packing SQL preserves other defaults on old databases',async()=>{
  const guide=await readFile(new URL('./README.md',import.meta.url),'utf8');
  const update=guide.match(/```sql\n(UPDATE public\.sg_store[\s\S]*?)```/)[1];
  const cfg=await value('sg_wa_cfg');const missing={...cfg};delete missing.pk;
  await store('sg_wa_cfg',missing);await db.exec(update);
  const result=await value('sg_wa_cfg');
  assert.equal(result.pk.sattu['200'].thaila,12);
  assert.equal(result.pk.besan['500'].bora,20);
  await store('sg_wa_cfg',cfg);
});
await db.close();
