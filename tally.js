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
const TV_MAN    = 'sg_tv_manual';      // manual Debtor/Creditor parties
function tvMob(k){ return (tvJSON(TV_MOB,{})||{})[k]||''; }
function tvSetMob(k,v){ const m=tvJSON(TV_MOB,{})||{}; if(v) m[k]=v; else delete m[k]; tvSet(TV_MOB,m); }
function tvLimit(k){ const l=tvJSON(TV_LIMIT,{})||{}; return tvN(l[k])||2; }
function tvSetLimit(k,v){ const l=tvJSON(TV_LIMIT,{})||{}; l[k]=v; tvSet(TV_LIMIT,l); }

const TV_PROD_DEFAULT = ['Loading','Unloading','भाड़ा (Bhara)','Overtime','बिजली बिल'];
function tvProducts(){ const p=tvArr(TV_PROD); return p.length? p : TV_PROD_DEFAULT.slice(); }
function tvAddProduct(n){ n=(/e-?rikshaw|ई.?रिक्शा/i.test(String(n||''))?'भाड़ा (Bhara)':n); const p=tvProducts(); if(!p.includes(n)) p.push(n); tvSet(TV_PROD,p); }

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
      const ov=(m.tvAmt!==undefined&&m.tvAmt!==null)?tvN(m.tvAmt):null;
      c.due.push({date, amt:(ov!==null?ov:A.amt), cut:!!m.cut||!!m.tvCut, final:A.final, cat, sub:m.sub||'',
        src:'maal', sdate:date, sidx:mi, oldAmt:(m.tvAmtOld!==undefined?tvN(m.tvAmtOld):null), ets:m.tvEts||'', edate:m.tvEdate||'',
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
    tvArr('sg_arcpt_'+date).forEach((r,ri)=>{
      /* ⚠️ हमेशा English नाम/पता — notebook में English ही लिखा जाता है, वरना दो debtors बन जाते हैं */
      const nm=r.name||r.nameHi; if(!nm) return;
      const d=C(deb,nm,r.address||r.addressHi); if(!d) return;
      const ov=(r.tvAmt!==undefined&&r.tvAmt!==null)?tvN(r.tvAmt):null;
      d.due.push({date, amt:(ov!==null?ov:tvN(r.total)), cut:!!r.cancelled||!!r.tvCut, rno:String(r.no||''), ts:r.ts||'',
        src:'arcpt', sdate:date, sidx:ri, oldAmt:(r.tvAmtOld!==undefined?tvN(r.tvAmtOld):null), ets:r.tvEts||'', edate:r.tvEdate||'',
        rdate:r.dateStr||date, items:(r.items||[]).map(x=>`${x.name} ${x.qty}`).join(', '), final:true});
    });
  });

  /* --- Manual Debtor / Creditor entries --- */
  tvArr(TV_MAN).forEach((p,pi)=>{
    const map = p.kind==='deb' ? deb : cred;
    const o = C(map, p.name, p.address); if(!o) return;
    if(p.mob && !tvMob(o.key)) tvSetMob(o.key, p.mob);
    if(tvN(p.due)>0)  o.due .push({date:p.date||tvToday(), amt:tvN(p.due),  final:true, manual:true, ts:p.ts||'', label:p.note||'Manual',
      src:'man', sidx:pi, cut:!!p.tvCut, oldAmt:(p.tvAmtOld!==undefined?tvN(p.tvAmtOld):null), ets:p.tvEts||'', edate:p.tvEdate||''});
    if(tvN(p.paid)>0) o.paid.push({date:p.date||tvToday(), amt:tvN(p.paid), manual:true, ts:p.ts||'', mode:p.mode||'Cash'});
    o.manual=true;
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
  other:'🟦 OTHER', kbora:'🧺 KHALI BORA (Cr)', staff:'👷 STAFF (Cr)',
  daal:'🥣 DAAL (Cr)', roast:'🔥 ROAST (Cr)', profile:'👤 PROFILE',
  mk:'🏭 MILL खर्च', mkprod:'📦 PRODUCT', mkgadi:'🚐 गाडी', mkmm:'🔧 MILL MAINTENANCE',
  mkveh:'🚗 गाडी', mkplant:'🏭 PLANT', mkoffice:'🏢 OFFICE', mkitem:'📦 ITEM'
};
function tvBack(){
  const b={cd:'root',cred:'cd',deb:'cd',other:'cd',kbora:'other',staff:'other',daal:'other',roast:'other',
    mk:'root',mkprod:'mk',mkgadi:'mk',mkmm:'mk',mkveh:'mkgadi',mkplant:'mkmm',mkoffice:'mkmm',mkitem:'mkprod'};
  if(TVS.view==='profile'){ TVS.view=TVS.from||'cred'; TVS.profile=null; TVS.payMode=null; }
  else if(TVS.view==='root'){ go('home'); return; }
  else TVS.view = b[TVS.view]||'root';
  TVS.q=''; TVS.area=''; TVS.mobMode=false; TVS.payMode=null; tvRender();
}

/* =========================================================
   RENDER
========================================================= */
function tvHead(title,extra,addBtn){
  return `<div class="tvhead">
    <button class="tvbtn back" id="tv-back">← Back</button>
    <div class="tvtitle" id="tv-title">${title}</div>
    ${addBtn||''}
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
  else if(V==='mkitem') html=tvMKItem();
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
    TVS.from=TVS.view; TVS.view=x.dataset.tvgo; TVS.chip='all'; TVS.q=''; TVS.area=''; TVS.mobMode=false; tvRender();
  }));
  el.querySelectorAll('[data-chip]').forEach(x=>x.addEventListener('click',()=>{
    TVS.chip=x.dataset.chip; TVS.area=''; tvRender();
  }));
  el.querySelectorAll('[data-area]').forEach(x=>x.addEventListener('click',()=>{ TVS.area=x.dataset.area; tvRenderRowsOnly(); }));
  el.querySelectorAll('[data-open]').forEach(x=>tvRowTaps(x));
  el.querySelectorAll('[data-mkitem]').forEach(x=>x.addEventListener('click',()=>tvMKEntry(x.dataset.mkitem,x.dataset.mkkind||'product')));
  el.querySelectorAll('[data-mkopen]').forEach(x=>x.addEventListener('click',()=>{ TVS.mkitem=x.dataset.mkopen; TVS.view='mkitem'; tvRender(); }));
  const ma=el.querySelector('#tv-addparty'); if(ma) ma.addEventListener('click',()=>tvManualParty(TVS.view==='deb'?'deb':'cred'));
  const pb=el.querySelector('#tv-paidmode'); if(pb) tvPaidModeTaps(pb);
  el.querySelectorAll('[data-pay]').forEach(x=>x.addEventListener('click',()=>tvPayEntry(x.dataset.pay)));
  el.querySelectorAll('[data-dueedit]').forEach(x=>tvDueTaps(x));
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
  return tvHead(kind==='cred'?TV_TITLES.cred:TV_TITLES.deb,`
    ${TVS.mobMode?'<div class="tvmob">📱 Mobile Add मोड ON — किसी नाम पर click कर के number भरें</div>':''}
    <div class="tvsearch"><span>🔍</span><input id="tv-search" placeholder="नाम लिखें — कुछ अक्षर काफ़ी हैं..."></div>
    <div class="tvchips">${chips}</div>
    <div class="tvcolh"><span class="cn">Sr · नाम (पता)</span><span class="cd">Due</span><span class="cp">Paid</span></div>`,
    `<button class="tvbtn add" id="tv-addparty">➕ नया ${kind==='cred'?'Creditor':'Debtor'}</button>`)
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
  TVS.dueList=due;
  const paid=p.paid.slice().sort((a,b)=>tvDV(b.date)-tvDV(a.date));
  const dueHTML = due.length? due.map((d,di)=>`<div class="pfl ${d.cut?'cut':''}" ${d.src?`data-dueedit="${di}"`:''} title="बदलने के लिए 3 बार click करें">
      <div class="pfa">${(d.oldAmt!==null&&d.oldAmt!==undefined&&d.oldAmt!==d.amt)?`<span class="pfold">₹${tvF(d.oldAmt)}</span> `:''}₹${tvF(d.amt)}${d.final?'':' <em>?</em>'}</div>
      <div class="pfs">${d.rno?`<span class="rn">R.No ${tvE(d.rno)}</span>`:''}${d.label?`<span class="lb">${tvE(d.label)}</span>`:''}${d.items?`<span class="lb">${tvE(d.items)}</span>`:''}
        <span class="dt">📅 ${tvE(d.rdate||d.date)}</span>${d.qty?`<span class="qt">${tvF(d.qty)}${tvE(d.unit||'')}${d.rate?' × '+tvE(String(d.rate)):''}</span>`:''}${d.cut?'<span class="ct">✂ CUT</span>':''}${d.ets?`<span class="tm">✏️ ${tvE(d.ets)}${d.edate?' · 📅 '+tvE(d.edate):''}</span>`:''}</div>
    </div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  const paidHTML = paid.length? paid.map(d=>`<div class="pfl ${d.cut?'cut':''}">
      <div class="pfa g">₹${tvF(d.amt)}</div>
      <div class="pfs"><span class="dt">📅 ${tvE(d.date)}</span>${d.ts?`<span class="tm">🕐 ${tvE(d.ts)}</span>`:''}${d.mode?`<span class="lb">${tvE(d.mode)}</span>`:''}${d.item?`<span class="lb">${tvE(d.item)}</span>`:''}${d.cut?'<span class="ct">✂ CUT</span>':''}</div>
    </div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  const payOn = TVS.payMode===key;
  return `<div class="tvhead">
      <button class="tvbtn back" id="tv-back">← Back</button>
      <div class="tvtitle pf"><b>${tvE(p.name)}</b>${p.address?`<i>(${tvE(p.address)})</i>`:''}<span class="pfmob">mob- ${tvE(p.mob||'—')}</span></div>
      ${kind!=='staff'?`<button class="tvbtn ${payOn?'paidon':'paid'}" id="tv-paidmode">${payOn?'🔓 PAID':'💵 PAID'}</button>`:''}
      <button class="tvbtn print" id="tv-print">🖨️ Print</button>
    </div>
    ${payOn?`<div class="tvpaybar">🔓 Paid mode ON — सिर्फ़ <b>${tvE(p.name)}</b> के लिए
      <button class="pb g" data-pay="${tvE(key)}">💵 Paid entry</button></div>`:''}
    <div class="pfsum"><div class="r"><small>Total Due</small><b>₹${tvF(p.dueT!==undefined?p.dueT:0)}</b></div>
      <div class="g"><small>Total Paid</small><b>₹${tvF(p.paidT||0)}</b></div>
      <div class="${p.bal>0?'r':'g'}"><small>Balance</small><b>₹${tvF(Math.abs(p.bal))}</b></div></div>
    <div class="pfgrid">
      <div class="pfcol"><div class="pfh r">💸 DUE</div>${dueHTML}</div>
      <div class="pfline"></div>
      <div class="pfcol"><div class="pfh g">✅ PAID</div>${paidHTML}</div>
    </div>`;
}

/* =========================================================
   ➕ MANUAL Debtor / Creditor entry
========================================================= */
function tvManualParty(kind){
  popup({ title:(kind==='deb'?'🟩 नया Debtor':'🟥 नया Creditor')+' — Manual entry',
    body:`<div class="pp-note">नाम · पता · मोबाइल भरें — <b>Due</b> या <b>Paid</b> में से जो भरना हो भरें (time stamp अपने आप 🕐)</div>
      <div class="f-row"><label>नाम</label><input type="text" id="tv-mn" autocomplete="off"></div>
      <div class="f-row"><label>पता</label><input type="text" id="tv-ma"></div>
      <div class="f-row"><label>Mobile</label><input type="tel" id="tv-mm" inputmode="numeric" maxlength="12"></div>
      <div class="f-row"><label>Due ₹ (${kind==='deb'?'लेना':'देना'})</label><input type="number" id="tv-md" inputmode="decimal" placeholder="0"></div>
      <div class="f-row"><label>Paid ₹ (${kind==='deb'?'मिला':'दिया'})</label><input type="number" id="tv-mp" inputmode="decimal" placeholder="0"></div>
      <div class="f-row"><label>नोट</label><input type="text" id="tv-mno" placeholder="(optional)"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-ms">✓ Save</button></div>`,
    onOpen(bk){
      const nm=bk.querySelector('#tv-mn'); nm.focus();
      if(typeof sgSuggest==='function') sgSuggest(nm, bk.querySelector('#tv-ma'));
      bk.querySelector('#tv-ms').addEventListener('click',()=>{
        const name=nm.value.trim(); if(!name){ toast('नाम भरें'); return; }
        const rec={kind, name, address:bk.querySelector('#tv-ma').value.trim(), mob:bk.querySelector('#tv-mm').value.trim(),
          due:tvN(bk.querySelector('#tv-md').value), paid:tvN(bk.querySelector('#tv-mp').value),
          note:bk.querySelector('#tv-mno').value.trim(), date:tvToday(), ts:tvNowTS(), t:Date.now()};
        const all=tvArr(TV_MAN); all.push(rec); tvSet(TV_MAN,all);
        if(rec.mob) tvSetMob(tvK(name), rec.mob);
        if(typeof logChange==='function') logChange({sec:(kind==='deb'?'Debtors':'Creditors'), what:'Manual party add', name, neu:(rec.due||rec.paid), note:rec.address});
        closePopup(); tvRefresh(); tvRender(); toast('✔ '+name+' add हो गया');
      });
    }
  });
}

