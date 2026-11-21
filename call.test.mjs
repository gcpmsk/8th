// Call Wala + Emergency Wala — PostgreSQL logic test (in-memory PGlite; production DB / Dograh को नहीं छूता)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(await readFile(new URL('./call-schema.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('./call-schema.sql', import.meta.url), 'utf8'));   // दोबारा चलाना सुरक्षित
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const put = (key, v) => db.query(`INSERT INTO sg_store(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [key, JSON.stringify({ v })]);
const api = async p => (await one('SELECT cw_api($1::jsonb) AS o', [JSON.stringify(p)])).o;
const tick = async () => (await one('SELECT cw_tick() AS o')).o;
const today = (await one('SELECT cw_today() AS d')).d;

await put('sg_call_cfg', { hours: { from: '00:00', to: '23:59' }, retry: { max: 2, gap: 30 }, hookKey: 'K1',
  dograh: { base: 'https://d.example', tel: '7', fmt: '+91', agents: { out: { uuid: 'U-OUT', id: '9' }, alert: { uuid: 'U-AL', id: '12' } } },
  inactive: { on: true, days: 3, basis: 'order', time: '00:00', area: { MNS: { days: 0 } }, cust: {} } });
await put('sg_rates', { master: { gold: 1500, a10: 340, wheat: 2600 }, areaAdj: { KKG: { gold: -20 } }, cust: { 'RAM STORE': { gold: 30 } } });
await put('sg_call_cust', {
  'RAM STORE': { name: 'Ram Store', address: 'Khagaria', area: 'KKG', call: '9000000001', wa: '9000000002', type: 'deb', due: 12500, bills: 3, oldest: 12, last: '2026-01-01' },
  'SHYAM KIRANA': { name: 'Shyam Kirana', address: 'Khagaria', area: 'KKG', call: '9000000003', wa: '9000000003', type: 'deb', due: 0, last: '2026-01-01' },
  'MOHAN TRADERS': { name: 'Mohan Traders', address: 'Manshi', area: 'MNS', call: '9000000004', wa: '9000000004', type: 'deb', due: 0, last: '2026-01-01' },
  'KISAN JI': { name: 'Kisan Ji', address: 'Gogri', area: 'GG', call: '9000000005', wa: '9000000005', type: 'cred', wheat: true, due: 0 } });
await put('sg_ord_' + today, [{ id: 'x1', no: '07', name: 'Shyam Kirana', address: 'Khagaria', items: [{ name: 'Atta Gold', qty: 2 }] }]);

test('area dialer: Smart Order-Skip + one call at a time + credit guard context', async () => {
  const r = await api({ action: 'enqueue', kind: 'area', agent: 'out', items: [
    { key: 'RAM STORE', name: 'Ram Store', address: 'Khagaria', area: 'KKG', phone: '9000000001' },
    { key: 'SHYAM KIRANA', name: 'Shyam Kirana', address: 'Khagaria', area: 'KKG', phone: '9000000003' },
    { key: 'X', name: 'Bad', phone: '12345' }] });
  assert.deepEqual([r.added, r.skipped, r.bad], [1, 1, 1]);
  const j = await tick();
  assert.equal(j.action, 'dial');
  assert.equal(j.url, 'https://d.example/api/v1/public/agent/workflow/U-OUT');
  assert.equal(j.body.phone_number, '+919000000001');
  assert.equal(j.body.telephony_configuration_id, 7);
  const c = j.body.initial_context;
  assert.equal(c.customer_name, 'Ram Store'); assert.equal(c.ptype, 'customer');
  assert.match(c.due_text, /12500 रुपये पुराना बकाया/);
  assert.match(c.rate_card, /Atta Gold — 1450 रुपये/);          // 1500 − 20 (area) − 30 (special)
  assert.equal((await tick()).action, 'none');                  // line busy → दूसरी call नहीं
  await db.query(`SELECT cw_after($1,'dial',$2::jsonb)`, [j.id, JSON.stringify({ statusCode: 200, body: { status: 'initiated', workflow_run_id: 501 } })]);
  await db.query(`UPDATE cw_queue SET dialed_at = now() - interval '1 minute' WHERE id=$1`, [j.id]);
  const k = await tick();
  assert.equal(k.action, 'check'); assert.equal(k.url, 'https://d.example/api/v1/workflow/9/runs/501');
});

test('call result webhook: log + order in Order Book + rate inquiry + callback; idempotent', async () => {
  const q = await one(`SELECT id FROM cw_queue WHERE status='dialing'`);
  const body = { type: 'result', run_id: '501', queue_id: String(q.id), disposition: 'user_hangup', duration: '74', recording: 'https://d.example/rec/501.wav',
    summary: 'Ram ji ne 5 bora Atta Gold order diya, rate kam karne ko kaha.', order_items: 'Atta Gold=5 बोरा; Atta 10kg = 12 थैला',
    rate_item: 'Atta Gold', rate_wanted: '1400', rate_talk: 'Gold ka rate 1400 kar dijiye', callback_minutes: '120', customer_type: '{{gathered_context.customer_type}}' };
  const bad = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'wrong' }, b: body })])).o;
  assert.equal(bad.ok, false);
  for (let i = 0; i < 2; i++) {   // Dograh retry → दो बार आए तब भी एक ही order
    const o = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'K1' }, b: body })])).o;
    assert.equal(o.ok, true);
  }
  const ord = (await one(`SELECT value->'v' AS v FROM sg_store WHERE key=$1`, ['sg_ord_' + today])).v;
  assert.equal(ord.length, 2);
  assert.equal(ord[1].src, 'call'); assert.equal(ord[1].no, '08'); assert.equal(ord[1].name, 'Ram Store');
  assert.deepEqual(ord[1].items.map(i => [i.name, i.qty, i.rate]), [['Atta Gold', 5, '1450'], ['Atta 10kg', 12, '']]);
  assert.equal((await one(`SELECT status FROM cw_queue WHERE id=$1`, [q.id])).status, 'done');
  const h = await api({ view: 'calls', q: 'ram' });
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].order_no, '08'); assert.equal(h.calls[0].recording, 'https://d.example/rec/501.wav');
  const rt = await api({ view: 'rate' });
  assert.equal(rt.rows.length, 1); assert.equal(rt.rows[0].kind, 'nego'); assert.equal(Number(rt.rows[0].cur_rate), 1450); assert.equal(Number(rt.rows[0].want_rate), 1400);
  const cb = await one(`SELECT count(*)::int AS n FROM cw_queue WHERE kind='callback' AND status='queued' AND scheduled_at > now() + interval '100 minutes'`);
  assert.equal(cb.n, 1);
});

test('busy / no-answer → 2 auto-retry फिर noanswer; Cancel All रोक देता है', async () => {
  await api({ action: 'enqueue', kind: 'manual', agent: 'out', reason: 'पेमेंट याद दिलाना', items: [{ name: 'Naya', phone: '9000000009' }] });
  for (let t = 1; t <= 3; t++) {
    const j = await tick(); assert.equal(j.action, 'dial'); assert.equal(j.body.initial_context.reason, 'पेमेंट याद दिलाना');
    await db.query(`SELECT cw_after($1,'dial',$2::jsonb)`, [j.id, JSON.stringify({ statusCode: 200, body: { workflow_run_id: 600 + t } })]);
    await db.query(`SELECT cw_after($1,'check',$2::jsonb)`, [j.id, JSON.stringify({ statusCode: 200, body: { is_completed: true, gathered_context: { call_disposition: 'no_answer' } } })]);
    const s = await one(`SELECT status, tries FROM cw_queue WHERE id=$1`, [j.id]);
    assert.equal(s.status, t < 3 ? 'queued' : 'noanswer'); assert.equal(s.tries, t);
    await db.query(`UPDATE cw_queue SET scheduled_at = now() WHERE id=$1 AND status='queued'`, [j.id]);
  }
  await api({ action: 'enqueue', kind: 'manual', items: [{ name: 'A', phone: '9000000010' }], at: '2099-01-01T10:00' });
  const c = await api({ action: 'cancel_all' });
  assert.ok(c.cancelled >= 2);                                   // schedule + callback दोनों रुके
  assert.equal((await tick()).why, 'stop');
  assert.equal((await api({ view: 'dash' })).stop, true);
  await api({ action: 'resume' });
});

test('3-day inactive: master / area-wise off; incoming call context (supplier wheat rate, new caller dealer list)', async () => {
  await db.query(`DELETE FROM cw_queue`);
  const r = await api({ action: 'inactive_now' });
  // Ram (order आज call से आया → skip), Shyam (आज order) skip, Mohan का area MNS = 0 दिन (बंद)
  assert.equal(r.added, 0);
  await db.query(`DELETE FROM sg_store WHERE key=$1`, ['sg_ord_' + today]);
  await db.query(`UPDATE cw_calls SET order_no = NULL`);
  assert.equal((await api({ action: 'inactive_now' })).added, 2);
  const sup = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'K1' }, b: { event: 'call_inbound', call_inbound: { from_number: '+919000000005' } } })])).o;
  assert.equal(sup.call_inbound.initial_context.ptype, 'supplier');
  assert.match(sup.initial_context.wheat_text, /2600 रुपये/);
  const nw = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'K1' }, b: { event: 'call_inbound', call_inbound: { from_number: '+918888888888' } } })])).o;
  assert.equal(nw.initial_context.ptype, 'new'); assert.match(nw.initial_context.dealer_list, /KKG: .*Ram Store/);
});

test('Emergency Wala: 700g बोरा कटौती, रसीद से auto-deduction, low-stock alert दोनों owner को', async () => {
  await db.query(`DELETE FROM cw_queue`);
  await put('sg_em_cfg', { from: '01-01-2026', owners: ['9111111111', '9222222222'], mats: [{ k: 'wheat', n: 'गेहूँ', unit: 'kg', limit: 200 }] });
  await put('sg_em_in', [{ id: 'a', date: today, mat: 'wheat', bags: 100, gross: 5000, net: 4930 }, { id: 'b', date: today, mat: 'wheat', net: 999, cut: true }]);
  await put('sg_nb_' + today, { maal: [{ kind: 'rst', name: 'Kisan', pic: 300, nett: 15210 }, { kind: 'simple', name: 'x', amount: 5 }] });   // 15210 − 0.7×300 = 15000
  let s = await api({ view: 'stock' });
  assert.equal(Number(s.mats[0].bal), 19930); assert.equal(s.mats[0].low, false);
  await put('sg_arcpt_' + today, [{ no: '1', name: 'Ram Store', items: [{ name: 'Atta Gold', qty: '190' }, { name: 'Atta 10kg', qty: '50' }, { name: 'Maida', qty: 1 }] },
    { no: '2', name: 'Z', cancelled: true, items: [{ name: 'Atta Gold', qty: '100' }] }]);
  s = await api({ view: 'stock' });
  assert.equal(Number(s.mats[0].out), 10000); assert.equal(Number(s.mats[0].bal), 9930); assert.equal(Number(s.mats[0].bora), 198.6);
  assert.equal(s.mats[0].low, true); assert.equal(s.rc.n, 1); assert.deepEqual(s.unmapped, ['Maida']);
  const j = await tick();
  assert.equal(j.wa.length, 2); assert.equal(j.wa[0].to, '919111111111'); assert.match(j.wa[0].text.body, /198\.6 बोरा/);
  assert.equal(j.action, 'dial'); assert.equal(j.url, 'https://d.example/api/v1/public/agent/workflow/U-AL');
  assert.match(j.body.initial_context.alert_text, /1 रसीद कटी/);
  await db.query(`UPDATE cw_queue SET status='done' WHERE status='dialing'`);
  assert.equal((await tick()).wa.length, 0);                    // वही alert दोबारा नहीं (24 घंटे)
});

test('"कल शाम 4 बजे कॉल करना" → callback_clock/day से Schedule; "दोबारा कॉल मत करना" → DND', async () => {
  await db.query(`DELETE FROM cw_queue`);
  const o = (await one('SELECT cw_finish($1::jsonb) AS o', [JSON.stringify({ run_id: '900', phone: '9000000003', direction: 'outbound', disposition: 'user_hangup', duration: '20',
    summary: 'Kal sham 4 baje call karne ko kaha', callback_clock: '16:00', callback_day: '1', dnd: 'false' })])).o;
  assert.equal(o.ok, true);
  const q = await one(`SELECT to_char(scheduled_at AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS t, (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date - (now() AT TIME ZONE 'Asia/Kolkata')::date AS d, name FROM cw_queue WHERE kind='callback'`);
  assert.equal(q.t, '16:00'); assert.equal(q.d, 1); assert.equal(q.name, 'Shyam Kirana');
  await db.query('SELECT cw_finish($1::jsonb)', [JSON.stringify({ run_id: '901', phone: '9000000004', direction: 'outbound', duration: '9', summary: 'Mana kiya', dnd: 'true' })]);
  assert.equal((await api({ view: 'dash' })).dnd.length, 1);
  const r = await api({ action: 'enqueue', kind: 'area', items: [{ key: 'MOHAN TRADERS', name: 'Mohan Traders', phone: '9000000004' }] });
  assert.deepEqual([r.added, r.skipped], [0, 1]);
});

// ---------- Dograh agent files: कॉल हमेशा कटनी चाहिए (End Call तक रास्ता) ----------
test('Dograh agent files: valid graph, every agent reaches End Call, hook placeholders present', async () => {
  const files = ['1-outgoing-customer', '2-incoming-all', '3-new-customer-lead', '4-wheat-supplier', '5-owner-stock-alert'];
  for (const f of files) {
    const d = JSON.parse(await readFile(new URL(`./dograh/${f}.json`, import.meta.url), 'utf8'));
    const w = d.workflow_definition, ids = new Set(w.nodes.map(n => n.id));
    assert.equal(ids.size, w.nodes.length, f + ': node id दोहराई');
    assert.equal(w.nodes.filter(n => n.type === 'startCall').length, 1, f + ': एक ही Start Call');
    for (const e of w.edges) { assert.ok(ids.has(e.source) && ids.has(e.target), f + ': edge टूटी'); }
    const ends = new Set(w.nodes.filter(n => n.type === 'endCall').map(n => n.id));
    assert.ok(ends.size >= 1, f + ': End Call node नहीं');
    // हर agent/start node से कम से कम एक edge सीधे End Call पर
    for (const n of w.nodes.filter(n => n.type === 'agentNode' || n.type === 'startCall')) {
      const toEnd = w.edges.filter(e => e.source === n.id && ends.has(e.target));
      assert.ok(toEnd.length >= 1, `${f}: "${n.data.name}" से End Call का रास्ता नहीं`);
      for (const e of toEnd) assert.match(e.data.condition, /AS SOON AS|as soon as|Do not keep|silent|goodbye|refuses/, f + ': End edge की शर्त ढीली');
    }
    for (const n of w.nodes.filter(n => n.type === 'endCall')) assert.match(n.data.prompt, /कॉल अपने-आप कट/, f + ': End prompt');
    const g = w.nodes.find(n => n.type === 'globalNode');
    assert.match(g.data.prompt, /कॉल ख़त्म करने का नियम/, f + ': Global में अंत का नियम');
    const wh = w.nodes.find(n => n.type === 'webhook');
    assert.ok(wh && wh.data.endpoint_url.includes('REPLACE_HOOK_KEY'), f + ': webhook URL placeholder');
    assert.ok(/ v2$/.test(d.name), f + ': नाम में v2');
  }
});

test('Dograh pre-call fetch (incoming): सही key पर context, ग़लत key पर भी call न रुके', async () => {
  const bodyIn = { event: 'call_inbound', call_inbound: { agent_id: 20, workflow_run_id: 7, from_number: '+919000000001', to_number: '9429491500' } };
  const ok = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'K1' }, b: bodyIn })])).o;
  assert.equal(ok.call_inbound.initial_context.customer_name, 'Ram Store');
  assert.equal(ok.initial_context.ptype, 'customer');
  const bad = (await one('SELECT cw_hook($1::jsonb) AS o', [JSON.stringify({ q: { k: 'zzz' }, b: bodyIn })])).o;
  assert.equal(bad.ok, false);                       // JSON ही लौटता है — Dograh call चालू रखता है
  assert.equal(bad.call_inbound, undefined);
});
