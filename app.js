/* ================= SATYAM GOLD — App ================= */
'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const todayStr = () => { const d = new Date(); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };
const nowTS = () => new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
const fmt = n => (Math.round(n*100)/100).toLocaleString('en-IN');
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),2200); }

/* ---------- 3D background shapes ---------- */
(function(){
  const colors=['#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6'];
  const bg=$('#bg3d');
  for(let i=0;i<14;i++){
    const s=document.createElement('div'); s.className='bg-shape';
    const sz=30+Math.random()*90;
    s.style.cssText=`width:${sz}px;height:${sz}px;left:${Math.random()*95}%;top:${Math.random()*95}%;background:${colors[i%7]};animation-delay:${-Math.random()*14}s;animation-duration:${10+Math.random()*10}s;`;
    bg.appendChild(s);
  }
})();

/* ---------- navigation ---------- */
const SCREENS={login:'login-screen',home:'home-screen',notebook:'notebook-screen',sbook:'sbook-screen',orderbook:'orderbook-screen',attendance:'attendance-screen',call:'call-screen',emergency:'emergency-screen',chatai:'chatai-screen'};
function go(name){
  $$('.screen').forEach(s=>s.classList.remove('active'));
  $('#'+ (SCREENS[name]||SCREENS.home)).classList.add('active');
  window.scrollTo(0,0);
  if(name==='notebook') renderAll();
}
document.addEventListener('click',e=>{
  const g=e.target.closest('[data-go]');
  if(g){ const t=g.dataset.go; if(t==='printhome'){ go('notebook'); setTimeout(openPrintChoice,350); } else go(t); }
});
$('#nb-back').addEventListener('click',()=>go('home'));

/* ---------- login ---------- */
$('#login-form').addEventListener('submit',e=>{
  e.preventDefault();
  if($('#lg-phone').value==='9631816666' && $('#lg-pass').value==='Satyam'){ go('home'); }
  else { $('#login-err').style.display='block'; setTimeout(()=>$('#login-err').style.display='none',2500); }
});

/* ---------- state / storage ---------- */
const DATE = todayStr();
const KEY = 'sg_nb_'+DATE;
let DB = load();
function load(){ try{ return JSON.parse(localStorage.getItem(KEY))||blank(); }catch(e){ return blank(); } }
function blank(){ return {opening:null,rokad:[],jama:[],maal:[],nagad:[],kharch:[],totals:null}; }
function save(){ localStorage.setItem(KEY,JSON.stringify(DB)); }

const DEFAULT_RATES = { atta:1.25, bag_5_10:1, wheat_unloading:1, wheat_weight_unloading:1.5, chokar_loding:1, chokar_fill:1, wheat_fill:1, wheat_holar:1 };
function getRates(){ try{ return Object.assign({},DEFAULT_RATES,JSON.parse(localStorage.getItem('sg_rates')||'{}')); }catch(e){ return {...DEFAULT_RATES}; } }
function setRates(r){ localStorage.setItem('sg_rates',JSON.stringify(r)); }

const LABOUR_CATS = [
  {key:'atta',        name:'आटा लोडिंग',            short:'Atta Loding'},
  {key:'atta',        name:'सत्तू/बेसन लोडिंग',      short:'Sattu/Besan Loding', id:'sattu'},
  {key:'bag_5_10',    name:'5kg/10kg लोडिंग',        short:'5kg/10kg Loding'},
  {key:'wheat_unloading', name:'Wheat Unloading',    short:'Wheat Unloding'},
  {key:'wheat_weight_unloading', name:'Wheat Weight+Unloading', short:'Wheat Wt+Unlod'},
  {key:'chokar_loding', name:'चोकर लोडिंग',          short:'Chokar Loding'},
  {key:'chokar_fill', name:'चोकर Fill',              short:'Chokar Fill'},
  {key:'wheat_fill',  name:'Wheat Fill',             short:'Wheat Fill'},
  {key:'wheat_holar', name:'Wheat Holar',            short:'Wheat Holar'},
];

const ITEMS = { 'आटा':['गोल्ड','5kg','10kg','18kg'], 'सत्तू':['थैला 200g','थैला 500g'], 'बेसन':['थैला 200g','थैला 500g'], 'चोकर':['चोकर'] };

/* ---------- popup factory ---------- */
const ROOT = $('#popups-root');
function popup({title,body,foot,onOpen}){
  closePopup();
  const bk=document.createElement('div'); bk.className='pp-back open'; bk.id='live-popup';
  bk.innerHTML=`<div class="pp"><div class="pp-head">${title}</div><div class="pp-body">${body}</div><div class="pp-foot">${foot||''}</div></div>`;
  bk.addEventListener('click',e=>{ if(e.target===bk) closePopup(); });
  ROOT.appendChild(bk);
  if(onOpen) onOpen(bk);
  return bk;
}
function closePopup(){ const p=$('#live-popup'); if(p) p.remove(); }

function segRow(label,opts,sel){ // payment segments
  return `<div class="f-row"><label>${label}</label><div class="pay-seg">${opts.map(o=>`<div class="seg${o.v===sel?' sel':''}" data-v="${o.v}">${o.t}</div>`).join('')}</div></div>`;
}
function wireSeg(bk,cb){ bk.querySelectorAll('.pay-seg').forEach(sg=>sg.addEventListener('click',e=>{ const s=e.target.closest('.seg'); if(!s)return; sg.querySelectorAll('.seg').forEach(x=>x.classList.remove('sel')); s.classList.add('sel'); if(cb)cb(s.dataset.v,sg); })); }
function segVal(bk,idx=0){ const sgs=bk.querySelectorAll('.pay-seg'); const s=sgs[idx]?.querySelector('.seg.sel'); return s?s.dataset.v:null; }

