/* =========================================================
   📊 TALLY VIEW  —  C/D (Creditors / Debtors / Other) + Mill Kharch
   पूरा नया system — पुराना tally हटा दिया गया
   सारा data notebook (sg_nb_*), Atta receipt (sg_arcpt_*),
   Wheat slip (sg_wrcpt_*), Attendance (sg_staff) से अपने आप बनता है
========================================================= */
'use strict';

/* ---------- छोटे helpers ---------- */
const tvN   = v => { const n = parseFloat(String(v).replace(/,/g,'')); return isNaN(n) ? 0 : n; };
const tvK   = s => String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
const tvE   = s => (typeof esc==='function' ? esc(s) : String(s??''));
const tvF   = n => (typeof fmt==='function' ? fmt(Math.round(tvN(n))) : String(Math.round(tvN(n))));
function tvDV(d){ const m=/^(\d{2})-(\d{2})-(\d{4})$/.exec(d||''); return m? (+m[3])*10000+(+m[2])*100+(+m[1]) : 0; }
function tvToday(){ const d=new Date(); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; }
function tvAge(d){ const p=/^(\d{2})-(\d{2})-(\d{4})$/.exec(d||''); if(!p) return 0;
  const t=new Date(+p[3],+p[2]-1,+p[1]); return Math.max(0, Math.floor((Date.now()-t.getTime())/864e5)); }
function tvDates(prefix){ const o=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf(prefix)===0) o.push(k.slice(prefix.length)); } return o.sort((a,b)=>tvDV(a)-tvDV(b)); }
function tvJSON(k,dflt){ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?dflt:v; }catch(e){ return dflt; } }
function tvSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function tvArr(k){ const v=tvJSON(k,[]); return Array.isArray(v)?v:[]; }

/* ---------- persistent stores ---------- */
const TV_MOB    = 'sg_mobiles';        // { NAMEKEY : "9999999999" }
const TV_LIMIT  = 'sg_deb_limit';      // { NAMEKEY : 4 }
const TV_SCRED  = 'sg_staff_credit';   // { NAMEKEY : { "08-2026": 12000 } }
const TV_SCARRY = 'sg_staff_carry';    // { NAMEKEY : amount carried to next month }
const TV_PROD   = 'sg_mk_products';    // ["Loading","Unloading",...]
function tvMob(k){ return (tvJSON(TV_MOB,{})||{})[k]||''; }
function tvSetMob(k,v){ const m=tvJSON(TV_MOB,{})||{}; if(v) m[k]=v; else delete m[k]; tvSet(TV_MOB,m); }
function tvLimit(k){ const l=tvJSON(TV_LIMIT,{})||{}; return tvN(l[k])||2; }
function tvSetLimit(k,v){ const l=tvJSON(TV_LIMIT,{})||{}; l[k]=v; tvSet(TV_LIMIT,l); }

const TV_PROD_DEFAULT = ['Loading','Unloading','भाड़ा (Bhara)','Overtime','बिजली बिल'];
function tvProducts(){ const p=tvArr(TV_PROD); return p.length? p : TV_PROD_DEFAULT.slice(); }
function tvAddProduct(n){ const p=tvProducts(); if(!p.includes(n)) p.push(n); tvSet(TV_PROD,p); }

const TV_VEHICLES = [
  {no:'BR34GA8293', kind:'pickup', label:'Pickup',      icon:'🛻', col:'#e67e22'},
  {no:'BR34GA8447', kind:'cngvan', label:'CNG Van',     icon:'🚐', col:'#2980b9'},
  {no:'BR34U9778',  kind:'bike',   label:'Bike',        icon:'🏍️', col:'#8e44ad'},
  {no:'WA24AE4843', kind:'car',    label:'Car (Diesel)',icon:'🚗', col:'#16a085'}
];
window.TV_VEHICLES = TV_VEHICLES;

const TV_AREAS = [
  {code:'BKP', pat:/बिक्रम|bikram/i},   {code:'PLG', pat:/पालीगंज|paliganj/i},
  {code:'NBT', pat:/नौबतपुर|naubatpur/i},{code:'DLM', pat:/दुल्हिन|dulhin/i},
  {code:'KJR', pat:/कंचनपुर|kanchan/i}, {code:'PTN', pat:/पटना|patna/i}
];
function tvArea(addr){
  const s=String(addr||'').trim();
  if(!s) return 'OTHER';
  for(const a of TV_AREAS) if(a.pat.test(s)) return a.code;
  return s.split(/[\s,]+/)[0].toUpperCase().slice(0,10);
}

/* =========================================================
   DATA ENGINE — सारे दिनों का notebook + receipts पढ़ कर ledger
========================================================= */
function tvNB(d){ const x=tvJSON('sg_nb_'+d,null); if(!x) return null;
  ['rokad','jama','maal','nagad','kharch','inhome','receipts'].forEach(k=>{ if(!Array.isArray(x[k])) x[k]=[]; }); return x; }

/* माल आवत entry की final amount + receipt no */
function tvMaalAmt(m,date){
  if(m.kind==='simple') return {amt: tvN(m.amount)|| tvN(m.qty)*tvN(m.rate), rno:'', final:true};
  const wh = tvArr('sg_wrcpt_'+date).find(r=>r.serial && Number(r.serial)===Number(m.serial));
  if(wh && tvN(wh.finalPay)>0) return {amt:tvN(wh.finalPay), rno:String(wh.no||m.rst||''), final:true};
  const wt = (m.kind==='fill') ? tvN(m.fillTotal) : tvN(m.nett);
  return {amt: wt*tvN(m.rate), rno:String(m.rst||''), final: wt>0 && tvN(m.rate)>0};
}

