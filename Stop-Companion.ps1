$ErrorActionPreference = 'Stop'
$companionManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resources/downloads.json') -Raw | ConvertFrom-Json
$companionNode = Join-Path $PSScriptRoot ('runtime/node/' + $companionManifest.node.directory + '/node.exe')
if (-not (Test-Path -LiteralPath $companionNode)) { $companionNode = (Get-Command node.exe -ErrorAction Stop).Source }
& $companionNode (Join-Path $PSScriptRoot 'src\cli.mjs') shutdown
if ($LASTEXITCODE -ne 0) { throw 'Companion shutdown failed. Inspect runtime/stderr.log.' }
