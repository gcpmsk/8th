# 📞 CALL WALA + 🚨 EMERGENCY WALA — पूरा Setup (Step by Step)

इसी क्रम में करें. हर step 2–5 मिनट का है. WhatsApp bot और रसीद वाला कुछ भी नहीं छेड़ा गया.

```
App (Call Wala)  →  PostgreSQL (कतार cw_queue)  →  n8n (हर 30 sec)  →  Dograh  →  Voicelink  →  Customer का फ़ोन
                          ↑                                              │
                          └──── n8n Webhook /sg-call  ←── Dograh (कॉल का नतीजा, recording, AI सारांश)
```

---

## Step 1 — PostgreSQL (Adminer)

1. Adminer खोलें → **SQL command**.
2. GitHub की file **`call-schema.sql`** का पूरा text paste करें → **Execute**.
3. कोई पुरानी table नहीं हटती. दोबारा चलाना सुरक्षित है. नई tables: `cw_queue`, `cw_calls`, `cw_rateinq`, `cw_state`, `cw_dnd`, `em_alerts`.

जाँच: `SELECT cw_api('{"view":"dash"}');` → `{"ok": true, ...}` आना चाहिए.

## Step 2 — Cloudflare

कुछ नया नहीं करना. GitHub पर push होते ही Pages अपने आप deploy करता है.
पुराने वाले ही variable चाहिए: `DATABASE_URL` और `WA_ADMIN_TOKEN` (Call Wala इसी Owner key से खुलता है).

## Step 3 — App में

1. **Tally View → Debtors** → ऊपर title पर **3 बार click** (Mobile Add ON) → नाम पर click →
   अब दो box हैं: **📞 Call Wala** और **💬 WhatsApp Wala**. दोनों एक हों तो सिर्फ़ WhatsApp Wala भरें.
   गेहूँ सप्लायर के नंबर **Creditors** में इसी तरह भरें.
2. **Home → 📞 Call Wala → ⚙️ Settings**:
   - Dograh URL: `https://140-245-7-25.sslip.io`
   - Telephony Configuration ID: `7` (Voicelink-Asterisk)
   - Calling Hours, Retry भरें → **💾 Settings Save**.
   - Save के बाद नीचे एक **Webhook URL** बनेगा (`…/webhook/sg-call?k=…`).
3. उसी screen के **⬇️ Download** से 5 Dograh file + n8n file download करें —
   इनमें आपका Webhook URL और Dograh URL **पहले से भरा** आता है.

## Step 4 — Dograh

1. **Developers → API Keys → Create** → key copy करके रखें (n8n में लगेगी).
2. **Voice Agents → Upload Agent Definition** → पाँचों file एक-एक करके upload करें:

| File | काम | App Settings में कहाँ |
|---|---|---|
| `1-outgoing-customer.json` | पुराने customer को कॉल (Area Dialer, Inactive, Dialpad, Call Back) | पुराना Customer (Outgoing) |
| `2-incoming-all.json` | कोई भी कॉल करे — customer / सप्लायर / नया, अपने आप पहचानता है | — (Telephony में लगेगा) |
| `3-new-customer-lead.json` | नए दुकानदार / customer को कॉल | नया Customer / दुकानदार |
| `4-wheat-supplier.json` | गेहूँ सप्लायर को कॉल | गेहूँ सप्लायर |
| `5-owner-stock-alert.json` | Owner को Low-Stock कॉल | Owner Stock Alert |

3. हर agent खोलकर: **Model** tab में वही LLM / Voice / Transcriber चुनें जो आपके पुराने agent #9 में है → **Save → Publish**.
4. हर agent में **Webhook node** ("Call का नतीजा → n8n") खोलकर देखें कि URL आपका Webhook URL है.
5. सिर्फ़ `2-incoming-all` में: **Start Call → Advanced Settings → Pre-Call Data Fetch**
   = **Inbound calls only** (या Enabled), URL = वही Webhook URL. (file में भरा है — बस जाँच लें.)
6. हर agent का **Agent UUID** (agent → Settings) और **ID** (Voice Agents list का पहला नंबर) नोट करें →
   App → Call Wala → Settings की table में भरें → Save.
7. **Telephony → Voicelink-Asterisk → Phone numbers → ✏️** → **Inbound workflow = "SG - Incoming (Call Wala)"**.

## Step 5 — n8n

1. **Create workflow → ⋯ → Import from File** → `n8n-call-wala.json`.
2. 4 Postgres node (`कतार देखो`, `Call का जवाब save`, `स्थिति save`, `Hook`) → वही PostgreSQL credential चुनें जो WhatsApp workflow में है.
3. 2 Dograh node (`Dograh: Call लगाओ`, `Dograh: Call की स्थिति`) → Credential → **Create new → Header Auth**:
   Name = `X-API-Key`, Value = Step 4.1 वाली key. URL में `REPLACE-DOGRAH-URL` दिखे तो अपना Dograh URL लिखें.
