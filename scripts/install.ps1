#Requires -Version 5.1
<#
.SYNOPSIS
    Installs ClaudeStat: the status line bridge and the VS Code extension.

.PARAMETER Target
    Which VS Code variant to install into: Code, Insiders, or Cursor.

.PARAMETER Force
    Overwrite an existing statusLine command that ClaudeStat did not create.
#>
[CmdletBinding()]
param(
    [ValidateSet('Code', 'Insiders', 'Cursor')]
    [string]$Target = 'Code',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required but was not found on PATH. Install Node 20 or newer, then re-run.'
}

if ($env:CLAUDE_CONFIG_DIR) {
    $claudeDir = $env:CLAUDE_CONFIG_DIR
} else {
    $claudeDir = Join-Path $HOME '.claude'
}
if (-not (Test-Path $claudeDir)) {
    throw "Claude Code config directory not found at $claudeDir. Install and sign in to Claude Code first."
}

switch ($Target) {
    'Insiders' { $extensionsRoot = Join-Path $HOME '.vscode-insiders\extensions' }
    'Cursor'   { $extensionsRoot = Join-Path $HOME '.cursor\extensions' }
    default    { $extensionsRoot = Join-Path $HOME '.vscode\extensions' }
}

Write-Host "Installing ClaudeStat $version" -ForegroundColor Cyan
Write-Host "  Claude config : $claudeDir"
Write-Host "  Extensions    : $extensionsRoot"

# --- 1. Bridge script -------------------------------------------------------
$bridgeDir = Join-Path $claudeDir 'claude-stat'
$bridgeTarget = Join-Path $bridgeDir 'statusline-usage.js'
New-Item -ItemType Directory -Force -Path $bridgeDir | Out-Null
Copy-Item (Join-Path $repoRoot 'src\bridge\statusline-usage.js') $bridgeTarget -Force
Write-Host "  [ok] bridge installed" -ForegroundColor Green

# --- 2. Register the status line -------------------------------------------
$settingsPath = Join-Path $claudeDir 'settings.json'
if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw
    # Strip a UTF-8 BOM if a previous tool wrote one; ConvertFrom-Json rejects it.
    $raw = $raw -replace '^\xEF\xBB\xBF', '' -replace "^$([char]0xFEFF)", ''
    $settings = $raw | ConvertFrom-Json
} else {
    $settings = [PSCustomObject]@{}
}

$bridgeForJson = $bridgeTarget -replace '\\', '/'
$command = "node `"$bridgeForJson`""
$existing = $settings.PSObject.Properties['statusLine']

if ($existing -and $existing.Value -and -not $Force) {
    $existingCommand = ''
    if ($existing.Value.PSObject.Properties['command']) {
        $existingCommand = [string]$existing.Value.command
    }
    if ($existingCommand -and $existingCommand -notlike '*statusline-usage.js*') {
        Write-Host ''
        Write-Warning 'You already have a statusLine configured, so it was left untouched:'
        Write-Host "    $existingCommand"
        Write-Host ''
        Write-Host 'ClaudeStat needs that hook to receive usage data. Either:'
        Write-Host '  - chain the two commands yourself in a wrapper script, or'
        Write-Host '  - re-run this installer with -Force to replace it.'
        Write-Host ''
        Write-Host 'The extension will still install, but will rely on polling only.'
        $skipStatusLine = $true
    }
}

if (-not $skipStatusLine) {
    $backup = "$settingsPath.claude-stat-backup"
    if ((Test-Path $settingsPath) -and -not (Test-Path $backup)) {
        Copy-Item $settingsPath $backup
        Write-Host "  [ok] settings backed up to $(Split-Path -Leaf $backup)" -ForegroundColor Green
    }
    $statusLine = [PSCustomObject]@{ type = 'command'; command = $command; padding = 0 }
    if ($existing) {
        $settings.statusLine = $statusLine
    } else {
        $settings | Add-Member -MemberType NoteProperty -Name statusLine -Value $statusLine
    }
    $json = $settings | ConvertTo-Json -Depth 100
    # UTF8Encoding($false) matters: a BOM here makes Claude Code discard the file silently.
    [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  [ok] statusLine registered" -ForegroundColor Green
}

# --- 3. Extension -----------------------------------------------------------
$extensionDir = Join-Path $extensionsRoot "claude-stat.claude-stat-$version"

# The folder is named for the version, so an upgrade would otherwise leave the previous
# one behind and VS Code would load both, showing two status bar items.
if (Test-Path $extensionsRoot) {
    Get-ChildItem $extensionsRoot -Directory -Filter 'claude-stat.claude-stat-*' |
        Where-Object { $_.FullName -ne $extensionDir } |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
            Write-Host "  [ok] removed previous version $($_.Name)" -ForegroundColor Green
        }
}

New-Item -ItemType Directory -Force -Path (Join-Path $extensionDir 'src') | Out-Null
foreach ($file in @('package.json', 'README.md', 'LICENSE')) {
    $source = Join-Path $repoRoot $file
    if (Test-Path $source) { Copy-Item $source $extensionDir -Force }
}
Copy-Item (Join-Path $repoRoot 'src\extension.js') (Join-Path $extensionDir 'src') -Force
Write-Host "  [ok] extension installed to $extensionDir" -ForegroundColor Green

Write-Host ''
Write-Host 'Done. Next steps:' -ForegroundColor Cyan
Write-Host '  1. Fully quit and reopen VS Code (a window reload does not always'
Write-Host '     pick up a newly added extension folder).'
Write-Host '  2. Send one message in Claude Code to populate the first reading.'
Write-Host ''