/* पूरा C/D ledger — cache के साथ */
let TV_CACHE=null;
function tvBuild(force){
  if(TV_CACHE && !force) return TV_CACHE;
  const cred={}, deb={}, staffPaid={};
  const staffNames = new Set((tvArr('sg_staff')||[]).map(tvK));
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
    if(k && k.indexOf('sg_att_')===0){ const a=tvJSON(k,{}); (a.staff||[]).forEach(n=>staffNames.add(tvK(n))); } }

  const C = (map,name,addr) => { const key=tvK(name); if(!key) return null;
    if(!map[key]) map[key]={key,name:String(name).trim(),address:addr||'',due:[],paid:[],cats:{}};
    if(addr && !map[key].address) map[key].address=addr; return map[key]; };

  const dates = tvDates('sg_nb_');
  /* --- notebook --- */
  dates.forEach(date=>{
    const db=tvNB(date); if(!db) return;
    /* माल आवत खाते → CREDITOR due (हमें देना है) */
    (db.maal||[]).forEach((m,mi)=>{
      if(!m.name) return;
      const cat = m.cat || 'wheat';
      const c=C(cred,m.name,m.address); if(!c) return;
      const A=tvMaalAmt(m,date);
      c.cats[cat]=1;
      c.due.push({date, amt:A.amt, cut:!!m.cut, final:A.final, cat, sub:m.sub||'',
        label:(m.label||'Wheat'), rno:A.rno, serial:m.serial,
        qty:(m.kind==='fill'? m.fillTotal : (m.kind==='simple'? m.qty : m.nett)),
        unit:(m.kind==='simple'? (m.qtyUnit||'') : 'kg'), rate:m.rate, ts:m.ts||'', idx:mi,
        rdate: (tvArr('sg_wrcpt_'+date).find(r=>Number(r.serial)===Number(m.serial))||{}).dateStr || date});
    });
    /* नगद नाम खाते → creditor / staff को दिया हुआ payment */
    (db.nagad||[]).forEach(n=>{
      if(!n.name) return; const key=tvK(n.name);
      const rec={date, amt:tvN(n.amount), cut:!!n.cut, ts:n.ts||'', mode:n.mode||'cash', item:n.item||''};
      if(staffNames.has(key)){ (staffPaid[key]=staffPaid[key]||[]).push(rec); }
      if(cred[key]) cred[key].paid.push(rec);
      else if(!staffNames.has(key)){ const c=C(cred,n.name,n.address); if(c){ c.paid.push(rec); c.cats.pay=1; } }
    });
    /* जमा नाम खाते → DEBTOR से मिला payment */
    (db.jama||[]).forEach(j=>{
      if(!j.name) return; const d=C(deb,j.name,j.address); if(!d) return;
      d.paid.push({date, amt:tvN(j.amount), cut:!!j.cut, ts:j.ts||'', mode:(tvN(j.online)>0?'A/C':'Cash')});
    });
  });

  /* --- Atta Receipt (बिक्री) → DEBTOR due --- */
  tvDates('sg_arcpt_').forEach(date=>{
    tvArr('sg_arcpt_'+date).forEach(r=>{
      const nm=r.nameHi||r.name; if(!nm) return;
      const d=C(deb,nm,r.addressHi||r.address); if(!d) return;
      d.due.push({date, amt:tvN(r.total), cut:!!r.cancelled, rno:String(r.no||''), ts:r.ts||'',
        rdate:r.dateStr||date, items:(r.items||[]).map(x=>`${x.name} ${x.qty}`).join(', '), final:true});
    });
  });

  const finish = (map)=>Object.values(map).map(o=>{
    o.dueT  = o.due .filter(x=>!x.cut).reduce((a,x)=>a+x.amt,0);
    o.paidT = o.paid.filter(x=>!x.cut).reduce((a,x)=>a+x.amt,0);
    o.bal   = o.dueT - o.paidT;
    o.openBills = o.due.filter(x=>!x.cut).length - o.paid.filter(x=>!x.cut).length;
    if(o.openBills<0) o.openBills=0;
    o.area  = tvArea(o.address);
    o.mob   = tvMob(o.key);
    o.last  = o.due.concat(o.paid).reduce((a,x)=>Math.max(a,tvDV(x.date)),0);
    return o;
  }).sort((a,b)=>b.bal-a.bal || a.name.localeCompare(b.name));

  /* --- STAFF (attendance से) --- */
  const staff = Array.from(staffNames).filter(Boolean).map(key=>{
    const orig=(tvArr('sg_staff')||[]).find(n=>tvK(n)===key)||key;
    const paid=(staffPaid[key]||[]);
    const cr=tvJSON(TV_SCRED,{})[key]||{};
    const carry=tvN((tvJSON(TV_SCARRY,{})||{})[key]);
    const dueT=paid.filter(x=>!x.cut).reduce((a,x)=>a+x.amt,0);
    const credT=Object.values(cr).reduce((a,x)=>a+tvN(x),0);
    return {key,name:orig,address:'mill staff',due:paid,paid:[],dueT,credT,carry,
      bal:credT+carry-dueT, mob:tvMob(key), area:'MILL', openBills:paid.length, cred:cr};
  }).sort((a,b)=>a.name.localeCompare(b.name));

  TV_CACHE={cred:finish(cred), deb:finish(deb), staff};
  return TV_CACHE;
}
function tvRefresh(){ TV_CACHE=null; }

/* =========================================================
   NAV STATE
========================================================= */
let TVS = {view:'root', sub:'', chip:'all', q:'', area:'', profile:null, mobMode:false};
const TV_TITLES = {
  root:'📊 TALLY VIEW', cd:'📒 C/D', cred:'🟥 CREDITORS', deb:'🟩 DEBTORS',
  other:'🟦 OTHER', kbora:'🧺 KALI BORA (Cr)', staff:'👷 STAFF (Cr)',
  daal:'🥣 DAAL (Cr)', roast:'🔥 ROAST (Cr)', profile:'👤 PROFILE',
  mk:'🏭 MILL खर्च', mkprod:'📦 PRODUCT', mkgadi:'🚐 गाडी', mkmm:'🔧 MILL MAINTENANCE',
  mkveh:'🚗 गाडी', mkplant:'🏭 PLANT', mkoffice:'🏢 OFFICE'
};
function tvBack(){
  const b={cd:'root',cred:'cd',deb:'cd',other:'cd',kbora:'other',staff:'other',daal:'other',roast:'other',
    mk:'root',mkprod:'mk',mkgadi:'mk',mkmm:'mk',mkveh:'mkgadi',mkplant:'mkmm',mkoffice:'mkmm'};
  if(TVS.view==='profile'){ TVS.view=TVS.from||'cred'; TVS.profile=null; }
  else if(TVS.view==='root'){ go('home'); return; }
  else TVS.view = b[TVS.view]||'root';
  TVS.q=''; TVS.area=''; tvRender();
}

