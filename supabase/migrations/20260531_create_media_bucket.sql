-- Crear bucket 'media' para almacenamiento de archivos multimedia
-- Este bucket debe ser público para que las imágenes/videos se puedan visualizar

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800;

-- Política para permitir lectura pública del bucket media
CREATE POLICY "Media bucket is publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media');

-- Política para permitir upload autenticado al bucket media
CREATE POLICY "Authenticated users can upload to media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

-- Política para permitir a los usuarios actualizar sus propios archivos
CREATE POLICY "Users can update their own media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');
