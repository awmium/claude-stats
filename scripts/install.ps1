#Requires -Version 5.1
<#
.SYNOPSIS
    Installs ClaudeStats: the status line bridge and the VS Code extension.

.PARAMETER Target
    Which VS Code variant to install into: Code, Insiders, or Cursor.

.PARAMETER Force
    Overwrite an existing statusLine command that ClaudeStats did not create.
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

Write-Host "Installing ClaudeStats $version" -ForegroundColor Cyan
Write-Host "  Claude config : $claudeDir"
Write-Host "  Extensions    : $extensionsRoot"

# --- 1 and 2. Bridge script and status line --------------------------------
# src\setup.js is the same code the extension runs for "Set Up Claude Code Hook", so a
# source install and a Marketplace install change settings.json in exactly the same way.
$setupArgs = @('install')
if ($Force) { $setupArgs += '--force' }
$previousConfigDir = $env:CLAUDE_CONFIG_DIR
$env:CLAUDE_CONFIG_DIR = $claudeDir
try {
    & node (Join-Path $repoRoot 'src\setup.js') @setupArgs
    if ($LASTEXITCODE -ne 0) { throw 'Registering the statusLine failed; see the message above.' }
} finally {
    $env:CLAUDE_CONFIG_DIR = $previousConfigDir
}

# --- 3. Extension -----------------------------------------------------------
$extensionId = 'awmium.claude-stats'
$extensionDir = Join-Path $extensionsRoot "$extensionId-$version"
# Marks a folder as written by this script, so the scripts only ever remove their own
# copies and never a Marketplace install, which VS Code manages itself.
$marker = '.claude-stats-source-install'

if ((Test-Path $extensionDir) -and -not (Test-Path (Join-Path $extensionDir $marker))) {
    throw "ClaudeStats $version is already installed from the Marketplace at $extensionDir. Uninstall it in VS Code first if you want to run from source instead."
}

# The folder is named for the version, so an upgrade would otherwise leave the previous
# one behind and VS Code would load both, showing two status bar items. Copies from
# before 0.2.0 used the ID claude-stats.claude-stats and are always source installs.
if (Test-Path $extensionsRoot) {
    Get-ChildItem $extensionsRoot -Directory |
        Where-Object {
            $_.Name -ne (Split-Path -Leaf $extensionDir) -and (
                $_.Name -like 'claude-stats.claude-stats-*' -or
                ($_.Name -like "$extensionId-*" -and (Test-Path (Join-Path $_.FullName $marker)))
            )
        } |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
            Write-Host "  [ok] removed previous version $($_.Name)" -ForegroundColor Green
        }
}

New-Item -ItemType Directory -Force -Path (Join-Path $extensionDir 'src\bridge') | Out-Null
foreach ($file in @('package.json', 'README.md', 'CHANGELOG.md', 'LICENSE')) {
    $source = Join-Path $repoRoot $file
    if (Test-Path $source) { Copy-Item $source $extensionDir -Force }
}
foreach ($file in @('extension.js', 'setup.js')) {
    Copy-Item (Join-Path $repoRoot "src\$file") (Join-Path $extensionDir 'src') -Force
}
Copy-Item (Join-Path $repoRoot 'src\bridge\statusline-usage.js') (Join-Path $extensionDir 'src\bridge') -Force
New-Item -ItemType File -Force -Path (Join-Path $extensionDir $marker) | Out-Null
Write-Host "  [ok] extension installed to $extensionDir" -ForegroundColor Green

Write-Host ''
Write-Host 'Done. Next steps:' -ForegroundColor Cyan
Write-Host '  1. Fully quit and reopen VS Code (a window reload does not always'
Write-Host '     pick up a newly added extension folder).'
Write-Host '  2. Send one message in Claude Code to populate the first reading.'
Write-Host ''
