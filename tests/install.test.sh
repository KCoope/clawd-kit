#!/usr/bin/env bash
# install.sh and uninstall.sh in throwaway homes. Needs claude on the PATH. About 1.5 minutes.
#   bash tests/install.test.sh
set -u
KIT="$(cd "$(dirname "$0")/../clawd-kit" && pwd)"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
pass=0; fail=0
ok() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
home() { local h="$BASE/$1"; mkdir -p "$h"; echo "$h"; }
# Windows CLIs read USERPROFILE; cygpath is Git Bash only
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
in_home() { local h="$1"; shift; env HOME="$h" USERPROFILE="$(winpath "$h")" CLAUDE_CONFIG_DIR="$h/.claude" "$@"; }
run() { # run <home> <shell> <kit folder> <script> [extra env]; no terminal, so no question (GOTCHAS 17)
  local h="$1" sh="$2" kit="$3" s="$4"; shift 4
  in_home "$h" env SHELL="$sh" "$@" bash "$kit/$s" > "$h/out.txt" 2>&1 < /dev/null
}
pick() { # pick <home> <choice>: install.sh with bash, exit code in <home>/code
  in_home "$1" env SHELL=/usr/bin/bash bash "$KIT/install.sh" "$2" > "$1/out.txt" 2>&1 < /dev/null; echo $? > "$1/code"
}
blocks() { cat "$1" 2>/dev/null | grep -c '>>> clawd window colour'; }
has_plugin() { in_home "$1" claude plugin list 2>/dev/null | grep -q 'clawd@clawd'; }
markets() { in_home "$1" claude plugin marketplace list 2>/dev/null | grep -c '^  > clawd$'; }
clawds() { # the Clawd folders, plugins and marketplaces in a home, on one line
  local p m
  p=$(in_home "$1" claude plugin list 2>/dev/null | sed -n 's/^  > \(clawd[a-z-]*\)@.*/\1/p' | sort | tr '\n' ' ')
  m=$(in_home "$1" claude plugin marketplace list 2>/dev/null | sed -n 's/^  > \(clawd[a-z-]*\)$/\1/p' | sort | tr '\n' ' ')
  echo "mods: $(cd "$1/.claude/mods" 2>/dev/null && ls -d clawd* 2>/dev/null | tr '\n' ' ')| plugins: $p| markets: $m"
}
ORANGE='mods: clawd | plugins: clawd | markets: clawd '
BLUE='mods: clawd-peaks | plugins: clawd-peaks | markets: clawd-peaks '

h=$(home fresh)
run "$h" /usr/bin/bash "$KIT" install.sh
ok "fresh bash: one block in .bashrc" '[ "$(blocks "$h/.bashrc")" = 1 ]'
ok "fresh bash: .bashrc parses" 'bash -n "$h/.bashrc"'
ok "fresh bash: orange mod, both themes and plugin in place, says to pick Clawd" '[ -f "$h/.claude/mods/clawd/hooks/register.tsx" ] && [ -f "$h/.claude/themes/clawd.json" ] && [ -f "$h/.claude/themes/clawd-blue.json" ] && [ "$(clawds "$h")" = "$ORANGE" ] && grep -q "pick Clawd\.$" "$h/out.txt"'
run "$h" /usr/bin/bash "$KIT" install.sh
ok "rerun: still one block, one marketplace, one plugin" '[ "$(blocks "$h/.bashrc")" = 1 ] && [ "$(markets "$h")" = 1 ] && has_plugin "$h"'
ok "rerun: no blank lines pile up" '[ "$(grep -c "^$" "$h/.bashrc")" -le 1 ]'

# upgrade: a changed mod over the first install
next="$BASE/next-kit"; cp -R "$KIT" "$next"; printf '\n// upgrade marker\n' >> "$next/clawd/hooks/register.tsx"
run "$h" /usr/bin/bash "$next" install.sh
ok "upgrade: the new mod is in place" 'grep -q "upgrade marker" "$h/.claude/mods/clawd/hooks/register.tsx"'
ok "upgrade: nothing doubled" '[ "$(blocks "$h/.bashrc")" = 1 ] && [ "$(markets "$h")" = 1 ] && has_plugin "$h"'

