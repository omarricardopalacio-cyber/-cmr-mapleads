# ============================================================
#  Migracion de BASE DE DATOS  (Supabase origen -> destino)
#  Migra: schema public + global, sus datos, y usuarios de Auth
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
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    Set-Item -Path "Env:$k" -Value $v
  }
}
foreach ($k in @("SRC_DB_URL", "DST_DB_URL")) {
  if (-not (Test-Path "Env:$k")) { throw "Falta $k en migracion.env" }
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$pg_dump = "$PGBIN\pg_dump.exe"
$psql    = "$PGBIN\psql.exe"

Write-Host "==> [1/5] Volcando ESQUEMA (public + global)..." -ForegroundColor Cyan
& $pg_dump --dbname=$env:SRC_DB_URL --schema=public --schema=global --schema-only --no-owner --file="$outDir\schema.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump (schema) fallo" }

Write-Host "==> [2/5] Volcando DATOS (public + global)..." -ForegroundColor Cyan
& $pg_dump --dbname=$env:SRC_DB_URL --schema=public --schema=global --data-only --no-owner --file="$outDir\data.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump (data) fallo" }

Write-Host "==> [3/5] Volcando usuarios de AUTH..." -ForegroundColor Cyan
& $pg_dump --dbname=$env:SRC_DB_URL --data-only --no-owner --table=auth.users --table=auth.identities --file="$outDir\auth.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump (auth) fallo" }

Write-Host "==> [4/5] Restaurando ESQUEMA en destino..." -ForegroundColor Cyan
& $psql $env:DST_DB_URL -v ON_ERROR_STOP=1 --single-transaction -f "$outDir\schema.sql"
if ($LASTEXITCODE -ne 0) { throw "restore (schema) fallo" }

Write-Host "==> [5/5] Restaurando DATOS (auth + app) en destino..." -ForegroundColor Cyan
& $psql $env:DST_DB_URL -v ON_ERROR_STOP=1 --single-transaction -c "SET session_replication_role = replica;" -f "$outDir\auth.sql" -f "$outDir\data.sql"
if ($LASTEXITCODE -ne 0) { throw "restore (data) fallo" }

Write-Host ""
Write-Host "LISTO: base de datos migrada al proyecto destino." -ForegroundColor Green
