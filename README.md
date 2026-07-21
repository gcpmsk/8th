# SATYAM GOLD — Digital Notebook

Hindi handwriting-style digital ledger (डिजिटल बही-खाता) web app for PC & Tablet.

## Features
- 🔐 Login screen with golden animated "SATYAM GOLD" branding
- 🏠 Home dashboard: 7 colourful 3D tiles (Notebook, S.Book, Print, Order Book, Attendance, Call, Emergency) + Chat AI button
- 📔 Two-page notebook (no lines, handwriting style) with Hindi headers:
  - रोकड + नगदी बिक्री (item → qty → rate → Cash / A/C / Mix payment)
  - जमा खाते नाम (A/C entries shown in red)
  - माल आवत खाते (Serial No, Name, Address, D/P badge `pic = dust/plastic`, Gross/Tare/Nett weight, vertical RATE — weights & rate can be filled later ✏️)
  - नगद नाम खाते (Serial No auto-fills name+address from माल आवत; Mill / A/C / Home / Counter modes; Home entries highlighted & excluded from total)
  - नगद खर्च (Mill kharch, Advance-pending exact-later, Labour multi-category with saved rates, Van: गाड़ी खर्च / Petrol van+bike with van no & driver)
- 👷 Labour rates: double-click "नगद खर्च" header → password (current hour + date, e.g. 12:00 & 22 tarikh → `1222`) → rate settings
- Σ TOTAL button: per-column add → minus A/C (red) → green final, plus grand summary block (रोकड / जमा / नगद नाम / खर्च)
- ✂️ Double-tap an entry = cut (strikethrough, removed from totals but stays visible)
- 🕐 Timestamp on every entry
- 🖨️ Print: spine button / date triple-click / Print tile → Plain or With-Total, fits one A4 landscape page
- 💾 Data saved per-date in localStorage

## Login
Phone: `9631816666` &nbsp; Password: `Satyam`

## Run
Just open `index.html` — pure HTML/CSS/JS, no build step.
