param([switch]$Auto)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts/bootstrap.ps1') -PrepareOnly
if ($LASTEXITCODE -ne 0) { throw 'MAKMOLGA preparation failed.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $PSScriptRoot 'scripts/connections.mjs'
if ($Auto) {
    & $node $entry --auto --install
    if ($LASTEXITCODE -ne 0) { throw '동료 자동 연결을 완료하지 못했습니다.' }
} else {
    $logs = Join-Path $PSScriptRoot 'runtime'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    Start-Process -FilePath $node -ArgumentList @(('"' + $entry + '"'), '--open') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'connections.stdout.log') -RedirectStandardError (Join-Path $logs 'connections.stderr.log') | Out-Null
    Write-Output '브라우저에서 동료 연결 센터를 엽니다.'
}
