# SATYAM GOLD — WhatsApp Receipt + Chatting + Old-Order (Setup Guide)

Dono apps (Notebook = `gcpmsk/8th`, Collection = `gcpmsk/Collection-satyam`) **same Postgres** use karte hain, isliye ek hi `wa_receipts` table dono ki receipts rakhti hai.

## Kya-kya ho gaya
| Feature | Kaise kaam karta hai |
|---|---|
| Auto receipt (Notebook) | Notebook me **जमा खाते नाम** save hote hi `/api/sync` receipt queue karta hai aur Meta template (`WA_RECEIPT_TEMPLATE`) bhej deta hai |
| Auto receipt (Collection) | Collection me **Save & Receipt** par payment ke saath hi receipt queue + send |
| Sirf ek baar | Har payment ki `dedupe_key` UNIQUE hai (`nb:<rid>` / `coll:<id>`). Double click, 2 device, network retry par bhi 1 hi receipt |
| Collection double payment | Har Save ke saath `req_id` jaata hai. Same `req_id` dobara aaye to server purani payment lauta deta hai (record 2 baar nahi banta). Purane app ke liye: same customer+amount+mode 10 sec me = duplicate |
| Failed receipt | App → Home/Order Book → **💬 WhatsApp → 🧾 Receipts**. Failed upar, karan (jaise "mobile nahi mila") aur **Retry** / **सारी Failed Retry** |
| Chatting | **💬 WhatsApp → 💬 Chatting** → us din chat karne wale customers → click karo → poori chat. ◀ ▶ ya date se din badlo |
| Old order | Customer naya order de aur purana order deliver nahi hua ho to bot pehle bataata hai ("पुराना Order No …") aur naya item **usi order me add** hota hai (Order Book me `+qty(date)` dikhta hai). Deliver ho chuka ho to naya serial |
| Owner password | **Ek baar** daalo (WA_ADMIN_TOKEN) — us device me yaad rahta hai. Galat nikla to khud hat kar dobara poochta hai |
| WhatsApp popup | "आज WhatsApp से आये order…" text hata diya; ab sirf 📣 Objection, 🧾 Receipts, 💬 Chatting buttons |

Receipt kab **nahi** jaati: Collection se aayi entry Notebook se dobara nahi (Collection khud bhejta hai) · cut entry · 3 din se purani entry · bina mobile number wale customer (Failed me dikhegi).

## STEP 1 — Postgres (Adminer)
`whatsapp-schema.sql` poora paste karke Execute (dobara chalana safe hai). Isse naya banta hai: `wa_receipts`, `wa_pending_order()`, `wa_receipt_status()` aur bot ka old-order merge.

## STEP 2 — Meta (WhatsApp Manager)  ⚠️ Error 132000 ka ilaaj
Error `number of localizable_params (1) does not match expected (0)` ka matlab: Meta template ke **body me koi `{{1}}` variable nahi hai**, par app body me variable bhej raha tha. Upar se template me **Header = Image** hai, jiske liye har message me image dena padta (app nahi deta) — isliye purana template kabhi nahi chalega.

**Sahi tareeka: naya TEXT template banao** (purana edit mat karo — edit par dobara review aur limits lagti hain).
WhatsApp Manager → Message templates → **Create template**
| Field | Value |
|---|---|
| Category | **Utility** |
| Name | `satyam_payment_receipt_v2` |
| Language | **Hindi** |
| Header | **None** (Media sample bhi None — koi Image nahi) |
| Type of variable | **Number** |
| Footer | `SATYAM GOLD` |

**Body (ye paste karo):**
```
नमस्ते {{1}} जी,

आपका ₹{{2}} का भुगतान सफलतापूर्वक प्राप्त हो गया है।

दिनांक: {{3}}
भुगतान का तरीका: {{4}}

Satyam Gold पर विश्वास करने के लिए धन्यवाद।
```
**Variable samples (Add sample me ye bharo):**
`{{1}}` = Gupta Satyam · `{{2}}` = 100 · `{{3}}` = 14-11-2026 · `{{4}}` = Cash

