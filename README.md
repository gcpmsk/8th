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

---

## WhatsApp clickable bot — पूरा setup (September 2026)

**पुराने WhatsApp setup की जगह यही instructions follow करें.** Bot का एक ही Postgres logic है; n8n और `/api/wa` दोनों उसी को चलाते हैं. केवल text वाला WhatsApp Send node interactive menu नहीं बनाएगा.

### क्या मिलेगा

```text
Hi / Hii → [मेरा बाकी (Due)] [नया Order] [More Services]
More Services → हिसाब / आज का भाव / Rate Objection / मालिक से बात

नया Order → Atta / Sattu / Besan / Chokar
Atta → Gold 23KG / 18KG / 10KG / 5KG → कितने बोरा? (सिर्फ संख्या)
Sattu / Besan → 200g / 500g → थैला / बोरा → कितने? (सिर्फ संख्या)
Chokar → कितने बोरा? (सिर्फ संख्या)
→ पूरे cart के items, quantity, rate, known total → Confirm / और Item / Cancel
→ Confirm करने पर Order Book में save + Order No

Rate Objection → Receipt No लिखें → सिर्फ अपने खाते की receipt match
→ उसी receipt का item चुनें → अपना rate लिखें
→ Confirm Submit / Rate बदलें / Cancel
→ App: Home या Order Book → WhatsApp → Objection
→ Customer rate Accept / मेरा New Rate / Deny
→ Customer को WhatsApp response; failure होने पर Retry WhatsApp
```

- WhatsApp की सीमा: एक reply में अधिकतम **3 buttons**; लंबी choices clickable list में हैं, SBI जैसा interaction. SBI का logo/verified badge नहीं लगाया गया है.
- Quantity **1–500 पूरे बोरा/थैला**; rate अधिकतम 2 decimal. एक order में अधिकतम 4 item lines ताकि पूरा confirmation WhatsApp में पढ़ सकें. Hi/Cancel से draft हटता है; 30 मिनट inactivity पर draft expire होता है.
- Rate नहीं set है तो **Rate pending / मालिक बताएँगे**, zero/free माल का दावा नहीं. Partial known total को final bill न मानें.
- Creditor के Hi और आज का भाव में **Set Rate → Master → Wheat (₹/Bag)** दिखेगा; debtor+creditor दोनों होने पर भी Wheat रहेगा. Master Save के बाद sync होने दें. यह customer के Hi/भाव request पर दिखता है, हर rate change पर bulk broadcast नहीं होता.
- Product rate: Master → Area adjustment → Customer discount. Sattu/Besan master **₹/kg**, receipt में packet quantity/rate बनता है.
- Receipt matching original `sg_arcpt_*` records के **नाम + पता** से है, केवल receipt number से नहीं. Cut/cancelled receipts स्वीकार नहीं. एक ही receipt number अलग तारीख पर हो तो date भी पूछेगा. नाम/पता mismatch हो तो पहले app में सही करें; किसी और की receipt allow न करें.
- पुराने सिर्फ text वाले objections जिनमें item index नहीं है, उन्हें customer से नए flow में फिर submit करवाएँ.

### 1. GitHub code और app deployment

1. इस PR को review करके `main` में merge करें; फिर आपकी existing **Cloudflare Pages** production deployment सफल होने दें. GitHub push अपने-आप live deployment का प्रमाण नहीं है.
2. App backend के लिए Pages Functions चलने चाहिए: `/api/sync`, `/api/wa-send`, वैकल्पिक `/api/wa`. केवल GitHub Pages/static HTML hosting पर approvals नहीं चलेंगे.
3. n8n सिर्फ customer conversation चलाता है; **app से accept/reject notification के लिए updated app/backend deploy करना जरूरी है**, चाहे नीचे SQL-only n8n route चुनें.

### 2. Adminer में क्या paste करना है

1. Adminer खोलें → वही Database जिसमें `sg_store` है → Schema `public` → **SQL command**.
2. [whatsapp-schema.sql](./whatsapp-schema.sql) GitHub में खोलें → **Raw** → पूरा text copy.
3. SQL editor का पुराना text हटाएँ, नया पूरा SQL paste → **Execute**. Tables/पुराना data DELETE नहीं करना. पहले backup रखना बेहतर है. Migration दोबारा चल सकती है.
4. यह पूरा migration n8n Postgres node में **नहीं** paste करना; उस node की छोटी query नीचे है.

