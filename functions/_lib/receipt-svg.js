/* =====================================================================
   SATYAM GOLD — Receipt IMAGE (PNG) banane wala. Design = Collection app ka "PAYMENT RECEIPT".
   buildReceiptSvg(d)  : data -> SVG text   (pure, kisi bhi runtime me chalta hai)
   renderReceiptPng()  : SVG -> PNG via resvg (WASM) + Noto Sans / Devanagari fonts
   Har receipt me sirf naam / dinank / rakam / mode (aur rasid no., pata) badalte hain.
   ===================================================================== */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const N = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const INR = n => '₹' + (Math.round(N(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/* Collection app.js के numberToWords जैसा ही */
export function numberToWords(num) {
  num = Math.floor(N(num));
  const a = ['', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस'];
  const b = ['', '', 'बीस', 'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे'];
  if ((num = num.toString()).length > 9) return '';
  const n = ('000000000' + num).slice(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return '';
  const two = x => a[Number(x)] || b[x[0]] + ' ' + a[x[1]];
  const parts = [];
  if (n[1] != 0) parts.push(two(n[1]) + ' करोड़');
  if (n[2] != 0) parts.push(two(n[2]) + ' लाख');
  if (n[3] != 0) parts.push(two(n[3]) + ' हज़ार');
  if (n[4] != 0) parts.push(a[Number(n[4])] + ' सौ');
  if (n[5] != 0) parts.push(two(n[5]));
  const s = parts.join(' ');
  return s ? s + ' रुपये मात्र' : '';
}

/* लंबा text तोड़ने के लिए (अंदाज़े से चौड़ाई) */
function wrap(text, maxChars, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1].replace(/.{0,2}$/, '') + '…'; return keep; }
  return lines;
}

const W = 800, PAD = 40;
/* resvg-wasm Devanagari shape नहीं कर पाता (matra टूटते हैं) → shaping हम fontkit से करते हैं और glyph को SVG path बनाकर देते हैं.
   fonts = { dev400, dev700, lat400, lat700 } (fontkit Font objects) */
const isDev = ch => /[\u0900-\u097F\u200C\u200D\u20B9]/.test(ch);
function runs(txt) {
  const out = []; let cur = '', dev = null;
  for (const ch of String(txt ?? '')) {
    const d = isDev(ch);
    if (dev === null || d !== dev) { if (cur) out.push([dev, cur]); cur = ch; dev = d; } else cur += ch;
  }
  if (cur) out.push([dev, cur]); return out;
}
function shape(fonts, txt, size, weight) {
  const key = (r) => (r ? 'dev' : 'lat') + (weight >= 600 ? '700' : '400'); const glyphs = []; let w = 0;
  const parts = runs(txt);
  // हिंदी शब्दों के बीच का space हिंदी run में रखो (अलग font से width बदलती है, इसलिए सिर्फ़ latin run का space latin में)
  for (const [dev, t] of parts) {
    const f = fonts[key(dev)]; const sc = size / f.unitsPerEm; const run = f.layout(t);
    run.glyphs.forEach((g, i) => { const p = run.positions[i]; glyphs.push({ d: g.path.toSVG(), x: w + p.xOffset * sc, y: p.yOffset * sc, sc }); w += p.xAdvance * sc; });
  }
  return { glyphs, w };
}
let FONTS = null;
const T = (x, y, txt, { size = 24, weight = 400, fill = '#1f2937', anchor = 'start' } = {}) => {
  const { glyphs, w } = shape(FONTS, txt, size, weight);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return `<g fill="${fill}">` + glyphs.filter(g => g.d).map(g => `<path d="${g.d}" transform="translate(${(x0 + g.x).toFixed(2)},${(y - g.y).toFixed(2)}) scale(${g.sc},${-g.sc})"/>`).join('') + '</g>';
};

export function buildReceiptSvg(d, amountNum, fonts) {
  FONTS = fonts || FONTS;
  const amt = N(amountNum ?? d.amount);
  const o = []; let y = 0;
  // header
  y = 78; o.push(T(W / 2, y, 'SATYAM FOOD PRODUCT', { size: 42, weight: 700, fill: '#111827', anchor: 'middle' }));
  y += 40; o.push(T(W / 2, y, 'Vidyardhar, Khagaria', { size: 24, fill: '#4b5563', anchor: 'middle' }));
  y += 34; o.push(T(W / 2, y, 'FSSAI No: 10421168000028 | GSTIN: 10DWFPD7233GIZI', { size: 21, fill: '#4b5563', anchor: 'middle' }));
  y += 36; o.push(T(W / 2, y, 'Mobile: 9631816666', { size: 24, weight: 700, fill: '#111827', anchor: 'middle' }));
  y += 28; o.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#d1d5db" stroke-width="3" stroke-dasharray="10 8"/>`);
  // badge
  y += 34; o.push(`<rect x="${W / 2 - 160}" y="${y}" width="320" height="50" rx="8" fill="#e0e7ff"/>`);
  o.push(T(W / 2, y + 35, 'PAYMENT RECEIPT', { size: 27, weight: 700, fill: '#3730a3', anchor: 'middle' }));
  y += 50 + 22;
  // details
  const mode = String(d.mode || 'Cash');
  const modeTxt = mode === 'Mix' && (N(d.cash) || N(d.online)) ? `Mix (Cash ${INR(d.cash)} + Online ${INR(d.online)})` : mode;
  const rows = [['रसीद संख्या:', [d.rno || '-']], ['दिनांक:', [d.date || '-']],
    ['से प्राप्त हुए:', wrap(d.name, 24, 2)]];
  if (d.address) rows.push(['पता:', wrap(d.address, 30, 2)]);
  rows.push(['भुगतान का प्रकार:', wrap(modeTxt, 30, 2)]);
  o.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#e5e7eb" stroke-width="2"/>`);
  y += 6;
  for (const [label, lines] of rows) {
    y += 40; o.push(T(PAD, y, label, { size: 24, weight: 700, fill: '#4b5563' }));
    lines.forEach((ln, i) => { if (i) y += 32; o.push(T(W - PAD, y, ln, { size: 25, anchor: 'end' })); });
    y += 12;
  }
  y += 4; o.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#e5e7eb" stroke-width="2"/>`);
  // total
  const words = numberToWords(amt); const th = words ? 168 : 128; y += 24;
  o.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${th}" rx="12" fill="#f3f4f6"/>`);
  o.push(T(W - PAD - 22, y + 38, 'कुल राशि (Total Amount)', { size: 22, fill: '#4b5563', anchor: 'end' }));
  o.push(T(W - PAD - 22, y + 94, INR(amt), { size: 54, weight: 700, fill: '#1e3a8a', anchor: 'end' }));
  if (words) o.push(T(W - PAD - 22, y + 140, words, { size: 22, fill: '#4b5563', anchor: 'end' }));
  y += th + 34;
  // footer
  o.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#d1d5db" stroke-width="3" stroke-dasharray="10 8"/>`);
  y += 40; o.push(T(W / 2, y, 'Bank Details for Payment:', { size: 22, weight: 700, anchor: 'middle' }));
  y += 32; o.push(T(W / 2, y, 'A/c No: 60440573620, IFSC: MAHB0002230', { size: 22, anchor: 'middle' }));
  y += 54; o.push(T(W / 2, y, 'धन्यवाद!', { size: 32, weight: 700, fill: '#111827', anchor: 'middle' }));
  if (d.by) { y += 36; o.push(T(W / 2, y, 'Collected by: ' + d.by, { size: 20, fill: '#6b7280', anchor: 'middle' })); }
  y += 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><rect width="${W}" height="${y}" fill="#ffffff"/>${o.join('')}</svg>`;
}

/* Resvg class (initWasm के बाद) से PNG bytes. fonts = fontkit fonts */
export function renderWith(Resvg, fonts, d, amountNum) {
  const svg = buildReceiptSvg(d, amountNum, fonts);
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 }, background: '#ffffff' });
  const img = r.render(); const png = img.asPng(); try { img.free(); r.free(); } catch (_) {}
  return png;
}
