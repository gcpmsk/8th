/* =========================================================
   📚 S.BOOK — Notebook + Receipt (Atta/Wheat) का AUTO मिला-जुला हिसाब
   - Notebook जैसा 2-page A4 single page layout
   - रोकड + नगदी बिक्री → A/C (लाल) और Cash (नीला) दो हिस्से में
   - जमा नाम खाते (बायाँ), बिक्री नाम खाते (Atta receipt — verify के बाद)
   - माल आवत खाते (Wheat slip — final होने पर पूरा, वरना सिर्फ़ नाम/पता/रेट)
   - नगद नाम खाते, बैंक एकाउंट + जमा (सब लाल), नगद खर्च (Total ऊपर)
   - हर हिस्से में manual entry भी हो सकती है
========================================================= */
'use strict';

const SB_MKEY = d => 'sg_sb_' + d;
function sbBlank(){ return {sale:[],jama:[],bikri:[],bikri2:[],maal:[],nagad:[],bank:[],kharch:[]}; }
function sbLoad(d){ try{ return Object.assign(sbBlank(), JSON.parse(localStorage.getItem(SB_MKEY(d))||'{}')); }catch(e){ return sbBlank(); } }
function sbSave(d,m){ try{ localStorage.setItem(SB_MKEY(d),JSON.stringify(m)); }catch(e){} }
let SB_DATE = (typeof DATE!=='undefined'? DATE : todayStr());
let SBM = sbBlank();

function sbNum(v){ const n=parseFloat(v); return isNaN(n)?0:n; }

/* ✋ अपने से (manual) लिखी entry — hand symbol + time stamp */
function sbHand(x){
  return `<span class="sb-hand"><span class="hs">✋</span>${x&&x.ts?' '+esc(x.ts):''}</span>`;
}
/* manual line — हर section के लिए एक ही जगह से (hand + ts के साथ) */
function sbManLine(sec,x,forceRed){
  const i=(SBM[sec]||[]).indexOf(x);
  const red = forceRed || x.red;
  return `<div class="sb-line sb-manual ${red?'red':'blue'}" data-sbsec="${sec}" data-i="${i}">
    <span class="sb-amt">${sbF(x.amt)}</span><span class="sb-txt">${esc(x.text)}${sbHand(x)}</span></div>`;
}
function sbManHTML(sec,forceRed){
  return (SBM[sec]||[]).filter(x=>!x.cut).map(x=>sbManLine(sec,x,forceRed)).join('');
}
function sbF(n){ return fmt(Math.round(sbNum(n)*100)/100); }
function sbRate(amt,qty){ if(!qty) return ''; const r=sbNum(amt)/qty; return (Math.round(r*100)%100===0)? String(Math.round(r)) : r.toFixed(2); }

/* item का छोटा नाम — जैसे notebook में */
function sbItemLabel(item,sub){
  let s=sub||'';
  if(s==='गोल्ड') s='ग.';
  if(s==='चोकर'||s===item) s='';
  const it = item==='आटा'?'ATTA' : item==='सत्तू'?'SATTU' : item==='बेसन'?'BESAN' : item==='चोकर'?'CHOKAR' : item;
  return (it+' '+s).trim();
}

