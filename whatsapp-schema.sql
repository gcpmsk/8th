-- =====================================================================
-- SATYAM GOLD — WhatsApp Bot  (PostgreSQL)
-- पूरा text Adminer → SQL command में paste करके Execute करें.
-- पुरानी tables / orders / receipts DELETE या DROP नहीं करने हैं.
-- यह migration दोबारा चलाना सुरक्षित है (DB: postgres, Schema: public).
-- n8n में wa_handle() नहीं: WhatsApp Trigger → HTTP Request → /api/wa.
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
--   Postgres node:  SELECT wa_handle($1, $2) AS reply;
--   reply = WhatsApp Cloud API का पूरा JSON body → HTTP Request node से भेजें (README देखें)
--   Order flow: Atta(23/18/10/5 KG → बोरा) · Sattu/Besan(200g/500g → थैला/बोरा) · Chokar(बोरा)
--   हर order पर rate के साथ confirmation; Creditor को गेहूँ (Wheat) का Master rate दिखता है
-- पुराना wa_handle अपने-आप replace हो जाता है; अलग से DELETE/DROP कुछ नहीं करना.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.wa_ist_date() RETURNS TEXT LANGUAGE sql AS $$ SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','DD-MM-YYYY') $$;
CREATE OR REPLACE FUNCTION public.wa_ist_ts()   RETURNS TEXT LANGUAGE sql AS $$ SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') $$;
CREATE OR REPLACE FUNCTION public.wa_f(n NUMERIC) RETURNS TEXT LANGUAGE sql AS $$ SELECT '₹' || to_char(round(COALESCE(n,0)), 'FM999,999,999') $$;

-- Rate: Master → Area ±adj → Customer special (app के sg_rates जैसा)
CREATE OR REPLACE FUNCTION public.wa_rate(R JSONB, area TEXT, ckey TEXT, k TEXT) RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE base NUMERIC; sp TEXT; BEGIN
  base := COALESCE(NULLIF(R->'master'->>k,'')::NUMERIC,0) + COALESCE(NULLIF(R->'areaAdj'->area->>k,'')::NUMERIC,0);
  IF NULLIF(R->'area'->area->>k,'') IS NOT NULL THEN base := (R->'area'->area->>k)::NUMERIC; END IF;
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

