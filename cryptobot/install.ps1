# CryptoBot - Windows kurulum scripti
# Kullanim (bu klasorde, PowerShell'de):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Yaptiklari:
#   1. %USERPROFILE%\CryptoBot klasorunu olusturur, scripti kopyalar
#   2. .venv olusturur, ccxt pandas numpy requests kurar
#   3. Syntax kontrolu yapar
#   4. Gorev Zamanlayici'ya "CryptoBot-DashboardServer" gorevini ekler
#      (oturum acilinca baslar, dusmusse 5 dk icinde yeniden baslatilir)
#   5. Server'i baslatir, /api/status ve /api/scan'i test eder
#   6. Masaustune "Perp Sinyal Radari" kisayolu koyar
# Yonetici (admin) yetkisi GEREKMEZ. Hicbir emir/API key yoktur.

$ErrorActionPreference = 'Stop'
$TaskName   = 'CryptoBot-DashboardServer'
$Port       = 8765
$Limit      = 100
$InstallDir = Join-Path $env:USERPROFILE 'CryptoBot'
$SrcDir     = $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "    HATA: $msg" -ForegroundColor Red; exit 1 }

# --- 0. Python bul -----------------------------------------------------------
Step 'Python 3.10+ araniyor'
$PyExe = $null; $PyArgs = @(); $v = $null
foreach ($cand in @('py|-3', 'python|', 'python3|')) {
    $exe, $arg = $cand.Split('|')
    $a = @(); if ($arg) { $a = @($arg) }
    try {
        $out = & $exe @a -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) {
            $parts = "$out".Trim().Split('.')
            if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 10) { $PyExe = $exe; $PyArgs = $a; $v = "$out".Trim(); break }
        }
    } catch { }
}
if (-not $PyExe) {
    Fail ("Python 3.10+ bulunamadi. https://www.python.org/downloads/ adresinden kurun " +
          "(kurulumda 'Add python.exe to PATH' kutusunu isaretleyin) ve bu scripti tekrar calistirin.")
}
Ok ("Python: $PyExe $($PyArgs -join ' ') ($v)")

# --- 1. Klasor + dosyalar ----------------------------------------------------
Step "Klasor hazirlaniyor: $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$src = Join-Path $SrcDir 'backtest_perp_scanner.py'
if (-not (Test-Path $src)) { Fail "backtest_perp_scanner.py bulunamadi: $src" }
Copy-Item $src -Destination $InstallDir -Force
foreach ($f in @('requirements.txt', 'uninstall.ps1', 'README.md')) {
    $p = Join-Path $SrcDir $f
    if (Test-Path $p) { Copy-Item $p -Destination $InstallDir -Force }
}
Ok 'Dosyalar kopyalandi'

# --- 2. venv + paketler ------------------------------------------------------
Step 'Sanal ortam (.venv) ve paketler kuruluyor (birkac dakika surebilir)'
$VenvPy  = Join-Path $InstallDir '.venv\Scripts\python.exe'
$VenvPyw = Join-Path $InstallDir '.venv\Scripts\pythonw.exe'
if (-not (Test-Path $VenvPy)) {
    & $PyExe @PyArgs -m venv (Join-Path $InstallDir '.venv')
    if ($LASTEXITCODE -ne 0) { Fail 'venv olusturulamadi' }
}
& $VenvPy -m pip install --upgrade pip --quiet --disable-pip-version-check
& $VenvPy -m pip install ccxt pandas numpy requests --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail 'pip install basarisiz' }
Ok 'ccxt, pandas, numpy, requests kuruldu'

# --- 3. Syntax kontrolu ------------------------------------------------------
Step 'Syntax kontrolu'
& $VenvPy -m py_compile (Join-Path $InstallDir 'backtest_perp_scanner.py')
if ($LASTEXITCODE -ne 0) { Fail 'Syntax hatasi' }
& $VenvPy -c "import ccxt, pandas, numpy, requests; print('import ok')"
if ($LASTEXITCODE -ne 0) { Fail 'Paket import hatasi' }
Ok 'Script ve paketler hazir'

# --- 4. Gorev Zamanlayici ----------------------------------------------------
Step "Gorev Zamanlayici gorevi: $TaskName"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok 'Eski gorev kaldirildi'
}
# Port'u tutan eski bir surec varsa kapat (yeniden kurulum durumu)
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch { }
}

# pythonw.exe = konsol penceresi acmaz. Loglar server.log / server.err'e yazilir.
$action = New-ScheduledTaskAction -Execute $VenvPyw `
    -Argument "backtest_perp_scanner.py --mode serve --limit $Limit --port $Port --log-file server.log" `
    -WorkingDirectory $InstallDir

$userId = "$env:USERDOMAIN\$env:USERNAME"
# RunAtLoad karsiligi: oturum acilinca
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $userId
# KeepAlive karsiligi: 5 dakikada bir kontrol; zaten calisiyorsa yeni kopya acilmaz (IgnoreNew)
$tKeep = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($tLogon, $tKeep) `
    -Settings $settings -Principal $principal `
    -Description 'CryptoBot perp sinyal dashboard server (http://localhost:8765/). Emir vermez.' | Out-Null
Ok 'Gorev kaydedildi (oturum acilisinda + 5 dk keep-alive)'

# --- 5. Baslat + test --------------------------------------------------------
Step 'Server baslatiliyor'
Start-ScheduledTask -TaskName $TaskName
$status = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try { $status = Invoke-RestMethod -Uri "http://localhost:$Port/api/status" -TimeoutSec 3; break } catch { }
}
if (-not $status) {
    Write-Host '    server.err icerigi:' -ForegroundColor Yellow
    $err = Join-Path $InstallDir 'server.err'
    if (Test-Path $err) { Get-Content $err -Tail 30 }
    Fail "http://localhost:$Port/api/status yanit vermedi"
}
Ok ('/api/status -> ' + ($status | ConvertTo-Json -Compress))

$scan = Invoke-RestMethod -Uri "http://localhost:$Port/api/scan" -TimeoutSec 10
Ok ("/api/scan -> status: " + $scan.status)

# --- 6. Masaustu kisayolu ----------------------------------------------------
Step 'Masaustu kisayolu'
$desktop = [Environment]::GetFolderPath('Desktop')
$url = Join-Path $desktop 'Perp Sinyal Radari.url'
"[InternetShortcut]`r`nURL=http://localhost:$Port/`r`n" | Set-Content -Path $url -Encoding ASCII
Ok $url

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' KURULUM TAMAM' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host " Ilk tarama arka planda basladi (~5-10 dk)."
Write-Host " Tarayicida acin ve yer imi ekleyin:  http://localhost:$Port/"
Write-Host " Loglar: $InstallDir\server.log  (hatalar: server.err)"
Write-Host " Kaldirmak icin: powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
Write-Host ''
Write-Host ' UYARI: Karar destek aracidir, trade botu DEGILDIR. Otomatik emir vermeyin.' -ForegroundColor Yellow
