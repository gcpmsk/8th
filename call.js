/* =====================================================================
   📞 CALL WALA — AI Calling control panel (Dograh + n8n + PostgreSQL)
   ---------------------------------------------------------------------
   • sg_call_cfg   — settings (Dograh agents, calling hours, retry, inactive days, wheat rate)
   • sg_call_cust  — हर party का summary {call, wa, area, due, last…} → Postgres के function इसे पढ़ते हैं
   • बाक़ी सब (कतार, history, rate inquiry) Postgres में: /api/call → cw_api()
   Logic server (call-schema.sql) में है; यह file सिर्फ़ दिखाती और बटन दबाती है.
   ===================================================================== */
'use strict';
const CW_CFG = 'sg_call_cfg', CW_CUST = 'sg_call_cust';
const CW = { tab: 'hist', q: '', area: '', dash: null, calls: null, rate: null, leads: null, err: '', iaQ: '', pad: {} };
const cwE = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
const cwP10 = v => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d : ''; };
const cwKindHi = { manual: 'Dialpad', area: 'Area Dialer', inactive: 'Inactive', callback: 'Call Back', supplier: 'गेहूँ सप्लायर', alert: 'Stock Alert', inbound: 'Incoming' };
const cwStHi = { queued: 'कतार में', dialing: 'चालू', done: 'बात हुई', noanswer: 'नहीं उठा', failed: 'Fail', skipped: 'Skip', cancelled: 'Cancel' };
const CW_AGENTS = [['out', 'पुराना Customer (Outgoing)'], ['new', 'नया Customer / दुकानदार'], ['sup', 'गेहूँ सप्लायर'], ['alert', 'Owner Stock Alert'], ['in', 'Incoming (सब)']];

function cwCfg() {
  let c = {}; try { c = JSON.parse(localStorage.getItem(CW_CFG) || '{}') || {}; } catch (e) {}
  c.hours = Object.assign({ from: '09:00', to: '19:00' }, c.hours || {});
  c.lunch = Object.assign({ from: '', to: '' }, c.lunch || {});
  c.retry = Object.assign({ max: 2, gap: 30 }, c.retry || {});
  c.dograh = Object.assign({ base: '', tel: '', fmt: '+91', agents: {} }, c.dograh || {});
  c.dograh.agents = c.dograh.agents || {};
  c.inactive = Object.assign({ on: true, days: 3, basis: 'order', time: '10:00', area: {}, cust: {} }, c.inactive || {});
  c.inactive.area = c.inactive.area || {}; c.inactive.cust = c.inactive.cust || {};
  c.wheat = Object.assign({ rate: '', unit: 'प्रति बोरा', note: '', need: '' }, c.wheat || {});
  if (!c.n8n) c.n8n = 'https://n8n.satyamgold.com/webhook/sg-call';
  return c;
}
function cwSaveCfg(c) {
  if (!c.hookKey) c.hookKey = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(CW_CFG, JSON.stringify(c));
  try { window.sgSync && window.sgSync.push(); } catch (e) {}
}
/* settings / customer list Postgres तक पहुँच जाए, तभी server पर action */
async function cwFlush() {
  cwPublish();
  for (let i = 0; i < 12; i++) {
    const st = window.sgSync && window.sgSync.status ? window.sgSync.status() : { pending: 0 };
    if (!st.pending) return true;
    try { window.sgSync.push(); } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
const cwApi = body => waOwnerCall('/api/call', body);

/* ---------- 1) customer summary publish (30 sec) — Call Wala + WhatsApp Wala दोनों नंबर ---------- */
function cwISO(d) { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; }
function cwPublish() {
  try {
    if (typeof tvBuild !== 'function') return;
    const D = tvBuild(), out = {}, last = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || k.indexOf('sg_ord_') !== 0) continue;
      const iso = cwISO(k.slice(7)); if (!iso) continue;
      let l = []; try { l = JSON.parse(localStorage.getItem(k)) || []; } catch (e) {}
      l.forEach(o => { if (!o || o.cancelled || !o.name) return; const key = tvK(o.name); if (!last[key] || last[key] < iso) last[key] = iso; });
    }
    (D.cred || []).forEach(d => {
      const wa = cwP10(tvMob(d.key)), call = cwP10(tvCallMob(d.key)) || wa; if (!call) return;
      out[d.key] = { name: d.name, address: d.address || '', area: d.area, call, wa: wa || call, type: 'cred', wheat: !!(d.cats && d.cats.wheat), due: Math.round(d.bal || 0) };
    });
    (D.deb || []).forEach(d => {
      const wa = cwP10(tvMob(d.key)), call = cwP10(tvCallMob(d.key)) || wa; if (!call) return;
      let l = last[d.key] || '';
      const open = (d.due || []).filter(x => !x.cut).sort((a, b) => tvDV(b.date) - tvDV(a.date));
      open.forEach(x => { if (x.src === 'arcpt') { const iso = cwISO(x.sdate || x.date); if (iso > l) l = iso; } });
      const ob = open.slice(0, Math.max(0, d.openBills || 0));
      out[d.key] = { name: d.name, address: d.address || '', area: d.area, call, wa: wa || call, type: 'deb', due: Math.round(d.bal || 0),
        bills: d.openBills || 0, oldest: (d.bal > 0 && ob.length) ? tvAge(ob[ob.length - 1].date) : 0, last: l };
    });
    const nw = JSON.stringify(out);
    if ((localStorage.getItem(CW_CUST) || '') !== nw) localStorage.setItem(CW_CUST, nw);
  } catch (e) {}
}
window.cwAfterMob = cwPublish;
setTimeout(cwPublish, 5000); setInterval(cwPublish, 30000);

/* ---------- customer lists (Tally View से) ---------- */
function cwDebtors() { try { return (tvBuild().deb || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'hi')); } catch (e) { return []; } }
function cwSuppliers() { try { return (tvBuild().cred || []).filter(c => c.cats && c.cats.wheat).sort((a, b) => a.name.localeCompare(b.name, 'hi')); } catch (e) { return []; } }
function cwOrderedToday() {
  const s = new Set(), add = k => { let l = []; try { l = JSON.parse(localStorage.getItem(k)) || []; } catch (e) {} l.forEach(o => { if (o && !o.cancelled && o.name) s.add(tvK(o.name)); }); };
  add('sg_ord_' + DATE); add('sg_arcpt_' + DATE); return s;
}
function cwItem(d) { return { key: d.key, name: d.name, address: d.address || '', area: d.area || '', phone: cwP10(tvCallMob(d.key)) }; }

/* ---------- shell ---------- */
function cwOpen() {
  const el = document.getElementById('cw-body'); if (!el) return;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    let tc = { el: null, n: 0, t: 0 };
    el.addEventListener('click', e => {                       /* नाम पर 3 बार जल्दी click → पूरी profile */
      const n = e.target.closest('.cw-nm'); if (!n) return;
      const now = Date.now(); tc.n = (tc.el === n && now - tc.t < 600) ? tc.n + 1 : 1; tc.el = n; tc.t = now;
      if (tc.n >= 3) { tc.n = 0; cwProfile(n.dataset.k || '', n.dataset.p || '', n.textContent.trim()); }
    });
    setInterval(() => { if (document.getElementById('call-screen').classList.contains('active') && !document.hidden) cwLoadDash(); }, 6000);
  }
  try { if (typeof tvRefresh === 'function') tvRefresh(); } catch (e) {}
  if (!localStorage.getItem(CW_CFG)) CW.tab = 'set';
  cwRender(); cwLoadDash(); cwLoadTab();
}
window.cwOpen = cwOpen;

