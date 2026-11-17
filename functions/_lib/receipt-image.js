/* Cloudflare Pages/Workers में receipt PNG: fontkit (Hindi shaping) + resvg WASM (SVG→PNG).
   receipt.js इसे dynamic import करता है — कुछ भी गड़बड़ हो तो receipt बिना image के text/template से चली जाती है. */
import * as fontkit from 'fontkit';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from './resvg.wasm';
import { FONT_BYTES } from './receipt-fonts.js';
import { renderWith } from './receipt-svg.js';

let ready = null, fonts = null;
export async function renderReceiptPng(d, amountNum) {
  if (!ready) ready = initWasm(wasm).catch(e => { if (!/already/i.test(String(e?.message || e))) { ready = null; throw e; } });
  await ready;
  if (!fonts) { const [d4, d7, l4, l7] = FONT_BYTES(); fonts = { dev400: fontkit.create(d4), dev700: fontkit.create(d7), lat400: fontkit.create(l4), lat700: fontkit.create(l7) }; }
  return renderWith(Resvg, fonts, d, amountNum);
}
