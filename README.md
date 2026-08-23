# SATYAM GOLD — Digital Notebook

Hindi handwriting-style digital ledger (डिजिटल बही-खाता) web app for PC & Tablet.

## Features
- 🔐 Login screen with golden animated "SATYAM GOLD" branding
- 🏠 Home dashboard: 7 colourful 3D tiles (Notebook, S.Book, Print, Order Book, Attendance, Call, Emergency) + Chat AI button
- 📔 Two-page notebook (no lines, handwriting style) with Hindi headers:
  - रोकड + नगदी बिक्री (item → qty → rate → Cash / A/C / Mix payment)
  - जमा खाते नाम (A/C entries shown in red)
  - माल आवत खाते (Serial No, Name, Address, **D P W** badge `pic = dust/plastic/wet` — W = पानी वाला wheat,
    line 1 `RST + GROSS`, line 2 `TARE + NETT` (हर जोड़ी एक ही line में), vertical RATE — weights & rate बाद में भी भर सकते हैं ✏️,
    FILL type = simple chips (बोरा count सिर्फ़ ऊपर वाले circle में, नीचे दोबारा नहीं), 🏠 IN/OUT HOME card थोड़ी दूरी नीचे)
  - नगद नाम खाते (Serial No auto-fills name+address from माल आवत; **Mill / A/C / Home** modes — "Counter" button हटा दिया गया; Home entries अब **highlight नहीं** होतीं, सिर्फ़ `(Home)` tag दिखता है और total से बाहर रहती हैं)
  - नगद खर्च (Mill kharch, Advance-pending exact-later, Labour multi-category with saved rates, Van: गाड़ी खर्च / Petrol van+bike with van no & driver)
- 👷 Labour rates: double-click "नगद खर्च" header → password (current hour + date, e.g. 12:00 & 22 tarikh → `1222`) → rate settings
- Σ TOTAL button: per-column add → minus A/C (red) → green final, plus grand summary block
  - **कुल Total = (रोकड + नगदी बिक्री) + (जमा खाते नाम) + (IN HOME) − (नगद नाम खाते) − (नगद खर्च)**
    नगद नाम खाते और नगद खर्च जुड़ते नहीं — घटते हैं (grand block में लाल `-` के साथ दिखते हैं)
- ✂️ Double-tap an entry = cut (strikethrough, removed from totals but stays visible)
- 🕐 Timestamp on every entry
- 🗓️ Attendance: पिछली तारीख़ (या lock हो चुकी तारीख़) पर mark बदलने के लिए पहले **3 बार click** —
  तभी admin password खुलेगा (ग़लती से एक touch पर password on नहीं होगा)
- 💾 Data saved per-date in localStorage

---

## 🖨️ Print Engine (पूरी तरह नया)

पहले print **screenshot जैसा** निकलता था (buttons समेत) और **2 page** में चला जाता था।
वजह: Android Chrome में `iframe.contentWindow.print()` असल में **parent page** को print करता है।

अब का तरीक़ा:

| Device | Method |
|---|---|
| 📱 Touch / Android / iOS | `window.open()` → नयी tab में असली print document → `print()` |
| 💻 Desktop | hidden iframe |
| 🚫 Popup blocked | in-page overlay (`body > *:not(#sg-print-overlay){display:none}`) |

**एक ही page पर fit** — `sgFitDoc()` एक `100mm × 10mm` probe div डालकर असली **px-per-mm** नापता है
(96 dpi की hard-coded guess हटा दी गयी), फिर A4 का असली printable area निकालकर `transform: scale()`
लगाता है और `#pstage` की height clamp कर देता है ताकि कुछ भी page 2 पर न जाए।

```
availW = ((landscape?297:210) − 2×5mm) × pxPerMm
availH = ((landscape?210:297) − 2×5mm) × pxPerMm
scale  = min(1, availW/w, availH/h)
```

`stretch` option:
- `stretch:true` → `#pw` width = availW — **Notebook** (पूरे page पर फैलता है)
- `stretch:false` → `#pw` width = `max-content` फिर scale-to-fit — **Attendance / Receipt**

🗓️ **Attendance print अब पूरा महीना दिखाता है** — दिन **1 से last date तक** + **total P** column,
चाहे छोटा ही क्यों न हो (`stretch:false` + compact print CSS: `font-size:9.5px`, `padding:1.5px 2px`,
sticky cells `position:static`)।