function cwRender() {
  const el = document.getElementById('cw-body'); if (!el) return;
  const openRate = (CW.rate || []).filter(r => r.status === 'open').length;
  const tabs = [['hist', '📋 Call History'], ['area', '📍 Area Dialer'], ['ia', '⏰ Inactive Auto-Call'], ['pad', '⌨️ Dialpad'], ['queue', '🗓️ Queue / Schedule'],
    ['rate', '💹 Rate Inquiry' + (openRate ? `<span class="n">${openRate}</span>` : '')], ['sup', '🌾 गेहूँ सप्लायर'], ['lead', '🆕 नए Lead'], ['set', '⚙️ Settings']];
  el.innerHTML = `<div class="cw-head"><button class="back-btn" data-go="home">← Home</button>
      <div class="cw-title">📞 CALL WALA<small>AI कॉल — Dograh + n8n + PostgreSQL</small></div>
      <button class="cw-stop" id="cw-stop">🛑 Cancel All Calls</button></div>
    <div id="cw-mon"></div>
    <div class="cw-tabs">${tabs.map(t => `<button class="cw-tab ${CW.tab === t[0] ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>
    <div id="cw-pane"></div>`;
  el.querySelectorAll('.cw-tab').forEach(b => b.addEventListener('click', () => { CW.tab = b.dataset.t; cwRender(); cwLoadTab(); }));
  el.querySelector('#cw-stop').addEventListener('click', cwCancelAll);
  cwMon(); cwPane();
}
async function cwLoadDash() {
  try { CW.dash = await cwApi({ view: 'dash' }); CW.err = ''; } catch (e) { CW.err = e.message || String(e); }
  cwMon(); if (CW.tab === 'queue') cwPane();
}
async function cwLoadTab() {
  try {
    if (CW.tab === 'hist') { CW.calls = (await cwApi({ view: 'calls', q: CW.q, limit: 150 })).calls; }
    else if (CW.tab === 'rate') { CW.rate = (await cwApi({ view: 'rate' })).rows; }
    else if (CW.tab === 'lead') { CW.leads = (await cwApi({ view: 'calls', lead: '1', limit: 150 })).calls; }
    else return;
    CW.err = '';
  } catch (e) { CW.err = e.message || String(e); }
  cwPane();
}

/* ---------- Live Call Queue Monitor ---------- */
function cwMon() {
  const el = document.getElementById('cw-mon'); if (!el) return;
  const d = CW.dash;
  if (!d) { el.innerHTML = `<div class="cw-mon ${CW.err ? 'err' : ''}"><div class="cw-mon-l"><span class="cw-dot"></span>${CW.err ? '⚠️ ' + cwE(CW.err) : 'Live status आ रहा है…'}</div></div>`; return; }
  const c = d.counts || {}, lv = d.live;
  const n8nOff = d.beat === null || d.beat === undefined || d.beat > 150;
  let cls = 'wait', line;
  if (lv) { cls = 'live'; line = `📞 अभी बात चल रही है: <b>${cwE(lv.name || '—')}</b> · ${cwE(lv.phone)} <small>(${cwE(cwKindHi[lv.kind] || lv.kind)} · ${Math.floor((lv.sec || 0) / 60)}:${String((lv.sec || 0) % 60).padStart(2, '0')} · कोशिश ${lv.tries})</small>`; }
  else if (d.stop) { cls = 'stop'; line = '🛑 सारी Auto-Call रुकी हुई हैं <button class="cw-go sm" id="cw-resume">▶ फिर चालू करें</button>'; }
  else if (!d.open) { cls = 'off'; line = `🌙 Calling Hours Lock — अभी ${cwE(d.now)} है; कॉल सिर्फ़ ${cwE(d.hours)} के बीच लगेंगी`; }
  else if (c.queued > 0) { line = `⏳ ${c.queued} कॉल कतार में — अगली कॉल 30 सेकंड के अंदर लगेगी`; }
  else { cls = ''; line = '✅ कोई कॉल बाक़ी नहीं'; }
  const warn = (d.warn || []).slice(); if (n8nOff) warn.push('n8n का "Call Wala" workflow चालू (Published) नहीं दिख रहा — कॉल नहीं लगेंगी');
  el.innerHTML = `<div class="cw-mon ${cls}"><div class="cw-mon-l"><span class="cw-dot"></span><span>${line}</span></div>
    <div class="cw-cnt">${[['dialed', 'आज लगी'], ['done', 'बात हुई'], ['noanswer', 'नहीं उठा'], ['queued', 'कतार में'], ['scheduled', 'Schedule'], ['skipped', 'Skip'], ['failed', 'Fail']]
      .map(x => `<span class="c-${x[0]}"><b>${c[x[0]] || 0}</b>${x[1]}</span>`).join('')}</div>
    ${warn.length ? `<div class="cw-warn">⚠️ ${warn.map(cwE).join(' · ')}</div>` : ''}</div>`;
  const r = el.querySelector('#cw-resume'); if (r) r.addEventListener('click', async () => { try { await cwApi({ action: 'resume' }); toast('▶ Auto-Call फिर चालू'); cwLoadDash(); } catch (e) { toast(e.message); } });
}
async function cwCancelAll() {
  if (!window.confirm('🛑 कतार की सारी कॉल और सारी Schedule कॉल अभी रद्द कर दें?')) return;
  try { const r = await cwApi({ action: 'cancel_all' }); toast(`🛑 ${r.cancelled} कॉल रद्द${r.live ? ' · जो कॉल अभी चल रही है वह पूरी होकर रुकेगी' : ''}`); cwLoadDash(); }
  catch (e) { toast(e.message); }
}

/* ---------- enqueue helper ---------- */
async function cwEnqueue(items, opt) {
  items = (items || []).filter(x => x.phone);
  if (!items.length) { toast('कोई सही मोबाइल नंबर नहीं'); return null; }
  await cwFlush();
  try {
    const r = await cwApi(Object.assign({ action: 'enqueue', items }, opt || {}));
    toast(`✔ ${r.added} कॉल ${opt && opt.at ? 'Schedule' : 'कतार में'}${r.skipped ? ' · ' + r.skipped + ' Skip (आज order आ चुका / DND)' : ''}${r.dup ? ' · ' + r.dup + ' पहले से कतार में' : ''}${r.bad ? ' · ' + r.bad + ' ग़लत नंबर' : ''}`);
    cwLoadDash(); return r;
  } catch (e) { toast(e.message); return null; }
}
function cwAtChips(id) {
  const f = (add, h) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(h, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  return `<input type="datetime-local" id="${id}"><div class="cw-chips" data-for="${id}"><button type="button" data-v="">अभी</button><button type="button" data-v="${f(0, 16)}">आज शाम 4 बजे</button>
    <button type="button" data-v="${f(1, 10)}">कल सुबह 10 बजे</button><button type="button" data-v="${f(1, 16)}">कल शाम 4 बजे</button></div>`;
}
function cwWireChips(root) { root.querySelectorAll('.cw-chips[data-for] button').forEach(b => b.addEventListener('click', () => { root.querySelector('#' + b.parentNode.dataset.for).value = b.dataset.v; })); }

/* ---------- pane router ---------- */
function cwPane() {
  const el = document.getElementById('cw-pane'); if (!el) return;
  const f = { hist: cwHist, area: cwArea, ia: cwInactive, pad: cwPad, queue: cwQueue, rate: cwRate, sup: cwSup, lead: cwLead, set: cwSet }[CW.tab];
  if (f) f(el);
}
function cwCallCard(c) {
  const more = c.more || {}, dur = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : '';
  const chips = [];
  if (c.order_no) chips.push(`<span class="cw-chip ord">🧾 Order No ${cwE(c.order_no)} — ${cwE(c.order_text || '')}</span>`); else if (c.order_text) chips.push(`<span class="cw-chip ord">🧾 ${cwE(c.order_text)}</span>`);
  if (c.rate_talk) chips.push(`<span class="cw-chip rate">💹 ${cwE(c.rate_talk)}</span>`);
  if (c.cb) chips.push(`<span class="cw-chip cb">⏰ Call back: ${cwE(c.cb)}</span>`);
  [['shop', '🏪'], ['products', '📦'], ['monthly', '📊 महीना'], ['brand', 'अभी का brand'], ['wa', '💬'], ['promise', '💵 पेमेंट वादा'], ['wheat_qty', '🌾 मात्रा'], ['wheat_when', '🚚 कब'], ['wheat_rate', '🌾 माँगा रेट']]
    .forEach(x => { if (more[x[0]]) chips.push(`<span class="cw-chip">${x[1]} ${cwE(more[x[0]])}</span>`); });
  const rec = /^https?:\/\//i.test(c.recording || '') ? `<audio controls preload="none" src="${cwE(c.recording)}"></audio>` : '';
  const tr = /^https?:\/\//i.test(c.transcript || '') ? `<a class="cw-chip" href="${cwE(c.transcript)}" target="_blank" rel="noopener">📝 पूरी बातचीत</a>` : '';
  return `<div class="cw-call ${c.answered ? '' : 'miss'}"><div class="cw-call-h">
      <span class="cw-dir ${c.dir === 'in' ? 'in' : ''}">${c.dir === 'in' ? '⬇ Incoming' : '⬆ Outgoing'}</span>
      <b class="cw-nm" data-k="${cwE(c.ckey || '')}" data-p="${cwE(c.phone || '')}" title="3 बार click = पूरी profile">${cwE(c.name || c.phone || '—')}</b>
      <small>${c.address ? cwE(c.address) + ' · ' : ''}📱 ${cwE(c.phone || '')}</small><span class="cw-kind">${cwE(cwKindHi[c.kind] || c.kind || '')}</span>
      ${c.answered ? '' : `<span class="cw-st noanswer">${cwE(c.status || 'नहीं उठा')}</span>`}
      <span class="cw-tm">📅 ${cwE(c.dt)} · 🕐 ${cwE(c.tm)}${dur ? ' · ⏱ ' + dur : ''}</span></div>
    ${c.reason ? `<div class="cw-rsn">🎯 कारण: ${cwE(c.reason)}</div>` : ''}
    ${c.summary ? `<div class="cw-sum">🤖 ${cwE(c.summary)}</div>` : ''}
    ${chips.length || tr ? `<div class="cw-x">${chips.join('')}${tr}</div>` : ''}${rec}</div>`;
}

/* ---------- 📋 Call History + Name Search Bar ---------- */
function cwHist(el) {
  el.innerHTML = `<div class="tvsearch" style="margin:0 0 8px"><span>🔍</span><input id="cw-q" placeholder="Customer का नाम या नंबर लिखें…" value="${cwE(CW.q)}"></div>
    <div class="cw-hint">नाम पर <b>3 बार जल्दी click</b> करें → उस customer की पूरी profile (तारीख़-वार)</div>
    <div id="cw-list">${CW.err ? `<div class="tvempty">⚠️ ${cwE(CW.err)}</div>` : CW.calls === null ? '<div class="tvempty">Load हो रहा है…</div>'
      : CW.calls.length ? CW.calls.map(cwCallCard).join('') : '<div class="tvempty">— अभी कोई कॉल record नहीं —</div>'}</div>`;
  const q = el.querySelector('#cw-q'); let tm;
  q.addEventListener('input', () => { CW.q = q.value; clearTimeout(tm); tm = setTimeout(async () => {
    try { CW.calls = (await cwApi({ view: 'calls', q: CW.q, limit: 150 })).calls; CW.err = ''; } catch (e) { CW.err = e.message; }
    const l = document.getElementById('cw-list'); if (l && CW.tab === 'hist') l.innerHTML = CW.err ? `<div class="tvempty">⚠️ ${cwE(CW.err)}</div>` : (CW.calls.length ? CW.calls.map(cwCallCard).join('') : '<div class="tvempty">— कोई कॉल नहीं मिली —</div>');
  }, 350); });
}

/* ---------- 👤 Triple-click Customer Full Profile (Date-wise Timeline) ---------- */
async function cwProfile(key, phone, shown) {
  let p = null; try { const D = tvBuild(); p = (D.deb || []).find(x => x.key === key) || (D.cred || []).find(x => x.key === key) || null; } catch (e) {}
  const wa = p ? cwP10(tvMob(p.key)) : '', call = p ? (cwP10(tvCallMob(p.key)) || wa) : cwP10(phone);
  let calls = []; try { calls = (await cwApi({ view: 'calls', key: key || '', phone: call || phone || '', phone2: wa, limit: 300 })).calls; } catch (e) { toast(e.message); }
  const ev = [];
  calls.forEach(c => ev.push({ d: c.dt, t: c.tm, html: `<b>${c.dir === 'in' ? '⬇ Incoming' : '⬆ Outgoing'} कॉल</b> <small>${cwE(cwKindHi[c.kind] || '')}${c.answered ? '' : ' · नहीं उठा'}</small>
      ${c.reason ? `<div>🎯 ${cwE(c.reason)}</div>` : ''}${c.summary ? `<div>🤖 ${cwE(c.summary)}</div>` : ''}${c.rate_talk ? `<div>💹 रेट: ${cwE(c.rate_talk)}</div>` : ''}
      ${c.order_text ? `<div>🧾 ऑर्डर${c.order_no ? ' No ' + cwE(c.order_no) : ''}: ${cwE(c.order_text)}</div>` : ''}${c.cb ? `<div>⏰ Call back: ${cwE(c.cb)}</div>` : ''}
      ${/^https?:\/\//i.test(c.recording || '') ? `<audio controls preload="none" src="${cwE(c.recording)}"></audio>` : ''}` }));
  if (p) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || k.indexOf('sg_ord_') !== 0) continue;
      let l = []; try { l = JSON.parse(localStorage.getItem(k)) || []; } catch (e) {}
      l.forEach(o => { if (o && o.name && tvK(o.name) === p.key) ev.push({ d: k.slice(7), t: o.ts || '', html: `<b>🧾 Order No ${cwE(String(o.no || ''))}</b> <small>${o.src === 'call' ? 'AI Call' : (o.wa || o.src === 'wa') ? 'WhatsApp' : o.src === 'coll' ? 'Collection' : 'App'}${o.cancelled ? ' · Cancel' : ''}</small>
        <div>${(o.ordered || o.items || []).map(x => cwE(x.name) + ' × ' + cwE(String(x.qty))).join(', ')}</div>` }); });
    }
    (p.due || []).forEach(x => { if (!x.cut) ev.push({ d: x.date, t: x.ts || '', html: `<b>📄 रसीद ${x.rno ? 'R.No ' + cwE(x.rno) : ''} — ₹${tvF(x.amt)}</b>${x.items ? `<div>${cwE(x.items)}</div>` : ''}` }); });
    (p.paid || []).forEach(x => { if (!x.cut) ev.push({ d: x.date, t: x.ts || '', html: `<b style="color:#15803d">💵 जमा — ₹${tvF(x.amt)}</b> <small>${cwE(x.mode || '')}</small>` }); });
  }
  const byD = {}; ev.forEach(e => (byD[e.d] = byD[e.d] || []).push(e));
  const days = Object.keys(byD).sort((a, b) => tvDV(b) - tvDV(a));
  popup({ title: '👤 ' + cwE(p ? p.name : (shown || phone || 'Profile')),
    body: `<div class="cw-pf"><div>पता<b>${cwE(p ? (p.address || '—') : '—')}</b></div><div>📞 Call Wala<b>${cwE(call || '—')}</b></div><div>💬 WhatsApp Wala<b>${cwE(wa || '—')}</b></div>
        <div>बकाया<b style="color:${p && p.bal > 0 ? '#b91c1c' : '#15803d'}">₹${p ? tvF(Math.max(0, p.bal)) : '0'}</b></div><div>कुल कॉल<b>${calls.length}</b></div><div>Area<b>${cwE(p ? p.area : '—')}</b></div></div>
      ${days.length ? days.map(d => `<div class="cw-tl-d">📅 ${cwE(d)}</div>` + byD[d].map(e => `<div class="cw-tl">${e.t ? `<small>🕐 ${cwE(e.t)}</small> ` : ''}${e.html}</div>`).join('')).join('') : '<div class="tvempty">— कोई record नहीं —</div>'}`,
    foot: `<button class="pp-btn save" id="cw-pf-call">📞 अभी AI Call</button><div style="display:flex;gap:8px">${p ? '<button class="pp-btn addmore" id="cw-pf-mob">📱 नंबर बदलें</button>' : ''}<button class="pp-btn cancel" onclick="closePopup()">बंद</button></div>`,
    onOpen(bk) {
      bk.querySelector('#cw-pf-call').addEventListener('click', () => { closePopup(); CW.pad = { name: p ? p.name : (shown || ''), phone: call || cwP10(phone), key: p ? p.key : '', address: p ? p.address : '', area: p ? p.area : '', agent: p && (tvBuild().cred || []).includes(p) ? 'sup' : 'out' }; CW.tab = 'pad'; cwRender(); });
      const m = bk.querySelector('#cw-pf-mob'); if (m) m.addEventListener('click', () => { closePopup(); tvMobPopup(p.key); });
    } });
}

