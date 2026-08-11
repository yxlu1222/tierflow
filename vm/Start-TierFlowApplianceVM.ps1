$ErrorActionPreference = 'Stop'

$vmName = 'TierFlow-Appliance-Dev'
$vboxManage = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'

if (-not (Test-Path -LiteralPath $vboxManage)) {
    throw "VBoxManage not found: $vboxManage"
}

$stateLine = & $vboxManage showvminfo $vmName --machinereadable |
    Select-String '^VMState=' |
    Select-Object -First 1

if ($stateLine -notmatch 'VMState="running"') {
    & $vboxManage startvm $vmName --type gui
    exit $LASTEXITCODE
}

$vmProcess = Get-Process VirtualBoxVM -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "$vmName*" } |
    Select-Object -First 1

if ($null -ne $vmProcess) {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($vmProcess.Id)
}