/* =========================================================
   1) रोकड + नगदी बिक्री → A/C (लाल) + Cash (नीला)
   नियम: A/C का qty = round(A/C amount ÷ rate)  (max = कुल qty)
         बचा हुआ qty Cash में — दोनों का अपना rate = amount ÷ qty
         अगर A/C amount एक बोरा के rate से भी कम है → पूरा qty Cash में
========================================================= */
function sbSaleGroups(db){
  const ac=new Map(), cash=new Map();
  const push=(map,key,amt,qty)=>{ const o=map.get(key)||{amt:0,qty:0}; o.amt+=amt; o.qty+=qty; map.set(key,o); };
  (db.rokad||[]).filter(r=>!r.cut).forEach(r=>{
    (r.items||[]).forEach(it=>{
      const label=sbItemLabel(it.item,it.sub);
      const rate=sbNum(it.price), qty=sbNum(it.qty);
      const acAmt=sbNum(it.online), cashAmt=sbNum(it.cash);
      let acQty=0;
      if(acAmt>0 && rate>0){ acQty=Math.round(acAmt/rate); if(acQty>qty)acQty=qty; if(acQty<0)acQty=0; }
      if(cashAmt<=0) acQty=qty;                    // पूरा A/C
      if(acAmt<=0) acQty=0;                        // पूरा Cash
      if(acQty>=qty && cashAmt>0) acQty=Math.max(0,qty-1);
      const cashQty=qty-acQty;
      if(acAmt>0) push(ac,label,acAmt,acQty);
      if(cashAmt>0) push(cash,label,cashAmt,cashQty);
    });
  });
  const toArr=m=>Array.from(m,([label,o])=>({label,amt:o.amt,qty:o.qty}));
  return {ac:toArr(ac), cash:toArr(cash)};
}
function sbGroupLines(list,cls){
  return list.map(g=>`<div class="sb-line ${cls}"><span class="sb-amt">${sbF(g.amt)}</span><span class="sb-txt">${esc(g.label)}${g.qty>0?`&nbsp; ${sbF(g.qty)}×${sbRate(g.amt,g.qty)}`:''}</span></div>`).join('');
}
function sbSaleHTML(db,live){
  const G=sbSaleGroups(db);
  const acT=G.ac.reduce((a,x)=>a+x.amt,0), cashT=G.cash.reduce((a,x)=>a+x.amt,0);
  const man=SBM.sale.filter(x=>!x.cut);
  const manAC=man.filter(x=>x.red), manCash=man.filter(x=>!x.red);
  const manLine=x=>sbManLine('sale',x);
  let h='';
  if(G.ac.length||manAC.length){
    h+=`<div class="sb-grp"><div class="sb-circle red">${sbF(acT+manAC.reduce((a,x)=>a+x.amt,0))}</div>
      <div class="sb-grp-lines">${sbGroupLines(G.ac,'red')}${manAC.map(manLine).join('')}</div></div>`;
  }
  if(G.cash.length||manCash.length){
    h+=`<div class="sb-grp"><div class="sb-circle blue">${sbF(cashT+manCash.reduce((a,x)=>a+x.amt,0))}</div>
      <div class="sb-grp-lines">${sbGroupLines(G.cash,'blue')}${manCash.map(manLine).join('')}</div></div>`;
  }
  if(!h) h=`<div class="sb-empty">— कोई बिक्री नहीं —</div>`;
  return h + (live?`<div class="add-strip" data-sbadd="sale">+ नयी बिक्री entry</div>`:'');
}

/* =========================================================
   2) जमा नाम खाते  (notebook की जमा + manual)
========================================================= */
function sbJamaHTML(db,live){
  const rows=(db.jama||[]).filter(r=>!r.cut).map(r=>
    `<div class="sb-line ${r.online>0?'red':'blue'}"><span class="sb-amt">${sbF(r.amount)}</span><span class="sb-txt">${esc(r.name)}${r.address?` (${esc(r.address)})`:''}${r.online>0?' <b>A/C</b>':''}</span></div>`).join('');
  const man=sbManHTML('jama');
  return (rows+man||`<div class="sb-empty">— खाली —</div>`) + (live?`<div class="add-strip" data-sbadd="jama">+ नयी जमा entry</div>`:'');
}