जरूरी: केवल `wa_log`/`wa_sessions` मौजूद होने से ग्राहक data link नहीं हो जाता. App, Adminer और n8n **एक ही database** उपयोग करें. App में Tally → Debtors/Creditors → Mobile भरें. App खोलें, cloud sync green होने दें और लगभग 30 seconds रुकें. `sg_wa_cust`, `sg_rates`, `sg_arcpt_*` उसी `sg_store` में पहुँचने चाहिए. एक number अलग-अलग accounts पर होने पर bot उसे block करता है; unique mobile link ठीक करें. Unknown number order नहीं बना सकता; मालिक पहले register करे.

जाँच के लिए Adminer में अलग से चलाएँ (customer data print नहीं करता):

```sql
SELECT key, updated_at FROM public.sg_store
WHERE key IN ('sg_wa_cust','sg_rates','sg_wa_cfg');
SELECT count(*) AS receipt_days FROM public.sg_store WHERE key LIKE 'sg_arcpt_%';
```

### 3. आपके screenshot वाले n8n के लिए recommended तरीका

**Import file:** [n8n-whatsapp.json](./n8n-whatsapp.json) download करें → n8n → नया workflow → menu → **Import from File**. Import inactive रहता है. Credentials जानबूझकर file में नहीं हैं.

```text
WhatsApp Trigger → Input निकालो (Code) → Bot का जवाब (Postgres) → WhatsApp JSON भेजो (HTTP Request)
```

- Trigger में अपना existing WhatsApp credential चुनें.
- Postgres में वही credential/database चुनें जिसमें ऊपर SQL execute किया.
- HTTP node URL में `REPLACE_PHONE_NUMBER_ID` की जगह Meta का **Phone Number ID** भरें (mobile number नहीं).
- HTTP node → Generic Credential Type → **Header Auth** → नया credential:
  - Name: `Authorization`
  - Value: `Bearer YOUR_META_ACCESS_TOKEN` (Bearer के बाद एक space, फिर अपना token)
- पुराने workflow को पहले export/backup करें, फिर inactive करें. नया workflow **Save + Publish/Activate** करें. एक ही WhatsApp app के दो active responders नहीं रखें.
- Screenshot का **सिर्फ Text Message?** IF node हटाएँ/disconnect करें; button tap `interactive` होता है. पुराने **WhatsApp पर भेजो** text node को HTTP Request से बदलना अनिवार्य है.

**Import न करें तो manual copy/paste:**

Code node → Mode **Run Once for All Items** → JavaScript:

```js
// Run Once for All Items. Keep IDs, not display titles, for button/list replies.
const result = [];
for (const item of $input.all()) {
  const root = item.json;
  const envelopes = Array.isArray(root) ? root : [root];
  for (const envelope of envelopes) {
    const values = envelope.entry
      ? envelope.entry.flatMap(e => (e.changes || []).map(c => c.value))
      : [envelope];
    for (const value of values) {
      for (const message of value?.messages || []) {
        if (!['text', 'interactive', 'button'].includes(message.type)) continue;
        const input = message.text?.body || message.interactive?.button_reply?.id
          || message.interactive?.list_reply?.id || message.button?.payload
          || message.button?.text || '';
        if (!input) continue;
        if (!/^91[0-9]{10}$/.test(String(message.from)) || !message.id) {
          throw new Error('WhatsApp sender or message ID missing');
        }
        result.push({ json: { from: message.from, input, messageId: message.id } });
      }
    }
  }
}
return result;
```

Postgres node → Operation **Execute Query** → Query:

```sql
SELECT public.wa_receive($1::text, $2::text, $3::text) AS reply;
```

Options → **Query Parameters** (Expression):

```js
{{ [$json.from, $json.input, $json.messageId] }}
```

Options → Query Batching: **Independently**. Customer text को SQL के अंदर जोड़कर query न बनाएँ; ऊपर के `$1/$2/$3` safe parameters हैं.

HTTP Request node:

| Setting | Value |
|---|---|
| Method | POST |
| URL | `https://graph.facebook.com/v23.0/YOUR_PHONE_NUMBER_ID/messages` |
| Authentication | Generic Credential Type → Header Auth (ऊपर वाला credential) |
| Send Body | ON |
| Body Content Type | JSON |
| Specify Body | Using JSON |
| JSON, Expression mode | `{{ JSON.stringify($json.reply) }}` |
| Settings → Retry On Fail | ON, 3 tries, 2000ms |
| Continue On Fail / Never Error | OFF |

`reply` **पूरा WhatsApp JSON body** है. इसे `text.body` के अंदर न रखें. Meta message ID से DB processing deduplicate होती है: retry में order/objection दोबारा save नहीं होता. SQL-only route में retry पर वही reply फिर दिख सकता है; यह handset delivery की exactly-once guarantee नहीं है.

