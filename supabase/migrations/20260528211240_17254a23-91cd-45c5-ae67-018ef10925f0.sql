CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'engine-dispatch',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--289483ef-62cc-4bc6-91f6-2ef8e90b8d34.lovable.app/api/public/cron/dispatch',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGtybHdsbHd4bmFuZWtjbGh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTIzMjQsImV4cCI6MjA5NTU2ODMyNH0.-KUAPhIZWhLWCpxE7nris2YWrcANuLUWu2BioWrqNq8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);