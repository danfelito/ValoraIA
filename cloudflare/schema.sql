-- ValoraIA en Cloudflare D1 (SQLite). Misma estructura funcional que tenía en Postgres.
-- Convenciones: ids y fechas como TEXT (UUID / ISO-8601), json y listas como TEXT JSON,
-- booleanos como INTEGER 0/1. El Worker convierte los tipos al leer y escribir (worker/schema.ts).
PRAGMA foreign_keys = ON;

-- ---------- autenticación propia ----------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  email_confirmed_at TEXT,
  user_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sign_in_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- ---------- organización ----------
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, country_code TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS platform_configuration (
  singleton INTEGER PRIMARY KEY DEFAULT 1, organization_id TEXT REFERENCES organizations(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, full_name TEXT, phone TEXT, locale TEXT DEFAULT 'es-MX', avatar_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  commercial_price REAL DEFAULT 300, currency_code TEXT DEFAULT 'MXN', commercial_checkout_url TEXT,
  admin_notification_email TEXT, business_name TEXT DEFAULT 'ValoraIA', privacy_url TEXT, terms_url TEXT,
  updated_by TEXT, updated_at TEXT, commercial_price_includes_tax INTEGER DEFAULT 1,
  payment_provider TEXT DEFAULT 'openpay', openpay_environment TEXT DEFAULT 'sandbox',
  openpay_webhook_verification_code TEXT, openpay_webhook_verified_at TEXT
);
CREATE TABLE IF NOT EXISTS appraisers (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, specialties TEXT DEFAULT '[]', property_types TEXT DEFAULT '[]',
  regions TEXT DEFAULT '[]', license_number TEXT, professional_body TEXT, notes TEXT, priority INTEGER DEFAULT 50,
  active INTEGER DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT,
  UNIQUE (organization_id, email)
);

-- ---------- expedientes ----------
CREATE TABLE IF NOT EXISTS valuation_cases (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folio TEXT NOT NULL, title TEXT, purpose TEXT, property_type TEXT, valuation_date TEXT DEFAULT (date('now')),
  status TEXT DEFAULT 'draft', country_code TEXT, region TEXT, municipality TEXT, locality TEXT,
  coverage_level TEXT DEFAULT 'assisted', owner_user_id TEXT, assigned_appraiser_id TEXT, progress INTEGER DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT,
  applicant_name TEXT, declared_owner_name TEXT, currency_code TEXT DEFAULT 'MXN', service_type TEXT DEFAULT 'professional',
  UNIQUE (organization_id, folio)
);
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES valuation_cases(id) ON DELETE CASCADE,
  address_line TEXT, postal_code TEXT, latitude REAL, longitude REAL, cadastral_key TEXT, registry_folio TEXT,
  land_area_m2 REAL, built_area_m2 REAL, rentable_area_m2 REAL, saleable_area_m2 REAL, frontage_m REAL, depth_m REAL,
  floors INTEGER, bedrooms INTEGER, bathrooms REAL, parking_spaces INTEGER, construction_year INTEGER,
  conservation_state TEXT, construction_quality TEXT, occupancy_status TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES valuation_cases(id) ON DELETE CASCADE, category TEXT,
  file_name TEXT, storage_path TEXT UNIQUE, mime_type TEXT, size_bytes INTEGER, sha256 TEXT, status TEXT DEFAULT 'uploaded',
  uploaded_by TEXT, uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), processed_at TEXT, metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS documents_case_idx ON documents(case_id);
