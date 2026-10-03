#Requires -Version 5.1
<#
.SYNOPSIS
    Removes ClaudeStat: the status line registration, the bridge, and the extension.
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
$settingsPath = Join-Path $claudeDir 'settings.json'
if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw
    $raw = $raw -replace "^$([char]0xFEFF)", ''
    $settings = $raw | ConvertFrom-Json
    $statusLine = $settings.PSObject.Properties['statusLine']
    if ($statusLine -and $statusLine.Value -and
        [string]$statusLine.Value.command -like '*statusline-usage.js*') {
        $settings.PSObject.Properties.Remove('statusLine')
        $json = $settings | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host '  [ok] statusLine removed' -ForegroundColor Green
    } else {
        Write-Host '  [skip] statusLine is not ClaudeStat, left as is' -ForegroundColor Yellow
    }
}

# --- 2. Bridge and cached data ---------------------------------------------
foreach ($leaf in @('claude-stat', 'usage-bridge.json')) {
    $leafPath = Join-Path $claudeDir $leaf
    if (Test-Path $leafPath) {
        Remove-Item $leafPath -Recurse -Force
        Write-Host "  [ok] removed $leaf" -ForegroundColor Green
    }
}

# --- 3. Extension -----------------------------------------------------------
if (Test-Path $extensionsRoot) {
    Get-ChildItem $extensionsRoot -Directory -Filter 'claude-stat.claude-stat-*' | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force
        Write-Host "  [ok] removed $($_.Name)" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'ClaudeStat removed. Restart VS Code to clear the status bar item.' -ForegroundColor Cyan
Write-Host "Your original settings backup, if one was made, is at:"
Write-Host "  $settingsPath.claude-stat-backup"