Print में `.bg-3d, .screen, #toast, #popups-root, #ph-viewer` सब hide हो जाते हैं — **सिर्फ़ detail छपती है**, कोई button नहीं।

---

## 🧾 Print Screen (Home → Print tile)

एक ही screen पर **दो panel**:

```
┌──────────────────────────────────────────────┐
│ ← Home        02-08-2026        🖨️ Print     │
├──────────────────────┬───────────────────────┤
│ 🧾 Receipt Details   │ 🌾 Wheat Details      │
│ Sr · Name (Address)  │ Sr · Name (Address)   │
│ Particulars · Qty  👁│ Total बोरा · Rate   👁│
└──────────────────────┴───────────────────────┘
```

- दोनों list में **सिर्फ़ आज की तारीख़** की entries दिखती हैं
- 👁 icon → पूरा **PDF-जैसा preview** खुलता है, ऊपर **✖ cross** button (Esc या backdrop click से भी बंद)
- 🖨️ Print button → popup: **Atta Print** / **Wheat Print**
- 820px से छोटी screen पर panels अपने-आप एक के नीचे एक हो जाते हैं

### Storage keys
| Key | Content |
|---|---|
| `sg_nb_<DD-MM-YYYY>` | Notebook (रोकड, माल आवत, नगद …) |
| `sg_att_<MM-YYYY>` | Attendance |
| `sg_arcpt_<DD-MM-YYYY>` | Atta receipts (atta-receipt.html से) |
| `sg_wrcpt_<DD-MM-YYYY>` | Wheat slips (wheat-slip.html से) |

---

## 📄 `atta-receipt.html` — Atta Print

मूल `ddd (3).html` का content **ज्यों का त्यों** — सारा `@media print` CSS और print markup
बिलकुल नहीं छेड़ा गया, इसलिए **print पहले जैसा ही single page** पर निकलता है।

जो जोड़ा गया:
- ऊपर app-जैसा topbar: **← Back** · **date** · **🖨️ Print**
- सारे buttons app के gradient style (`grey / gold / green / blue / red / purple`) में
- interior look polish (card, inputs, modal)
- print होते ही receipt `sg_arcpt_<date>` में save → Print screen की list में आ जाती है
- Back → `index.html#print` (dobara login नहीं करना पड़ता)

---

## 🌾 `wheat-slip.html` — Wheat Print (दोनों wheat files merge करके एक)

`wheat rst.html` + `wheat fill.html` को **एक ही page** में मिला दिया गया — ऊपर mode switch:

```
⚖️ RST   |   📦 FILL
```

**खुद से receipt काटने की ज़रूरत नहीं** — सिर्फ़ **माल आवत Serial No** डालो:

```
📔 माल आवत Serial No: [ 3 ]   🪄 Auto Fill
```

…और notebook की उसी entry से **अपने-आप भर जाता है**: name, address, बोरा count,
**D / P / W**, weights, rate — और mode भी अपने-आप चुन जाता है
(`m.weights` हो तो FILL, gross/tare हो तो RST)।

फिर बस एक button:

```
❌ 1/2kg & Unloading OFF   ⇄   ✅ 1/2kg & Unloading ON
```

ON करते ही deduction दोनों modes (RST और FILL) में लग जाता है → **Print**।

- print में `#print-container.mode-rst .fill-only` / `.mode-fill .rst-only` से सही table ही दिखता है
- slip `sg_wrcpt_<date>` में save होती है
- `?serial=N` query param से सीधे autofill भी हो सकता है
- Back → `index.html#print`

---

## Login
Phone: `9631816666` &nbsp; Password: `Satyam`

Login के बाद `sessionStorage.sg_login='1'` set होता है, इसलिए
`atta-receipt.html` / `wheat-slip.html` से वापस आने पर **दोबारा login नहीं** माँगता।
`index.html#print` सीधे Print screen खोल देता है (hash routing)।

## Files
| File | Role |
|---|---|
| `index.html` | सारे screens का markup + CSS |
| `app.js` | पूरी app logic + print engine + Print-Home module |
| `atta-receipt.html` | standalone Atta receipt (ddd(3) based) |
| `wheat-slip.html` | standalone Wheat slip (RST + FILL merged) |

## Run
Just open `index.html` — pure HTML/CSS/JS, no build step.

```bash
python3 -m http.server 8080
# → http://localhost:8080/index.html
```

---

## 🧾 ORDER BOOK (नया)

Home → **Order Book** tile.

### ऊपर
`← Home` | **तारीख़** | `🖨️ Print`

