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
  - नगद नाम खाते (Serial No auto-fills name+address from माल आवत; Mill / A/C / Home / Counter modes; Home entries highlighted & excluded from total)
  - नगद खर्च (Mill kharch, Advance-pending exact-later, Labour multi-category with saved rates, Van: गाड़ी खर्च / Petrol van+bike with van no & driver)
- 👷 Labour rates: double-click "नगद खर्च" header → password (current hour + date, e.g. 12:00 & 22 tarikh → `1222`) → rate settings
- Σ TOTAL button: per-column add → minus A/C (red) → green final, plus grand summary block
  - **कुल Total = (रोकड + नगदी बिक्री) + (जमा खाते नाम) + (IN HOME) − (नगद नाम खाते) − (नगद खर्च)**
    नगद नाम खाते और नगद खर्च जुड़ते नहीं — घटते हैं (grand block में लाल `-` के साथ दिखते हैं)
- ✂️ Double-tap an entry = cut (strikethrough, removed from totals but stays visible)
- 🕐 Timestamp on every entry
- 🖨️ Print (नया engine): अपना अलग पूरा document एक hidden iframe में बनता है (iOS/iPad पर नयी tab में) —
  पुराना `body>*{display:none}` + `#print-stage` वाला तरीक़ा हटा दिया गया, जिससे tablet/mobile में
  **white blank page** आ रहा था। Notebook date पर 3 बार click, Print tile, Record Book का 🖨️ Print,
  Receipt और Attendance — सब इसी engine से A4 पर fit होकर छपते हैं।
- 🗓️ Attendance: पिछली तारीख़ (या lock हो चुकी तारीख़) पर mark बदलने के लिए पहले **3 बार click** —
  तभी admin password खुलेगा (ग़लती से एक touch पर password on नहीं होगा)
- 💾 Data saved per-date in localStorage

## Login
Phone: `9631816666` &nbsp; Password: `Satyam`

## Run
Just open `index.html` — pure HTML/CSS/JS, no build step.