Submit karo; Active hote hi (aam taur par kuch minute) Step 3 ke variables badlo.

Dhyan: Meta ke upar "Missing valid payment method" warning me **Add payment method** karo — warna customer ko business-initiated (template) message nahi ja sakta.

## STEP 3 — Cloudflare Pages (DONO projects: Notebook aur Collection)
Settings → Variables and Secrets (Production):
| Variable | Value |
|---|---|
| `DATABASE_URL` | pehle se hai (same DB) |
| `WA_TOKEN` | Meta permanent token |
| `WA_PHONE_ID` | Phone number ID (mobile number nahi) |
| `WA_ADMIN_TOKEN` | **sirf Notebook project** — jo objection ke liye pehle se hai |
| `WA_RECEIPT_TEMPLATE` | `satyam_payment_receipt_v2` (naya template ka naam) |
| `WA_RECEIPT_LANG` | `hi` (default; Meta me language "Hindi" ho to `hi`) |
| `WA_RECEIPT_PARAMS` | `name,amount,date,mode` (= `{{1}}` naam, `{{2}}` rakam, `{{3}}` tareekh, `{{4}}` mode). Pehle jo value thi use isi se badal do |
| `WA_RECEIPT_HEADER_IMAGE` | **khali chhodo / delete karo** (sirf tab jab template me Header=Image ho; har customer ko same static image jayegi) |

`WA_RECEIPT_PARAMS` me ye words chal sakte hain: `name, amount, amount_rs, date, time, mode, rno, address, cash, online, by`.
Example: template me 2 variable hain (naam, rakam) → `name,amount`. Template me variable ek bhi nahi → `WA_RECEIPT_PARAMS=none`.
Galat ho to receipt **Failed** me aayegi aur likha hoga "Template ke {{1}},{{2}} ki ginti/kram se WA_RECEIPT_PARAMS milayein" — value theek karke Retry dabao. Variable badalne par Pages ko **Redeploy** karo.

Dono repos ka code push ke baad Pages khud deploy kar deta hai (GitHub connected hai to).

## STEP 4 — n8n
Bot ka purana workflow waisa hi chalega. Receipt ka *delivery status* (Meta ne baad me fail kiya) pakadne ke liye 2 node jode gaye hain:
- **Easy**: n8n → Workflows → Import from File → `n8n-whatsapp.json`, apna Postgres + WhatsApp credential select karo, `REPLACE_PHONE_NUMBER_ID` badlo, purana workflow unpublish karke naya Publish.
- **Ya manual**: purane workflow me `WhatsApp Trigger` se ek naya Code node (`Status निकालो`, JSON me jsCode hai) → Postgres node `SELECT public.wa_receipt_status($1::text,$2::text,$3::text)` with query replacement `={{ [$json.metaId, $json.status, $json.error] }}`.
Ye step na karo to bhi receipt jaati hai; bas "Meta ne baad me reject kiya" wali receipts Failed list me nahi aayengi.

## STEP 5 — Test (5 minute)
1. Notebook me kisi customer ka mobile Tally me bharo → जमा entry save karo → WhatsApp par receipt aani chahiye.
2. Collection me Save & Receipt **2 baar jaldi click** karo → Record me 1 hi payment, WhatsApp par 1 hi receipt.
3. Bina mobile wale customer ka payment → app → 💬 WhatsApp → 🧾 Receipts me Failed + karan.
4. Customer se 2 baar order karwao (pehla deliver nahi) → doosre me "पुराना Order…" aur merge.
5. 💬 WhatsApp → 💬 Chatting me us din ki chat dekho.

## Tests
`npm test` (in-memory Postgres, Meta mock; production ko kuch nahi jaata).
