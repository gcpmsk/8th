-- =====================================================================
-- SATYAM GOLD — PostgreSQL schema
-- इसे Adminer के "SQL command" box में paste करके Execute कर दें
-- (DB: postgres, Schema: public)
-- =====================================================================

CREATE TABLE IF NOT EXISTS sg_store (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at BIGINT      NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sg_store_updated_at_idx ON sg_store (updated_at);
CREATE INDEX IF NOT EXISTS sg_store_synced_at_idx  ON sg_store (synced_at);

-- हर बार row बदलने पर synced_at अपने आप update
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

-- =====================================================================
-- (Optional) देखने के लिए — कौन सी key कब save हुई
--   SELECT key, updated_at, synced_at FROM sg_store ORDER BY synced_at DESC;
-- Notebook का पूरा data:
--   SELECT value FROM sg_store WHERE key = 'sg_nb_16-08-2026';
-- =====================================================================
