-- =====================================================================
-- SATYAM GOLD — 📞 CALL WALA + 🚨 EMERGENCY WALA  (PostgreSQL)
-- पूरा text Adminer → SQL command में paste करके Execute करें.
-- कोई पुरानी table / order / receipt DELETE या DROP नहीं होती.
-- दोबारा चलाना सुरक्षित है (DB: postgres, Schema: public).
-- Dograh की अपनी tables (workflows, workflow_runs …) को यह छूता नहीं —
-- हमारी सारी tables cw_ / em_ से शुरू होती हैं.
--
-- n8n:  Schedule(30s) → cw_tick() → Dograh API → cw_after()
--       Webhook /sg-call → cw_hook()  (Dograh pre-call fetch + call result)
-- App:  /api/call → cw_api()
-- =====================================================================
BEGIN;
SET LOCAL search_path TO public;

CREATE TABLE IF NOT EXISTS sg_store (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- कॉल की कतार (अभी / schedule / retry / callback / alert)
CREATE TABLE IF NOT EXISTS cw_queue (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL DEFAULT 'manual',   -- manual | area | inactive | callback | supplier | alert
    agent        TEXT NOT NULL DEFAULT 'out',      -- out | new | sup | alert  (कौन सा Dograh agent)
    batch        TEXT,
    ckey         TEXT, name TEXT, address TEXT, area TEXT,
    phone        TEXT NOT NULL,                    -- 10 अंक
    reason       TEXT,                             -- "Karan" — AI इसी पर बात करेगा
    ctx          JSONB NOT NULL DEFAULT '{}'::jsonb,
    status       TEXT NOT NULL DEFAULT 'queued',   -- queued | dialing | done | noanswer | failed | skipped | cancelled
    tries        INT  NOT NULL DEFAULT 0,
    run_id       BIGINT,                           -- Dograh workflow_run_id
    note         TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dialed_at    TIMESTAMPTZ, checked_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cw_queue_pick_idx  ON cw_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS cw_queue_phone_idx ON cw_queue (phone);
CREATE INDEX IF NOT EXISTS cw_queue_run_idx   ON cw_queue (run_id);

-- हर inbound / outbound कॉल का record (recording + AI सारांश)
CREATE TABLE IF NOT EXISTS cw_calls (
    id          BIGSERIAL PRIMARY KEY,
    run_id      BIGINT UNIQUE,
    queue_id    BIGINT,
    dir         TEXT NOT NULL DEFAULT 'out',       -- in | out
    kind        TEXT, agent TEXT,
    phone       TEXT, ckey TEXT, name TEXT, address TEXT, area TEXT, ptype TEXT,
    reason      TEXT, status TEXT,
    answered    BOOLEAN NOT NULL DEFAULT false,
    duration    INT NOT NULL DEFAULT 0,
    recording   TEXT, transcript TEXT, summary TEXT,
    rate_talk   TEXT, order_text TEXT, order_no TEXT,
    callback_at TIMESTAMPTZ,
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cw_calls_phone_idx ON cw_calls (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS cw_calls_ckey_idx  ON cw_calls (ckey, created_at DESC);
CREATE INDEX IF NOT EXISTS cw_calls_time_idx  ON cw_calls (created_at DESC);

-- Rate Inquiry / Negotiation (Approve / Reject)
CREATE TABLE IF NOT EXISTS cw_rateinq (
    id BIGSERIAL PRIMARY KEY, call_id BIGINT, ckey TEXT, name TEXT, phone TEXT, area TEXT,
    kind TEXT NOT NULL DEFAULT 'ask',              -- ask (सिर्फ़ पूछा) | nego (कम करने को कहा)
    item TEXT, cur_rate NUMERIC, want_rate NUMERIC, note TEXT,
    status TEXT NOT NULL DEFAULT 'open',           -- open | approved | rejected
    final_rate NUMERIC, decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cw_state (k TEXT PRIMARY KEY, v JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cw_dnd   (phone TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS em_alerts (id BIGSERIAL PRIMARY KEY, mat TEXT, body TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.cw_a(j JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END $$;
CREATE OR REPLACE FUNCTION public.cw_obj(p_k TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value->'v' FROM sg_store WHERE key = p_k AND jsonb_typeof(value->'v') = 'object'), '{}'::jsonb) $$;
CREATE OR REPLACE FUNCTION public.cw_arr(p_k TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value->'v' FROM sg_store WHERE key = p_k AND jsonb_typeof(value->'v') = 'array'), '[]'::jsonb) $$;
CREATE OR REPLACE FUNCTION public.cw_today() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') $$;
CREATE OR REPLACE FUNCTION public.cw_p10(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(right(regexp_replace(COALESCE(t,''), '[^0-9]', '', 'g'), 10), '') $$;
CREATE OR REPLACE FUNCTION public.cw_key(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(btrim(COALESCE(t,'')), '\s+', ' ', 'g')) $$;
CREATE OR REPLACE FUNCTION public.cw_num(t TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN NULLIF(regexp_replace(COALESCE(t,''), '[^0-9.-]', '', 'g'), '')::NUMERIC;
EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.cw_n(n NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL THEN '0' WHEN n = trunc(n) THEN trunc(n)::BIGINT::TEXT ELSE rtrim(rtrim(round(n,2)::TEXT,'0'),'.') END $$;
-- Dograh template का बचा हुआ "{{...}}" / None / null → NULL
CREATE OR REPLACE FUNCTION public.cw_clean(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IS NULL OR btrim(t) = '' OR t LIKE '%{{%' OR lower(btrim(t)) IN ('none','null','undefined','n/a','na','-','nil') THEN NULL ELSE btrim(t) END $$;
CREATE OR REPLACE FUNCTION public.cw_dmy(t TEXT) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
BEGIN IF t !~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' THEN RETURN NULL; END IF; RETURN to_date(t, 'DD-MM-YYYY');
EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.cw_iso(t TEXT) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
BEGIN IF t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN RETURN NULL; END IF; RETURN left(t,10)::DATE;
EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

-- Item का पक्का नाम (Order Book / Atta Receipt वाला)
CREATE OR REPLACE FUNCTION public.cw_item(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t IS NULL THEN NULL
    WHEN s ~ 'gold|गोल्ड'            THEN 'Atta Gold'
    WHEN s ~ 'chokar|चोकर|bran'      THEN 'Chokar (30kg)'
    WHEN s ~ 'sattu|सत्तू'           THEN CASE WHEN s ~ '200' THEN 'Sattu 200g' ELSE 'Sattu 500g' END
    WHEN s ~ 'besan|बेसन'            THEN CASE WHEN s ~ '200' THEN 'Besan 200g' ELSE 'Besan 500g' END
    WHEN s ~ '50' THEN 'Atta 50kg' WHEN s ~ '47' THEN 'Atta 47kg' WHEN s ~ '18' THEN 'Atta 18kg' WHEN s ~ '10' THEN 'Atta 10kg'
    WHEN s ~ '(^|[^0-9])5($|[^0-9])' THEN 'Atta 5kg'
    ELSE btrim(t) END FROM (SELECT lower(COALESCE(t,'')) AS s) x $$;
CREATE OR REPLACE FUNCTION public.cw_item_rk(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t WHEN 'Atta Gold' THEN 'gold' WHEN 'Atta 5kg' THEN 'a5' WHEN 'Atta 10kg' THEN 'a10' WHEN 'Atta 18kg' THEN 'a18'
    WHEN 'Sattu 200g' THEN 'sattu' WHEN 'Sattu 500g' THEN 'sattu' WHEN 'Besan 200g' THEN 'besan' WHEN 'Besan 500g' THEN 'besan'
    WHEN 'Chokar (30kg)' THEN 'chokar' END $$;

-- Rate: Master ± Area − Customer special  (app के 💰 Set Rate जैसा, वही sg_rates)
CREATE OR REPLACE FUNCTION public.cw_rate(p_area TEXT, p_key TEXT, p_rk TEXT) RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE R JSONB := cw_obj('sg_rates'); b NUMERIC;
BEGIN
  b := GREATEST(0, COALESCE(cw_num(R->'master'->>p_rk),0) + COALESCE(cw_num(R->'areaAdj'->p_area->>p_rk),0));
  RETURN GREATEST(0, b - COALESCE(cw_num(R->'cust'->p_key->>p_rk),0));
EXCEPTION WHEN OTHERS THEN RETURN 0; END $$;
CREATE OR REPLACE FUNCTION public.cw_ratecard(p_area TEXT, p_key TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(t || ' — ' || cw_n(r) || ' रुपये', '; ' ORDER BY o), '')
  FROM (SELECT o, t, cw_rate(p_area, p_key, rk) AS r FROM (VALUES (1,'gold','Atta Gold'),(2,'a18','Atta 18kg'),(3,'a10','Atta 10kg'),(4,'a5','Atta 5kg'),
        (5,'sattu','Sattu 1 किलो'),(6,'besan','Besan 1 किलो'),(7,'chokar','Chokar')) v(o,rk,t)) z WHERE r > 0 $$;

-- Customer खोजो: Call Wala number या WhatsApp Wala number से (app हर 30 sec sg_call_cust लिखता है)
CREATE OR REPLACE FUNCTION public.cw_cust(p10 TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT x FROM (
    SELECT e.value || jsonb_build_object('key', e.key) AS x, 0 AS o, (e.value->>'call' = p10) AS m1, (e.value->>'type' = 'deb') AS m2
      FROM jsonb_each(cw_obj('sg_call_cust')) e WHERE p10 IS NOT NULL AND (e.value->>'call' = p10 OR e.value->>'wa' = p10)
    UNION ALL
    SELECT e.value || jsonb_build_object('call', e.key, 'wa', e.key, 'type', COALESCE(e.value->>'type','deb')), 1, true, true
      FROM jsonb_each(cw_obj('sg_wa_cust')) e WHERE p10 IS NOT NULL AND e.key = p10
  ) z ORDER BY o, m1 DESC, m2 DESC LIMIT 1 $$;

-- Smart Order-Skip: आज इस customer का order (WhatsApp / Call / App) या रसीद आ चुकी?
CREATE OR REPLACE FUNCTION public.cw_ordered_today(p_key TEXT, p_name TEXT, p10 TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) o
    WHERE s.key IN ('sg_ord_' || cw_today(), 'sg_arcpt_' || cw_today())
      AND COALESCE(o->>'cancelled','false') <> 'true'
      AND ( cw_key(o->>'name') IN (COALESCE(NULLIF(cw_key(p_key),''),'~'), COALESCE(NULLIF(cw_key(p_name),''),'~'))
         OR (p10 IS NOT NULL AND cw_p10(o->>'phone') = p10) ) ) $$;

-- हर area के 4 दुकानदार (नया customer पूछे तो नज़दीकी दुकान बताने के लिए)
CREATE OR REPLACE FUNCTION public.cw_dealers(p_area TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(ar || ': ' || names, ' | ' ORDER BY ar), '') FROM (
    SELECT ar, string_agg(nm, ', ') AS names FROM (
      SELECT COALESCE(NULLIF(e.value->>'area',''),'OTHER') AS ar,
             (e.value->>'name') || COALESCE(' (' || NULLIF(e.value->>'address','') || ')', '') AS nm,
             row_number() OVER (PARTITION BY e.value->>'area' ORDER BY e.value->>'last' DESC NULLS LAST) AS rn
      FROM jsonb_each(cw_obj('sg_call_cust')) e
      WHERE e.value->>'type' = 'deb'
        AND (COALESCE(p_area,'') = '' OR e.value->>'area' ILIKE '%'||p_area||'%' OR e.value->>'address' ILIKE '%'||p_area||'%')
    ) a WHERE rn <= 4 GROUP BY ar ) b $$;

-- ---------------------------------------------------------------- AI को call से पहले मिलने वाली जानकारी
CREATE OR REPLACE FUNCTION public.cw_ctx(p10 TEXT, dirn TEXT, qid BIGINT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE q cw_queue%ROWTYPE; c JSONB; cfg JSONB := cw_obj('sg_call_cfg'); R JSONB := cw_obj('sg_rates');
  pt TEXT; nm TEXT; ar TEXT; ky TEXT; due NUMERIC; duetxt TEXT; wr NUMERIC; wtxt TEXT; rsn TEXT; knd TEXT;
BEGIN
  IF qid IS NOT NULL THEN SELECT * INTO q FROM cw_queue WHERE id = qid; END IF;
  c := cw_cust(p10);
  knd := COALESCE(q.kind, 'inbound');
  pt := CASE WHEN q.agent = 'alert' THEN 'owner' WHEN q.agent = 'sup' THEN 'supplier' WHEN q.agent = 'new' THEN 'new'
             WHEN q.agent = 'out' THEN 'customer' WHEN c IS NULL THEN 'new' WHEN c->>'type' = 'cred' THEN 'supplier' ELSE 'customer' END;
  nm := COALESCE(NULLIF(q.name,''), c->>'name', '');
  ar := COALESCE(NULLIF(q.area,''), c->>'area', '');
  ky := COALESCE(NULLIF(q.ckey,''), c->>'key', cw_key(nm));
  due := COALESCE(cw_num(c->>'due'), 0);
  duetxt := CASE
    WHEN pt = 'supplier' THEN CASE WHEN due > 0 THEN 'मिल की तरफ़ से इनका ' || cw_n(due) || ' रुपये देना बाक़ी है। पूछें तो कहो — हिसाब मालिक जी देखकर बता देंगे।' ELSE 'इनका कोई हिसाब बाक़ी नहीं दिख रहा।' END
    WHEN pt = 'customer' AND due > 0 THEN 'इन पर ' || cw_n(due) || ' रुपये पुराना बकाया है (' || COALESCE(c->>'bills','0') || ' रसीद बाक़ी'
         || CASE WHEN COALESCE(cw_num(c->>'oldest'),0) > 0 THEN ', सबसे पुरानी ' || cw_n(cw_num(c->>'oldest')) || ' दिन पुरानी' ELSE '' END
         || ')। नया ऑर्डर लेने से पहले एक बार विनम्रता से पेमेंट की याद ज़रूर दिलाओ।'
    WHEN pt = 'customer' THEN 'कोई बकाया नहीं है — पेमेंट की बात मत छेड़ो।'
    ELSE 'नया नंबर है — कोई हिसाब नहीं।' END;
  wr := COALESCE(NULLIF(cw_num(cfg->'wheat'->>'rate'),0), cw_num(R->'master'->>'wheat'), 0);
  wtxt := CASE WHEN wr > 0 THEN 'आज गेहूँ का रेट ' || cw_n(wr) || ' रुपये ' || COALESCE(NULLIF(cfg->'wheat'->>'unit',''),'प्रति बोरा') || ' है। ' || COALESCE(cfg->'wheat'->>'note','')
               ELSE 'आज का गेहूँ रेट अभी सेट नहीं है — कहो कि मालिक जी ख़ुद कॉल करके रेट बता देंगे।' END;
  rsn := COALESCE(NULLIF(q.reason,''), CASE knd
    WHEN 'area'     THEN 'आज का ऑर्डर लेना है।'
    WHEN 'inactive' THEN 'कई दिन से ऑर्डर नहीं आया — हाल-चाल पूछकर ऑर्डर लेना है।'
    WHEN 'supplier' THEN 'मिल में गेहूँ कम है — गेहूँ ख़रीदना है।'
    WHEN 'inbound'  THEN 'सामने वाले ने ख़ुद कॉल किया है — पहले ध्यान से सुनो उन्हें क्या चाहिए।'
    ELSE 'हाल-चाल पूछकर ऑर्डर लेना है।' END);
  RETURN jsonb_build_object(
    'queue_id', COALESCE(qid::TEXT,''), 'phone', COALESCE(p10,''), 'direction', dirn, 'ptype', pt, 'call_kind', knd,
    'customer_name', nm, 'address', COALESCE(NULLIF(q.address,''), c->>'address', ''), 'area', ar,
    'reason', rsn, 'due_amount', due, 'due_text', duetxt,
    'rate_card', CASE WHEN pt = 'customer' THEN COALESCE(NULLIF(cw_ratecard(ar, ky),''),'रेट लिस्ट अभी सेट नहीं — कहो रेट मालिक जी बताएँगे।') ELSE 'रेट मत बताओ।' END,
    'last_order', COALESCE(NULLIF(c->>'last',''), 'पता नहीं'),
    'wheat_text', wtxt, 'wheat_need', COALESCE(NULLIF(q.ctx->>'wheat_need',''), NULLIF(cfg->'wheat'->>'need',''), 'जितना अच्छा गेहूँ मिल सके'),
    'dealer_list', CASE WHEN pt = 'new' THEN COALESCE(NULLIF(cw_dealers(''),''),'अभी लिस्ट ख़ाली है') ELSE '' END,
    'alert_text', COALESCE(q.ctx->>'alert_text', ''));
END $$;

-- ---------------------------------------------------------------- फोन नहीं उठा → Auto-Retry
CREATE OR REPLACE FUNCTION public.cw_unanswered(qid BIGINT, why TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE cfg JSONB := cw_obj('sg_call_cfg'); mx INT; gp INT; q cw_queue%ROWTYPE;
BEGIN
  mx := COALESCE(cw_num(cfg->'retry'->>'max'), 2)::INT; gp := GREATEST(1, COALESCE(cw_num(cfg->'retry'->>'gap'), 30)::INT);
  SELECT * INTO q FROM cw_queue WHERE id = qid;
  IF NOT FOUND OR q.status <> 'dialing' THEN RETURN; END IF;
  IF q.tries <= mx THEN
    UPDATE cw_queue SET status = 'queued', scheduled_at = now() + make_interval(mins => gp), updated_at = now(),
      note = 'फोन नहीं उठा / व्यस्त — ' || gp || ' मिनट बाद दोबारा (retry ' || q.tries || '/' || mx || ')' WHERE id = qid;
  ELSE
    UPDATE cw_queue SET status = 'noanswer', updated_at = now(),
      note = COALESCE(why, 'फोन नहीं उठा') || ' — ' || q.tries || ' बार कोशिश हो चुकी' WHERE id = qid;
  END IF;
END $$;

-- ---------------------------------------------------------------- कॉल का order → वही Order Book (sg_ord_<date>) जहाँ WhatsApp order आते हैं
-- order_items का format:  "Atta Gold=5 बोरा; Sattu 500g=2 थैला"
CREATE OR REPLACE FUNCTION public.cw_order(p_name TEXT, p_addr TEXT, p10 TEXT, p_key TEXT, p_area TEXT, p_items TEXT, p_run BIGINT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE okey TEXT := 'sg_ord_' || cw_today(); cur JSONB; mx INT; items JSONB := '[]'::jsonb; part TEXT; m TEXT[];
  iname TEXT; qty NUMERIC; unit TEXT; rk TEXT; rate NUMERIC; ord JSONB; ono TEXT;
BEGIN
  FOREACH part IN ARRAY regexp_split_to_array(COALESCE(p_items,''), '\s*[;|\n]+\s*') LOOP
    m := regexp_match(part, '^([^=:]+)[=:]\s*([0-9]+(\.[0-9]+)?)\s*(.*)$');
    CONTINUE WHEN m IS NULL;
    iname := cw_item(m[1]); qty := m[2]::NUMERIC; unit := btrim(COALESCE(m[4],''));
    CONTINUE WHEN qty <= 0 OR COALESCE(iname,'') = '';
    rk := cw_item_rk(iname);
    rate := CASE WHEN rk IN ('gold','chokar') THEN cw_rate(p_area, p_key, rk) ELSE 0 END;   -- बाक़ी का rate app में भरें (पहले जैसा)
    items := items || jsonb_build_object('name', iname, 'qty', qty, 'rate', CASE WHEN rate > 0 THEN cw_n(rate) ELSE '' END,
               'note', btrim(cw_n(qty) || ' ' || unit) || ' · Call');
  END LOOP;
  IF jsonb_array_length(items) = 0 THEN RETURN NULL; END IF;
  SELECT value->'v' INTO cur FROM sg_store WHERE key = okey FOR UPDATE;
  cur := cw_a(cur);
  SELECT COALESCE(max((o->>'no')::INT), 0) INTO mx FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) o
    WHERE s.key LIKE 'sg_ord_%' AND (o->>'no') ~ '^[0-9]{1,8}$';
  ono := CASE WHEN mx + 1 < 10 THEN '0' || (mx + 1)::TEXT ELSE (mx + 1)::TEXT END;
  ord := jsonb_build_object('id', 'c' || md5(COALESCE(p10,'') || clock_timestamp()::TEXT), 'no', ono,
    'ts', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), 'name', p_name, 'address', COALESCE(p_addr,''),
    'src', 'call', 'call', true, 'phone', '91' || COALESCE(p10,''), 'runId', p_run, 'items', items,
    'ordered', (SELECT jsonb_agg(jsonb_build_object('name', i->>'name', 'qty', (i->>'qty')::NUMERIC)) FROM jsonb_array_elements(items) i),
    'deliv', '[]'::jsonb);
  INSERT INTO sg_store (key, value, updated_at) VALUES (okey, jsonb_build_object('v', cur || ord), (EXTRACT(EPOCH FROM now())*1000)::BIGINT)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, synced_at = now();
  RETURN ono;
END $$;

-- ---------------------------------------------------------------- कॉल ख़त्म → log + order + rate inquiry + callback + retry
CREATE OR REPLACE FUNCTION public.cw_finish(d JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE rid BIGINT; qid BIGINT; q cw_queue%ROWTYPE; cl cw_calls%ROWTYPE; c JSONB; p10 TEXT; dirn TEXT; disp TEXT; dur INT; ans BOOLEAN;
  summ TEXT := cw_clean(d->>'summary'); oi TEXT := cw_clean(d->>'order_items'); rtalk TEXT := cw_clean(d->>'rate_talk');
  ritem TEXT := cw_clean(d->>'rate_item'); rwant NUMERIC := cw_num(cw_clean(d->>'rate_wanted'));
  ctype TEXT := lower(COALESCE(cw_clean(d->>'customer_type'),''));
  nm TEXT; ky TEXT; ar TEXT; ad TEXT; pt TEXT; ono TEXT; cb TIMESTAMPTZ; mins NUMERIC; ag TEXT; rk TEXT; clk TEXT; cday INT;
BEGIN
  rid := cw_num(cw_clean(d->>'run_id'))::BIGINT; qid := cw_num(cw_clean(d->>'queue_id'))::BIGINT;
  IF rid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'run_id missing'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cw_run:' || rid, 0));
  IF qid IS NULL THEN SELECT id INTO qid FROM cw_queue WHERE run_id = rid ORDER BY id DESC LIMIT 1; END IF;
  IF qid IS NOT NULL THEN SELECT * INTO q FROM cw_queue WHERE id = qid; END IF;
  dirn := CASE WHEN q.id IS NOT NULL OR lower(COALESCE(cw_clean(d->>'direction'),'')) LIKE 'out%' THEN 'out' ELSE 'in' END;
  p10 := COALESCE(q.phone, cw_p10(cw_clean(d->>'phone')), cw_p10(cw_clean(CASE WHEN dirn = 'in' THEN d->>'caller' ELSE d->>'called' END)));
  c := cw_cust(p10);
  disp := lower(COALESCE(cw_clean(d->>'disposition'), cw_clean(d->>'status'), ''));
  dur := COALESCE(round(cw_num(cw_clean(d->>'duration'))), 0)::INT;
  ans := CASE WHEN disp ~ '(busy|no.?answer|unanswer|not.?answer|fail|cancel|timeout|reject|voicemail|machine|unreachable|congestion|error)' THEN false
              WHEN dur > 0 OR summ IS NOT NULL OR oi IS NOT NULL THEN true
              WHEN disp ~ '(hangup|end_call|complete|qualified|interest|callback|transfer|do_not_call|wrong)' THEN true ELSE false END;
  nm := COALESCE(NULLIF(q.name,''), c->>'name', cw_clean(d->>'customer_name'), '');
  ky := COALESCE(NULLIF(q.ckey,''), c->>'key', NULLIF(cw_key(nm),''));
  ar := COALESCE(NULLIF(q.area,''), c->>'area', cw_clean(d->>'area'), '');
  ad := COALESCE(NULLIF(q.address,''), c->>'address', cw_clean(d->>'address'), '');
  pt := CASE WHEN q.agent = 'alert' THEN 'owner' WHEN c->>'type' = 'cred' OR q.agent = 'sup' THEN 'supplier' WHEN c IS NOT NULL OR q.agent = 'out' THEN 'customer'
             WHEN ctype ~ '(dukaan|dukan|shop|दुकान|retail|wholesal|hotel|kirana)' THEN 'new-shop'
             WHEN ctype <> '' THEN 'new-customer' ELSE 'new' END;

  INSERT INTO cw_calls AS t (run_id, queue_id, dir, kind, agent, phone, ckey, name, address, area, ptype, reason, status, answered, duration,
                             recording, transcript, summary, rate_talk, order_text, data)
  VALUES (rid, q.id, dirn, COALESCE(q.kind,'inbound'), COALESCE(q.agent,'in'), p10, ky, nm, ad, ar, pt, q.reason, NULLIF(disp,''), ans, dur,
          cw_clean(d->>'recording'), cw_clean(d->>'transcript'), summ,
          COALESCE(rtalk, CASE WHEN ritem IS NOT NULL OR rwant IS NOT NULL THEN concat_ws(' ', ritem, CASE WHEN rwant IS NOT NULL THEN '→ ' || cw_n(rwant) || ' रुपये चाहिए' END) END),
          oi, d)
  ON CONFLICT (run_id) DO UPDATE SET
    status = COALESCE(EXCLUDED.status, t.status), answered = t.answered OR EXCLUDED.answered, duration = GREATEST(t.duration, EXCLUDED.duration),
    recording  = CASE WHEN EXCLUDED.recording  ~* '^https?://' THEN EXCLUDED.recording  ELSE COALESCE(t.recording,  EXCLUDED.recording)  END,
    transcript = CASE WHEN EXCLUDED.transcript ~* '^https?://' THEN EXCLUDED.transcript ELSE COALESCE(t.transcript, EXCLUDED.transcript) END,
    summary = COALESCE(EXCLUDED.summary, t.summary), rate_talk = COALESCE(EXCLUDED.rate_talk, t.rate_talk),
    order_text = COALESCE(EXCLUDED.order_text, t.order_text), name = COALESCE(NULLIF(t.name,''), EXCLUDED.name),
    ptype = CASE WHEN t.ptype = 'new' THEN EXCLUDED.ptype ELSE t.ptype END, data = t.data || EXCLUDED.data
  RETURNING * INTO cl;

  -- कतार की row: बात हो गई → done ; नहीं उठा → retry
  IF q.id IS NOT NULL AND (q.run_id IS NULL OR q.run_id = rid) THEN
    IF cl.answered AND q.status IN ('dialing','queued') THEN
      UPDATE cw_queue SET status = 'done', note = COALESCE(left(cl.summary,160),'बात हो गई'), updated_at = now() WHERE id = q.id;
    ELSIF NOT cl.answered AND q.status = 'dialing' THEN
      PERFORM cw_unanswered(q.id, NULLIF(disp,''));
    END IF;
  END IF;

  -- Order → Order Book
  IF cl.answered AND cl.order_no IS NULL AND cl.order_text IS NOT NULL THEN
    ono := cw_order(COALESCE(NULLIF(nm,''), 'Call ' || COALESCE(p10,'')), ad, p10, ky, ar, cl.order_text, rid);
    IF ono IS NOT NULL THEN UPDATE cw_calls SET order_no = ono WHERE id = cl.id; END IF;
  END IF;

  -- Rate पूछा / कम करने को कहा → Rate Inquiry tab
  IF cl.rate_talk IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cw_rateinq WHERE call_id = cl.id) THEN
    rk := cw_item_rk(cw_item(ritem));
    INSERT INTO cw_rateinq (call_id, ckey, name, phone, area, kind, item, cur_rate, want_rate, note)
    VALUES (cl.id, ky, nm, p10, ar, CASE WHEN rwant IS NOT NULL THEN 'nego' ELSE 'ask' END, cw_item(ritem),
            CASE WHEN rk IS NOT NULL THEN NULLIF(cw_rate(ar, ky, rk), 0) END, rwant, cl.rate_talk);
  END IF;

  -- "बाद में कॉल करना" → अपने आप Schedule
  IF cl.answered AND cl.callback_at IS NULL AND p10 IS NOT NULL AND length(p10) = 10 THEN
    BEGIN cb := (cw_clean(d->>'callback_at'))::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'; EXCEPTION WHEN OTHERS THEN cb := NULL; END;
    mins := cw_num(cw_clean(d->>'callback_minutes'));
    clk := substring(COALESCE(cw_clean(d->>'callback_clock'),'') from '([0-9]{1,2}:[0-9]{2})'); cday := LEAST(GREATEST(COALESCE(cw_num(cw_clean(d->>'callback_day')),0)::INT,0),30);
    IF cb IS NULL AND clk IS NOT NULL THEN
      BEGIN cb := (((now() AT TIME ZONE 'Asia/Kolkata')::DATE + cday) + clk::TIME) AT TIME ZONE 'Asia/Kolkata';
        IF cb < now() THEN cb := cb + interval '1 day'; END IF;
      EXCEPTION WHEN OTHERS THEN cb := NULL; END;
    END IF;
    IF cb IS NULL OR cb < now() OR cb > now() + interval '30 days' THEN
      cb := CASE WHEN mins BETWEEN 1 AND 43200 THEN now() + make_interval(mins => mins::INT) END;
    END IF;
    IF cb IS NOT NULL THEN
      ag := CASE WHEN q.agent IN ('out','new','sup') THEN q.agent WHEN pt = 'supplier' THEN 'sup' WHEN pt LIKE 'new%' THEN 'new' ELSE 'out' END;
      UPDATE cw_queue SET status = 'cancelled', note = 'नए callback से बदला', updated_at = now() WHERE phone = p10 AND status = 'queued' AND kind = 'callback';
      INSERT INTO cw_queue (kind, agent, ckey, name, address, area, phone, reason, scheduled_at)
      VALUES ('callback', ag, ky, nm, ad, ar, p10, 'इन्होंने ख़ुद इस समय कॉल करने को कहा था।' || COALESCE(' पिछली बात: ' || left(cl.summary, 300), ''), cb);
      UPDATE cw_calls SET callback_at = cb WHERE id = cl.id;
    END IF;
  END IF;

  -- "दोबारा कॉल मत करना" → DND (auto-dialer इन्हें छोड़ देगा)
  IF p10 IS NOT NULL AND (lower(COALESCE(cw_clean(d->>'dnd'),'')) IN ('true','yes','1') OR disp ~ 'do_not_call') THEN
    INSERT INTO cw_dnd (phone, name) VALUES (p10, nm) ON CONFLICT (phone) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', cl.id, 'answered', cl.answered, 'order_no', ono);
END $$;

-- ---------------------------------------------------------------- 3-Day Inactive Auto-Call (दिन में एक बार list बनती है)
CREATE OR REPLACE FUNCTION public.cw_inactive_fill() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE cfg JSONB := cw_obj('sg_call_cfg'); ia JSONB; tday DATE := (now() AT TIME ZONE 'Asia/Kolkata')::DATE;
  e RECORD; r JSONB; nd INT; bs TEXT; lastd DATE; n INT := 0;
BEGIN
  ia := COALESCE(cfg->'inactive', '{}'::jsonb);
  IF COALESCE(ia->>'on','true') <> 'true' THEN RETURN 0; END IF;
  IF to_char(now() AT TIME ZONE 'Asia/Kolkata','HH24:MI') < COALESCE(NULLIF(ia->>'time',''),'10:00') THEN RETURN 0; END IF;
  IF (SELECT v->>'d' FROM cw_state WHERE k = 'inactive') = tday::TEXT THEN RETURN 0; END IF;
  INSERT INTO cw_state (k, v) VALUES ('inactive', jsonb_build_object('d', tday::TEXT))
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();
  FOR e IN SELECT key AS ck, value AS cv FROM jsonb_each(cw_obj('sg_call_cust')) LOOP
    CONTINUE WHEN e.cv->>'type' <> 'deb' OR COALESCE(e.cv->>'call','') !~ '^[6-9][0-9]{9}$';
    -- Customer का अपना set → नहीं तो Area का → नहीं तो Master
    r := COALESCE(ia->'cust'->e.ck, ia->'area'->(e.cv->>'area'), '{}'::jsonb);
    nd := COALESCE(cw_num(r->>'days'), cw_num(ia->>'days'), 3)::INT;
    bs := COALESCE(NULLIF(r->>'basis',''), NULLIF(ia->>'basis',''), 'order');
    CONTINUE WHEN nd <= 0;
    IF bs = 'call' THEN
      SELECT max(created_at AT TIME ZONE 'Asia/Kolkata')::DATE INTO lastd FROM cw_calls WHERE ckey = e.ck AND answered;
    ELSE
      SELECT GREATEST(cw_iso(e.cv->>'last'), max(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) INTO lastd FROM cw_calls WHERE ckey = e.ck AND order_no IS NOT NULL;
      CONTINUE WHEN lastd IS NULL;                       -- जिसने कभी order ही नहीं दिया उसे auto-call नहीं
    END IF;
    CONTINUE WHEN lastd IS NOT NULL AND tday - lastd < nd;
    CONTINUE WHEN cw_ordered_today(e.ck, e.cv->>'name', e.cv->>'call');
    CONTINUE WHEN EXISTS (SELECT 1 FROM cw_queue WHERE ckey = e.ck AND kind = 'inactive' AND created_at > now() - make_interval(days => nd));
    CONTINUE WHEN EXISTS (SELECT 1 FROM cw_queue WHERE phone = e.cv->>'call' AND status IN ('queued','dialing'));
    CONTINUE WHEN EXISTS (SELECT 1 FROM cw_dnd WHERE phone = e.cv->>'call');
    INSERT INTO cw_queue (kind, agent, batch, ckey, name, address, area, phone, reason)
    VALUES ('inactive', 'out', 'inactive-' || tday, e.ck, e.cv->>'name', e.cv->>'address', e.cv->>'area', e.cv->>'call',
      CASE WHEN lastd IS NULL THEN 'इनसे अभी तक कॉल पर बात नहीं हुई — हाल-चाल पूछो और ऑर्डर लो।'
           ELSE (tday - lastd) || ' दिन से इनका ' || CASE WHEN bs = 'call' THEN 'कॉल' ELSE 'ऑर्डर' END || ' नहीं आया (आख़िरी: ' || to_char(lastd,'DD-MM-YYYY') || ')। हाल-चाल पूछो और प्यार से ऑर्डर लो।' END);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- =====================================================================
-- 🚨 EMERGENCY WALA — Live Stock
-- आवत: Emergency की entry (sg_em_in) + Notebook "माल आवत खाते" का गेहूँ (− 700g × बोरा)
-- कटौती: हर Atta Receipt (sg_arcpt_<date>) कटते ही — settings की "1 qty = कितने किलो" table से
-- =====================================================================
CREATE OR REPLACE FUNCTION public.em_cfg() RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT '{"jute":0.7,"bagKg":50,"nb":true,"repeatH":24,"owners":[],
    "mats":[{"k":"wheat","n":"गेहूँ","unit":"kg","limit":200},{"k":"chana","n":"चना","unit":"kg","limit":0},{"k":"pbag","n":"खाली Packing बोरा","unit":"pcs","limit":0}],
    "ded":{"Atta Gold":{"m":"wheat","kg":50},"Atta 50kg":{"m":"wheat","kg":50},"Atta 47kg":{"m":"wheat","kg":47},"Atta 18kg":{"m":"wheat","kg":18},
           "Atta 10kg":{"m":"wheat","kg":10},"Atta 5kg":{"m":"wheat","kg":5},"Chokar (30kg)":{"m":"wheat","kg":30},
           "Sattu 200g":{"m":"chana","kg":0.2},"Sattu 500g":{"m":"chana","kg":0.5},"Besan 200g":{"m":"chana","kg":0.2},"Besan 500g":{"m":"chana","kg":0.5}}}'::jsonb
         || cw_obj('sg_em_cfg') $$;

CREATE OR REPLACE FUNCTION public.em_stock() RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE cfg JSONB := em_cfg(); fromd DATE; jute NUMERIC; bagkg NUMERIC; ded JSONB; usenb BOOLEAN; res JSONB;
  rcn INT; rckg NUMERIC; pn INT; pkg NUMERIC; unm JSONB; rx TEXT := '^sg_arcpt_[0-9]{2}-[0-9]{2}-[0-9]{4}$';
BEGIN
  fromd := COALESCE(cw_dmy(cfg->>'from'), DATE '2000-01-01');
  jute := COALESCE(cw_num(cfg->>'jute'), 0.7); bagkg := GREATEST(1, COALESCE(cw_num(cfg->>'bagKg'), 50));
  ded := COALESCE(cfg->'ded', '{}'::jsonb); usenb := COALESCE(cfg->>'nb','true') = 'true';
  WITH mv AS (
    SELECT e->>'mat' AS mt, CASE WHEN e->>'dir' = 'out' THEN 0 ELSE COALESCE(cw_num(e->>'net'),0) END AS qin,
           CASE WHEN e->>'dir' = 'out' THEN COALESCE(cw_num(e->>'net'),0) ELSE 0 END AS qout
      FROM jsonb_array_elements(cw_arr('sg_em_in')) e
     WHERE COALESCE(e->>'cut','false') <> 'true' AND COALESCE(cw_dmy(e->>'date'), fromd) >= fromd
    UNION ALL
    SELECT 'wheat', GREATEST(0, COALESCE(cw_num(m->>'nett'), cw_num(m->>'fillTotal'), 0) - jute * COALESCE(cw_num(m->>'pic'),0)), 0
      FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v'->'maal')) m
     WHERE usenb AND s.key ~ '^sg_nb_[0-9]{2}-[0-9]{2}-[0-9]{4}$' AND cw_dmy(substr(s.key,7)) >= fromd
       AND COALESCE(m->>'cut','false') <> 'true' AND COALESCE(NULLIF(m->>'cat',''),'wheat') = 'wheat' AND COALESCE(m->>'kind','') <> 'simple'
    UNION ALL
    SELECT dd.value->>'m', 0, COALESCE(cw_num(i->>'qty'),0) * COALESCE(cw_num(dd.value->>'kg'),0)
      FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) r, jsonb_array_elements(cw_a(r->'items')) i, jsonb_each(ded) dd
     WHERE s.key ~ rx AND cw_dmy(substr(s.key,10)) >= fromd
       AND COALESCE(r->>'cancelled','false') <> 'true' AND COALESCE(r->>'tvCut','false') <> 'true'
       AND lower(btrim(i->>'name')) = lower(dd.key)
  ), ag AS (SELECT mt, sum(qin) AS qin, sum(qout) AS qout FROM mv GROUP BY mt)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('k', x->>'k', 'n', x->>'n', 'unit', COALESCE(x->>'unit','kg'), 'limit', COALESCE(cw_num(x->>'limit'),0),
      'in', round(COALESCE(ag.qin,0),1), 'out', round(COALESCE(ag.qout,0),1), 'bal', round(COALESCE(ag.qin,0) - COALESCE(ag.qout,0),1),
      'bora', CASE WHEN COALESCE(x->>'unit','kg') = 'kg' THEN round((COALESCE(ag.qin,0) - COALESCE(ag.qout,0)) / bagkg, 1) END,
      'low', COALESCE(cw_num(x->>'limit'),0) > 0 AND (CASE WHEN COALESCE(x->>'unit','kg') = 'kg' THEN (COALESCE(ag.qin,0) - COALESCE(ag.qout,0)) / bagkg
                                                           ELSE COALESCE(ag.qin,0) - COALESCE(ag.qout,0) END) <= cw_num(x->>'limit')) ORDER BY o), '[]'::jsonb)
    INTO res
    FROM jsonb_array_elements(cw_a(cfg->'mats')) WITH ORDINALITY AS t(x, o) LEFT JOIN ag ON ag.mt = x->>'k';
  -- आज कितनी रसीद कटी, कितना गेहूँ निकला
  SELECT count(*) INTO rcn FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) r
    WHERE s.key = 'sg_arcpt_' || cw_today() AND COALESCE(r->>'cancelled','false') <> 'true';
  SELECT COALESCE(sum(COALESCE(cw_num(i->>'qty'),0) * COALESCE(cw_num(dd.value->>'kg'),0)),0) INTO rckg
    FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) r, jsonb_array_elements(cw_a(r->'items')) i, jsonb_each(ded) dd
    WHERE s.key = 'sg_arcpt_' || cw_today() AND COALESCE(r->>'cancelled','false') <> 'true' AND lower(btrim(i->>'name')) = lower(dd.key) AND dd.value->>'m' = 'wheat';
  -- pending order
  SELECT count(*) INTO pn FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) o
    WHERE s.key ~ '^sg_ord_[0-9]{2}-[0-9]{2}-[0-9]{4}$' AND COALESCE(o->>'cancelled','false') <> 'true'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(cw_a(o->'items')) i WHERE COALESCE(cw_num(i->>'qty'),0) > 0);
  SELECT COALESCE(sum(COALESCE(cw_num(i->>'qty'),0) * COALESCE(cw_num(dd.value->>'kg'),0)),0) INTO pkg
    FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) o, jsonb_array_elements(cw_a(o->'items')) i, jsonb_each(ded) dd
    WHERE s.key ~ '^sg_ord_[0-9]{2}-[0-9]{2}-[0-9]{4}$' AND COALESCE(o->>'cancelled','false') <> 'true'
      AND lower(btrim(i->>'name')) = lower(dd.key) AND dd.value->>'m' = 'wheat';
  -- जिन item की "कितने किलो" setting नहीं है
  SELECT COALESCE(jsonb_agg(DISTINCT btrim(i->>'name')), '[]'::jsonb) INTO unm
    FROM sg_store s, jsonb_array_elements(cw_a(s.value->'v')) r, jsonb_array_elements(cw_a(r->'items')) i
    WHERE s.key ~ rx AND cw_dmy(substr(s.key,10)) >= fromd AND btrim(COALESCE(i->>'name','')) <> ''
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(ded) dk WHERE lower(dk) = lower(btrim(i->>'name')));
  RETURN jsonb_build_object('ok', true, 'mats', res, 'bagKg', bagkg, 'jute', jute, 'from', cfg->>'from',
    'rc', jsonb_build_object('n', rcn, 'kg', round(rckg,1)), 'pend', jsonb_build_object('n', pn, 'kg', round(pkg,1)),
    'unmapped', unm, 'at', to_char(now() AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY HH12:MI AM'),
    'alerts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('t', to_char(a.created_at AT TIME ZONE 'Asia/Kolkata','DD-MM HH12:MI AM'), 'body', a.body) ORDER BY a.id DESC), '[]'::jsonb)
               FROM (SELECT * FROM em_alerts ORDER BY id DESC LIMIT 10) a));
END $$;

-- Limit से नीचे → दोनों Owner को WhatsApp (return) + AI call (queue)
CREATE OR REPLACE FUNCTION public.em_check() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE cfg JSONB := em_cfg(); st JSONB := em_stock(); m JSONB; stt JSONB; rep INT; txt TEXT; o TEXT; wa JSONB := '[]'::jsonb; tpl TEXT;
BEGIN
  rep := GREATEST(1, COALESCE(cw_num(cfg->>'repeatH'), 24)::INT); tpl := NULLIF(btrim(COALESCE(cfg->>'waTemplate','')), '');
  FOR m IN SELECT * FROM jsonb_array_elements(st->'mats') LOOP
    SELECT v INTO stt FROM cw_state WHERE k = 'em_' || (m->>'k');
    -- stock की entry शुरू ही नहीं हुई (आवत 0) या Owner number नहीं भरे → alert नहीं
    CONTINUE WHEN COALESCE(cw_num(m->>'in'),0) <= 0
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(cw_a(cfg->'owners')) x WHERE length(COALESCE(cw_p10(x),'')) = 10);
    IF (m->>'low')::BOOLEAN THEN
      IF stt IS NULL OR COALESCE(stt->>'low','false') <> 'true' OR (stt->>'at')::TIMESTAMPTZ < now() - make_interval(hours => rep) THEN
        txt := 'सत्यम गोल्ड इमरजेंसी अलर्ट। ' || (m->>'n') || ' का स्टॉक कम हो गया है। अभी मिल में '
            || CASE WHEN m->>'unit' = 'kg' THEN cw_n(cw_num(m->>'bora')) || ' बोरा यानी ' || cw_n(cw_num(m->>'bal')) || ' किलो ' ELSE cw_n(cw_num(m->>'bal')) || ' पीस ' END
            || (m->>'n') || ' बचा है, जबकि लिमिट ' || cw_n(cw_num(m->>'limit')) || CASE WHEN m->>'unit' = 'kg' THEN ' बोरा' ELSE ' पीस' END || ' है। आज '
            || (st->'rc'->>'n') || ' रसीद कटी जिनमें ' || cw_n(cw_num(st->'rc'->>'kg')) || ' किलो गेहूँ का माल निकला। '
            || (st->'pend'->>'n') || ' ऑर्डर पेंडिंग हैं जिनके लिए लगभग ' || cw_n(cw_num(st->'pend'->>'kg')) || ' किलो गेहूँ और चाहिए। कृपया माल मँगवाएँ।';
        FOR o IN SELECT cw_p10(x) FROM jsonb_array_elements_text(cw_a(cfg->'owners')) x LOOP
          CONTINUE WHEN o IS NULL OR length(o) <> 10;
          wa := wa || jsonb_build_array(CASE WHEN tpl IS NULL
            THEN jsonb_build_object('messaging_product','whatsapp','to','91'||o,'type','text','text', jsonb_build_object('body', '🚨 ' || txt))
            ELSE jsonb_build_object('messaging_product','whatsapp','to','91'||o,'type','template','template', jsonb_build_object('name', tpl,
                   'language', jsonb_build_object('code', COALESCE(NULLIF(cfg->>'waLang',''),'hi')),
                   'components', jsonb_build_array(jsonb_build_object('type','body','parameters', jsonb_build_array(jsonb_build_object('type','text','text', txt)))))) END);
          IF NOT EXISTS (SELECT 1 FROM cw_queue WHERE phone = o AND kind = 'alert' AND status IN ('queued','dialing')) THEN
            INSERT INTO cw_queue (kind, agent, name, phone, reason, ctx) VALUES ('alert', 'alert', 'Owner', o, 'Low stock alert', jsonb_build_object('alert_text', txt));
          END IF;
        END LOOP;
        INSERT INTO em_alerts (mat, body) VALUES (m->>'k', txt);
        INSERT INTO cw_state (k, v) VALUES ('em_' || (m->>'k'), jsonb_build_object('low', true, 'at', now()))
          ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();
      END IF;
    ELSIF stt IS NOT NULL AND stt->>'low' = 'true' THEN
      UPDATE cw_state SET v = jsonb_build_object('low', false, 'at', now()), updated_at = now() WHERE k = 'em_' || (m->>'k');
    END IF;
  END LOOP;
  RETURN wa;
END $$;

-- =====================================================================
-- n8n हर 30 sec:  SELECT cw_tick()  → {action:'dial'|'check'|'none', url, body, wa:[…]}
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cw_tick() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE cfg JSONB := cw_obj('sg_call_cfg'); dg JSONB; q cw_queue%ROWTYPE; wa JSONB := '[]'::jsonb; ag JSONB;
  hhmm TEXT := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'); hf TEXT; ht TEXT; lf TEXT; lt TEXT; isopen BOOLEAN;
  base TEXT; url TEXT; n INT := 0; stale INT; ph TEXT; tel NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cw_tick'));            -- दो execution साथ में कभी dial न करें
  INSERT INTO cw_state (k, v) VALUES ('beat', '{}'::jsonb) ON CONFLICT (k) DO UPDATE SET updated_at = now();   -- n8n चालू है (heartbeat)
  dg := COALESCE(cfg->'dograh', '{}'::jsonb); base := rtrim(COALESCE(dg->>'base',''), '/');
  stale := GREATEST(3, COALESCE(cw_num(cfg->>'staleMin'), 15)::INT);
  hf := COALESCE(NULLIF(cfg->'hours'->>'from',''), '09:00'); ht := COALESCE(NULLIF(cfg->'hours'->>'to',''), '19:00');
  lf := COALESCE(cfg->'lunch'->>'from',''); lt := COALESCE(cfg->'lunch'->>'to','');
  isopen := hhmm >= hf AND hhmm < ht AND NOT (lf <> '' AND lt <> '' AND hhmm >= lf AND hhmm < lt);

  BEGIN wa := em_check();                                         -- Emergency Wala: low stock
  EXCEPTION WHEN OTHERS THEN
    wa := '[]'::jsonb;
    INSERT INTO cw_state (k, v) VALUES ('em_err', jsonb_build_object('error', SQLERRM, 'at', now()))
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();
  END;

  -- जिस call का 15 मिनट तक कोई जवाब नहीं आया
  FOR q IN SELECT * FROM cw_queue WHERE status = 'dialing' AND dialed_at < now() - make_interval(mins => stale) LOOP
    PERFORM cw_unanswered(q.id, 'कोई स्थिति नहीं मिली (timeout)');
  END LOOP;

  -- एक call line पर है → उसकी स्थिति पूछो (एक समय में एक ही call)
  SELECT * INTO q FROM cw_queue WHERE status = 'dialing' ORDER BY dialed_at LIMIT 1;
  IF FOUND THEN
    ag := dg->'agents'->q.agent;
    IF q.run_id IS NOT NULL AND base <> '' AND COALESCE(ag->>'id','') <> '' AND COALESCE(q.checked_at, q.dialed_at) < now() - interval '20 seconds' THEN
      UPDATE cw_queue SET checked_at = now() WHERE id = q.id;
      RETURN jsonb_build_object('action','check','id',q.id,'wa',wa,'url', base || '/api/v1/workflow/' || (ag->>'id') || '/runs/' || q.run_id,
        'path', '/api/v1/workflow/' || (ag->>'id') || '/runs/' || q.run_id);
    END IF;
    RETURN jsonb_build_object('action','none','why','live','wa',wa);
  END IF;

  IF COALESCE((SELECT v->>'on' FROM cw_state WHERE k = 'stop'), '') = 'true' THEN RETURN jsonb_build_object('action','none','why','stop','wa',wa); END IF;
  IF NOT isopen THEN RETURN jsonb_build_object('action','none','why','hours','wa',wa); END IF;      -- Calling Hours Lock
  PERFORM cw_inactive_fill();

  LOOP
    n := n + 1; EXIT WHEN n > 40;
    SELECT * INTO q FROM cw_queue WHERE status = 'queued' AND scheduled_at <= now()
      ORDER BY (kind = 'alert') DESC, (kind IN ('manual','callback')) DESC, scheduled_at, id LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    IF q.kind IN ('area','inactive') AND cw_ordered_today(q.ckey, q.name, q.phone) THEN
      UPDATE cw_queue SET status = 'skipped', note = 'आज का ऑर्डर पहले से आ चुका है (Smart Skip)', updated_at = now() WHERE id = q.id; CONTINUE;
    END IF;
    IF q.kind IN ('area','inactive') AND EXISTS (SELECT 1 FROM cw_dnd WHERE phone = q.phone) THEN
      UPDATE cw_queue SET status = 'skipped', note = 'DND — customer ने कॉल मना किया है', updated_at = now() WHERE id = q.id; CONTINUE;
    END IF;
    ag := dg->'agents'->q.agent;
    url := CASE WHEN COALESCE(ag->>'uuid','') ~* '^https?://' THEN ag->>'uuid'
                WHEN base <> '' AND COALESCE(ag->>'uuid','') <> '' THEN base || '/api/v1/public/agent/workflow/' || (ag->>'uuid') END;
    IF url IS NULL THEN
      UPDATE cw_queue SET status = 'failed', note = 'Call → ⚙️ Settings में Dograh URL / Agent UUID (' || q.agent || ') नहीं भरा', updated_at = now() WHERE id = q.id; CONTINUE;
    END IF;
    ph := CASE COALESCE(NULLIF(dg->>'fmt',''),'+91') WHEN '+91' THEN '+91' || q.phone WHEN '91' THEN '91' || q.phone WHEN '0' THEN '0' || q.phone ELSE q.phone END;
    tel := cw_num(dg->>'tel');
    UPDATE cw_queue SET status = 'dialing', tries = tries + 1, dialed_at = now(), checked_at = NULL, run_id = NULL, note = 'कॉल लगाई जा रही है…', updated_at = now() WHERE id = q.id;
    RETURN jsonb_build_object('action','dial','id',q.id,'url',url,'path',regexp_replace(url,'^https?://[^/]+',''),'wa',wa,
      'body', jsonb_build_object('phone_number', ph, 'initial_context', cw_ctx(q.phone, 'outbound', q.id))
              || CASE WHEN tel IS NOT NULL THEN jsonb_build_object('telephony_configuration_id', tel::INT) ELSE '{}'::jsonb END);
  END LOOP;
  RETURN jsonb_build_object('action','none','why','empty','wa',wa);
END $$;

-- n8n: Dograh का HTTP जवाब वापस यहाँ
CREATE OR REPLACE FUNCTION public.cw_after(qid BIGINT, act TEXT, resp JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE code INT := COALESCE(cw_num(resp->>'statusCode'), 0)::INT; b JSONB := resp->'body'; q cw_queue%ROWTYPE; g JSONB;
BEGIN
  IF jsonb_typeof(b) = 'string' THEN BEGIN b := (b #>> '{}')::jsonb; EXCEPTION WHEN OTHERS THEN b := jsonb_build_object('raw', b); END; END IF;
  IF b IS NULL OR jsonb_typeof(b) <> 'object' THEN b := COALESCE(resp, '{}'::jsonb); END IF;
  SELECT * INTO q FROM cw_queue WHERE id = qid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'queue row नहीं मिली'); END IF;
  IF act = 'dial' THEN
    IF (code = 0 OR code BETWEEN 200 AND 299) AND cw_num(b->>'workflow_run_id') IS NOT NULL THEN
      UPDATE cw_queue SET run_id = cw_num(b->>'workflow_run_id')::BIGINT, note = 'घंटी जा रही है / बात चल रही है…', updated_at = now() WHERE id = qid AND status = 'dialing';
    ELSE
      UPDATE cw_queue SET status = 'failed', updated_at = now(),
        note = 'Dograh ने कॉल नहीं लगाई — HTTP ' || code || ': ' || left(COALESCE(b->>'detail', b->>'message', b->>'error', b::TEXT), 300) WHERE id = qid AND status = 'dialing';
    END IF;
  ELSIF act = 'check' THEN
    IF (code = 0 OR code BETWEEN 200 AND 299) AND COALESCE(b->>'is_completed','') = 'true' AND q.run_id IS NOT NULL THEN
      g := b->'gathered_context'; IF g IS NULL OR jsonb_typeof(g) <> 'object' THEN g := '{}'::jsonb; END IF;
      RETURN cw_finish(g || jsonb_build_object('src','poll','run_id', q.run_id, 'queue_id', q.id,
        'status', g->>'call_status', 'disposition', g->>'call_disposition', 'duration', b->'cost_info'->>'call_duration_seconds',
        'recording', COALESCE(b->>'recording_public_url', b->>'recording_url'),
        'transcript', COALESCE(b->>'transcript_public_url', b->>'transcript_url')));
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- n8n Webhook /sg-call  (Dograh: Pre-Call Data Fetch + कॉल के बाद Webhook node + dealer tool)
CREATE OR REPLACE FUNCTION public.cw_hook(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE cfg JSONB := cw_obj('sg_call_cfg'); b JSONB := COALESCE(p->'b', '{}'::jsonb); hk TEXT; ci JSONB; x JSONB; tp TEXT; qid BIGINT;
BEGIN
  hk := COALESCE(cfg->>'hookKey', '');
  IF hk = '' OR COALESCE(p->'q'->>'k','') <> hk THEN RETURN jsonb_build_object('ok', false, 'error', 'hook key ग़लत है'); END IF;
  IF jsonb_typeof(b) = 'string' THEN BEGIN b := (b #>> '{}')::jsonb; EXCEPTION WHEN OTHERS THEN b := '{}'::jsonb; END; END IF;
  tp := COALESCE(b->>'type', '');
  IF b ? 'event' OR b ? 'call_inbound' THEN                     -- Dograh Pre-Call Data Fetch (incoming call)
    ci := COALESCE(b->'call_inbound', '{}'::jsonb);
    -- अगर यह fetch हमारी ही लगाई outgoing call पर चला (to_number = कतार का customer) तो वही कारण/context लौटाओ
    SELECT id INTO qid FROM cw_queue WHERE status = 'dialing' AND phone = cw_p10(ci->>'to_number') ORDER BY dialed_at DESC LIMIT 1;
    x := CASE WHEN qid IS NOT NULL THEN cw_ctx(cw_p10(ci->>'to_number'), 'outbound', qid) ELSE cw_ctx(cw_p10(ci->>'from_number'), 'inbound', NULL) END;
    RETURN jsonb_build_object('call_inbound', jsonb_build_object('initial_context', x, 'dynamic_variables', x), 'initial_context', x, 'dynamic_variables', x);
  ELSIF tp = 'result' THEN RETURN cw_finish(b);
  ELSIF tp = 'dealer' THEN RETURN jsonb_build_object('ok', true, 'dealers', COALESCE(NULLIF(cw_dealers(COALESCE(b->>'area','')),''), 'इस एरिया में अभी कोई दुकान लिस्ट में नहीं है'));
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown type');
END $$;

-- =====================================================================
-- App  /api/call  →  cw_api({view|action, …})
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cw_api(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE vw TEXT := COALESCE(p->>'view',''); act TEXT := COALESCE(p->>'action',''); cfg JSONB := cw_obj('sg_call_cfg');
  nowist TIMESTAMP := now() AT TIME ZONE 'Asia/Kolkata'; hhmm TEXT; d0 TIMESTAMPTZ; hf TEXT; ht TEXT; lf TEXT; lt TEXT;
  it JSONB; p10 TEXT; sat TIMESTAMPTZ; n INT := 0; sk INT := 0; dup INT := 0; bad INT := 0; knd TEXT; agn TEXT; qq TEXT; lim INT; warn JSONB := '[]'::jsonb;
BEGIN
  hhmm := to_char(nowist, 'HH24:MI'); d0 := date_trunc('day', nowist) AT TIME ZONE 'Asia/Kolkata';
  IF vw = 'dash' THEN
    hf := COALESCE(NULLIF(cfg->'hours'->>'from',''), '09:00'); ht := COALESCE(NULLIF(cfg->'hours'->>'to',''), '19:00');
    lf := COALESCE(cfg->'lunch'->>'from',''); lt := COALESCE(cfg->'lunch'->>'to','');
    IF COALESCE(cfg->'dograh'->>'base','') = '' THEN warn := warn || '"Dograh URL नहीं भरा"'::jsonb; END IF;
    IF COALESCE(cfg->'dograh'->'agents'->'out'->>'uuid','') = '' THEN warn := warn || '"Outgoing agent का UUID नहीं भरा"'::jsonb; END IF;
    IF COALESCE(cfg->>'hookKey','') = '' THEN warn := warn || '"Settings एक बार Save करें (hook key बनेगी)"'::jsonb; END IF;
    RETURN jsonb_build_object('ok', true,
      'stop', COALESCE((SELECT v->>'on' FROM cw_state WHERE k = 'stop'), '') = 'true',
      'open', hhmm >= hf AND hhmm < ht AND NOT (lf <> '' AND lt <> '' AND hhmm >= lf AND hhmm < lt),
      'hours', hf || ' – ' || ht || CASE WHEN lf <> '' AND lt <> '' THEN ' (बंद ' || lf || '–' || lt || ')' ELSE '' END,
      'now', to_char(nowist, 'HH12:MI AM'), 'warn', warn,
      'beat', (SELECT EXTRACT(EPOCH FROM now() - updated_at)::INT FROM cw_state WHERE k = 'beat'),
      'live', (SELECT to_jsonb(x) FROM (SELECT id, kind, agent, name, phone, area, reason, tries, note, run_id, EXTRACT(EPOCH FROM now() - dialed_at)::INT AS sec
               FROM cw_queue WHERE status = 'dialing' ORDER BY dialed_at LIMIT 1) x),
      'counts', (SELECT jsonb_build_object(
          'queued',    count(*) FILTER (WHERE status = 'queued' AND scheduled_at <= now()),
          'scheduled', count(*) FILTER (WHERE status = 'queued' AND scheduled_at > now()),
          'done',      count(*) FILTER (WHERE status = 'done' AND updated_at >= d0),
          'noanswer',  count(*) FILTER (WHERE status = 'noanswer' AND updated_at >= d0),
          'skipped',   count(*) FILTER (WHERE status = 'skipped' AND updated_at >= d0),
          'failed',    count(*) FILTER (WHERE status = 'failed' AND updated_at >= d0),
          'dialed',    count(*) FILTER (WHERE dialed_at >= d0)) FROM cw_queue),
      'queue', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (SELECT id, kind, agent, name, phone, area, reason, tries, note,
               to_char(scheduled_at AT TIME ZONE 'Asia/Kolkata','DD-MM HH12:MI AM') AS sat, (scheduled_at > now()) AS future
               FROM cw_queue WHERE status = 'queued' ORDER BY scheduled_at, id LIMIT 300) x),
      'recent', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (SELECT id, kind, agent, name, phone, area, status, tries, note,
               to_char(updated_at AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') AS tm
               FROM cw_queue WHERE status NOT IN ('queued','dialing') AND updated_at >= d0 ORDER BY updated_at DESC LIMIT 60) x),
      'dnd', (SELECT COALESCE(jsonb_agg(jsonb_build_object('phone', phone, 'name', name)), '[]'::jsonb) FROM cw_dnd));

  ELSIF vw = 'calls' THEN
    qq := btrim(COALESCE(p->>'q','')); lim := LEAST(GREATEST(COALESCE(cw_num(p->>'limit'), 100)::INT, 1), 500);
    RETURN jsonb_build_object('ok', true, 'calls', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
      SELECT t.id, t.run_id, t.dir, t.kind, t.agent, t.phone, t.ckey, t.name, t.address, t.area, t.ptype, t.reason, t.status, t.answered, t.duration,
             t.recording, t.transcript, t.summary, t.rate_talk, t.order_text, t.order_no,
             jsonb_strip_nulls(jsonb_build_object('shop', cw_clean(t.data->>'shop_name'), 'products', cw_clean(t.data->>'products_taken'),
               'monthly', cw_clean(t.data->>'monthly_qty'), 'brand', cw_clean(t.data->>'current_brand'), 'wa', cw_clean(t.data->>'whatsapp_no'),
               'promise', cw_clean(t.data->>'payment_promise'), 'wheat_qty', cw_clean(t.data->>'wheat_qty'), 'wheat_when', cw_clean(t.data->>'wheat_when'),
               'wheat_rate', cw_clean(t.data->>'wheat_rate_wanted'))) AS more,
             to_char(t.created_at AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY') AS dt, to_char(t.created_at AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') AS tm,
             to_char(t.callback_at AT TIME ZONE 'Asia/Kolkata','DD-MM HH12:MI AM') AS cb
      FROM cw_calls t
      WHERE (qq = '' OR t.name ILIKE '%'||qq||'%' OR t.phone LIKE '%'||qq||'%' OR t.address ILIKE '%'||qq||'%' OR t.summary ILIKE '%'||qq||'%')
        AND ((COALESCE(p->>'key','') = '' AND COALESCE(p->>'phone','') = '') OR t.ckey = NULLIF(p->>'key','')
             OR t.phone = cw_p10(p->>'phone') OR t.phone = cw_p10(p->>'phone2'))
        AND (COALESCE(p->>'lead','') <> '1' OR t.ptype LIKE 'new%')
      ORDER BY t.created_at DESC, t.id DESC LIMIT lim) x));

  ELSIF vw = 'rate' THEN
    RETURN jsonb_build_object('ok', true, 'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
      SELECT r.id, r.call_id, r.ckey, r.name, r.phone, r.area, r.kind, r.item, r.cur_rate, r.want_rate, r.note, r.status, r.final_rate,
             to_char(r.created_at AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY HH12:MI AM') AS at,
             to_char(r.decided_at AT TIME ZONE 'Asia/Kolkata','DD-MM HH12:MI AM') AS dat,
             (SELECT c2.recording FROM cw_calls c2 WHERE c2.id = r.call_id) AS recording
      FROM cw_rateinq r ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 300) x));

  ELSIF vw = 'stock' THEN RETURN em_stock();

  ELSIF act = 'enqueue' THEN
    knd := COALESCE(NULLIF(p->>'kind',''), 'manual'); agn := COALESCE(NULLIF(p->>'agent',''), 'out');
    IF agn NOT IN ('out','new','sup','alert') THEN agn := 'out'; END IF;
    BEGIN sat := (NULLIF(p->>'at',''))::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'; EXCEPTION WHEN OTHERS THEN sat := NULL; END;
    sat := GREATEST(COALESCE(sat, now()), now());
    FOR it IN SELECT * FROM jsonb_array_elements(cw_a(p->'items')) LOOP
      p10 := cw_p10(it->>'phone');
      IF p10 IS NULL OR p10 !~ '^[6-9][0-9]{9}$' THEN bad := bad + 1; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM cw_queue WHERE phone = p10 AND (status = 'dialing' OR (status = 'queued' AND (knd <> 'manual' OR scheduled_at <= now())))) THEN dup := dup + 1; CONTINUE; END IF;
      IF knd IN ('area','inactive') AND EXISTS (SELECT 1 FROM cw_dnd WHERE phone = p10) THEN sk := sk + 1; CONTINUE; END IF;
      IF knd = 'area' AND sat <= now() + interval '1 minute' AND cw_ordered_today(it->>'key', it->>'name', p10) THEN
        INSERT INTO cw_queue (kind, agent, batch, ckey, name, address, area, phone, reason, status, note)
        VALUES (knd, agn, p->>'batch', it->>'key', it->>'name', it->>'address', it->>'area', p10, p->>'reason', 'skipped', 'आज का ऑर्डर पहले से आ चुका है (Smart Skip)');
        sk := sk + 1; CONTINUE;
      END IF;
      INSERT INTO cw_queue (kind, agent, batch, ckey, name, address, area, phone, reason, scheduled_at)
      VALUES (knd, agn, p->>'batch', NULLIF(it->>'key',''), it->>'name', it->>'address', it->>'area', p10,
              COALESCE(NULLIF(it->>'reason',''), NULLIF(p->>'reason','')), sat);
      n := n + 1;
    END LOOP;
    IF n > 0 THEN DELETE FROM cw_state WHERE k = 'stop'; END IF;      -- नई call ख़ुद लगाई → Emergency Stop हट गया
    RETURN jsonb_build_object('ok', true, 'added', n, 'skipped', sk, 'dup', dup, 'bad', bad);

  ELSIF act = 'cancel_all' THEN                                    -- 🛑 Emergency Stop
    UPDATE cw_queue SET status = 'cancelled', note = '🛑 Cancel All Calls', updated_at = now() WHERE status = 'queued';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO cw_state (k, v) VALUES ('stop', jsonb_build_object('on', true, 'at', now()))
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'cancelled', n, 'live', EXISTS (SELECT 1 FROM cw_queue WHERE status = 'dialing'));
  ELSIF act = 'resume' THEN
    DELETE FROM cw_state WHERE k = 'stop'; RETURN jsonb_build_object('ok', true);
  ELSIF act = 'cancel' THEN
    UPDATE cw_queue SET status = 'cancelled', note = 'हाथ से हटाया', updated_at = now() WHERE id = cw_num(p->>'id')::BIGINT AND status = 'queued';
    GET DIAGNOSTICS n = ROW_COUNT; RETURN jsonb_build_object('ok', true, 'cancelled', n);
  ELSIF act = 'free_line' THEN                                      -- अटकी हुई "dialing" row हटाओ
    UPDATE cw_queue SET status = 'failed', note = 'हाथ से line ख़ाली की', updated_at = now() WHERE status = 'dialing';
    GET DIAGNOSTICS n = ROW_COUNT; RETURN jsonb_build_object('ok', true, 'freed', n);
  ELSIF act = 'rate_decide' THEN
    UPDATE cw_rateinq SET status = CASE WHEN p->>'status' = 'approved' THEN 'approved' ELSE 'rejected' END,
      final_rate = cw_num(p->>'rate'), decided_at = now() WHERE id = cw_num(p->>'id')::BIGINT;
    GET DIAGNOSTICS n = ROW_COUNT; RETURN jsonb_build_object('ok', n > 0, 'error', CASE WHEN n = 0 THEN 'entry नहीं मिली' END);
  ELSIF act = 'dnd_remove' THEN
    DELETE FROM cw_dnd WHERE phone = cw_p10(p->>'phone'); RETURN jsonb_build_object('ok', true);
  ELSIF act = 'inactive_now' THEN                                   -- आज की inactive list अभी बनाओ
    DELETE FROM cw_state WHERE k = 'inactive'; n := cw_inactive_fill();
    RETURN jsonb_build_object('ok', true, 'added', n);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown view/action');
END $$;

COMMIT;

-- =====================================================================
-- देखने के काम की SQL:
--   SELECT cw_tick();                                   -- n8n जो चलाता है (हाथ से चलाने पर एक call लग सकती है!)
--   SELECT cw_api('{"view":"dash"}');                   -- live monitor
--   SELECT em_stock();                                  -- live stock
--   SELECT * FROM cw_queue ORDER BY id DESC LIMIT 50;   -- कतार
--   SELECT * FROM cw_calls ORDER BY id DESC LIMIT 50;   -- call history
--   SELECT * FROM cw_rateinq ORDER BY id DESC;          -- rate inquiry
-- =====================================================================