/* ---------- 📍 Area-Wise Auto-Dialer (Smart Order-Skip) ---------- */
function cwArea(el) {
  const debs = cwDebtors(), ord = cwOrderedToday();
  if (!CW.area) {
    const m = {}; debs.forEach(d => { const a = m[d.area] = m[d.area] || { n: 0, ph: 0, od: 0 }; a.n++; if (cwP10(tvCallMob(d.key))) a.ph++; if (ord.has(d.key)) a.od++; });
    const ks = Object.keys(m).sort();
    el.innerHTML = `<div class="cw-hint">Area चुनें → उस area के सब customer को <b>एक-एक करके</b> AI कॉल लगेगी. जिसका आज order (WhatsApp / कॉल / App) आ चुका है वह अपने आप हट जाता है.</div>
      <div class="tvareas">${ks.map((k, i) => `<button class="tvarea a${i % 6}" data-a="${cwE(k)}"><b>${cwE(k)}</b><small>${m[k].n} customer · 📱 ${m[k].ph} · आज order ${m[k].od}</small></button>`).join('') || '<div class="tvempty">— Tally View में कोई Debtor नहीं —</div>'}</div>`;
    el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { CW.area = b.dataset.a; cwPane(); }));
    return;
  }
  const list = debs.filter(d => d.area === CW.area);
  el.innerHTML = `<div class="cw-card"><h4>📍 ${cwE(CW.area)} <small>${list.length} customer</small> <button class="tvx" id="cw-ax">✖</button></h4>
      <div class="cw-form"><label class="w">🎯 कारण (AI इसी पर बात करेगा)<input id="cw-ar" value="आज का ऑर्डर लेना है।"></label>
        <label class="w">⏰ कब (ख़ाली = अभी)${cwAtChips('cw-aat')}</label></div>
      <div class="cw-bar"><button class="cw-go" id="cw-ago">📞 चुने हुए सबको Call</button><button class="cw-go grey sm" id="cw-aall">सब चुनें / हटाएँ</button></div></div>
    ${list.map(d => { const ph = cwP10(tvCallMob(d.key)), od = ord.has(d.key);
      return `<label class="cw-row ${ph ? '' : 'nonum'} ${od ? 'ord' : ''}"><input type="checkbox" data-k="${cwE(d.key)}" ${ph && !od ? 'checked' : ''} ${ph ? '' : 'disabled'}>
        <span class="nm"><b class="cw-nm" data-k="${cwE(d.key)}" data-p="${ph}">${cwE(d.name)}</b><i>${cwE(d.address || '')}</i></span>
        <span class="ph">${ph ? '📞 ' + ph : '<em style="color:#b91c1c">नंबर नहीं</em>'}</span>
        <span class="tg">${od ? '✅ आज order आ चुका — Skip' : ''}${d.bal > 0 ? `<em>बकाया ₹${tvF(d.bal)}</em>` : ''}</span></label>`; }).join('')}`;
  cwWireChips(el);
  el.querySelector('#cw-ax').addEventListener('click', () => { CW.area = ''; cwPane(); });
  el.querySelector('#cw-aall').addEventListener('click', () => { const bs = [...el.querySelectorAll('input[type=checkbox]:not(:disabled)')]; const on = bs.some(b => !b.checked); bs.forEach(b => b.checked = on); });
  el.querySelector('#cw-ago').addEventListener('click', async () => {
    const keys = [...el.querySelectorAll('input[type=checkbox]:checked')].map(b => b.dataset.k);
    const at = el.querySelector('#cw-aat').value;
    if (!keys.length) { toast('कोई customer चुना नहीं'); return; }
    if (!window.confirm(`${CW.area}: ${keys.length} customer को ${at ? at.replace('T', ' ') + ' पर' : 'अभी'} AI Call लगाएँ?`)) return;
    await cwEnqueue(list.filter(d => keys.includes(d.key)).map(cwItem), { kind: 'area', agent: 'out', batch: CW.area + '-' + Date.now(), reason: el.querySelector('#cw-ar').value.trim(), at });
  });
}