/* =========================================================
   RENDER
========================================================= */
function tvHead(title,extra){
  return `<div class="tvhead">
    <button class="tvbtn back" id="tv-back">← Back</button>
    <div class="tvtitle" id="tv-title">${title}</div>
    <button class="tvbtn print" id="tv-print">🖨️ Print</button>
  </div>${extra||''}`;
}
function tvRender(){
  const el=document.getElementById('tv-body'); if(!el) return;
  const V=TVS.view;
  let html='';
  if(V==='root')        html=tvRoot();
  else if(V==='cd')     html=tvCD();
  else if(V==='cred')   html=tvList('cred');
  else if(V==='deb')    html=tvList('deb');
  else if(V==='other')  html=tvOther();
  else if(V==='kbora'||V==='daal'||V==='roast') html=tvCatList(V);
  else if(V==='staff')  html=tvStaff();
  else if(V==='profile')html=tvProfile();
  else if(V==='mk')     html=tvMK();
  else if(V==='mkprod') html=tvMKProd();
  else if(V==='mkgadi') html=tvMKGadi();
  else if(V==='mkveh')  html=tvMKVeh();
  else if(V==='mkmm')   html=tvMKMaint();
  else if(V==='mkplant'||V==='mkoffice') html=tvMKPlace(V);
  el.innerHTML=html;
  tvWire(el);
}
function tvWire(el){
  const b=el.querySelector('#tv-back');  if(b) b.addEventListener('click',tvBack);
  const p=el.querySelector('#tv-print'); if(p) p.addEventListener('click',tvPrint);
  const t=el.querySelector('#tv-title'); if(t) t.addEventListener('click',tvTitleTap);
  const s=el.querySelector('#tv-search');
  if(s){ s.value=TVS.q; s.addEventListener('input',()=>{ TVS.q=s.value; tvRenderRowsOnly(); }); }
  el.querySelectorAll('[data-tvgo]').forEach(x=>x.addEventListener('click',()=>{
    TVS.from=TVS.view; TVS.view=x.dataset.tvgo; TVS.chip='all'; TVS.q=''; TVS.area=''; tvRender();
  }));
  el.querySelectorAll('[data-chip]').forEach(x=>x.addEventListener('click',()=>{
    TVS.chip=x.dataset.chip; TVS.area=''; tvRender();
  }));
  el.querySelectorAll('[data-area]').forEach(x=>x.addEventListener('click',()=>{ TVS.area=x.dataset.area; tvRenderRowsOnly(); }));
  el.querySelectorAll('[data-open]').forEach(x=>tvRowTaps(x));
  el.querySelectorAll('[data-mkitem]').forEach(x=>x.addEventListener('click',()=>tvMKEntry(x.dataset.mkitem,x.dataset.mkkind||'product')));
  el.querySelectorAll('[data-veh]').forEach(x=>x.addEventListener('click',()=>{ TVS.veh=x.dataset.veh; TVS.view='mkveh'; tvRender(); }));
  el.querySelectorAll('[data-scred]').forEach(x=>x.addEventListener('click',e=>{ e.stopPropagation(); tvStaffCredit(x.dataset.scred); }));
}
function tvRenderRowsOnly(){
  const box=document.getElementById('tv-rows'); if(!box){ tvRender(); return; }
  box.innerHTML=tvRowsHTML();
  box.querySelectorAll('[data-open]').forEach(x=>tvRowTaps(x));
  box.querySelectorAll('[data-area]').forEach(x=>x.addEventListener('click',()=>{ TVS.area=x.dataset.area; tvRenderRowsOnly(); }));
}
/* single tap = खोलो · double tap = limit set (debtor limit-cross में) · mobMode = mobile भरो */
function tvRowTaps(x){
  let tm=null, n=0;
  x.addEventListener('click',ev=>{
    ev.stopPropagation(); n++;
    clearTimeout(tm);
    tm=setTimeout(()=>{
      const key=x.dataset.open, kind=x.dataset.kind||'cred';
      if(n>=2 && kind==='deb'){ tvSetLimitPopup(key); }
      else if(TVS.mobMode){ tvMobPopup(key); }
      else { TVS.from=TVS.view; TVS.profile={key,kind}; TVS.view='profile'; tvRender(); }
      n=0;
    },260);
  });
}
/* title पर 3 बार click → Mobile add mode */
let tvTitleN=0, tvTitleTm=null;
function tvTitleTap(){
  if(!['cred','deb','other','kbora','daal','roast','staff'].includes(TVS.view)) return;
  tvTitleN++; clearTimeout(tvTitleTm);
  tvTitleTm=setTimeout(()=>{
    if(tvTitleN>=3){ TVS.mobMode=!TVS.mobMode; toast(TVS.mobMode?'📱 Mobile Add ON — नाम पर click करें':'Mobile Add OFF'); tvRender(); }
    tvTitleN=0;
  },420);
}
function tvMobPopup(key){
  const D=tvBuild(); const p=[...D.cred,...D.deb,...D.staff].find(x=>x.key===key)||{name:key};
  popup({ title:'📱 Mobile Number',
    body:`<div class="pp-note"><b>${tvE(p.name)}</b>${p.address?' ('+tvE(p.address)+')':''}</div>
      <div class="f-row"><label>Mob-</label><input type="tel" id="tv-mb" inputmode="numeric" maxlength="12" value="${tvE(tvMob(key))}" placeholder="10 अंक"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-mbs">✓ Save</button></div>`,
    onOpen(bk){ const i=bk.querySelector('#tv-mb'); i.focus();
      bk.querySelector('#tv-mbs').addEventListener('click',()=>{ tvSetMob(key,i.value.trim()); closePopup(); tvRefresh(); tvRender(); toast('Mobile save ✔'); }); }
  });
}

