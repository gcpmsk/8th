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
