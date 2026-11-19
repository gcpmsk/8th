/* =====================================================================
   🚨 EMERGENCY WALA — Live Stock + माल आवत (700g सूती बोरा कटौती) + बारदाना हिसाब
   ---------------------------------------------------------------------
   • sg_em_cfg  — settings (limit, 2 owner number, "1 qty = कितने किलो" table)
   • sg_em_in   — माल आवत / adjust की entry
   • sg_em_bora — खाली बोरा (बारदाना) वापसी हिसाब
   Live stock PostgreSQL में गिना जाता है (em_stock): आवत − हर Atta Receipt की कटौती.
   Low-stock alert (WhatsApp + AI call) n8n के cw_tick() से जाता है.
   ===================================================================== */
'use strict';
const EM_CFG = 'sg_em_cfg', EM_IN = 'sg_em_in', EM_BORA = 'sg_em_bora';
const EM = { tab: 'stock', stock: null, err: '' };
const EM_DEF = { jute: 0.7, bagKg: 50, nb: true, repeatH: 24, owners: ['', ''], from: '', waTemplate: '', waLang: 'hi',
  mats: [{ k: 'wheat', n: 'गेहूँ', unit: 'kg', limit: 200 }, { k: 'chana', n: 'चना', unit: 'kg', limit: 0 }, { k: 'pbag', n: 'खाली Packing बोरा', unit: 'pcs', limit: 0 }],
  ded: { 'Atta Gold': { m: 'wheat', kg: 50 }, 'Atta 50kg': { m: 'wheat', kg: 50 }, 'Atta 47kg': { m: 'wheat', kg: 47 }, 'Atta 18kg': { m: 'wheat', kg: 18 }, 'Atta 10kg': { m: 'wheat', kg: 10 },
    'Atta 5kg': { m: 'wheat', kg: 5 }, 'Chokar (30kg)': { m: 'wheat', kg: 30 }, 'Sattu 200g': { m: 'chana', kg: 0.2 }, 'Sattu 500g': { m: 'chana', kg: 0.5 }, 'Besan 200g': { m: 'chana', kg: 0.2 }, 'Besan 500g': { m: 'chana', kg: 0.5 } } };
const emE = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
const emN = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const emF = n => (Math.round(emN(n) * 10) / 10).toLocaleString('en-IN');
function emCfg() { let c = {}; try { c = JSON.parse(localStorage.getItem(EM_CFG) || '{}') || {}; } catch (e) {} return Object.assign(JSON.parse(JSON.stringify(EM_DEF)), c); }
function emArr(k) { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function emSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); try { window.sgSync && window.sgSync.push(); } catch (e) {} }
const emId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function emOpen() { emRender(); emLoad(); }
window.emOpen = emOpen;
async function emLoad() {
  try { if (typeof cwFlush === 'function') await cwFlush(); EM.stock = await cwApi({ view: 'stock' }); EM.err = ''; } catch (e) { EM.err = e.message || String(e); }
  if (EM.tab === 'stock') emPane();
}
function emRender() {
  const el = document.getElementById('em-body'); if (!el) return;
  const tabs = [['stock', '📦 Live Stock'], ['in', '➕ माल आवत'], ['bora', '🧺 बारदाना हिसाब'], ['set', '⚙️ Settings']];
  el.innerHTML = `<div class="cw-head"><button class="back-btn" data-go="home">← Home</button>
      <div class="cw-title">🚨 EMERGENCY WALA<small>Live Stock · माल आवत · Low-Stock Alert</small></div><button class="cw-go grey sm" id="em-ref">↻ Refresh</button></div>
    <div class="cw-tabs">${tabs.map(t => `<button class="cw-tab ${EM.tab === t[0] ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div><div id="em-pane"></div>`;
  el.querySelectorAll('.cw-tab').forEach(b => b.addEventListener('click', () => { EM.tab = b.dataset.t; emRender(); if (EM.tab === 'stock') emLoad(); }));
  el.querySelector('#em-ref').addEventListener('click', () => { toast('↻'); emLoad(); });
  emPane();
}
function emPane() { const el = document.getElementById('em-pane'); if (!el) return; ({ stock: emStock, in: emIn, bora: emBora, set: emSettings })[EM.tab](el); }

