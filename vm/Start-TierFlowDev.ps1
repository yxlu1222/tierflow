$ErrorActionPreference = 'Stop'

$wslExe = Join-Path $env:WINDIR 'System32\wsl.exe'
$arguments = @('-d', 'TierFlow-Dev', '--exec', '/usr/bin/tail', '-f', '/dev/null')

Start-Process -FilePath $wslExe -ArgumentList $arguments -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 3
        if ($status.success) {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 3
    }
}

if (-not $ready) {
    throw 'TierFlow-Dev started, but New API did not become healthy in time.'
}

Write-Output 'TierFlow-Dev is running: http://127.0.0.1:3000'