/* ---------- ⏰ 3-Day Inactive Auto-Call (Master → Area → Customer, Set Rate जैसा) ---------- */
function cwInactive(el) {
  const c = cwCfg(), ia = c.inactive, debs = cwDebtors();
  const areas = {}; debs.forEach(d => areas[d.area] = (areas[d.area] || 0) + 1);
  const bs = (v, blank) => `${blank ? `<option value="" ${!v ? 'selected' : ''}>— ऊपर वाला —</option>` : ''}<option value="order" ${v === 'order' ? 'selected' : ''}>Order नहीं आया</option><option value="call" ${v === 'call' ? 'selected' : ''}>Call पर बात नहीं हुई</option>`;
  const q = CW.iaQ.trim().toUpperCase();
  const cl = q ? debs.filter(d => d.key.includes(q) || String(d.address || '').toUpperCase().includes(q)).slice(0, 40) : debs.filter(d => ia.cust[d.key]);
  el.innerHTML = `<div class="cw-card"><h4>⭐ MASTER <small>सब customer के लिए common</small></h4><div class="cw-form">
      <label>Auto-Call<select id="ia-on"><option value="true" ${ia.on !== false ? 'selected' : ''}>✅ चालू</option><option value="false" ${ia.on === false ? 'selected' : ''}>⛔ बंद</option></select></label>
      <label>कितने दिन बाद<input type="number" min="0" id="ia-days" value="${cwE(String(ia.days))}"></label>
      <label>किस आधार पर<select id="ia-basis">${bs(ia.basis)}</select></label>
      <label>रोज़ कितने बजे list बने<input type="time" id="ia-time" value="${cwE(ia.time)}"></label></div>
      <div class="cw-bar"><button class="cw-go" id="ia-save">💾 Save</button><button class="cw-go blue sm" id="ia-now">▶ आज की list अभी बनाओ</button></div></div>
    <div class="cw-card"><h4>📍 AREA WISE <small>ख़ाली = Master · 0 = इस area में बंद</small></h4><table class="em-tbl"><tr><th>Area</th><th>दिन</th><th>आधार</th></tr>
      ${Object.keys(areas).sort().map(a => { const r = ia.area[a] || {}; return `<tr><td><b>${cwE(a)}</b> <small>${areas[a]}</small></td><td><input type="number" min="0" data-ia-a="${cwE(a)}" value="${r.days ?? ''}" placeholder="${cwE(String(ia.days))}"></td><td><select data-ia-ab="${cwE(a)}">${bs(r.basis, true)}</select></td></tr>`; }).join('')}</table></div>
    <div class="cw-card"><h4>👤 CUSTOMER WISE <small>ख़ाली = Area / Master · 0 = इसे कभी auto-call नहीं</small></h4>
      <div class="tvsearch" style="margin:0 0 8px"><span>🔍</span><input id="ia-q" placeholder="नाम / पता लिखें…" value="${cwE(CW.iaQ)}"></div>
      <table class="em-tbl">${cl.map(d => { const r = ia.cust[d.key] || {}; return `<tr><td><b class="cw-nm" data-k="${cwE(d.key)}">${cwE(d.name)}</b> <small>${cwE(d.area)}</small></td><td><input type="number" min="0" data-ia-c="${cwE(d.key)}" value="${r.days ?? ''}" placeholder="—"></td><td><select data-ia-cb="${cwE(d.key)}">${bs(r.basis, true)}</select></td></tr>`; }).join('') || '<tr><td>ऊपर नाम खोजें — जिस customer का अलग दिन set करना हो</td></tr>'}</table></div>`;
  const collect = () => {
    const c2 = cwCfg(), x = c2.inactive;
    x.on = el.querySelector('#ia-on').value === 'true'; x.days = Math.max(0, parseInt(el.querySelector('#ia-days').value, 10) || 0);
    x.basis = el.querySelector('#ia-basis').value; x.time = el.querySelector('#ia-time').value || '10:00';
    const put = (map, k, days, basis) => { const o = {}; if (days !== '') o.days = Math.max(0, parseInt(days, 10) || 0); if (basis) o.basis = basis; if (Object.keys(o).length) map[k] = o; else delete map[k]; };
    el.querySelectorAll('[data-ia-a]').forEach(i => put(x.area, i.dataset.iaA, i.value, el.querySelector(`[data-ia-ab="${CSS.escape(i.dataset.iaA)}"]`).value));
    el.querySelectorAll('[data-ia-c]').forEach(i => put(x.cust, i.dataset.iaC, i.value, el.querySelector(`[data-ia-cb="${CSS.escape(i.dataset.iaC)}"]`).value));
    cwSaveCfg(c2);
  };
  el.querySelector('#ia-save').addEventListener('click', () => { collect(); toast('⏰ Inactive Auto-Call setting save ✔'); cwPane(); });
  el.querySelector('#ia-now').addEventListener('click', async () => { collect(); await cwFlush(); try { const r = await cwApi({ action: 'inactive_now' }); toast(`▶ ${r.added} customer कतार में जोड़े गए`); cwLoadDash(); } catch (e) { toast(e.message); } });
  const iq = el.querySelector('#ia-q'); let tm; iq.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { collect(); CW.iaQ = iq.value; cwPane(); const n = document.getElementById('ia-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 500); });
}

/* ---------- ⌨️ Custom Dialpad ('Karan' box) + Schedule ---------- */
function cwPad(el) {
  const p = CW.pad || {}, all = cwDebtors().concat(cwSuppliers());
  el.innerHTML = `<div class="cw-card"><h4>⌨️ Dialpad <small>नाम · नंबर · कारण — AI ठीक उसी कारण पर बात करेगा</small></h4><div class="cw-form">
      <label>Customer का नाम<input id="pd-name" list="pd-dl" value="${cwE(p.name || '')}" placeholder="नाम लिखें / चुनें"><datalist id="pd-dl">${all.map(d => `<option value="${cwE(d.name)}">${cwE(d.address || '')}</option>`).join('')}</datalist></label>
      <label>मोबाइल नंबर<input id="pd-ph" type="tel" inputmode="numeric" maxlength="13" value="${cwE(p.phone || '')}" placeholder="10 अंक"></label>
      <label>किससे बात<select id="pd-ag">${CW_AGENTS.slice(0, 3).map(a => `<option value="${a[0]}" ${p.agent === a[0] ? 'selected' : ''}>${a[1]}</option>`).join('')}</select></label>
      <label class="w">🎯 Karan / कारण<textarea id="pd-rs" rows="2" placeholder="जैसे: पिछला ₹12,000 बकाया कब देंगे पूछना है · नया रेट बताना है · कल का माल ठीक पहुँचा या नहीं">${cwE(p.reason || '')}</textarea></label>
      <label class="w">⏰ Schedule (ख़ाली = अभी)${cwAtChips('pd-at')}</label></div>
      <div class="cw-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C'].map(k => `<button type="button" data-key="${k}">${k}</button>`).join('')}</div>
      <div class="cw-bar" style="justify-content:center"><button class="cw-go" id="pd-go">📞 AI Call लगाओ</button><a class="cw-go grey" id="pd-tel" href="#">☎️ ख़ुद Call करें</a></div></div>`;
  cwWireChips(el);
  const nm = el.querySelector('#pd-name'), ph = el.querySelector('#pd-ph');
  nm.addEventListener('change', () => { const d = all.find(x => x.name === nm.value.trim()); if (d) { CW.pad = Object.assign(cwItem(d), { agent: (d.cats && d.cats.wheat && !cwDebtors().includes(d)) ? 'sup' : 'out' }); ph.value = CW.pad.phone || ''; el.querySelector('#pd-ag').value = CW.pad.agent; } });
  el.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.key; ph.value = k === 'C' ? '' : k === '⌫' ? ph.value.slice(0, -1) : (ph.value + k).slice(0, 13); }));
  el.querySelector('#pd-tel').addEventListener('click', e => { const n = cwP10(ph.value); if (!n) { e.preventDefault(); toast('10 अंक का नंबर भरें'); } else e.currentTarget.href = 'tel:' + n; });
  el.querySelector('#pd-go').addEventListener('click', async () => {
    const n = cwP10(ph.value); if (!n) { toast('10 अंक का सही नंबर भरें'); return; }
    const d = all.find(x => x.name === nm.value.trim()), at = el.querySelector('#pd-at').value;
    const r = await cwEnqueue([{ key: d ? d.key : (CW.pad.key || ''), name: nm.value.trim(), address: d ? d.address : (CW.pad.address || ''), area: d ? d.area : (CW.pad.area || ''), phone: n }],
      { kind: 'manual', agent: el.querySelector('#pd-ag').value, reason: el.querySelector('#pd-rs').value.trim(), at });
    if (r && r.added) { CW.pad = {}; CW.tab = 'queue'; cwRender(); }
  });
}