/* ---------- 📦 Live Stock ---------- */
function emStock(el) {
  const s = EM.stock, c = emCfg();
  if (!s) { el.innerHTML = `<div class="tvempty">${EM.err ? '⚠️ ' + emE(EM.err) : 'Stock गिना जा रहा है…'}</div>`; return; }
  const own = (c.owners || []).filter(x => String(x || '').replace(/\D/g, '').length >= 10).length;
  el.innerHTML = `${!c.from ? '<div class="cw-warn" style="margin-bottom:10px">⚠️ पहले ⚙️ Settings में <b>Stock कब से गिनना है</b> (तारीख़) भरें और आज का गिना हुआ stock "➕ माल आवत" में एक entry से डालें — वरना पुरानी सारी रसीदें घट जाएँगी.</div>' : ''}
    ${own < 2 ? '<div class="cw-warn" style="margin-bottom:10px">⚠️ ⚙️ Settings में दोनों Owner नंबर भरें — तभी Low-Stock alert जाएगा.</div>' : ''}
    <div class="em-grid">${(s.mats || []).map(m => { const kg = m.unit === 'kg', cur = kg ? emN(m.bora) : emN(m.bal), pct = m.limit > 0 ? Math.max(3, Math.min(100, cur / (m.limit * 3) * 100)) : 100;
      return `<div class="em-mat ${m.low ? 'low' : ''}"><h5>${emE(m.n)}${m.low ? '<span class="em-low">LOW STOCK</span>' : ''}</h5>
        <div class="big">${emF(cur)}<small>${kg ? 'बोरा' : 'पीस'}</small></div>${kg ? `<div class="sub">= ${emF(m.bal)} किलो (${emE(String(s.bagKg))} kg/बोरा)</div>` : ''}
        <div class="sub">आवत ${emF(m.in)} − निकासी ${emF(m.out)}${m.limit > 0 ? ` · Alert limit <b>${emF(m.limit)}</b> ${kg ? 'बोरा' : 'पीस'}` : ' · limit set नहीं'}</div>
        <div class="em-meter"><i style="width:${pct}%"></i></div></div>`; }).join('')}</div>
    <div class="cw-card"><h4>📊 आज <small>${emE(s.at || '')}</small></h4><div class="cw-pf">
      <div>आज रसीद कटी<b>${emE(String(s.rc.n))}</b></div><div>आज गेहूँ का माल निकला<b>${emF(s.rc.kg)} kg</b></div>
      <div>Pending order<b>${emE(String(s.pend.n))}</b></div><div>Pending के लिए गेहूँ चाहिए<b>${emF(s.pend.kg)} kg</b></div></div>
      ${(s.unmapped || []).length ? `<div class="cw-warn">⚠️ इन item की "1 qty = कितने किलो" setting नहीं है, इसलिए stock से नहीं घट रहे: <b>${s.unmapped.map(emE).join(', ')}</b> — ⚙️ Settings में जोड़ें</div>` : ''}</div>
    <div class="cw-card"><h4>🔔 पिछले Alert</h4>${(s.alerts || []).length ? s.alerts.map(a => `<div class="em-e"><small>${emE(a.t)}</small><span>${emE(a.body)}</span></div>`).join('') : '<div class="tvempty">— अभी तक कोई alert नहीं गया —</div>'}</div>`;
}

