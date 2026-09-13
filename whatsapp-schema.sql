-- =====================================================================
-- SATYAM GOLD — WhatsApp Bot  (PostgreSQL)
-- पूरा text Adminer → SQL command में paste करके Execute करें.
-- पुरानी tables / orders / receipts DELETE या DROP नहीं करने हैं.
-- यह migration दोबारा चलाना सुरक्षित है (DB: postgres, Schema: public).
-- n8n: WhatsApp Trigger -> Code -> Postgres wa_receive -> HTTP Request (Meta).
-- =====================================================================

BEGIN;
SET LOCAL search_path TO public;

-- App का main store (पहले से हो तो कुछ नहीं होगा)
CREATE TABLE IF NOT EXISTS sg_store (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sg_store_updated_at_idx ON sg_store (updated_at);

-- हर WhatsApp number की chat state (menu में कहाँ है, कौन सा item चुना, आदि)
CREATE TABLE IF NOT EXISTS wa_sessions (
    phone      TEXT PRIMARY KEY,                    -- 918252487551
    state      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {step, item, pack, cust:{name,address,key}}
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- हर आने/जाने वाला message (debug + record)
CREATE TABLE IF NOT EXISTS wa_log (
    id         BIGSERIAL PRIMARY KEY,
    phone      TEXT,
    dir        TEXT NOT NULL,          -- 'in' | 'out' | 'err'
    body       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Compatible with old schemas using mobile/direction instead of phone/dir.
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS dir TEXT;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS body JSONB;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- n8n का पुराना "Bot का जवाब (Postgres)" node msg / reply column माँगता है (screenshot error fix)
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS msg   TEXT;
ALTER TABLE wa_log ADD COLUMN IF NOT EXISTS reply TEXT;
CREATE INDEX IF NOT EXISTS wa_log_phone_idx ON wa_log (phone, created_at DESC);

-- WhatsApp से आया order सीधे Order Book में  → key  sg_ord_<DD-MM-YYYY>   (app की same list)
-- Rate objection                              → key  sg_wa_obj             (app: Home → WhatsApp → Objection)
-- Customer summary (app हर 30 sec लिखता है)     → key  sg_wa_cust  { "8252487551": {name,address,area,due,receipts:[…]} }
-- Item / packing settings (बदल सकते हैं)        → key  sg_wa_cfg
INSERT INTO sg_store (key, value, updated_at) VALUES ('sg_wa_cfg', '{"v":{
  "items":[
    {"id":"gold","name":"Atta Gold","rk":"gold","unit":"बोरा","bora":1,"thaila":0},
    {"id":"a18","name":"Atta 18kg","rk":"a18","unit":"थैला","bora":3,"thaila":1},
    {"id":"a10","name":"Atta 10kg","rk":"a10","unit":"थैला","bora":5,"thaila":1},
    {"id":"a5","name":"Atta 5kg","rk":"a5","unit":"थैला","bora":10,"thaila":1},
    {"id":"sattu","name":"Sattu","rk":"sattu","sizes":[{"g":200,"bora":50},{"g":500,"bora":20}]},
    {"id":"besan","name":"Besan","rk":"besan","sizes":[{"g":200,"bora":50},{"g":500,"bora":20}]}
  ],
  "pk":{"sattu":{"200":{"bora":50,"thaila":10},"500":{"bora":20,"thaila":4}},"besan":{"200":{"bora":50,"thaila":10},"500":{"bora":20,"thaila":4}}},
  "owner":"918252487551",
  "shop":"SATYAM GOLD"
}}'::jsonb, (EXTRACT(EPOCH FROM now())*1000)::BIGINT)
ON CONFLICT (key) DO NOTHING;

-- देखने के लिए:
--   SELECT phone, state, updated_at FROM wa_sessions ORDER BY updated_at DESC;
--   SELECT * FROM wa_log ORDER BY id DESC LIMIT 50;
--   SELECT value FROM sg_store WHERE key = 'sg_wa_obj';
--   SELECT value FROM sg_store WHERE key LIKE 'sg_ord_%' ORDER BY updated_at DESC;

-- =====================================================================
-- FIX: mobile / direction missing. Both old and new column names work.
-- This fixes the log schema, NOT the old SQL-only wa_handle() bot.
-- Use the JavaScript webhook for interactive WhatsApp buttons.
-- =====================================================================
ALTER TABLE wa_log ALTER COLUMN dir SET DEFAULT 'in';
CREATE OR REPLACE FUNCTION wa_log_sync_phone() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN NEW.mobile := NEW.phone;
    ELSIF NEW.mobile IS DISTINCT FROM OLD.mobile THEN NEW.phone := NEW.mobile;
    END IF;
    IF NEW.dir IS DISTINCT FROM OLD.dir THEN NEW.direction := NEW.dir;
    ELSIF NEW.direction IS DISTINCT FROM OLD.direction THEN NEW.dir := NEW.direction;
    END IF;
  END IF;
  NEW.phone := COALESCE(NEW.phone, NEW.mobile);
  NEW.mobile := NEW.phone;
  NEW.direction := COALESCE(NEW.direction, NEW.dir, 'in');
  NEW.dir := NEW.direction;
  IF NEW.body IS NOT NULL AND jsonb_typeof(NEW.body) <> 'object' THEN
    NEW.body := jsonb_build_object('text', NEW.body);
  END IF;
  IF NEW.body IS NULL AND NEW.msg IS NOT NULL THEN NEW.body := jsonb_build_object('text', NEW.msg); END IF;
  IF NEW.msg IS NULL AND NEW.body IS NOT NULL THEN NEW.msg := COALESCE(NEW.body->>'text', NEW.body->>'input'); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wa_log_sync_phone_trg ON wa_log;
CREATE TRIGGER wa_log_sync_phone_trg BEFORE INSERT OR UPDATE ON wa_log
  FOR EACH ROW EXECUTE FUNCTION wa_log_sync_phone();
UPDATE wa_log
SET phone = COALESCE(phone, mobile), mobile = COALESCE(phone, mobile),
    dir = COALESCE(direction, dir, 'in'), direction = COALESCE(direction, dir, 'in')
WHERE phone IS NULL OR mobile IS NULL OR dir IS NULL OR direction IS NULL;

-- =====================================================================
-- wa_handle(phone, msg) — SBI-जैसा BUTTON / LIST bot (n8n के लिए)
--   Postgres node: SELECT public.wa_receive($1, $2, $3) AS reply;
--   reply = WhatsApp Cloud API का पूरा JSON body → HTTP Request node से भेजें (README देखें)
--   Order flow: Atta(23/18/10/5 KG → बोरा) · Sattu/Besan(200g/500g → थैला/बोरा) · Chokar(बोरा)
--   हर order पर rate के साथ confirmation; Creditor को गेहूँ (Wheat) का Master rate दिखता है
-- पुराना wa_handle अपने-आप replace हो जाता है; अलग से DELETE/DROP कुछ नहीं करना.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.wa_ist_date() RETURNS TEXT LANGUAGE sql AS $$ SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY') $$;
CREATE OR REPLACE FUNCTION public.wa_ist_ts()   RETURNS TEXT LANGUAGE sql AS $$ SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') $$;
CREATE OR REPLACE FUNCTION public.wa_f(n NUMERIC) RETURNS TEXT LANGUAGE sql AS $$ SELECT '₹' || to_char(COALESCE(n,0), 'FM999,999,999,999,990.00') $$;

-- Rate: Master → Area ±adj → Customer special (app के sg_rates जैसा)
CREATE OR REPLACE FUNCTION public.wa_rate(R JSONB, area TEXT, ckey TEXT, k TEXT) RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE base NUMERIC; sp TEXT; BEGIN
  base := COALESCE(NULLIF(R->'master'->>k,'')::NUMERIC,0) + COALESCE(NULLIF(R->'areaAdj'->area->>k,'')::NUMERIC,0);
  IF NULLIF(R->'area'->area->>k,'') IS NOT NULL THEN base := (R->'area'->area->>k)::NUMERIC; END IF;
  base := GREATEST(0,base);
  sp := NULLIF(R->'cust'->ckey->>k,''); IF sp IS NOT NULL THEN base := base - sp::NUMERIC; END IF;
  RETURN GREATEST(0, base);
EXCEPTION WHEN OTHERS THEN RETURN 0; END $$;

-- WhatsApp JSON builders
CREATE OR REPLACE FUNCTION public.wa_txt(p_to TEXT, body TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('messaging_product','whatsapp','to',p_to,'type','text','text',jsonb_build_object('body',left(body,4000))) $$;
CREATE OR REPLACE FUNCTION public.wa_btn(p_to TEXT, body TEXT, btns JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('messaging_product','whatsapp','to',p_to,'type','interactive','interactive',jsonb_build_object(
    'type','button','body',jsonb_build_object('text',left(body,1024)),
    'action',jsonb_build_object('buttons',(SELECT jsonb_agg(jsonb_build_object('type','reply','reply',jsonb_build_object('id',b->>'id','title',left(b->>'t',20))))
                                            FROM jsonb_array_elements(btns) WITH ORDINALITY AS x(b,o) WHERE o<=3)))) $$;
CREATE OR REPLACE FUNCTION public.wa_list(p_to TEXT, body TEXT, btn TEXT, sect TEXT, rows_ JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('messaging_product','whatsapp','to',p_to,'type','interactive','interactive',jsonb_build_object(
    'type','list','body',jsonb_build_object('text',left(body,1024)),
    'action',jsonb_build_object('button',left(btn,20),'sections',jsonb_build_array(jsonb_build_object('title',left(sect,24),
      'rows',(SELECT jsonb_agg(jsonb_build_object('id',r->>'id','title',left(r->>'t',24)) || CASE WHEN r->>'d' IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('description',left(r->>'d',72)) END)
              FROM jsonb_array_elements(rows_) WITH ORDINALITY AS x(r,o) WHERE o<=10)))))) $$;

-- All receipts are read from the actual app store, not the truncated summary.
CREATE OR REPLACE FUNCTION public.wa_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
 SELECT upper(regexp_replace(btrim(COALESCE(t,'')), '\s+', ' ', 'g')) $$;
CREATE OR REPLACE FUNCTION public.wa_receipts(cust JSONB) RETURNS JSONB LANGUAGE sql AS $$
 SELECT COALESCE(jsonb_agg(r ORDER BY r->>'sdate', r->>'rno'), '[]'::jsonb) FROM (
   SELECT jsonb_build_object('rno', x->>'no', 'sdate', substr(s.key,10),
     'rdate', COALESCE(x->>'dateStr',substr(s.key,10)), 'idx', n-1,
     'total', COALESCE(NULLIF(x->'tvAmt','null'::jsonb), x->'total'), 'items', x->'items') AS r
   FROM sg_store s CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(s.value->'v')='array' THEN s.value->'v' ELSE '[]'::jsonb END) WITH ORDINALITY a(x,n)
   WHERE s.key LIKE 'sg_arcpt_%' AND NOT COALESCE((x->>'cancelled')::boolean,false)
     AND NOT COALESCE((x->>'tvCut')::boolean,false)
     AND wa_norm(COALESCE(x->>'name',x->>'nameHi')) = wa_norm(cust->>'name')
     AND wa_norm(COALESCE(x->>'address',x->>'addressHi')) = wa_norm(cust->>'address')
     AND NULLIF(cust->>'key','') IS NOT NULL
 ) owned $$;
CREATE TABLE IF NOT EXISTS wa_inbox (
 message_id TEXT PRIMARY KEY, phone TEXT NOT NULL, reply JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dedicated decisions remain independent of browser sync.
CREATE TABLE IF NOT EXISTS wa_decisions (
 objection_id TEXT PRIMARY KEY, phone TEXT NOT NULL, result JSONB NOT NULL,
 message TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT 'pending',
 last_error TEXT, meta_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.wa_handle(p_phone TEXT, p_msg TEXT) RETURNS TEXT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  m     TEXT  := lower(btrim(COALESCE(p_msg, '')));
  ph    TEXT  := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  p10   TEXT  := right(ph, 10);
  cust JSONB; cfg JSONB; R JSONB; st JSONB := '{}'::jsonb; out JSONB;
  owner TEXT; shop TEXT; area TEXT := 'OTHER'; ckey TEXT := ''; nm TEXT := ''; iscred BOOLEAN := false;
  rate NUMERIC; wheat NUMERIC; q NUMERIC; tot NUMERIC; lines TEXT; mx INT := 0;
  it TEXT; sz TEXT; pk TEXT; iname TEXT; unit TEXT; mul NUMERIC := 1; urate NUMERIC; pnote TEXT := '';
  ord JSONB; cur JSONB; okey TEXT; ln JSONB; li JSONB; step TEXT;
  main_rows JSONB; owned JSONB; matches JSONB; rc JSONB; obj JSONB; ii INT; page INT;
BEGIN
  IF length(ph)=10 THEN ph := '91' || ph; END IF;
  IF ph !~ '^91[0-9]{10}$' THEN RAISE EXCEPTION 'Valid Indian WhatsApp sender required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa:' || ph,0));
  BEGIN
    SELECT value->'v'->p10 INTO cust FROM sg_store WHERE key = 'sg_wa_cust';
    SELECT value->'v'       INTO cfg  FROM sg_store WHERE key = 'sg_wa_cfg';
    SELECT value->'v'       INTO R    FROM sg_store WHERE key = 'sg_rates';
    SELECT state INTO st FROM wa_sessions WHERE phone = ph AND updated_at > now()-interval '30 minutes';
  END;
  st := COALESCE(st, '{}'::jsonb); R := COALESCE(R, '{}'::jsonb); cfg := COALESCE(cfg, '{}'::jsonb);
  owner := right(COALESCE(cfg->>'owner', '918252487551'), 10); shop := COALESCE(cfg->>'shop','SATYAM GOLD');
  IF cust IS NOT NULL THEN nm := COALESCE(cust->>'name',''); area := COALESCE(cust->>'area','OTHER'); ckey := COALESCE(cust->>'key', upper(nm)); iscred := COALESCE((cust->>'type') = 'cred',false) OR COALESCE((cust->>'isCreditor')::boolean,false); END IF;
  wheat := COALESCE(NULLIF(R->'master'->>'wheat','')::numeric,0);
  step := COALESCE(st->>'step','');
  BEGIN INSERT INTO wa_log (phone, dir, body, msg) VALUES (ph, 'in', jsonb_build_object('text', p_msg, 'via', 'wa_handle'), p_msg); EXCEPTION WHEN OTHERS THEN NULL; END;

  main_rows := '[{"id":"m_due","t":"💰 मेरा बाक़ी (Due)"},{"id":"m_order","t":"🛒 नया Order","d":"Atta · Sattu · Besan · Chokar"},{"id":"m_hisab","t":"📋 पूरा हिसाब"},{"id":"m_rate","t":"📈 आज का भाव"},{"id":"m_owner","t":"📞 मालिक से बात"},{"id":"m_obj","t":"⚠️ Rate Objection"}]'::jsonb;

  -- Global navigation takes priority over numeric input (2 means quantity, not menu).
  IF m ~ '^(hi+|hello|menu|start|namaste|नमस्ते|hy)$' OR m='m_home' THEN
    st := '{}'::jsonb;
    out := wa_btn(ph, format(E'*%s*\nनमस्ते %s जी!\nWelcome to WhatsApp Services.%s\n\nनीचे touch करके service चुनें.',shop,COALESCE(NULLIF(nm,''),'Customer'),
      CASE WHEN iscred THEN E'\nWheat Master Rate: ' || CASE WHEN wheat>0 THEN wa_f(wheat)||' / Bag' ELSE 'अभी set नहीं है' END ELSE '' END),
      '[{"id":"m_due","t":"मेरा बाकी (Due)"},{"id":"m_order","t":"नया Order"},{"id":"m_more","t":"More Services"}]');
  ELSIF m='cancel' THEN
    st := '{}'::jsonb; out := wa_btn(ph,'Cancel कर दिया. कोई नया order/objection submit नहीं हुआ.','[{"id":"m_home","t":"Main Menu"}]');
  ELSIF m='m_more' THEN
    st := '{}'::jsonb; out := wa_list(ph,'Service चुनें','Services','Services',main_rows);
  ELSIF cust IS NULL AND step<>'' THEN
    st := '{}'::jsonb; out := wa_btn(ph,'आपका WhatsApp number अब खाते से link नहीं है. मालिक से mobile link करवाएँ.','[{"id":"m_owner","t":"मालिक से बात"},{"id":"m_home","t":"Menu"}]');
  ELSIF step = 'qty' AND m ~ '^\d{1,4}$' THEN
    q := m::NUMERIC;
    IF q <= 0 OR q > 500 THEN out := wa_txt(ph, '❌ सही संख्या लिखें (1 – 500)'); 
    ELSE
      it := st->>'item'; sz := st->>'size'; pk := COALESCE(st->>'pack','bora');
      IF it = 'atta' THEN
        iname := CASE sz WHEN 'gold' THEN 'Atta Gold' WHEN 'a18' THEN 'Atta 18kg' WHEN 'a10' THEN 'Atta 10kg' ELSE 'Atta 5kg' END;
        rate := wa_rate(R, area, ckey, sz);
        mul := CASE sz WHEN 'gold' THEN 1 WHEN 'a18' THEN 3 WHEN 'a10' THEN 5 ELSE 10 END;      -- 1 बोरा = ? थैला
        unit := 'बोरा'; urate := rate * mul; pnote := CASE WHEN mul > 1 THEN '1 बोरा = ' || mul || ' थैला' ELSE '' END;
      ELSIF it IN ('sattu','besan') THEN
        iname := initcap(it) || ' ' || sz || 'g'; rate := wa_rate(R, area, ckey, it) * sz::NUMERIC / 1000;   -- 1 packet
        mul := CASE WHEN pk = 'bora' THEN COALESCE((cfg->'pk'->it->sz->>'bora')::NUMERIC, CASE sz WHEN '200' THEN 50 ELSE 20 END)
                    ELSE COALESCE((cfg->'pk'->it->sz->>'thaila')::NUMERIC, CASE sz WHEN '200' THEN 10 ELSE 4 END) END;
        unit := CASE WHEN pk = 'bora' THEN 'बोरा' ELSE 'थैला' END; urate := rate * mul; pnote := '1 ' || unit || ' = ' || mul || ' packet';
      ELSE
        iname := 'Chokar'; rate := wa_rate(R, area, ckey, 'chokar'); mul := 1; unit := 'बोरा'; urate := rate;
      END IF;
      IF mul<=0 OR mul<>trunc(mul) OR mul>10000 THEN RAISE EXCEPTION 'Invalid packing: configure positive packet counts in sg_wa_cfg.pk'; END IF;
      rate := round(rate,2); urate := rate*mul;
      tot := round(q * urate,2);
      st := st || jsonb_build_object('step','confirm','qty',q,'iname',iname,'unit',unit,'mul',mul,'prate',rate,'urate',urate,'note',pnote);
      SELECT string_agg(format('%s | %s | Rate %s / unit | %s',l->>'name',l->>'pack',CASE WHEN (l->>'amt')::numeric>0 THEN wa_f((l->>'urate')::numeric) ELSE 'Pending' END,CASE WHEN (l->>'amt')::numeric>0 THEN wa_f((l->>'amt')::numeric) ELSE 'Rate pending' END), E'\n') INTO lines FROM jsonb_array_elements(COALESCE(st->'lines','[]'::jsonb)) l;
      out := wa_btn(ph, COALESCE(lines || E'\n\n','') || format(E'🧾 *Order Confirm करें*\n\n📦 %s\n🔢 %s %s%s\n%s\n👤 %s · %s',
              iname, q, unit, CASE WHEN pnote<>'' THEN ' (' || pnote || ')' ELSE '' END,
              CASE WHEN urate > 0 THEN format(E'💵 Rate: %s / %s\n💰 कुल: *%s*', wa_f(urate), unit, wa_f(tot)) ELSE '💵 Rate: मालिक बताएँगे' END,
              left(nm,80), left(COALESCE(cust->>'address',''),100)) || E'\n\nCart total (known rates): ' || wa_f(tot + COALESCE((SELECT sum((x->>'amt')::numeric) FROM jsonb_array_elements(COALESCE(st->'lines','[]')) x),0)),
             '[{"id":"ok_order","t":"✅ Confirm"},{"id":"more_item","t":"➕ और Item"},{"id":"cancel","t":"❌ Cancel"}]'::jsonb);
    END IF;

  -- ---------- confirm ----------
  ELSIF m='more_item' AND step='confirm' AND jsonb_array_length(COALESCE(st->'lines','[]'))>=3 THEN
    out := wa_btn(ph,'एक order में अधिकतम 4 items. ऊपर का cart Confirm करें, फिर नया order कर सकते हैं.','[{"id":"ok_order","t":"Confirm Order"},{"id":"cancel","t":"Cancel"}]');
  ELSIF m IN ('ok_order','more_item') AND step = 'confirm' THEN
    li := jsonb_build_object('name', st->>'iname', 'qty', (st->>'qty')::NUMERIC * (st->>'mul')::NUMERIC, 'rate', round((st->>'prate')::NUMERIC, 2)::TEXT,
                             'urate', (st->>'urate')::numeric, 'pack', (st->>'qty') || ' ' || (st->>'unit'), 'note', COALESCE(st->>'note',''), 'amt', (st->>'qty')::NUMERIC * (st->>'urate')::NUMERIC);
    ln := COALESCE(st->'lines','[]'::jsonb) || li;
    IF jsonb_array_length(ln)>4 THEN RAISE EXCEPTION 'Maximum 4 items per order'; END IF;
    IF m = 'more_item' THEN
      st := jsonb_build_object('step','item','lines',ln);
      out := wa_list(ph, '🛒 और कौन सा item?', '👇 Item चुनें', 'Items',
        '[{"id":"i_atta","t":"🌾 Atta","d":"23kg Gold · 18kg · 10kg · 5kg"},{"id":"i_sattu","t":"🥣 Sattu","d":"200g / 500g"},{"id":"i_besan","t":"🟡 Besan","d":"200g / 500g"},{"id":"i_chokar","t":"🐄 Chokar","d":"बोरा"}]'::jsonb);
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('wa:orders',0));
      okey := 'sg_ord_' || wa_ist_date();
      SELECT COALESCE(value->'v','[]'::jsonb) INTO cur FROM sg_store s WHERE s.key = okey FOR UPDATE; cur := COALESCE(cur,'[]'::jsonb);
      SELECT COALESCE(max((o->>'no')::INT),0) INTO mx FROM sg_store s, jsonb_array_elements(COALESCE(s.value->'v','[]'::jsonb)) o WHERE s.key LIKE 'sg_ord_%' AND (o->>'no') ~ '^\d+$';
      ord := jsonb_build_object('id','w'||md5(ph||clock_timestamp()::TEXT), 'no', CASE WHEN mx+1<10 THEN '0'||(mx+1)::TEXT ELSE (mx+1)::TEXT END, 'ts', wa_ist_ts(),
        'name', nm, 'address', COALESCE(cust->>'address',''), 'wa', true, 'phone', ph,
        'items', (SELECT jsonb_agg(jsonb_build_object('name',l->>'name','qty',(l->>'qty')::NUMERIC,'rate',CASE WHEN (l->>'rate')::NUMERIC>0 THEN l->>'rate' ELSE '' END,'note',(l->>'pack') || CASE WHEN COALESCE(l->>'note','')<>'' THEN ' · '||(l->>'note') ELSE '' END)) FROM jsonb_array_elements(ln) l),
        'ordered', (SELECT jsonb_agg(jsonb_build_object('name',l->>'name','qty',(l->>'qty')::NUMERIC)) FROM jsonb_array_elements(ln) l), 'deliv', '[]'::jsonb);
      INSERT INTO sg_store (key, value, updated_at) VALUES (okey, jsonb_build_object('v', cur || ord), (EXTRACT(EPOCH FROM now())*1000)::BIGINT)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, synced_at = now();
      SELECT string_agg(format('• %s — %s%s', l->>'name', l->>'pack', CASE WHEN (l->>'amt')::NUMERIC > 0 THEN ' = ' || wa_f((l->>'amt')::NUMERIC) ELSE '' END), E'\n'), sum((l->>'amt')::NUMERIC) INTO lines, tot FROM jsonb_array_elements(ln) l;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(ln) l WHERE (l->>'urate')::NUMERIC<=0) THEN tot := NULL; END IF;
      st := '{}'::jsonb;
      out := wa_btn(ph, format(E'✅ *Order No %s book हो गया!*\n\n%s\n%s🕐 %s · %s\n\nधन्यवाद 🙏 माल जल्दी पहुँचेगा।', ord->>'no', lines,
               CASE WHEN tot > 0 THEN '💰 कुल: *' || wa_f(tot) || E'*\n' ELSE E'कुछ rate pending हैं; final total मालिक बताएँगे।\n' END, ord->>'ts', wa_ist_date()),
             '[{"id":"m_order","t":"🛒 और Order"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
      BEGIN INSERT INTO wa_log (phone, dir, body, msg) VALUES (ph, 'owner', jsonb_build_object('order', ord, 'name', nm), 'ORDER #' || (ord->>'no')); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

  -- ---------- order flow ----------
  ELSIF m = 'm_order' OR (step='' AND m='2') THEN
    IF cust IS NULL THEN
      st := '{}'::jsonb; out := wa_btn(ph,'आपका WhatsApp number खाते से link नहीं है. मालिक से नाम, पता और mobile link करवाएँ.','[{"id":"m_owner","t":"मालिक से बात"},{"id":"m_home","t":"Menu"}]');
      INSERT INTO wa_sessions(phone,state) VALUES(ph,st) ON CONFLICT(phone) DO UPDATE SET state=excluded.state,updated_at=now();
      RETURN out::text;
    END IF;
    st := jsonb_build_object('step','item','lines', '[]'::jsonb);
    out := wa_list(ph, '🛒 *नया Order*' || E'\nकौन सा item चाहिए?', '👇 Item चुनें', 'Items',
      '[{"id":"i_atta","t":"🌾 Atta","d":"23kg Gold · 18kg · 10kg · 5kg"},{"id":"i_sattu","t":"🥣 Sattu","d":"200g / 500g"},{"id":"i_besan","t":"🟡 Besan","d":"200g / 500g"},{"id":"i_chokar","t":"🐄 Chokar","d":"बोरा"}]'::jsonb);
  ELSIF m = 'i_atta' AND step='item' THEN
    st := st || '{"step":"size","item":"atta"}'::jsonb;
    out := wa_list(ph, '🌾 *Atta* — कौन सा size?', '👇 Size चुनें', 'Atta', jsonb_build_array(
      jsonb_build_object('id','s_gold','t','Atta Gold 23kg','d', CASE WHEN wa_rate(R,area,ckey,'gold')>0 THEN wa_f(wa_rate(R,area,ckey,'gold'))||' / बोरा' ELSE 'बोरा' END),
      jsonb_build_object('id','s_a18','t','Atta 18kg','d', CASE WHEN wa_rate(R,area,ckey,'a18')>0 THEN wa_f(wa_rate(R,area,ckey,'a18'))||' / थैला · 1 बोरा = 3 थैला' ELSE '1 बोरा = 3 थैला' END),
      jsonb_build_object('id','s_a10','t','Atta 10kg','d', CASE WHEN wa_rate(R,area,ckey,'a10')>0 THEN wa_f(wa_rate(R,area,ckey,'a10'))||' / थैला · 1 बोरा = 5 थैला' ELSE '1 बोरा = 5 थैला' END),
      jsonb_build_object('id','s_a5','t','Atta 5kg','d', CASE WHEN wa_rate(R,area,ckey,'a5')>0 THEN wa_f(wa_rate(R,area,ckey,'a5'))||' / थैला · 1 बोरा = 10 थैला' ELSE '1 बोरा = 10 थैला' END)));
  ELSIF m IN ('s_gold','s_a18','s_a10','s_a5') AND step='size' AND (st->>'item') = 'atta' THEN
    st := st || jsonb_build_object('step','qty','size',substr(m,3),'pack','bora');
    out := wa_txt(ph, format(E'📦 *%s*\n\n🔢 कितने *बोरा* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 5)',
      CASE m WHEN 's_gold' THEN 'Atta Gold 23kg' WHEN 's_a18' THEN 'Atta 18kg' WHEN 's_a10' THEN 'Atta 10kg' ELSE 'Atta 5kg' END));
  ELSIF m IN ('i_sattu','i_besan') AND step='item' THEN
    it := substr(m,3); st := st || jsonb_build_object('step','size','item',it);
    out := wa_btn(ph, format('%s *%s* — कौन सा packet?', CASE it WHEN 'sattu' THEN '🥣' ELSE '🟡' END, initcap(it)),
      '[{"id":"g_200","t":"200g"},{"id":"g_500","t":"500g"}]'::jsonb);
  ELSIF m IN ('g_200','g_500') AND step='size' AND (st->>'item') IN ('sattu','besan') THEN
    st := st || jsonb_build_object('step','pack','size',substr(m,3));
    out := wa_btn(ph, format('📦 *%s %sg* — थैला या बोरा?', initcap(st->>'item'), substr(m,3)),
      '[{"id":"p_thaila","t":"👜 थैला"},{"id":"p_bora","t":"🧺 बोरा"}]'::jsonb);
  ELSIF m IN ('p_thaila','p_bora') AND step = 'pack' THEN
    st := st || jsonb_build_object('step','qty','pack',substr(m,3));
    out := wa_txt(ph, format(E'📦 *%s %sg*\n\n🔢 कितने *%s* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 2)', initcap(st->>'item'), st->>'size', CASE WHEN m='p_bora' THEN 'बोरा' ELSE 'थैला' END));
  ELSIF m = 'i_chokar' AND step='item' THEN
    st := st || '{"step":"qty","item":"chokar","pack":"bora"}'::jsonb;
    out := wa_txt(ph, E'🐄 *Chokar*\n\n🔢 कितने *बोरा* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 3)');
  ELSIF step = 'qty' THEN
    out := wa_txt(ph, '🔢 कृपया सिर्फ़ संख्या लिखें (जैसे: 5) या *Hi* लिखकर Menu पर जाएँ');

  -- ---------- info ----------
  ELSIF (m IN ('m_due','due') OR (step='' AND m='1')) THEN
    IF cust IS NULL THEN out := wa_btn(ph, E'ℹ️ आपका नंबर किसी खाते से जुड़ा नहीं है।\n📞 मालिक: +91 ' || owner, '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
    ELSE out := wa_btn(ph, format(E'💰 *%s* जी\n📍 %s\n\n🔴 कुल बाक़ी: *%s*', nm, COALESCE(cust->>'address',''), wa_f((COALESCE(cust->>'due','0'))::NUMERIC)),
           '[{"id":"m_hisab","t":"📋 पूरा हिसाब"},{"id":"m_order","t":"🛒 नया Order"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb); END IF;
  ELSIF (m IN ('m_hisab','m_stmt') OR (step='' AND m='3')) THEN
    IF cust IS NULL THEN out := wa_txt(ph, 'ℹ️ आपका खाता नहीं मिला।');
    ELSE
      SELECT string_agg(format('🧾 %s · R.No %s = %s', r->>'rdate', r->>'rno', wa_f((r->>'total')::NUMERIC)), E'\n') INTO lines FROM jsonb_array_elements(COALESCE(cust->'receipts','[]'::jsonb)) r;
      out := wa_btn(ph, format(E'📋 *%s* — हिसाब\n\n%s\n\n🔴 बाक़ी: *%s*', nm, COALESCE(lines,'—'), wa_f((COALESCE(cust->>'due','0'))::NUMERIC)), '[{"id":"m_obj","t":"⚠️ Objection"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
    END IF;
  ELSIF (m='m_rate' OR (step='' AND m='4')) THEN
    IF iscred THEN
      lines := CASE WHEN wheat > 0 THEN '🌾 गेहूँ (Wheat): *' || wa_f(wheat) || ' / Bag*' ELSE '🌾 गेहूँ का भाव अभी set नहीं — मालिक से बात करें' END;
    ELSE
      SELECT string_agg(format('• %s: %s', x.t, CASE WHEN wa_rate(R,area,ckey,x.k) > 0 THEN wa_f(wa_rate(R,area,ckey,x.k)) || x.u ELSE '—' END), E'\n') INTO lines
        FROM (VALUES ('gold','Atta Gold 23kg',' / बोरा'),('a18','Atta 18kg',' / थैला'),('a10','Atta 10kg',' / थैला'),('a5','Atta 5kg',' / थैला'),('sattu','Sattu',' / kg'),('besan','Besan',' / kg'),('chokar','Chokar',' / बोरा')) x(k,t,u);
      IF wheat > 0 THEN lines := lines || E'\n• Wheat: ' || wa_f(wheat) || ' / Bag'; END IF;
    END IF;
    out := wa_btn(ph, E'📈 *आज का भाव*\n' || wa_ist_date() || E'\n\n' || COALESCE(lines,'—'), '[{"id":"m_order","t":"🛒 Order करें"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF (m IN ('m_owner','m_talk') OR (step='' AND m='5')) THEN
    out := wa_btn(ph, E'📞 मालिक से बात करें:\n+91 ' || owner || E'\nwa.me/91' || owner, '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF m='m_obj' OR (step='' AND m='6') THEN
    st := jsonb_build_object('step','obj_receipt');
    out := wa_txt(ph,'Rate Objection: अपना Receipt No लिखें (जैसे 12). सिर्फ आपके खाते की receipt स्वीकार होगी. Hi = Menu');
  ELSIF step='obj_receipt' THEN
    owned := wa_receipts(cust);
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO matches FROM jsonb_array_elements(owned) x
      WHERE lower(x->>'rno')=m OR (m ~ '^0*[0-9]+$' AND ltrim(x->>'rno','0')=ltrim(m,'0'));
    IF jsonb_array_length(matches)=0 THEN
      out := wa_txt(ph,'यह receipt आपके खाते में नहीं मिली या cancel है. अपना सही Receipt No लिखें.');
    ELSIF jsonb_array_length(matches)>1 THEN
      st := st || jsonb_build_object('step','obj_date','rno',matches->0->>'rno');
      out := wa_txt(ph,'इस Receipt No की एक से अधिक तारीख हैं. Receipt की तारीख DD-MM-YYYY में लिखें.');
    ELSE
      st := jsonb_build_object('step','obj_items','rc',matches->0,'page',0);
    END IF;
  ELSIF step='obj_date' THEN
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO matches FROM jsonb_array_elements(wa_receipts(cust)) x
      WHERE x->>'rno'=st->>'rno' AND (x->>'sdate'=m OR x->>'rdate'=m);
    IF jsonb_array_length(matches)<>1 THEN out := wa_txt(ph,'तारीख match नहीं हुई या receipt ambiguous है. DD-MM-YYYY दोबारा लिखें, या मालिक से बात करें.');
    ELSE st := jsonb_build_object('step','obj_items','rc',matches->0,'page',0); END IF;
  ELSIF step='obj_items' AND m='obj_next' THEN
    st := jsonb_set(st,'{page}',to_jsonb(COALESCE((st->>'page')::int,0)+1));
  ELSIF step='obj_items' AND m ~ '^oit_[0-9]+$' THEN
    ii := substring(m,5)::int; rc := st->'rc';
    IF ii>=jsonb_array_length(rc->'items') THEN out := wa_txt(ph,'सही item चुनें.');
    ELSE
      st := st || jsonb_build_object('step','obj_rate','ii',ii);
      out := wa_txt(ph,format(E'R.No %s | %s\n%s | Qty %s | Current rate %s\nअपना सही rate लिखें (जैसे 320.50).',rc->>'rno',rc->>'rdate',rc->'items'->ii->>'name',rc->'items'->ii->>'qty',wa_f((rc->'items'->ii->>'rate')::numeric)));
    END IF;
  ELSIF step='obj_rate' THEN
    IF m !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' OR m::numeric<=0 THEN
      out := wa_txt(ph,'सही rate लिखें: 0 से अधिक, अधिकतम 2 decimal (जैसे 320.50).');
    ELSE
      rc := st->'rc'; ii := (st->>'ii')::int; li := rc->'items'->ii;
      st := st || jsonb_build_object('step','obj_confirm','newRate',m::numeric);
      out := wa_btn(ph,format(E'*Objection Confirm करें*\nR.No %s | %s\nItem: %s | Qty: %s\nReceipt rate: %s\nआपका rate: %s\nSubmit के बाद मालिक review करेंगे.',rc->>'rno',rc->>'rdate',li->>'name',li->>'qty',wa_f((li->>'rate')::numeric),wa_f(m::numeric)),
        '[{"id":"obj_submit","t":"Confirm Submit"},{"id":"obj_edit","t":"Rate बदलें"},{"id":"cancel","t":"Cancel"}]');
    END IF;
  ELSIF step='obj_confirm' AND m='obj_edit' THEN
    st := st || '{"step":"obj_rate"}'; out := wa_txt(ph,'अपना नया rate लिखें.');
  ELSIF step='obj_confirm' AND m='obj_submit' THEN
    rc := NULL;
    SELECT x INTO rc FROM jsonb_array_elements(wa_receipts(cust)) x
      WHERE x->>'sdate'=st->'rc'->>'sdate' AND x->>'idx'=st->'rc'->>'idx' AND x->>'rno'=st->'rc'->>'rno';
    ii := (st->>'ii')::int;
    IF rc IS NULL OR rc->'items'->ii IS DISTINCT FROM st->'rc'->'items'->ii THEN
      st := '{}'::jsonb; out := wa_btn(ph,'Receipt बदल गई या अब आपकी active receipt नहीं है. फिर से शुरू करें.','[{"id":"m_obj","t":"Rate Objection"},{"id":"m_home","t":"Menu"}]');
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('wa:objections',0));
      SELECT value->'v' INTO cur FROM sg_store WHERE key='sg_wa_obj' FOR UPDATE; cur := COALESCE(cur,'[]');
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(cur) x WHERE x->>'status'='open' AND x->>'phone'=ph AND x->>'sdate'=rc->>'sdate' AND x->>'rcIdx'=rc->>'idx' AND x->>'itemIdx'=ii::text) THEN
        out := wa_txt(ph,'इस item की objection पहले से pending है. मालिक के जवाब का इंतजार करें.');
      ELSE
        li := rc->'items'->ii;
        obj := jsonb_build_object('id','ob_'||md5(ph||clock_timestamp()::text||random()::text),'phone',ph,'name',nm,'address',cust->>'address','custKey',ckey,
          'sdate',rc->>'sdate','rdate',rc->>'rdate','rno',rc->>'rno','rcIdx',(rc->>'idx')::int,'itemIdx',ii,'item',li->>'name','qty',(li->>'qty')::numeric,
          'oldRate',(li->>'rate')::numeric,'newRate',(st->>'newRate')::numeric,'total',(rc->>'total')::numeric,'status','open','date',wa_ist_date(),'ts',wa_ist_ts());
        INSERT INTO sg_store(key,value,updated_at) VALUES('sg_wa_obj',jsonb_build_object('v',cur||obj),(extract(epoch from clock_timestamp())*1000)::bigint)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,synced_at=now();
        out := wa_btn(ph,format(E'Objection submitted.\nR.No %s | %s\n%s: %s -> आपका rate %s\nमालिक review करके WhatsApp पर जवाब देंगे.',obj->>'rno',obj->>'rdate',obj->>'item',wa_f((obj->>'oldRate')::numeric),wa_f((obj->>'newRate')::numeric)),'[{"id":"m_home","t":"Main Menu"}]');
      END IF;
      st := '{}'::jsonb;
    END IF;
  ELSIF step='obj_confirm' THEN
    out := wa_btn(ph,'Objection अभी submit नहीं हुई. Confirm Submit दबाएँ.','[{"id":"obj_submit","t":"Confirm Submit"},{"id":"cancel","t":"Cancel"}]');

  -- Unknown / expired selections return the same canonical three-button menu.
  ELSE
    st := '{}'::jsonb;
    out := wa_btn(ph,format(E'*%s*\nनमस्ते %s जी!\nनीचे touch करके service चुनें. Hi = Menu',shop,COALESCE(NULLIF(nm,''),'Customer')),
      '[{"id":"m_due","t":"मेरा बाकी (Due)"},{"id":"m_order","t":"नया Order"},{"id":"m_more","t":"More Services"}]');
  END IF;

  IF st->>'step'='obj_items' AND out IS NULL THEN
    rc := st->'rc'; page := COALESCE((st->>'page')::int,0);
    IF page*9 >= jsonb_array_length(COALESCE(rc->'items','[]')) THEN page:=0; END IF;
    st := jsonb_set(st,'{page}',to_jsonb(page));
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id','oit_'||(n-1),'t',x->>'name','d','Qty '||(x->>'qty')||' | Rate '||wa_f((x->>'rate')::numeric))),'[]') INTO main_rows
      FROM jsonb_array_elements(rc->'items') WITH ORDINALITY a(x,n) WHERE n>page*9 AND n<=page*9+9;
    IF jsonb_array_length(rc->'items')>9 THEN main_rows:=main_rows||'[{"id":"obj_next","t":"Next items"}]'::jsonb; END IF;
    IF jsonb_array_length(main_rows)=0 THEN st:='{}'; out:=wa_txt(ph,'Receipt में item नहीं मिला. मालिक से बात करें.');
    ELSE out := wa_list(ph,'R.No '||(rc->>'rno')||' | '||(rc->>'rdate')||E'\nकिस item के rate में objection है?','Item चुनें','Receipt items',main_rows); END IF;
  END IF;

  BEGIN
    INSERT INTO wa_sessions (phone, state, updated_at) VALUES (ph, st, now()) ON CONFLICT (phone) DO UPDATE SET state = EXCLUDED.state, updated_at = now();
    INSERT INTO wa_log (phone, dir, body, msg, reply) VALUES (ph, 'out', out, p_msg, COALESCE(out->'text'->>'body', out->'interactive'->'body'->>'text'));
  END;
  RETURN out::TEXT;
END $$;

CREATE OR REPLACE FUNCTION public.wa_receive(p_phone TEXT,p_msg TEXT,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE reply_ JSONB; ph TEXT := regexp_replace(p_phone,'\D','','g'); BEGIN
  IF length(ph)=10 THEN ph:='91'||ph; END IF;
  IF NULLIF(p_id,'') IS NULL THEN RAISE EXCEPTION 'WhatsApp message ID missing'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa:message:'||p_id,0));
  SELECT reply INTO reply_ FROM wa_inbox WHERE message_id=p_id AND phone=ph;
  IF reply_ IS NOT NULL THEN RETURN reply_; END IF;
  reply_ := wa_handle(ph,p_msg)::jsonb;
  INSERT INTO wa_inbox(message_id,phone,reply) VALUES(p_id,ph,reply_);
  RETURN reply_;
END $$;

-- Only call through the authenticated owner API. No rate or identity comes from a customer.
CREATE OR REPLACE FUNCTION public.wa_resolve(p_id TEXT,p_action TEXT,p_rate NUMERIC) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE arr JSONB; ob JSONB; cust JSONB; rc JSONB; rec JSONB; receipts JSONB; item_ JSONB;
  ix INT; ri INT; oi INT; rate_ NUMERIC; old_total NUMERIC; new_total NUMERIC; msg_ TEXT;
  previous JSONB; receipt_key TEXT; stamp TEXT := wa_ist_ts() || ' (WA)';
BEGIN
  IF p_action NOT IN ('accept','set','deny','retry') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa:objections',0));
  SELECT result INTO previous FROM wa_decisions WHERE objection_id=p_id;
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF p_action='retry' THEN RAISE EXCEPTION 'Decision not saved yet'; END IF;
  SELECT value->'v' INTO arr FROM sg_store WHERE key='sg_wa_obj' FOR UPDATE;
  SELECT x,(n-1)::int INTO ob,oi FROM jsonb_array_elements(COALESCE(arr,'[]')) WITH ORDINALITY a(x,n) WHERE x->>'id'=p_id;
  IF ob IS NULL OR ob->>'status'<>'open' THEN RAISE EXCEPTION 'Open objection not found'; END IF;
  SELECT value->'v'->right(ob->>'phone',10) INTO cust FROM sg_store WHERE key='sg_wa_cust';
  receipt_key := 'sg_arcpt_'||(ob->>'sdate');
  SELECT value->'v' INTO receipts FROM sg_store WHERE key=receipt_key FOR UPDATE;
  SELECT x INTO rc FROM jsonb_array_elements(wa_receipts(cust)) x
    WHERE x->>'sdate'=ob->>'sdate' AND x->>'idx'=ob->>'rcIdx' AND x->>'rno'=ob->>'rno';
  IF rc IS NULL OR cust->>'key' IS DISTINCT FROM ob->>'custKey' THEN RAISE EXCEPTION 'Receipt owner changed or receipt missing/cancelled'; END IF;
  ri := (ob->>'rcIdx')::int; ix := (ob->>'itemIdx')::int; rec := receipts->ri;
  IF ix IS NULL THEN RAISE EXCEPTION 'Legacy objection: ask customer to submit again'; END IF;
  item_ := rec->'items'->ix;
  IF item_ IS NULL OR item_->>'name' IS DISTINCT FROM ob->>'item'
     OR (item_->>'qty')::numeric IS DISTINCT FROM (ob->>'qty')::numeric
     OR (item_->>'rate')::numeric IS DISTINCT FROM (ob->>'oldRate')::numeric THEN
    RAISE EXCEPTION 'Receipt item changed; refresh and ask customer to submit again';
  END IF;
  rate_ := CASE WHEN p_action='accept' THEN (ob->>'newRate')::numeric WHEN p_action='deny' THEN (ob->>'oldRate')::numeric ELSE p_rate END;
  IF rate_ IS NULL OR rate_<=0 OR rate_>9999999.99 OR round(rate_,2)<>rate_ THEN RAISE EXCEPTION 'Rate must be positive with at most 2 decimals'; END IF;
  old_total := (rec->>'total')::numeric; new_total := old_total;
  IF p_action<>'deny' THEN
    item_ := item_ || jsonb_build_object('rateOld',item_->'rate','rate',rate_::text,'amount',round((item_->>'qty')::numeric*rate_,2)::text,'waEdit',true);
    rec := jsonb_set(rec,ARRAY['items',ix::text],item_);
    SELECT sum(COALESCE(NULLIF(x->>'amount','')::numeric,(x->>'qty')::numeric*(x->>'rate')::numeric)) INTO new_total FROM jsonb_array_elements(rec->'items') x;
    rec := rec || jsonb_build_object('tvAmtOld',COALESCE(NULLIF(rec->'tvAmtOld','null'::jsonb),NULLIF(rec->'tvAmt','null'::jsonb),to_jsonb(old_total)),
      'tvAmt',new_total,'total',new_total::text,'tvEts',stamp,'tvEdate',wa_ist_date(),'waNote','WA objection '||p_id||': '||wa_f((ob->>'oldRate')::numeric)||' -> '||wa_f(rate_));
    receipts := jsonb_set(receipts,ARRAY[ri::text],rec);
    UPDATE sg_store SET value=jsonb_build_object('v',receipts),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint,synced_at=now() WHERE key=receipt_key;
  END IF;
  ob := ob || jsonb_build_object('status',CASE WHEN p_action='deny' THEN 'deny' ELSE 'ok' END,'decision',p_action,
    'finalRate',rate_,'oldTotal',old_total,'newTotal',new_total,'rts',stamp||' | '||wa_ist_date(),'reply',p_action||': '||wa_f(rate_));
  msg_ := format(E'SATYAM GOLD\nनमस्ते %s जी!\nReceipt %s | %s\nItem: %s | Qty: %s\nआपका suggested rate: %s\nDecision: %s\nपुराना rate: %s | Final rate: %s\nReceipt total: %s -> %s\n%s\nHi लिखें: Menu',ob->>'name',ob->>'rno',ob->>'rdate',ob->>'item',ob->>'qty',wa_f((ob->>'newRate')::numeric),
    CASE p_action WHEN 'deny' THEN 'Rejected / पुराना rate रहेगा' WHEN 'accept' THEN 'Accepted / आपका rate मंजूर' ELSE 'New rate / मालिक का नया rate' END,
    wa_f((ob->>'oldRate')::numeric),wa_f(rate_),wa_f(old_total),wa_f(new_total),stamp);
  INSERT INTO wa_decisions(objection_id,phone,result,message) VALUES(p_id,ob->>'phone',ob,msg_);
  arr := jsonb_set(arr,ARRAY[oi::text],ob);
  UPDATE sg_store SET value=jsonb_build_object('v',arr),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint,synced_at=now() WHERE key='sg_wa_obj';
  RETURN ob;
END $$;

CREATE INDEX IF NOT EXISTS wa_log_processed_idx ON wa_log ((body->>'id'))
  WHERE dir = 'processed';
COMMIT;

-- Verify these four columns exist; no customer data is returned.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'wa_log'
  AND column_name IN ('phone', 'mobile', 'dir', 'direction', 'msg', 'reply')
ORDER BY column_name;