/* =========================================================
   3) बिक्री नाम खाते  ← Atta Receipt (verify होने के बाद ही)
========================================================= */
function sbBikriRows(){
  const rc=loadArr(ARC_KEY(SB_DATE)).filter(r=>r.verified && !r.cancelled);
  return rc.map(r=>{
    const nm=(r.name||r.nameHi||'—'), nh=(r.nameHi&&r.nameHi!==r.name)?` (${r.nameHi})`:'';
    const items=(r.items||[]).map(it=>`<div class="sb-sub">${esc(it.name||'')} &nbsp;${esc(String(it.qty||''))}×${esc(String(it.rate||''))}</div>`).join('');
    return `<div class="sb-line blue"><span class="sb-amt">${sbF(r.total)}</span><span class="sb-txt">${esc(nm)}${nh} ${esc(r.address||r.addressHi||'')}${items}</span></div>`;
  }).join('');
}
function sbBikriHTML(live){
  const rows=sbBikriRows();
  const man=sbManHTML('bikri');
  return (rows+man||`<div class="sb-empty">— Verify हुई Atta Receipt यहाँ आएगी ✔ —</div>`) + (live?`<div class="add-strip" data-sbadd="bikri">+ नयी बिक्री नाम entry</div>`:'');
}

/* दायें page वाला overflow — बिक्री नाम खाते (part 2) */
function sbBikri2HTML(live){
  const man=sbManHTML('bikri2');
  return (man||`<div class="sb-empty">— जगह कम पड़े तो यहाँ लिखें —</div>`) + (live?`<div class="add-strip" data-sbadd="bikri2">+ और बिक्री नाम</div>`:'');
}

/* =========================================================
   4) माल आवत खाते ← Wheat Slip (print होते ही)
      final होने पर: Amount) नाम (पता) + नीचे  KG × रेट (Total ÷ KG)
      final न हो तो सिर्फ़ नाम / पता / रेट
========================================================= */
/* Wheat print का असली logic — जो भी field खाली हो, बाक़ी से जितना निकल सके निकाल लो */
function sbWheatCalc(r){
  const kind=(r.kind||r.mode||'rst');
  const isFill = kind==='fill';
  /* बोरा — FILL में weights की गिनती, RST में pic/bags */
  let bags = isFill
    ? ((r.weights&&r.weights.length) || sbNum(r.pic) || sbNum(r.bags))
    : (sbNum(r.pic) || sbNum(r.bags) || ((r.weights&&r.weights.length)||0));
  /* Net KG — nett/net भरा हो तो वही, वरना gross-tare, वरना FILL weights का जोड़ */
  let kg = sbNum(r.nett) || sbNum(r.net) || sbNum(r.totalWt) || sbNum(r.fillTotal);
  if(!kg){
    const gr=sbNum(r.gross), tr=sbNum(r.tare);
    if(gr>0 && tr>0) kg = Math.max(0, gr-tr);
    else if(r.weights&&r.weights.length) kg = r.weights.reduce((a,x)=>a+sbNum(x),0);
  }
  const rate=sbNum(r.rate);
  /* Wheat print जैसा: 0.5kg/Qtl weight cut + ₹4/बोरा unloading + D/P/W bag cut */
  const stdOn = (r.stdCut===undefined) ? true : !!r.stdCut;
  const wtCutKg = (r.wtCutKg!==undefined&&r.wtCutKg!==null) ? sbNum(r.wtCutKg) : ((kg>0&&stdOn)?(kg/100)*0.5:0);
  const wtCutRs = (r.wtCutRs!==undefined&&r.wtCutRs!==null) ? sbNum(r.wtCutRs) : wtCutKg*rate;
  const unloadRs= (r.unloadRs!==undefined&&r.unloadRs!==null)? sbNum(r.unloadRs): ((kg>0&&stdOn)?bags*4:0);
  const bagCut  = sbNum(r.bagCut);
  const grossAmt= (r.grossAmt!==undefined&&r.grossAmt!==null)? sbNum(r.grossAmt) : kg*rate;
  let finalPay  = sbNum(r.finalPay);
  if(!finalPay && kg>0 && rate>0) finalPay = Math.max(0, grossAmt - wtCutRs - unloadRs - bagCut);
  const dpw = `${sbF(bags)} = ${sbNum(r.d||r.dust||0)}/${sbNum(r.p||r.plastic||0)}/${sbNum(r.w||r.wet||0)}`;
  return {isFill,bags,kg,rate,finalPay,grossAmt,dpw,
    hasRate:rate>0, hasKg:kg>0, hasBags:bags>0,
    miss:[!kg?'Weight':null,!rate?'Rate':null].filter(Boolean)};
}
/* Bag / Daal / Roast (simple) — notebook जैसा ही: Serial ऊपर, Amount नाम से पहले,
   नीचे  qty × rate ; नाम/पता खाली हो तब भी line दिखेगी */
