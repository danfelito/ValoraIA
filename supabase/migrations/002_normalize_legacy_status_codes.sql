-- Compatibilidad entre etiquetas visibles en español y códigos internos de Supabase.
-- Debe ejecutarse después del esquema base.

create or replace function app_private.normalize_valuation_case_codes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.status := case lower(coalesce(new.status,''))
    when 'borrador' then 'draft'
    when 'pendiente de documentos' then 'documents_pending'
    when 'revisión de datos' then 'data_review'
    when 'revision de datos' then 'data_review'
    when 'pendiente de inspección' then 'inspection_pending'
    when 'pendiente de inspeccion' then 'inspection_pending'
    when 'análisis de mercado' then 'market_analysis'
    when 'analisis de mercado' then 'market_analysis'
    when 'cálculo' then 'calculation'
    when 'calculo' then 'calculation'
    when 'revisión profesional' then 'professional_review'
    when 'revision profesional' then 'professional_review'
    when 'aprobado' then 'approved'
    when 'firmado' then 'signed'
    when 'archivado' then 'archived'
    else new.status
  end;
  new.coverage_level := case lower(coalesce(new.coverage_level,''))
    when 'calibrada' then 'calibrated'
    when 'cubierta' then 'covered'
    when 'asistida' then 'assisted'
    when 'exploratoria' then 'exploratory'
    else new.coverage_level
  end;
  return new;
end;
$$;

drop trigger if exists normalize_valuation_case_codes_trigger on public.valuation_cases;
create trigger normalize_valuation_case_codes_trigger
before insert or update of status, coverage_level on public.valuation_cases
for each row execute function app_private.normalize_valuation_case_codes();

create or replace function app_private.normalize_document_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.status := case lower(coalesce(new.status,''))
    when 'pendiente de procesamiento' then 'uploaded'
    when 'cargado' then 'uploaded'
    when 'procesando' then 'processing'
    when 'procesado' then 'processed'
    when 'requiere configuración' then 'needs_review'
    when 'requiere configuracion' then 'needs_review'
    when 'requiere revisión' then 'needs_review'
    when 'requiere revision' then 'needs_review'
    when 'rechazado' then 'rejected'
    else new.status
  end;
  return new;
end;
$$;

drop trigger if exists normalize_document_status_trigger on public.documents;
create trigger normalize_document_status_trigger
before insert or update of status on public.documents
for each row execute function app_private.normalize_document_status();

create or replace function app_private.normalize_extracted_field_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.status := case lower(coalesce(new.status,''))
    when 'pending_review' then 'pending'
    when 'pendiente' then 'pending'
    when 'confirmado' then 'confirmed'
    when 'corregido' then 'corrected'
    when 'rechazado' then 'rejected'
    else new.status
  end;
  return new;
end;
$$;

drop trigger if exists normalize_extracted_field_status_trigger on public.extracted_fields;
create trigger normalize_extracted_field_status_trigger
before insert or update of status on public.extracted_fields
for each row execute function app_private.normalize_extracted_field_status();
