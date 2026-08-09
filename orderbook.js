/* ================= SATYAM GOLD — ORDER BOOK v2 =================
   • साफ़-सुथरा interface — TOTAL card, Area cards, Order cards
   • Particulars = Atta Receipt जैसा dropdown (Category → Variety)
   • नाम / पता English में, Hindi अपने आप
   • Rate बाद में भी — click पर पहले Rate माँगेगा
   • Partial delivery — 20 का order, 15 दिया → COMPLEAT में 15, बाक़ी 5 "बचा हुआ"
   • TODAY COMPLEAT = सिर्फ़ आज की delivery (Receipt में जोड़ा extra item भी)
   • 📊 Tally View — item / area / customer wise पूरा हिसाब
================================================================ */
'use strict';

/* ---------- storage ---------- */
const ORD_KEY = d => 'sg_ord_' + d;
function ordLoad(d){ try{ return JSON.parse(localStorage.getItem(ORD_KEY(d)))||[]; }catch(e){ return []; } }
function ordSave(d,list){ try{ localStorage.setItem(ORD_KEY(d),JSON.stringify(list)); }catch(e){} }
function ordDates(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.indexOf('sg_ord_')===0) out.push(k.slice(7)); }
  return out.sort((a,b)=>ordDV(b).localeCompare(ordDV(a)));
}
function ordDV(d){ const p=String(d).split('-'); return p.length===3? p[2]+p[1]+p[0] : String(d); }
function ordAll(){
  const out=[];
  ordDates().forEach(d=>ordLoad(d).forEach(o=>out.push(Object.assign({},o,{date:d}))));
  return out;
}
/* बाक़ी item — जिनकी qty अभी > 0 है */
function ordRemain(o){ return (o.items||[]).filter(it=>oq(it.qty)>0); }
function ordPending(){ return ordAll().filter(o=>!o.cancelled && ordRemain(o).length); }
function ordFind(date,id){ const l=ordLoad(date); const i=l.findIndex(x=>x.id===id); return i<0?null:{list:l,i,o:l[i]}; }
/* सभी delivery — {…delivery, order} */
function ordDelivs(){
  const out=[];
  ordAll().forEach(o=>(o.deliv||[]).forEach((dv,k)=>out.push(Object.assign({},dv,{order:o,dk:k}))));
  return out;
}

/* ---------- ITEMS — Atta Receipt जैसा ---------- */
const ORD_CATS = {
  'Atta'    : {ico:'🌾', list:['Atta Gold','Atta 47kg','Atta 50kg','Atta 18kg','Atta 10kg','Atta 5kg']},
  'Sattu'   : {ico:'🥣', list:['Sattu 200g','Sattu 500g']},
  'Besan'   : {ico:'🟡', list:['Besan 200g','Besan 500g']},
  'Chokar'  : {ico:'🌾', list:['Chokar (30kg)']},
  'Jut Bora': {ico:'📦', list:['Jut Bora (Fresh)','Jut Bora (Normal)']}
};
const ORD_ITEM_FLAT = Object.keys(ORD_CATS).reduce((a,k)=>a.concat(ORD_CATS[k].list),[]);
function itemGroup(n){ n=String(n||'').toLowerCase();
  if(n.indexOf('atta')>=0) return 'Atta';
  if(n.indexOf('chokar')>=0) return 'Chokar';
  if(n.indexOf('sattu')>=0) return 'Sattu';
  if(n.indexOf('besan')>=0) return 'Besan';
  if(n.indexOf('bora')>=0) return 'Jut Bora';
  return 'Other'; }
function itemOrder(n){ const i=ORD_ITEM_FLAT.indexOf(n); return i<0? 999:i; }

/* ---------- AREA ---------- */
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
  return {code:(s? s.slice(0,3).toUpperCase():'—'), name:(s||'OTHER'), hi:''};
}

/* ---------- English → Hindi ---------- */
const ORD_DICT = {jee:'जी',ji:'जी',raju:'राजू',ram:'राम',amit:'अमित',shyam:'श्याम',mohan:'मोहन',sohan:'सोहन',
  singh:'सिंह',kumar:'कुमार',lal:'लाल',devi:'देवी',yadav:'यादव',sah:'साह',sahu:'साहू',gupta:'गुप्ता',
  mandal:'मंडल',paswan:'पासवान',thakur:'ठाकुर',sharma:'शर्मा',rai:'राय',mishra:'मिश्रा',prasad:'प्रसाद',
  kirana:'किराना',store:'स्टोर',bhai:'भाई',babu:'बाबू',dukan:'दुकान',
  khagaria:'खगड़िया',manshi:'मानसी',maheshkhunt:'महेशखूंट',gogri:'गोगरी',jamalpur:'जमालपुर',
  karuaamor:'करुआमोड़',chotham:'चौथम',sonbarsha:'सोनबरसा',saharsa:'सहरसा',parbatta:'परबत्ता',
  beldaur:'बेलदौर',alauli:'अलौली',bakhri:'बखरी',begusarai:'बेगूसराय',bazar:'बाज़ार',market:'मार्केट'};