function sbSimpleLine(r){
  const qty=sbNum(r.qty), rate=(r.rate===null||r.rate===undefined)?null:sbNum(r.rate);
  const amt=(rate||0)*qty;
  const un=r.qtyUnit||r.rateUnit||'kg';
  const who=(r.name||'').trim();
  const ad=(r.address||'').trim();
  return `<div class="sb-line ${amt>0?'blue':'pend'}"><span class="sb-amt">${amt>0?sbF(amt):'—'}</span><span class="sb-txt">
    <b>${sbF(r.serial||'')}${'\u0029'}</b> ${esc(r.label||'')}${r.opt?` (${esc(r.opt)})`:''}${who?` — ${esc(who)}`:''}${ad?` (${esc(ad)})`:''}
    <div class="sb-sub big">${sbF(qty)}${esc(un)} × ${rate===null?'?':sbF(rate)}rs</div>
    ${r.vehicle?`<div class="sb-sub">गाडी नं०- ${esc(r.vehicle)}</div>`:''}</span></div>`;
}
/* एक माल आवत line — बोरा हमेशा दिखेगा, चाहे weight/rate छूट गया हो */
function sbMaalLine(r){
  if(r.kind==='simple') return sbSimpleLine(r);
  const nm=(r.name||r.nameHi||'—'), ad=(r.address||r.addressHi||'');
  const c=sbWheatCalc(r);
  const boraChip = c.hasBags
    ? `<span class="sb-bora">${sbF(c.bags)} बोरा</span><span class="sb-dpw">D/P/W ${esc(c.dpw)}</span>`
    : `<span class="sb-bora pend">बोरा — ?</span>`;
  if(c.finalPay>0 && c.hasKg){
    const rt=c.finalPay/c.kg;
    return `<div class="sb-line blue"><span class="sb-amt">${sbF(c.finalPay)}</span><span class="sb-txt">${esc(nm)}${ad?` (${esc(ad)})`:''}
      <div class="sb-sub big">${sbF(c.kg)}Kg × ${rt.toFixed(2)}</div>
      <div class="sb-sub">${boraChip}</div></span></div>`;
  }
  /* अधूरी entry — फिर भी बोरा + जो मिला वह दिखेगा */
  const bits=[];
  if(c.hasBags) bits.push(boraChip);
  if(c.hasKg)   bits.push(`<span class="sb-bora">${sbF(c.kg)} Kg</span>`);
  if(c.hasRate) bits.push(`<span class="sb-bora">RATE ${esc(n2(c.rate))}</span>`);
  if(!c.hasBags && !c.hasKg && !c.hasRate) bits.push(boraChip);
  const amtShow = (c.grossAmt>0) ? sbF(c.grossAmt) : '—';
  return `<div class="sb-line pend"><span class="sb-amt">${amtShow}</span><span class="sb-txt">${esc(nm)}${ad?` (${esc(ad)})`:''}
    <div class="sb-sub">${bits.join(' ')}</div>
    <div class="sb-sub"><i>${c.miss.length?c.miss.join(' + ')+' बाक़ी ⏳':'final बाक़ी ⏳'}</i>${c.isFill?' <b>FILL</b>':''}</div></span></div>`;
}
function sbMaalHTML(live){
  const wh=loadArr(WRC_KEY(SB_DATE));
  const doneKeys=new Set();
  wh.forEach(r=>{ const k=((r.name||r.nameHi||'')+'|'+(r.serial??'')).toLowerCase(); doneKeys.add(k); });
  /* Wheat Slip वाले (print हो चुके) */
  let rows=wh.map(sbMaalLine).join('');
  /* Notebook का माल आवत खाता — जो अभी slip में नहीं आया वह भी दिखेगा (बोरा के साथ) */
  const db = (SB_DATE===DATE ? DB : (loadDB('sg_nb_',SB_DATE)||blankRaw()));
  rows += (db.maal||[]).filter(r=>!r.cut).filter(r=>{
    if(r.kind==='simple') return true;   /* Bag/Daal/Roast — नाम-पता खाली हो तब भी हमेशा दिखे */
    const k=((r.name||'')+'|'+(r.serial??'')).toLowerCase();
    if(doneKeys.has(k)) return false;
    /* नाम मिल जाए तो duplicate मत दिखाओ */
    return !wh.some(w=>((w.name||w.nameHi||'').trim().toLowerCase())===((r.name||'').trim().toLowerCase()) && (r.name||'').trim()!=='');
  }).map(sbMaalLine).join('');
  const man=sbManHTML('maal');
  return (rows+man||`<div class="sb-empty">— Wheat Slip print होते ही यहाँ आएगा —</div>`) + (live?`<div class="add-strip" data-sbadd="maal">+ नयी माल आवत entry</div>`:'');
}