/* ---------- 🗓️ Live Queue / Schedule ---------- */
function cwQueue(el) {
  const d = CW.dash; if (!d) { el.innerHTML = `<div class="tvempty">${CW.err ? '⚠️ ' + cwE(CW.err) : 'Load हो रहा है…'}</div>`; return; }
  const row = (q, done) => `<div class="cw-row"><span class="cw-st ${cwE(q.status || 'queued')}">${done ? cwE(cwStHi[q.status] || q.status) : (q.future ? '⏰ ' + cwE(q.sat) : 'कतार में')}</span>
      <span class="nm"><b class="cw-nm" data-p="${cwE(q.phone)}">${cwE(q.name || q.phone)}</b><i>${cwE(q.area || '')} · ${cwE(cwKindHi[q.kind] || q.kind)}${q.tries ? ' · कोशिश ' + q.tries : ''}</i>${q.reason ? `<div style="font-size:12px;color:#7c2d12">🎯 ${cwE(q.reason)}</div>` : ''}${q.note ? `<div style="font-size:11.5px;color:#64748b">${cwE(q.note)}</div>` : ''}</span>
      <span class="ph">📞 ${cwE(q.phone)}${done ? ' · ' + cwE(q.tm) : ''}</span>${done ? '' : `<button class="cw-go red sm" data-cx="${q.id}">✖</button>`}</div>`;
  el.innerHTML = `${d.live ? `<div class="cw-card"><h4>📞 अभी चालू <button class="cw-go grey sm" id="q-free" style="float:right">अटकी line ख़ाली करें</button></h4><div>${cwE(d.live.name || '')} · ${cwE(d.live.phone)} — ${cwE(d.live.note || '')}</div></div>` : ''}
    <div class="cw-card"><h4>⏳ कतार + Schedule <small>${d.queue.length}</small></h4>${d.queue.length ? d.queue.map(q => row(q, false)).join('') : '<div class="tvempty">— कतार ख़ाली —</div>'}</div>
    <div class="cw-card"><h4>📒 आज हो चुकी <small>${d.recent.length}</small></h4>${d.recent.length ? d.recent.map(q => row(q, true)).join('') : '<div class="tvempty">—</div>'}</div>
    ${d.dnd && d.dnd.length ? `<div class="cw-card"><h4>🚫 DND <small>इन्होंने "दोबारा कॉल मत करना" कहा — Auto-Dialer इन्हें छोड़ देता है</small></h4>${d.dnd.map(x => `<div class="cw-row"><span class="nm"><b>${cwE(x.name || '')}</b> 📞 ${cwE(x.phone)}</span><button class="cw-go grey sm" data-dnd="${cwE(x.phone)}">हटाएँ</button></div>`).join('')}</div>` : ''}`;
  el.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', async () => { try { await cwApi({ action: 'cancel', id: b.dataset.cx }); cwLoadDash(); } catch (e) { toast(e.message); } }));
  el.querySelectorAll('[data-dnd]').forEach(b => b.addEventListener('click', async () => { try { await cwApi({ action: 'dnd_remove', phone: b.dataset.dnd }); cwLoadDash(); } catch (e) { toast(e.message); } }));
  const f = el.querySelector('#q-free'); if (f) f.addEventListener('click', async () => { if (!window.confirm('चालू दिख रही कॉल को कतार से हटा दें? (असली कॉल चल रही हो तो वह नहीं कटेगी)')) return; try { await cwApi({ action: 'free_line' }); cwLoadDash(); } catch (e) { toast(e.message); } });
}