### TOTAL box
सारे **pending** order (पिछली तारीख़ + आज) का particular-wise Qty —
सिर्फ़ नाम + qty, जैसे `ATTA ग - 500`, `ATTA 10KG - 120`, `CHOKAR 30kg - 40`.

### Area-wise
पता से area अपने आप पहचान — **KHAGARIA (KKG), MANSHI (MNS), MAHESHKHUNT (MSK),
GOGRI (GG), GOGRI JAMALPUR (GJP), KARUAAMOR (KAM), CHOTHAM (CTM), SONBARSHA (SNB),
SAHARSA (SHR), PARBATTA, BELDAUR, ALAULI, BAKHRI, BEGUSARAI, JAMALPUR (JMP)**.
जिस area में 1 या 1 से ज़्यादा order है, वहाँ का box दिखेगा —
Atta / Chokar / Sattu / Besan सबका **area total**.

### नाम
Type सिर्फ़ **English** में, दिखेगा **English + Hindi** दोनों
(offline transliteration + online होने पर Google से सुधार).
`RAJU JEE (राजू जी)` जैसा — image वाले style में.

### Order box
- **Serial No पहले** (गोल circle में)
- **पिछली तारीख़ का order = पूरा लाल** + `🕐 समय · तारीख़` stamp
- आज का order = नीला time stamp
- हर order एक **click-able box** → Atta Receipt में नाम/पता/item/qty/rate **auto-fill**
- Rate न भरा हो (जैसे `ATTA ग 10×`) → click पर पहले **Order Book में rate माँगेगा**,
  rate भरने से पहले Atta Receipt में कुछ नहीं भरेगा

### TODAY COMPLEAT
Atta Receipt print होते ही order अपने आप **Serial No के साथ** COMPLEAT column में
(✅ समय stamp; back-date order हो तो order की तारीख़ भी).
गलती हो तो box → `↩ फिर बाक़ी करें`.

### Record Book
Record Book → **🧾 Order Book** → तारीख़ list.
किसी भी तारीख़ पर आज का + उससे पुराने बचे हुए order — दोनों दिखेंगे, print भी.

## 🧾 ORDER BOOK v2 + 📊 TALLY VIEW (नया अपडेट)

### Order Book — नया साफ़ interface
- **Card design** — `Σ TOTAL` card (सभी pending order का particulars + qty), `📍 AREA WISE TOTAL` (15 इलाक़े — KKG/MNS/MSK/GJP/GG/KAM/CTM/SNB/SHR/PBT/BLD/ALI/BKR/BGS/JMP), और दो column: `📋 ORDER — बाक़ी` + `✅ TODAY COMPLEAT`
- **पूरा नाम** — `ATTA ग` जैसा शॉर्ट नाम हटा दिया गया, अब **Atta Gold** पूरा लिखा आता है
- **New Order form** — नाम English में टाइप करो → **अपने आप हिंदी**; **Address भी** English → हिंदी; Area chips
- **Particulars dropdown** — Atta Receipt print जैसा **Category → Variety** picker (Atta / Sattu / Besan / Chokar / Jut Bora)
- **Rate बाद में** — rate खाली छोड़ सकते हैं। Order box पर click → rate माँगेगा → भरने के बाद फिर click → Atta Receipt खुलेगा जिसमें **नाम, पता, particulars, qty, rate अपने आप भरे** मिलेंगे
- **Extra item** — receipt में जो नया item जोड़ोगे वो भी **Today Complete** में दिखेगा
- **Today Complete = सिर्फ़ आज की तारीख़** की delivery
- **Partial delivery (बचा हुआ)** — order 20 qty, दिया 15 → Today Complete में **15**, बाक़ी **5 pending** रहेगा और अगले दिन side में **`बचा हुआ`** लिखा दिखेगा
- Back-date order **लाल** में, serial no पहले, समय + तारीख़ के साथ
- 🖨️ Print — A4 fit (TOTAL + area + बाक़ी order + Today Compleat)

### 📊 Tally View (नया बटन — Home पर आख़िरी tile)
- 4 KPI: कुल Order / Delivery / बाक़ी Order / Delivered ₹
- **📦 ITEM WISE** — Particulars | Order | दिया | बाक़ी
- **📍 AREA WISE** — Area | Order | दिया | बाक़ी | Value ₹
- **👤 CUSTOMER WISE** — Name | Area | Order | दिया | बाक़ी | Value ₹
- 🖨️ Print सपोर्ट

