$ErrorActionPreference = 'Stop'

& "$env:WINDIR\System32\wsl.exe" --terminate TierFlow-Dev
Write-Output 'TierFlow-Dev stopped.'

