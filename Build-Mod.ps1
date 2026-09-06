param([string]$JavaHome, [switch]$Preview)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome) { $JavaHome = $env:JAVA_HOME }
if (-not $JavaHome) {
    $compiler = Get-Command javac -ErrorAction SilentlyContinue
    if ($compiler) { $JavaHome = Split-Path (Split-Path $compiler.Source -Parent) -Parent }
}
if (-not $JavaHome) {
    $bundled = Join-Path $env:LOCALAPPDATA 'Packages/Microsoft.4297127D64EC6_8wekyb3d8bbwe/LocalCache/Local/runtime/java-runtime-epsilon/windows-x64/java-runtime-epsilon'
    if (Test-Path -LiteralPath (Join-Path $bundled 'bin/javac.exe')) { $JavaHome = $bundled }
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) {
    throw 'JDK 25 is required. Set JAVA_HOME or pass -JavaHome <JDK folder>.'
}
$env:JAVA_HOME = $JavaHome
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $PSScriptRoot 'runtime/build-cache/gradle' }
$modRoot = Join-Path $PSScriptRoot 'fabric-mod'
& (Join-Path $modRoot 'gradlew.bat') -p $modRoot build --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Mod build or tests failed.' }
Write-Output "Built mod: $modRoot/build/libs/companion-selector-26.2-0.3.0.jar"
if ($Preview) {
    & (Join-Path $modRoot 'gradlew.bat') -p $modRoot runClient -PselectorPreview --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Preview client failed.' }
}