4. `WhatsApp Alert भेजो` node → वही Header Auth credential और वही `PHONE_NUMBER_ID` जो पुराने "WhatsApp JSON भेजो" node में है.
5. **Publish** करें. (Publish होते ही हर 30 sec कतार देखी जाती है.)

## Step 6 — Test

1. Call Wala → **⌨️ Dialpad** → अपना नंबर + कारण ("test कॉल") → **AI Call लगाओ**.
2. ऊपर **Live Monitor** में 30 sec के अंदर "अभी बात चल रही है" दिखेगा, फ़ोन बजेगा.
3. कॉल कटने के ~1 मिनट बाद **📋 Call History** में recording + AI सारांश आएगा.
4. कॉल पर "5 बोरा Atta Gold भेज दो… हाँ" बोलें → **Order Book** में बैंगनी "📞 AI Call" order दिखेगा.
5. दूसरे फ़ोन से 9429491500 पर कॉल करें → Incoming agent उठाएगा.

---

## 🚨 Emergency Wala — पहली बार

1. **⚙️ Settings**: दोनों Owner नंबर, **Stock कब से गिनना है** (आज की तारीख़), गेहूँ की Alert limit (जैसे 200 बोरा) → Save.
2. **"रसीद कटते ही कटौती" table ज़रूर जाँचें** — हर item की 1 qty में कितने किलो माल घटे.
   Default मेरे अंदाज़ से भरे हैं (Atta Gold = 50 kg, Sattu/Besan = चना). अपने असली packing से ठीक कर लें.
3. **➕ माल आवत**: आज गोदाम में जितना गेहूँ है उसकी एक entry डालें (Opening stock).
4. इसके बाद: Notebook के **माल आवत खाते** का गेहूँ अपने आप जुड़ता है (− 700g × बोरा), और हर **Atta Receipt** कटते ही stock घटता है.
5. Limit छूते ही दोनों Owner को WhatsApp + AI कॉल — उसमें आज कितनी रसीद कटी, कितना order pending, कितना गेहूँ बचा.
   WhatsApp सादा text तभी पहुँचता है जब Owner ने पिछले 24 घंटे में bot को message किया हो; वरना Meta में एक template बनाकर उसका नाम Settings में भरें.

---

## दिक्कत हो तो

| क्या दिखा | क्या करें |
|---|---|
| Monitor में "n8n workflow चालू नहीं दिख रहा" | n8n में workflow Publish करें; Executions में error देखें |
| Queue में "Dograh ने कॉल नहीं लगाई — HTTP 401" | n8n के Dograh credential में API key ग़लत |
| "HTTP 404" | Agent UUID ग़लत, या agent Publish नहीं हुआ |
| "Settings में Dograh URL / Agent UUID नहीं भरा" | Call Wala → Settings |
| कॉल लगी पर History में कुछ नहीं | Dograh agent के Webhook node का URL जाँचें; n8n Webhook का execution देखें |
| Recording नहीं चलती | Dograh का URL browser में एक बार खोलकर certificate "Proceed" करें (sslip.io का certificate self-signed है) |
| AI को नाम / बकाया नहीं पता (incoming) | `2-incoming-all` में Pre-Call Data Fetch चालू करें |
| सब कॉल तुरंत रोकनी हैं | लाल **🛑 Cancel All Calls** — कतार + Schedule रद्द, नई कॉल बंद |

## काम की SQL

```sql
SELECT * FROM cw_queue ORDER BY id DESC LIMIT 50;   -- कतार
SELECT * FROM cw_calls ORDER BY id DESC LIMIT 50;   -- call history
SELECT * FROM cw_rateinq ORDER BY id DESC;          -- rate inquiry
SELECT em_stock();                                  -- live stock
SELECT * FROM cw_state;                             -- stop / heartbeat
```

---

## 🔧 v2 अपडेट (21 Nov) — Call कटना + Incoming नहीं लगना

### A. AI कॉल क्यों नहीं काटता था, अब क्या बदला
Dograh में कॉल तभी कटती है जब agent **End Call node** तक पहुँचे, और वहाँ पहुँचाने वाली "edge की शर्त" LLM को पूरी होती दिखे.
पुरानी शर्त ("purpose complete") ढीली थी, इसलिए AI बात ख़त्म होने के बाद भी नए सवाल पूछता रहता था.
v2 फ़ाइलों में (नाम के आगे **v2**):
- हर agent से End Call की edge की शर्त सख़्त: काम पूरा / "ठीक है, धन्यवाद, bye" / मना / चुप्पी → तुरंत End Call.
- Global Node में "कॉल ख़त्म करने का नियम": अलविदा सिर्फ़ End Call स्टेज बोलेगा, "और कुछ चाहिए?" सिर्फ़ एक बार.
- End Call prompt: सिर्फ़ एक छोटा अलविदा-वाक्य, फिर चुप — कॉल अपने-आप कट जाती है.
- Owner Stock Alert: एक बार पढ़कर "ओके / ठीक है / चुप्पी" पर कटेगा.

