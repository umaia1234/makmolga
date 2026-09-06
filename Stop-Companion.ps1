$ErrorActionPreference = 'Stop'
$companionNode = (Get-Command node -ErrorAction Stop).Source
& $companionNode (Join-Path $PSScriptRoot 'src\cli.mjs') shutdown
if ($LASTEXITCODE -ne 0) { throw 'Companion shutdown failed. Inspect runtime/stderr.log.' }