/* =========================================================
   1) रोकड + नगदी बिक्री
========================================================= */
let rokadCart=[], rokadSel={item:null,sub:null};
function openRokad(editIdx=null){
  rokadCart=[]; rokadSel={item:null,sub:null};
  if(editIdx!==null){ rokadCart=JSON.parse(JSON.stringify(DB.rokad[editIdx].items)); }
  const bk=popup({
    title:'रोकड + नगदी बिक्री',
    body:`<div id="rk-step1">
        <div class="hint">Item चुनें 👇</div>
        <div class="chip-grid">${Object.keys(ITEMS).map(k=>`<div class="chip" data-item="${k}">${k}</div>`).join('')}</div>
        <div class="cart-view" id="rk-cart"></div>
      </div>
      <div id="rk-step2" style="display:none;">
        <div class="hint" id="rk-sub-hint"></div>
        <div class="chip-grid" id="rk-sub-grid"></div>
      </div>
      <div id="rk-step3" style="display:none;">
        <h3 style="text-align:center;margin-bottom:12px;font-family:'Noto Sans Devanagari';" id="rk-sel-name"></h3>
        <div class="f-row"><label>मात्रा (Qty)</label><input type="number" id="rk-qty" inputmode="decimal"></div>
        <div class="f-row"><label>Rate (1 का)</label><input type="number" id="rk-price" inputmode="decimal"></div>
        <div class="f-row"><label>Total</label><div class="ro" id="rk-total">0</div></div>
        ${segRow('Payment',[{v:'cash',t:'💵 Cash'},{v:'online',t:'🏦 A/C'},{v:'mix',t:'🔀 Mix'}],'cash')}
        <div id="rk-mix" style="display:none;">
          <div class="f-row"><label>Cash Paid</label><input type="number" id="rk-cash" inputmode="decimal"></div>
          <div class="f-row"><label>Online A/C</label><input type="number" id="rk-online" inputmode="decimal"></div>
        </div>
      </div>`,
    foot:`<button class="pp-btn addmore" id="rk-add">+ Add Item</button>
      <div style="display:flex;gap:8px;"><button class="pp-btn cancel" id="rk-cancel">Cancel</button><button class="pp-btn save" id="rk-save">✓ Save</button></div>`,
    onOpen(bk){
      const show=(n)=>{['rk-step1','rk-step2','rk-step3'].forEach((id,i)=>bk.querySelector('#'+id).style.display=(i===n-1?'block':'none'));};
      const renderCart=()=>{ const c=bk.querySelector('#rk-cart');
        c.innerHTML='<b>अभी तक:</b> '+(rokadCart.length? rokadCart.map(x=>`<div>• ${x.item} ${x.sub} ${x.qty}×${x.price} = <b>${fmt(x.total)}</b>${x.online>0?` <span style="color:#c0392b">(A/C ${x.online===x.total?'':fmt(x.online)})</span>`:''}</div>`).join(''):' (खाली)'); };
      renderCart();
      bk.querySelectorAll('[data-item]').forEach(ch=>ch.addEventListener('click',()=>{
        rokadSel.item=ch.dataset.item;
        const subs=ITEMS[rokadSel.item];
        if(subs.length===1){ rokadSel.sub=subs[0]; startQty(); return; }
        bk.querySelector('#rk-sub-hint').textContent=rokadSel.item+' — type चुनें';
        bk.querySelector('#rk-sub-grid').innerHTML=subs.map(s=>`<div class="chip" data-sub="${s}">${s}</div>`).join('');
        bk.querySelectorAll('[data-sub]').forEach(sc=>sc.addEventListener('click',()=>{ rokadSel.sub=sc.dataset.sub; startQty(); }));
        show(2);
      }));
      function startQty(){
        bk.querySelector('#rk-sel-name').textContent=rokadSel.item+' — '+rokadSel.sub;
        ['rk-qty','rk-price','rk-cash','rk-online'].forEach(id=>bk.querySelector('#'+id).value='');
        bk.querySelector('#rk-total').textContent='0';
        show(3); bk.querySelector('#rk-qty').focus();
      }
      const upd=()=>{ const t=(parseFloat(bk.querySelector('#rk-qty').value)||0)*(parseFloat(bk.querySelector('#rk-price').value)||0); bk.querySelector('#rk-total').textContent=fmt(t); };
      bk.querySelector('#rk-qty').addEventListener('input',upd);
      bk.querySelector('#rk-price').addEventListener('input',upd);
      wireSeg(bk,v=>{ bk.querySelector('#rk-mix').style.display = v==='mix'?'block':'none'; });
      bk.querySelector('#rk-cash').addEventListener('input',()=>{ const t=parseFloat(bk.querySelector('#rk-total').textContent.replace(/,/g,''))||0; bk.querySelector('#rk-online').value=Math.max(0,t-(parseFloat(bk.querySelector('#rk-cash').value)||0)); });
      bk.querySelector('#rk-online').addEventListener('input',()=>{ const t=parseFloat(bk.querySelector('#rk-total').textContent.replace(/,/g,''))||0; bk.querySelector('#rk-cash').value=Math.max(0,t-(parseFloat(bk.querySelector('#rk-online').value)||0)); });
      function collect(){
        const qty=parseFloat(bk.querySelector('#rk-qty').value)||0, price=parseFloat(bk.querySelector('#rk-price').value)||0;
        if(bk.querySelector('#rk-step3').style.display==='none') return true; // nothing pending
        if(qty<=0||price<=0){ toast('Qty और Rate भरें'); return false; }
        const total=qty*price; const pay=segVal(bk);
        let cash=total, online=0;
        if(pay==='online'){ cash=0; online=total; }
        else if(pay==='mix'){ cash=parseFloat(bk.querySelector('#rk-cash').value)||0; online=parseFloat(bk.querySelector('#rk-online').value)||0;
          if(Math.abs(cash+online-total)>0.01){ toast('Cash + A/C = Total होना चाहिए'); return false; } }
        rokadCart.push({item:rokadSel.item,sub:rokadSel.sub,qty,price,total,cash,online});
        return true;
      }
      bk.querySelector('#rk-add').addEventListener('click',()=>{ if(bk.querySelector('#rk-step3').style.display!=='none'){ if(!collect())return; } renderCart(); show(1); });
      bk.querySelector('#rk-cancel').addEventListener('click',closePopup);
      bk.querySelector('#rk-save').addEventListener('click',()=>{
        if(!collect())return;
        if(!rokadCart.length){ toast('कोई item नहीं जोड़ा गया'); return; }
        const total=rokadCart.reduce((a,x)=>a+x.total,0), cash=rokadCart.reduce((a,x)=>a+x.cash,0), online=rokadCart.reduce((a,x)=>a+x.online,0);
        if(editIdx!==null){ Object.assign(DB.rokad[editIdx],{items:rokadCart,total,cash,online}); }
        else DB.rokad.push({items:rokadCart,total,cash,online,ts:nowTS(),cut:false});
        save(); closePopup(); renderAll();
        if(DB.opening===null) setTimeout(openOpening,250);
      });
    }
  });
}

