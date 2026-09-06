-- =====================================================================
-- SATYAM GOLD — WhatsApp Bot  (PostgreSQL)
-- पुरानी wa_log / wa_rates / wa_sessions tables हटा कर यह पूरा text
-- Adminer → SQL command में paste करके Execute करें (DB: postgres, Schema: public)
-- =====================================================================

DROP TABLE IF EXISTS wa_rates;
DROP TABLE IF EXISTS wa_sessions;
DROP TABLE IF EXISTS wa_log;

-- App का main store (पहले से हो तो कुछ नहीं होगा)
CREATE TABLE IF NOT EXISTS sg_store (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sg_store_updated_at_idx ON sg_store (updated_at);

-- हर WhatsApp number की chat state (menu में कहाँ है, कौन सा item चुना, आदि)
CREATE TABLE wa_sessions (
    phone      TEXT PRIMARY KEY,                    -- 918252487551
    state      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {step, item, pack, cust:{name,address,key}}
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- हर आने/जाने वाला message (debug + record)
CREATE TABLE wa_log (
    id         BIGSERIAL PRIMARY KEY,
    phone      TEXT,
    dir        TEXT NOT NULL,          -- 'in' | 'out' | 'err'
    body       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wa_log_phone_idx ON wa_log (phone, created_at DESC);

-- WhatsApp से आया order सीधे Order Book में  → key  sg_ord_<DD-MM-YYYY>   (app की same list)
-- Rate objection                              → key  sg_wa_obj             (app के Order Book में 📣 button से खुलता है)
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