### 4. App से Accept / New Rate / Reject और WhatsApp जवाब

Cloudflare Pages → आपके project → Settings → Variables and Secrets → **Production**:

| Name | क्या भरें |
|---|---|
| `DATABASE_URL` | उसी Postgres का connection URL; `postgresql://USER:PASSWORD@HOST:PORT/DATABASE` |
| `WA_TOKEN` | Valid Meta access token with WhatsApp sending permission |
| `WA_PHONE_ID` | Meta Phone Number ID (mobile number नहीं) |
| `WA_ADMIN_TOKEN` | अपना अलग लंबा random owner secret; उदाहरण बनाने के लिए अपने terminal पर `openssl rand -hex 32` |
| `WA_GRAPH_VERSION` | Optional, default `v23.0`; Meta-supported version रखें |
| `WA_OBJECTION_TEMPLATE` | Optional approved utility template name; 24h के बाहर चाहिए |
| `WA_TEMPLATE_LANG` | उसी template का language code, default `hi` |

Secrets change के बाद **redeploy** करें. Password/token GitHub, workflow JSON या chat में न डालें. अगर Postgres password में `@`, `#`, `/` जैसे characters हैं तो URL-encode करें. Cloudflare के लिए reachable DB host चाहिए; n8n का `localhost` Cloudflare से नहीं पहुँचेगा.

App में Home/Order Book → **WhatsApp → Objection** खोलें. पहली बार **Owner access key** पूछेगा: ऊपर set किया हुआ **WA_ADMIN_TOKEN** भरें (Meta token नहीं). Key सिर्फ current tab की memory में रहती है; reload के बाद फिर पूछेगा.

Customer rate रखें / मेरा rate / Deny → confirmation → server receipt owner और selected item दोबारा verify करेगा. Accept/New Rate में केवल चुनी हुई item line, receipt total और `tvAmt` बदलते हैं; Debtor view sync के बाद update होता है. Deny में receipt unchanged. DB में decision save होने के बाद ही WhatsApp send होता है. Double tap या retry से rate दोबारा apply नहीं होता.

WhatsApp fail हो तो decision खोता नहीं है: पुराने objections में **Retry WhatsApp** दिखेगा और कारण दिखेगा. Token/setting ठीक करें फिर retry. `Meta accepted` API acceptance है, customer ने पढ़ लिया/handset delivery की guarantee नहीं.

**24-hour rule:** पिछले customer message के 24h के अंदर normal text भेज सकते हैं. बाहर approved template चाहिए; बिना template customer से **Hi** भेजवाकर **Retry WhatsApp** करें.

Meta WhatsApp Manager → Message templates → Utility → language **Hindi**, नाम जैसे `satyam_rate_decision`. Body (यही 7 parameters, इसी क्रम में):

```text
SATYAM GOLD
नमस्ते {{1}} जी, आपकी receipt {{2}} के item {{3}} की rate objection का निर्णय:
पुराना rate: INR {{4}}
Final rate: INR {{5}}
Decision: {{6}}
Receipt total: INR {{7}}
जानकारी के लिए Hi लिखें.
```

Meta की approval आवश्यक है; template creation/approval code से अपने-आप नहीं होती. Approved नाम `WA_OBJECTION_TEMPLATE` में रखें. Language बदलें तो `WA_TEMPLATE_LANG` बिल्कुल वही रखें. Parameter samples: Customer, 12, Atta Gold, 500, 480, accept, 960.

### 5. वैकल्पिक route — n8n में Postgres न रखना हो

**यह ऊपर वाले 4-node route का विकल्प है, साथ नहीं चलाना.**

```text
WhatsApp Trigger → HTTP Request → आपकी app का /api/wa
```

Cloudflare secret `WA_RELAY_SECRET` में अलग random secret set करें और redeploy.
HTTP node: POST `https://YOUR_APP_DOMAIN/api/wa`, Header `X-WA-Relay-Secret` = वही secret (Header Auth credential में रखें), JSON body Expression `{{ $json }}`, Continue On Fail OFF.
पूरा Trigger JSON भेजें. अलग Meta send node नहीं: `/api/wa` स्वयं reply भेजता है. Invalid relay secret पर 401 आएगा.

n8n भी न रखें तो Meta callback `https://YOUR_APP_DOMAIN/api/wa`; Cloudflare में `WA_VERIFY_TOKEN` और `WA_APP_SECRET` (Meta App Secret) set करें. Meta में same verify token और `messages` subscription. Direct webhook signature validate होती है. इस mode में n8n inactive रखें.

