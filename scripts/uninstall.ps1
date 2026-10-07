#Requires -Version 5.1
<#
.SYNOPSIS
    Removes ClaudeStats: the status line registration, the bridge, and the extension.
#>
[CmdletBinding()]
param(
    [ValidateSet('Code', 'Insiders', 'Cursor')]
    [string]$Target = 'Code'
)

$ErrorActionPreference = 'Stop'

if ($env:CLAUDE_CONFIG_DIR) {
    $claudeDir = $env:CLAUDE_CONFIG_DIR
} else {
    $claudeDir = Join-Path $HOME '.claude'
}

switch ($Target) {
    'Insiders' { $extensionsRoot = Join-Path $HOME '.vscode-insiders\extensions' }
    'Cursor'   { $extensionsRoot = Join-Path $HOME '.cursor\extensions' }
    default    { $extensionsRoot = Join-Path $HOME '.vscode\extensions' }
}

# --- 1. Status line ---------------------------------------------------------
# Removed only when it is ours. Same code as the extension's "Remove Claude Code Hook".
$repoRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $claudeDir 'settings.json'
if (Get-Command node -ErrorAction SilentlyContinue) {
    $previousConfigDir = $env:CLAUDE_CONFIG_DIR
    $env:CLAUDE_CONFIG_DIR = $claudeDir
    try {
        & node (Join-Path $repoRoot 'src\setup.js') uninstall
    } finally {
        $env:CLAUDE_CONFIG_DIR = $previousConfigDir
    }
} else {
    Write-Host '  [skip] Node.js not found, statusLine left as is' -ForegroundColor Yellow
}

# --- 2. Bridge and cached data ---------------------------------------------
foreach ($leaf in @('claude-stats', 'usage-bridge.json')) {
    $leafPath = Join-Path $claudeDir $leaf
    if (Test-Path $leafPath) {
        Remove-Item $leafPath -Recurse -Force
        Write-Host "  [ok] removed $leaf" -ForegroundColor Green
    }
}

# --- 3. Extension -----------------------------------------------------------
if (Test-Path $extensionsRoot) {
    # Only copies the install script wrote; a Marketplace copy is uninstalled in VS Code.
    Get-ChildItem $extensionsRoot -Directory |
        Where-Object {
            $_.Name -like 'claude-stats.claude-stats-*' -or
            ($_.Name -like 'awmium.claude-stats-*' -and (Test-Path (Join-Path $_.FullName '.claude-stats-source-install')))
        } |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
            Write-Host "  [ok] removed $($_.Name)" -ForegroundColor Green
        }
}

Write-Host ''
Write-Host 'ClaudeStats removed. Restart VS Code to clear the status bar item.' -ForegroundColor Cyan
Write-Host 'A copy installed from the Marketplace is left in place: uninstall it from the'
Write-Host 'Extensions view in VS Code.'
Write-Host "Your original settings backup, if one was made, is at:"
Write-Host "  $settingsPath.claude-stats-backup"