run "$h" /bin/zsh "$KIT" install.sh
ok "switch to zsh: block moves to .zshrc" '[ "$(blocks "$h/.zshrc")" = 1 ] && [ "$(blocks "$h/.bashrc")" = 0 ]'
ok "zsh block avoids zsh's read-only status variable" '! grep -q "local status" "$h/.zshrc"'

h=$(home old)
printf 'export KEEP=1\n\n# >>> clawd window colour (added by Clawd'"'"'s install.sh; delete this block to undo)\nfunction claude {\n  [ -t 1 ] && printf '"'"'\\033]11;#211812\\007'"'"'\n  command claude "$@"\n  local status=$?\n  [ -t 1 ] && printf '"'"'\\033]111\\007'"'"'\n  return $status\n}\n# <<< clawd window colour\n' > "$h/.bashrc"
run "$h" /usr/bin/bash "$KIT" install.sh
ok "old-style block: replaced by one new block" '[ "$(blocks "$h/.bashrc")" = 1 ] && ! grep -q "local status" "$h/.bashrc" && grep -q "WT_SESSION" "$h/.bashrc"'
ok "old-style block: their own lines kept" 'grep -q "^export KEEP=1$" "$h/.bashrc"'

h=$(home alias)
printf "alias claude='claude --model opus'\n" > "$h/.bashrc"
run "$h" /usr/bin/bash "$KIT" install.sh
ok "own alias: no block added, and says why" '[ "$(blocks "$h/.bashrc")" = 0 ] && grep -q "already has its own claude command" "$h/out.txt"'
ok "own alias: still installed Clawd" '[ -f "$h/.claude/themes/clawd.json" ]'

h=$(home func)
printf 'claude() { command claude --verbose "$@"; }\n' > "$h/.zshrc"
run "$h" /bin/zsh "$KIT" install.sh
ok "own function: no block added, and says why" '[ "$(blocks "$h/.zshrc")" = 0 ] && grep -q "already has its own claude command" "$h/out.txt"'

h=$(home fish)
run "$h" /usr/bin/fish "$KIT" install.sh
ok "fish: no block anywhere, and says why" '[ ! -f "$h/.bashrc" ] && [ ! -f "$h/.zshrc" ] && grep -q "shell is fish" "$h/out.txt"'

h=$(home mac)
mkdir -p "$h/bin"; printf '#!/bin/sh\necho Darwin\n' > "$h/bin/uname"; chmod +x "$h/bin/uname"
run "$h" /bin/bash "$KIT" install.sh PATH="$h/bin:$PATH"
ok "Mac with bash: block in .bash_profile" '[ "$(blocks "$h/.bash_profile")" = 1 ] && [ ! -f "$h/.bashrc" ]'

# the blue Clawd, and switching between them
h=$(home blue)
pick "$h" blue
ok "blue: only the blue mod, plugin and marketplace" '[ "$(cat "$h/code")" = 0 ] && [ "$(clawds "$h")" = "$BLUE" ]'
ok "blue: one navy block, both themes, says to pick Clawd Blue and how to switch" '[ "$(blocks "$h/.bashrc")" = 1 ] && grep -q "11;#0f1724" "$h/.bashrc" && grep -q "^# Navy while" "$h/.bashrc" && ! grep -q 211812 "$h/.bashrc" && [ -f "$h/.claude/themes/clawd.json" ] && grep -q "pick Clawd Blue\.$" "$h/out.txt" && grep -q "run: bash install.sh orange$" "$h/out.txt"'
run "$h" /usr/bin/bash "$KIT" install.sh
ok "blue, rerun with no choice: stays blue" 'grep -q "is installed" "$h/out.txt" && ! grep -q Failed "$h/out.txt" && [ "$(clawds "$h")" = "$BLUE" ] && grep -q "11;#0f1724" "$h/.bashrc" && [ "$(blocks "$h/.bashrc")" = 1 ]'
pick "$h" orange
ok "switch to orange: only orange left, brown block" '[ "$(cat "$h/code")" = 0 ] && [ "$(clawds "$h")" = "$ORANGE" ] && grep -q "11;#211812" "$h/.bashrc" && [ "$(blocks "$h/.bashrc")" = 1 ]'
pick "$h" Blue
ok "switch back, in capitals: only blue left" '[ "$(cat "$h/code")" = 0 ] && [ "$(clawds "$h")" = "$BLUE" ]'
pick "$h" green
ok "a word that is not orange or blue: stops, says so, changes nothing" '[ "$(cat "$h/code")" = 1 ] && grep -q "Pick orange or blue" "$h/out.txt" && [ "$(clawds "$h")" = "$BLUE" ]'