/* ---------- ROOT: दो option ---------- */
function tvRoot(){
  return tvHead(TV_TITLES.root)+`
  <div class="tv2">
    <button class="tvbig cd" data-tvgo="cd"><span class="bi">📒</span><b>C/D</b><small>Creditors &amp; Debtors</small></button>
    <button class="tvbig mk" data-tvgo="mk"><span class="bi">🏭</span><b>Mill खर्च</b><small>Product · गाडी · Maintenance</small></button>
  </div>`;
}
/* ---------- C/D ---------- */
function tvCD(){
  const D=tvBuild();
  const cT=D.cred.reduce((a,x)=>a+Math.max(0,x.bal),0), dT=D.deb.reduce((a,x)=>a+Math.max(0,x.bal),0);
  return tvHead(TV_TITLES.cd)+`
  <div class="tv2">
    <button class="tvbig cr" data-tvgo="cred"><span class="bi">🟥</span><b>Creditors</b><small>देना है ₹${tvF(cT)}</small></button>
    <button class="tvbig db" data-tvgo="deb"><span class="bi">🟩</span><b>Debtors</b><small>लेना है ₹${tvF(dT)}</small></button>
    <button class="tvbig ot" data-tvgo="other"><span class="bi">🟦</span><b>Other</b><small>Bora · Staff · Daal · Roast</small></button>
  </div>`;
}
/* ---------- chips + search + rows ---------- */
const TV_CHIPS = {
  cred:[{k:'all',t:'All',i:'📋',c:'c1'},{k:'give',t:'Give Due',i:'💸',c:'c2'},{k:'area',t:'Area',i:'📍',c:'c3'},{k:'d7',t:'7Days End',i:'⏰',c:'c4'}],
  deb :[{k:'all',t:'All',i:'📋',c:'c1'},{k:'due',t:'Due',i:'💰',c:'c2'},{k:'area',t:'Area',i:'📍',c:'c3'},{k:'limit',t:'Limit Cross',i:'🚨',c:'c4'}]
};
function tvList(kind){
  const chips=TV_CHIPS[kind].map(c=>`<button class="tvchip ${c.c} ${TVS.chip===c.k?'on':''}" data-chip="${c.k}"><span>${c.i}</span>${c.t}</button>`).join('');
  const D=tvBuild(); const arr=kind==='cred'?D.cred:D.deb;
  const tot=arr.reduce((a,x)=>a+Math.max(0,x.bal),0);
  return tvHead(kind==='cred'?TV_TITLES.cred:TV_TITLES.deb,`
    ${TVS.mobMode?'<div class="tvmob">📱 Mobile Add मोड ON — किसी नाम पर click कर के number भरें</div>':''}
    <div class="tvsearch"><span>🔍</span><input id="tv-search" placeholder="नाम लिखें — कुछ अक्षर काफ़ी हैं..."></div>
    <div class="tvchips">${chips}</div>
    <div class="tvsum"><div><small>कुल ${kind==='cred'?'देना':'लेना'}</small><b>₹${tvF(tot)}</b></div><div><small>Party</small><b>${arr.length}</b></div></div>
    <div class="tvcolh"><span class="cn">Sr · नाम (पता)</span><span class="cd">Due</span><span class="cp">Paid</span></div>`)
    +`<div id="tv-rows">${tvRowsHTML()}</div>`;
}
function tvFiltered(){
  const kind = TVS.view==='deb' ? 'deb' : 'cred';
  const D=tvBuild(); let arr = (kind==='deb'?D.deb:D.cred).slice();
  const q=tvK(TVS.q);
  if(q) arr=arr.filter(x=>x.key.includes(q)||tvK(x.address).includes(q)||(x.mob||'').includes(TVS.q.trim()));
  if(TVS.chip==='give'||TVS.chip==='due') arr=arr.filter(x=>x.bal>0);
  if(TVS.chip==='limit'){ arr=arr.filter(x=>x.openBills>tvLimit(x.key) && x.bal>0); }
  if(TVS.chip==='d7'){
    arr=arr.map(x=>{ const old=x.due.filter(d=>!d.cut&&d.final).map(d=>tvAge(d.date)).sort((a,b)=>b-a)[0]||0;
      return Object.assign({},x,{aged:old}); }).filter(x=>x.aged>=7 && x.bal>0).sort((a,b)=>b.aged-a.aged);
  }
  if(TVS.area) arr=arr.filter(x=>x.area===TVS.area);
  return arr;
}
function tvRowsHTML(){
  const kind = TVS.view==='deb' ? 'deb' : 'cred';
  if(TVS.chip==='area' && !TVS.area){
    const D=tvBuild(); const arr=kind==='deb'?D.deb:D.cred;
    const m={}; arr.forEach(x=>{ m[x.area]=m[x.area]||{n:0,rs:0}; m[x.area].n++; m[x.area].rs+=Math.max(0,x.bal); });
    const keys=Object.keys(m).sort();
    if(!keys.length) return `<div class="tvempty">— कोई data नहीं —</div>`;
    return `<div class="tvareas">${keys.map((k,i)=>`<button class="tvarea a${i%6}" data-area="${tvE(k)}"><b>${tvE(k)}</b><small>${m[k].n} party · ₹${tvF(m[k].rs)}</small></button>`).join('')}</div>`;
  }
  const arr=tvFiltered();
  if(!arr.length) return `<div class="tvempty">— कोई data नहीं —</div>`;
  return (TVS.area?`<div class="tvareatag">📍 ${tvE(TVS.area)} <button class="tvx" data-chip="area">✖</button></div>`:'')
   + arr.map((x,i)=>{
    const lim = kind==='deb' && x.openBills>tvLimit(x.key) && x.bal>0;
    const aged = x.aged||0;
    return `<div class="tvrow ${x.bal>0?'owe':''} ${lim?'lim':''}" data-open="${tvE(x.key)}" data-kind="${kind}">
      <div class="tvsr">${i+1}</div>
      <div class="tvnm"><b>${tvE(x.name)}</b>${x.address?`<i>(${tvE(x.address)})</i>`:''}
        <span class="tvmb">${x.mob?'mob- '+tvE(x.mob):'<em>mob- —</em>'}</span>
        <span class="tvtags">${x.openBills>0?`<span class="tg b">${x.openBills} receipt</span>`:''}${lim?`<span class="tg r">LIMIT ${tvLimit(x.key)}</span>`:''}${aged>=7?`<span class="tg o">${aged}d</span>`:''}</span></div>
      <div class="tvdue">${x.bal>0?'₹'+tvF(x.bal):'—'}${x.openBills>1?`<small>${x.openBills} receipt बाक़ी</small>`:''}</div>
      <div class="tvpaid">${x.bal<0?'₹'+tvF(-x.bal):'—'}${x.bal<0?'<small>advance</small>':''}</div>
    </div>`;
  }).join('') + `<div class="tvgt">Total Due <b>₹${tvF(arr.reduce((a,x)=>a+Math.max(0,x.bal),0))}</b> · दिया <b class="g">₹${tvF(arr.reduce((a,x)=>a+x.paidT,0))}</b></div>`;
}
function tvSetLimitPopup(key){
  const cur=tvLimit(key); const D=tvBuild(); const p=D.deb.find(x=>x.key===key)||{name:key};
  popup({ title:'🚨 Limit Set — '+tvE(p.name),
    body:`<div class="pp-note">कितने receipt तक <b>Limit Cross</b> में न दिखे — वह number भरें<br>अभी: <b>${cur}</b> receipt</div>
      <div class="f-row"><label>Receipt Limit</label><input type="number" id="tv-lm" inputmode="numeric" value="${cur}"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-lms">✓ Set</button></div>`,
    onOpen(bk){ bk.querySelector('#tv-lm').focus();
      bk.querySelector('#tv-lms').addEventListener('click',()=>{ tvSetLimit(key,Math.max(1,parseInt(bk.querySelector('#tv-lm').value)||2)); closePopup(); tvRender(); toast('Limit set ✔'); }); }
  });
}

