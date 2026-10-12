# CryptoBot - kaldirma scripti
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
# Gorevi siler ve server'i durdurur. %USERPROFILE%\CryptoBot klasorunu SILMEZ
# (loglar/sonuclar kalsin diye); istersen elle silebilirsin.

$TaskName = 'CryptoBot-DashboardServer'
$Port = 8765

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Gorev silindi: $TaskName"
} else {
    Write-Host "Gorev bulunamadi: $TaskName"
}
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force; Write-Host "Server durduruldu (PID $($_.OwningProcess))" } catch { }
}
$url = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Perp Sinyal Radari.url'
if (Test-Path $url) { Remove-Item $url -Force; Write-Host 'Masaustu kisayolu silindi' }
Write-Host "Klasor korunuyor: $(Join-Path $env:USERPROFILE 'CryptoBot')"