### और सुधार
- **SI No continue** — Atta Receipt व Wheat Slip का SI No अगले दिन फिर 1 से शुरू नहीं होगा; सभी तारीख़ों में सबसे बड़ा नंबर देखकर +1 होता है
- **Record Book → S.Book** — अब पुराना सारा डेटा दिखता है (`sg_sb_` + `sg_nb_` + `sg_arcpt_` + `sg_wrcpt_` सभी तारीख़ें merge)
- **Record Book → Order Book** — पिछली + आज की तारीख़ का Order Book देखें व print करें

---

## 📊 TALLY VIEW (पूरा नया — v2)

पुराना Tally (item/area/customer table) **हटा दिया गया**। अब Tally View पर click करते ही **दो option**:

### 1️⃣ C/D  (Creditors & Debtors)
तीन हिस्से — **Creditors · Debtors · Other**

#### 🟥 Creditors (जिनको हमें देना है)
* ऊपर **← Back** और **🖨️ Print**
* नीचे **🔍 Search box** — कुछ अक्षर लिखते ही नाम filter, click → पूरी details
* उसके नीचे **एक ही line में 4 colourful chips** (Airtable style):
  | chip | क्या दिखाता है |
  |---|---|
  | 📋 **All** | सारे customer |
  | 💸 **Give Due** | जिनको payment देना बाक़ी है |
  | 📍 **Area** | area-wise box → click → उस area के customer |
  | ⏰ **7Days End** | wheat receipt भरे 7+ दिन हो गये — **सबसे पुराना सबसे ऊपर** |
* List: `Sr · नाम (पता)` + नीचे `mob- number`, ऊपर **Due / Paid** column
* **Due** = बचे हुए receipt का total (एक से ज़्यादा हो तो `N receipt बाक़ी` badge)
  *उदा.* महाजन ने 3 बार wheat दिया, 1 का payment हुआ → Due में **सिर्फ़ 2 receipt** का amount, Paid ख़ाली
* **Paid** = advance (जितना ज़्यादा दे दिया)

#### 🟩 Debtors (जिनसे हमें लेना है)
Creditors जैसा ही, पर chips: 📋 **All** · 💰 **Due** · 📍 **Area** · 🚨 **Limit Cross**
* **Limit Cross** = जिसके 2 (default) से ज़्यादा receipt बाक़ी हैं
* उस customer पर **double-tap** → pop-up → limit set करें (जैसे `4` भरें तो 4 receipt तक Limit Cross में नहीं दिखेगा)

#### 👤 Customer Profile (Due/Paid पर click)
* ऊपर बीच में **नाम (पता)** + `mob-`, बायें **← Back**, दायें **🖨️ Print**
* नीचे **बायें DUE · दायें PAID** — बीच में line
* **DUE** में: bill की final amount + नीचे `R.No` (wheat/atta receipt no) और **तारीख़** (जब receipt बना)
* **PAID** में: दिया हुआ पैसा + **time stamp** 🕐

#### 🟦 Other — 4 खाते
| खाता | data कहाँ से |
|---|---|
| 🧺 **कली बोरा (Cr)** | माल आवत खाते → Bag (Plastic Bag / Pouch) |
| 👷 **Staff (Cr)** | Attendance के नाम — profile अपने आप बनता है |
| 🥣 **Daal (Cr)** | माल आवत खाते → Daal (Sattu / Chana) |
| 🔥 **Roast (Cr)** | माल आवत खाते → Roast (Wheat Roast / Jira) |

**Staff (Cr)** में हर staff का **Due / Credit** column —
नगद नाम खाते में staff को दिया पैसा/आटा/सत्तू/बेसन → **Due** में। महीने के आख़िर में
💰 **Credit** पर click → salary भरें → बचा amount निकलते ही **pop-up**:
`➡️ Add Next Month` (अगले महीने carry) या `💵 Total Give` (नगद नाम खाते में entry ✔)

**📱 Mobile number बाद में भी** — ऊपर `Creditors` / `Debtors` / `Other` title पर **3 बार click** →
Mobile Add ON → किसी नाम पर click → number भरें

---

