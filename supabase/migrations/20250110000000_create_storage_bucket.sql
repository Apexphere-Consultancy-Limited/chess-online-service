-- Create storage bucket for bot animations
-- This bucket will store all bot GIF animations served via CDN

-- Insert the bucket (public access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bot-animations',
  'bot-animations',
  true,  -- Public read access
  5242880,  -- 5MB file size limit
  ARRAY['image/gif', 'image/webp', 'image/avif']::text[]  -- Allow GIF and future formats
)
ON CONFLICT (id) DO NOTHING;

-- Create public read policy (anyone can view/download)
CREATE POLICY "Public read access for bot animations"
ON storage.objects FOR SELECT
USING (bucket_id = 'bot-animations');

-- Create authenticated upload policy (only service role can upload)
-- This prevents public uploads while allowing admin/script uploads
CREATE POLICY "Service role upload for bot animations"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'bot-animations' AND
  auth.role() = 'service_role'
);

-- Create authenticated update policy (only service role can update)
CREATE POLICY "Service role update for bot animations"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'bot-animations' AND
  auth.role() = 'service_role'
);

-- Create authenticated delete policy (only service role can delete)
CREATE POLICY "Service role delete for bot animations"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'bot-animations' AND
  auth.role() = 'service_role'
);