/* =========================================================
   💵 PAID MODE — profile में PAID पर 3 बार click → password
   password = customer के नाम का पहला अक्षर (small/CAPITAL) + अभी का घंटा
========================================================= */
function tvPaidModeTaps(el){
  let n=0,tm=null;
  el.addEventListener('click',()=>{
    n++; clearTimeout(tm);
    tm=setTimeout(()=>{ if(n>=3) tvPaidUnlock(); n=0; },420);
  });
}
function tvPaidUnlock(){
  const {key,kind}=TVS.profile||{}; if(!key) return;
  const D=tvBuild();
  const p=(kind==='staff'?D.staff:kind==='deb'?D.deb:D.cred).find(x=>x.key===key); if(!p) return;
  const first=String(p.name||'').trim().charAt(0);
  const dt=new Date(); let hr12=dt.getHours()%12; if(hr12===0) hr12=12;
  const dd=String(dt.getDate()).padStart(2,'0');
  popup({ title:'🔐 Paid Mode — Password',
    body:`<div class="f-row"><label>Password</label><input type="text" id="tv-pw" autocomplete="off" placeholder="—"></div>
      <div id="tv-pwe" style="display:none;color:#c0392b;font-weight:800;font-size:13px;margin-top:4px;"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-pwg">🔓 Open</button></div>`,
    onOpen(bk){
      const i=bk.querySelector('#tv-pw'); i.focus();
      const go=()=>{
        const v=String(i.value||'').trim();
        /* password = नाम का पहला अक्षर (small/CAPITAL) + अभी का घंटा + आज की तारीख़ */
        const ok=[first.toLowerCase(),first.toUpperCase()].some(c=>
          v===c+String(hr12)+dd || v===c+String(hr12).padStart(2,'0')+dd);
        if(!ok){ const e=bk.querySelector('#tv-pwe'); e.style.display='block'; e.textContent='❌ ग़लत password'; return; }
        TVS.payMode=key; closePopup(); tvRender(); toast('🔓 Paid mode ON — '+p.name);
      };
      bk.querySelector('#tv-pwg').addEventListener('click',go);
      i.addEventListener('keydown',ev=>{ if(ev.key==='Enter') go(); });
    }
  });
}
/* Paid entry → notebook: Debtor = जमा नाम खाते · Creditor = नगद नाम खाते */
function tvPayEntry(key){
  const kind=(TVS.profile||{}).kind||'cred';
  const D=tvBuild();
  const p=(kind==='staff'?D.staff:kind==='deb'?D.deb:D.cred).find(x=>x.key===key); if(!p) return;
  const toWhere = kind==='deb' ? 'जमा नाम खाते' : 'नगद नाम खाते';
  popup({ title:'💵 '+tvE(p.name)+' — Paid',
    body:`<div class="pp-note">भरते ही सीधे notebook के <b>${toWhere}</b> में चला जाएगा 🪄<br>
        बाक़ी अभी: <b class="rr">₹${tvF(Math.max(0,p.bal))}</b></div>
      <div class="f-row"><label>Amount ₹</label><input type="number" id="tv-pa" inputmode="decimal" placeholder="0"></div>
      ${kind==='deb'?`<div class="f-row"><label>Mode</label><select id="tv-pm"><option value="cash">💵 Cash</option><option value="online">🏦 A/C</option></select></div>`:''}
      <div class="f-row"><label>नोट</label><input type="text" id="tv-pn" placeholder="(optional)"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-ps">✓ Paid</button></div>`,
    onOpen(bk){
      const a=bk.querySelector('#tv-pa'); a.focus();
      bk.querySelector('#tv-ps').addEventListener('click',()=>{
        const amt=tvN(a.value); if(amt<=0){ toast('Amount भरें'); return; }
        const note=bk.querySelector('#tv-pn').value.trim();
        if(kind==='deb'){
          const md=bk.querySelector('#tv-pm').value;
          tvPushNB('jama',{name:p.name,address:p.address||'',amount:amt,online:md==='online'?amt:0,item:note});
        }else{
          tvPushNB('nagad',{name:p.name,address:p.address||'',amount:amt,mode:'cash',item:note,serialRef:null});
        }
        if(typeof logChange==='function') logChange({sec:(kind==='deb'?'Debtors → जमा नाम खाते':'Creditors → नगद नाम खाते'),
          what:'Paid', name:p.name, old:Math.max(0,p.bal), neu:amt, note:note});
        closePopup(); tvRefresh(); tvRender(); toast('✔ '+toWhere+' में ₹'+tvF(amt)+' गया');
      });
    }
  });
}
/* =========================================================
   ✏️ DUE line — 3 बार click → amount बदलें / काटें
   पुराना amount कट कर दिखेगा · time stamp · back-date हो तो date भी
========================================================= */
function tvDueTaps(x){
  let n=0,tm=null;
  x.addEventListener('click',ev=>{
    ev.stopPropagation(); n++; clearTimeout(tm);
    tm=setTimeout(()=>{ if(n>=3) tvDueLineEdit(+x.dataset.dueedit); n=0; },420);
  });
}
/* आज की तारीख़ न हो (back-date में काम कर रहे हैं) तो date भी stamp होगी */
function tvStampDate(){ const d=(typeof DATE!=='undefined'? DATE : tvToday()); return d===tvToday()? '' : d; }
function tvDueSrc(d){
  if(d.src==='maal'){ const k='sg_nb_'+d.sdate; const db=tvJSON(k,null); if(!db||!Array.isArray(db.maal)) return null;
    return {get:()=>db.maal[d.sidx], save:()=>tvSet(k,db)}; }
  if(d.src==='arcpt'){ const k='sg_arcpt_'+d.sdate; const a=tvArr(k); if(!a[d.sidx]) return null;
    return {get:()=>a[d.sidx], save:()=>tvSet(k,a)}; }
  if(d.src==='man'){ const a=tvArr(TV_MAN); if(!a[d.sidx]) return null;
    return {get:()=>a[d.sidx], save:()=>tvSet(TV_MAN,a)}; }
  return null;
}
function tvDueLineEdit(di){
  const d=(TVS.dueList||[])[di]; if(!d) return;
  const S=tvDueSrc(d); if(!S){ toast('यह entry बदली नहीं जा सकती'); return; }
  const kind=(TVS.profile||{}).kind||'cred';
  const base=(d.oldAmt!==null&&d.oldAmt!==undefined)? d.oldAmt : d.amt;
  popup({ title:'✏️ Due — Amount बदलें / काटें',
    body:`<div class="pp-note">📅 ${tvE(d.rdate||d.date)}${d.rno?' · R.No '+tvE(d.rno):''}<br>
        पहला amount <b>₹${tvF(base)}</b> — बदलेंगे तो पुराना <b>कट कर</b> दिखेगा + time stamp आएगा${tvStampDate()?'<br>⚠️ पिछली तारीख़ में काम हो रहा है — time के साथ <b>date</b> भी दिखेगी':''}</div>
      <div class="f-row"><label>नया Amount ₹</label><input type="number" id="tv-de" inputmode="decimal" value="${Math.round(d.amt)}"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;">
      <button class="pp-btn cancel" id="tv-dcut">${d.cut?'↩️ वापस लाएँ':'✂ काटें'}</button>
      <button class="pp-btn cancel" onclick="closePopup()">Cancel</button>
      <button class="pp-btn save" id="tv-des">✓ Save</button></div>`,
    onOpen(bk){
      const i=bk.querySelector('#tv-de'); i.focus();
      const stampIt=(o)=>{ o.tvEts=tvNowTS(); const sd=tvStampDate(); if(sd) o.tvEdate=sd; else delete o.tvEdate; };
      bk.querySelector('#tv-dcut').addEventListener('click',()=>{
        const o=S.get(); o.tvCut=!d.cut; stampIt(o); S.save();
        if(typeof logChange==='function') logChange({sec:(kind==='deb'?'Debtors':'Creditors'), what:(o.tvCut?'Due काटा ✂':'Due वापस'), name:(TVS.profile||{}).key||'', old:d.amt, neu:(o.tvCut?0:d.amt)});
        closePopup(); tvRefresh(); tvRender(); toast(o.tvCut?'✂ Due काट दिया':'↩️ वापस आ गया');
      });
      bk.querySelector('#tv-des').addEventListener('click',()=>{
        const nw=tvN(i.value); if(nw<0){ toast('सही amount भरें'); return; }
        if(Math.abs(nw-d.amt)<0.01){ toast('कोई बदलाव नहीं'); return; }
        const o=S.get();
        if(o.tvAmtOld===undefined||o.tvAmtOld===null) o.tvAmtOld=base;
        o.tvAmt=nw; stampIt(o); S.save();
        if(typeof logChange==='function') logChange({sec:(kind==='deb'?'Debtors':'Creditors'), what:'Due amount बदला', name:(TVS.profile||{}).key||'', old:d.amt, neu:nw, note:(o.tvEdate?('date '+o.tvEdate):'')});
        closePopup(); tvRefresh(); tvRender(); toast('✔ Due update — हर जगह बदल गया');
      });
    }
  });
}

