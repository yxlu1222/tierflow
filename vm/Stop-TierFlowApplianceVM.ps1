$ErrorActionPreference = 'Stop'

$vmName = 'TierFlow-Appliance-Dev'
$vboxManage = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'

if (-not (Test-Path -LiteralPath $vboxManage)) {
    throw "VBoxManage not found: $vboxManage"
}

$stateLine = & $vboxManage showvminfo $vmName --machinereadable |
    Select-String '^VMState=' |
    Select-Object -First 1

if ($stateLine -match 'VMState="running"') {
    & $vboxManage controlvm $vmName acpipowerbutton
}