# the question, with the terminal check forced on
ask="$BASE/ask-kit"; cp -R "$KIT" "$ask"
sed 's/\[ -z "\$choice" \] && \[ -t 0 \]/[ -z "$choice" ]/' "$KIT/install.sh" > "$ask/install.sh"
answer() { printf '%s\n' "$2" | in_home "$1" env SHELL=/usr/bin/bash bash "$ask/install.sh" > "$1/out.txt" 2>&1; }
h=$(home ask)
answer "$h" ""
ok "question: asked, and Enter the first time gives orange" 'grep -q "is installed" "$h/out.txt" && ! grep -q "\[ -t 0 \]" "$ask/install.sh" && grep -q "Which Clawd?" "$h/out.txt" && grep -q "press Enter for orange" "$h/out.txt" && [ "$(clawds "$h")" = "$ORANGE" ]'
answer "$h" 2
ok "question: 2 gives blue" 'grep -q "is installed" "$h/out.txt" && [ "$(clawds "$h")" = "$BLUE" ]'
answer "$h" ""
ok "question: Enter keeps the one installed" 'grep -q "is installed" "$h/out.txt" && grep -q "press Enter for blue" "$h/out.txt" && [ "$(clawds "$h")" = "$BLUE" ]'

# when the wrapper tints, with the terminal check forced on
h=$(home logic)
run "$h" /usr/bin/bash "$KIT" install.sh
sed -n '/^function claude {/,/^}/p' "$h/.bashrc" | sed 's/\[ -t 1 \]/true/; s/command claude "\$@"/true/' > "$h/fn.sh"
tint() { env -u WT_SESSION -u TERM_PROGRAM -u CLAWD_WINDOW -u TMUX "$@" bash -c ". '$h/fn.sh'; claude" | od -c | grep -c '1   1   ;'; }
ok "tints in Windows Terminal" '[ "$(tint WT_SESSION=x)" -ge 1 ]'
ok "tints in VS Code" '[ "$(tint TERM_PROGRAM=vscode)" -ge 1 ]'
ok "leaves Terminal.app alone" '[ "$(tint TERM_PROGRAM=Apple_Terminal)" = 0 ]'
ok "leaves tmux alone" '[ "$(tint WT_SESSION=x TMUX=1)" = 0 ]'
ok "CLAWD_WINDOW=0 turns it off" '[ "$(tint WT_SESSION=x CLAWD_WINDOW=0)" = 0 ]'
ok "CLAWD_WINDOW=1 forces it" '[ "$(tint TERM_PROGRAM=Apple_Terminal CLAWD_WINDOW=1)" -ge 1 ]'
ok "keeps the exit code" 'bash -c ". \"$h/.bashrc\"; claude --version >/dev/null; exit \$?"'

h=$BASE/fresh
run "$h" /bin/zsh "$KIT" uninstall.sh
ok "uninstall: blocks, mod and both themes gone" '[ "$(blocks "$h/.zshrc")" = 0 ] && [ "$(blocks "$h/.bashrc")" = 0 ] && [ ! -e "$h/.claude/mods/clawd" ] && [ ! -e "$h/.claude/themes/clawd.json" ] && [ ! -e "$h/.claude/themes/clawd-blue.json" ]'
ok "uninstall: plugin and marketplace gone" '! has_plugin "$h" && [ "$(markets "$h")" = 0 ]'
run "$h" /bin/zsh "$KIT" uninstall.sh
ok "uninstall twice: no error" 'grep -q "Clawd is gone" "$h/out.txt"'
h=$BASE/blue
run "$h" /usr/bin/bash "$KIT" uninstall.sh
ok "uninstall the blue one: no Clawd, theme or block left" '[ "$(clawds "$h")" = "mods: | plugins: | markets: " ] && [ ! -e "$h/.claude/themes/clawd-blue.json" ] && [ "$(blocks "$h/.bashrc")" = 0 ]'

echo "install.sh: $pass passed, $fail failed"
[ "$fail" = 0 ]