/* Due बदलना (manual adjust) — record book के change log में save */
function tvDueChange(key){
  const kind=(TVS.profile||{}).kind||'cred';
  const D=tvBuild(); const p=(kind==='deb'?D.deb:D.cred).find(x=>x.key===key); if(!p) return;
  popup({ title:'✏️ '+tvE(p.name)+' — Due बदलें',
    body:`<div class="pp-note">अभी Due: <b>₹${tvF(Math.max(0,p.bal))}</b> — नया Due भरें (फ़र्क़ manual entry बन जाएगा और <b>Change Record</b> में save होगा)</div>
      <div class="f-row"><label>नया Due ₹</label><input type="number" id="tv-dc" inputmode="decimal" value="${Math.max(0,Math.round(p.bal))}"></div>
      <div class="f-row"><label>कारण</label><input type="text" id="tv-dr" placeholder="जैसे rate गलत था"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="tv-dcs">✓ Save</button></div>`,
    onOpen(bk){
      bk.querySelector('#tv-dc').focus();
      bk.querySelector('#tv-dcs').addEventListener('click',()=>{
        const nw=tvN(bk.querySelector('#tv-dc').value), old=Math.max(0,p.bal);
        const diff=nw-old; if(Math.abs(diff)<0.01){ toast('कोई बदलाव नहीं'); return; }
        const reason=bk.querySelector('#tv-dr').value.trim();
        const all=tvArr(TV_MAN);
        all.push({kind:(kind==='deb'?'deb':'cred'), name:p.name, address:p.address||'', mob:p.mob||'',
          due: diff>0? diff:0, paid: diff<0? -diff:0, note:'Due बदला — '+(reason||'manual'),
          date:tvToday(), ts:tvNowTS(), t:Date.now(), adj:true});
        tvSet(TV_MAN,all);
        if(typeof logChange==='function') logChange({sec:(kind==='deb'?'Debtors':'Creditors'), what:'Due बदला', name:p.name, old, neu:nw, note:reason});
        closePopup(); tvRefresh(); tvRender(); toast('✔ Due update — Change Record में save');
      });
    }
  });
}
window.tvDueChange=tvDueChange;

