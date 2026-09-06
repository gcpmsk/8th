/* =====================================================================
   SATYAM GOLD — WhatsApp Admin (app side)
   1) sg_wa_cust  — हर debtor का summary (mobile → name, due, receipts) → bot इसे पढ़ता है
   2) Order Book में 📣 Objection button → customer के rate-objection देखें,
      customer का rate रखें / अपना नया rate भरें / deny करें → WhatsApp पर जवाब जाता है,
      rate बदला तो receipt + debtor में पुराना amount कट, नया amount (timestamp + WA) के साथ
   ===================================================================== */
'use strict';
const WA_OBJ='sg_wa_obj', WA_CUST='sg_wa_cust';
const waF=n=>'₹'+Math.round(Number(n)||0).toLocaleString('en-IN');
const waN=v=>{ const n=parseFloat(v); return isNaN(n)?0:n; };

/* ---------- 1) customer summary publish (30 sec) ---------- */
function waPublishCust(){
  try{
    if(typeof tvBuild!=='function') return;
    const D=tvBuild(true); const out={};
    (D.deb||[]).forEach(d=>{
      const mob=String((typeof tvMob==='function'?tvMob(d.key):'')||'').replace(/\D/g,'').slice(-10); if(mob.length!==10) return;
      const receipts=(d.due||[]).filter(x=>x.src==='arcpt').sort((a,b)=>String(b.sdate).split('-').reverse().join('').localeCompare(String(a.sdate).split('-').reverse().join(''))).slice(0,10).map(x=>{
        let items=[]; try{ items=(JSON.parse(localStorage.getItem('sg_arcpt_'+x.sdate)||'[]')[x.sidx]||{}).items||[]; }catch(e){}
        return {rno:x.rno, rdate:x.rdate||x.date, sdate:x.sdate, idx:x.sidx, total:x.amt, cut:!!x.cut,
          items:items.map(i=>({name:i.name,qty:waN(i.qty),rate:waN(i.rate),amount:waN(i.amount)}))}; });
      const paid=(d.paid||[]).filter(p=>!p.cut).slice(-5).reverse().map(p=>({date:p.date,amt:p.amt,mode:p.mode||'Cash'}));
      out[mob]={name:d.name, address:d.address||'', key:d.key, area:(typeof tvArea==='function'?tvArea(d.address):'OTHER'), due:Math.max(0,Math.round(d.bal||0)), receipts, paid, t:Date.now()};
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

async function waSendMsg(to,text){
  try{ const r=await fetch('/api/wa-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to,text})});
    const j=await r.json().catch(()=>({})); return !!j.ok; }catch(e){ return false; }
}

function waObjPopup(){
  const all=waObjs(); const open=all.filter(o=>o.status==='open'), done=all.filter(o=>o.status!=='open').slice(-15).reverse();
  const row=o=>`<div class="wa-ob ${o.status}" data-obj="${esc(o.id)}">
      <div class="wa-ob-h"><b>${esc(o.name)}</b> <small>${esc(o.address||'')} · 📱 ${esc(String(o.phone||'').slice(-10))}</small><span class="wa-ob-t">🕐 ${esc(o.ts)} · ${esc(o.date)}</span></div>
      <div class="wa-ob-b">🧾 R.No <b>${esc(o.rno)}</b> · ${esc(o.rdate)} — <b>${esc(o.item)}</b> ${esc(String(o.qty))} × <s>${waF(o.oldRate)}</s> → customer चाहता है <b class="g">${waF(o.newRate)}</b>
        ${o.status!=='open'?`<div class="wa-ob-r">${o.status==='deny'?'❌ Deny':'✅ नया rate '+waF(o.finalRate)} · ${esc(o.rts||'')}${o.reply?' · <i>'+esc(o.reply)+'</i>':''}</div>`:''}</div>
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
        const b=e.target.closest('.wa-keep,.wa-set,.wa-deny'); if(!b) return;
        const card=b.closest('.wa-ob'); const id=card.dataset.obj; const all=waObjs(); const o=all.find(x=>x.id===id); if(!o) return;
        const inp=card.querySelector('.wa-rate');
        let act = b.classList.contains('wa-deny')?'deny':'set';
        let rate = b.classList.contains('wa-keep')? waN(o.newRate) : waN(inp.value);
        if(act==='set' && !(rate>0)){ toast('सही rate भरें'); return; }
        if(act==='set' && Math.abs(rate-o.oldRate)<0.01) act='deny';
        b.disabled=true; b.textContent='⏳';
        let msg='';
        if(act==='deny'){
          o.status='deny'; o.finalRate=o.oldRate;
          msg=`🙏 ${o.name} जी,\nआपकी objection (R.No ${o.rno} · ${o.rdate} · ${o.item}) देखी गयी।\nRate ${waF(o.oldRate)} सही है — कोई बदलाव नहीं किया जा सका।\nधन्यवाद 🌾 SATYAM GOLD`;
        } else {
          const res=waApplyRate(o,rate);
          o.status='ok'; o.finalRate=rate; o.oldTotal=res.oldTotal; o.newTotal=res.newTotal;
          msg=`🙏 ${o.name} जी,\nआपकी objection मान ली गयी ✅\n🧾 R.No ${o.rno} · ${o.rdate}\n📦 ${o.item} ${o.qty} × ${waF(o.oldRate)} ➜ *${waF(rate)}*\nReceipt: ${waF(res.oldTotal)} ➜ *${waF(res.newTotal)}*\n💰 अब बाक़ी: *${waF(res.due)}*\n🕐 ${nowTS()} · ${todayStr()}\nधन्यवाद 🌾 SATYAM GOLD`;
        }
        o.rts=nowTS()+' · '+todayStr(); o.reply=(act==='deny'?'Deny':'Rate '+waF(rate));
        waObjSave(all);
        const sent=await waSendMsg(o.phone,msg);
        toast(sent?'✔ Customer को WhatsApp चला गया':'⚠️ Save हुआ, WhatsApp नहीं गया (WA_TOKEN check)');
        try{ if(typeof logChange==='function') logChange({sec:'Debtors',what:'WA Objection '+(act==='deny'?'Deny':'Rate बदला'),name:o.name,old:o.oldRate,neu:(act==='deny'?o.oldRate:rate),note:'R.No '+o.rno+' (WA)'}); }catch(e){}
        closePopup(); waObjPopup(); if(typeof renderOrderBook==='function') renderOrderBook();
      });
    }
  });
}

/* receipt में rate बदलो → item amount, total, debtor due (tvAmt) update; पुराना cut + stamp (WA) */
function waApplyRate(o,rate){
  const k='sg_arcpt_'+o.sdate; let list=[]; try{ list=JSON.parse(localStorage.getItem(k)||'[]')||[]; }catch(e){}
  let r=list[o.rcIdx]; if(!r||String(r.no)!==String(o.rno)) r=list.find(x=>String(x.no)===String(o.rno));
  if(!r) return {oldTotal:o.total,newTotal:o.total,due:0};
  const oldTotal=waN(r.total);
  (r.items||[]).forEach(it=>{ if(it.name===o.item && Math.abs(waN(it.rate)-o.oldRate)<0.01){ it.rateOld=it.rate; it.rate=String(rate); it.amount=(waN(it.qty)*rate).toFixed(2); it.waEdit=true; } });
  const newTotal=(r.items||[]).reduce((a,x)=>a+waN(x.amount),0);
  if(r.tvAmtOld===undefined||r.tvAmtOld===null) r.tvAmtOld=(r.tvAmt!==undefined&&r.tvAmt!==null)?waN(r.tvAmt):oldTotal;
  r.tvAmt=newTotal; r.total=newTotal.toFixed(2); r.tvEts=nowTS()+' (WA)'; if(o.sdate!==todayStr()) r.tvEdate=todayStr();
  r.waNote=`WA objection: ${o.item} ${waF(o.oldRate)} → ${waF(rate)} · ${r.tvEts} ${todayStr()}`;
  localStorage.setItem(k,JSON.stringify(list));
  let due=0; try{ const D=tvBuild(true); const d=(D.deb||[]).find(x=>x.key===o.custKey||x.name===o.name); due=Math.max(0,Math.round((d||{}).bal||0)); }catch(e){}
  waPublishCust();
  return {oldTotal,newTotal,due};
}

/* ---------- Order Book header में 📣 button ---------- */
(function(){
  const css=document.createElement('style');
  css.textContent=`.wa-ob{border:1px solid #e0d6b5;border-radius:12px;padding:10px 12px;margin:8px 0;background:#fffdf5;font-size:14px}
  .wa-ob.ok{background:#f0fff4;border-color:#9ad9a8}.wa-ob.deny{background:#fff3f3;border-color:#e8a4a4;opacity:.85}
  .wa-ob-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.wa-ob-h small{color:#666}.wa-ob-t{margin-left:auto;font-size:12px;color:#777}
  .wa-ob-b{margin-top:6px;line-height:1.5}.wa-ob-b .g{color:#1e8449}.wa-ob-r{color:#444;font-size:13px;margin-top:4px}
  .wa-ob-f{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}.wa-ob-f input{width:110px;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:16px}
  .wa-ob-done{margin:14px 0 4px;font-weight:700;color:#888;border-top:1px dashed #ccc;padding-top:8px}
  #wa-obj-btn .n{background:#e74c3c;color:#fff;border-radius:10px;padding:0 6px;margin-left:4px;font-size:12px}`;
  document.head.appendChild(css);
  const wire=()=>{
    const top=document.querySelector('#orderbook-screen .ob-top'); if(!top||document.getElementById('wa-obj-btn')) return;
    const b=document.createElement('button'); b.className='nb-tool grey'; b.id='wa-obj-btn'; b.innerHTML='📣 Objection';
    b.addEventListener('click',waObjPopup);
    top.insertBefore(b, top.querySelector('#ob-print-btn'));
    const upd=()=>{ const n=waOpenCount(); b.innerHTML='📣 Objection'+(n?`<span class="n">${n}</span>`:''); };
    upd(); setInterval(upd,5000);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
window.waObjPopup=waObjPopup; window.waPublishCust=waPublishCust;
