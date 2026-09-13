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
      record.isCreditor=record.type==='cred'||!!out[mob]?.isCreditor;
      out[mob]=record;
    };
    /* Creditor (गेहूँ देने वाले) भी — bot इन्हें Wheat का Master rate दिखाता है (type:'cred') */
    (D.cred||[]).forEach(d=>{
      const mob=String((typeof tvMob==='function'?tvMob(d.key):'')||'').replace(/\D/g,'').slice(-10); if(mob.length!==10) return;
      publish(mob,{name:d.name, address:d.address||'', key:d.key, type:'cred', area:(typeof tvArea==='function'?tvArea(d.address):'OTHER'), due:0, receipts:[], paid:[], t:Date.now()});
    });
    (D.deb||[]).forEach(d=>{
      const mob=String((typeof tvMob==='function'?tvMob(d.key):'')||'').replace(/\D/g,'').slice(-10); if(mob.length!==10) return;
      const receipts=(d.due||[]).filter(x=>x.src==='arcpt').sort((a,b)=>String(b.sdate).split('-').reverse().join('').localeCompare(String(a.sdate).split('-').reverse().join(''))).slice(0,10).map(x=>{
        let items=[]; try{ items=(JSON.parse(localStorage.getItem('sg_arcpt_'+x.sdate)||'[]')[x.sidx]||{}).items||[]; }catch(e){}
        return {rno:x.rno, rdate:x.rdate||x.date, sdate:x.sdate, idx:x.sidx, total:x.amt, cut:!!x.cut,
          items:items.map(i=>({name:i.name,qty:waN(i.qty),rate:waN(i.rate),amount:waN(i.amount)}))}; });
      const paid=(d.paid||[]).filter(p=>!p.cut).slice(-5).reverse().map(p=>({date:p.date,amt:p.amt,mode:p.mode||'Cash'}));
      publish(mob,{name:d.name, address:d.address||'', key:d.key, area:(typeof tvArea==='function'?tvArea(d.address):'OTHER'), due:Math.max(0,Math.round(d.bal||0)), receipts, paid, t:Date.now()});
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

// Owner key lives only in this tab's JS memory, never localStorage/cloud sync.
let waOwnerKey='';
async function waAdminApi(body){
  if(!waOwnerKey){
    waOwnerKey=await new Promise(resolve=>popup({title:'Owner access key',
      body:'<label>WA_ADMIN_TOKEN <input id="wa-owner-key" type="password" autocomplete="off"></label>',
      foot:'<button class="pp-btn cancel" id="wa-key-cancel">Cancel</button><button class="pp-btn save" id="wa-key-save">Continue</button>',
      onOpen(el){
        el.querySelector('#wa-key-save').onclick=()=>{const key=el.querySelector('#wa-owner-key').value.trim();closePopup();resolve(key);};
        el.querySelector('#wa-key-cancel').onclick=()=>{closePopup();resolve('');};
      }}));
    if(!waOwnerKey) throw new Error('Owner key required');
  }
  const r=await fetch('/api/wa-send',{method:body?'POST':'GET',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+waOwnerKey},
    ...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json();
  if(r.status===401) waOwnerKey='';
  if(!r.ok||!j.ok) throw new Error(j.error||'Database request failed');
  return j;
}

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
  #wa-main-btn .n,#ob-wa-btn .n{background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;margin-left:4px;font-size:12px}`;
  document.head.appendChild(css);
  /* 💬 WhatsApp button → popup में 📣 Objection (और आज के WA orders) */
  function waMainPopup(){
    const n=waOpenCount();
    let wa=0; try{ (JSON.parse(localStorage.getItem('sg_ord_'+todayStr()))||[]).forEach(o=>{ if(o.src==='wa'||o.wa||/\(WA\)/.test(o.tvEts||'')) wa++; }); }catch(e){}
    popup({ title:'💬 WhatsApp', body:`<div style="display:flex;flex-direction:column;gap:10px;padding:6px 0">
      <button class="nb-tool grey" id="wa-pp-obj" style="font-size:16px">📣 Objection${n?` <span class="n" style="background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;font-size:12px">${n}</span>`:''}</button>
      <div style="font-size:14px;color:#555">आज WhatsApp से आये order: <b>${wa}</b> (Order Book में दिखते हैं)</div>
      <div style="font-size:12px;color:#888">Customer confirm करता है → order सीधे Order Book (Postgres sg_ord_) में आता है.</div></div>`,
      onOpen:(el)=>{ el.querySelector('#wa-pp-obj').addEventListener('click',()=>{ closePopup(); waObjPopup(); }); } });
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
window.waObjPopup=waObjPopup; window.waPublishCust=waPublishCust;
