# ============================================================
#  deploy.ps1 — Script de déploiement imgpact
#  Usage :
#    .\deploy.ps1                        — déploiement complet
#    .\deploy.ps1 -SkipRust              — templates/static uniquement
#    .\deploy.ps1 -ForceRebuild          — force la recompilation
#    .\deploy.ps1 -PurgeCache            — purge Cloudflare après déploiement
# ============================================================

param(
    [switch]$SkipRust,
    [switch]$ForceRebuild,
    [switch]$PurgeCache
)

# ── Configuration ────────────────────────────────────────────
$VPS       = "root@178.104.79.132"
$VPS_PATH  = "/var/www/imgpact"
$SERVICE   = "imgpact"

# Pour -PurgeCache : remplis ces deux valeurs
$CF_TOKEN  = ""   # dash.cloudflare.com → Profile → API Tokens
$CF_ZONE   = ""   # dash.cloudflare.com → imgpact.com → Overview (colonne droite)
# ─────────────────────────────────────────────────────────────

function Step($n, $msg) {
    Write-Host "[$n] $msg" -ForegroundColor Yellow
}
function Ok($msg) {
    Write-Host "OK : $msg" -ForegroundColor Green
}
function Fail($msg) {
    Write-Host "ERREUR : $msg" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   DEPLOIEMENT IMGPACT" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── Envoi des fichiers ────────────────────────────────────────
if (-not $SkipRust) {
    Step "1/5" "Envoi du code Rust (server/)..."
    scp -r server "${VPS}:${VPS_PATH}/"
    if ($LASTEXITCODE -ne 0) { Fail "scp server" }

    Step "2/5" "Envoi du moteur WASM (wasm-engine/)..."
    scp -r wasm-engine "${VPS}:${VPS_PATH}/"
    if ($LASTEXITCODE -ne 0) { Fail "scp wasm-engine" }

    Step "3/5" "Envoi de Cargo.toml / Cargo.lock..."
    scp Cargo.toml Cargo.lock "${VPS}:${VPS_PATH}/"
    if ($LASTEXITCODE -ne 0) { Fail "scp Cargo" }
} else {
    Write-Host "[1-3/5] -SkipRust : fichiers Rust ignores" -ForegroundColor DarkGray
}

Step "4/5" "Envoi des fichiers statiques (static/)..."
scp -r static "${VPS}:${VPS_PATH}/"
if ($LASTEXITCODE -ne 0) { Fail "scp static" }

Step "5/5" "Envoi des templates HTML (templates/)..."
scp -r templates "${VPS}:${VPS_PATH}/"
if ($LASTEXITCODE -ne 0) { Fail "scp templates" }

Ok "Tous les fichiers sont transferes"
Write-Host ""

# ── Compilation et redémarrage sur le VPS ────────────────────
if (-not $SkipRust) {
    Write-Host "Compilation sur le VPS (1-3 minutes)..." -ForegroundColor Yellow

    # Force touch si -ForceRebuild
    if ($ForceRebuild) {
        Write-Host "  -ForceRebuild : touch sur les fichiers Rust..." -ForegroundColor DarkGray
        ssh $VPS "touch ${VPS_PATH}/server/src/main.rs ${VPS_PATH}/server/src/i18n.rs ${VPS_PATH}/server/src/stats.rs"
        if ($LASTEXITCODE -ne 0) { Fail "touch fichiers Rust" }
    }

    ssh $VPS "cd ${VPS_PATH} && source ~/.cargo/env && cargo build --release -p server"
    if ($LASTEXITCODE -ne 0) { Fail "cargo build" }

    Write-Host "Remplacement du binaire..." -ForegroundColor Yellow
    ssh $VPS "systemctl stop ${SERVICE}"
    ssh $VPS "cp ${VPS_PATH}/target/release/server /usr/local/bin/imgpact-server"
    ssh $VPS "chmod +x /usr/local/bin/imgpact-server"
    ssh $VPS "chown -R imgpact:imgpact ${VPS_PATH}"
    ssh $VPS "systemctl start ${SERVICE}"

} else {
    Write-Host "Redemarrage du service..." -ForegroundColor Yellow
    ssh $VPS "systemctl restart ${SERVICE}"
    if ($LASTEXITCODE -ne 0) { Fail "systemctl restart" }
}

# Vérification
Start-Sleep -Seconds 2
$status = ssh $VPS "systemctl is-active ${SERVICE}"
if ($status -eq "active") {
    Ok "Service en ligne"
} else {
    Fail "Le service ne repond pas (status: $status)"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "   DEPLOIEMENT TERMINE !" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# ── Purge Cloudflare ─────────────────────────────────────────
if ($PurgeCache) {
    if (-not $CF_TOKEN -or -not $CF_ZONE) {
        Write-Host "ATTENTION : CF_TOKEN ou CF_ZONE non rempli dans deploy.ps1" -ForegroundColor Red
        Write-Host "Purge ignoree. Fais-la manuellement sur dash.cloudflare.com" -ForegroundColor DarkGray
    } else {
        Write-Host "Purge du cache Cloudflare..." -ForegroundColor Yellow
        $resp = Invoke-RestMethod `
            -Uri "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" `
            -Method POST `
            -Headers @{ "Authorization" = "Bearer $CF_TOKEN"; "Content-Type" = "application/json" } `
            -Body '{"purge_everything":true}'
        if ($resp.success) {
            Ok "Cache Cloudflare purge"
        } else {
            Write-Host "Erreur Cloudflare : $($resp.errors)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "Pense a purger le cache Cloudflare :" -ForegroundColor Yellow
    Write-Host "  dash.cloudflare.com -> imgpact.com -> Caching -> Purge Everything" -ForegroundColor DarkGray
    Write-Host "  Ou relance avec : .\deploy.ps1 -PurgeCache" -ForegroundColor DarkGray
}

Write-Host ""