/* opening amount beside रोकड header */
function openOpening(){
  popup({
    title:'रोकड — शुरुआती रक़म (Opening)',
    body:`<div class="pp-note">रोकड + नगदी बिक्री के बगल में लिखने वाला Amount</div>
      <div class="f-row"><label>Amount</label><input type="number" id="op-amt" inputmode="decimal" value="${DB.opening??''}"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="op-save">✓ Save</button></div>`,
    onOpen(bk){
      bk.querySelector('#op-amt').focus();
      bk.querySelector('#op-save').addEventListener('click',()=>{ DB.opening=parseFloat(bk.querySelector('#op-amt').value)||0; save(); closePopup(); renderAll(); });
    }
  });
}

/* =========================================================
   2) जमा खाते नाम
========================================================= */
function openJama(editIdx=null){
  const e = editIdx!==null? DB.jama[editIdx] : {};
  popup({
    title:'जमा खाते नाम',
    body:`<div class="f-row"><label>नाम</label><input type="text" id="jm-name" value="${e.name||''}"></div>
      <div class="f-row"><label>पता</label><input type="text" id="jm-addr" value="${e.address||''}"></div>
      <div class="f-row"><label>Amount</label><input type="number" id="jm-amt" inputmode="decimal" value="${e.amount??''}"></div>
      ${segRow('Payment',[{v:'cash',t:'💵 Cash'},{v:'online',t:'🏦 A/C'}], e.online>0?'online':'cash')}`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="jm-save">✓ Save</button></div>`,
    onOpen(bk){
      wireSeg(bk);
      bk.querySelector('#jm-save').addEventListener('click',()=>{
        const name=bk.querySelector('#jm-name').value.trim(), amt=parseFloat(bk.querySelector('#jm-amt').value)||0;
        if(!name||amt<=0){ toast('नाम और Amount भरें'); return; }
        const online = segVal(bk)==='online' ? amt : 0;
        const rec={name,address:bk.querySelector('#jm-addr').value.trim(),amount:amt,online,ts:e.ts||nowTS(),cut:e.cut||false};
        if(editIdx!==null) DB.jama[editIdx]=rec; else DB.jama.push(rec);
        save(); closePopup(); renderAll();
      });
    }
  });
}

/* =========================================================
   3) माल आवत खाते
========================================================= */
function openMaal(editIdx=null){
  const e = editIdx!==null? DB.maal[editIdx] : {};
  const serial = e.serial || (DB.maal.length+1);
  popup({
    title:'माल आवत खाते',
    body:`<div class="pp-note">Serial No: <b>${serial}</b> &nbsp;|&nbsp; Weight/Rate बाद में भी भर सकते हैं ✏️</div>
      <div class="f-row"><label>नाम (Name)</label><input type="text" id="ml-name" value="${e.name||''}"></div>
      <div class="f-row"><label>पता (Address)</label><input type="text" id="ml-addr" value="${e.address||''}"></div>
      <div class="f-row"><label>Total बोरा (Pic)</label><input type="number" id="ml-pic" inputmode="numeric" value="${e.pic??''}"></div>
      <div class="f-row"><label>Dust (D)</label><input type="number" id="ml-dust" inputmode="numeric" placeholder="0" value="${e.dust??''}"></div>
      <div class="f-row"><label>Plastic बोरा (P)</label><input type="number" id="ml-plastic" inputmode="numeric" placeholder="0" value="${e.plastic??''}"></div>
      <hr style="border:none;border-top:1.5px dashed #dde3ec;margin:8px 0 12px;">
      <div class="f-row"><label>Gross Weight</label><input type="number" id="ml-gross" inputmode="decimal" placeholder="बाद में" value="${e.gross??''}"></div>
      <div class="f-row"><label>Tare Weight</label><input type="number" id="ml-tare" inputmode="decimal" placeholder="बाद में" value="${e.tare??''}"></div>
      <div class="f-row"><label>Nett Weight</label><input type="number" id="ml-nett" inputmode="decimal" placeholder="बाद में" value="${e.nett??''}"></div>
      <div class="f-row"><label>Rate (सौदा)</label><input type="number" id="ml-rate" inputmode="decimal" placeholder="बाद में summit" value="${e.rate??''}"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="ml-save">✓ Save</button></div>`,
    onOpen(bk){
      const g=id=>bk.querySelector('#'+id);
      const autoNett=()=>{ const gr=parseFloat(g('ml-gross').value), tr=parseFloat(g('ml-tare').value); if(!isNaN(gr)&&!isNaN(tr)&&g('ml-nett').value==='') g('ml-nett').value=(gr-tr); };
      g('ml-gross').addEventListener('change',autoNett); g('ml-tare').addEventListener('change',autoNett);
      g('ml-save').addEventListener('click',()=>{
        const name=g('ml-name').value.trim(), pic=parseFloat(g('ml-pic').value);
        if(!name||!(pic>0)){ toast('नाम और Total बोरा भरें'); return; }
        const num=id=>{ const v=g(id).value.trim(); return v===''?null:parseFloat(v); };
        const rec={serial,name,address:g('ml-addr').value.trim(),pic,
          dust:num('ml-dust')??0,plastic:num('ml-plastic')??0,
          gross:num('ml-gross'),tare:num('ml-tare'),nett:num('ml-nett'),rate:num('ml-rate'),
          ts:e.ts||nowTS(),cut:e.cut||false};
        if(editIdx!==null) DB.maal[editIdx]=rec; else DB.maal.push(rec);
        save(); closePopup(); renderAll();
      });
    }
  });
}

/* =========================================================
   4) नगद नाम खाते  (serial auto-fill, home/ac/counter)
========================================================= */
function openNagad(editIdx=null){
  const e = editIdx!==null? DB.nagad[editIdx] : {};
  popup({
    title:'नगद नाम खाते',
    body:`<div class="pp-note">माल आवत का Serial No डालें → नाम-पता अपने आप 🪄</div>
      <div class="f-row"><label>Serial No</label><input type="number" id="ng-serial" inputmode="numeric" placeholder="(optional)" value="${e.serialRef??''}"></div>
      <div class="f-row"><label>नाम</label><input type="text" id="ng-name" value="${e.name||''}"></div>
      <div class="f-row"><label>पता</label><input type="text" id="ng-addr" value="${e.address||''}"></div>
      <div class="f-row"><label>Amount</label><input type="number" id="ng-amt" inputmode="decimal" value="${e.amount??''}"></div>
      ${segRow('कहाँ से दिया',[{v:'cash',t:'💵 Mill'},{v:'online',t:'🏦 A/C'},{v:'home',t:'🏠 Home'},{v:'counter',t:'🛒 Con-ter'}], e.mode||'cash')}
      <div class="f-row"><label>Item ले गया</label><select id="ng-item"><option value="">— नहीं —</option>${['आटा बोरा','सत्तू','बेसन','आटा','चोकर'].map(x=>`<option ${e.item===x?'selected':''}>${x}</option>`).join('')}</select></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="ng-save">✓ Save</button></div>`,
    onOpen(bk){
      wireSeg(bk);
      bk.querySelector('#ng-serial').addEventListener('input',()=>{
        const sn=parseInt(bk.querySelector('#ng-serial').value);
        const m=DB.maal.find(x=>x.serial===sn);
        if(m){ bk.querySelector('#ng-name').value=m.name; bk.querySelector('#ng-addr').value=m.address||''; toast('Serial '+sn+' → '+m.name); }
      });
      bk.querySelector('#ng-save').addEventListener('click',()=>{
        const name=bk.querySelector('#ng-name').value.trim(), amt=parseFloat(bk.querySelector('#ng-amt').value)||0;
        if(!name||amt<=0){ toast('नाम और Amount भरें'); return; }
        const rec={name,address:bk.querySelector('#ng-addr').value.trim(),amount:amt,
          serialRef:parseInt(bk.querySelector('#ng-serial').value)||null,
          mode:segVal(bk)||'cash', item:bk.querySelector('#ng-item').value||'',
          ts:e.ts||nowTS(),cut:e.cut||false};
        if(editIdx!==null) DB.nagad[editIdx]=rec; else DB.nagad.push(rec);
        save(); closePopup(); renderAll();
      });
    }
  });
}

/* =========================================================
   5) नगद खर्च  (mill / advance-pending / labour / van)
========================================================= */
function openKharch(editIdx=null){
  const e = editIdx!==null? DB.kharch[editIdx] : null;
  if(e && e.type==='pending' && e.pending){ return openPendingFill(editIdx); }
  if(e && e.type==='labour'){ return openLabour(editIdx); }
  popup({
    title:'नगद खर्च',
    body:`<div class="f-row"><label>खर्च Type</label><select id="kh-type">
        <option value="mill">🏭 मिल खर्च</option>
        <option value="pending">⏳ Advance (बाद में exact)</option>
        <option value="labour">👷 Labour</option>
        <option value="van">🚐 वेन</option>
      </select></div>
      <div id="kh-mill">
        <div class="f-row"><label>खर्च का नाम</label><input type="text" id="kh-name" value="${e?(e.name||''):''}"></div>
        <div class="f-row"><label>अमाउंट</label><input type="number" id="kh-amt" inputmode="decimal" value="${e?(e.amount??''):''}"></div>
      </div>
      <div id="kh-pending" style="display:none;">
        <div class="pp-note">अभी सिर्फ़ ₹ दिया — exact खर्च बाद में entry पर click कर के भरें</div>
        <div class="f-row"><label>किसको / नाम</label><input type="text" id="kh-p-name"></div>
        <div class="f-row"><label>दिया अमाउंट</label><input type="number" id="kh-p-amt" inputmode="decimal"></div>
      </div>
      <div id="kh-van" style="display:none;">
        <div class="f-row"><label>वेन Option</label><select id="kh-van-type"><option value="gadi">🚐 गाड़ी खर्च</option><option value="petrol">⛽ Petrol</option></select></div>
        <div id="kh-van-petrol" style="display:none;">
          ${segRow('गाड़ी',[{v:'van',t:'🚐 Van'},{v:'bike',t:'🏍️ Bike'}],'van')}
          <div id="kh-van-details">
            <div class="f-row"><label>Van No</label><input type="text" id="kh-van-no" placeholder="जैसे 227"></div>
            <div class="f-row"><label>Driver नाम</label><input type="text" id="kh-driver"></div>
          </div>
        </div>
        <div class="f-row"><label>अमाउंट</label><input type="number" id="kh-van-amt" inputmode="decimal"></div>
      </div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="kh-save">✓ Save</button></div>`,
    onOpen(bk){
      wireSeg(bk,()=>{ const isVan = bk.querySelector('.pay-seg .seg.sel')?.dataset.v==='van'; bk.querySelector('#kh-van-details').style.display = isVan?'block':'none'; });
      const typeSel=bk.querySelector('#kh-type');
      typeSel.addEventListener('change',()=>{
        const v=typeSel.value;
        if(v==='labour'){ closePopup(); openLabour(); return; }
        bk.querySelector('#kh-mill').style.display = v==='mill'?'block':'none';
        bk.querySelector('#kh-pending').style.display = v==='pending'?'block':'none';
        bk.querySelector('#kh-van').style.display = v==='van'?'block':'none';
      });
      bk.querySelector('#kh-van-type').addEventListener('change',()=>{
        bk.querySelector('#kh-van-petrol').style.display = bk.querySelector('#kh-van-type').value==='petrol'?'block':'none';
      });
      bk.querySelector('#kh-save').addEventListener('click',()=>{
        const v=typeSel.value; let rec=null;
        if(v==='mill'){
          const name=bk.querySelector('#kh-name').value.trim(), amt=parseFloat(bk.querySelector('#kh-amt').value)||0;
          if(!name||amt<=0){ toast('नाम और अमाउंट भरें'); return; }
          rec={type:'mill',name,amount:amt};
        }else if(v==='pending'){
          const name=bk.querySelector('#kh-p-name').value.trim(), amt=parseFloat(bk.querySelector('#kh-p-amt').value)||0;
          if(!name||amt<=0){ toast('नाम और अमाउंट भरें'); return; }
          rec={type:'pending',name,amount:amt,pending:true,given:amt};
        }else if(v==='van'){
          const amt=parseFloat(bk.querySelector('#kh-van-amt').value)||0;
          if(amt<=0){ toast('अमाउंट भरें'); return; }
          const vt=bk.querySelector('#kh-van-type').value;
          if(vt==='gadi'){ rec={type:'van',name:'गाड़ी खर्च',amount:amt}; }
          else{
            const veh=segVal(bk)||'van';
            if(veh==='bike'){ rec={type:'van',name:'Bike (Petrol)',amount:amt}; }
            else{
              const no=bk.querySelector('#kh-van-no').value.trim(), dr=bk.querySelector('#kh-driver').value.trim();
              rec={type:'van',name:`Van${no||''} (Petrol)${dr?' '+dr:''}`,amount:amt};
            }
          }
        }
        rec.ts=e?e.ts:nowTS(); rec.cut=e?e.cut:false;
        if(editIdx!==null) DB.kharch[editIdx]=rec; else DB.kharch.push(rec);
        save(); closePopup(); renderAll();
      });
      if(e){ typeSel.value=e.type==='van'?'van':'mill'; typeSel.dispatchEvent(new Event('change')); }
    }
  });
}

/* pending → fill exact later */
function openPendingFill(idx){
  const e=DB.kharch[idx];
  popup({
    title:'⏳ Advance खर्च — Exact भरें',
    body:`<div class="pp-note"><b>${e.name}</b> को ₹${fmt(e.given)} दिया था — अब exact खर्च भरें</div>
      <div class="f-row"><label>खर्च का नाम</label><input type="text" id="pf-name" value="${e.name}"></div>
      <div class="f-row"><label>Exact अमाउंट</label><input type="number" id="pf-amt" inputmode="decimal" value="${e.given}"></div>`,
    foot:`<button class="pp-btn cancel" onclick="closePopup()">बाद में</button>
      <button class="pp-btn save" id="pf-save">✓ Exact Save</button>`,
    onOpen(bk){
      bk.querySelector('#pf-amt').focus();
      bk.querySelector('#pf-save').addEventListener('click',()=>{
        const amt=parseFloat(bk.querySelector('#pf-amt').value)||0;
        if(amt<=0){ toast('अमाउंट भरें'); return; }
        e.name=bk.querySelector('#pf-name').value.trim()||e.name;
        e.amount=amt; e.pending=false;
        save(); closePopup(); renderAll(); toast('Exact खर्च save ✔');
      });
    }
  });
}

/* Labour multi-category */
function openLabour(editIdx=null){
  const rates=getRates();
  const e = editIdx!==null? DB.kharch[editIdx] : null;
  const rows=LABOUR_CATS.map((c,i)=>{
    const prev = e? (e.labour.find(l=>l.name===c.name)||{}) : {};
    return `<div class="lab-qty-grid"><div class="lname">${c.name} <small style="color:#98a1b3">@${rates[c.key]}</small></div>
      <input type="number" inputmode="decimal" class="lab-qty" data-i="${i}" placeholder="बोरा" value="${prev.qty??''}">
      <div class="lamt" data-i="${i}">${prev.amt?fmt(prev.amt):'—'}</div></div>`;
  }).join('');
  popup({
    title:'👷 Labour खर्च',
    body:`<div class="pp-note">बोरा number भरें → अमाउंट अपने आप (rate से multiply)</div>
      ${rows}
      <div class="lab-qty-grid"><div class="lname">➕ Add Amount</div>
        <input type="number" inputmode="decimal" id="lab-add" placeholder="₹" value="${e? (e.labour.find(l=>l.name==='Add Amount')?.amt??'') : ''}">
        <div class="lamt" id="lab-add-show">—</div></div>
      <div class="big-total-preview" id="lab-total">Total: ₹0</div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="lab-save">✓ Final Submit</button></div>`,
    onOpen(bk){
      const recompute=()=>{
        let total=0;
        bk.querySelectorAll('.lab-qty').forEach(inp=>{
          const i=+inp.dataset.i, q=parseFloat(inp.value)||0, amt=q*rates[LABOUR_CATS[i].key];
          bk.querySelector(`.lamt[data-i="${i}"]`).textContent = q>0? fmt(amt):'—';
          total+=amt;
        });
        const add=parseFloat(bk.querySelector('#lab-add').value)||0;
        bk.querySelector('#lab-add-show').textContent = add>0? fmt(add):'—';
        total+=add;
        bk.querySelector('#lab-total').textContent='Total: ₹'+fmt(total);
        return total;
      };
      bk.querySelectorAll('.lab-qty').forEach(i=>i.addEventListener('input',recompute));
      bk.querySelector('#lab-add').addEventListener('input',recompute);
      recompute();
      bk.querySelector('#lab-save').addEventListener('click',()=>{
        const labour=[];
        bk.querySelectorAll('.lab-qty').forEach(inp=>{
          const i=+inp.dataset.i, q=parseFloat(inp.value)||0;
          if(q>0) labour.push({name:LABOUR_CATS[i].name,short:LABOUR_CATS[i].short,qty:q,amt:q*rates[LABOUR_CATS[i].key]});
        });
        const add=parseFloat(bk.querySelector('#lab-add').value)||0;
        if(add>0) labour.push({name:'Add Amount',short:'Add Amount',qty:null,amt:add});
        if(!labour.length){ toast('कुछ भरें'); return; }
        const total=labour.reduce((a,x)=>a+x.amt,0);
        const rec={type:'labour',name:'Labour',amount:total,labour,ts:e?e.ts:nowTS(),cut:e?e.cut:false};
        if(editIdx!==null) DB.kharch[editIdx]=rec; else DB.kharch.push(rec);
        save(); closePopup(); renderAll();
      });
    }
  });
}

/* Rate settings — double-click नगद खर्च header, password = hour + date */
let khHeadClicks=0, khHeadTimer=null;
$('#kharch-head').addEventListener('click',()=>{
  khHeadClicks++;
  clearTimeout(khHeadTimer);
  khHeadTimer=setTimeout(()=>{
    if(khHeadClicks>=2) openRatePassword();
    else openKharch();
    khHeadClicks=0;
  },340);
});
function currentPassword(){
  const d=new Date(); let h=d.getHours()%12; if(h===0)h=12;
  return `${h}${String(d.getDate()).padStart(2,'0')}`;
}
function openRatePassword(){
  popup({
    title:'🔐 Rate Settings — Password',
    body:`<div class="pp-note">Password = अभी का घंटा + आज की तारीख़</div>
      <div class="f-row"><label>Password</label><input type="password" id="rp-pass" inputmode="numeric"></div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="rp-go">Unlock 🔓</button></div>`,
    onOpen(bk){
      bk.querySelector('#rp-pass').focus();
      bk.querySelector('#rp-go').addEventListener('click',()=>{
        if(bk.querySelector('#rp-pass').value===currentPassword()){ closePopup(); openRateSettings(); }
        else toast('गलत Password ❌');
      });
    }
  });
}
function openRateSettings(){
  const rates=getRates();
  const defs=[
    {k:'atta', n:'आटा / सत्तू / बेसन लोडिंग (1 pc)'},
    {k:'bag_5_10', n:'5kg / 10kg (1 pc)'},
    {k:'wheat_unloading', n:'Wheat Unloading'},
    {k:'wheat_weight_unloading', n:'Wheat Weight + Unloading'},
    {k:'chokar_loding', n:'चोकर लोडिंग'},
    {k:'chokar_fill', n:'चोकर Fill'},
    {k:'wheat_fill', n:'Wheat Fill'},
    {k:'wheat_holar', n:'Wheat Holar'},
  ];
  popup({
    title:'⚙️ Labour Rate Settings',
    body:`<div class="rate-grid">${defs.map(d=>`<div class="rname">${d.n}</div><input type="number" step="0.01" data-rk="${d.k}" value="${rates[d.k]}">`).join('')}</div>`,
    foot:`<span></span><div style="display:flex;gap:8px;"><button class="pp-btn cancel" onclick="closePopup()">Cancel</button><button class="pp-btn save" id="rt-save">✓ Save Rates</button></div>`,
    onOpen(bk){
      bk.querySelector('#rt-save').addEventListener('click',()=>{
        const r=getRates();
        bk.querySelectorAll('[data-rk]').forEach(i=>{ r[i.dataset.rk]=parseFloat(i.value)||0; });
        setRates(r); closePopup(); toast('Rates save ✔');
      });
    }
  });
}

/* =========================================================
   RENDER
========================================================= */
function esc(s){ return String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

function renderAll(){
  $('#nb-date-l').textContent=DATE; $('#nb-date-r').textContent=DATE;
  $('#rokad-head-amt').textContent = DB.opening!==null? fmt(DB.opening):'';

  /* rokad */
  $('#col-rokad').innerHTML = DB.rokad.map((r,i)=>{
    const lines=r.items.map(it=>{
      let v=it.sub; if(v==='गोल्ड')v='g'; if(v==='चोकर')v='';
      let pay='';
      if(it.online>0&&it.cash>0) pay=` <span class="pay-mix">(<span class="cash-part">${fmt(it.cash)}</span>+<span class="ac-part">${fmt(it.online)} A/C</span>)</span>`;
      else if(it.online>0) pay=` <span class="ac-mark">(A/C)</span>`;
      return `<div><span class="amt">${fmt(it.total)}</span>${esc(it.item)} ${esc(v)} ${it.qty}×${fmt(it.price)}${pay}</div>`;
    }).join('');
    return `<div class="hw-entry ${r.cut?'cut':''} ${r.online>0&&r.cash===0?'is-ac':''}" data-sec="rokad" data-i="${i}">${lines}<span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="rokad" data-i="${i}">✏️</span></div>`;
  }).join('') || `<div style="color:#c3cad6;font-family:'Kalam';padding:14px 4px;">यहाँ click करें → बिक्री entry…</div>`;

  /* jama */
  $('#col-jama').innerHTML = DB.jama.map((r,i)=>
    `<div class="hw-entry ${r.cut?'cut':''} ${r.online>0?'is-ac':''}" data-sec="jama" data-i="${i}">
      <span class="amt">${fmt(r.amount)}</span>${esc(r.name)}${r.address?` <small>(${esc(r.address)})</small>`:''}${r.online>0?` <span class="ac-mark">A/C</span>`:''}
      <span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="jama" data-i="${i}">✏️</span></div>`
  ).join('') || `<div style="color:#c3cad6;font-family:'Kalam';padding:14px 4px;">यहाँ click करें → जमा entry…</div>`;

  /* maal */
  $('#col-maal').innerHTML = DB.maal.map((r,i)=>{
    const w=(v,lbl)=>`<span class="m-lbl">${lbl}</span>-${v===null||v===undefined?'<span style="color:#b6bcc9">—</span>':fmt(v)}`;
    return `<div class="hw-entry maal-entry ${r.cut?'cut':''}" data-sec="maal" data-i="${i}">
      <div class="m-top">
        <div class="m-left">
          <div class="m-name"><span class="maal-serial">${r.serial}</span>${esc(r.name)}${r.address?` <small>(${esc(r.address)})</small>`:''}</div>
          <div class="m-line">${w(r.gross,'GROSS')} &nbsp; ${w(r.tare,'TARE')}</div>
          <div class="m-line">${w(r.nett,'NETT')}</div>
        </div>
        <div class="maal-badge"><span class="dp">D&nbsp;&nbsp;P</span>${r.pic} = ${r.dust}/${r.plastic}</div>
        <div class="maal-rate ${r.rate===null?'empty':''}">RATE-${r.rate===null?'?':fmt(r.rate)}</div>
      </div>
      <span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="maal" data-i="${i}">✏️</span></div>`;
  }).join('') || `<div style="color:#c3cad6;font-family:'Kalam';padding:14px 4px;">यहाँ click करें → माल आवत entry…</div>`;

  /* nagad */
  const modeTag={cash:'',online:' <span class="ac-mark">A/C</span>',home:' <b>(Home)</b>',counter:' (Con-ter)'};
  $('#col-nagad').innerHTML = DB.nagad.map((r,i)=>
    `<div class="hw-entry ${r.cut?'cut':''} ${r.mode==='online'?'is-ac':''} ${r.mode==='home'?'is-home':''}" data-sec="nagad" data-i="${i}">
      <span class="amt">${fmt(r.amount)}</span>${esc(r.name)}${r.address?` <small>(${esc(r.address)})</small>`:''}${r.item?` — ${esc(r.item)}`:''}${modeTag[r.mode]||''}
      <span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="nagad" data-i="${i}">✏️</span></div>`
  ).join('') || `<div style="color:#c3cad6;font-family:'Kalam';padding:14px 4px;">यहाँ click करें → नगद नाम entry…</div>`;

  /* kharch */
  $('#col-kharch').innerHTML = DB.kharch.map((r,i)=>{
    if(r.type==='labour'){
      return `<div class="hw-entry labour-entry ${r.cut?'cut':''}" data-sec="kharch" data-i="${i}">
        <div class="lab-head"><span class="lab-total amt">${fmt(r.amount)}</span> Labour</div>
        <div class="branches">${r.labour.map(l=>`<div><span class="b-amt">${fmt(l.amt)}</span>${esc(l.short)}${l.qty?` (${l.qty})`:''}</div>`).join('')}</div>
        <span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="kharch" data-i="${i}">✏️</span></div>`;
    }
    return `<div class="hw-entry ${r.cut?'cut':''} ${r.pending?'pending-kharch':''}" data-sec="kharch" data-i="${i}">
      <span class="amt">${fmt(r.amount)}</span>${esc(r.name)}${r.pending?'<span class="pending-tag">Exact बाद में ⏳</span>':''}
      <span class="ts">${r.ts}</span><span class="edit-pencil" data-edit="kharch" data-i="${i}">✏️</span></div>`;
  }).join('') || `<div style="color:#c3cad6;font-family:'Kalam';padding:10px 4px;">यहाँ click करें → खर्च entry…</div>`;

  renderTotals();
}

/* ---------- totals ---------- */
function computeTotals(){
  const alive=a=>a.filter(x=>!x.cut);
  const rokadAdd = (DB.opening||0) + alive(DB.rokad).reduce((a,x)=>a+x.total,0);
  const rokadAC  = alive(DB.rokad).reduce((a,x)=>a+x.online,0);
  const jamaAdd  = alive(DB.jama).reduce((a,x)=>a+x.amount,0);
  const jamaAC   = alive(DB.jama).reduce((a,x)=>a+x.online,0);
  const ng=alive(DB.nagad).filter(x=>x.mode!=='home');   // home excluded completely
  const nagadAdd = ng.reduce((a,x)=>a+x.amount,0);
  const nagadAC  = ng.filter(x=>x.mode==='online').reduce((a,x)=>a+x.amount,0);
  const kharchT  = alive(DB.kharch).reduce((a,x)=>a+x.amount,0);
  return {
    rokadAdd,rokadAC,rokadFinal:rokadAdd-rokadAC,
    jamaAdd,jamaAC,jamaFinal:jamaAdd-jamaAC,
    nagadAdd,nagadAC,nagadFinal:nagadAdd-nagadAC,
    kharchT,
    grand:(rokadAdd-rokadAC)+(jamaAdd-jamaAC)+(nagadAdd-nagadAC)+kharchT
  };
}

function totalBlockHTML(add,ac,fin,label,extra=''){
  return `<div class="total-block">
    <div class="t-line"></div>
    <div class="t-row"><span class="t-num">${fmt(add)}</span></div>
    <div class="t-row red"><span class="t-num">-${fmt(ac)}</span><span class="t-lbl">A/C</span></div>
    <div class="t-line"></div>
    <div class="t-row green"><span class="t-num">${fmt(fin)}</span><span class="t-lbl final-name">→ ${label}</span></div>
    ${extra}</div>`;
}

function renderTotals(){
  // remove old
  $$('.total-block,.grand-block').forEach(x=>x.remove());
  if(!DB.totals) return;
  const T=DB.totals;
  const grand=`<div class="grand-block">
      <div class="t-row"><span class="t-num">${fmt(T.rokadFinal)}</span><span class="t-lbl">रोकड + नगदी बिक्री</span></div>
      <div class="t-row"><span class="t-num">${fmt(T.jamaFinal)}</span><span class="t-lbl">जमा खाते नाम</span></div>
      <div class="t-row"><span class="t-num">${fmt(T.nagadFinal)}</span><span class="t-lbl">नगद नाम खाते</span></div>
      <div class="t-row"><span class="t-num">${fmt(T.kharchT)}</span><span class="t-lbl">नगद खर्च</span></div>
      <div class="t-line double"></div>
      <div class="t-row green" style="font-size:1.25em;"><span class="t-num">${fmt(T.grand)}</span><span class="t-lbl">कुल Total</span></div>
    </div>`;
  $('#col-rokad').insertAdjacentHTML('beforeend', totalBlockHTML(T.rokadAdd,T.rokadAC,T.rokadFinal,'रोकड + नगदी बिक्री',grand));
  $('#col-jama').insertAdjacentHTML('beforeend', totalBlockHTML(T.jamaAdd,T.jamaAC,T.jamaFinal,'जमा खाते नाम'));
  $('#col-nagad').insertAdjacentHTML('beforeend', totalBlockHTML(T.nagadAdd,T.nagadAC,T.nagadFinal,'नगद नाम खाते'));
  $('#col-kharch').insertAdjacentHTML('beforeend', `<div class="total-block"><div class="t-line"></div>
    <div class="t-row green"><span class="t-num">${fmt(T.kharchT)}</span><span class="t-lbl final-name">→ नगद खर्च Total</span></div></div>`);
}

$('#nb-total-btn').addEventListener('click',()=>{ DB.totals=computeTotals(); save(); renderAll(); toast('Total बन गया ✔'); });
$('#nb-clear-total').addEventListener('click',()=>{ DB.totals=null; save(); renderAll(); });

/* ---------- column click / entry interactions ---------- */
const SEC_OPEN={rokad:openRokad,jama:openJama,maal:openMaal,nagad:openNagad,kharch:openKharch};
const clickState={};
function handleEntryTap(entry){
  const key=entry.dataset.sec+entry.dataset.i;
  clickState[key]=(clickState[key]||0)+1;
  clearTimeout(entry._tapTm);
  entry._tapTm=setTimeout(()=>{
    const n=clickState[key]; clickState[key]=0;
    const sec=entry.dataset.sec, i=+entry.dataset.i;
    if(n>=2){ // double tap = cut/uncut
      DB[sec][i].cut=!DB[sec][i].cut; save(); renderAll();
      toast(DB[sec][i].cut?'Entry काट दी गई (total में नहीं जुड़ेगी)':'Entry वापस जोड़ी गई');
    }else{
      if(sec==='kharch' && DB.kharch[i].pending){ openPendingFill(i); }
    }
  },300);
}
document.addEventListener('click',e=>{
  const pencil=e.target.closest('.edit-pencil');
  if(pencil){ e.stopPropagation(); SEC_OPEN[pencil.dataset.edit](+pencil.dataset.i); return; }
  const entry=e.target.closest('.hw-entry');
  if(entry && entry.dataset.sec){ handleEntryTap(entry); return; }
  const col=e.target.closest('.nb-col');
  if(col && !e.target.closest('.total-block') && !e.target.closest('.grand-block')){
    const map={'col-rokad':'rokad','col-jama':'jama','col-maal':'maal','col-nagad':'nagad','col-kharch':'kharch'};
    const sec=map[col.id]; if(sec){ if(sec==='kharch'){/* handled via divider too */} SEC_OPEN[sec](); }
  }
});
$('#rokad-head-amt').parentElement.addEventListener('click',e=>{ if(e.target.classList.contains('head-amt')||e.target.closest('.head-amt')){ e.stopPropagation(); openOpening(); } });
$('#rokad-head-amt').addEventListener('click',e=>{ e.stopPropagation(); openOpening(); });

/* ---------- print ---------- */
function openPrintChoice(){
  popup({
    title:'🖨️ Print — कौन सा चाहिए?',
    body:`<div class="print-choice">
        <button id="pr-plain"><span class="pc-ico">📄</span>Plain<br><small style="color:#8a94a6">बिना Total</small></button>
        <button id="pr-total"><span class="pc-ico">🧮</span>With Total<br><small style="color:#8a94a6">Total के साथ</small></button>
      </div>`,
    foot:`<span></span><button class="pp-btn cancel" onclick="closePopup()">Cancel</button>`,
    onOpen(bk){
      bk.querySelector('#pr-plain').addEventListener('click',()=>{ closePopup(); doPrint(false); });
      bk.querySelector('#pr-total').addEventListener('click',()=>{ closePopup(); DB.totals=computeTotals(); save(); renderAll(); doPrint(true); });
    }
  });
}
function doPrint(withTotal){
  document.body.classList.toggle('print-plain', !withTotal);
  setTimeout(()=>{ window.print(); },120);
}
$('#spine-print').addEventListener('click',e=>{ e.stopPropagation(); openPrintChoice(); });
$('#nb-print-quick').addEventListener('click',openPrintChoice);

/* triple-click date → print */
['nb-date-l','nb-date-r'].forEach(id=>{
  let c=0,t=null;
  $('#'+id).addEventListener('click',()=>{
    c++; clearTimeout(t);
    t=setTimeout(()=>{ if(c>=3) openPrintChoice(); c=0; },420);
  });
});

/* init */
renderAll();
window.closePopup=closePopup;