### 2️⃣ 🏭 Mill खर्च
| section | क्या है |
|---|---|
| 📦 **Product** | Loading · Unloading · भाड़ा · Overtime · बिजली बिल — box पर click → सिर्फ़ **अमाउंट** भरें<br>**PRODUCT title पर 3 बार click → नया item add** |
| 🚐 **गाडी** | 4 गाड़ी — `BR34GA8293` Pickup 🛻, `BR34GA8447` CNG Van 🚐, `BR34U9778` Bike 🏍️, `WA24AE4843` Car Diesel 🚗<br>हर गाड़ी में **⛽ Fuel** और **🔧 Maintenance** दो column |
| 🔧 **Mill Maintenance** | 🏭 **Plant** और 🏢 **Office** — नाम + अमाउंट |

**दोनों तरफ़ sync 🔄** — Tally में भरा हर amount notebook के **नगद खर्च → Mill खर्च** में
अपने आप चला जाता है, और notebook के नगद खर्च की entry Tally के Product / गाडी में दिखती है।

Notebook के **नगद खर्च → 🚐 वेन** में अब `Petrol` की जगह **⛽ Fuel** —
Van चुनने पर गाड़ी नंबर का **dropdown**, Bike चुनने पर bike नंबर अपने आप 🪄

**Attendance** में नया नाम add करते ही उसके आगे **(mill staff)** अपने आप लग जाता है।

---

# 🐘 PostgreSQL Database Sync

अब जो कुछ भी **localStorage में save होता है, वही बिलकुल वैसा ही PostgreSQL में भी save होता है**।

### कैसे काम करता है
| step | क्या होता है |
|---|---|
| 1️⃣ page खुलते ही | `/api/sync?full=1` से पूरा data आता है और localStorage में भर जाता है |
| 2️⃣ कोई भी entry save | `localStorage.setItem` wrap है → change queue में → `/api/sync` POST → Postgres |
| 3️⃣ net बंद | queue localStorage में पड़ी रहती है, net आते ही अपने आप चली जाती है |
| 4️⃣ हर 20 सेकंड | server से नया data pull (दूसरे device/tab का बदलाव भी दिख जाता है) |
| 5️⃣ tab बंद करते वक़्त | `sendBeacon` से बची हुई queue भेज दी जाती है |

**सिर्फ़ `sg_` से शुरू होने वाली keys sync होती हैं** — `sg_nb_*`, `sg_att_*`, `sg_arcpt_*`, `sg_wrcpt_*`, `sg_ord_*`, `sg_sb_*`, `sg_staff`, `sg_rates`, `sg_mobiles`, `sg_changelog`, `sg_carry`, `sg_tv_manual`, `sg_wheat_cut` — सब कुछ।

नीचे बाएँ कोने में छोटा सा **dot** है:
🟢 database से जुड़ा · 🟡 save हो रहा · 🔴 save नहीं हुआ · ⚪ database से नहीं जुड़ा
(print में यह dot नहीं छपता)

### Files
| file | काम |
|---|---|
| `sg-sync.js` | browser side — localStorage ⇄ API |
| `functions/api/sync.js` | Cloudflare Pages Function — API ⇄ Postgres |
| `schema.sql` | Postgres table — Adminer में paste करने के लिए |
| `package.json` | `pg` driver |
| `wrangler.toml` | `nodejs_compat` flag (pg चलाने के लिए ज़रूरी) |

---

## 🔑 Step 1 — PostgreSQL में table बनाएँ

Adminer खोलें → बाएँ तरफ़ **SQL command** पर click → नीचे वाला पूरा text paste करें → **Execute**
(यही text `schema.sql` file में भी है)

```sql
CREATE TABLE IF NOT EXISTS sg_store (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sg_store_updated_at_idx ON sg_store (updated_at);
CREATE INDEX IF NOT EXISTS sg_store_synced_at_idx  ON sg_store (synced_at);

CREATE OR REPLACE FUNCTION sg_touch_synced_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.synced_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sg_store_touch ON sg_store;
CREATE TRIGGER sg_store_touch
    BEFORE UPDATE ON sg_store
    FOR EACH ROW EXECUTE FUNCTION sg_touch_synced_at();
```

Execute के बाद बाएँ list में **`sg_store`** table दिखने लगेगा ✔

---

## 🔐 Step 2 — Cloudflare में Postgres का password कहाँ डालें

Password **code में कहीं नहीं लिखना** — Cloudflare के **Secret** में डालना है।

```
Cloudflare Dashboard
  → Workers & Pages
  → अपना Pages project (जो GitHub से जुड़ा है)
  → Settings
  → Variables and Secrets          ← यहाँ
  → Add  →  Type: Secret
      Variable name :  DATABASE_URL
      Value         :  postgresql://postgres:आपका_PASSWORD@140.245.7.25:5432/postgres
  → Save
```

