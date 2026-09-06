param([ValidateRange(30, 600)][int]$TimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
$companionNode = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    Push-Location -LiteralPath $PSScriptRoot
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }
}
& $companionNode (Join-Path $PSScriptRoot 'scripts/start-session.mjs') $TimeoutSeconds
if ($LASTEXITCODE -ne 0) { throw 'MAKMOLGA startup failed. See the preceding error.' }