/* ---------- OTHER ---------- */
function tvOther(){
  const D=tvBuild();
  const sum=(cat)=>D.cred.filter(x=>x.cats[cat]).reduce((a,x)=>a+Math.max(0,x.bal),0);
  const stT=D.staff.reduce((a,x)=>a+Math.max(0,x.bal),0);
  return tvHead(TV_TITLES.other)+`
  <div class="tv2 four">
    <button class="tvbig kb" data-tvgo="kbora"><span class="bi">🧺</span><b>खाली बोरा (Cr)</b><small>₹${tvF(sum('bag'))}</small></button>
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
  let db=tvJSON(k,null) || {opening:null,rokad:[],jama:[],maal:[],nagad:[],kharch:[],inhome:[],outhome:[],receipts:[],totals:null};
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
    (db.kharch||[]).forEach((x,i)=>{ if(!x.cut) out.push(Object.assign({date,idx:i},x)); }); });
  return out;
}
/* notebook की हर नगद खर्च entry किस PRODUCT category में जाएगी */
const TV_PROD_FIX = ['Loading','Unloading','भाड़ा (Bhara)','Overtime','बिजली बिल','गाडी खर्च (Daily)','Labour','Mill खर्च'];
/* E-Rikshaw अलग item नहीं बनेगा — भाड़ा (Bhara) में ही जाएगा */
function tvBharaFix(c){ return /e-?rikshaw|ई.?रिक्शा/i.test(String(c||'')) ? 'भाड़ा (Bhara)' : c; }
function tvProdCat(x){
  if(x.mkCat) return tvBharaFix(x.mkCat);
  if(x.type==='labour') return 'Labour';
  if(x.type==='van' || x.mk==='gadi'){ return x.mkSub==='fuel' ? '' : 'गाडी खर्च (Daily)'; }  /* fuel सिर्फ़ गाडी में */
  if(x.mk==='plant'||x.mk==='office') return '';                                              /* Maintenance में */
  if(x.type==='erik') return 'भाड़ा (Bhara)';   /* E-Rikshaw भी भाड़ा में ही */
  if(x.type==='pending') return 'Advance';
  const nm=String(x.name||'').trim();
  if(/e-?rikshaw|ई.?रिक्शा/i.test(nm)) return 'भाड़ा (Bhara)';
  const hit=tvProducts().find(p=>tvK(p)===tvK(nm));
  if(hit) return tvBharaFix(hit);
  if(/loading|लोडिंग|लोडींग/i.test(nm)) return 'Loading';
  if(/unload|अनलोड/i.test(nm)) return 'Unloading';
  if(/भाड़ा|bhara|bhada/i.test(nm)) return 'भाड़ा (Bhara)';
  if(/overtime|ओवरटाइम/i.test(nm)) return 'Overtime';
  if(/बिजली|electric|light bill/i.test(nm)) return 'बिजली बिल';
  return 'Mill खर्च';
}
/* सारे product items — fix + custom + data में मिले नये */
function tvProdItems(){
  const list=TV_PROD_FIX.slice();
  tvProducts().forEach(p=>{ p=tvBharaFix(p); if(!list.includes(p)) list.push(p); });
  tvKharchAll().forEach(x=>{ const c=tvProdCat(x); if(c && !list.includes(c)) list.push(c); });
  return list;
}
function tvProdEntries(item){
  return tvKharchAll().filter(x=>tvProdCat(x)===item).sort((a,b)=>tvDV(b.date)-tvDV(a.date));
}
const TV_PROD_ICON = {'Loading':'🏋️','Unloading':'📤','भाड़ा (Bhara)':'🚚','Overtime':'⏱️','बिजली बिल':'💡',
  'गाडी खर्च (Daily)':'🚐','Labour':'👷','Mill खर्च':'🏭','Advance':'⏳'};

function tvMK(){
  const K=tvKharchAll();
  const pT=K.filter(x=>tvProdCat(x)).reduce((a,x)=>a+tvN(x.amount),0);
  const gT=K.filter(x=>(x.type==='van'||x.mk==='gadi') && x.mkSub==='fuel').reduce((a,x)=>a+tvN(x.amount),0);
  const mT=K.filter(x=>x.mk==='plant'||x.mk==='office').reduce((a,x)=>a+tvN(x.amount),0);
  return tvHead(TV_TITLES.mk)+`
  <div class="tv2">
    <button class="tvbig pr" data-tvgo="mkprod"><span class="bi">📦</span><b>Product</b><small>₹${tvF(pT)} · Loading/बिजली...</small></button>
    <button class="tvbig ga" data-tvgo="mkgadi"><span class="bi">🚐</span><b>गाडी</b><small>₹${tvF(gT)} · सिर्फ़ Fuel</small></button>
    <button class="tvbig mm" data-tvgo="mkmm"><span class="bi">🔧</span><b>Mill Maintenance</b><small>₹${tvF(mT)} · Plant / Office</small></button>
  </div>`;
}
function tvMKProd(){
  const items=tvProdItems();
  let grand=0;
  const cards=items.map((n,i)=>{ const e=tvProdEntries(n); const s=e.reduce((a,x)=>a+tvN(x.amount),0); grand+=s;
    return `<button class="mkc c${i%8}" data-mkopen="${tvE(n)}"><span class="mki">${TV_PROD_ICON[n]||['🏋️','📤','🚚','⏱️','💡','🧰','📦','🔩'][i%8]}</span><b>${tvE(n)}</b><i>₹${tvF(s)}</i><u>${e.length?e.length+' entry':'खाली'}</u></button>`;
  }).join('');
  return tvHead(TV_TITLES.mkprod,`<div class="pp-note tvnote">🖱️ ऊपर <b>PRODUCT</b> title पर <b>3 बार</b> click → नया item add · किसी box पर click → उसका <b>पूरा profile</b> खुलेगा (हर entry date + time के साथ)</div>`,
    `<button class="tvbtn add" id="tv-addnew" data-mkitem="Mill खर्च" data-mkkind="product">➕ नयी entry</button>`)
    +`<div class="mkgrid" id="tv-rows">${cards}</div>
      <div class="tvgt">Product कुल खर्च <b>₹${tvF(grand)}</b></div>`;
}
/* किसी भी product item का पूरा profile */
function tvMKItem(){
  const item=TVS.mkitem||'';
  const list=tvProdEntries(item);
  const tot=list.reduce((a,x)=>a+tvN(x.amount),0);
  const rows=list.length? list.map((x,i)=>`<div class="pfl">
      <div class="pfa">₹${tvF(x.amount)}</div>
      <div class="pfs"><span class="dt">📅 ${tvE(x.date)}</span>${x.ts?`<span class="tm">🕐 ${tvE(x.ts)}</span>`:''}
        <span class="lb">${tvE(x.name||item)}</span>${x.driver?`<span class="lb">${tvE(x.driver)}</span>`:''}${x.vehNo?`<span class="lb">${tvE(x.vehNo)}</span>`:''}${x.fromTally?'<span class="lb">Tally</span>':'<span class="lb">Notebook</span>'}</div>
    </div>`).join('') : `<div class="pfe">— अभी कोई entry नहीं —</div>`;
  return tvHead(`${TV_PROD_ICON[item]||'📦'} ${tvE(item)}`,
    `<div class="pfsum"><div class="r"><small>कुल खर्च</small><b>₹${tvF(tot)}</b></div><div class="g"><small>Entry</small><b>${list.length}</b></div></div>`,
    `<button class="tvbtn add" data-mkitem="${tvE(item)}" data-mkkind="product">➕ नयी entry</button>`)
    +`<div id="tv-rows">${rows}</div>`;
}
function tvMKGadi(){
  const K=tvKharchAll();
  const cards=TV_VEHICLES.map(v=>{
    const f=K.filter(x=>x.vehNo===v.no && x.mkSub==='fuel').reduce((a,x)=>a+tvN(x.amount),0);
    return `<button class="vehc" style="--vc:${v.col}" data-veh="${v.no}">
      <span class="vi">${v.icon}</span><b>${v.no}</b><i>${v.label}</i>
      <div class="vsum"><span class="f">⛽ ₹${tvF(f)}</span></div></button>`;
  }).join('');
  return tvHead(TV_TITLES.mkgadi,`<div class="pp-note tvnote">यहाँ notebook के <b>नगद खर्च → वेन → ⛽ Fuel</b> वाला ही data आता है · गाड़ी खर्च (Daily) <b>Product</b> में है</div>`)
    +`<div class="vehgrid" id="tv-rows">${cards}</div>`;
}
function tvMKVeh(){
  const v=TV_VEHICLES.find(x=>x.no===TVS.veh)||TV_VEHICLES[0];
  const fuel=tvKharchAll().filter(x=>x.vehNo===v.no && x.mkSub==='fuel').sort((a,b)=>tvDV(b.date)-tvDV(a.date));
  const li=a=>a.length? a.map(x=>`<div class="pfl"><div class="pfa">₹${tvF(x.amount)}</div><div class="pfs"><span class="dt">📅 ${tvE(x.date)}</span>${x.ts?`<span class="tm">🕐 ${tvE(x.ts)}</span>`:''}${x.driver?`<span class="lb">${tvE(x.driver)}</span>`:''}${x.note?`<span class="lb">${tvE(x.note)}</span>`:''}</div></div>`).join('') : `<div class="pfe">— कुछ नहीं —</div>`;
  return tvHead(`${v.icon} ${v.no}`,`<div class="vehbar" style="--vc:${v.col}">${v.label} — ⛽ कुल ₹${tvF(fuel.reduce((a,x)=>a+tvN(x.amount),0))}</div>`,
    `<button class="tvbtn add" data-mkitem="${v.no}" data-mkkind="fuel">⛽ Fuel भरें</button>`)
    +`<div id="tv-rows">${li(fuel)}</div>`;
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
  return tvHead(TV_TITLES[v],'',`<button class="tvbtn add" data-mkitem="${kind}" data-mkkind="place">➕ नया ${kind==='plant'?'Plant':'Office'} खर्च</button>`)
    +`<div id="tv-rows">${rows}</div><div class="tvgt">${kind==='plant'?'Plant':'Office'} कुल <b>₹${tvF(tot)}</b></div>`;
}
/* अमाउंट भरने का popup — सब जगह एक ही */
function tvMKEntry(item,kind){
  const isVeh = kind==='fuel'||kind==='maint';
  const isPlace = kind==='place';
  const v = isVeh? TV_VEHICLES.find(x=>x.no===item) : null;
  const title = isVeh ? `${v.icon} ${item} — ${kind==='fuel'?'⛽ Fuel':'🔧 Maintenance'}`
              : isPlace ? `${item==='plant'?'🏭 Plant':'🏢 Office'} खर्च`
              : `${TV_PROD_ICON[item]||'📦'} ${item} — अमाउंट`;
  popup({ title,
    body:`<div class="pp-note">भरते ही यह <b>नगद खर्च</b> (notebook) और <b>S.Book</b> में अपने आप चला जाएगा</div>
      <div class="f-row"><label>${isVeh?'नोट / Driver':'खर्च का नाम'}</label><input type="text" id="tv-mkn" placeholder="${isVeh?'(optional)':(isPlace?'जैसे मोटर रिपेयर':'(optional) — '+item)}"></div>
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
          tvPushKharch(note? `${item} — ${note}` : item, amt, {mk:'product', mkCat:item});
        }
        if(typeof logChange==='function') logChange({sec:'नगद खर्च', what:'नयी entry (Tally)', name:item, neu:amt, note:note});
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
/* NOTE: app.js में `let go=...` है — यह script-scope binding है, window.go नहीं।
   इसलिए पहले window.go में hook लगाने से Tally कभी render ही नहीं होता था (खाली screen)।
   अब सीधे उसी `go` binding को wrap करते हैं (orderbook.js की तरह) — safe fallback के साथ। */
function tvOpen(){
  TVS.view='root'; TVS.q=''; TVS.chip='all'; TVS.area=''; TVS.profile=null;
  tvRefresh(); tvRender();
}
(function(){
  /* app.js का go() अब खुद tvOpen() बुलाता है।
     यह सुरक्षा-जाल तब काम आता है जब किसी वजह से वह छूट जाए */
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-go="tally"]');
    if(t) setTimeout(()=>{ const s=document.getElementById('tally-screen');
      if(s && s.classList.contains('active')){ const b=document.getElementById('tv-body');
        if(b && !b.innerHTML.trim()) tvOpen(); } },0);
  });
})();
window.renderTally=function(){ tvRefresh(); tvRender(); };
window.tvOpen=tvOpen;
window.tvRefresh=tvRefresh;
