param([switch]$PrepareOnly, [switch]$PortableNode)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:npm_config_update_notifier = 'false'
$bootstrapRoot = Split-Path $PSScriptRoot -Parent
$bootstrapRuntime = Join-Path $bootstrapRoot 'runtime'
New-Item -ItemType Directory -Path $bootstrapRuntime -Force | Out-Null
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw '이 설치판은 Windows x64용입니다.' }
$bootstrapManifest = Get-Content -LiteralPath (Join-Path $bootstrapRoot 'resources/downloads.json') -Raw | ConvertFrom-Json
$bootstrapNode = $null
$bootstrapLocalNode = Join-Path $bootstrapRuntime ('node/' + $bootstrapManifest.node.directory + '/node.exe')
if (Test-Path -LiteralPath $bootstrapLocalNode) { $bootstrapNode = $bootstrapLocalNode }
if (-not $bootstrapNode -and -not $PortableNode) {
    $bootstrapExisting = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($bootstrapExisting) {
        $bootstrapVersion = & $bootstrapExisting.Source -p 'Number(process.versions.node.split(String.fromCharCode(46))[0])'
        if ($LASTEXITCODE -eq 0 -and [int]$bootstrapVersion -ge 22) { $bootstrapNode = $bootstrapExisting.Source }
    }
}
if (-not $bootstrapNode) {
    Write-Host '[1/3] 공식 Node.js 실행 환경을 이 폴더에 준비하고 있습니다...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $bootstrapArchive = Join-Path $bootstrapRuntime 'node.zip'
    if (-not (Test-Path -LiteralPath $bootstrapArchive) -or (Get-FileHash -LiteralPath $bootstrapArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bootstrapManifest.node.sha256) {
        Invoke-WebRequest -UseBasicParsing -Uri $bootstrapManifest.node.url -OutFile ($bootstrapArchive + '.download')
        if ((Get-FileHash -LiteralPath ($bootstrapArchive + '.download') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bootstrapManifest.node.sha256) { throw 'Node.js 파일 검증에 실패했습니다. 설치하지 않았습니다. 시작 파일을 다시 실행해 주세요.' }
        Move-Item -LiteralPath ($bootstrapArchive + '.download') -Destination $bootstrapArchive -Force
    }
    Expand-Archive -LiteralPath $bootstrapArchive -DestinationPath (Join-Path $bootstrapRuntime 'node') -Force
    $bootstrapNode = $bootstrapLocalNode
}
if (-not (Test-Path -LiteralPath $bootstrapNode)) { throw 'Node.js 실행 파일을 찾지 못했습니다.' }
$env:PATH = (Split-Path $bootstrapNode -Parent) + [IO.Path]::PathSeparator + $env:PATH
$bootstrapNpm = Join-Path (Split-Path $bootstrapNode -Parent) 'node_modules/npm/bin/npm-cli.js'
$bootstrapLock = (Get-FileHash -LiteralPath (Join-Path $bootstrapRoot 'package-lock.json') -Algorithm SHA256).Hash
$bootstrapStamp = Join-Path $bootstrapRuntime 'dependencies.sha256'
$bootstrapReady = (Test-Path -LiteralPath $bootstrapStamp) -and (Test-Path -LiteralPath (Join-Path $bootstrapRoot 'node_modules/mineflayer/package.json'))
if ($bootstrapReady) { $bootstrapReady = (Get-Content -LiteralPath $bootstrapStamp -Raw).Trim() -eq $bootstrapLock }
Push-Location -LiteralPath $bootstrapRoot
try {
    if (Test-Path -LiteralPath (Join-Path $bootstrapRoot 'release.json')) {
        & $bootstrapNode (Join-Path $bootstrapRoot 'scripts/verify-release.mjs') $bootstrapRoot --installed
        if ($LASTEXITCODE -ne 0) { throw '배포 파일이 없거나 변경되었습니다. 설치 ZIP을 다시 받아 새 폴더에 전체 압축을 풀어 주세요.' }
    }
    if (-not $bootstrapReady) {
        Write-Host '[2/3] 동료 구성요소를 설치합니다. 처음에는 몇 분 걸릴 수 있습니다...'
        if (-not (Test-Path -LiteralPath $bootstrapNpm)) { throw 'npm을 찾지 못했습니다. scripts/bootstrap.ps1 -PortableNode로 실행 환경을 준비해 주세요.' }
        & $bootstrapNode $bootstrapNpm ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw '구성요소 설치에 실패했습니다. 인터넷 연결을 확인하고 Start-Makmolga.cmd를 다시 실행해 주세요.' }
        [IO.File]::WriteAllText($bootstrapStamp, $bootstrapLock)
    }
    & $bootstrapNode --input-type=module -e "await import('mineflayer'); await import('./src/connections.mjs');"
    if ($LASTEXITCODE -ne 0) { if (Test-Path -LiteralPath $bootstrapStamp) { Remove-Item -LiteralPath $bootstrapStamp }; throw '구성요소를 불러오지 못했습니다. Start-Makmolga.cmd를 다시 실행하면 의존성을 복구합니다.' }
    if ($PrepareOnly) { Write-Host '맠몰가 실행 준비를 마쳤습니다.'; exit 0 }
    Write-Host '[3/3] 브라우저에 맠몰가 준비 화면을 엽니다...'
    $bootstrapEntry = Join-Path $bootstrapRoot 'scripts/connections.mjs'
    Start-Process -FilePath $bootstrapNode -ArgumentList @(('"' + $bootstrapEntry + '"'), '--open') -WorkingDirectory $bootstrapRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bootstrapRuntime 'connections.stdout.log') -RedirectStandardError (Join-Path $bootstrapRuntime 'connections.stderr.log') | Out-Null
} finally { Pop-Location }