/* =========================================================
   5) नगद नाम खाते
========================================================= */
function sbNagadHTML(db,live){
  const rows=(db.nagad||[]).filter(r=>!r.cut).map(r=>
    `<div class="sb-line ${r.mode==='online'?'red':'blue'}"><span class="sb-amt">${sbF(r.amount)}</span><span class="sb-txt">${esc(r.name)}${r.address?` (${esc(r.address)})`:''}${r.mode==='online'?' <b>A/C</b>':''}${r.mode==='home'?' <b>(Home)</b>':''}${r.item?` — ${esc(r.item)}`:''}</span></div>`).join('');
  const man=sbManHTML('nagad');
  return (rows+man||`<div class="sb-empty">— खाली —</div>`) + (live?`<div class="add-strip" data-sbadd="nagad">+ नयी नगद नाम entry</div>`:'');
}

/* =========================================================
   6) बैंक एकाउंट + जमा  — सब कुछ लाल रंग में
========================================================= */
function sbBankHTML(db,live){
  const G=sbSaleGroups(db);
  const acT=G.ac.reduce((a,x)=>a+x.amt,0);
  let h='';
  if(acT>0) h+=`<div class="sb-line red"><span class="sb-amt">${sbF(acT)}</span><span class="sb-txt">नगदी बिक्री (BOM)</span></div>`;
  (db.jama||[]).filter(r=>!r.cut && r.online>0).forEach(r=>{
    h+=`<div class="sb-line red"><span class="sb-amt">${sbF(r.amount)}</span><span class="sb-txt">${esc(r.name)}${r.address?` (${esc(r.address)})`:''} — जमा</span></div>`;
  });
  (db.nagad||[]).filter(r=>!r.cut && r.mode==='online').forEach(r=>{
    h+=`<div class="sb-line red"><span class="sb-amt">${sbF(r.amount)}</span><span class="sb-txt">${esc(r.name)}${r.address?` (${esc(r.address)})`:''} — नगद नाम</span></div>`;
  });
  const man=sbManHTML('bank',true);
  return (h+man||`<div class="sb-empty">— कोई A/C entry नहीं —</div>`) + (live?`<div class="add-strip" data-sbadd="bank">+ नयी बैंक/जमा entry</div>`:'');
}

