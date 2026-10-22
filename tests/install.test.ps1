# install.ps1 and uninstall.ps1 in throwaway folders. Windows only. About two minutes.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\install.test.ps1
$kit = (Resolve-Path (Join-Path $PSScriptRoot '..\clawd-kit')).Path
$Base = Join-Path ([IO.Path]::GetTempPath()) ('clawd-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $Base | Out-Null
$realUser = $env:USERPROFILE; $realHome = $env:HOME; $realConfig = $env:CLAUDE_CONFIG_DIR
$script:pass = 0; $script:fail = 0
function Ok($name, [scriptblock]$test) { $r = $false; try { $r = [bool](& $test) } catch { $r = $false }; if ($r) { "PASS  $name"; $script:pass++ } else { "FAIL  $name"; $script:fail++ } }
function Home($n) { $h = Join-Path $Base $n; New-Item -ItemType Directory -Force (Join-Path $h 'Documents') | Out-Null; $h }
function Use($h) { $env:USERPROFILE = $h; $env:HOME = $h; $env:CLAUDE_CONFIG_DIR = Join-Path $h '.claude' }
function Run($h, $s, $from = $kit) {
  Use $h
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $from $s) -DocumentsDir (Join-Path $h 'Documents') 2>&1 | Out-String
  Set-Content -Path (Join-Path $h 'out.txt') -Value $out
  $out
}
function Prof($h) { Join-Path $h 'Documents\WindowsPowerShell\profile.ps1' }
function Blocks($p) { if (Test-Path $p) { ([regex]::Matches([IO.File]::ReadAllText($p), '>>> clawd window colour')).Count } else { 0 } }
function Parses($p) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e); -not $e }
function HasPlugin($h) { Use $h; ((& claude plugin list 2>$null) -join ' ') -match 'clawd@clawd' }
function Markets($h) { Use $h; @((& claude plugin marketplace list 2>$null) | Where-Object { $_ -match '^\s*> clawd$' }).Count }

