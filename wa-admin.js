/* =====================================================================
   SATYAM GOLD — WhatsApp Admin (app side)
   1) sg_wa_cust  — हर debtor (+ creditor, type:'cred') का summary (mobile → name, due, receipts) → bot इसे पढ़ता है
   2) Home → WhatsApp → Objection: customer के rate-objection देखें,
      customer का rate रखें / अपना नया rate भरें / deny करें → WhatsApp पर जवाब जाता है,
      rate बदला तो receipt + debtor में पुराना amount कट, नया amount (timestamp + WA) के साथ
   ===================================================================== */
'use strict';
const WA_OBJ='sg_wa_obj', WA_CUST='sg_wa_cust';
const waF=n=>'₹'+(Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const waN=v=>{ const n=parseFloat(v); return isNaN(n)?0:n; };

/* ---------- 1) customer summary publish (30 sec) ---------- */
function waPublishCust(){
  try{
    if(typeof tvBuild!=='function') return;
    const D=tvBuild(true); const out={}; const blocked=new Set();
    const publish=(mob,record)=>{
      if(blocked.has(mob)) return;
      if(out[mob] && out[mob].key!==record.key){ delete out[mob]; blocked.add(mob); return; }
      record.isCreditor=record.type==='cred'; // Debtor wins when the same party is in both ledgers.
      out[mob]=record;
    };
    /* Creditor (गेहूँ देने वाले) भी — bot इन्हें Wheat का Master rate दिखाता है (type:'cred') */
    (D.cred||[]).forEach(d=>{
      const mob=String((typeof tvMob==='function'?tvMob(d.key):'')||'').replace(/\D/g,'').slice(-10); if(mob.length!==10) return;
      publish(mob,{name:d.name, address:d.address||'', key:d.key, type:'cred', area:(typeof tvArea==='function'?tvArea(d.address):'OTHER'), due:waN(d.bal), receipts:d.due||[], paid:d.paid||[], t:Date.now()});
    });
    (D.deb||[]).forEach(d=>{
      const mob=String((typeof tvMob==='function'?tvMob(d.key):'')||'').replace(/\D/g,'').slice(-10); if(mob.length!==10) return;
      const receipts=(d.due||[]).filter(x=>x.src==='arcpt').sort((a,b)=>String(b.sdate).split('-').reverse().join('').localeCompare(String(a.sdate).split('-').reverse().join(''))).map(x=>{
        let items=[]; try{ items=(JSON.parse(localStorage.getItem('sg_arcpt_'+x.sdate)||'[]')[x.sidx]||{}).items||[]; }catch(e){}
        return {rno:x.rno, rdate:x.rdate||x.date, sdate:x.sdate, idx:x.sidx, total:x.amt, cut:!!x.cut,
          items:items.map(i=>({name:i.name,qty:waN(i.qty),rate:waN(i.rate),amount:waN(i.amount)}))}; });
      const paid=(d.paid||[]).filter(p=>!p.cut).slice().reverse().map(p=>({date:p.date,amt:p.amt,mode:p.mode||'Cash'}));
      publish(mob,{name:d.name, address:d.address||'', key:d.key, type:'deb', area:(typeof tvArea==='function'?tvArea(d.address):'OTHER'), due:waN(d.bal), receipts, paid, t:Date.now()});
    });
    const old=localStorage.getItem(WA_CUST)||''; const nw=JSON.stringify(out);
    /* सिर्फ़ बदलने पर लिखो (t हटा कर compare) */
    if(old.replace(/,"t":\d+/g,'')!==nw.replace(/,"t":\d+/g,'')) localStorage.setItem(WA_CUST,nw);
  }catch(e){}
}
setTimeout(waPublishCust,4000); setInterval(waPublishCust,30000);

/* ---------- 2) Objection list ---------- */
function waObjs(){ try{ return JSON.parse(localStorage.getItem(WA_OBJ)||'[]')||[]; }catch(e){ return []; } }
function waObjSave(a){ localStorage.setItem(WA_OBJ,JSON.stringify(a)); }
function waOpenCount(){ return waObjs().filter(o=>o.status==='open').length; }

// Owner key: एक बार भरने पर इसी device/browser में याद रहता है (localStorage '__wa_key').
// नाम 'sg_' से शुरू नहीं होता, इसलिए cloud/Postgres में sync नहीं होता. गलत निकले (401) तो अपने आप हट कर दोबारा पूछता है.
const WA_KEY_LS='__wa_key';
let waOwnerKey=''; try{ waOwnerKey=localStorage.getItem(WA_KEY_LS)||''; }catch(e){}
async function waAskKey(){
  if(waOwnerKey) return waOwnerKey;
  waOwnerKey=await new Promise(resolve=>popup({title:'Owner access key',
    body:'<label>WA_ADMIN_TOKEN <input id="wa-owner-key" type="password" autocomplete="off"></label><div class="pp-note" style="margin-top:8px">सिर्फ़ एक बार — इस device पर याद रहेगा.</div>',
    foot:'<button class="pp-btn cancel" id="wa-key-cancel">Cancel</button><button class="pp-btn save" id="wa-key-save">Continue</button>',
    onOpen(el){
      el.querySelector('#wa-key-save').onclick=()=>{const key=el.querySelector('#wa-owner-key').value.trim();closePopup();resolve(key);};
      el.querySelector('#wa-key-cancel').onclick=()=>{closePopup();resolve('');};
    }}));
  if(!waOwnerKey) throw new Error('Owner key required');
  return waOwnerKey;
}
async function waOwnerCall(path,body){
  const key=await waAskKey();
  const r=await fetch(path,{method:body?'POST':'GET',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
    ...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json().catch(()=>({ok:false,error:'Server से सही जवाब नहीं मिला (HTTP '+r.status+')'}));
  if(r.status===401){ waOwnerKey=''; try{localStorage.removeItem(WA_KEY_LS);}catch(e){} }
  else if(r.ok&&j.ok){ try{localStorage.setItem(WA_KEY_LS,key);}catch(e){} }   // सही निकला तभी याद रखो
  if(!r.ok||!j.ok) throw new Error(j.error||'Database request failed');
  return j;
}
const waAdminApi=body=>waOwnerCall('/api/wa-send',body);

async function waObjPopup(){
  let all;
  try { all=(await waAdminApi()).objects; } catch(e) { toast(e.message); return; }
  const open=all.filter(o=>o.status==='open');
  const done=all.filter(o=>o.status!=='open').reverse();
  const row=o=>`<div class="wa-ob ${o.status}" data-obj="${esc(o.id)}">
      <div class="wa-ob-h"><b>${esc(o.name)}</b> <small>${esc(o.address||'')} · 📱 ${esc(String(o.phone||'').slice(-10))}</small><span class="wa-ob-t">🕐 ${esc(o.ts)} · ${esc(o.date)}</span></div>
      <div class="wa-ob-b">🧾 R.No <b>${esc(o.rno)}</b> · ${esc(o.rdate)} — <b>${esc(o.item)}</b> ${esc(String(o.qty))} × <s>${waF(o.oldRate)}</s> → customer चाहता है <b class="g">${waF(o.newRate)}</b>
        ${o.status!=='open'?`<div class="wa-ob-r">${o.status==='deny'?'❌ Deny':'✅ नया rate '+waF(o.finalRate)} · ${esc(o.rts||'')}${o.reply?' · <i>'+esc(o.reply)+'</i>':''}</div>`:''}</div>
      ${o.status!=='open'?`<div>WhatsApp: ${esc(o.delivery==='accepted'?'Meta accepted (delivery की guarantee नहीं)':o.deliveryError||'Pending')} ${o.delivery!=='accepted'?'<button class="pp-btn save wa-retry">Retry WhatsApp</button>':''}</div>`:''}
      ${o.status==='open'?`<div class="wa-ob-f"><label>Rate ₹</label><input type="number" inputmode="decimal" class="wa-rate" value="${esc(String(o.newRate))}">
        <button class="pp-btn save wa-keep">✓ Customer का rate रखें</button>
        <button class="pp-btn save wa-set">✏️ मेरा rate लगाएँ</button>
        <button class="pp-btn cancel wa-deny">✖ Deny</button></div>`:''}
    </div>`;
  popup({ title:`📣 WhatsApp Rate Objection <small>(${open.length} open)</small>`,
    body:`<div class="pp-note">Customer ने WhatsApp से receipt के rate पर objection किया है। Box में rate वही रहने दें या अपना नया rate भरें → <b>मेरा rate लगाएँ</b>; या <b>Deny</b>। जवाब customer को WhatsApp पर चला जाएगा और receipt + Debtor में पुराना amount कट कर नया (timestamp + WA) लगेगा।</div>
      ${open.length? open.map(row).join('') : '<div class="ob-empty">कोई open objection नहीं 🎉</div>'}
      ${done.length? `<div class="wa-ob-done">पुराने</div>${done.map(row).join('')}`:''}`,
    foot:`<span></span><button class="pp-btn cancel" onclick="closePopup()">बंद</button>`,
    onOpen(bk){
      bk.addEventListener('click',async e=>{
        const b=e.target.closest('.wa-keep,.wa-set,.wa-deny,.wa-retry'); if(!b) return;
        const card=b.closest('.wa-ob'); const id=card.dataset.obj; const o=all.find(x=>x.id===id); if(!o) return;
        const action=b.classList.contains('wa-retry')?'retry':b.classList.contains('wa-deny')?'deny':b.classList.contains('wa-keep')?'accept':'set';
        const rate=Number(card.querySelector('.wa-rate')?.value);
        if(action==='set' && (!Number.isFinite(rate)||rate<=0)){toast('सही rate भरें');return;}
        if(window.sgSync?.status().pending){window.sgSync.push();toast('पहले pending app data sync होने दें, फिर दोबारा करें.');return;}
        if(action!=='retry' && !window.confirm(`R.No ${o.rno} | ${o.item}: ${action==='deny'?'Reject':waF(action==='accept'?o.newRate:rate)} — Confirm?`)) return;
        card.querySelectorAll('button').forEach(x=>x.disabled=true);
        try {
          const result=await waAdminApi({id,action,rate:action==='set'?rate:undefined});
          toast(result.sent?'Decision saved; WhatsApp Meta ने accept किया.':'Decision saved; WhatsApp pending: '+result.error);
          window.sgSync?.pull();
          closePopup(); await waObjPopup();
        } catch(e) { toast(e.message); card.querySelectorAll('button').forEach(x=>x.disabled=false); }

      });
    }
  });
}

/* ---------- Standalone Home tile, like Notebook / Order Book ---------- */
(function(){
  const css=document.createElement('style');
  css.textContent=`.wa-ob{border:1px solid #e0d6b5;border-radius:12px;padding:10px 12px;margin:8px 0;background:#fffdf5;font-size:14px}
  .wa-ob.ok{background:#f0fff4;border-color:#9ad9a8}.wa-ob.deny{background:#fff3f3;border-color:#e8a4a4;opacity:.85}
  .wa-ob-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.wa-ob-h small{color:#666}.wa-ob-t{margin-left:auto;font-size:12px;color:#777}
  .wa-ob-b{margin-top:6px;line-height:1.5}.wa-ob-b .g{color:#1e8449}.wa-ob-r{color:#444;font-size:13px;margin-top:4px}
  .wa-ob-f{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}.wa-ob-f input{width:110px;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:16px}
  .wa-ob-done{margin:14px 0 4px;font-weight:700;color:#888;border-top:1px dashed #ccc;padding-top:8px}
  .wa-ch{cursor:pointer}.wa-ch:hover{background:#fff6dc}
  .wa-ch-bar{display:flex;gap:6px;align-items:center;margin-bottom:8px}.wa-ch-bar input{flex:1;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:15px}
  .wa-ch-days{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.wa-ch-day{border:1px solid #d9cfa8;background:#fff;border-radius:14px;padding:3px 10px;font-size:12px;cursor:pointer}.wa-ch-day.on{background:#1e8449;color:#fff;border-color:#1e8449}
  .wa-chat{background:#efe7d8;border-radius:10px;padding:10px;max-height:52vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
  .wa-bub{max-width:82%;padding:6px 10px;border-radius:10px;font-size:14px;line-height:1.4;box-shadow:0 1px 1px rgba(0,0,0,.15);word-break:break-word}
  .wa-bub small{display:block;text-align:right;font-size:11px;color:#777;margin-top:2px}
  .wa-bub.in{align-self:flex-start;background:#fff}.wa-bub.out{align-self:flex-end;background:#d9fdd3}
    #wa-main-btn .n,#ob-wa-btn .n{background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;margin-left:4px;font-size:12px}`;
  document.head.appendChild(css);
  /* 💬 WhatsApp button → 📣 Objection · 🧾 Receipts (failed) · 💬 Chats */
  function waMainPopup(){
    const n=waOpenCount();
    popup({ title:'💬 WhatsApp', body:`<div style="display:flex;flex-direction:column;gap:10px;padding:6px 0">
      <button class="nb-tool grey" id="wa-pp-obj" style="font-size:16px">📣 Objection${n?` <span class="n" style="background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;font-size:12px">${n}</span>`:''}</button>
      <button class="nb-tool grey" id="wa-pp-rcpt" style="font-size:16px">🧾 Receipts <span class="n" id="wa-rc-n" hidden></span></button>
      <button class="nb-tool grey" id="wa-pp-chat" style="font-size:16px">💬 Chatting (Customers)</button></div>`,
      onOpen:(el)=>{
        el.querySelector('#wa-pp-obj').addEventListener('click',()=>{ closePopup(); waObjPopup(); });
        el.querySelector('#wa-pp-rcpt').addEventListener('click',()=>{ closePopup(); waRcptPopup(); });
        el.querySelector('#wa-pp-chat').addEventListener('click',()=>{ closePopup(); waChatPopup(); });
        waOwnerCall('/api/wa-owner?view=receipts').then(j=>{ const f=j.counts.failed+j.counts.stuck, b=el.querySelector('#wa-rc-n');
          if(b&&f){ b.hidden=false; b.textContent=f+' failed'; b.style.cssText='background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;font-size:12px'; } }).catch(()=>{});
      } });
  }
  window.waMainPopup=waMainPopup;
  const wire=()=>{
    /* Home tile + Order Book header — दोनों जगह 💬 WhatsApp → 📣 Objection */
    const bs=['wa-main-btn','ob-wa-btn'].map(id=>document.getElementById(id)).filter(Boolean); if(!bs.length) return;
    bs.forEach(b=>b.addEventListener('click',waMainPopup));
    const upd=()=>{
      const n=waOpenCount();
      bs.forEach(b=>{ const badge=b.querySelector('.n'); if(badge){ badge.textContent=String(n); badge.hidden=!n; }
        b.setAttribute('aria-label','WhatsApp — '+n+' open objections'); });
    };
    upd(); setInterval(upd,5000);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();

/* ---------- 🧾 Receipts — WhatsApp payment receipt (failed ऊपर, Retry) ---------- */
async function waRcptPopup(all){
  let j; try{ j=await waOwnerCall('/api/wa-owner?view=receipts'+(all?'&filter=all':'')); }catch(e){ toast(e.message); return; }
  const bad=j.receipts.filter(r=>r.status==='failed'||r.status==='pending'||r.status==='sending');
  const row=r=>{ const st=r.status==='sent'?`✅ ${r.delivery==='read'?'Read':r.delivery==='delivered'?'Delivered':'Sent'}`:r.status==='failed'?'❌ Failed':'⏳ Pending';
    return `<div class="wa-ob ${r.status==='sent'?'ok':r.status==='failed'?'deny':''}" data-rc="${esc(String(r.id))}">
      <div class="wa-ob-h"><b>${esc(r.name)}</b> <small>${esc(r.data?.address||'')}${r.phone?' · 📱 '+esc(String(r.phone).slice(-10)):''}</small><span class="wa-ob-t">🕐 ${esc(r.at)}</span></div>
      <div class="wa-ob-b">₹${esc(String(r.amount))} · ${esc(r.data?.mode||'')} · ${esc(r.source==='coll'?'Collection':'Notebook')} — <b>${st}</b>${r.tries>1?' · '+r.tries+' try':''}
        ${r.error?`<div class="wa-ob-r">⚠️ ${esc(r.error)}</div>`:''}</div>
      ${r.status!=='sent'?`<div class="wa-ob-f"><button class="pp-btn save wa-rc-retry">🔁 Retry भेजें</button></div>`:''}</div>`; };
  popup({ title:`🧾 WhatsApp Receipts <small>(${j.counts.failed} failed · ${j.counts.sent} sent)</small>`,
    body:`<div class="pp-note">Notebook / Collection में जमा होते ही customer को receipt WhatsApp पर अपने आप जाती है. जो नहीं गई वो नीचे <b>Failed</b> में दिखेगी — कारण पढ़ें (जैसे mobile नहीं भरा) और ठीक करके <b>Retry</b> दबाएँ. एक receipt सिर्फ़ एक ही बार जाती है.</div>
      <div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap"><button class="pp-btn cancel" id="wa-rc-all">${all?'सिर्फ़ Failed दिखाओ':'सारी receipts दिखाओ'}</button>${bad.length>1?'<button class="pp-btn save" id="wa-rc-retryall">🔁 सारी Failed Retry</button>':''}</div>
      ${j.receipts.length? j.receipts.map(row).join('') : '<div class="ob-empty">कोई failed receipt नहीं 🎉</div>'}`,
    foot:`<span></span><button class="pp-btn cancel" onclick="closePopup()">बंद</button>`,
    onOpen(bk){
      bk.querySelector('#wa-rc-all').onclick=()=>{ closePopup(); waRcptPopup(!all); };
      const run=async(btn,body)=>{ btn.disabled=true;
        try{ const r=await waOwnerCall('/api/wa-owner',body); toast(`भेजी: ${r.sent} · fail: ${r.failed}`); }catch(e){ toast(e.message); }
        closePopup(); waRcptPopup(all); };
      bk.querySelector('#wa-rc-retryall')?.addEventListener('click',e=>run(e.target,{action:'retry_all'}));
      bk.addEventListener('click',e=>{ const b=e.target.closest('.wa-rc-retry'); if(b) run(b,{action:'retry',id:b.closest('.wa-ob').dataset.rc}); });
    } });
}

/* ---------- 💬 Chatting — कौन customers ने chat की + पूरी history (date बदल कर) ---------- */
function waISO(dmy){ const p=String(dmy).split('-'); return p.length===3?p[2]+'-'+p[1]+'-'+p[0]:''; }
function waDMY(iso){ const p=String(iso).split('-'); return p.length===3?p[2]+'-'+p[1]+'-'+p[0]:''; }
async function waChatPopup(date){
  date=date||(typeof todayStr==='function'?todayStr():waDMY(new Date(Date.now()+19800000).toISOString().slice(0,10)));
  let j; try{ j=await waOwnerCall('/api/wa-owner?view=chats&date='+encodeURIComponent(date)); }catch(e){ toast(e.message); return; }
  popup({ title:`💬 Customer Chatting <small>(${j.total} customers)</small>`,
    body:`<div class="wa-ch-bar"><button class="pp-btn cancel" id="wa-ch-prev">◀</button><input type="date" id="wa-ch-date" value="${esc(waISO(date))}"><button class="pp-btn cancel" id="wa-ch-next">▶</button></div>
      ${j.days.length?`<div class="wa-ch-days">${j.days.slice(0,10).map(d=>`<button class="wa-ch-day${d.d===date?' on':''}" data-d="${esc(d.d)}">${esc(d.d)} <b>${d.n}</b></button>`).join('')}</div>`:''}
      ${j.chats.length? j.chats.map(c=>`<div class="wa-ob wa-ch" data-ph="${esc(c.phone)}"><div class="wa-ob-h"><b>${esc(c.name||'अज्ञात number')}</b> <small>${esc(c.address)} · 📱 ${esc(String(c.phone).slice(-10))}</small><span class="wa-ob-t">${c.msgs} msg · ${esc(c.last)}</span></div></div>`).join('')
        : '<div class="ob-empty">इस तारीख़ को कोई chat नहीं</div>'}`,
    foot:`<span></span><button class="pp-btn cancel" onclick="closePopup()">बंद</button>`,
    onOpen(bk){
      const go=d=>{ if(d){ closePopup(); waChatPopup(d); } };
      const shift=n=>{ const t=new Date(waISO(date)+'T00:00:00Z'); t.setUTCDate(t.getUTCDate()+n); return waDMY(t.toISOString().slice(0,10)); };
      bk.querySelector('#wa-ch-date').onchange=e=>go(waDMY(e.target.value));
      bk.querySelector('#wa-ch-prev').onclick=()=>go(shift(-1)); bk.querySelector('#wa-ch-next').onclick=()=>go(shift(1));
      bk.addEventListener('click',e=>{
        const d=e.target.closest('.wa-ch-day'); if(d) return go(d.dataset.d);
        const c=e.target.closest('.wa-ch'); if(c){ closePopup(); waChatView(c.dataset.ph,date); } });
    } });
}
async function waChatView(phone,date){
  let j; try{ j=await waOwnerCall('/api/wa-owner?view=chat&phone='+phone+'&date='+encodeURIComponent(date)); }catch(e){ toast(e.message); waChatPopup(date); return; }
  const bub=m=>`<div class="wa-bub ${m.dir==='in'?'in':'out'}"><div>${esc(m.text).replace(/\n/g,'<br>')}</div><small>${esc(m.t)}</small></div>`;
  popup({ title:`💬 ${esc(j.name||'अज्ञात')} <small>📱 ${esc(String(phone).slice(-10))} · ${esc(date)}</small>`,
    body:`<div class="wa-ch-bar"><button class="pp-btn cancel" id="wa-cv-prev">◀</button><input type="date" id="wa-cv-date" value="${esc(waISO(date))}"><button class="pp-btn cancel" id="wa-cv-next">▶</button></div>
      <div class="wa-chat">${j.messages.length? j.messages.map(bub).join('') : '<div class="ob-empty">इस तारीख़ को इस customer की chat नहीं</div>'}</div>`,
    foot:`<button class="pp-btn cancel" id="wa-cv-back">← Customers</button><button class="pp-btn cancel" onclick="closePopup()">बंद</button>`,
    onOpen(bk){
      const go=d=>{ if(d){ closePopup(); waChatView(phone,d); } };
      const shift=n=>{ const t=new Date(waISO(date)+'T00:00:00Z'); t.setUTCDate(t.getUTCDate()+n); return waDMY(t.toISOString().slice(0,10)); };
      bk.querySelector('#wa-cv-date').onchange=e=>go(waDMY(e.target.value));
      bk.querySelector('#wa-cv-prev').onclick=()=>go(shift(-1)); bk.querySelector('#wa-cv-next').onclick=()=>go(shift(1));
      bk.querySelector('#wa-cv-back').onclick=()=>{ closePopup(); waChatPopup(date); };
      const box=bk.querySelector('.wa-chat'); if(box) box.scrollTop=box.scrollHeight;
    } });
}

window.waObjPopup=waObjPopup; window.waPublishCust=waPublishCust; window.waRcptPopup=waRcptPopup; window.waChatPopup=waChatPopup;