function ordToHi(txt){
  return String(txt||'').split(/(\s+|[^A-Za-z\u0900-\u097F]+)/).map(w=>{
    if(!/^[A-Za-z]+$/.test(w)) return w;
    const lw=w.toLowerCase();
    return ORD_DICT[lw] || translit(lw);
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
      const v=grab(V); if(v){ out+=v.val[1]; i+=v.len; lastCons=false; }
      continue; }
    const v=grab(V);
    if(v){ out+= lastCons? v.val[1] : v.val[0]; i+=v.len; lastCons=false; continue; }
    i++;
  }
  return out||w;
}
function ordTryGoogle(txt,cb){
  if(!txt) return;
  fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=${encodeURIComponent(txt)}`)
    .then(r=>r.json()).then(d=>{ const t=d&&d[0]&&d[0][0]&&d[0][0][0]; if(t) cb(t); }).catch(()=>{});
}

/* ---------- helpers ---------- */
const oq = v => { const n=parseFloat(v); return isFinite(n)? n:0; };
const oqs = v => { const n=oq(v); return (Math.round(n*100)/100).toString(); };
function hasRate(it){ return oq(it.rate)>0; }
function ordNeedRate(o){ return ordRemain(o).some(it=>!hasRate(it)); }

/* ---------- aggregate ---------- */
function aggItems(list){
  const m={};
  list.forEach(o=>ordRemain(o).forEach(it=>{ const k=it.name||'—'; m[k]=(m[k]||0)+oq(it.qty); }));
  return Object.keys(m).filter(k=>m[k]>0).sort((a,b)=>itemOrder(a)-itemOrder(b)).map(k=>({name:k,qty:m[k]}));
}
function aggArea(list){
  const m={};
  list.forEach(o=>{
    const a=areaOf(o.address); const key=a.code+'|'+a.name;
    if(!m[key]) m[key]={area:a,orders:0,items:{}};
    m[key].orders++;
    ordRemain(o).forEach(it=>{ const k=it.name||'—'; m[key].items[k]=(m[key].items[k]||0)+oq(it.qty); });
  });
  return Object.keys(m).sort().map(k=>m[k]);
}

/* =========================================================
   RENDER — Order Book
========================================================= */
function renderOrderBook(){
  const wrap=document.getElementById('ob-body'); if(!wrap) return;
  const dEl=document.getElementById('ob-date'); if(dEl) dEl.textContent=DATE;
  const pend=ordPending();
  const back=pend.filter(o=>o.date!==DATE);
  const today=pend.filter(o=>o.date===DATE);
  const todayDel=ordDelivs().filter(dv=>dv.date===DATE);      // सिर्फ़ आज की delivery

  const tot=aggItems(pend);
  const totHTML = tot.length
    ? tot.map(t=>`<div class="ob-tl"><span class="ob-tl-n">${esc(t.name)}</span><span class="ob-tl-s">-</span><span class="ob-tl-q">${oqs(t.qty)}</span></div>`).join('')
    : `<div class="ob-empty">कोई pending order नहीं</div>`;

  const areas=aggArea(pend);
  const AC=['#c0392b','#1f4ed8','#1e8449','#8e44ad','#d35400','#00838f','#b7950b'];
  const areaHTML = areas.length? areas.map((g,i)=>{
    const its=Object.keys(g.items).filter(k=>g.items[k]>0).sort((a,b)=>itemOrder(a)-itemOrder(b));
    return `<div class="ob-ac" style="--ac:${AC[i%AC.length]}">
      <div class="ob-ac-h"><b>${esc(g.area.code)}</b><span>${esc(g.area.name)}</span>${g.area.hi?`<i>${esc(g.area.hi)}</i>`:''}</div>
      <div class="ob-ac-b">${its.map(k=>`<div class="ob-ac-l"><span>${esc(k)}</span><b>${oqs(g.items[k])}</b></div>`).join('')}</div>
      <div class="ob-ac-f">${g.orders} order</div></div>`;
  }).join('') : `<div class="ob-empty">—</div>`;

  wrap.innerHTML=`
    <div class="ob-card">
      <div class="ob-card-h dark">Σ TOTAL — बाक़ी सारा order (पिछला + आज)</div>
      <div class="ob-total-grid">${totHTML}</div>
    </div>

    <div class="ob-card">
      <div class="ob-card-h blue">📍 AREA WISE TOTAL</div>
      <div class="ob-ac-row">${areaHTML}</div>
    </div>

    <div class="ob-2col">
      <div class="ob-side">
        <div class="ob-card-h dark">📋 ORDER — बाक़ी (${pend.length})</div>
        ${back.length? `<div class="ob-sub back">⏮ पिछली तारीख़ के बचे order — ${back.length}</div>`+back.map(o=>orderCardHTML(o,true)).join('') : ''}
        ${today.length? `<div class="ob-sub">📅 आज के order — ${today.length}</div>`+today.map(o=>orderCardHTML(o,false)).join('') : ''}
        ${pend.length? '' : `<div class="ob-empty">अभी कोई order बाक़ी नहीं</div>`}
        <div class="ob-add" id="ob-add-btn">➕ नया Order जोड़ें</div>
      </div>
      <div class="ob-side">
        <div class="ob-card-h green">✅ TODAY COMPLEAT — ${esc(DATE)} (${todayDel.length})</div>
        ${todayDel.length? todayDel.map(dv=>delivCardHTML(dv)).join('') : `<div class="ob-empty">आज अभी कुछ complete नहीं</div>`}
      </div>
    </div>`;
  const ab=document.getElementById('ob-add-btn'); if(ab) ab.addEventListener('click',()=>orderForm(null));
}

function itemPillHTML(it,part){
  const r = hasRate(it)? `<em>× ${oqs(it.rate)}</em>` : `<em class="no">× rate ?</em>`;
  return `<span class="ob-pill${part?' part':''}">${esc(it.name)} <b>${oqs(it.qty)}</b>${r}${part?'<i>बचा हुआ</i>':''}${it.note?`<small>${esc(it.note)}</small>`:''}</span>`;
}
function orderCardHTML(o,isBack){
  const a=areaOf(o.address);
  const part=!!(o.deliv&&o.deliv.length);
  const rem=ordRemain(o);
  return `<div class="ob-o${isBack?' back':''}${part?' part':''}" data-od="${esc(o.date)}" data-oi="${esc(o.id)}">
    <div class="ob-o-h">
      <span class="ob-sl">${esc(String(o.no))}</span>
      <span class="ob-o-nm">${esc((o.name||'').toUpperCase())}${o.nameHi?`<i>${esc(o.nameHi)}</i>`:''}</span>
      <span class="ob-tag ac">${esc(a.code)}</span>
      ${part?'<span class="ob-tag part">बचा हुआ</span>':''}
      <span class="ob-tag time">${isBack?`🕐 ${esc(o.ts||'')} · ${esc(o.date)}`:`🕐 ${esc(o.ts||'')}`}</span>
    </div>
    <div class="ob-o-b">${rem.map(it=>itemPillHTML(it,part)).join('')}</div>
    <div class="ob-o-f">${ordNeedRate(o)?'⚠️ Rate बाक़ी — click कर के भरें':'👉 click → Atta Receipt auto-fill'}</div>
  </div>`;
}
function delivCardHTML(dv){
  const o=dv.order, a=areaOf(o.address);
  const left=ordRemain(o);
  return `<div class="ob-o done" data-od="${esc(o.date)}" data-oi="${esc(o.id)}">
    <div class="ob-o-h">
      <span class="ob-sl green">${esc(String(o.no))}</span>
      <span class="ob-o-nm">${esc((o.name||'').toUpperCase())}${o.nameHi?`<i>${esc(o.nameHi)}</i>`:''}</span>
      <span class="ob-tag ac">${esc(a.code)}</span>
      ${dv.rno?`<span class="ob-tag rc">Receipt #${esc(String(dv.rno))}</span>`:''}
      <span class="ob-tag ok">✅ ${esc(dv.ts||'')}</span>
    </div>
    <div class="ob-o-b">${(dv.items||[]).map(it=>`<span class="ob-pill ok">${esc(it.name)} <b>${oqs(it.qty)}</b>${hasRate(it)?`<em>× ${oqs(it.rate)}</em>`:''}${it.extra?'<i>extra</i>':''}</span>`).join('')}</div>
    ${left.length? `<div class="ob-o-f red">⏳ बचा हुआ: ${left.map(it=>esc(it.name)+' '+oqs(it.qty)).join(' · ')}</div>`:'<div class="ob-o-f green">पूरा order complete ✅</div>'}
    ${o.date!==DATE? `<div class="ob-o-f">order तारीख़: ${esc(o.date)}</div>`:''}
  </div>`;
}

/* =========================================================
   FORM — नया / edit order
========================================================= */
function itemRowHTML(it){
  it=it||{};
  return `<div class="ob-fr">
    <div class="ob-fpick${it.name?' has':''}" tabindex="0">
      <span class="ob-fpick-t">${it.name? esc(it.name) : 'Particulars चुनें'}</span>
      <input type="hidden" class="of-item" value="${esc(it.name||'')}"><b>▼</b></div>
    <input type="number" step="any" class="of-qty" placeholder="Qty" value="${esc(it.qty??'')}">
    <input type="number" step="any" class="of-rate" placeholder="Rate (बाद में भी)" value="${esc(it.rate??'')}">
    <input type="text" class="of-note" placeholder="note" value="${esc(it.note||'')}">
    <button type="button" class="of-del" title="हटाएँ">✕</button></div>`;
}
/* Particulars picker — Category → Variety */
function pickItem(cb){
  const back=document.createElement('div');
  back.className='ob-pick-back';
  back.innerHTML=`<div class="ob-pick">
    <div class="ob-pick-h">📦 Category चुनें<span class="x">&times;</span></div>
    <div class="ob-pick-g" id="obp-g">${Object.keys(ORD_CATS).map(c=>`<button data-c="${esc(c)}">${ORD_CATS[c].ico} ${esc(c)}</button>`).join('')}</div></div>`;
  document.body.appendChild(back);
  const close=()=>back.remove();
  back.addEventListener('click',e=>{ if(e.target===back||e.target.classList.contains('x')) close(); });
  back.querySelector('#obp-g').addEventListener('click',e=>{
    const b=e.target.closest('button[data-c]'); if(!b) return;
    const c=b.dataset.c, list=ORD_CATS[c].list;
    if(list.length===1){ cb(list[0]); close(); return; }
    back.querySelector('.ob-pick-h').innerHTML=`${ORD_CATS[c].ico} ${esc(c)} — Variety<span class="x">&times;</span>`;
    const g=back.querySelector('#obp-g');
    g.innerHTML=list.map(n=>`<button data-n="${esc(n)}">${esc(n)}</button>`).join('')+`<button data-bk="1" class="bk">← वापस</button>`;
    g.onclick=ev=>{
      const t=ev.target.closest('button'); if(!t) return;
      if(t.dataset.bk){ close(); pickItem(cb); return; }
      if(t.dataset.n){ cb(t.dataset.n); close(); }
    };
  });
}
function orderForm(existing){
  const o=existing||{items:[{}]};
  popup({
    title: existing? '✏️ Order बदलें' : '➕ नया Order',
    body:`<div class="pp-note">नाम / पता <b>English</b> में लिखें — Hindi अपने आप बन जाएगा (सुधार भी सकते हैं). Rate अभी न भरें तो भी चलेगा.</div>
      <div class="f-row"><input type="text" id="of-name" placeholder="Customer Name (English)" value="${esc(o.name||'')}"></div>
      <div class="f-row"><input type="text" id="of-name-hi" class="hi" placeholder="हिंदी नाम" value="${esc(o.nameHi||'')}"></div>
      <div class="f-row"><input type="text" id="of-addr" placeholder="Address / Area (English)" value="${esc(o.address||'')}"></div>
      <div class="f-row"><input type="text" id="of-addr-hi" class="hi" placeholder="हिंदी पता" value="${esc(o.addressHi||'')}"></div>
      <div class="chips tiny" id="of-area-chips">${ORD_AREAS.map(a=>`<div class="chip sm" data-a="${esc(a.name)}">${esc(a.name)}<small>${a.code}</small></div>`).join('')}</div>
      <div class="f-row"><input type="text" id="of-phone" placeholder="Mobile (optional)" value="${esc(o.phone||'')}"></div>
      <div class="ob-fhead"><span>Particulars</span><span>Qty</span><span>Rate</span><span>Note</span><span></span></div>
      <div id="of-items">${(o.items&&o.items.length?o.items:[{}]).map(itemRowHTML).join('')}</div>
      <div class="add-strip" id="of-add-item">➕ और item जोड़ें</div>`,
    foot:`<span></span><div style="display:flex;gap:8px;">
      ${existing?'<button class="pp-btn cancel" id="of-del-order">🗑️ हटाएँ</button>':''}
      <button class="pp-btn cancel" onclick="closePopup()">रद्द</button>
      <button class="pp-btn save" id="of-save">✔ Save</button></div>`,
    onOpen(bk){
      const nm=bk.querySelector('#of-name'), hi=bk.querySelector('#of-name-hi');
      const ad=bk.querySelector('#of-addr'), ah=bk.querySelector('#of-addr-hi');
      let t1=null,t2=null;
      nm.addEventListener('input',()=>{ hi.value=ordToHi(nm.value);
        clearTimeout(t1); const v=nm.value; t1=setTimeout(()=>ordTryGoogle(v,t=>{ if(nm.value===v) hi.value=t; }),700); });
      ad.addEventListener('input',()=>{ ah.value=ordToHi(ad.value);
        clearTimeout(t2); const v=ad.value; t2=setTimeout(()=>ordTryGoogle(v,t=>{ if(ad.value===v) ah.value=t; }),700); });
      bk.querySelector('#of-area-chips').addEventListener('click',e=>{
        const c=e.target.closest('.chip'); if(!c) return;
        ad.value=c.dataset.a; ah.value=ordToHi(c.dataset.a);
        bk.querySelectorAll('#of-area-chips .chip').forEach(x=>x.classList.remove('sel')); c.classList.add('sel');
      });
      bk.querySelector('#of-add-item').addEventListener('click',()=>{
        bk.querySelector('#of-items').insertAdjacentHTML('beforeend',itemRowHTML({}));
      });
      bk.querySelector('#of-items').addEventListener('click',e=>{
        if(e.target.classList.contains('of-del')){
          const box=bk.querySelector('#of-items');
          if(box.children.length>1) e.target.closest('.ob-fr').remove(); else toast('कम से कम 1 item ज़रूरी');
          return;
        }
        const pk=e.target.closest('.ob-fpick');
        if(pk) pickItem(n=>{ pk.querySelector('.ob-fpick-t').textContent=n; pk.querySelector('.of-item').value=n;
          pk.classList.add('has'); const q=pk.parentElement.querySelector('.of-qty'); if(q) q.focus(); });
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
        bk.querySelectorAll('#of-items .ob-fr').forEach(r=>{
          const n=r.querySelector('.of-item').value, q=r.querySelector('.of-qty').value;
          if(!n || !oq(q)) return;
          items.push({name:n, qty:oq(q), rate:r.querySelector('.of-rate').value.trim(), note:r.querySelector('.of-note').value.trim()});
        });
        if(!items.length) return toast('Particulars + Qty भरें');
        const data={name, nameHi:hi.value.trim(), address:ad.value.trim(), addressHi:ah.value.trim(),
                    phone:bk.querySelector('#of-phone').value.trim(), items};
        if(existing){
          const f=ordFind(existing.date,existing.id); if(!f) return;
          Object.assign(f.o,data); f.o.ets=nowTS(); f.o.edited=true;
          f.o.ordered=items.map(x=>({name:x.name,qty:x.qty}));
          ordSave(existing.date,f.list);
        }else{
          const list=ordLoad(DATE);
          list.push(Object.assign(data,{id:'o'+Date.now()+Math.floor(Math.random()*99),
            no:String(ordNextNo()).padStart(2,'0'), ts:nowTS(), deliv:[],
            ordered:items.map(x=>({name:x.name,qty:x.qty}))}));
          ordSave(DATE,list);
        }
        closePopup(); renderOrderBook(); toast('Order save ✔');
      });
    }
  });
}
/* Serial No — सब तारीख़ों में continuous */
function ordNextNo(){ let mx=0; ordAll().forEach(o=>{ const n=parseInt(o.no,10); if(isFinite(n)&&n>mx) mx=n; }); return mx+1; }

/* =========================================================
   CLICK → rate / Receipt
========================================================= */
function ordBoxAction(date,id){
  const f=ordFind(date,id); if(!f) return;
  const o=Object.assign({},f.o,{date});
  const rem=ordRemain(o);
  popup({
    title:`🧾 Order #${esc(String(o.no))} — ${esc((o.name||'').toUpperCase())}`,
    body:`<div class="pp-note">${esc(areaOf(o.address).name)} · order ${esc(o.date)} ${esc(o.ts||'')}${o.phone?' · 📞 '+esc(o.phone):''}</div>
      ${rem.length? `<div class="ob-vh">⏳ बाक़ी</div>`+rem.map(it=>`<div class="ob-vl">${esc(it.name)} <b>${oqs(it.qty)}</b> ${hasRate(it)?'× '+oqs(it.rate):'<span class="no">rate नहीं</span>'}</div>`).join('') : '<div class="ob-vh ok">पूरा हो गया ✅</div>'}
      ${(o.deliv&&o.deliv.length)? `<div class="ob-vh green">✅ दिया गया</div>`+o.deliv.map(dv=>`<div class="ob-vl sm">${esc(dv.date)} ${esc(dv.ts||'')} — ${(dv.items||[]).map(x=>esc(x.name)+' '+oqs(x.qty)).join(', ')}</div>`).join('') : ''}`,
    foot:`<span></span><div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="pp-btn cancel" onclick="closePopup()">बंद</button>
      <button class="pp-btn" style="background:#f39c12;color:#fff;" id="ob-edit">✏️ Edit</button>
      ${rem.length? `<button class="pp-btn save" id="ob-fill">${ordNeedRate(o)?'💰 पहले Rate भरें':'🧾 Atta Receipt खोलें →'}</button>`:''}
      ${(o.deliv&&o.deliv.length)? `<button class="pp-btn" style="background:#636e72;color:#fff;" id="ob-undo">↩ आख़िरी delivery वापस</button>`:''}
      </div>`,
    onOpen(bk){
      bk.querySelector('#ob-edit').addEventListener('click',()=>{ closePopup(); orderForm(o); });
      const fl=bk.querySelector('#ob-fill');
      if(fl) fl.addEventListener('click',()=>{ if(ordNeedRate(o)) rateForm(date,id); else ordToReceipt(date,id); });
      const un=bk.querySelector('#ob-undo');
      if(un) un.addEventListener('click',()=>{
        const g=ordFind(date,id); const dv=(g.o.deliv||[]).pop();
        if(dv) (dv.items||[]).forEach(x=>{ if(x.extra) return;
          const it=(g.o.items||[]).find(y=>y.name===x.name);
          if(it) it.qty=oq(it.qty)+oq(x.qty); else g.o.items.push({name:x.name,qty:oq(x.qty),rate:x.rate||''}); });
        ordSave(date,g.list); closePopup(); renderOrderBook(); toast('delivery वापस — फिर बाक़ी में');
      });
    }
  });
}
function rateForm(date,id){
  const f=ordFind(date,id); if(!f) return;
  const rem=ordRemain(f.o);
  popup({
    title:'💰 Rate भरें — Order Book',
    body:`<div class="pp-note">इस order में rate नहीं लिखा था. rate भरने के बाद ही Atta Receipt अपने आप भरेगा.</div>
      ${rem.map(it=>`<div class="f-row"><div class="ro">${esc(it.name)} — Qty ${oqs(it.qty)}</div>
        <input type="number" step="any" class="ob-rt" data-n="${esc(it.name)}" placeholder="Rate ₹" value="${esc(it.rate||'')}"></div>`).join('')}`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">रद्द</button>
      <button class="pp-btn save" id="ob-rsave">✔ Save & Receipt →</button></div>`,
    onOpen(bk){
      bk.querySelector('#ob-rsave').addEventListener('click',()=>{
        const g=ordFind(date,id); let ok=true;
        bk.querySelectorAll('.ob-rt').forEach(inp=>{
          if(!oq(inp.value)){ ok=false; return; }
          const it=(g.o.items||[]).find(x=>x.name===inp.dataset.n); if(it) it.rate=inp.value.trim();
        });
        if(!ok) return toast('सभी item का rate भरें');
        g.o.ets=nowTS(); ordSave(date,g.list);
        closePopup(); renderOrderBook(); ordToReceipt(date,id);
      });
    }
  });
}
function ordToReceipt(date,id){
  const f=ordFind(date,id); if(!f) return;
  const o=f.o;
  try{ localStorage.setItem('sg_ord_prefill',JSON.stringify({
    ordDate:date, ordId:id, no:o.no,
    name:o.name||'', nameHi:o.nameHi||'', address:o.address||'', addressHi:o.addressHi||ordToHi(o.address||''),
    items:ordRemain(o).map(it=>({name:it.name,qty:it.qty,rate:it.rate}))
  })); }catch(e){}
  location.href='atta-receipt.html?ord=1';
}
document.addEventListener('click',e=>{
  const b=e.target.closest('#ob-body .ob-o');
  if(b) ordBoxAction(b.dataset.od,b.dataset.oi);
});

/* =========================================================
   📊 TALLY VIEW
========================================================= */
function tallyHTML(){
  const all=ordAll();
  const pend=ordPending();
  const delivs=ordDelivs();
  const im={};
  const I=(k)=>{ im[k]=im[k]||{ord:0,del:0,bal:0}; return im[k]; };
  all.forEach(o=>(o.ordered||o.items||[]).forEach(it=>{ I(it.name).ord+=oq(it.qty); }));
  delivs.forEach(dv=>(dv.items||[]).forEach(it=>{ I(it.name).del+=oq(it.qty); }));
  pend.forEach(o=>ordRemain(o).forEach(it=>{ I(it.name).bal+=oq(it.qty); }));
  const iKeys=Object.keys(im).sort((a,b)=>itemOrder(a)-itemOrder(b));

  const am={};
  const A=(k)=>{ am[k]=am[k]||{ord:0,del:0,bal:0,rs:0}; return am[k]; };
  all.forEach(o=>{ const c=areaOf(o.address); (o.ordered||o.items||[]).forEach(it=>A(c.code+' · '+c.name).ord+=oq(it.qty)); });
  delivs.forEach(dv=>{ const c=areaOf(dv.order.address);
    (dv.items||[]).forEach(it=>{ const x=A(c.code+' · '+c.name); x.del+=oq(it.qty); x.rs+=oq(it.qty)*oq(it.rate); }); });
  pend.forEach(o=>{ const c=areaOf(o.address); ordRemain(o).forEach(it=>A(c.code+' · '+c.name).bal+=oq(it.qty)); });

  const cm={};
  all.forEach(o=>{ const k=(o.name||'').toUpperCase();
    cm[k]=cm[k]||{name:o.name,hi:o.nameHi,area:areaOf(o.address).code,ord:0,del:0,bal:0,rs:0};
    (o.ordered||o.items||[]).forEach(it=>cm[k].ord+=oq(it.qty));
    (o.deliv||[]).forEach(dv=>(dv.items||[]).forEach(it=>{ cm[k].del+=oq(it.qty); cm[k].rs+=oq(it.qty)*oq(it.rate); }));
    ordRemain(o).forEach(it=>cm[k].bal+=oq(it.qty)); });
  const cKeys=Object.keys(cm).sort((a,b)=>cm[b].bal-cm[a].bal||cm[b].rs-cm[a].rs);
  const totRs=delivs.reduce((a,dv)=>a+(dv.items||[]).reduce((x,it)=>x+oq(it.qty)*oq(it.rate),0),0);
  const T=(head,rows)=>`<table class="tv-t"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:#b6bcc9;">— कोई data नहीं —</td></tr>'}</tbody></table>`;

  return `
  <div class="tv-kpis">
    <div class="tv-k"><small>कुल Order</small><b>${all.length}</b></div>
    <div class="tv-k g"><small>Delivery</small><b>${delivs.length}</b></div>
    <div class="tv-k r"><small>बाक़ी Order</small><b>${pend.length}</b></div>
    <div class="tv-k b"><small>Delivered ₹</small><b>${fmt(totRs)}</b></div>
  </div>
  <div class="tv-card"><div class="tv-h dark">📦 ITEM WISE</div>
    ${T(['Particulars','Order','दिया','बाक़ी'], iKeys.map(k=>`<tr><td>${esc(k)}</td><td>${oqs(im[k].ord)}</td><td class="g">${oqs(im[k].del)}</td><td class="r">${oqs(im[k].bal)}</td></tr>`).join(''))}
  </div>
  <div class="tv-card"><div class="tv-h blue">📍 AREA WISE</div>
    ${T(['Area','Order','दिया','बाक़ी','Value ₹'], Object.keys(am).sort().map(k=>`<tr><td>${esc(k)}</td><td>${oqs(am[k].ord)}</td><td class="g">${oqs(am[k].del)}</td><td class="r">${oqs(am[k].bal)}</td><td>${fmt(am[k].rs)}</td></tr>`).join(''))}
  </div>
  <div class="tv-card"><div class="tv-h green">👤 CUSTOMER WISE</div>
    ${T(['Name','Area','Order','दिया','बाक़ी','Value ₹'], cKeys.map(k=>`<tr><td>${esc((cm[k].name||'').toUpperCase())}${cm[k].hi?` <small>(${esc(cm[k].hi)})</small>`:''}</td><td>${esc(cm[k].area)}</td><td>${oqs(cm[k].ord)}</td><td class="g">${oqs(cm[k].del)}</td><td class="r">${oqs(cm[k].bal)}</td><td>${fmt(cm[k].rs)}</td></tr>`).join(''))}
  </div>`;
}
function renderTally(){ const el=document.getElementById('tv-body'); if(el) el.innerHTML=tallyHTML(); }

/* =========================================================
   PRINT
========================================================= */
function orderBookPrintHTML(forDate,inclCarry){
  const d=forDate||DATE;
  const all=ordAll();
  const dayOrders=all.filter(o=>o.date===d && ordRemain(o).length);
  const carry= inclCarry===false? [] : all.filter(o=>ordRemain(o).length && ordDV(o.date)<ordDV(d));
  const pend=dayOrders.concat(carry);
  const del=ordDelivs().filter(dv=>dv.date===d);
  const tot=aggItems(pend), areas=aggArea(pend);
  const row=o=>`<tr${o.date!==d?' style="color:#c0392b;"':''}>
    <td style="text-align:center;font-weight:800;">${esc(String(o.no))}</td>
    <td>${esc((o.name||'').toUpperCase())}${o.nameHi?` (${esc(o.nameHi)})`:''}</td>
    <td style="text-align:center;">${esc(areaOf(o.address).code)}</td>
    <td>${ordRemain(o).map(it=>`${esc(it.name)} ${oqs(it.qty)}${hasRate(it)?' × '+oqs(it.rate):' × ?'}`).join(' , ')}${(o.deliv&&o.deliv.length)?' <b>(बचा हुआ)</b>':''}</td>
    <td style="text-align:center;font-size:10px;">${esc(o.ts||'')}${o.date!==d?'<br>'+esc(o.date):''}</td></tr>`;
  return `<div style="background:#fff;color:#000;padding:10px 12px;font-family:'Poppins','Noto Sans Devanagari',sans-serif;">
    <div style="text-align:center;font-weight:900;font-size:19px;">SATYAM FOOD PRODUCT</div>
    <div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:6px;">ORDER BOOK — ${esc(d)}</div>
    <div style="border:2px solid #000;padding:6px 10px;margin-bottom:8px;">
      <div style="text-align:center;font-weight:900;text-decoration:underline;margin-bottom:4px;">TOTAL</div>
      ${tot.length? tot.map(t=>`<div style="display:inline-block;min-width:32%;font-weight:700;font-size:12.5px;">${esc(t.name)} - ${oqs(t.qty)}</div>`).join(''):'<i>—</i>'}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
      ${areas.map(g=>`<div style="border:1.5px solid #c0392b;padding:3px 7px;font-size:11px;font-weight:700;">
        ${esc(g.area.name)} (${esc(g.area.code)})<br>${Object.keys(g.items).filter(k=>g.items[k]>0).map(k=>esc(k)+' '+oqs(g.items[k])).join(' · ')}</div>`).join('')||'<i>—</i>'}
    </div>
    <div style="font-weight:900;font-size:13px;background:#243447;color:#fff;padding:3px 8px;">ORDER — बाक़ी (${pend.length})</div>
    <table border="1" style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:8px;">
      <thead style="background:#eef2f7;"><tr><th style="width:7%">Sr</th><th style="width:26%">Name</th><th style="width:8%">Area</th><th>Particulars (Qty × Rate)</th><th style="width:13%">Time</th></tr></thead>
      <tbody>${pend.map(row).join('')||'<tr><td colspan="5" style="text-align:center;">— कोई order नहीं —</td></tr>'}</tbody></table>
    <div style="font-weight:900;font-size:13px;background:#1e8449;color:#fff;padding:3px 8px;">TODAY COMPLEAT (${del.length})</div>
    <table border="1" style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead style="background:#eaf7ef;"><tr><th style="width:7%">Sr</th><th style="width:26%">Name</th><th style="width:8%">Area</th><th>दिया गया</th><th style="width:13%">Time</th></tr></thead>
      <tbody>${del.map(dv=>`<tr><td style="text-align:center;font-weight:800;">${esc(String(dv.order.no))}</td><td>${esc((dv.order.name||'').toUpperCase())}${dv.order.nameHi?` (${esc(dv.order.nameHi)})`:''}</td><td style="text-align:center;">${esc(areaOf(dv.order.address).code)}</td><td>${(dv.items||[]).map(it=>`${esc(it.name)} ${oqs(it.qty)}${hasRate(it)?' × '+oqs(it.rate):''}${it.extra?' (extra)':''}`).join(' , ')}</td><td style="text-align:center;font-size:10px;">${esc(dv.ts||'')}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;">— —</td></tr>'}</tbody></table>
  </div>`;
}
function tallyPrintHTML(){
  return `<div style="background:#fff;color:#000;padding:10px 12px;font-family:'Poppins','Noto Sans Devanagari',sans-serif;">
    <div style="text-align:center;font-weight:900;font-size:19px;">SATYAM FOOD PRODUCT</div>
    <div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:8px;">📊 TALLY VIEW — ${esc(DATE)}</div>
    ${tallyHTML()}</div>`;
}

/* =========================================================
   HOOKS
========================================================= */
(function(){
  const _go=go;
  go=function(n){ _go(n); if(n==='orderbook') renderOrderBook(); if(n==='tally') renderTally(); };
  const wire=()=>{
    const pb=document.getElementById('ob-print-btn');
    if(pb&&!pb._w){ pb._w=1; pb.addEventListener('click',()=>printDocument(orderBookPrintHTML(DATE,true),{landscape:false,stretch:true,grow:true})); }
    const tp=document.getElementById('tv-print-btn');
    if(tp&&!tp._w){ tp._w=1; tp.addEventListener('click',()=>printDocument(tallyPrintHTML(),{landscape:false,stretch:true,grow:true})); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
window.renderOrderBook=renderOrderBook;
window.orderBookPrintHTML=orderBookPrintHTML;
window.renderTally=renderTally;