/* =========================================================
   7) नगद खर्च — ऊपर Total, नीचे सब combine
========================================================= */
function sbKharchData(db){
  const list=(db.kharch||[]).filter(r=>!r.cut);
  let mill=0; const cats=new Map();
  list.forEach(r=>{
    if(r.type==='labour'){ (r.labour||[]).forEach(l=>{ const o=cats.get(l.short)||{amt:0,qty:0}; o.amt+=sbNum(l.amt); o.qty+=sbNum(l.qty); cats.set(l.short,o); }); }
    else mill+=sbNum(r.amount);
  });
  const man=SBM.kharch.filter(x=>!x.cut);
  const total=list.reduce((a,x)=>a+sbNum(x.amount),0)+man.reduce((a,x)=>a+x.amt,0);
  return {mill,cats,man,total};
}
function sbKharchHTML(db,live){
  const K=sbKharchData(db);
  let h=`<div class="sb-line blue kh-top"><span class="sb-amt">${sbF(K.total)}</span><span class="sb-txt"><b>नगद खर्च</b></span></div><div class="sb-branch">`;
  if(K.mill>0) h+=`<div class="sb-line blue"><span class="sb-amt">${sbF(K.mill)}</span><span class="sb-txt">मील खर्च</span></div>`;
  K.cats.forEach((o,name)=>{ h+=`<div class="sb-line blue"><span class="sb-amt">${sbF(o.amt)}</span><span class="sb-txt">${esc(name)}${o.qty?` (${sbF(o.qty)})`:''}</span></div>`; });
  K.man.forEach(x=>{ h+=sbManLine('kharch',x); });
  h+=`</div>`;
  return h + (live?`<div class="add-strip" data-sbadd="kharch">+ नयी खर्च entry</div>`:'');
}

/* =========================================================
   पूरा S.Book — notebook जैसा 2 page
========================================================= */
function sbookHTML(date,live){
  const db = (date===DATE ? DB : (loadDB('sg_nb_',date)||blankRaw()));
  migrate(db);
  return `<div class="nb-spine"></div>
  <div class="nb-page left">
    <div class="nb-date">${date}</div>
    <div class="nb-cols-head">
      <div class="nb-col-title">रोकड + नगदी बिक्री</div>
      <div class="nb-col-title">बिक्री नाम खाते</div>
    </div>
    <div class="nb-body"><div class="nb-colline"></div>
      <div class="nb-col-stack" style="width:50%;">
        <div class="nb-col" id="sb-col-sale">${sbSaleHTML(db,live)}</div>
        <div class="kharch-divider">जमा नाम खाते</div>
        <div class="nb-col" id="sb-col-jama" style="min-height:120px;">${sbJamaHTML(db,live)}</div>
      </div>
      <div class="nb-col right-col" id="sb-col-bikri">${sbBikriHTML(live)}</div>
    </div>
  </div>
  <div class="nb-page right">
    <div class="nb-date">${date}</div>
    <div class="nb-cols-head">
      <div class="nb-col-title">माल आवत खाते</div>
      <div class="nb-col-title">नगद नाम खाते</div>
    </div>
    <div class="nb-body"><div class="nb-colline"></div>
      <div class="nb-col-stack" style="width:50%;">
        <div class="nb-col" id="sb-col-maal">${sbMaalHTML(live)}</div>
        <div class="kharch-divider">बिक्री नाम खाते</div>
        <div class="nb-col" id="sb-col-bikri2" style="min-height:110px;">${sbBikri2HTML(live)}</div>
      </div>
      <div class="nb-col-stack">
        <div class="nb-col right-col" id="sb-col-nagad">${sbNagadHTML(db,live)}</div>
        <div class="kharch-divider red-div">बैंक एकाउंट + जमा</div>
        <div class="nb-col right-col red-col" id="sb-col-bank" style="min-height:120px;">${sbBankHTML(db,live)}</div>
        <div class="kharch-divider">नगद खर्च</div>
        <div class="nb-col right-col" id="sb-col-kharch" style="min-height:120px;">${sbKharchHTML(db,live)}</div>
      </div>
    </div>
  </div>`;
}

/* Record Book से किसी भी तारीख़ का S.Book — SBM उस तारीख़ का manual data */
function sbSetDate(d){ SB_DATE=d; SBM=sbLoad(d); }
window.sbSetDate=sbSetDate;

function renderSBook(){
  SB_DATE = (CUR_DATE||DATE);
  SBM = sbLoad(SB_DATE);
  const el=$('#sbook'); if(!el) return;
  $('#sb-date').textContent=SB_DATE;
  el.innerHTML = sbookHTML(SB_DATE,true);
}

