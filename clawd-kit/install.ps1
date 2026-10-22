# Clawd for Claude Code, for Windows PowerShell and PowerShell 7: Clawd in falling snow above the
# prompt, the Clawd theme, and a dark brown window while Claude Code runs in Windows Terminal or the
# VS Code terminal. Safe to run again: it replaces what it put there before.
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# -DocumentsDir points the PowerShell profiles somewhere else (for a test run).
param([string]$DocumentsDir = [Environment]::GetFolderPath('MyDocuments'))

if ($IsMacOS -or $IsLinux) { Write-Host 'On macOS and Linux, run install.sh instead: bash install.sh'; exit 1 }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$dest = Join-Path $config 'mods\clawd'

if (-not (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue)) {
  Write-Host "Claude Code isn't on the PATH in this PowerShell. Install it first, then run this again."
  exit 1
}

# The mod lives in the config folder and installs from there as a one-plugin marketplace, so
# Claude Code reads that folder directly.
New-Item -ItemType Directory -Force -Path (Join-Path $config 'mods'), (Join-Path $config 'themes') | Out-Null
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse (Join-Path $here 'clawd') $dest
$markets = (& claude plugin marketplace list 2>$null) -join "`n"
if ($markets -match '\bclawd\b') { & claude plugin marketplace update clawd } else { & claude plugin marketplace add $dest }
if ($LASTEXITCODE -ne 0) { Write-Host 'Adding the Clawd marketplace failed; the lines above say why.'; exit 1 }
$plugins = (& claude plugin list 2>$null) -join "`n"
if ($plugins -notmatch 'clawd@clawd') {
  & claude plugin install clawd@clawd
  if ($LASTEXITCODE -ne 0) { Write-Host 'Installing Clawd failed; the lines above say why.'; exit 1 }
}
Copy-Item -Force (Join-Path $here 'clawd-theme.json') (Join-Path $config 'themes\clawd.json')

# The window colour is a small `claude` wrapper in the PowerShell profile: Windows PowerShell reads
# Documents\WindowsPowerShell\profile.ps1, PowerShell 7 reads Documents\PowerShell\profile.ps1.
$block = @'
# >>> clawd window colour (added by Clawd's install.ps1; delete this block to undo)
# Brown while Claude Code runs, the terminal's own colour back afterwards. Only Windows Terminal and
# VS Code are known to put the colour back, so other terminals are left alone. Set CLAWD_WINDOW to
# 1 to try it anyway, or to 0 to turn it off.
function claude {
  $exe = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exe) { Write-Error 'Claude Code is not on the PATH.'; return }
  $tint = $false
  if ($env:CLAWD_WINDOW -ne '0' -and -not [Console]::IsOutputRedirected) {
    if ($env:WT_SESSION -or $env:TERM_PROGRAM -eq 'vscode' -or $env:CLAWD_WINDOW -eq '1') { $tint = $true }
  }
  if ($tint) { [Console]::Write([char]27 + ']11;#211812' + [char]7) }
  try {
    if ($MyInvocation.ExpectingInput) { $input | & $exe.Source @args } else { & $exe.Source @args }
  } finally {
    if ($tint) { [Console]::Write([char]27 + ']111' + [char]7) }
  }
}
# <<< clawd window colour
'@

# Drops an earlier block and the blank lines just above it, the same way install.sh does.
function Remove-ClawdBlock([string[]]$lines) {
  $out = New-Object System.Collections.Generic.List[string]
  $skip = $false; $blank = 0
  foreach ($l in $lines) {
    if ($l -match '^# >>> clawd window colour') { $skip = $true; $blank = 0; continue }
    if ($skip) { if ($l -match '^# <<< clawd window colour') { $skip = $false }; continue }
    if ($l -eq '') { $blank++; continue }
    while ($blank -gt 0) { $out.Add(''); $blank-- }
    $out.Add($l)
  }
  while ($blank -gt 0) { $out.Add(''); $blank-- }
  return ,$out.ToArray()
}

# Reads a profile in the encoding it was saved in. A file with no byte-order mark and characters
# beyond plain ASCII could be in any code page, so it is left alone rather than risk garbling it.
function Read-ClawdProfile([string]$path) {
  if (-not (Test-Path $path)) { return @{ Text = ''; Enc = (New-Object System.Text.UTF8Encoding $false) } }
  $b = [IO.File]::ReadAllBytes($path)
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { return @{ Text = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3); Enc = (New-Object System.Text.UTF8Encoding $true) } }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { return @{ Text = [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2); Enc = [Text.Encoding]::Unicode } }
  if ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { return @{ Text = [Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2); Enc = [Text.Encoding]::BigEndianUnicode } }
  foreach ($x in $b) { if ($x -gt 127) { return $null } }
  return @{ Text = [Text.Encoding]::ASCII.GetString($b); Enc = (New-Object System.Text.UTF8Encoding $false) }
}

$notes = New-Object System.Collections.Generic.List[string]
$targets = @(Join-Path $DocumentsDir 'WindowsPowerShell\profile.ps1')
if ((Get-Command pwsh -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $DocumentsDir 'PowerShell'))) { $targets += Join-Path $DocumentsDir 'PowerShell\profile.ps1' }
foreach ($p in $targets) {
  $f = Read-ClawdProfile $p
  if ($null -eq $f) { $notes.Add("$p has characters this script can't safely rewrite, so the brown window was left out of it. Paste the block from install.ps1 into it by hand if you want it."); continue }
  $kept = (Remove-ClawdBlock ($f.Text -split "\r?\n")) -join "`r`n"
  # A command of their own named claude stays theirs; the wrapper would replace it or never run.
  if ($kept -match '(?im)^\s*(function\s+(global:)?claude\b|(Set|New)-Alias\s+(-Name\s+)?claude\b)') {
    $notes.Add("$p already has its own claude command, so the brown window was left out. Clawd and the theme work as usual.")
    $text = $kept
  } else {
    $text = $kept.TrimEnd("`r", "`n") + $(if ($kept.Trim()) { "`r`n`r`n" } else { '' }) + ($block -replace "\r?\n", "`r`n")
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
  [IO.File]::WriteAllText($p, $text + "`r`n", $f.Enc)
}

# Profiles only load when scripts are allowed. Running this installer with -ExecutionPolicy Bypass
# changes nothing beyond this one run, so the lasting setting is read without the Process scope.
$policy = 'Undefined'
foreach ($s in 'MachinePolicy', 'UserPolicy', 'CurrentUser', 'LocalMachine') {
  $v = [string](Get-ExecutionPolicy -Scope $s)
  if ($v -ne 'Undefined') { $policy = $v; break }
}
if ($policy -eq 'Undefined') { $policy = 'Restricted' }
if ($policy -eq 'Restricted' -or $policy -eq 'AllSigned') {
  $notes.Add("PowerShell is set to $policy, so it won't load the profile that holds the brown window. To allow it: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned")
}

Write-Host ''
Write-Host 'Clawd is installed. Open a new terminal tab, start Claude Code, run /theme and pick Clawd.'
foreach ($n in $notes) { Write-Host $n }
