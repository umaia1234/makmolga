param([ValidateRange(30, 600)][int]$TimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts/bootstrap.ps1') -PrepareOnly
if ($LASTEXITCODE -ne 0) { throw 'MAKMOLGA preparation failed.' }
$companionNode = (Get-Command node.exe -ErrorAction Stop).Source
& $companionNode (Join-Path $PSScriptRoot 'scripts/start-session.mjs') $TimeoutSeconds
if ($LASTEXITCODE -ne 0) { throw 'MAKMOLGA startup failed. See the preceding error.' }