/* ---------- 💹 Rate Inquiry / Negotiation (Approve / Reject) ---------- */
const CW_RK = { 'Atta Gold': 'gold', 'Atta 5kg': 'a5', 'Atta 10kg': 'a10', 'Atta 18kg': 'a18', 'Sattu 200g': 'sattu', 'Sattu 500g': 'sattu', 'Besan 200g': 'besan', 'Besan 500g': 'besan', 'Chokar (30kg)': 'chokar' };
function cwRate(el) {
  const rows = CW.rate;
  el.innerHTML = `<div class="cw-hint">जिन customer ने कॉल पर <b>सिर्फ़ रेट पूछा</b> या <b>रेट कम करने को कहा</b>. Approve करने पर वह रेट उसी customer का Special Rate (💰 Set Rate) बन जाता है.</div>` +
    (CW.err ? `<div class="tvempty">⚠️ ${cwE(CW.err)}</div>` : rows === null ? '<div class="tvempty">Load हो रहा है…</div>' : !rows.length ? '<div class="tvempty">— कोई Rate Inquiry नहीं —</div>' : rows.map(r => `<div class="cw-call ${r.status === 'open' ? 'miss' : ''}" data-r="${r.id}">
      <div class="cw-call-h"><span class="cw-dir ${r.kind === 'nego' ? '' : 'in'}">${r.kind === 'nego' ? '📉 Negotiation' : '❓ रेट पूछा'}</span><b class="cw-nm" data-k="${cwE(r.ckey || '')}" data-p="${cwE(r.phone || '')}">${cwE(r.name || r.phone || '—')}</b>
        <small>${cwE(r.area || '')} · 📱 ${cwE(r.phone || '')}</small><span class="cw-tm">${cwE(r.at)}</span></div>
      <div class="cw-sum">${r.item ? `<b>${cwE(r.item)}</b> — ` : ''}${r.cur_rate ? `अभी ₹${cwE(String(r.cur_rate))}` : ''}${r.want_rate ? ` → चाहता है <b style="color:#6b21a8">₹${cwE(String(r.want_rate))}</b>` : ''}<div>${cwE(r.note || '')}</div></div>
      ${/^https?:\/\//i.test(r.recording || '') ? `<audio controls preload="none" src="${cwE(r.recording)}"></audio>` : ''}
      ${r.status === 'open' ? `<div class="cw-bar"><input type="number" inputmode="decimal" class="rt-v" value="${cwE(String(r.want_rate || ''))}" placeholder="नया रेट ₹" style="width:120px;padding:8px;border:1.6px solid #dbe3ee;border-radius:9px">
        <button class="cw-go sm rt-ok">✅ Approve</button><button class="cw-go red sm rt-no">✖ Reject</button></div>`
        : `<div class="cw-x"><span class="cw-chip ${r.status === 'approved' ? 'ord' : 'cb'}">${r.status === 'approved' ? '✅ Approved' + (r.final_rate ? ' ₹' + cwE(String(r.final_rate)) : '') : '✖ Rejected'} · ${cwE(r.dat || '')}</span></div>`}</div>`).join(''));
  el.querySelectorAll('.rt-ok,.rt-no').forEach(b => b.addEventListener('click', async () => {
    const card = b.closest('[data-r]'), r = rows.find(x => String(x.id) === card.dataset.r), ok = b.classList.contains('rt-ok');
    const rate = parseFloat(card.querySelector('.rt-v').value);
    if (ok && r.kind === 'nego' && !(rate > 0)) { toast('नया रेट भरें'); return; }
    if (!window.confirm(`${r.name || r.phone}: ${ok ? 'Approve' + (rate > 0 ? ' ₹' + rate : '') : 'Reject'} — पक्का?`)) return;
    try {
      const rk = CW_RK[r.item];
      if (ok && rate > 0 && rk && r.ckey && typeof srLoad === 'function') {      /* Set Rate में customer special = area rate − नया rate */
        const R = srLoad(), less = srAreaBase(R, r.area, rk) - rate;
        if (less > 0) { R.cust[r.ckey] = Object.assign({}, R.cust[r.ckey] || {}, { [rk]: less }); srSave(R); }
        else toast('ध्यान दें: नया रेट area रेट से कम नहीं — Set Rate नहीं बदला');
      }
      await cwApi({ action: 'rate_decide', id: r.id, status: ok ? 'approved' : 'rejected', rate: rate > 0 ? rate : null });
      if (cwP10(r.phone) && window.confirm('Customer को AI Call से यह जवाब बता दें?'))
        await cwEnqueue([{ key: r.ckey || '', name: r.name || '', area: r.area || '', phone: cwP10(r.phone) }], { kind: 'manual', agent: 'out',
          reason: ok ? `इनके रेट की बात मालिक जी ने मान ली है${r.item ? ' — ' + r.item : ''}${rate > 0 ? ' का नया रेट ' + rate + ' रुपये' : ''}। यह ख़ुशख़बरी देकर ऑर्डर लो।` : `इनके रेट कम करने की बात पर मालिक जी ने कहा है कि अभी रेट कम नहीं हो पाएगा — विनम्रता से बताओ, क्वालिटी का भरोसा दो और ऑर्डर पूछो।` });
      toast('✔ Save'); cwLoadTab();
    } catch (e) { toast(e.message); }
  }));
}