**Dograh में यह एक बार हाथ से भी लगाएँ (हर agent: ⚙️ Settings / Configurations):**

| Setting | मान | क्यों |
|---|---|---|
| Max Call Duration | 180 (3 मिनट; alert agent में 90) | AI अटक भी जाए तो इतने पर कॉल अपने-आप कटे |
| Max User Idle Timeout | 8 | सामने वाला चुप रहे तो 8 सेकंड बाद कटे |

### B. v2 कैसे लगाएँ (दो में से एक तरीक़ा)
**तरीक़ा 1 — सबसे आसान (नए agent):** App → Call Wala → ⚙️ Settings से पाँचों नई file download करें (Hook key अपने-आप भरी आती है) → Dograh → **Upload Agent Definition** → पुराने 5 agent **Archive** करें →
नए agents में Model/Voice/Transcriber चुनकर **Publish** → नए **Agent UUID + ID** App Settings में भरें → Telephony → Phone number → **Inbound workflow** फिर से `SG - Incoming (Call Wala) v2` चुनें. (यह आख़िरी step भूलने पर Incoming नहीं लगेगा.)

**तरीक़ा 2 — पुराने ही agent update (ID/UUID वही रहते हैं):** `scripts/dograh-update.sh` देखें (ऊपर comment में चलाने का तरीक़ा). इसमें Model/Voice setting नहीं छूती.

### C. मोबाइल से 9429491500 पर कॉल करने पर AI नहीं उठता — जाँच (ऊपर से नीचे)
कॉल Dograh तक पहुँचने से पहले ये 4 जगह से गुज़रती है. जहाँ टूटे वहीं ठीक करें:

| # | जाँच | कैसे देखें | ठीक कैसे करें |
|---|---|---|---|
| 1 | Voicelink से आपके Asterisk तक कॉल आ रही है? | Asterisk CLI: `asterisk -rvvv` खोलकर मोबाइल से कॉल करें — `INVITE` / "Incoming call" की line आनी चाहिए | नहीं आती → Voicelink panel में DID 9429491500 का destination/IP आपका Asterisk सर्वर रखें, सर्वर पर SIP port (5060/udp) खुला हो |
| 2 | Asterisk का dialplan इस नंबर को Stasis में भेजता है? | CLI में `dialplan show from-external` | `exten => _X.,1,Stasis(<Dograh का Stasis App Name>)` हो; नाम Dograh → Telephony → Voicelink-Asterisk config पर दिखता है. बदलने पर `dialplan reload` |
| 3 | Dograh में यही नंबर Phone number की तरह जुड़ा है, और Inbound workflow लगा है? | Telephony → Voicelink-Asterisk → Phone numbers | नंबर वैसा ही लिखें जैसा dialplan में `${EXTEN}` आता है (जैसे `9429491500` या `09429491500`; CLI की `Incoming call to ...` line में देखें). Inbound workflow = `SG - Incoming (Call Wala) v2`, Save |
| 4 | Dograh के log में क्या दिखा? | सर्वर पर `docker compose logs --tail=100 api ari-manager` | "no matching phone number registered" → #3 का नंबर-format; "no inbound_workflow_id assigned" → inbound workflow चुनें; "Workflow not found" → archive किया हुआ agent लगा है, नया चुनें |

**एक और ज़रूरी बात:** आउटगोइंग (App से) चल रही है, यानी Asterisk↔Dograh ARI जुड़ाव ठीक है. इसलिए गड़बड़ी लगभग हमेशा #1, #2 या #3 में होती है — Dograh code में नहीं.
Incoming agent की Pre-Call Data Fetch (Hook key) ग़लत हो तो भी कॉल **चलती रहती है**, बस AI नाम नहीं जानता — इससे कॉल बंद नहीं होती.

### D. Postgres में `Error in query: 47`
Adminer फ़ाइल के हर `;` को अलग query गिनता है. आख़िर में सिर्फ़ comment बचा था, उसे वह 47वीं (ख़ाली) query समझकर "Unknown error" दिखाता था.
**असली SQL पहले ही सब सफल थीं** (हरे "Query executed OK" और `COMMIT`). v2 की `call-schema.sql` में यह अंतिम comment `COMMIT` के पहले कर दिया है — अब error नहीं आएगा. पुरानी चलाई SQL दोबारा चलाने की ज़रूरत नहीं, पर चला दें तो भी सुरक्षित है.
