/* ================= SATYAM GOLD — ORDER BOOK =================
   • ऊपर: तारीख़ + Home + Print
   • TOTAL box  → सभी (back-date + आज) pending order का particular-wise Qty
   • Area-wise  → हर area का अपना total (Atta / Chokar / Sattu / Besan …)
   • नाम English में type, पर Hindi में भी दिखेगा
   • Back-date order = लाल, Serial No पहले, तारीख़ + समय stamp के साथ
   • हर order एक box → click = Atta Receipt में auto-fill
   • Rate न भरा हो तो पहले Order Book में rate माँगेगा
   • Complete होने पर "TODAY COMPLEAT" में Serial No के साथ
=============================================================== */
'use strict';

/* ---------- storage ---------- */
const ORD_KEY = d => 'sg_ord_' + d;
function ordLoad(d){ try{ return JSON.parse(localStorage.getItem(ORD_KEY(d)))||[]; }catch(e){ return []; } }
function ordSave(d,list){ try{ localStorage.setItem(ORD_KEY(d),JSON.stringify(list)); }catch(e){} }
function ordDates(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.indexOf('sg_ord_')===0) out.push(k.slice(7)); }
  return out.sort((a,b)=>ordDV(b).localeCompare(ordDV(a)));      // नया सबसे ऊपर
}
function ordDV(d){ const p=String(d).split('-'); return p.length===3? p[2]+p[1]+p[0] : d; }
/* सभी order (हर तारीख़) — {...order, date} */
function ordAll(){
  const out=[];
  ordDates().forEach(d=>ordLoad(d).forEach((o,i)=>out.push(Object.assign({},o,{date:d,idx:i}))));
  return out;
}
function ordPending(){ return ordAll().filter(o=>!o.done && !o.cancelled); }
function ordFind(date,id){ const l=ordLoad(date); const i=l.findIndex(x=>x.id===id); return i<0?null:{list:l,i,o:l[i]}; }

/* ---------- ITEMS ---------- */
const ORD_ITEMS = {
  'Atta'   : ['Atta Gold','Atta 47kg','Atta 50kg','Atta 18kg','Atta 10kg','Atta 5kg'],
  'Chokar' : ['Chokar (30kg)'],
  'Sattu'  : ['Sattu 200g','Sattu 500g'],
  'Besan'  : ['Besan 200g','Besan 500g'],
  'Jut Bora':['Jut Bora (Fresh)','Jut Bora (Normal)']
};
const ORD_ITEM_FLAT = Object.keys(ORD_ITEMS).reduce((a,k)=>a.concat(ORD_ITEMS[k]),[]);
function itemGroup(n){ n=String(n||'').toLowerCase();
  if(n.indexOf('atta')>=0) return 'Atta';
  if(n.indexOf('chokar')>=0) return 'Chokar';
  if(n.indexOf('sattu')>=0) return 'Sattu';
  if(n.indexOf('besan')>=0) return 'Besan';
  if(n.indexOf('bora')>=0) return 'Jut Bora';
  return 'Other'; }
/* image जैसा छोटा रूप — ATTA ग (Gold) */
function itemShort(n){
  const s=String(n||'').trim();
  if(/^atta\s*gold/i.test(s)) return 'ATTA ग';
  return s.toUpperCase().replace('(30KG)','30kg').replace(/\s+/g,' ');
}

