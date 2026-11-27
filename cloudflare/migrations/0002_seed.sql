-- Organización de Círculo Internacional y configuración inicial de la plataforma.
INSERT OR IGNORE INTO organizations (id, name, country_code) VALUES ('6f0c1f5e-7c3a-4b8e-9d2a-1a2b3c4d5e6f', 'Círculo Internacional Bienes Raíces', 'MX');
INSERT OR IGNORE INTO platform_configuration (singleton, organization_id) VALUES (1, '6f0c1f5e-7c3a-4b8e-9d2a-1a2b3c4d5e6f');
INSERT OR IGNORE INTO app_settings (organization_id, commercial_price, currency_code, admin_notification_email, business_name, openpay_environment)
  VALUES ('6f0c1f5e-7c3a-4b8e-9d2a-1a2b3c4d5e6f', 365, 'MXN', 'contacto@circulointernacionalveracruz.org', 'ValoraIA', 'sandbox');