/* ---------- ➕ माल आवत (700g सूती बोरा कटौती) ---------- */
function emIn(el) {
  const c = emCfg(), list = emArr(EM_IN).slice().reverse();
  el.innerHTML = `<div class="cw-card"><h4>➕ माल आवत / Stock entry <small>गेहूँ में प्रति बोरा ${emE(String(c.jute))} kg सूती बोरा अपने आप घटता है</small></h4><div class="cw-form">
      <label>माल<select id="ei-mat">${c.mats.map(m => `<option value="${emE(m.k)}">${emE(m.n)}</option>`).join('')}</select></label>
      <label>प्रकार<select id="ei-dir"><option value="in">⬇ आवत (stock में जुड़ेगा)</option><option value="out">⬆ निकासी / घटाना (adjust)</option></select></label>
      <label>किससे आया / नाम<input id="ei-party" placeholder="सप्लायर / पार्टी"></label>
      <label><span id="ei-bt">बोरा (संख्या)</span><input type="number" inputmode="decimal" id="ei-bags" placeholder="जैसे 500"></label>
      <label id="ei-gl">कुल वजन kg <small style="font-weight:500">(ख़ाली = बोरा × ${emE(String(c.bagKg))})</small><input type="number" inputmode="decimal" id="ei-gross"></label>
      <label id="ei-jl">सूती बोरा कटौती<select id="ei-jute"><option value="1">हाँ — ${emE(String(c.jute))} kg × बोरा घटाओ</option><option value="0">नहीं (plastic बोरा / खुला)</option></select></label>
      <label class="w">नोट<input id="ei-note" placeholder="गाड़ी नंबर / RST / कुछ भी"></label></div>
      <div class="cw-bar"><span class="cw-chip ord" id="ei-net" style="font-size:14px">शुद्ध वजन: 0 kg</span><button class="cw-go" id="ei-save">💾 Stock में जोड़ें</button></div>
      ${c.nb ? '<div class="cw-hint" style="margin-top:8px">ℹ️ Notebook के <b>माल आवत खाते</b> का गेहूँ (NETT / FILL वजन − 700g × बोरा) अपने आप stock में जुड़ता है — उसे यहाँ दोबारा न डालें.</div>' : ''}</div>
    <div class="cw-card"><h4>📒 Entry <small>${list.length}</small></h4>${list.length ? list.map(e => { const m = c.mats.find(x => x.k === e.mat) || { n: e.mat, unit: 'kg' };
      return `<div class="em-e ${e.cut ? 'cut' : ''} ${e.dir === 'out' ? 'out' : ''}"><small>${emE(e.date)} ${emE(e.ts || '')}</small><b>${emE(m.n)}</b><span>${emE(e.party || '')}${e.bags ? ' · ' + emE(String(e.bags)) + ' बोरा' : ''}${e.jute ? ' · सूती कटौती −' + emF(e.jute) + ' kg' : ''}${e.note ? ' · ' + emE(e.note) : ''}</span>
        <span class="q">${e.dir === 'out' ? '−' : '+'}${emF(e.net)} ${m.unit === 'kg' ? 'kg' : 'पीस'}</span><button data-cut="${emE(e.id)}">${e.cut ? '↩ वापस' : '✂ Cut'}</button></div>`; }).join('') : '<div class="tvempty">— कोई entry नहीं —</div>'}</div>`;
  const g = id => el.querySelector(id);
  const calc = () => { const m = c.mats.find(x => x.k === g('#ei-mat').value) || {}, kg = m.unit === 'kg', bags = emN(g('#ei-bags').value);
    g('#ei-gl').style.display = kg ? '' : 'none'; g('#ei-jl').style.display = kg ? '' : 'none'; g('#ei-bt').textContent = kg ? 'बोरा (संख्या)' : 'संख्या (पीस)';
    if (!kg) { g('#ei-net').textContent = `कुल: ${emF(bags)} पीस`; return { net: bags, bags: 0, gross: 0, jute: 0 }; }
    const gross = g('#ei-gross').value !== '' ? emN(g('#ei-gross').value) : bags * emN(c.bagKg), jute = g('#ei-jute').value === '1' ? bags * emN(c.jute) : 0, net = Math.max(0, gross - jute);
    g('#ei-net').textContent = `शुद्ध वजन: ${emF(gross)} − ${emF(jute)} = ${emF(net)} kg (${emF(net / emN(c.bagKg))} बोरा)`; return { net, bags, gross, jute }; };
  const jdef = () => { g('#ei-jute').value = g('#ei-mat').value === 'wheat' ? '1' : '0'; };
  ['#ei-mat', '#ei-bags', '#ei-gross', '#ei-jute'].forEach(i => g(i).addEventListener('input', calc)); g('#ei-mat').addEventListener('change', () => { jdef(); calc(); }); jdef(); calc();
  g('#ei-save').addEventListener('click', () => { const r = calc(); if (!(r.net > 0)) { toast('संख्या / वजन भरें'); return; }
    const a = emArr(EM_IN); a.push({ id: emId(), date: DATE, ts: nowTS(), mat: g('#ei-mat').value, dir: g('#ei-dir').value, party: g('#ei-party').value.trim(), bags: r.bags, gross: r.gross, jute: r.jute, net: Math.round(r.net * 100) / 100, note: g('#ei-note').value.trim() });
    emSet(EM_IN, a); toast('✔ Stock entry save'); emPane(); });
  el.querySelectorAll('[data-cut]').forEach(b => b.addEventListener('click', () => { const a = emArr(EM_IN), e = a.find(x => x.id === b.dataset.cut); if (e) { e.cut = !e.cut; emSet(EM_IN, a); emPane(); } }));
}