/* ---------- 🌾 गेहूँ सप्लायर AI डेस्क ---------- */
function cwSup(el) {
  const c = cwCfg(), w = c.wheat, sup = cwSuppliers();
  let master = ''; try { master = (srLoad().master || {}).wheat || ''; } catch (e) {}
  el.innerHTML = `<div class="cw-card"><h4>🌾 आज का गेहूँ रेट <small>सप्लायर कॉल करे तो AI यही रेट बताएगा</small></h4><div class="cw-form">
      <label>रेट ₹ <small style="font-weight:500">(ख़ाली = Set Rate का Master Wheat ${master ? '₹' + cwE(String(master)) : '—'})</small><input type="number" id="sp-rate" value="${cwE(String(w.rate || ''))}" placeholder="${cwE(String(master || ''))}"></label>
      <label>किस हिसाब से<input id="sp-unit" value="${cwE(w.unit)}" placeholder="प्रति बोरा / प्रति क्विंटल"></label>
      <label>कितना चाहिए<input id="sp-need" value="${cwE(w.need)}" placeholder="जैसे: 300 बोरा"></label>
      <label class="w">शर्त / नोट (AI बोलेगा)<input id="sp-note" value="${cwE(w.note)}" placeholder="जैसे: सूखा साफ़ गेहूँ, नमी वाला नहीं; पेमेंट तौल के बाद"></label></div>
      <div class="cw-bar"><button class="cw-go" id="sp-save">💾 Save</button></div></div>
    <div class="cw-card"><h4>📞 गेहूँ ख़रीदना है <small>${sup.length} सप्लायर (Tally View → Creditors जिनसे गेहूँ आया)</small></h4>
      <div class="cw-form"><label class="w">🎯 कारण<input id="sp-rs" value="मिल में गेहूँ कम है — आज के रेट पर गेहूँ ख़रीदना है। पूछो कितना दे सकते हैं और कब तक पहुँचा देंगे।"></label><label class="w">⏰ कब (ख़ाली = अभी)${cwAtChips('sp-at')}</label></div>
      <div class="cw-bar"><button class="cw-go" id="sp-go">🌾 सभी सप्लायर को एक-एक करके Call</button></div></div>
    ${sup.map(d => { const ph = cwP10(tvCallMob(d.key)); return `<label class="cw-row ${ph ? '' : 'nonum'}"><input type="checkbox" data-k="${cwE(d.key)}" ${ph ? 'checked' : 'disabled'}><span class="nm"><b class="cw-nm" data-k="${cwE(d.key)}" data-p="${ph}">${cwE(d.name)}</b><i>${cwE(d.address || '')}</i></span><span class="ph">${ph ? '📞 ' + ph : '<em style="color:#b91c1c">नंबर नहीं — Tally View में भरें</em>'}</span></label>`; }).join('') || '<div class="tvempty">— कोई गेहूँ सप्लायर नहीं —</div>'}`;
  cwWireChips(el);
  const save = () => { const c2 = cwCfg(); c2.wheat = { rate: el.querySelector('#sp-rate').value.trim(), unit: el.querySelector('#sp-unit').value.trim() || 'प्रति बोरा', need: el.querySelector('#sp-need').value.trim(), note: el.querySelector('#sp-note').value.trim() }; cwSaveCfg(c2); };
  el.querySelector('#sp-save').addEventListener('click', () => { save(); toast('🌾 गेहूँ रेट save ✔'); });
  el.querySelector('#sp-go').addEventListener('click', async () => {
    const keys = [...el.querySelectorAll('input[type=checkbox]:checked')].map(b => b.dataset.k); if (!keys.length) { toast('कोई सप्लायर चुना नहीं'); return; }
    if (!window.confirm(`${keys.length} गेहूँ सप्लायर को AI Call लगाएँ?`)) return;
    save(); await cwEnqueue(sup.filter(d => keys.includes(d.key)).map(cwItem), { kind: 'supplier', agent: 'sup', batch: 'wheat-' + Date.now(), reason: el.querySelector('#sp-rs').value.trim(), at: el.querySelector('#sp-at').value });
  });
}