try {
  $h = Home 'fresh'
  $o = Run $h 'install.ps1'
  Ok 'fresh: one block in the profile' { (Blocks (Prof $h)) -eq 1 }
  Ok 'fresh: the profile parses' { Parses (Prof $h) }
  Ok 'fresh: mod, theme and plugin in place' { (Test-Path (Join-Path $h '.claude\mods\clawd\hooks\register.tsx')) -and (Test-Path (Join-Path $h '.claude\themes\clawd.json')) -and (HasPlugin $h) }
  $o = Run $h 'install.ps1'
  Ok 'rerun: still one block, one marketplace, one plugin' { (Blocks (Prof $h)) -eq 1 -and (Markets $h) -eq 1 -and (HasPlugin $h) }

  # upgrade: a changed mod over the first install
  $next = Join-Path $Base 'next-kit'; Copy-Item -Recurse $kit $next
  Add-Content -Path (Join-Path $next 'clawd\hooks\register.tsx') -Value '// upgrade marker' -Encoding ascii
  $o = Run $h 'install.ps1' $next
  Ok 'upgrade: the new mod is in place' { [IO.File]::ReadAllText((Join-Path $h '.claude\mods\clawd\hooks\register.tsx')) -match 'upgrade marker' }
  Ok 'upgrade: nothing doubled' { (Blocks (Prof $h)) -eq 1 -and (Markets $h) -eq 1 -and (HasPlugin $h) }

  $h = Home 'bom'
  $p = Prof $h; New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null
  [IO.File]::WriteAllText($p, "Set-Location C:\`r`n`$env:KEEP = 'caf" + [char]0xE9 + "'`r`n", (New-Object System.Text.UTF8Encoding $true))
  $o = Run $h 'install.ps1'
  $b = [IO.File]::ReadAllBytes($p)
  Ok 'UTF-8 profile: byte-order mark kept' { $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF }
  Ok 'UTF-8 profile: their lines kept, accent intact, one block' { ([IO.File]::ReadAllText($p) -match ("KEEP = 'caf" + [char]0xE9 + "'")) -and (Blocks $p) -eq 1 }

  $h = Home 'utf16'
  $p = Prof $h; New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null
  [IO.File]::WriteAllText($p, "Set-Location C:\`r`n", [Text.Encoding]::Unicode)
  $o = Run $h 'install.ps1'
  $b = [IO.File]::ReadAllBytes($p)
  Ok 'UTF-16 profile: stays UTF-16 with its block' { $b[0] -eq 0xFF -and $b[1] -eq 0xFE -and ([Text.Encoding]::Unicode.GetString($b) -match '>>> clawd window colour') }

  $h = Home 'ansi'
  $p = Prof $h; New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null
  [IO.File]::WriteAllBytes($p, [byte[]](0x23, 0x20, 0x63, 0x61, 0x66, 0xE9, 0x0D, 0x0A))
  $before = [IO.File]::ReadAllBytes($p)
  $o = Run $h 'install.ps1'
  Ok 'ANSI profile with an accent: left untouched, and says why' { ([IO.File]::ReadAllBytes($p) -join ',') -eq ($before -join ',') -and $o -match "characters this script can't safely rewrite" }

  $h = Home 'ownfn'
  $p = Prof $h; New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null
  [IO.File]::WriteAllText($p, "function claude { & claude.exe --verbose @args }`r`n")
  $o = Run $h 'install.ps1'
  Ok 'own function: no block, says why' { (Blocks $p) -eq 0 -and $o -match 'already has its own claude command' }

  $h = Home 'ownalias'
  $p = Prof $h; New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null
  [IO.File]::WriteAllText($p, "Set-Alias claude C:\tools\claude.exe`r`n")
  $o = Run $h 'install.ps1'
  Ok 'own alias: no block, Clawd still installed' { (Blocks $p) -eq 0 -and (Test-Path (Join-Path $h '.claude\themes\clawd.json')) }

  # when the wrapper tints, with the console check forced on
  $h = Join-Path $Base 'fresh'
  $fnFile = Join-Path $Base 'fn.ps1'
  [IO.File]::WriteAllText($fnFile, ([IO.File]::ReadAllText((Prof $h)) -replace '-not \[Console\]::IsOutputRedirected', '$true'))
  function Tint($envs) {
    $set = ($envs.GetEnumerator() | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)';" }) -join ' '
    $o = & powershell.exe -NoProfile -Command "Remove-Item env:WT_SESSION, env:TERM_PROGRAM, env:CLAWD_WINDOW -ErrorAction SilentlyContinue; $set . '$fnFile'; claude --version | Out-Null" | Out-String
    $o.Contains([string][char]27 + ']11;')
  }
  Ok 'tints in Windows Terminal' { Tint @{ WT_SESSION = 'x' } }
  Ok 'tints in VS Code' { Tint @{ TERM_PROGRAM = 'vscode' } }
  Ok 'leaves the classic console alone' { -not (Tint @{}) }
  Ok 'CLAWD_WINDOW=0 turns it off' { -not (Tint @{ WT_SESSION = 'x'; CLAWD_WINDOW = '0' }) }
  Ok 'CLAWD_WINDOW=1 forces it' { Tint @{ CLAWD_WINDOW = '1' } }
  $codes = Join-Path $Base 'codes.ps1'
  Set-Content -Path $codes -Encoding ascii -Value @(
    ". '$fnFile'",
    'claude --version | Out-Null; $a = $LASTEXITCODE',
    'claude --no-such-flag 2>$null | Out-Null; $b = $LASTEXITCODE',
    "'x' | claude --version | Out-Null; `$c = `$LASTEXITCODE",
    '"$a $b $c"')
  $exitCodes = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $codes | Out-String).Trim()
  Ok "keeps exit codes and takes piped input ($exitCodes)" { $exitCodes -match '^0 [1-9]\d* 0$' }

  $h = Join-Path $Base 'bom'
  $o = Run $h 'uninstall.ps1'
  $p = Prof $h; $b = [IO.File]::ReadAllBytes($p)
  Ok 'uninstall: block gone, their lines and mark kept' { (Blocks $p) -eq 0 -and $b[0] -eq 0xEF -and ([IO.File]::ReadAllText($p) -match 'KEEP') }
  Ok 'uninstall: mod, theme, plugin and marketplace gone' { -not (Test-Path (Join-Path $h '.claude\mods\clawd')) -and -not (Test-Path (Join-Path $h '.claude\themes\clawd.json')) -and -not (HasPlugin $h) -and (Markets $h) -eq 0 }
  $o = Run $h 'uninstall.ps1'
  Ok 'uninstall twice: no error' { $o -match 'Clawd is gone' }
} finally {
  $env:USERPROFILE = $realUser; $env:HOME = $realHome
  if ($realConfig) { $env:CLAUDE_CONFIG_DIR = $realConfig } else { Remove-Item env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $Base -ErrorAction SilentlyContinue
}
"install.ps1: $script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
