param([switch]$Background)
$ErrorActionPreference = 'Stop'
$worldRoot = Join-Path $PSScriptRoot 'runtime/local-world'
$serverJar = Join-Path $worldRoot 'server.jar'
if (-not (Test-Path -LiteralPath $serverJar)) { throw 'Prepare runtime/local-world/server.jar and server.properties first. See README.md.' }
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.local.json') -Raw | ConvertFrom-Json
$properties = Get-Content -LiteralPath (Join-Path $worldRoot 'server.properties')
if ($properties -notcontains 'server-ip=127.0.0.1') { throw 'This launcher is for a loopback-only local test world.' }
$portLine = $properties | Where-Object { $_ -match '^server-port=' } | Select-Object -Last 1
$port = [int]($portLine -replace '^server-port=', '')
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is already in use. The world may already be running." }
$javaArgs = @('-Xms512M', '-Xmx2G', '-jar', 'server.jar', 'nogui')
if ($Background) {
    $javaProcess = Start-Process -FilePath $config.proxy.java -ArgumentList $javaArgs -WorkingDirectory $worldRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $worldRoot 'stdout.log') -RedirectStandardError (Join-Path $worldRoot 'stderr.log')
    Write-Output "Local world starting, PID $($javaProcess.Id), address 127.0.0.1:$port. Read runtime/local-world/logs/latest.log for Done."
} else {
    Push-Location -LiteralPath $worldRoot
    try { & $config.proxy.java @javaArgs } finally { Pop-Location }
}
