import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let consolidated = `-- ============================================================
-- MIGRACIÓN COMPLETA - CRM SUPABASE
-- Generado el: ${new Date().toISOString()}
-- Total: ${files.length} archivos de migración
-- ============================================================

BEGIN;

`;

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8').trim();
  consolidated += `\n-- >>> ${file}\n\n${sql}\n\n`;

  // Add separator
  if (!sql.endsWith(';')) {
    consolidated += ';\n';
  }
  consolidated += `-- <<< ${file}\n\n`;
}

consolidated += `\nCOMMIT;\n\n-- ============================================================
-- DATOS INICIALES (SEED)
-- ============================================================

-- Global settings singleton
INSERT INTO public.global_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Storage bucket media
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800)
ON CONFLICT (id) DO NOTHING;
`;

const outputPath = join(__dirname, '..', 'MIGRACION_COMPLETA.sql');
writeFileSync(outputPath, consolidated, 'utf8');

console.log(`Archivo generado: ${outputPath}`);
console.log(`Total: ${files.length} migraciones combinadas`);
console.log(`Tamaño: ${(Buffer.byteLength(consolidated, 'utf8') / 1024).toFixed(1)} KB`);
