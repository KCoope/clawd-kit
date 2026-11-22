# install.ps1 and uninstall.ps1 in throwaway folders. Windows only. About 1.5 minutes.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\install.test.ps1
$kit = (Resolve-Path (Join-Path $PSScriptRoot '..\clawd-kit')).Path
$Base = Join-Path ([IO.Path]::GetTempPath()) ('clawd-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $Base | Out-Null
$realUser = $env:USERPROFILE; $realHome = $env:HOME; $realConfig = $env:CLAUDE_CONFIG_DIR
$script:pass = 0; $script:fail = 0
function Ok($name, [scriptblock]$test) { $r = $false; try { $r = [bool](& $test) } catch { $r = $false }; if ($r) { "PASS  $name"; $script:pass++ } else { "FAIL  $name"; $script:fail++ } }
function Home($n) { $h = Join-Path $Base $n; New-Item -ItemType Directory -Force (Join-Path $h 'Documents') | Out-Null; $h }
function Use($h) { $env:USERPROFILE = $h; $env:HOME = $h; $env:CLAUDE_CONFIG_DIR = Join-Path $h '.claude' }
# Input is always piped, so the installer never waits at its question (GOTCHAS 17); $answer is what it reads.
function Run($h, $s, $from = $kit, $choice = '', $answer = '') {
  Use $h
  $extra = @(); if ($choice) { $extra = @('-Clawd', $choice) }
  $out = $answer | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $from $s) @extra -DocumentsDir (Join-Path $h 'Documents') 2>&1 | Out-String
  $script:code = $LASTEXITCODE
  Set-Content -Path (Join-Path $h 'out.txt') -Value $out
  $out
}
# The Clawd folders, plugins and marketplaces in a home, on one line.
function Clawds($h) {
  Use $h
  $p = @((& claude plugin list 2>$null) | ForEach-Object { if ($_ -match '^\s*> (clawd[a-z-]*)@') { $Matches[1] } } | Sort-Object) -join ' '
  $m = @((& claude plugin marketplace list 2>$null) | ForEach-Object { if ($_ -match '^\s*> (clawd[a-z-]*)\s*$') { $Matches[1] } } | Sort-Object) -join ' '
  $d = @(Get-ChildItem -Directory (Join-Path $h '.claude\mods') -Filter 'clawd*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object) -join ' '
  "mods: $d | plugins: $p | markets: $m"
}
$Orange = 'mods: clawd | plugins: clawd | markets: clawd'
$Blue = 'mods: clawd-peaks | plugins: clawd-peaks | markets: clawd-peaks'
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
  Ok 'fresh: orange mod, both themes and plugin in place, says to pick Clawd' { (Test-Path (Join-Path $h '.claude\mods\clawd\hooks\register.tsx')) -and (Test-Path (Join-Path $h '.claude\themes\clawd.json')) -and (Test-Path (Join-Path $h '.claude\themes\clawd-blue.json')) -and (Clawds $h) -eq $Orange -and $o -match 'pick Clawd\.' }
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

  # the blue Clawd, and switching between them
  $h = Home 'blue'
  $p = Prof $h
  $o = Run $h 'install.ps1' $kit 'blue'
  Ok 'blue: only the blue mod, plugin and marketplace' { $script:code -eq 0 -and (Clawds $h) -eq $Blue }
  # the switch hint is the full command: a bare .\install.ps1 is refused under the default execution policy
  Ok 'blue: one navy block, both themes, says to pick Clawd Blue and how to switch' { $t = [IO.File]::ReadAllText($p); (Blocks $p) -eq 1 -and $t.Contains(']11;#0f1724') -and $t -match '(?m)^# Navy while' -and -not $t.Contains('211812') -and (Test-Path (Join-Path $h '.claude\themes\clawd.json')) -and $o -match 'pick Clawd Blue\.' -and $o -match 'run: powershell -NoProfile -ExecutionPolicy Bypass -File \.\\install\.ps1 orange' }
  $o = Run $h 'install.ps1'
  Ok 'blue, rerun with no choice: stays blue' { $script:code -eq 0 -and $o -notmatch 'Failed' -and (Clawds $h) -eq $Blue -and [IO.File]::ReadAllText($p).Contains(']11;#0f1724') -and (Blocks $p) -eq 1 }
  $o = Run $h 'install.ps1' $kit 'orange'
  Ok 'switch to orange: only orange left, brown block' { $script:code -eq 0 -and (Clawds $h) -eq $Orange -and [IO.File]::ReadAllText($p).Contains(']11;#211812') -and (Blocks $p) -eq 1 }
  $o = Run $h 'install.ps1' $kit 'Blue'
  Ok 'switch back, in capitals: only blue left' { $script:code -eq 0 -and (Clawds $h) -eq $Blue }
  $o = Run $h 'install.ps1' $kit 'green'
  Ok 'a word that is not orange or blue: stops, says so, changes nothing' { $script:code -eq 1 -and $o -match 'Pick orange or blue, like this: powershell -NoProfile -ExecutionPolicy Bypass -File \.\\install\.ps1 blue' -and (Clawds $h) -eq $Blue }

  # the question, with the console check forced on; Read-Host takes the piped answer
  $ask = Join-Path $Base 'ask-kit'; Copy-Item -Recurse $kit $ask
  $src = [IO.File]::ReadAllText((Join-Path $kit 'install.ps1'))
  [IO.File]::WriteAllText((Join-Path $ask 'install.ps1'), $src.Replace('-not $Clawd -and -not [Console]::IsInputRedirected', '-not $Clawd'))
  $h = Home 'ask'
  $o = Run $h 'install.ps1' $ask '' ''
  Ok 'question: asked, and Enter the first time gives orange' { $script:code -eq 0 -and -not [IO.File]::ReadAllText((Join-Path $ask 'install.ps1')).Contains('IsInputRedirected') -and $o -match 'Which Clawd\?' -and (Clawds $h) -eq $Orange }
  $o = Run $h 'install.ps1' $ask '' '2'
  Ok 'question: 2 gives blue' { $script:code -eq 0 -and (Clawds $h) -eq $Blue }
  $o = Run $h 'install.ps1' $ask '' ''
  Ok 'question: Enter keeps the one installed' { $script:code -eq 0 -and $o -match 'Which Clawd\?' -and (Clawds $h) -eq $Blue }

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
  Ok 'uninstall: mod, both themes, plugin and marketplace gone' { -not (Test-Path (Join-Path $h '.claude\mods\clawd')) -and -not (Test-Path (Join-Path $h '.claude\themes\clawd.json')) -and -not (Test-Path (Join-Path $h '.claude\themes\clawd-blue.json')) -and -not (HasPlugin $h) -and (Markets $h) -eq 0 }
  $o = Run $h 'uninstall.ps1'
  Ok 'uninstall twice: no error' { $o -match 'Clawd is gone' }
  $h = Join-Path $Base 'blue'
  $o = Run $h 'uninstall.ps1'
  Ok 'uninstall the blue one: no Clawd, theme or block left' { (Clawds $h) -eq 'mods:  | plugins:  | markets: ' -and -not (Test-Path (Join-Path $h '.claude\themes\clawd-blue.json')) -and (Blocks (Prof $h)) -eq 0 }
} finally {
  $env:USERPROFILE = $realUser; $env:HOME = $realHome
  if ($realConfig) { $env:CLAUDE_CONFIG_DIR = $realConfig } else { Remove-Item env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $Base -ErrorAction SilentlyContinue
}
"install.ps1: $script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
