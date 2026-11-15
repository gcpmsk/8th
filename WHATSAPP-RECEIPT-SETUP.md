# SATYAM GOLD — WhatsApp Receipt + Chatting + Old-Order (Setup Guide)

Dono apps (Notebook = `gcpmsk/8th`, Collection = `gcpmsk/Collection-satyam`) **same Postgres** use karte hain, isliye ek hi `wa_receipts` table dono ki receipts rakhti hai.

## Kya-kya ho gaya
| Feature | Kaise kaam karta hai |
|---|---|
| Auto receipt (Notebook) | Notebook me **जमा खाते नाम** save hote hi `/api/sync` receipt queue karta hai aur Meta template `satyam_payment_receipt` bhej deta hai |
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

## STEP 2 — Meta (WhatsApp Manager)
1. Template `satyam_payment_receipt` **Active** hai — sahi hai.
2. Template kholo aur dekho usme `{{1}}`, `{{2}}`… kitne hain aur kis kis cheez ke liye. Sabse zaroori step.
3. Webhook: App → WhatsApp → Configuration → field **messages** subscribed rahe (delivery "failed/delivered/read" status isi field me aate hain).
4. Permanent token (System User) ka `whatsapp_business_messaging` permission ho.

## STEP 3 — Cloudflare Pages (DONO projects: Notebook aur Collection)
Settings → Variables and Secrets (Production):
| Variable | Value |
|---|---|
| `DATABASE_URL` | pehle se hai (same DB) |
| `WA_TOKEN` | Meta permanent token |
| `WA_PHONE_ID` | Phone number ID (mobile number nahi) |
| `WA_ADMIN_TOKEN` | **sirf Notebook project** — jo objection ke liye pehle se hai |
| `WA_RECEIPT_TEMPLATE` | `satyam_payment_receipt` (default) |
| `WA_RECEIPT_LANG` | `hi` (default; Meta me language "Hindi" ho to `hi`) |
| `WA_RECEIPT_PARAMS` | template ke `{{1}},{{2}}…` ka order, comma se. Default `name,amount,date,mode` |

`WA_RECEIPT_PARAMS` me ye words chal sakte hain: `name, amount, amount_rs, date, time, mode, rno, address, cash, online, by`.
Example: template me 2 variable hain (naam, rakam) → `name,amount`. Variable ek bhi nahi → khali value (`WA_RECEIPT_PARAMS=`).
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
