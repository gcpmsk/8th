/* =========================================================
   💰 SET RATE — Master rate · Area rate · Customer special rate
   (Emergency button की जगह) — data: localStorage 'sg_rates'
========================================================= */
const SR_KEY='sg_rates';
const SR_ITEMS=[
  {k:'gold',  t:'Atta Gold',   m:'Atta Gold'},
  {k:'a5',    t:'Atta 5kg',    m:'Atta 5kg'},
  {k:'a10',   t:'Atta 10kg',   m:'Atta 10kg'},
  {k:'a18',   t:'Atta 18kg',   m:'Atta 18kg'},
  {k:'besan', t:'Besan 1kg',   m:'Besan'},
  {k:'sattu', t:'Sattu 1kg',   m:'Sattu'},
  {k:'chokar',t:'Chokar',      m:'Chokar'},
  {k:'wheat', t:'Wheat (₹/Bag)', m:'Wheat'}
];
const SRS={mode:'all', area:'', q:''};
function srLoad(){ try{ const o=JSON.parse(localStorage.getItem(SR_KEY)||'{}'); return Object.assign({master:{},area:{},cust:{}},o||{}); }catch(e){ return {master:{},area:{},cust:{}}; } }
function srSave(o){ localStorage.setItem(SR_KEY,JSON.stringify(o)); try{ if(typeof sgSyncPush==='function') sgSyncPush(); }catch(e){} }
function srN(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
/* effective rate of a customer for item k */
function srRate(R,key,area,k){
  const base = (R.area[area]&&R.area[area][k]!==undefined&&R.area[area][k]!=='') ? srN(R.area[area][k]) : srN((R.master||{})[k]);
  const sp=(R.cust[key]||{})[k];
  if(sp!==undefined && sp!=='' && sp!==null) return {rate:Math.max(0,base-srN(sp)), less:srN(sp), base, special:true};
  return {rate:base, less:0, base, special:false};
}
/* Atta/Wheat receipts से use — item name से rate */
window.sgGetRate=function(name,address,itemName){
  try{ const R=srLoad(); const key=String(name||'').trim().toUpperCase().replace(/\s+/g,' ');
    const area=(typeof tvArea==='function')?tvArea(address):'OTHER';
    const it=SR_ITEMS.find(x=>String(itemName||'').toLowerCase().indexOf(x.m.toLowerCase())===0)
          ||SR_ITEMS.find(x=>String(itemName||'').toLowerCase().includes(x.m.toLowerCase()));
    if(!it) return null; const r=srRate(R,key,area,it.k).rate; return r>0?r:null; }catch(e){ return null; }
};
function srDebtors(){
  let arr=[]; try{ arr=(tvBuild().deb||[]).slice(); }catch(e){}
  return arr.sort((a,b)=>a.name.localeCompare(b.name,'hi'));
}
function srRateBoxes(vals,cls,attr){
  return `<div class="sr-grid">${SR_ITEMS.map(it=>`<label class="sr-box ${cls||''}"><span>${it.t}</span><input type="number" step="any" inputmode="decimal" ${attr||''} data-k="${it.k}" value="${vals[it.k]!==undefined&&vals[it.k]!==null?vals[it.k]:''}" placeholder="—"></label>`).join('')}</div>`;
}
function srRender(){
  const el=document.getElementById('sr-body'); if(!el) return;
  const R=srLoad();
  const debs=srDebtors();
  const areas={}; debs.forEach(d=>{ areas[d.area]=(areas[d.area]||0)+1; });
  const areaKeys=Object.keys(areas).sort();
  let html=`<div class="sr-card master"><div class="sr-ttl">⭐ MASTER RATE <small>(सब Debtors + Creditor Wheat के लिए common)</small></div>
    ${srRateBoxes(R.master||{},'','data-master="1"')}
    <button class="tvbtn add" id="sr-save-master">💾 Master Rate Save</button></div>
    <div class="sr-tabs"><button class="sr-tab ${SRS.mode==='all'?'on':''}" data-mode="all">👥 All</button><button class="sr-tab ${SRS.mode==='area'?'on':''}" data-mode="area">📍 Area Wise</button></div>`;
  if(SRS.mode==='area' && !SRS.area){
    html+=`<div class="tvareas">${areaKeys.map((k,i)=>`<button class="tvarea a${i%6}" data-sarea="${tvE(k)}"><b>${tvE(k)}</b><small>${areas[k]} customer</small></button>`).join('')||'<div class="tvempty">— कोई debtor नहीं —</div>'}</div>`;
  } else {
    let list=debs;
    if(SRS.mode==='area'){
      list=debs.filter(d=>d.area===SRS.area);
      const av=R.area[SRS.area]||{};
      html+=`<div class="sr-card area"><div class="sr-ttl">📍 AREA: <b>${tvE(SRS.area)}</b> <button class="tvx" id="sr-area-x">✖</button><small>Master price दिख रहा है — इस area के लिए बढ़ा/घटा सकते हैं</small></div>
        ${srRateBoxes(SR_ITEMS.reduce((o,it)=>{ o[it.k]=(av[it.k]!==undefined&&av[it.k]!=='')?av[it.k]:(R.master[it.k]??''); return o; },{}),'', '')}
        <button class="tvbtn add" id="sr-save-area">💾 ${tvE(SRS.area)} Rate Save</button></div>`;
    }
    html+=`<div class="tvsearch"><span>🔍</span><input id="sr-q" placeholder="नाम / पता लिखें..." value="${tvE(SRS.q)}"></div>`;
    const q=String(SRS.q||'').trim().toUpperCase();
    if(q) list=list.filter(d=>d.key.includes(q)||String(d.address||'').toUpperCase().includes(q));
    html+=`<div class="sr-rows">`+ (list.length? list.map((d,i)=>{
      const rs=SR_ITEMS.map(it=>srRate(R,d.key,d.area,it.k));
      const sp=rs.some(x=>x.special);
      return `<div class="sr-row ${sp?'sp':''}" data-cust="${tvE(d.key)}">
        <div class="sr-sr">${i+1}</div>
        <div class="sr-nm"><b>${tvE(d.name)}</b>${d.address?`<i>(${tvE(d.address)})</i>`:''}<small>${tvE(d.area)}</small></div>
        <div class="sr-rates">${SR_ITEMS.map((it,j)=>`<span class="sr-pill ${rs[j].special?'sp':''}" title="${it.t}"><em>${it.t}</em>${rs[j].rate?('₹'+rs[j].rate):'—'}</span>`).join('')}</div>
        <button class="tvbtn sr-set" data-setc="${tvE(d.key)}" data-area="${tvE(d.area)}" data-nm="${tvE(d.name)}">💰 Price Set</button>
      </div>`; }).join('') : '<div class="tvempty">— कोई customer नहीं —</div>') + `</div>`;
  }
  el.innerHTML=html;
  /* wire */
  const sm=el.querySelector('#sr-save-master'); if(sm) sm.addEventListener('click',()=>{ const R2=srLoad(); R2.master={}; el.querySelectorAll('[data-master] , .sr-card.master input[data-k]').forEach(i=>{ if(i.value!=='') R2.master[i.dataset.k]=srN(i.value); }); srSave(R2); toast('⭐ Master rate save ✔'); srRender(); });
  el.querySelectorAll('.sr-tab').forEach(b=>b.addEventListener('click',()=>{ SRS.mode=b.dataset.mode; SRS.area=''; SRS.q=''; srRender(); }));
  el.querySelectorAll('[data-sarea]').forEach(b=>b.addEventListener('click',()=>{ SRS.area=b.dataset.sarea; srRender(); }));
  const ax=el.querySelector('#sr-area-x'); if(ax) ax.addEventListener('click',()=>{ SRS.area=''; srRender(); });
  const sa=el.querySelector('#sr-save-area'); if(sa) sa.addEventListener('click',()=>{ const R2=srLoad(); const o={}; el.querySelectorAll('.sr-card.area input[data-k]').forEach(i=>{ if(i.value!=='' && srN(i.value)!==srN(R2.master[i.dataset.k])) o[i.dataset.k]=srN(i.value); }); R2.area[SRS.area]=o; srSave(R2); toast('📍 '+SRS.area+' rate save ✔ — इस area के सब customer को यही rate'); srRender(); });
  const sq=el.querySelector('#sr-q'); if(sq) sq.addEventListener('input',()=>{ SRS.q=sq.value; const rows=el.querySelector('.sr-rows'); const q=sq.value.trim().toUpperCase(); el.querySelectorAll('.sr-row').forEach(r=>{ r.style.display=(!q||r.textContent.toUpperCase().includes(q))?'':'none'; }); });
  el.querySelectorAll('[data-setc]').forEach(b=>b.addEventListener('click',()=>srCustPopup(b.dataset.setc,b.dataset.area,b.dataset.nm)));
  /* highlight last special-set customer */
  if(SRS.hl){ const r=el.querySelector(`.sr-row[data-cust="${SRS.hl.replace(/"/g,'&quot;')}"]`); if(r){ r.classList.add('hl'); r.scrollIntoView({block:'center'}); } }
}
/* customer profile popup — area rate दिखे, नीचे खाली box: जो number भरो वह area rate से घटेगा */
function srCustPopup(key,area,name){
  const R=srLoad(); const cur=R.cust[key]||{};
  const rows=SR_ITEMS.map(it=>{ const r=srRate(R,key,area,it.k);
    return `<div class="sr-prow"><span class="l">${it.t}</span><span class="b">Area ₹<b>${r.base||0}</b></span>
      <span class="m">−</span><input type="number" step="any" inputmode="decimal" data-less="${it.k}" value="${cur[it.k]!==undefined&&cur[it.k]!==null?cur[it.k]:''}" placeholder="0">
      <span class="eq">= ₹<b data-fin="${it.k}">${r.rate}</b></span></div>`; }).join('');
  popup({ title:'💰 Price Set — '+tvE(name||key),
    body:`<div class="pp-note">📍 Area <b>${tvE(area)}</b> का rate दिख रहा है · नीचे खाली box में जो number भरेंगे वह area rate से <b>घट (−)</b> कर इस customer का rate बनेगा</div><div class="sr-plist">${rows}</div>`,
    foot:`<button class="pp-btn cancel" id="sr-clr">↺ Reset</button><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Back</button><button class="pp-btn save" id="sr-cs">✓ Save</button></div>`,
    onOpen(bk){
      bk.querySelectorAll('[data-less]').forEach(i=>i.addEventListener('input',()=>{ const k=i.dataset.less; const base=srRate(R,'__none__',area,k).base; bk.querySelector(`[data-fin="${k}"]`).textContent=Math.max(0,base-srN(i.value)); }));
      bk.querySelector('#sr-cs').addEventListener('click',()=>{ const R2=srLoad(); const o={}; bk.querySelectorAll('[data-less]').forEach(i=>{ if(i.value!=='') o[i.dataset.less]=srN(i.value); }); if(Object.keys(o).length) R2.cust[key]=o; else delete R2.cust[key]; srSave(R2); SRS.hl=key; closePopup(); srRender(); toast('💰 '+(name||key)+' special rate save ✔'); });
      bk.querySelector('#sr-clr').addEventListener('click',()=>{ const R2=srLoad(); delete R2.cust[key]; srSave(R2); SRS.hl=''; closePopup(); srRender(); toast('Reset ✔'); });
    }});
}
window.srOpen=function(){ SRS.mode='all'; SRS.area=''; SRS.q=''; try{ if(typeof tvRefresh==='function') tvRefresh(); }catch(e){} srRender(); };