/* ---------- manual entry popup ---------- */
const SB_SEC_NAME={sale:'रोकड + नगदी बिक्री',jama:'जमा नाम खाते',bikri:'बिक्री नाम खाते',bikri2:'बिक्री नाम खाते',maal:'माल आवत खाते',nagad:'नगद नाम खाते',bank:'बैंक एकाउंट + जमा',kharch:'नगद खर्च'};
function openSBEntry(sec,editIdx=null){
  const e = editIdx!==null? SBM[sec][editIdx] : {};
  const forceRed = sec==='bank';
  popup({
    title:'✍️ '+(SB_SEC_NAME[sec]||'S.Book')+' — entry',
    body:`<div class="f-row"><label>Amount</label><input type="number" id="sb-amt" inputmode="decimal" value="${e.amt??''}"></div>
      <div class="f-row"><label>विवरण (नाम / item)</label><input type="text" id="sb-txt" value="${esc(e.text||'')}"></div>
      <div class="f-row"><label>Qty × Rate</label><div style="display:flex;gap:6px;"><input type="number" id="sb-q" placeholder="Qty" inputmode="decimal" style="width:50%"><input type="number" id="sb-r" placeholder="Rate" inputmode="decimal" style="width:50%"></div></div>
      ${forceRed?'':segRow('रंग',[{v:'blue',t:'🔵 Cash'},{v:'red',t:'🔴 A/C'}], e.red?'red':'blue')}`,
    foot:`${editIdx!==null?'<button class="pp-btn cancel" id="sb-del">🗑 हटाएँ</button>':'<span></span>'}
      <div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="sb-save">✓ Save</button></div>`,
    onOpen(bk){
      wireSeg(bk);
      const qi=bk.querySelector('#sb-q'), ri=bk.querySelector('#sb-r'), ai=bk.querySelector('#sb-amt');
      const upd=()=>{ const q=sbNum(qi.value), r=sbNum(ri.value); if(q>0&&r>0) ai.value=q*r; };
      qi.addEventListener('input',upd); ri.addEventListener('input',upd);
      bk.querySelector('#sb-del')?.addEventListener('click',()=>{ SBM[sec].splice(editIdx,1); sbSave(SB_DATE,SBM); closePopup(); renderSBook(); toast('हट गया'); });
      bk.querySelector('#sb-save').addEventListener('click',()=>{
        const amt=sbNum(ai.value); let text=bk.querySelector('#sb-txt').value.trim();
        if(!amt||!text){ toast('Amount और विवरण भरें'); return; }
        const q=sbNum(qi.value), r=sbNum(ri.value);
        if(q>0&&r>0) text += `  ${sbF(q)}×${sbF(r)}`;
        const red = forceRed? true : (segVal(bk)==='red');
        const rec={amt,text,red,ts:nowTS(),cut:false};
        if(editIdx!==null) SBM[sec][editIdx]=rec; else SBM[sec].push(rec);
        sbSave(SB_DATE,SBM); closePopup(); renderSBook();
      });
    }
  });
}

document.addEventListener('click',e=>{
  if(!e.target.closest('#sbook-screen')) return;
  const add=e.target.closest('[data-sbadd]');
  if(add){ openSBEntry(add.dataset.sbadd); return; }
  const ln=e.target.closest('.sb-line[data-sbsec]');
  if(ln){ openSBEntry(ln.dataset.sbsec, +ln.dataset.i); }
});

/* ---------- print (A4 — notebook जैसा एक ही page) ---------- */
function printSBook(){
  const host=document.createElement('div');
  host.innerHTML=`<div class="notebook sbook sbook-print">${sbookHTML(SB_DATE,false)}</div>`;
  printDocument(host.innerHTML,{landscape:true,stretch:true,grow:true});
}
(function(){
  const wire=()=>{ const b=document.querySelector('#sb-print-btn'); if(b&&!b._w){ b._w=1; b.addEventListener('click',printSBook); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
