param([switch]$Check)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$simulatorDir = Join-Path $projectRoot 'simulator'
$runtimeDir = Join-Path $simulatorDir '.runtime'
$scriptPath = Join-Path $simulatorDir 'ble_test_device.py'
$requirementsPath = Join-Path $simulatorDir 'requirements.txt'

$pythonCandidates = @()
if ($env:BLE_LAB_PYTHON) { $pythonCandidates += $env:BLE_LAB_PYTHON }
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonCandidates += $bundledPython
foreach ($name in @('py', 'python')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { $pythonCandidates += $command.Source }
}
$python = $pythonCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $python) { throw 'Python 3.9+ was not found. Install Python or set BLE_LAB_PYTHON to python.exe.' }

$env:PYTHONPATH = $runtimeDir
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
& $python -c 'import winrt.windows.devices.bluetooth; import winrt.windows.devices.bluetooth.genericattributeprofile; import winrt.windows.storage.streams' 2>$null
$importExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($importExitCode -ne 0) {
    Write-Host 'Installing Windows BLE packages into simulator/.runtime...'
    & $python -m pip install --disable-pip-version-check --target $runtimeDir -r $requirementsPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the Windows BLE packages.' }
}

if ($Check) { & $python -u $scriptPath --check }
else { & $python -u $scriptPath }
exit $LASTEXITCODE