/* ---------- 🧺 बारदाना / खाली सूती बोरा वापसी हिसाब ---------- */
function emBora(el) {
  const list = emArr(EM_BORA), bal = {};
  list.forEach(e => { if (e.cut) return; const k = String(e.party || '').trim().toUpperCase(); if (!k) return; const b = bal[k] = bal[k] || { name: e.party, pt: e.ptype, n: 0 }; b.n += (e.dir === 'in' ? -1 : 1) * emN(e.qty); });
  const rows = Object.values(bal).filter(b => b.n !== 0).sort((a, b) => Math.abs(b.n) - Math.abs(a.n));
  let names = []; try { const D = tvBuild(); names = D.deb.concat(D.cred).map(x => x.name); } catch (e) {}
  el.innerHTML = `<div class="cw-card"><h4>🧺 खाली बोरा entry <small>700g वाला सूती / जूट बोरा</small></h4><div class="cw-form">
      <label>पार्टी<input id="eb-party" list="eb-dl" placeholder="Customer / Supplier का नाम"><datalist id="eb-dl">${names.map(n => `<option value="${emE(n)}">`).join('')}</datalist></label>
      <label>कौन<select id="eb-pt"><option value="cust">Customer</option><option value="sup">Supplier</option></select></label>
      <label>क्या हुआ<select id="eb-dir"><option value="out">हमारा बोरा उनके पास गया</option><option value="in">बोरा वापस आया / उनका बोरा हमारे पास आया</option></select></label>
      <label>कितने बोरे<input type="number" inputmode="numeric" id="eb-qty"></label><label class="w">नोट<input id="eb-note"></label></div>
      <div class="cw-bar"><button class="cw-go" id="eb-save">💾 Save</button></div></div>
    <div class="cw-card"><h4>📊 किसके पास कितने बोरे बकाया</h4>${rows.length ? rows.map(b => `<div class="em-e ${b.n < 0 ? 'out' : ''}"><b>${emE(b.name)}</b><small>${b.pt === 'sup' ? 'Supplier' : 'Customer'}</small>
        <span class="q">${b.n > 0 ? `उनके पास हमारे ${emF(b.n)} बोरे` : `हमारे पास उनके ${emF(-b.n)} बोरे (लौटाने हैं)`}</span></div>`).join('') : '<div class="tvempty">— कोई बकाया बोरा नहीं —</div>'}</div>
    <div class="cw-card"><h4>📒 Entry <small>${list.length}</small></h4>${list.slice().reverse().slice(0, 150).map(e => `<div class="em-e ${e.cut ? 'cut' : ''} ${e.dir === 'in' ? 'out' : ''}"><small>${emE(e.date)} ${emE(e.ts || '')}</small><b>${emE(e.party)}</b><span>${e.dir === 'in' ? 'वापस आया' : 'उनके पास गया'}${e.note ? ' · ' + emE(e.note) : ''}</span><span class="q">${emF(e.qty)} बोरा</span><button data-cut="${emE(e.id)}">${e.cut ? '↩' : '✂'}</button></div>`).join('') || '<div class="tvempty">—</div>'}</div>`;
  el.querySelector('#eb-save').addEventListener('click', () => { const p = el.querySelector('#eb-party').value.trim(), q = emN(el.querySelector('#eb-qty').value); if (!p || !(q > 0)) { toast('पार्टी और बोरे भरें'); return; }
    const a = emArr(EM_BORA); a.push({ id: emId(), date: DATE, ts: nowTS(), party: p, ptype: el.querySelector('#eb-pt').value, dir: el.querySelector('#eb-dir').value, qty: q, note: el.querySelector('#eb-note').value.trim() }); emSet(EM_BORA, a); toast('✔ Save'); emPane(); });
  el.querySelectorAll('[data-cut]').forEach(b => b.addEventListener('click', () => { const a = emArr(EM_BORA), e = a.find(x => x.id === b.dataset.cut); if (e) { e.cut = !e.cut; emSet(EM_BORA, a); emPane(); } }));
}