/* ---------- AREA (पता से) ---------- */
const ORD_AREAS = [
  {code:'KKG', name:'KHAGARIA',        hi:'खगड़िया',        pat:/khagari|khagadi|kkg|खगड/i},
  {code:'MNS', name:'MANSHI',          hi:'मानसी',          pat:/mansh|mansi|मानसी/i},
  {code:'MSK', name:'MAHESHKHUNT',     hi:'महेशखूंट',        pat:/mahesh|msk|महेशख/i},
  {code:'GJP', name:'GOGRI JAMALPUR',  hi:'गोगरी जमालपुर',  pat:/(gogri|gogari|g)\s*[- ]?\s*jamalpur|gjp|जमालपुर/i},
  {code:'GG',  name:'GOGRI',           hi:'गोगरी',          pat:/gogri|gogari|गोगरी/i},
  {code:'KAM', name:'KARUAAMOR',       hi:'करुआमोड़',        pat:/karua|karu\s*a?mor|kam(?![a-z])|करुआ/i},
  {code:'CTM', name:'CHOTHAM',         hi:'चौथम',           pat:/chotham|chautham|चौथम/i},
  {code:'SNB', name:'SONBARSHA',       hi:'सोनबरसा',        pat:/sonbars|sonvars|सोनबर/i},
  {code:'SHR', name:'SAHARSA',         hi:'सहरसा',          pat:/sahars|saharsh|सहरसा/i},
  {code:'PBT', name:'PARBATTA',        hi:'परबत्ता',         pat:/parbatt|परबत/i},
  {code:'BLD', name:'BELDAUR',         hi:'बेलदौर',         pat:/beldaur|बेलदौर/i},
  {code:'ALI', name:'ALAULI',          hi:'अलौली',          pat:/alauli|अलौली/i},
  {code:'BKR', name:'BAKHRI',          hi:'बखरी',           pat:/bakhri|बखरी/i},
  {code:'BGS', name:'BEGUSARAI',       hi:'बेगूसराय',        pat:/begusarai|बेगूसराय/i},
  {code:'JMP', name:'JAMALPUR',        hi:'जमालपुर',        pat:/jamalpur|jmp/i}
];
function areaOf(addr){
  const s=String(addr||'').trim();
  for(const a of ORD_AREAS) if(a.pat.test(s)) return a;
  return {code:(s? s.slice(0,3).toUpperCase():'—'), name:(s||'OTHER'), hi:'', pat:null, other:true};
}

/* ---------- English → Hindi (offline transliteration + नाम dictionary) ---------- */
const ORD_DICT = {jee:'जी',ji:'जी',raju:'राजू',ram:'राम',amit:'अमित',shyam:'श्याम',mohan:'मोहन',sohan:'सोहन',
  singh:'सिंह',kumar:'कुमार',lal:'लाल',devi:'देवी',yadav:'यादव',sah:'साह',sahu:'साहू',gupta:'गुप्ता',
  mandal:'मंडल',paswan:'पासवान',thakur:'ठाकुर',sharma:'शर्मा',rai:'राय',mishra:'मिश्रा',prasad:'प्रसाद',
  kirana:'किराना',store:'स्टोर',bhai:'भाई',babu:'बाबू',sir:'सर',dukan:'दुकान'};