CREATE TABLE IF NOT EXISTS extracted_fields (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES valuation_cases(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, field_key TEXT, raw_text TEXT, normalized_value TEXT,
  page_number INTEGER, confidence REAL, extraction_method TEXT, status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), reviewed_by TEXT, reviewed_at TEXT,
  field_label TEXT, value_type TEXT, unit TEXT, evidence_bbox TEXT, validation_flags TEXT DEFAULT '[]',
  is_machine_generated INTEGER DEFAULT 1, provider TEXT, model TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS extracted_case_idx ON extracted_fields(case_id);
CREATE TABLE IF NOT EXISTS adopted_values (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES valuation_cases(id) ON DELETE CASCADE, field_key TEXT NOT NULL,
  value TEXT, source_type TEXT, source_id TEXT, justification TEXT, adopted_by TEXT,
  adopted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (case_id, field_key)
);
CREATE TABLE IF NOT EXISTS data_conflicts (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES valuation_cases(id) ON DELETE CASCADE, field_key TEXT,
  severity TEXT, description TEXT, candidate_values TEXT DEFAULT '[]', status TEXT DEFAULT 'open', resolution TEXT,
  resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT DEFAULT 'manual', rule_code TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT, case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE,
  actor_user_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT, before_data TEXT, after_data TEXT, metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  requested_by TEXT, status TEXT DEFAULT 'queued', priority INTEGER DEFAULT 50, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3,
  provider TEXT, model TEXT, error_code TEXT, error_message TEXT, usage TEXT DEFAULT '{}', started_at TEXT, completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS document_analyses (
  id TEXT PRIMARY KEY, organization_id TEXT, case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE,
  document_id TEXT UNIQUE REFERENCES documents(id) ON DELETE CASCADE, document_type TEXT DEFAULT 'otro', document_subtype TEXT,
  language_code TEXT, classification_confidence REAL, page_count INTEGER, image_quality TEXT, has_handwriting INTEGER,
  summary TEXT, warnings TEXT DEFAULT '[]', provider TEXT, model TEXT, processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS document_page_evidence (
  id TEXT PRIMARY KEY, organization_id TEXT, case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, page_number INTEGER, relevant_text TEXT, confidence REAL,
  is_complete_transcription INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (document_id, page_number)
);
CREATE TABLE IF NOT EXISTS market_comparables (
  id TEXT PRIMARY KEY, organization_id TEXT, case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE, title TEXT,
  operation_type TEXT DEFAULT 'offer', source_name TEXT, source_url TEXT, source_quality TEXT DEFAULT 'medium', address_line TEXT,
  locality TEXT, municipality TEXT, region TEXT, latitude REAL, longitude REAL, observed_at TEXT DEFAULT (date('now')), price REAL,
  currency_code TEXT DEFAULT 'MXN', land_area_m2 REAL, built_area_m2 REAL, property_type TEXT, bedrooms REAL, bathrooms REAL,
  parking_spaces REAL, construction_year INTEGER, conservation_state TEXT, construction_quality TEXT,
  negotiation_adjustment REAL DEFAULT 0, date_adjustment REAL DEFAULT 0, location_adjustment REAL DEFAULT 0, size_adjustment REAL DEFAULT 0,
  conservation_adjustment REAL DEFAULT 0, quality_adjustment REAL DEFAULT 0, other_adjustment REAL DEFAULT 0, adjustment_rationale TEXT,
  unit_price REAL, adjusted_unit_price REAL, similarity_score REAL, included INTEGER DEFAULT 1, notes TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS valuation_calculations (
  id TEXT PRIMARY KEY, organization_id TEXT, case_id TEXT UNIQUE REFERENCES valuation_cases(id) ON DELETE CASCADE,
  market_value REAL, cost_value REAL, income_value REAL, residual_value REAL, final_value REAL, low_value REAL, high_value REAL,
  confidence_score REAL, market_weight REAL DEFAULT 0, cost_weight REAL DEFAULT 0, income_weight REAL DEFAULT 0, residual_weight REAL DEFAULT 0,
  market_inputs TEXT DEFAULT '{}', cost_inputs TEXT DEFAULT '{}', income_inputs TEXT DEFAULT '{}', residual_inputs TEXT DEFAULT '{}',
  reconciliation_notes TEXT, status TEXT DEFAULT 'draft', updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS valuation_report_previews (
  case_id TEXT PRIMARY KEY REFERENCES valuation_cases(id) ON DELETE CASCADE, organization_id TEXT, created_by TEXT,
  status TEXT DEFAULT 'draft', currency_code TEXT DEFAULT 'MXN', subject_area_m2 REAL, price_per_m2 REAL, estimated_value REAL,
  low_value REAL, high_value REAL, comparable_count INTEGER, report_data TEXT DEFAULT '{}', pdf_storage_path TEXT,
  error_message TEXT, generated_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- solicitudes, pagos e informes ----------
CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id TEXT UNIQUE REFERENCES valuation_cases(id) ON DELETE CASCADE, created_by TEXT, service_type TEXT,
  status TEXT DEFAULT 'captured', payment_status TEXT DEFAULT 'not_required', payment_amount REAL DEFAULT 0,
  payment_currency TEXT DEFAULT 'MXN', payment_reference TEXT, client_name TEXT, client_email TEXT, client_phone TEXT,
  alternate_phone TEXT, preferred_contact TEXT, best_contact_time TEXT, marketing_consent INTEGER DEFAULT 0,
  privacy_accepted INTEGER DEFAULT 0, property_type TEXT, property_subtype TEXT, urgency TEXT,
  assigned_appraiser_id TEXT REFERENCES appraisers(id) ON DELETE SET NULL, routing_reason TEXT, routing_confidence REAL,
  routed_at TEXT, contacted_at TEXT, intake_data TEXT DEFAULT '{}', source TEXT DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT,
  invoice_requested INTEGER DEFAULT 0, fiscal_data TEXT DEFAULT '{}', payment_provider TEXT, payment_transaction_id TEXT,
  payment_checkout_url TEXT, payment_checkout_created_at TEXT, payment_method TEXT, payment_paid_at TEXT, payment_error TEXT,
  document_status TEXT DEFAULT 'not_started', document_storage_path TEXT, document_generated_at TEXT, document_emailed_at TEXT,
  invoice_status TEXT DEFAULT 'not_requested', invoice_uuid TEXT, invoice_pdf_url TEXT, invoice_xml_url TEXT, invoice_error TEXT,
  document_retry_count INTEGER DEFAULT 0, document_retry_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS service_requests_openpay_tx ON service_requests(payment_provider, payment_transaction_id) WHERE payment_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_requests_creator_idx ON service_requests(created_by);
CREATE TABLE IF NOT EXISTS appraiser_assignments (
  id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT REFERENCES service_requests(id) ON DELETE CASCADE,
  appraiser_id TEXT REFERENCES appraisers(id), status TEXT DEFAULT 'assigned', score REAL, confidence REAL, reason TEXT,
  assigned_by TEXT DEFAULT 'ai', assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), notified_at TEXT, responded_at TEXT,
  UNIQUE (request_id, appraiser_id)
);
CREATE TABLE IF NOT EXISTS intake_documents (
  id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT REFERENCES service_requests(id) ON DELETE CASCADE, uploaded_by TEXT,
  category TEXT DEFAULT 'otro', file_name TEXT, storage_path TEXT, mime_type TEXT, size_bytes INTEGER, status TEXT DEFAULT 'uploaded',
  analysis TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS intake_request_idx ON intake_documents(request_id);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT REFERENCES service_requests(id) ON DELETE CASCADE,
  provider TEXT DEFAULT 'manual', provider_event_id TEXT, event_type TEXT, amount REAL, currency_code TEXT DEFAULT 'MXN',
  raw_payload TEXT DEFAULT '{}', created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS commercial_reports (
  id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES valuation_cases(id) ON DELETE CASCADE, status TEXT DEFAULT 'draft', currency_code TEXT DEFAULT 'MXN',
  subject_area_m2 REAL, price_per_m2 REAL, estimated_value REAL, low_value REAL, high_value REAL, comparable_count INTEGER DEFAULT 0,
  report_data TEXT DEFAULT '{}', pdf_storage_path TEXT, error_message TEXT, generated_at TEXT, emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY, organization_id TEXT, request_id TEXT REFERENCES service_requests(id) ON DELETE CASCADE,
  assignment_id TEXT, channel TEXT DEFAULT 'email', recipient TEXT, subject TEXT, body_text TEXT, body_html TEXT,
  status TEXT DEFAULT 'queued', provider TEXT, provider_message_id TEXT, error_message TEXT, metadata TEXT DEFAULT '{}',
  attempts INTEGER DEFAULT 0, sent_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT,
  kind TEXT GENERATED ALWAYS AS (json_extract(metadata,'$.kind')) VIRTUAL,
  ref TEXT GENERATED ALWAYS AS (coalesce(json_extract(metadata,'$.ref'),'')) VIRTUAL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_kind_once ON notification_outbox(request_id, recipient, kind, ref) WHERE kind IS NOT NULL;

-- ---------- biblioteca técnica y mercado ----------
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE, source_type TEXT, title TEXT,
  category TEXT DEFAULT 'general', source_url TEXT, storage_path TEXT, file_name TEXT, mime_type TEXT, status TEXT DEFAULT 'pending',
  analysis TEXT DEFAULT '{}', extracted_text TEXT, error_message TEXT, last_analyzed_at TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, operation TEXT NOT NULL, property_type TEXT NOT NULL,
  municipality_key TEXT NOT NULL, locality_key TEXT, url TEXT NOT NULL, price REAL, data TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (organization_id, operation, url)
);
CREATE INDEX IF NOT EXISTS market_listings_zone_idx ON market_listings(organization_id, operation, property_type, municipality_key, observed_at);
CREATE TABLE IF NOT EXISTS market_searches (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_id TEXT, operation TEXT NOT NULL, level TEXT NOT NULL,
  property_type TEXT NOT NULL, municipality_key TEXT NOT NULL, locality_key TEXT, sources TEXT DEFAULT '[]',
  listing_count INTEGER DEFAULT 0, usage TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS market_searches_zone_idx ON market_searches(organization_id, operation, property_type, municipality_key, created_at);

-- Registro del robot programado (antes flow_config en Postgres).
CREATE TABLE IF NOT EXISTS flow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), result TEXT
);