/* ---------- 🆕 नए Lead (नया दुकानदार / customer जिसने कॉल किया या जिसे कॉल गई) ---------- */
function cwLead(el) {
  el.innerHTML = `<div class="cw-hint">अनजान नंबर से आई कॉल और "नया Customer / दुकानदार" agent की कॉल — दुकान का नाम, पता, कितना माल लगता है. Sales team यहाँ से दोबारा कॉल करे.</div>` +
    (CW.err ? `<div class="tvempty">⚠️ ${cwE(CW.err)}</div>` : CW.leads === null ? '<div class="tvempty">Load हो रहा है…</div>' : CW.leads.length ? CW.leads.map(c => cwCallCard(c).replace(/<\/div>$/, `<div class="cw-bar"><span class="cw-chip">${c.ptype === 'new-shop' ? '🏪 दुकानदार' : c.ptype === 'new-customer' ? '🏠 घरेलू customer' : '🆕 नया'}</span><button class="cw-go blue sm" data-lead="${cwE(c.phone || '')}" data-nm="${cwE(c.name || '')}">📞 दोबारा Call</button></div></div>`)).join('') : '<div class="tvempty">— कोई नया lead नहीं —</div>');
  el.querySelectorAll('[data-lead]').forEach(b => b.addEventListener('click', () => { CW.pad = { name: b.dataset.nm, phone: b.dataset.lead, agent: 'new' }; CW.tab = 'pad'; cwRender(); }));
}

/* ---------- ⚙️ Settings ---------- */
function cwSet(el) {
  const c = cwCfg(), dg = c.dograh, hook = c.hookKey ? `${c.n8n}?k=${c.hookKey}` : '';
  const copy = t => `<div class="cw-url"><span style="flex:1">${cwE(t)}</span><button type="button" data-copy="${cwE(t)}">Copy</button></div>`;
  el.innerHTML = `<div class="cw-card"><h4>🤖 Dograh <small>Voice Agents → Agent खोलें → Settings में Agent UUID; ID = list वाला नंबर</small></h4><div class="cw-form">
      <label class="w">Dograh URL<input id="st-base" value="${cwE(dg.base)}" placeholder="https://140-245-7-25.sslip.io"></label>
      <label>Telephony Configuration ID<input id="st-tel" type="number" value="${cwE(String(dg.tel || ''))}" placeholder="7 (Voicelink-Asterisk)"></label>
      <label>नंबर का format<select id="st-fmt">${[['+91', '+919876543210'], ['91', '919876543210'], ['10', '9876543210'], ['0', '09876543210']].map(f => `<option value="${f[0]}" ${dg.fmt === f[0] ? 'selected' : ''}>${f[1]}</option>`).join('')}</select></label></div>
      <table class="em-tbl" style="margin-top:10px"><tr><th>Agent</th><th>Agent UUID</th><th>ID</th></tr>${CW_AGENTS.slice(0, 4).map(a => { const g = dg.agents[a[0]] || {}; return `<tr><td><b>${a[1]}</b></td><td><input data-au="${a[0]}" value="${cwE(g.uuid || '')}" placeholder="xxxxxxxx-xxxx-…"></td><td style="width:80px"><input data-ai="${a[0]}" type="number" value="${cwE(String(g.id || ''))}"></td></tr>`; }).join('')}</table></div>
    <div class="cw-card"><h4>🕘 Calling Hours Lock + Auto-Retry</h4><div class="cw-form">
      <label>कॉल शुरू<input type="time" id="st-hf" value="${cwE(c.hours.from)}"></label><label>कॉल बंद<input type="time" id="st-ht" value="${cwE(c.hours.to)}"></label>
      <label>दोपहर बंद — से<input type="time" id="st-lf" value="${cwE(c.lunch.from)}"></label><label>दोपहर बंद — तक<input type="time" id="st-lt" value="${cwE(c.lunch.to)}"></label>
      <label>फोन न उठे तो कितनी बार दोबारा<select id="st-rm">${[0, 1, 2, 3].map(n => `<option ${Number(c.retry.max) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>कितनी देर बाद<select id="st-rg">${[[15, '15 मिनट'], [30, '30 मिनट'], [60, '1 घंटा'], [120, '2 घंटे']].map(g => `<option value="${g[0]}" ${Number(c.retry.gap) === g[0] ? 'selected' : ''}>${g[1]}</option>`).join('')}</select></label></div></div>
    <div class="cw-card"><h4>🔗 n8n Webhook</h4><div class="cw-form"><label class="w">n8n का Production Webhook URL<input id="st-n8n" value="${cwE(c.n8n)}"></label></div>
      ${hook ? `<div class="cw-hint" style="margin-top:10px">यही एक URL Dograh में दो जगह लगता है (Agent file download करने पर अपने आप भरा आता है): <b>Start Call → Pre-Call Data Fetch</b> और <b>Webhook node</b></div>${copy(hook)}` : '<div class="cw-warn">पहले Save दबाएँ — URL की secret key बनेगी</div>'}
      <div class="cw-bar"><button class="cw-go" id="st-save">💾 Settings Save</button></div></div>
    <div class="cw-card"><h4>⬇️ Download <small>Setup की files</small></h4>
      <div class="cw-bar">${[['1-outgoing-customer', '① Outgoing Customer'], ['2-incoming-all', '② Incoming (सब)'], ['3-new-customer-lead', '③ नया Customer / दुकानदार'], ['4-wheat-supplier', '④ गेहूँ सप्लायर'], ['5-owner-stock-alert', '⑤ Owner Stock Alert']]
        .map(f => `<button class="cw-go blue sm" data-dl="dograh/${f[0]}.json">Dograh ${f[1]}</button>`).join('')}</div>
      <div class="cw-bar"><button class="cw-go grey sm" data-dl="n8n-call-wala.json">n8n workflow (.json)</button><button class="cw-go grey sm" data-dl="call-schema.sql">PostgreSQL SQL</button><a class="cw-go grey sm" href="CALL-WALA-SETUP.md" target="_blank" rel="noopener">📖 पूरा Setup Guide</a></div></div>`;
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copy ✔'), () => toast('Copy नहीं हुआ — दबाकर select करें')); }));
  el.querySelector('#st-save').addEventListener('click', () => {
    const c2 = cwCfg(), v = id => el.querySelector(id).value.trim();
    c2.dograh.base = v('#st-base').replace(/\/+$/, ''); c2.dograh.tel = v('#st-tel'); c2.dograh.fmt = v('#st-fmt');
    CW_AGENTS.slice(0, 4).forEach(a => { c2.dograh.agents[a[0]] = { uuid: el.querySelector(`[data-au="${a[0]}"]`).value.trim(), id: el.querySelector(`[data-ai="${a[0]}"]`).value.trim() }; });
    c2.hours = { from: v('#st-hf') || '09:00', to: v('#st-ht') || '19:00' }; c2.lunch = { from: v('#st-lf'), to: v('#st-lt') };
    c2.retry = { max: Number(v('#st-rm')), gap: Number(v('#st-rg')) }; c2.n8n = v('#st-n8n').replace(/\?.*$/, '');
    cwSaveCfg(c2); toast('⚙️ Settings save ✔'); cwPane(); cwLoadDash();
  });
  el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
    const c2 = cwCfg(); if (!c2.hookKey) { toast('पहले Settings Save करें'); return; }
    try {
      let t = await (await fetch(b.dataset.dl, { cache: 'no-store' })).text();
      t = t.split('https://n8n.satyamgold.com/webhook/sg-call?k=REPLACE_HOOK_KEY').join(`${c2.n8n}?k=${c2.hookKey}`).split('https://REPLACE-DOGRAH-URL').join(c2.dograh.base || 'https://REPLACE-DOGRAH-URL');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/octet-stream' })); a.download = b.dataset.dl.split('/').pop(); document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Download नहीं हुआ: ' + e.message); }
  }));
}
