[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$GameDirectory = (Join-Path $env:APPDATA '.minecraft'))
$ErrorActionPreference = 'Stop'
$gameRoot = (Resolve-Path -LiteralPath $GameDirectory).Path
$sourceJar = Join-Path $PSScriptRoot 'fabric-mod/build/libs/companion-selector-26.2-0.2.3.jar'
if (-not (Test-Path -LiteralPath $sourceJar)) { throw 'Build the mod with Build-Mod.ps1 first.' }
$gameProcesses = Get-CimInstance Win32_Process -Filter "Name='javaw.exe' OR Name='java.exe'" | Where-Object {
    $_.CommandLine -match 'net\.fabricmc\.loader\.impl\.launch\.knot\.KnotClient|net\.minecraft\.client\.main\.Main|net\.fabricmc\.devlaunchinjector\.Main'
}
if ($gameProcesses -and -not $WhatIfPreference) { throw 'Exit Minecraft before applying the update. The local server can stay running.' }
$mods = Join-Path $gameRoot 'mods'
$oldJars = if (Test-Path -LiteralPath $mods) { Get-ChildItem -LiteralPath $mods -File | Where-Object Name -Match '^companion-selector-26\.2-.*\.jar$' }
if ($PSCmdlet.ShouldProcess($mods, 'Back up the previous companion mod and install v0.2.3')) {
    $backup = Join-Path $PSScriptRoot ('runtime/mod-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup, $mods -Force | Out-Null
    foreach ($jar in $oldJars) { Move-Item -LiteralPath $jar.FullName -Destination (Join-Path $backup $jar.Name) }
    try { Copy-Item -LiteralPath $sourceJar -Destination (Join-Path $mods (Split-Path $sourceJar -Leaf)) }
    catch {
        foreach ($jar in $oldJars) {
            $saved = Join-Path $backup $jar.Name
            if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $jar.FullName -Force }
        }
        throw
    }
    Write-Output 'Installed companion v0.2.3. Restart the companion runtime and launch the Fabric 26.2 profile.'
}
