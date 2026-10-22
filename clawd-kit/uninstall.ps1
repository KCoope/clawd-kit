# Removes what install.ps1 added: the mod, its marketplace, the theme and the window block.
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
param([string]$DocumentsDir = [Environment]::GetFolderPath('MyDocuments'))

$config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
if (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue) {
  & claude plugin uninstall clawd@clawd 2>$null | Out-Null
  & claude plugin marketplace remove clawd 2>$null | Out-Null
}
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $config 'mods\clawd'), (Join-Path $config 'themes\clawd.json')

foreach ($p in (Join-Path $DocumentsDir 'WindowsPowerShell\profile.ps1'), (Join-Path $DocumentsDir 'PowerShell\profile.ps1')) {
  if (-not (Test-Path $p)) { continue }
  $b = [IO.File]::ReadAllBytes($p)
  $enc = New-Object System.Text.UTF8Encoding $false; $skipBytes = 0
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $enc = New-Object System.Text.UTF8Encoding $true; $skipBytes = 3 }
  elseif ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $enc = [Text.Encoding]::Unicode; $skipBytes = 2 }
  elseif ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { $enc = [Text.Encoding]::BigEndianUnicode; $skipBytes = 2 }
  elseif ($b | Where-Object { $_ -gt 127 } | Select-Object -First 1) { Write-Host "$p has characters this script can't safely rewrite; delete its clawd window colour block by hand."; continue }
  $text = $enc.GetString($b, $skipBytes, $b.Length - $skipBytes)
  if ($text -notmatch '# >>> clawd window colour') { continue }
  $out = New-Object System.Collections.Generic.List[string]
  $skip = $false; $blank = 0
  foreach ($l in ($text -split "\r?\n")) {
    if ($l -match '^# >>> clawd window colour') { $skip = $true; $blank = 0; continue }
    if ($skip) { if ($l -match '^# <<< clawd window colour') { $skip = $false }; continue }
    if ($l -eq '') { $blank++; continue }
    while ($blank -gt 0) { $out.Add(''); $blank-- }
    $out.Add($l)
  }
  [IO.File]::WriteAllText($p, (($out -join "`r`n").TrimEnd("`r", "`n") + "`r`n"), $enc)
}

Write-Host 'Clawd is gone. Open a new terminal tab; if Claude Code still shows the Clawd colours, run /theme and pick another.'
