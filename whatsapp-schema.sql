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
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wa_log_sync_phone_trg ON wa_log;
CREATE TRIGGER wa_log_sync_phone_trg BEFORE INSERT OR UPDATE ON wa_log
  FOR EACH ROW EXECUTE FUNCTION wa_log_sync_phone();
UPDATE wa_log
SET phone = COALESCE(phone, mobile), mobile = COALESCE(phone, mobile),
    dir = COALESCE(direction, dir, 'in'), direction = COALESCE(direction, dir, 'in')
WHERE phone IS NULL OR mobile IS NULL OR dir IS NULL OR direction IS NULL;

CREATE INDEX IF NOT EXISTS wa_log_processed_idx ON wa_log ((body->>'id'))
  WHERE dir = 'processed';
COMMIT;

-- Verify these four columns exist; no customer data is returned.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'wa_log'
  AND column_name IN ('phone', 'mobile', 'dir', 'direction')
ORDER BY column_name;
