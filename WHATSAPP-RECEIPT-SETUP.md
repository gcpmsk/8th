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

## 🖼️ IMAGE RECEIPT (Collection जैसी PAYMENT RECEIPT की फ़ोटो) — सबसे नया, यही चलाएँ

अब हर payment पर server खुद Collection app वाली **PAYMENT RECEIPT** की PNG बनाता है — सिर्फ़ **नाम, दिनांक, रकम (अक्षरों में भी), भुगतान का प्रकार, रसीद संख्या, पता** बदलते हैं — और WhatsApp पर भेजता है:

| Customer की स्थिति | क्या जाता है |
|---|---|
| पिछले 23 घंटे में bot को message किया है | **Image + caption** (सीधे, Meta approval नहीं चाहिए) |
| 24 घंटे window बंद | **Approved template** (`satyam_payment_receipt`, Header = Image) — header में यही बनी हुई image अपने-आप लग जाती है |
| image बनाने/upload में कुछ भी गड़बड़ | पुराने तरीक़े से सादा text / template (receipt रुकती नहीं) |

**Meta में क्या करना है (एक बार):** आपका `satyam_payment_receipt` (Hindi, Header = Image) template वही रहेगा. Body में **कोई {{variable}} नहीं** रखें (जैसा screenshot में है) — नाम/तारीख़/रकम image में है. **Submit for Review** दबाएँ. Header का sample image सिर्फ़ Meta review के लिए है; असली message में हर बार नयी image जाती है. (Body में variable रखे हों तो भी चलेगा — app 132000 आने पर अपने-आप बिना-variable वाला रूप आज़मा लेता है.)

**Cloudflare Pages variables (दोनों projects):**
| Variable | Value |
|---|---|
| `WA_RECEIPT_TEMPLATE` | `satyam_payment_receipt` (v2 वाला नाम हो तो बदल दें) |
| `WA_RECEIPT_HEADER_IMAGE` | **खाली/delete** (अब ज़रूरत नहीं) |
| `WA_RECEIPT_IMAGE` | `on` (default). बंद करना हो तो `off` |
| `WA_RECEIPT_CAPTION` | (optional) image के नीचे का text. `{name} {amount} {date} {mode} {rno}` |
| `WA_RECEIPT_MODE` | `auto` |

**n8n में बदलाव की ज़रूरत नहीं** — receipt Cloudflare से जाती है. n8n में बस वही `Status निकालो → Receipt status (Postgres)` node चालू रहें ताकि delivered/failed दिखे.
Receipts list में `🖼 image` / `📄 template` दिखता है; image में दिक़्क़त हो तो `img_err` में कारण सेव होता है.

## ⭐ सबसे आसान तरीका — सादा TEXT receipt (न image, न template, न Meta approval)

App अब receipt **सादे WhatsApp text** में भेज सकता है। Meta की "24 घंटे window" के अंदर (customer ने पिछले 23 घंटे में bot को कोई भी message भेजा हो) text receipt सीधे जाती है। Window बंद हो तो अपने आप approved **template** पर चली जाती है।

| Variable (Cloudflare Pages, दोनों projects) | Value |
|---|---|
| `WA_RECEIPT_MODE` | `auto` (default) = window खुली → text, बंद → template · `text` = सिर्फ़ text · `template` = सिर्फ़ template |
| `WA_RECEIPT_TEXT` | (optional) अपना मज़मून. `{name} {amount} {date} {time} {mode} {rno} {address}` चलते हैं, नई line के लिए `\n` |
| `WA_RECEIPT_TEMPLATE` | `satyam_payment_receipt_v2` (जो text-only template review में है, Active होते ही) |
| `WA_RECEIPT_PARAMS` | `name,amount,date,mode` (v2 template के {{1}}..{{4}}) |
| `WA_RECEIPT_HEADER_IMAGE` | **खाली** — सिर्फ़ तब भरें जब template में Header=Image हो |

Receipt **Sent** होने पर 🧾 Receipts list में `📝 text` या `📄 template` लिखा आता है, और 💬 Chatting में पूरा receipt text दिखता है।

### "Sent" दिख रहा है पर WhatsApp पर नहीं आया — क्यों?
App का **Sent** = "Meta ने message ले लिया". असली delivery बाद में पता चलती है। पुराना template `satyam_payment_receipt` में **Header = Image** है (app image नहीं भेजता) और Meta पर **"Missing valid payment method"** है — ऐसे template message Meta बाद में चुपचाप reject कर देता है (error 131042 / 132012). इसे पकड़ने के लिए **STEP 4 (n8n status node)** ज़रूर जोड़ें — तब ऐसी receipt app में ❌ Failed + असली कारण के साथ दिखेगी।
`Meta 190: Authentication Error` = `WA_TOKEN` expire → Meta Business Settings → System users → नया **permanent token** बनाकर Cloudflare में `WA_TOKEN` बदलें, फिर Pages Redeploy और 🧾 Receipts में **सारी Failed Retry**।

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

## STEP 4 — n8n (delivery status पकड़ने के लिए — 2 node)
Bot का पुराना workflow जैसा है वैसा चलेगा। बस ये 2 node जोड़ें ताकि Meta का "failed / delivered / read" app तक पहुँचे:

1. File download करें (raw link, Save as `.json`):
   `https://raw.githubusercontent.com/gcpmsk/8th/main/n8n-receipt-status-addon.json`
2. फ़ाइल खोलकर **सारा text copy** करें → n8n में अपना workflow खोलें → canvas पर क्लिक करके **Ctrl+V** (tablet: long-press → Paste). 2 node बन जाएँगे: `Status निकालो` → `Receipt status (Postgres)`.
3. **`WhatsApp Trigger` के output dot से `Status निकालो` तक एक line खींचें** (Trigger से अब 2 line निकलेंगी: एक `Input निकालो` को, एक `Status निकालो` को).
4. `Receipt status (Postgres)` node खोलकर वही Postgres credential चुनें जो `Bot का जवाब (Postgres)` में है।
5. WhatsApp Trigger में *Trigger On = Messages* रखें (status भी इसी में आते हैं). **Publish** दबाएँ।

पूरा workflow एक साथ चाहिए तो `n8n-whatsapp.json` (Import from File) — उसमें ये दोनों node पहले से जुड़े हैं।

## STEP 5 — Test (5 minute)
1. Notebook me kisi customer ka mobile Tally me bharo → जमा entry save karo → WhatsApp par receipt aani chahiye.
2. Collection me Save & Receipt **2 baar jaldi click** karo → Record me 1 hi payment, WhatsApp par 1 hi receipt.
3. Bina mobile wale customer ka payment → app → 💬 WhatsApp → 🧾 Receipts me Failed + karan.
4. Customer se 2 baar order karwao (pehla deliver nahi) → doosre me "पुराना Order…" aur merge.
5. 💬 WhatsApp → 💬 Chatting me us din ki chat dekho.

## Tests
`npm test` (in-memory Postgres, Meta mock; production ko kuch nahi jaata).