/* ---------- ⚙️ Settings ---------- */
function emSettings(el) {
  const c = emCfg(), iso = /^(\d{2})-(\d{2})-(\d{4})$/.exec(c.from || '');
  const matSel = v => c.mats.map(m => `<option value="${emE(m.k)}" ${m.k === v ? 'selected' : ''}>${emE(m.n)}</option>`).join('');
  el.innerHTML = `<div class="cw-card"><h4>🔔 Low-Stock Alert <small>limit छूते ही दोनों Owner को WhatsApp + AI कॉल</small></h4><div class="cw-form">
      <label>Owner नंबर 1<input type="tel" id="es-o1" value="${emE(c.owners[0] || '')}" placeholder="10 अंक"></label><label>Owner नंबर 2<input type="tel" id="es-o2" value="${emE(c.owners[1] || '')}" placeholder="10 अंक"></label>
      <label>stock कम ही रहे तो दोबारा alert (घंटे)<input type="number" id="es-rep" value="${emE(String(c.repeatH))}"></label>
      <label>WhatsApp Template नाम <small style="font-weight:500">(ख़ाली = सादा text; 24 घंटे window के बाहर template चाहिए)</small><input id="es-tpl" value="${emE(c.waTemplate || '')}" placeholder="जैसे stock_alert"></label></div></div>
    <div class="cw-card"><h4>📦 Stock की गिनती</h4><div class="cw-form">
      <label>Stock कब से गिनना है<input type="date" id="es-from" value="${iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : ''}"></label>
      <label>1 बोरा = कितने किलो<input type="number" id="es-bag" value="${emE(String(c.bagKg))}"></label>
      <label>सूती बोरे का वजन (kg)<input type="number" step="any" id="es-jute" value="${emE(String(c.jute))}"></label>
      <label>Notebook का गेहूँ आवत अपने आप जोड़ें<select id="es-nb"><option value="1" ${c.nb ? 'selected' : ''}>हाँ</option><option value="0" ${c.nb ? '' : 'selected'}>नहीं</option></select></label></div>
      <table class="em-tbl" style="margin-top:10px" id="es-mats"><tr><th>माल</th><th>इकाई</th><th>Alert limit (kg वाले में बोरा)</th></tr>${c.mats.map(m => `<tr data-k="${emE(m.k)}"><td><input class="mn" value="${emE(m.n)}"></td><td><select class="mu"><option value="kg" ${m.unit === 'kg' ? 'selected' : ''}>kg</option><option value="pcs" ${m.unit === 'pcs' ? 'selected' : ''}>पीस</option></select></td><td><input class="ml" type="number" value="${emE(String(m.limit || ''))}" placeholder="0 = alert नहीं"></td></tr>`).join('')}</table>
      <div class="cw-bar"><button class="cw-go grey sm" id="es-addm">➕ नया माल</button></div></div>
    <div class="cw-card"><h4>🧾 रसीद कटते ही कटौती <small>रसीद की 1 qty पर कौन सा माल कितने किलो घटे — अपने packing के हिसाब से ज़रूर जाँचें</small></h4>
      <table class="em-tbl" id="es-ded"><tr><th>रसीद का Item</th><th>कौन सा माल घटे</th><th>1 qty = kg</th></tr>${Object.keys(c.ded).map(k => `<tr><td><input class="dn" value="${emE(k)}"></td><td><select class="dm">${matSel(c.ded[k].m)}</select></td><td><input class="dk" type="number" step="any" value="${emE(String(c.ded[k].kg))}"></td></tr>`).join('')}</table>
      <div class="cw-bar"><button class="cw-go grey sm" id="es-addd">➕ Item जोड़ें</button><button class="cw-go" id="es-save">💾 Settings Save</button></div></div>`;
  el.querySelector('#es-addm').addEventListener('click', () => el.querySelector('#es-mats').insertAdjacentHTML('beforeend', `<tr data-k="m${Date.now().toString(36)}"><td><input class="mn" placeholder="नाम"></td><td><select class="mu"><option value="kg">kg</option><option value="pcs">पीस</option></select></td><td><input class="ml" type="number"></td></tr>`));
  el.querySelector('#es-addd').addEventListener('click', () => el.querySelector('#es-ded').insertAdjacentHTML('beforeend', `<tr><td><input class="dn" placeholder="रसीद वाला पूरा नाम"></td><td><select class="dm">${matSel('wheat')}</select></td><td><input class="dk" type="number" step="any"></td></tr>`));
  el.querySelector('#es-save').addEventListener('click', () => {
    const v = id => el.querySelector(id).value.trim(), f = v('#es-from').split('-'), n = {};
    n.owners = [v('#es-o1'), v('#es-o2')]; n.repeatH = emN(v('#es-rep')) || 24; n.waTemplate = v('#es-tpl'); n.waLang = c.waLang || 'hi';
    n.from = f.length === 3 ? `${f[2]}-${f[1]}-${f[0]}` : ''; n.bagKg = emN(v('#es-bag')) || 50; n.jute = emN(v('#es-jute')); n.nb = v('#es-nb') === '1';
    n.mats = [...el.querySelectorAll('#es-mats tr[data-k]')].map(r => ({ k: r.dataset.k, n: r.querySelector('.mn').value.trim(), unit: r.querySelector('.mu').value, limit: emN(r.querySelector('.ml').value) })).filter(m => m.n);
    n.ded = {}; el.querySelectorAll('#es-ded tr').forEach(r => { const a = r.querySelector('.dn'); if (!a) return; const nm = a.value.trim(), kg = emN(r.querySelector('.dk').value); if (nm && kg > 0) n.ded[nm] = { m: r.querySelector('.dm').value, kg }; });
    emSet(EM_CFG, n); toast('⚙️ Emergency settings save ✔'); emPane();
  });
}
