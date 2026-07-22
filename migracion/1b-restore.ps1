# ============================================================
#  Restauracion en el DESTINO usando los dumps ya generados.
#  Filtra sentencias que chocan con objetos que Supabase ya trae
#  (CREATE SCHEMA public / COMMENT ON SCHEMA public).
# ============================================================
$ErrorActionPreference = "Stop"

$root   = "C:\Users\USUARIO\Desktop\cmr"
$PGBIN  = "$root\-cmr-mapleads-main\pgsql\bin"
$envF   = "$root\migracion.env"
$outDir = "$root\migracion-dump"

# ---- Cargar migracion.env ----
if (-not (Test-Path $envF)) { throw "No se encontro $envF" }
Get-Content $envF | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $i = $line.IndexOf("=")
    Set-Item -Path ("Env:" + $line.Substring(0, $i).Trim()) -Value $line.Substring($i + 1).Trim()
  }
}
if (-not (Test-Path "Env:DST_DB_URL")) { throw "Falta DST_DB_URL en migracion.env" }

$psql = "$PGBIN\psql.exe"

# ---- Limpiar schema.sql (quitar sentencias que chocan con Supabase) ----
Write-Host "==> Limpiando schema.sql..." -ForegroundColor Cyan
$src = "$outDir\schema.sql"
$dst = "$outDir\schema_clean.sql"
$lines = [System.IO.File]::ReadAllLines($src)
$keep = New-Object System.Collections.Generic.List[string]
foreach ($l in $lines) {
  if ($l -match '^\s*CREATE SCHEMA public;\s*$') { continue }
  if ($l -match '^\s*COMMENT ON SCHEMA public\b') { continue }
  if ($l -match '^\s*ALTER DEFAULT PRIVILEGES\b') { continue }
  $keep.Add($l)
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($dst, $keep, $utf8)
Write-Host "    schema_clean.sql listo ($($keep.Count) lineas)"

# ---- Restaurar ESQUEMA ----
Write-Host "==> Restaurando ESQUEMA en destino..." -ForegroundColor Cyan
& $psql $env:DST_DB_URL -v ON_ERROR_STOP=1 --single-transaction -f "$dst"
if ($LASTEXITCODE -ne 0) { throw "restore (schema) fallo" }

# ---- Restaurar DATOS (auth + app) ----
Write-Host "==> Restaurando DATOS (auth + app) en destino..." -ForegroundColor Cyan
& $psql $env:DST_DB_URL -v ON_ERROR_STOP=1 --single-transaction -c "SET session_replication_role = replica;" -f "$outDir\auth.sql" -f "$outDir\data.sql"
if ($LASTEXITCODE -ne 0) { throw "restore (data) fallo" }

Write-Host ""
Write-Host "LISTO: base de datos restaurada en el proyecto destino." -ForegroundColor Green
