param([switch]$Background)
$ErrorActionPreference = 'Stop'
$companionRoot = $PSScriptRoot
& (Join-Path $companionRoot 'scripts/bootstrap.ps1') -PrepareOnly
if ($LASTEXITCODE -ne 0) { throw 'MAKMOLGA preparation failed.' }
$companionNode = (Get-Command node.exe -ErrorAction Stop).Source
& $companionNode (Join-Path $companionRoot 'scripts\setup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Setup failed' }
if ($Background) {
    $companionRuntime = Join-Path $companionRoot 'runtime'
    New-Item -ItemType Directory -Path $companionRuntime -Force | Out-Null
    $companionEntry = Join-Path $companionRoot 'src\main.mjs'
    $companionProcess = Start-Process -FilePath $companionNode -ArgumentList @('"' + $companionEntry + '"') -WorkingDirectory $companionRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $companionRuntime 'stdout.log') -RedirectStandardError (Join-Path $companionRuntime 'stderr.log')
    Write-Output "Started PID $($companionProcess.Id). Check npm run ctl -- status."
} else {
    Push-Location -LiteralPath $companionRoot
    try { & $companionNode (Join-Path $companionRoot 'src\main.mjs') } finally { Pop-Location }
}