function ordToHi(txt){
  return String(txt||'').split(/(\s+|[^A-Za-z\u0900-\u097F]+)/).map(w=>{
    if(!/^[A-Za-z]+$/.test(w)) return w;
    const lw=w.toLowerCase();
    if(ORD_DICT[lw]) return ORD_DICT[lw];
    return translit(lw);
  }).join('');
}
function translit(w){
  const V={aa:['आ','ा'],ai:['ऐ','ै'],au:['औ','ौ'],ee:['ई','ी'],ii:['ई','ी'],oo:['ऊ','ू'],uu:['ऊ','ू'],
           a:['अ',''],i:['इ','ि'],u:['उ','ु'],e:['ए','े'],o:['ओ','ो']};
  const C={chh:'छ',kh:'ख',gh:'घ',ch:'च',jh:'झ',ph:'फ',bh:'भ',sh:'श',th:'थ',dh:'ध',
           k:'क',g:'ग',c:'क',j:'ज',t:'त',d:'द',n:'न',p:'प',b:'ब',m:'म',y:'य',r:'र',l:'ल',
           v:'व',w:'व',s:'स',h:'ह',f:'फ',z:'ज़',q:'क',x:'क्स'};
  let i=0,out='',lastCons=false;
  const grab=(map)=>{ for(const len of [3,2,1]){ const seg=w.substr(i,len); if(map[seg]) return {seg,len,val:map[seg]}; } return null; };
  while(i<w.length){
    const c=grab(C);
    if(c){ out+=c.val; i+=c.len; lastCons=true;
      const v=grab(V);
      if(v){ out+=v.val[1]; i+=v.len; lastCons=false; }
      else if(i>=w.length){ /* अंत का halant नहीं — सादा */ }
      continue; }
    const v=grab(V);
    if(v){ out+= lastCons? v.val[1] : v.val[0]; i+=v.len; lastCons=false; continue; }
    i++;
  }
  return out||w;
}
/* online होने पर बेहतर नाम — मिल जाये तो box में भर दे */
function ordTryGoogle(txt,cb){
  if(!txt) return;
  fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=${encodeURIComponent(txt)}`)
    .then(r=>r.json()).then(d=>{ const t=d&&d[0]&&d[0][0]&&d[0][0][0]; if(t) cb(t); }).catch(()=>{});
}

/* ---------- qty helpers ---------- */
const oq = v => { const n=parseFloat(v); return isFinite(n)? n:0; };
const oqs = v => { const n=oq(v); return (Math.round(n*100)/100).toString(); };
function hasRate(it){ return oq(it.rate)>0; }
function ordNeedRate(o){ return (o.items||[]).some(it=>!hasRate(it)); }

/* ---------- aggregate ---------- */
function aggItems(list){
  const m={};
  list.forEach(o=>(o.items||[]).forEach(it=>{ const k=it.name||'—'; m[k]=(m[k]||0)+oq(it.qty); }));
  return Object.keys(m).sort((a,b)=>ORD_ITEM_FLAT.indexOf(a)-ORD_ITEM_FLAT.indexOf(b)).map(k=>({name:k,qty:m[k]}));
}
function aggArea(list){
  const m={};
  list.forEach(o=>{
    const a=areaOf(o.address); const key=a.code+'|'+a.name;
    if(!m[key]) m[key]={area:a,orders:0,items:{}};
    m[key].orders++;
    (o.items||[]).forEach(it=>{ const k=it.name||'—'; m[key].items[k]=(m[key].items[k]||0)+oq(it.qty); });
  });
  return Object.keys(m).sort().map(k=>m[k]);
}

/* =========================================================
   RENDER
========================================================= */
function renderOrderBook(){
  const wrap=document.getElementById('ob-body'); if(!wrap) return;
  const dEl=document.getElementById('ob-date'); if(dEl) dEl.textContent=DATE;
  const pend=ordPending();
  const back=pend.filter(o=>o.date!==DATE);
  const today=pend.filter(o=>o.date===DATE);
  const done=ordAll().filter(o=>o.done);

  /* --- TOTAL box --- */
  const tot=aggItems(pend);
  const totHTML = tot.length
    ? tot.map(t=>`<div class="ob-tot-line"><span class="ob-tot-n">${esc(itemShort(t.name))}</span><span class="ob-tot-d">-</span><span class="ob-tot-q">${oqs(t.qty)}</span></div>`).join('')
    : `<div class="ob-empty">कोई pending order नहीं</div>`;

  /* --- Area boxes --- */
  const areas=aggArea(pend);
  const areaHTML = areas.length? areas.map((g,i)=>{
    const its=Object.keys(g.items).sort((a,b)=>ORD_ITEM_FLAT.indexOf(a)-ORD_ITEM_FLAT.indexOf(b));
    return `<div class="ob-area" style="--ac:${['#c0392b','#1f4ed8','#1e8449','#8e44ad','#d35400','#00838f'][i%6]}">
      <div class="ob-area-h">${esc(g.area.name)}${g.area.hi?` <small>(${esc(g.area.hi)})</small>`:''} <b>${g.area.code}</b></div>
      ${its.map(k=>`<div class="ob-area-l">${esc(itemShort(k))} <span>${oqs(g.items[k])}</span></div>`).join('')}
      <div class="ob-area-f">${g.orders} order</div></div>`;
  }).join('') : `<div class="ob-empty">—</div>`;

  wrap.innerHTML=`
    <div class="ob-total-wrap">
      <div class="ob-total-title">TOTAL</div>
      <div class="ob-total-stem"></div>
      <div class="ob-total-box">${totHTML}</div>
    </div>
    <div class="ob-area-row">${areaHTML}</div>
    <div class="ob-cols">
      <div class="ob-col">
        <div class="ob-col-h red">📋 ORDER — बाक़ी (${pend.length})</div>
        ${back.length?`<div class="ob-sub back">⏮ पिछली तारीख़ के order (${back.length})</div>`+back.map(o=>orderBoxHTML(o,true)).join(''):''}
        ${today.length?`<div class="ob-sub">📅 आज के order (${today.length})</div>`+today.map(o=>orderBoxHTML(o,false)).join(''):''}
        ${pend.length?'':`<div class="ob-empty">अभी कोई order नहीं — नीचे ➕ से जोड़ें</div>`}
        <div class="ob-add" id="ob-add-btn">➕ नया Order जोड़ें</div>
      </div>
      <div class="ob-col right">
        <div class="ob-col-h green">TODAY COMPLEAT (${done.filter(o=>o.doneDate===DATE).length})</div>
        ${done.length? done.map(o=>doneBoxHTML(o)).join('') : `<div class="ob-empty">अभी कुछ complete नहीं</div>`}
      </div>
    </div>`;
  const ab=document.getElementById('ob-add-btn'); if(ab) ab.addEventListener('click',()=>orderForm(null));
}

function itemLineHTML(it){
  const r=hasRate(it)? `<span class="ob-rate">${oqs(it.rate)}</span>` : `<span class="ob-norate">rate ?</span>`;
  return `<div class="ob-item">${esc(itemShort(it.name))} <b>${oqs(it.qty)}</b><span class="ob-x">✕</span>${r}${it.note?` <small class="ob-note">${esc(it.note)}</small>`:''}</div>`;
}
function orderBoxHTML(o,isBack){
  const a=areaOf(o.address);
  return `<div class="ob-box${isBack?' back':''}" data-od="${esc(o.date)}" data-oi="${esc(o.id)}">
    <div class="ob-box-top">
      <span class="ob-sl">${esc(String(o.no))}</span>
      <span class="ob-nm">${esc((o.name||'').toUpperCase())}${o.nameHi?`<i>(${esc(o.nameHi)})</i>`:''}</span>
      <span class="ob-ac">${esc(a.code)}</span>
      ${isBack?`<span class="ob-stamp">🕐 ${esc(o.ts||'')} · ${esc(o.date)}</span>`:`<span class="ob-stamp t">🕐 ${esc(o.ts||'')}</span>`}
    </div>
    <div class="ob-items">${(o.items||[]).map(itemLineHTML).join('')}</div>
    <div class="ob-box-foot">${ordNeedRate(o)?'⚠️ Rate बाक़ी — click कर के भरें':'👉 click = Atta Receipt auto-fill'}</div>
  </div>`;
}
function doneBoxHTML(o){
  return `<div class="ob-box done" data-od="${esc(o.date)}" data-oi="${esc(o.id)}">
    <div class="ob-box-top"><span class="ob-sl green">${esc(String(o.no))}</span>
      <span class="ob-nm">${esc((o.name||'').toUpperCase())}${o.nameHi?`<i>(${esc(o.nameHi)})</i>`:''}</span>
      <span class="ob-ac">${esc(areaOf(o.address).code)}</span>
      <span class="ob-stamp ok">✅ ${esc(o.doneTs||'')}${o.doneDate&&o.doneDate!==o.date?' · '+esc(o.doneDate):''}</span></div>
    <div class="ob-items">${(o.items||[]).map(itemLineHTML).join('')}</div>
    ${o.date!==DATE?`<div class="ob-box-foot">order तारीख़: ${esc(o.date)}</div>`:''}
  </div>`;
}

/* =========================================================
   ADD / EDIT FORM
========================================================= */
function itemRowHTML(i,it){
  it=it||{};
  return `<div class="ob-frow" data-ri="${i}">
    <select class="of-item">${['',...ORD_ITEM_FLAT].map(n=>`<option value="${esc(n)}"${n===(it.name||'')?' selected':''}>${n?esc(n):'— item चुनें —'}</option>`).join('')}</select>
    <input type="number" step="any" class="of-qty" placeholder="Qty" value="${esc(it.qty??'')}">
    <input type="number" step="any" class="of-rate" placeholder="Rate (बाद में भी)" value="${esc(it.rate??'')}">
    <input type="text" class="of-note" placeholder="note (जैसे 5 बोरा)" value="${esc(it.note||'')}">
    <button type="button" class="of-del">✕</button></div>`;
}
function orderForm(existing){
  const o=existing||{items:[{}]};
  popup({
    title: existing? '✏️ Order बदलें' : '➕ नया Order',
    body:`<div class="pp-note">नाम <b>English</b> में लिखें — Hindi अपने आप बनेगा (चाहें तो सुधार लें). Rate अभी न भी भरें तो चलेगा.</div>
      <div class="f-row"><input type="text" id="of-name" placeholder="Name (English)" value="${esc(o.name||'')}"></div>
      <div class="f-row"><input type="text" id="of-name-hi" class="hi" placeholder="हिंदी नाम" value="${esc(o.nameHi||'')}"></div>
      <div class="f-row"><input type="text" id="of-addr" placeholder="Address / Area (English)" value="${esc(o.address||'')}"></div>
      <div class="chips" id="of-area-chips">${ORD_AREAS.map(a=>`<div class="chip sm" data-a="${esc(a.name)}">${esc(a.name)}<small>${a.code}</small></div>`).join('')}</div>
      <div class="f-row"><input type="text" id="of-phone" placeholder="Mobile (optional)" value="${esc(o.phone||'')}"></div>
      <div id="of-items">${(o.items&&o.items.length?o.items:[{}]).map((it,i)=>itemRowHTML(i,it)).join('')}</div>
      <div class="add-strip" id="of-add-item">➕ और item जोड़ें</div>`,
    foot:`<span></span><div style="display:flex;gap:8px;">
      ${existing?'<button class="pp-btn cancel" id="of-del-order">🗑️ हटाएँ</button>':''}
      <button class="pp-btn cancel" onclick="closePopup()">रद्द</button>
      <button class="pp-btn save" id="of-save">✔ Save</button></div>`,
    onOpen(bk){
      const nm=bk.querySelector('#of-name'), hi=bk.querySelector('#of-name-hi');
      let tmr=null, touched=!!(o.nameHi);
      hi.addEventListener('input',()=>touched=true);
      nm.addEventListener('input',()=>{
        if(touched && hi.value && existing) return;
        hi.value=ordToHi(nm.value);
        clearTimeout(tmr); const v=nm.value;
        tmr=setTimeout(()=>ordTryGoogle(v,t=>{ if(nm.value===v && !touched) hi.value=t; }),700);
      });
      bk.querySelector('#of-area-chips').addEventListener('click',e=>{
        const c=e.target.closest('.chip'); if(!c) return;
        bk.querySelector('#of-addr').value=c.dataset.a;
      });
      bk.querySelector('#of-add-item').addEventListener('click',()=>{
        const box=bk.querySelector('#of-items');
        box.insertAdjacentHTML('beforeend',itemRowHTML(box.children.length,{}));
      });
      bk.querySelector('#of-items').addEventListener('click',e=>{
        if(e.target.classList.contains('of-del')){
          const box=bk.querySelector('#of-items');
          if(box.children.length>1) e.target.closest('.ob-frow').remove(); else toast('कम से कम 1 item ज़रूरी');
        }
      });
      const delBtn=bk.querySelector('#of-del-order');
      if(delBtn) delBtn.addEventListener('click',()=>{
        const f=ordFind(existing.date,existing.id); if(!f) return;
        f.list.splice(f.i,1); ordSave(existing.date,f.list); closePopup(); renderOrderBook(); toast('Order हटा दिया');
      });
      bk.querySelector('#of-save').addEventListener('click',()=>{
        const name=nm.value.trim();
        if(!name) return toast('नाम ज़रूरी है');
        const items=[];
        bk.querySelectorAll('#of-items .ob-frow').forEach(r=>{
          const n=r.querySelector('.of-item').value, q=r.querySelector('.of-qty').value;
          if(!n || !oq(q)) return;
          items.push({name:n, qty:oq(q), rate:r.querySelector('.of-rate').value.trim(), note:r.querySelector('.of-note').value.trim()});
        });
        if(!items.length) return toast('कम से कम 1 item + Qty भरें');
        const data={name, nameHi:hi.value.trim(), address:bk.querySelector('#of-addr').value.trim(),
                    phone:bk.querySelector('#of-phone').value.trim(), items};
        if(existing){
          const f=ordFind(existing.date,existing.id); if(!f) return;
          Object.assign(f.o,data); f.o.ets=nowTS(); f.o.edited=true;
          ordSave(existing.date,f.list);
        }else{
          const list=ordLoad(DATE);
          list.push(Object.assign(data,{id:'o'+Date.now()+Math.floor(Math.random()*99),
            no:String(list.length+1).padStart(2,'0'), ts:nowTS(), done:false}));
          ordSave(DATE,list);
        }
        closePopup(); renderOrderBook(); toast('Order save ✔');
      });
    }
  });
}

/* =========================================================
   BOX CLICK  →  rate माँगो / Atta Receipt auto-fill
========================================================= */
function ordBoxAction(date,id){
  const f=ordFind(date,id); if(!f) return;
  const o=Object.assign({},f.o,{date});
  popup({
    title:`🧾 Order #${esc(String(o.no))} — ${esc((o.name||'').toUpperCase())}`,
    body:`<div class="pp-note">${esc(areaOf(o.address).name)} · ${esc(o.date)} ${esc(o.ts||'')}${o.done?' · ✅ COMPLEAT':''}</div>
      ${(o.items||[]).map(it=>`<div class="ob-item big">${esc(itemShort(it.name))} <b>${oqs(it.qty)}</b> ✕ ${hasRate(it)?oqs(it.rate):'<span class="ob-norate">rate नहीं</span>'}${it.note?` <small>(${esc(it.note)})</small>`:''}</div>`).join('')}`,
    foot:`<span></span><div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="pp-btn cancel" onclick="closePopup()">बंद</button>
      <button class="pp-btn" style="background:#f39c12;color:#fff;" id="ob-edit">✏️ Edit</button>
      ${o.done?`<button class="pp-btn" style="background:#636e72;color:#fff;" id="ob-undone">↩ फिर बाक़ी करें</button>`
             :`<button class="pp-btn save" id="ob-fill">${ordNeedRate(o)?'💰 पहले Rate भरें':'🧾 Atta Receipt खोलें →'}</button>`}
      </div>`,
    onOpen(bk){
      bk.querySelector('#ob-edit').addEventListener('click',()=>{ closePopup(); orderForm(o); });
      const u=bk.querySelector('#ob-undone');
      if(u) u.addEventListener('click',()=>{ const g=ordFind(date,id); g.o.done=false; g.o.doneTs=''; g.o.doneDate='';
        ordSave(date,g.list); closePopup(); renderOrderBook(); toast('फिर pending में आ गया'); });
      const fl=bk.querySelector('#ob-fill');
      if(fl) fl.addEventListener('click',()=>{ if(ordNeedRate(o)) rateForm(date,id); else ordToReceipt(date,id); });
    }
  });
}
/* rate भरने का form — Atta Receipt में कुछ भरने से पहले यही खुलेगा */
function rateForm(date,id){
  const f=ordFind(date,id); if(!f) return;
  const o=f.o;
  popup({
    title:'💰 Rate भरें — Order Book',
    body:`<div class="pp-note">इस order में rate नहीं लिखा था. यहाँ rate भरने के बाद ही Atta Receipt अपने आप भरेगा.</div>
      ${(o.items||[]).map((it,i)=>`<div class="f-row"><div class="ro">${esc(itemShort(it.name))} — Qty ${oqs(it.qty)}</div>
        <input type="number" step="any" class="ob-rt" data-i="${i}" placeholder="Rate ₹" value="${esc(it.rate||'')}"></div>`).join('')}`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">रद्द</button>
      <button class="pp-btn save" id="ob-rsave">✔ Save & Receipt →</button></div>`,
    onOpen(bk){
      bk.querySelector('#ob-rsave').addEventListener('click',()=>{
        const g=ordFind(date,id);
        let ok=true;
        bk.querySelectorAll('.ob-rt').forEach(inp=>{ const i=+inp.dataset.i;
          if(!oq(inp.value)) ok=false; else g.o.items[i].rate=inp.value.trim(); });
        if(!ok) return toast('सभी item का rate भरें');
        g.o.ets=nowTS(); ordSave(date,g.list);
        closePopup(); renderOrderBook(); ordToReceipt(date,id);
      });
    }
  });
}
/* order → Atta Receipt (prefill) */
function ordToReceipt(date,id){
  const f=ordFind(date,id); if(!f) return;
  try{ localStorage.setItem('sg_ord_prefill',JSON.stringify({
    ordDate:date, ordId:id, no:f.o.no,
    name:f.o.name||'', nameHi:f.o.nameHi||'', address:f.o.address||'', addressHi:ordToHi(f.o.address||''),
    items:(f.o.items||[]).map(it=>({name:it.name,qty:it.qty,rate:it.rate}))
  })); }catch(e){}
  location.href='atta-receipt.html?ord=1';
}
document.addEventListener('click',e=>{
  const b=e.target.closest('#ob-body .ob-box');
  if(b) ordBoxAction(b.dataset.od,b.dataset.oi);
});

/* =========================================================
   PRINT
========================================================= */
function orderBookPrintHTML(forDate,inclCarry){
  const d=forDate||DATE;
  const all=ordAll();
  const day=all.filter(o=>o.date===d);
  const carry= inclCarry===false? [] : all.filter(o=>!o.done && ordDV(o.date)<ordDV(d));
  const pend=day.filter(o=>!o.done).concat(carry);
  const done=day.filter(o=>o.done);
  const tot=aggItems(pend), areas=aggArea(pend);
  const row=o=>`<tr${o.date!==d?' style="color:#c0392b;"':''}>
    <td style="text-align:center;font-weight:800;">${esc(String(o.no))}</td>
    <td>${esc((o.name||'').toUpperCase())}${o.nameHi?` (${esc(o.nameHi)})`:''}</td>
    <td style="text-align:center;">${esc(areaOf(o.address).code)}</td>
    <td>${(o.items||[]).map(it=>`${esc(itemShort(it.name))} ${oqs(it.qty)}${hasRate(it)?'×'+oqs(it.rate):'×?'}`).join(' , ')}</td>
    <td style="text-align:center;font-size:10px;">${esc(o.ts||'')}${o.date!==d?'<br>'+esc(o.date):''}</td></tr>`;
  return `<div style="background:#fff;color:#000;padding:10px 12px;font-family:'Poppins','Noto Sans Devanagari',sans-serif;">
    <div style="text-align:center;font-weight:900;font-size:19px;">SATYAM FOOD PRODUCT</div>
    <div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:6px;">ORDER BOOK — ${esc(d)}</div>
    <div style="border:2px solid #000;padding:6px 10px;margin-bottom:8px;">
      <div style="text-align:center;font-weight:900;text-decoration:underline;margin-bottom:4px;">TOTAL</div>
      ${tot.length? tot.map(t=>`<div style="display:inline-block;min-width:33%;font-weight:700;font-size:12.5px;">${esc(itemShort(t.name))} - ${oqs(t.qty)}</div>`).join(''):'<i>—</i>'}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
      ${areas.map(g=>`<div style="border:1.5px solid #c0392b;padding:3px 7px;font-size:11px;font-weight:700;">
        ${esc(g.area.name)} (${esc(g.area.code)})<br>${Object.keys(g.items).map(k=>esc(itemShort(k))+' '+oqs(g.items[k])).join(' · ')}</div>`).join('')||'<i>—</i>'}
    </div>
    <div style="font-weight:900;font-size:13px;background:#243447;color:#fff;padding:3px 8px;">ORDER — बाक़ी (${pend.length})</div>
    <table border="1" style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:8px;">
      <thead style="background:#eef2f7;"><tr><th style="width:7%">Sr</th><th style="width:28%">Name</th><th style="width:8%">Area</th><th>Particulars (Qty × Rate)</th><th style="width:13%">Time</th></tr></thead>
      <tbody>${pend.map(row).join('')||'<tr><td colspan="5" style="text-align:center;">— कोई order नहीं —</td></tr>'}</tbody></table>
    <div style="font-weight:900;font-size:13px;background:#1e8449;color:#fff;padding:3px 8px;">TODAY COMPLEAT (${done.length})</div>
    <table border="1" style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead style="background:#eaf7ef;"><tr><th style="width:7%">Sr</th><th style="width:28%">Name</th><th style="width:8%">Area</th><th>Particulars</th><th style="width:13%">Done</th></tr></thead>
      <tbody>${done.map(o=>`<tr><td style="text-align:center;font-weight:800;">${esc(String(o.no))}</td><td>${esc((o.name||'').toUpperCase())}${o.nameHi?` (${esc(o.nameHi)})`:''}</td><td style="text-align:center;">${esc(areaOf(o.address).code)}</td><td>${(o.items||[]).map(it=>`${esc(itemShort(it.name))} ${oqs(it.qty)}×${oqs(it.rate)}`).join(' , ')}</td><td style="text-align:center;font-size:10px;">${esc(o.doneTs||'')}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;">— —</td></tr>'}</tbody></table>
  </div>`;
}

/* =========================================================
   HOOKS
========================================================= */
(function(){
  const _go=go;
  go=function(n){ _go(n); if(n==='orderbook') renderOrderBook(); };
  document.addEventListener('DOMContentLoaded',()=>{
    const pb=document.getElementById('ob-print-btn');
    if(pb) pb.addEventListener('click',()=>printDocument(orderBookPrintHTML(DATE,true),{landscape:false,stretch:true,grow:true}));
    if((location.hash||'')==='#orderbook'){ /* receipt से वापस */ }
  });
})();
window.renderOrderBook=renderOrderBook;
window.orderBookPrintHTML=orderBookPrintHTML;