### 6. Packing values — ध्यान से verify करें

App के existing defaults रखे हैं, आपके वास्तविक packing से अलग हो तो live orders से पहले बदलें:

| Product | बोरा के अंदर | थैला के अंदर |
|---|---|---|
| Atta Gold 23KG | 1 unit | ग्राहक से नहीं पूछा जाता |
| Atta 18KG | 3 थैला | ग्राहक से नहीं पूछा जाता |
| Atta 10KG | 5 थैला | ग्राहक से नहीं पूछा जाता |
| Atta 5KG | 10 थैला | ग्राहक से नहीं पूछा जाता |
| Sattu/Besan 200g | 50 packets | 10 packets |
| Sattu/Besan 500g | 20 packets | 4 packets |

Atta की quantity customer से बोरा में है; Order Book में underlying थैला units/सही rate के साथ save होती है. उदाहरण: 10KG के 2 बोरा = 10 थैला. Master 10KG ₹200/थैला हो तो confirmation ₹1,000/बोरा, total ₹2,000.

Sattu/Besan packet counts `sg_wa_cfg.pk` में हैं; missing config पर ऊपर के defaults लागू होते हैं. नीचे query **तभी** चलाएँ जब आपका 200g Sattu थैला सच में 12 packets का हो:

```sql
UPDATE public.sg_store
SET value = jsonb_set(value, '{v,pk}',
  COALESCE(value->'v'->'pk',
    '{"sattu":{"200":{"bora":50,"thaila":10},"500":{"bora":20,"thaila":4}},"besan":{"200":{"bora":50,"thaila":10},"500":{"bora":20,"thaila":4}}}'::jsonb)
  || jsonb_build_object('sattu',
      COALESCE(value->'v'->'pk'->'sattu','{"200":{"bora":50,"thaila":10},"500":{"bora":20,"thaila":4}}'::jsonb)
      || jsonb_build_object('200',COALESCE(value->'v'->'pk'->'sattu'->'200','{"bora":50}'::jsonb)||'{"thaila":12}'::jsonb))),
  updated_at=(extract(epoch from clock_timestamp())*1000)::bigint, synced_at=now()
WHERE key='sg_wa_cfg';
```

### 7. सिर्फ छोटे live checks

1. Registered customer से Hi → 3 clickable buttons.
2. Order → Atta → 10KG → 2 → confirmation rate/total सही → Confirm → app Order Book.
3. Rate Objection में दूसरे customer का receipt number → reject; अपनी receipt → item → rate → Confirm Submit → app से decision → WhatsApp reply.
4. Creditor से Hi → Master Wheat rate.

Automated check: `npm test` — in-memory PostgreSQL, Meta calls mocked; production DB/customer messages नहीं छूता. Live Adminer migration, n8n import/activation, template approval और actual WhatsApp delivery आपको ऊपर settings के बाद verify करनी हैं.

Troubleshooting:
- पुराना numbered/text menu: पुराना workflow अभी active है या पुराना SQL function चल रहा है.
- Button tap पर कुछ नहीं: text-only IF हटाएँ; `interactive.*_reply.id` extract करें.
- `relation/function does not exist`: गलत database/schema या migration नहीं चली.
- Unknown number / receipt mismatch: app mobile + exact receipt name/address + successful cloud sync जाँचें. `sg_wa_cust` summary bot को चाहिए.
- `401 Owner access key`: deployed `WA_ADMIN_TOKEN` और app में भरी key समान हो; secrets के बाद redeploy.
- Meta `190`: invalid/expired token. `131047`/24h: approved template या नया Hi, फिर Retry.
- URL 404: app Functions deploy नहीं हुई या गलत domain. n8n editor domain को app domain न समझें.
- Pending app data: sync पूरा होने दें; approval के बीच उसी receipt को दूसरे tab/device से edit न करें. Notebook के बाकी sync में existing last-write-wins model है; यह पूर्ण multi-user ledger locking system नहीं है.
- Owner/admin APIs और database को public/untrusted access से सुरक्षित रखें. Notebook का existing `/api/sync` access model अलग है; frontend login को server authorization न समझें. Secrets किसी customer को न दें.

Debug (Adminer, owner only):

```sql
SELECT phone,dir,body,created_at FROM wa_log ORDER BY id DESC LIMIT 20;
SELECT objection_id,delivery,last_error,meta_id FROM wa_decisions ORDER BY updated_at DESC LIMIT 20;
```