⚠️ ज़रूरी बातें
- यही variable **Production** और **Preview** दोनों environment में add करें
- Type ज़रूर **Secret** चुनें (Plaintext नहीं) — तब password छुपा रहता है
- Save करने के बाद **Deployments → latest → Retry deployment** ज़रूर करें, वरना नया secret पुराने build पर लागू नहीं होगा

### DATABASE_URL का format
```
postgresql://<user>:<password>@<host>:<port>/<database>
```
आपके Adminer screen के हिसाब से:

| हिस्सा | value |
|---|---|
| user | `postgres` |
| password | आपका Postgres password |
| host | `140.245.7.25` (server का IP / hostname) |
| port | `5432` |
| database | `postgres` |

👉 उदाहरण
```
postgresql://postgres:MySecret%40123@140.245.7.25:5432/postgres
```

अगर password में `@ : / # ?` जैसे special character हैं तो उन्हें encode करें —
`@` → `%40` · `:` → `%3A` · `/` → `%2F` · `#` → `%23` · `?` → `%3F`

अगर server SSL माँगे तो आख़िर में जोड़ें: `?sslmode=require`
```
postgresql://postgres:PASSWORD@140.245.7.25:5432/postgres?sslmode=require
```

---

## ⚙️ Step 3 — Cloudflare build settings

Pages project → **Settings → Build & deployments**

| field | value |
|---|---|
| Build command | `npm install` |
| Build output directory | `/` (root) |
| Root directory | `/` |

**Settings → Functions → Compatibility flags** में `nodejs_compat` होना चाहिए
(`wrangler.toml` में पहले से लिखा है, फिर भी dashboard में check कर लें)

---

## ✅ Step 4 — check करें

### 4.0 सबसे पहले health check (नया!)
Browser में खोलें:
```
https://आपकी-site/api/health
```
यह साफ़-साफ़ बता देगा कि दिक्कत कहाँ है:

| output | मतलब |
|---|---|
| `"database_url_set": false` | Cloudflare में **DATABASE_URL** secret डला ही नहीं / गलत environment में है → Step 2 करें, फिर **Retry deployment** |
| `"db_connected": false` + error में `timeout` | Postgres का **port 5432** बाहर से नहीं खुला / firewall बंद है |
| error में `password authentication failed` | DATABASE_URL में **password गलत** है |
| `"sg_store_rows": "table नहीं बनी..."` | Adminer में `schema.sql` चलाएँ (Step 1) |
| `"ok": true, "sg_store_rows": 12` | सब सही ✔ — data save हो रहा है |

### 4.1 Entry test
1. site खोलें → कोई entry भरें
2. Adminer में जाएँ → `sg_store` table → **select sg_store**
3. `sg_nb_<आज की तारीख़>` row दिख जाएगी ✔

### 4.2 नीचे-बाएँ रंगीन dot पर tap करें (नया!)
हर page के नीचे-बाएँ कोने में एक dot है — उस पर **tap/click** करने से पूरा status + server का exact error message दिखता है:
- 🟢 हरा = Database से जुड़ा है, save हो रहा है
- 🟡 पीला = save चल रहा है
- 🔴 लाल = save fail — tap करके error पढ़ें
- ⚪ grey = database से जुड़ा नहीं (सिर्फ़ इसी device में save)

दूसरे mobile का data अब हर **5 सेकंड** में अपने आप आ जाता है (लगभग realtime)।

Browser console में भी देख सकते हैं:
```js
sgSync.status()   // { pending: 0, cursor: 1755... }  → pending 0 = सब save हो गया
sgSync.push()     // ज़बरदस्ती अभी भेजो
sgSync.pull()     // ज़बरदस्ती अभी लाओ
```

API सीधे भी test कर सकते हैं: `https://आपकी-site/api/sync?full=1`

---

## 📊 Adminer में data देखने के काम की SQL

```sql
-- कौन सी key कब save हुई
SELECT key, updated_at, synced_at FROM sg_store ORDER BY synced_at DESC;

-- किसी एक दिन का पूरा notebook
SELECT value FROM sg_store WHERE key = 'sg_nb_16-08-2026';

-- सारी notebook dates
SELECT key FROM sg_store WHERE key LIKE 'sg_nb_%' ORDER BY key;

-- कुल कितनी row
SELECT count(*) FROM sg_store;
```
