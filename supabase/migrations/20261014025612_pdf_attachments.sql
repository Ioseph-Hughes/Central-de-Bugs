-- Acrescenta PDFs sem modificar visibilidade, limite ou formatos já permitidos.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'central-attachments'
  and allowed_mime_types is not null
  and not ('application/pdf' = any(allowed_mime_types));