/* ---------- PROFILE ---------- */
function tvProfile(){
  const {key,kind}=TVS.profile||{};
  const D=tvBuild();
  const p = (kind==='staff'? D.staff : kind==='deb'? D.deb : D.cred).find(x=>x.key===key);
  if(!p) return tvHead('👤 —')+`<div class="tvempty">नहीं मिला</div>`;
  const due=p.due.slice().sort((a,b)=>tvDV(b.date)-tvDV(a.date));
  const paid=p.paid.slice().sort((a,b)=>tvDV(b.date)-tvDV(a.date));
  const dueHTML = due.length? due.map(d=>`<div class="pfl ${d.cut?'cut':''}">
      <div class="pfa">₹${tvF(d.amt)}${d.final?'':' <em>?</em>'}</div>
      <div class="pfs">${d.rno?`<span class="rn">R.No ${tvE(d.rno)}</span>`:''}${d.label?`<span class="lb">${tvE(d.label)}</span>`:''}${d.items?`<span class="lb">${tvE(d.items)}</span>`:''}
        <span class="dt">📅 ${tvE(d.rdate||d.date)}</span>${d.qty?`<span class="qt">${tvF(d.qty)}${tvE(d.unit||'')}${d.rate?' × '+tvE(String(d.rate)):''}</span>`:''}${d.cut?'<span class="ct">✂ CUT</span>':''}</div>
    </div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  const paidHTML = paid.length? paid.map(d=>`<div class="pfl ${d.cut?'cut':''}">
      <div class="pfa g">₹${tvF(d.amt)}</div>
      <div class="pfs"><span class="dt">📅 ${tvE(d.date)}</span>${d.ts?`<span class="tm">🕐 ${tvE(d.ts)}</span>`:''}${d.mode?`<span class="lb">${tvE(d.mode)}</span>`:''}${d.item?`<span class="lb">${tvE(d.item)}</span>`:''}${d.cut?'<span class="ct">✂ CUT</span>':''}</div>
    </div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  return `<div class="tvhead">
      <button class="tvbtn back" id="tv-back">← Back</button>
      <div class="tvtitle pf"><b>${tvE(p.name)}</b>${p.address?`<i>(${tvE(p.address)})</i>`:''}<span class="pfmob">mob- ${tvE(p.mob||'—')}</span></div>
      <button class="tvbtn print" id="tv-print">🖨️ Print</button>
    </div>
    <div class="pfsum"><div class="r"><small>Total Due</small><b>₹${tvF(p.dueT!==undefined?p.dueT:0)}</b></div>
      <div class="g"><small>Total Paid</small><b>₹${tvF(p.paidT||0)}</b></div>
      <div class="${p.bal>0?'r':'g'}"><small>Balance</small><b>₹${tvF(Math.abs(p.bal))}</b></div></div>
    <div class="pfgrid">
      <div class="pfcol"><div class="pfh r">💸 DUE</div>${dueHTML}</div>
      <div class="pfline"></div>
      <div class="pfcol"><div class="pfh g">✅ PAID</div>${paidHTML}</div>
    </div>`;
}

/* ---------- OTHER ---------- */
function tvOther(){
  const D=tvBuild();
  const sum=(cat)=>D.cred.filter(x=>x.cats[cat]).reduce((a,x)=>a+Math.max(0,x.bal),0);
  const stT=D.staff.reduce((a,x)=>a+Math.max(0,x.bal),0);
  return tvHead(TV_TITLES.other)+`
  <div class="tv2 four">
    <button class="tvbig kb" data-tvgo="kbora"><span class="bi">🧺</span><b>कली बोरा (Cr)</b><small>₹${tvF(sum('bag'))}</small></button>
    <button class="tvbig st" data-tvgo="staff"><span class="bi">👷</span><b>Staff (Cr)</b><small>₹${tvF(stT)} · monthly</small></button>
    <button class="tvbig dl" data-tvgo="daal"><span class="bi">🥣</span><b>Daal (Cr)</b><small>₹${tvF(sum('daal'))}</small></button>
    <button class="tvbig ro" data-tvgo="roast"><span class="bi">🔥</span><b>Roast (Cr)</b><small>₹${tvF(sum('roast'))}</small></button>
  </div>`;
}
function tvCatList(v){
  const cat = v==='kbora'?'bag' : v==='daal'?'daal':'roast';
  const D=tvBuild();
  let arr=D.cred.filter(x=>x.cats[cat]);
  const q=tvK(TVS.q); if(q) arr=arr.filter(x=>x.key.includes(q)||tvK(x.address).includes(q));
  const rows = arr.length? arr.map((x,i)=>`<div class="tvrow ${x.bal>0?'owe':''}" data-open="${tvE(x.key)}" data-kind="cred">
      <div class="tvsr">${i+1}</div>
      <div class="tvnm"><b>${tvE(x.name)}</b>${x.address?`<i>(${tvE(x.address)})</i>`:''}<span class="tvmb">${x.mob?'mob- '+tvE(x.mob):'<em>mob- —</em>'}</span></div>
      <div class="tvdue">${x.bal>0?'₹'+tvF(x.bal):'—'}</div><div class="tvpaid">${x.bal<0?'₹'+tvF(-x.bal):'—'}</div></div>`).join('')
    : `<div class="tvempty">— माल आवत खाते में entry करें —</div>`;
  return tvHead(TV_TITLES[v],`
    ${TVS.mobMode?'<div class="tvmob">📱 Mobile Add मोड ON</div>':''}
    <div class="tvsearch"><span>🔍</span><input id="tv-search" placeholder="नाम search..."></div>
    <div class="tvcolh"><span class="cn">Sr · नाम (पता)</span><span class="cd">Due</span><span class="cp">Paid</span></div>`)
    +`<div id="tv-rows">${rows}</div>`;
}
/* ---------- STAFF (Cr) ---------- */
function tvStaff(){
  const D=tvBuild();
  let arr=D.staff; const q=tvK(TVS.q); if(q) arr=arr.filter(x=>x.key.includes(q));
  const mk=(()=>{ const d=new Date(); return `${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; })();
  const rows= arr.length? arr.map((x,i)=>`<div class="tvrow staff ${x.bal<0?'lim':''}" data-open="${tvE(x.key)}" data-kind="staff">
      <div class="tvsr">${i+1}</div>
      <div class="tvnm"><b>${tvE(x.name)}</b><i>(mill staff)</i><span class="tvmb">${x.mob?'mob- '+tvE(x.mob):'<em>mob- —</em>'}</span>
        <span class="tvtags">${x.carry>0?`<span class="tg o">carry ₹${tvF(x.carry)}</span>`:''}</span></div>
      <div class="tvdue">₹${tvF(x.dueT)}<small>लिया</small></div>
      <div class="tvpaid"><button class="crbtn" data-scred="${tvE(x.key)}">💰 ₹${tvF(x.credT)}</button><small>${tvE(mk)}</small></div>
    </div>`).join('') : `<div class="tvempty">— Attendance में नाम add करें —</div>`;
  return tvHead(TV_TITLES.staff,`
    ${TVS.mobMode?'<div class="tvmob">📱 Mobile Add मोड ON</div>':''}
    <div class="tvsearch"><span>🔍</span><input id="tv-search" placeholder="staff नाम search..."></div>
    <div class="pp-note tvnote">नगद नाम खाते से staff को दिया पैसा/सामान <b>Due</b> में · महीने के आख़िर में <b>Credit</b> भर के हिसाब करें</div>
    <div class="tvcolh"><span class="cn">Sr · नाम (mill staff)</span><span class="cd">Due (लिया)</span><span class="cp">Credit</span></div>`)
    +`<div id="tv-rows">${rows}</div>`;
}
function tvStaffCredit(key){
  const D=tvBuild(); const s=D.staff.find(x=>x.key===key); if(!s) return;
  const d=new Date(); const mk=`${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  const cur=tvN((s.cred||{})[mk]);
  popup({ title:'💰 '+tvE(s.name)+' — Monthly Credit',
    body:`<div class="pp-note">महीना <b>${mk}</b> · अब तक लिया <b class="rr">₹${tvF(s.dueT)}</b>${s.carry>0?` · पिछला carry <b>₹${tvF(s.carry)}</b>`:''}</div>
      <div class="f-row"><label>Month Salary ₹</label><input type="number" id="tv-sc" inputmode="decimal" value="${cur||''}" placeholder="जैसे 12000"></div>
      <div class="f-row"><label>बचा (देना)</label><div class="ro" id="tv-scb">₹0</div></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-scs">✓ हिसाब</button></div>`,
    onOpen(bk){
      const i=bk.querySelector('#tv-sc'), o=bk.querySelector('#tv-scb');
      const upd=()=>{ o.textContent='₹'+tvF(tvN(i.value)+s.carry-s.dueT); }; i.addEventListener('input',upd); upd(); i.focus();
      bk.querySelector('#tv-scs').addEventListener('click',()=>{
        const amt=tvN(i.value); if(amt<=0){ toast('Salary भरें'); return; }
        const all=tvJSON(TV_SCRED,{})||{}; all[key]=all[key]||{}; all[key][mk]=amt; tvSet(TV_SCRED,all);
        const net=amt+s.carry-s.dueT;
        closePopup(); tvRefresh(); tvStaffSettle(key,s.name,net);
      });
    }
  });
}
function tvStaffSettle(key,name,net){
  popup({ title:'🧾 '+tvE(name)+' — बचा ₹'+tvF(net),
    body:`<div class="pp-note">काट कर <b>₹${tvF(net)}</b> निकला — अब क्या करें?</div>
      <div class="print-choice">
        <button id="tv-nx" style="border-color:#f39c12;"><span class="pc-ico">➡️</span>Add Next Month<br><small style="color:#8a94a6">अगले महीने जोड़ें</small></button>
        <button id="tv-tg" style="border-color:#2ecc71;"><span class="pc-ico">💵</span>Total Give<br><small style="color:#8a94a6">नगद नाम खाते में entry</small></button>
      </div>`,
    foot:`<span></span><button class="pp-btn cancel" onclick="closePopup()">बाद में</button>`,
    onOpen(bk){
      bk.querySelector('#tv-nx').addEventListener('click',()=>{
        const c=tvJSON(TV_SCARRY,{})||{}; c[key]=net; tvSet(TV_SCARRY,c);
        closePopup(); tvRefresh(); tvRender(); toast('अगले महीने में जुड़ गया ➡️');
      });
      bk.querySelector('#tv-tg').addEventListener('click',()=>{
        if(net>0) tvPushNagad(name,'mill staff',net,'');
        const c=tvJSON(TV_SCARRY,{})||{}; c[key]=0; tvSet(TV_SCARRY,c);
        closePopup(); tvRefresh(); tvRender(); toast('नगद नाम खाते में ₹'+tvF(net)+' entry हुई ✔');
      });
    }
  });
}

/* =========================================================
   NOTEBOOK में entry डालना (Tally → Notebook sync)
========================================================= */
function tvNowTS(){ return new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }
function tvPushNB(section,rec){
  const d = (typeof DATE!=='undefined'? DATE : tvToday());
  const k='sg_nb_'+d;
  let db=tvJSON(k,null) || {opening:null,rokad:[],jama:[],maal:[],nagad:[],kharch:[],inhome:[],outhome:null,receipts:[],totals:null};
  if(!Array.isArray(db[section])) db[section]=[];
  rec.ts=rec.ts||tvNowTS(); rec.cut=false; rec.fromTally=true;
  db[section].push(rec);
  tvSet(k,db);
  try{ if(typeof DB!=='undefined' && typeof CUR_DATE!=='undefined' && CUR_DATE===d){ DB[section].push(rec); if(typeof renderAll==='function') renderAll(); } }catch(e){}
  tvRefresh();
}
function tvPushNagad(name,address,amount,item){ tvPushNB('nagad',{name,address:address||'',amount:tvN(amount),mode:'cash',item:item||'',serialRef:null}); }
function tvPushKharch(name,amount,extra){ tvPushNB('kharch',Object.assign({type:'mill',name,amount:tvN(amount)},extra||{})); }

/* =========================================================
   🏭 MILL खर्च
========================================================= */
function tvKharchAll(){
  const out=[];
  tvDates('sg_nb_').forEach(date=>{ const db=tvNB(date); if(!db) return;
    (db.kharch||[]).forEach(x=>{ if(!x.cut) out.push(Object.assign({date},x)); }); });
  return out;
}
function tvMK(){
  const K=tvKharchAll();
  const pT=K.filter(x=>x.mk==='product'||x.type==='mill').reduce((a,x)=>a+tvN(x.amount),0);
  const gT=K.filter(x=>x.type==='van'||x.mk==='gadi').reduce((a,x)=>a+tvN(x.amount),0);
  const mT=K.filter(x=>x.mk==='plant'||x.mk==='office').reduce((a,x)=>a+tvN(x.amount),0);
  return tvHead(TV_TITLES.mk)+`
  <div class="tv2">
    <button class="tvbig pr" data-tvgo="mkprod"><span class="bi">📦</span><b>Product</b><small>₹${tvF(pT)} · Loading/बिजली...</small></button>
    <button class="tvbig ga" data-tvgo="mkgadi"><span class="bi">🚐</span><b>गाडी</b><small>₹${tvF(gT)} · Fuel + Maintenance</small></button>
    <button class="tvbig mm" data-tvgo="mkmm"><span class="bi">🔧</span><b>Mill Maintenance</b><small>₹${tvF(mT)} · Plant / Office</small></button>
  </div>`;
}
function tvMKProd(){
  const items=tvProducts(); const K=tvKharchAll();
  const sumOf=n=>K.filter(x=>tvK(x.name)===tvK(n)).reduce((a,x)=>a+tvN(x.amount),0);
  let grand=0;
  const cards=items.map((n,i)=>{ const s=sumOf(n); grand+=s;
    return `<button class="mkc c${i%8}" data-mkitem="${tvE(n)}" data-mkkind="product"><span class="mki">${['🏋️','📤','🚚','⏱️','💡','🧰','📦','🔩'][i%8]}</span><b>${tvE(n)}</b><i>₹${tvF(s)}</i></button>`;
  }).join('');
  return tvHead(TV_TITLES.mkprod,`<div class="pp-note tvnote">🖱️ ऊपर <b>PRODUCT</b> title पर <b>3 बार</b> click → नया item add · किसी box पर click → अमाउंट भरें (नगद खर्च में अपने आप जाएगा)</div>`)
    +`<div class="mkgrid" id="tv-rows">${cards}</div>
      <div class="tvgt">Product कुल खर्च <b>₹${tvF(grand)}</b></div>`;
}
function tvMKGadi(){
  const K=tvKharchAll();
  const cards=TV_VEHICLES.map(v=>{
    const f=K.filter(x=>x.vehNo===v.no && x.mkSub==='fuel').reduce((a,x)=>a+tvN(x.amount),0);
    const m=K.filter(x=>x.vehNo===v.no && x.mkSub==='maint').reduce((a,x)=>a+tvN(x.amount),0);
    return `<button class="vehc" style="--vc:${v.col}" data-veh="${v.no}">
      <span class="vi">${v.icon}</span><b>${v.no}</b><i>${v.label}</i>
      <div class="vsum"><span class="f">⛽ ₹${tvF(f)}</span><span class="m">🔧 ₹${tvF(m)}</span></div></button>`;
  }).join('');
  return tvHead(TV_TITLES.mkgadi,`<div class="pp-note tvnote">Notebook के <b>नगद खर्च → वेन → ⛽ Fuel</b> से भी यही data जुड़ता है</div>`)
    +`<div class="vehgrid" id="tv-rows">${cards}</div>`;
}
function tvMKVeh(){
  const v=TV_VEHICLES.find(x=>x.no===TVS.veh)||TV_VEHICLES[0];
  const K=tvKharchAll().filter(x=>x.vehNo===v.no);
  const fuel=K.filter(x=>x.mkSub==='fuel'), maint=K.filter(x=>x.mkSub!=='fuel');
  const li=a=>a.length? a.map(x=>`<div class="pfl"><div class="pfa">₹${tvF(x.amount)}</div><div class="pfs"><span class="dt">📅 ${tvE(x.date)}</span>${x.ts?`<span class="tm">🕐 ${tvE(x.ts)}</span>`:''}${x.driver?`<span class="lb">${tvE(x.driver)}</span>`:''}${x.note?`<span class="lb">${tvE(x.note)}</span>`:''}</div></div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  return tvHead(`${v.icon} ${v.no}`,`<div class="vehbar" style="--vc:${v.col}">${v.label}
      <div class="vbtns"><button class="vb f" data-mkitem="${v.no}" data-mkkind="fuel">⛽ Fuel भरें</button>
      <button class="vb m" data-mkitem="${v.no}" data-mkkind="maint">🔧 Maintenance</button></div></div>`)
    +`<div class="pfgrid" id="tv-rows">
      <div class="pfcol"><div class="pfh b">⛽ FUEL — ₹${tvF(fuel.reduce((a,x)=>a+tvN(x.amount),0))}</div>${li(fuel)}</div>
      <div class="pfline"></div>
      <div class="pfcol"><div class="pfh o">🔧 MAINTENANCE — ₹${tvF(maint.reduce((a,x)=>a+tvN(x.amount),0))}</div>${li(maint)}</div>
    </div>`;
}
function tvMKMaint(){
  const K=tvKharchAll();
  const p=K.filter(x=>x.mk==='plant').reduce((a,x)=>a+tvN(x.amount),0);
  const o=K.filter(x=>x.mk==='office').reduce((a,x)=>a+tvN(x.amount),0);
  return tvHead(TV_TITLES.mkmm)+`<div class="tv2">
    <button class="tvbig pl" data-tvgo="mkplant"><span class="bi">🏭</span><b>Plant</b><small>₹${tvF(p)}</small></button>
    <button class="tvbig of" data-tvgo="mkoffice"><span class="bi">🏢</span><b>Office</b><small>₹${tvF(o)}</small></button>
  </div>`;
}
function tvMKPlace(v){
  const kind = v==='mkplant'?'plant':'office';
  const K=tvKharchAll().filter(x=>x.mk===kind);
  const tot=K.reduce((a,x)=>a+tvN(x.amount),0);
  const rows=K.length? K.slice().reverse().map((x,i)=>`<div class="tvrow"><div class="tvsr">${i+1}</div>
      <div class="tvnm"><b>${tvE(x.name)}</b><span class="tvmb">📅 ${tvE(x.date)} ${x.ts?'· 🕐 '+tvE(x.ts):''}</span></div>
      <div class="tvdue">₹${tvF(x.amount)}</div><div class="tvpaid">—</div></div>`).join('') : `<div class="tvempty">— कोई खर्च नहीं —</div>`;
  return tvHead(TV_TITLES[v],`<button class="tvadd" data-mkitem="${kind}" data-mkkind="place">➕ नया ${kind==='plant'?'Plant':'Office'} खर्च</button>`)
    +`<div id="tv-rows">${rows}</div><div class="tvgt">${kind==='plant'?'Plant':'Office'} कुल <b>₹${tvF(tot)}</b></div>`;
}
/* अमाउंट भरने का popup — सब जगह एक ही */
function tvMKEntry(item,kind){
  const isVeh = kind==='fuel'||kind==='maint';
  const isPlace = kind==='place';
  const v = isVeh? TV_VEHICLES.find(x=>x.no===item) : null;
  const title = isVeh ? `${v.icon} ${item} — ${kind==='fuel'?'⛽ Fuel':'🔧 Maintenance'}`
              : isPlace ? `${item==='plant'?'🏭 Plant':'🏢 Office'} खर्च`
              : `📦 ${item} — अमाउंट`;
  popup({ title,
    body:`<div class="pp-note">भरते ही यह <b>नगद खर्च → Mill खर्च</b> (notebook) और <b>S.Book</b> में अपने आप चला जाएगा</div>
      ${isPlace||isVeh?`<div class="f-row"><label>${isVeh?'नोट / Driver':'खर्च का नाम'}</label><input type="text" id="tv-mkn" placeholder="${isVeh?'(optional)':'जैसे मोटर रिपेयर'}"></div>`:''}
      <div class="f-row"><label>अमाउंट ₹</label><input type="number" id="tv-mka" inputmode="decimal" placeholder="0"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-mks">✓ Save</button></div>`,
    onOpen(bk){
      const a=bk.querySelector('#tv-mka'); a.focus();
      bk.querySelector('#tv-mks').addEventListener('click',()=>{
        const amt=tvN(a.value); if(amt<=0){ toast('अमाउंट भरें'); return; }
        const nEl=bk.querySelector('#tv-mkn'); const note=nEl?nEl.value.trim():'';
        if(isVeh){
          tvPushNB('kharch',{type:'van', name:`${item} ${kind==='fuel'?'(Fuel)':'(Maintenance)'}${note?' '+note:''}`,
            amount:amt, vehNo:item, mkSub:kind, mk:'gadi', driver:note});
        }else if(isPlace){
          if(!note){ toast('खर्च का नाम भरें'); return; }
          tvPushKharch(`${item==='plant'?'Plant':'Office'} — ${note}`, amt, {mk:item, mkSub:'maint'});
        }else{
          tvPushKharch(item, amt, {mk:'product'});
        }
        closePopup(); tvRefresh(); tvRender(); toast('✔ नगद खर्च में जुड़ गया');
      });
    }
  });
}
/* PRODUCT title 3-tap → नया item */
(function(){
  let n=0,tm=null;
  document.addEventListener('click',e=>{
    const t=e.target.closest('#tv-title'); if(!t) return;
    if(TVS.view!=='mkprod') return;
    n++; clearTimeout(tm);
    tm=setTimeout(()=>{ if(n>=3) tvNewProduct(); n=0; },420);
  });
})();
function tvNewProduct(){
  popup({ title:'➕ नया Product Item',
    body:`<div class="pp-note">यह item यहाँ भी दिखेगा और इसमें भरा अमाउंट <b>नगद खर्च → Mill खर्च</b> में जाएगा</div>
      <div class="f-row"><label>Item नाम</label><input type="text" id="tv-np" placeholder="जैसे पानी बिल"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-nps">✓ Add</button></div>`,
    onOpen(bk){ bk.querySelector('#tv-np').focus();
      bk.querySelector('#tv-nps').addEventListener('click',()=>{
        const v=bk.querySelector('#tv-np').value.trim(); if(!v){ toast('नाम भरें'); return; }
        tvAddProduct(v); closePopup(); tvRender(); toast(v+' add ✔');
      }); }
  });
}

/* =========================================================
   PRINT
========================================================= */
function tvPrint(){
  const el=document.getElementById('tv-body'); if(!el) return;
  const clone=el.cloneNode(true);
  clone.querySelectorAll('.tvhead,.tvsearch,.tvchips,.tvadd,.vbtns,.tvmob,.tvnote').forEach(x=>x.remove());
  const title = TVS.view==='profile' ? (function(){ const p=TVS.profile; const D=tvBuild();
      const o=(p.kind==='staff'?D.staff:p.kind==='deb'?D.deb:D.cred).find(x=>x.key===p.key)||{};
      return `${o.name||''} ${o.address?'('+o.address+')':''}`; })() : (TV_TITLES[TVS.view]||'TALLY');
  const html=`<div style="background:#fff;color:#000;padding:10px 12px;font-family:'Poppins','Noto Sans Devanagari',sans-serif;">
    <div style="text-align:center;font-weight:900;font-size:19px;">SATYAM FOOD PRODUCT</div>
    <div style="text-align:center;font-size:12.5px;font-weight:700;margin-bottom:8px;">${tvE(title)} — ${tvE(typeof DATE!=='undefined'?DATE:tvToday())}</div>
    ${clone.innerHTML}</div>`;
  if(typeof printDocument==='function') printDocument(html,{landscape:false,stretch:true,grow:true});
}

/* =========================================================
   HOOK — go('tally')
========================================================= */
(function(){
  const _go=window.go;
  window.go=function(n){ _go(n); if(n==='tally'){ TVS.view='root'; TVS.q=''; TVS.chip='all'; TVS.area=''; tvRefresh(); tvRender(); } };
})();
window.renderTally=function(){ tvRefresh(); tvRender(); };
window.tvRefresh=tvRefresh;
