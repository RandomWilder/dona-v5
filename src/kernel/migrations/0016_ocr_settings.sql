-- Slice 4.1. The Document AI OCR processor version, read per call.
--
-- Its own file because SPEC.md: migrations are append-only, and DDL and backfill never share one.
-- `ocr.processor_version` is welded to nothing already stored — a bad pin is fixed with a row,
-- not a deploy. The processor *id* is environment (`DOCUMENT_AI_PROCESSOR`), like DOCS_BUCKET.
--
-- `pretrained-ocr-v2.1-2024-08-07` is the GA Enterprise Document OCR version that hosts Hebrew
-- (`iw`) in `eu`. Online process only; the 15-page cap is code, not this row.

INSERT INTO config_settings (key, value, updated_at) VALUES
  ('ocr.processor_version', '"pretrained-ocr-v2.1-2024-08-07"', now())
ON CONFLICT (key) DO NOTHING;