DROP FUNCTION IF EXISTS public.wa_handle(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.wa_handle(p_phone TEXT, p_msg TEXT) RETURNS TEXT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  m     TEXT  := lower(btrim(COALESCE(p_msg, '')));
  ph    TEXT  := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  p10   TEXT  := right(ph, 10);
  cust JSONB; cfg JSONB; R JSONB; st JSONB := '{}'::jsonb; out JSONB;
  owner TEXT; shop TEXT; area TEXT := 'OTHER'; ckey TEXT := ''; nm TEXT := ''; iscred BOOLEAN := false;
  rate NUMERIC; wheat NUMERIC; q NUMERIC; tot NUMERIC; lines TEXT; n INT; mx INT := 0;
  it TEXT; sz TEXT; pk TEXT; iname TEXT; unit TEXT; mul NUMERIC := 1; urate NUMERIC; pnote TEXT := '';
  ord JSONB; cur JSONB; okey TEXT; ln JSONB; li JSONB; step TEXT;
  main_rows JSONB;
BEGIN
  BEGIN
    SELECT value->'v'->p10 INTO cust FROM sg_store WHERE key = 'sg_wa_cust';
    SELECT value->'v'       INTO cfg  FROM sg_store WHERE key = 'sg_wa_cfg';
    SELECT value->'v'       INTO R    FROM sg_store WHERE key = 'sg_rates';
    SELECT state INTO st FROM wa_sessions WHERE phone = ph;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  st := COALESCE(st, '{}'::jsonb); R := COALESCE(R, '{}'::jsonb); cfg := COALESCE(cfg, '{}'::jsonb);
  owner := right(COALESCE(cfg->>'owner', '918252487551'), 10); shop := COALESCE(cfg->>'shop','SATYAM GOLD');
  IF cust IS NOT NULL THEN nm := COALESCE(cust->>'name',''); area := COALESCE(cust->>'area','OTHER'); ckey := COALESCE(cust->>'key', upper(nm)); iscred := (cust->>'type') = 'cred'; END IF;
  wheat := wa_rate(R, area, ckey, 'wheat');
  step := COALESCE(st->>'step','');
  BEGIN INSERT INTO wa_log (phone, dir, body, msg) VALUES (ph, 'in', jsonb_build_object('text', p_msg, 'via', 'wa_handle'), p_msg); EXCEPTION WHEN OTHERS THEN NULL; END;

  main_rows := '[{"id":"m_due","t":"💰 मेरा बाक़ी (Due)"},{"id":"m_order","t":"🛒 नया Order","d":"Atta · Sattu · Besan · Chokar"},{"id":"m_hisab","t":"📋 पूरा हिसाब"},{"id":"m_rate","t":"📈 आज का भाव"},{"id":"m_owner","t":"📞 मालिक से बात"},{"id":"m_obj","t":"⚠️ Rate Objection"}]'::jsonb;

  -- ---------- number typed (qty) ----------
  IF step = 'qty' AND m ~ '^\d+(\.\d+)?$' THEN
    q := m::NUMERIC;
    IF q <= 0 OR q > 500 THEN out := wa_txt(ph, '❌ सही संख्या लिखें (1 – 500)'); 
    ELSE
      it := st->>'item'; sz := st->>'size'; pk := COALESCE(st->>'pack','bora');
      IF it = 'atta' THEN
        iname := CASE sz WHEN 'gold' THEN 'Atta Gold 23kg' WHEN 'a18' THEN 'Atta 18kg' WHEN 'a10' THEN 'Atta 10kg' ELSE 'Atta 5kg' END;
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
      tot := q * urate;
      st := st || jsonb_build_object('step','confirm','qty',q,'iname',iname,'unit',unit,'mul',mul,'prate',rate,'urate',urate,'note',pnote);
      out := wa_btn(ph, format(E'🧾 *Order Confirm करें*\n\n📦 %s\n🔢 %s %s%s\n%s\n👤 %s · %s',
              iname, q, unit, CASE WHEN pnote<>'' THEN ' (' || pnote || ')' ELSE '' END,
              CASE WHEN urate > 0 THEN format(E'💵 Rate: %s / %s\n💰 कुल: *%s*', wa_f(urate), unit, wa_f(tot)) ELSE '💵 Rate: मालिक बताएँगे' END,
              nm, COALESCE(cust->>'address','')),
             '[{"id":"ok_order","t":"✅ Confirm"},{"id":"more_item","t":"➕ और Item"},{"id":"cancel","t":"❌ Cancel"}]'::jsonb);
    END IF;

  -- ---------- confirm ----------
  ELSIF m IN ('ok_order','more_item') AND step = 'confirm' THEN
    li := jsonb_build_object('name', st->>'iname', 'qty', (st->>'qty')::NUMERIC * (st->>'mul')::NUMERIC, 'rate', round((st->>'prate')::NUMERIC, 2)::TEXT,
                             'pack', (st->>'qty') || ' ' || (st->>'unit'), 'note', COALESCE(st->>'note',''), 'amt', (st->>'qty')::NUMERIC * (st->>'urate')::NUMERIC);
    ln := COALESCE(st->'lines','[]'::jsonb) || li;
    IF m = 'more_item' THEN
      st := jsonb_build_object('step','item','lines',ln);
      out := wa_list(ph, '🛒 और कौन सा item?', '👇 Item चुनें', 'Items',
        '[{"id":"i_atta","t":"🌾 Atta","d":"23kg Gold · 18kg · 10kg · 5kg"},{"id":"i_sattu","t":"🥣 Sattu","d":"200g / 500g"},{"id":"i_besan","t":"🟡 Besan","d":"200g / 500g"},{"id":"i_chokar","t":"🐄 Chokar","d":"बोरा"}]'::jsonb);
    ELSE
      okey := 'sg_ord_' || wa_ist_date();
      SELECT COALESCE(value->'v','[]'::jsonb) INTO cur FROM sg_store s WHERE s.key = okey; cur := COALESCE(cur,'[]'::jsonb);
      SELECT COALESCE(max((o->>'no')::INT),0) INTO mx FROM sg_store s, jsonb_array_elements(COALESCE(s.value->'v','[]'::jsonb)) o WHERE s.key LIKE 'sg_ord_%' AND (o->>'no') ~ '^\d+$';
      ord := jsonb_build_object('id','w'||(EXTRACT(EPOCH FROM now())*1000)::BIGINT, 'no', lpad((mx+1)::TEXT,2,'0'), 'ts', wa_ist_ts(),
        'name', nm, 'address', COALESCE(cust->>'address',''), 'wa', true, 'phone', ph,
        'items', (SELECT jsonb_agg(jsonb_build_object('name',l->>'name','qty',(l->>'qty')::NUMERIC,'rate',rtrim(rtrim(l->>'rate','0'),'.'),'note',(l->>'pack') || CASE WHEN COALESCE(l->>'note','')<>'' THEN ' · '||(l->>'note') ELSE '' END)) FROM jsonb_array_elements(ln) l),
        'ordered', (SELECT jsonb_agg(jsonb_build_object('name',l->>'name','qty',(l->>'qty')::NUMERIC)) FROM jsonb_array_elements(ln) l), 'deliv', '[]'::jsonb);
      INSERT INTO sg_store (key, value, updated_at) VALUES (okey, jsonb_build_object('v', cur || ord), (EXTRACT(EPOCH FROM now())*1000)::BIGINT)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, synced_at = now();
      SELECT string_agg(format('• %s — %s%s', l->>'name', l->>'pack', CASE WHEN (l->>'amt')::NUMERIC > 0 THEN ' = ' || wa_f((l->>'amt')::NUMERIC) ELSE '' END), E'\n'), sum((l->>'amt')::NUMERIC) INTO lines, tot FROM jsonb_array_elements(ln) l;
      st := '{}'::jsonb;
      out := wa_btn(ph, format(E'✅ *Order No %s book हो गया!*\n\n%s\n%s🕐 %s · %s\n\nधन्यवाद 🙏 माल जल्दी पहुँचेगा।', ord->>'no', lines,
               CASE WHEN tot > 0 THEN '💰 कुल: *' || wa_f(tot) || E'*\n' ELSE '' END, ord->>'ts', wa_ist_date()),
             '[{"id":"m_order","t":"🛒 और Order"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
      BEGIN INSERT INTO wa_log (phone, dir, body, msg) VALUES (ph, 'owner', jsonb_build_object('order', ord, 'name', nm), 'ORDER #' || (ord->>'no')); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

  -- ---------- order flow ----------
  ELSIF m IN ('m_order','2') THEN
    st := jsonb_build_object('step','item','lines', COALESCE(st->'lines','[]'::jsonb));
    out := wa_list(ph, '🛒 *नया Order*' || E'\nकौन सा item चाहिए?', '👇 Item चुनें', 'Items',
      '[{"id":"i_atta","t":"🌾 Atta","d":"23kg Gold · 18kg · 10kg · 5kg"},{"id":"i_sattu","t":"🥣 Sattu","d":"200g / 500g"},{"id":"i_besan","t":"🟡 Besan","d":"200g / 500g"},{"id":"i_chokar","t":"🐄 Chokar","d":"बोरा"}]'::jsonb);
  ELSIF m = 'i_atta' THEN
    st := st || '{"step":"size","item":"atta"}'::jsonb;
    out := wa_list(ph, '🌾 *Atta* — कौन सा size?', '👇 Size चुनें', 'Atta', jsonb_build_array(
      jsonb_build_object('id','s_gold','t','Atta Gold 23kg','d', CASE WHEN wa_rate(R,area,ckey,'gold')>0 THEN wa_f(wa_rate(R,area,ckey,'gold'))||' / बोरा' ELSE 'बोरा' END),
      jsonb_build_object('id','s_a18','t','Atta 18kg','d', CASE WHEN wa_rate(R,area,ckey,'a18')>0 THEN wa_f(wa_rate(R,area,ckey,'a18'))||' / थैला · 1 बोरा = 3 थैला' ELSE '1 बोरा = 3 थैला' END),
      jsonb_build_object('id','s_a10','t','Atta 10kg','d', CASE WHEN wa_rate(R,area,ckey,'a10')>0 THEN wa_f(wa_rate(R,area,ckey,'a10'))||' / थैला · 1 बोरा = 5 थैला' ELSE '1 बोरा = 5 थैला' END),
      jsonb_build_object('id','s_a5','t','Atta 5kg','d', CASE WHEN wa_rate(R,area,ckey,'a5')>0 THEN wa_f(wa_rate(R,area,ckey,'a5'))||' / थैला · 1 बोरा = 10 थैला' ELSE '1 बोरा = 10 थैला' END)));
  ELSIF m IN ('s_gold','s_a18','s_a10','s_a5') AND (st->>'item') = 'atta' THEN
    st := st || jsonb_build_object('step','qty','size',substr(m,3),'pack','bora');
    out := wa_txt(ph, format(E'📦 *%s*\n\n🔢 कितने *बोरा* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 5)',
      CASE m WHEN 's_gold' THEN 'Atta Gold 23kg' WHEN 's_a18' THEN 'Atta 18kg' WHEN 's_a10' THEN 'Atta 10kg' ELSE 'Atta 5kg' END));
  ELSIF m IN ('i_sattu','i_besan') THEN
    it := substr(m,3); st := st || jsonb_build_object('step','size','item',it);
    out := wa_btn(ph, format('%s *%s* — कौन सा packet?', CASE it WHEN 'sattu' THEN '🥣' ELSE '🟡' END, initcap(it)),
      '[{"id":"g_200","t":"200g"},{"id":"g_500","t":"500g"}]'::jsonb);
  ELSIF m IN ('g_200','g_500') AND (st->>'item') IN ('sattu','besan') THEN
    st := st || jsonb_build_object('step','pack','size',substr(m,3));
    out := wa_btn(ph, format('📦 *%s %sg* — थैला या बोरा?', initcap(st->>'item'), substr(m,3)),
      '[{"id":"p_thaila","t":"👜 थैला"},{"id":"p_bora","t":"🧺 बोरा"}]'::jsonb);
  ELSIF m IN ('p_thaila','p_bora') AND step = 'pack' THEN
    st := st || jsonb_build_object('step','qty','pack',substr(m,3));
    out := wa_txt(ph, format(E'📦 *%s %sg*\n\n🔢 कितने *%s* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 2)', initcap(st->>'item'), st->>'size', CASE WHEN m='p_bora' THEN 'बोरा' ELSE 'थैला' END));
  ELSIF m = 'i_chokar' THEN
    st := st || '{"step":"qty","item":"chokar","pack":"bora"}'::jsonb;
    out := wa_txt(ph, E'🐄 *Chokar*\n\n🔢 कितने *बोरा* चाहिए? सिर्फ़ संख्या लिखें (जैसे: 3)');
  ELSIF m = 'cancel' THEN
    st := '{}'::jsonb; out := wa_btn(ph, '❌ Order cancel हो गया।', '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF step = 'qty' THEN
    out := wa_txt(ph, '🔢 कृपया सिर्फ़ संख्या लिखें (जैसे: 5) या *Hi* लिखकर Menu पर जाएँ');

  -- ---------- info ----------
  ELSIF m IN ('m_due','1','due') THEN
    IF cust IS NULL THEN out := wa_btn(ph, E'ℹ️ आपका नंबर किसी खाते से जुड़ा नहीं है।\n📞 मालिक: +91 ' || owner, '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
    ELSE out := wa_btn(ph, format(E'💰 *%s* जी\n📍 %s\n\n🔴 कुल बाक़ी: *%s*', nm, COALESCE(cust->>'address',''), wa_f((COALESCE(cust->>'due','0'))::NUMERIC)),
           '[{"id":"m_hisab","t":"📋 पूरा हिसाब"},{"id":"m_order","t":"🛒 नया Order"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb); END IF;
  ELSIF m IN ('m_hisab','3') THEN
    IF cust IS NULL THEN out := wa_txt(ph, 'ℹ️ आपका खाता नहीं मिला।');
    ELSE
      SELECT string_agg(format('🧾 %s · R.No %s = %s', r->>'rdate', r->>'rno', wa_f((r->>'total')::NUMERIC)), E'\n') INTO lines FROM jsonb_array_elements(COALESCE(cust->'receipts','[]'::jsonb)) r;
      out := wa_btn(ph, format(E'📋 *%s* — हिसाब\n\n%s\n\n🔴 बाक़ी: *%s*', nm, COALESCE(lines,'—'), wa_f((COALESCE(cust->>'due','0'))::NUMERIC)), '[{"id":"m_obj","t":"⚠️ Objection"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
    END IF;
  ELSIF m IN ('m_rate','4') THEN
    IF iscred THEN
      lines := CASE WHEN wheat > 0 THEN '🌾 गेहूँ (Wheat): *' || wa_f(wheat) || ' / Bag*' ELSE '🌾 गेहूँ का भाव अभी set नहीं — मालिक से बात करें' END;
    ELSE
      SELECT string_agg(format('• %s: %s', x.t, CASE WHEN wa_rate(R,area,ckey,x.k) > 0 THEN wa_f(wa_rate(R,area,ckey,x.k)) || x.u ELSE '—' END), E'\n') INTO lines
        FROM (VALUES ('gold','Atta Gold 23kg',' / बोरा'),('a18','Atta 18kg',' / थैला'),('a10','Atta 10kg',' / थैला'),('a5','Atta 5kg',' / थैला'),('sattu','Sattu',' / kg'),('besan','Besan',' / kg'),('chokar','Chokar',' / बोरा')) x(k,t,u);
      IF wheat > 0 THEN lines := lines || E'\n• Wheat: ' || wa_f(wheat) || ' / Bag'; END IF;
    END IF;
    out := wa_btn(ph, E'📈 *आज का भाव*\n' || wa_ist_date() || E'\n\n' || COALESCE(lines,'—'), '[{"id":"m_order","t":"🛒 Order करें"},{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF m IN ('m_owner','5') THEN
    out := wa_btn(ph, E'📞 मालिक से बात करें:\n+91 ' || owner || E'\nwa.me/91' || owner, '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF m IN ('m_obj','6') THEN
    out := wa_btn(ph, E'⚠️ *Rate Objection*\nऐसे लिखें: *Objection R.No 12 rate 320*\nमालिक देख कर जवाब देंगे 🙏', '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);
  ELSIF m LIKE 'objection%' OR m LIKE 'order%' THEN
    BEGIN INSERT INTO wa_log (phone, dir, body, msg) VALUES (ph, 'owner', jsonb_build_object('text', p_msg, 'name', nm), p_msg); EXCEPTION WHEN OTHERS THEN NULL; END;
    out := wa_btn(ph, E'✅ मिल गया, मालिक को भेज दिया 🙏\n' || p_msg, '[{"id":"m_home","t":"🏠 Menu"}]'::jsonb);

  -- ---------- main menu (Hi / कुछ भी) ----------
  ELSE
    st := '{}'::jsonb;
    out := wa_list(ph, format(E'🙏 नमस्ते%s!\n🌾 *%s* में आपका स्वागत है%s%s\n\nनीचे बटन दबा कर चुनें 👇',
      CASE WHEN nm <> '' THEN ' *' || nm || '* जी' ELSE '' END, shop,
      CASE WHEN cust IS NOT NULL AND NOT iscred AND COALESCE(cust->>'due','0')::NUMERIC > 0 THEN E'\n\n🔴 आपका बाक़ी: *' || wa_f((cust->>'due')::NUMERIC) || '*' ELSE '' END,
      CASE WHEN iscred AND wheat > 0 THEN E'\n\n🌾 आज गेहूँ का भाव: *' || wa_f(wheat) || ' / Bag*' ELSE '' END),
      '📋 Services', 'Services', main_rows);
  END IF;

  BEGIN
    INSERT INTO wa_sessions (phone, state, updated_at) VALUES (ph, st, now()) ON CONFLICT (phone) DO UPDATE SET state = EXCLUDED.state, updated_at = now();
    INSERT INTO wa_log (phone, dir, body, msg, reply) VALUES (ph, 'out', out, p_msg, COALESCE(out->'text'->>'body', out->'interactive'->'body'->>'text'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN out::TEXT;
END $$;

CREATE INDEX IF NOT EXISTS wa_log_processed_idx ON wa_log ((body->>'id'))
  WHERE dir = 'processed';
COMMIT;

-- Verify these four columns exist; no customer data is returned.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'wa_log'
  AND column_name IN ('phone', 'mobile', 'dir', 'direction', 'msg', 'reply')
ORDER BY column_name;
