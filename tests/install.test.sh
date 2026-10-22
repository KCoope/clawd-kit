#!/usr/bin/env bash
# Runs install.sh and uninstall.sh in throwaway homes: fresh, rerun, an upgrade over the previous
# version, a change of shell, an old-style block, a person's own alias and function, fish, a
# simulated Mac, the wrapper's choice of when to tint, then the uninstall. Needs `claude` on the
# PATH; writes only under a temp folder.
#   bash tests/install.test.sh            (about a minute)
set -u
KIT="$(cd "$(dirname "$0")/../clawd-kit" && pwd)"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
pass=0; fail=0
ok() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
home() { local h="$BASE/$1"; mkdir -p "$h"; echo "$h"; }
# Windows Node CLIs read USERPROFILE, so it moves with HOME; cygpath exists only in Git Bash.
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
in_home() { local h="$1"; shift; env HOME="$h" USERPROFILE="$(winpath "$h")" CLAUDE_CONFIG_DIR="$h/.claude" "$@"; }
run() { # run <home> <shell> <kit folder> <script> [extra env]
  local h="$1" sh="$2" kit="$3" s="$4"; shift 4
  in_home "$h" env SHELL="$sh" "$@" bash "$kit/$s" > "$h/out.txt" 2>&1
}
blocks() { cat "$1" 2>/dev/null | grep -c '>>> clawd window colour'; }
has_plugin() { in_home "$1" claude plugin list 2>/dev/null | grep -q 'clawd@clawd'; }
markets() { in_home "$1" claude plugin marketplace list 2>/dev/null | grep -c '^  > clawd$'; }

h=$(home fresh)
run "$h" /usr/bin/bash "$KIT" install.sh
ok "fresh bash: one block in .bashrc" '[ "$(blocks "$h/.bashrc")" = 1 ]'
ok "fresh bash: .bashrc parses" 'bash -n "$h/.bashrc"'
ok "fresh bash: mod, theme and plugin in place" '[ -f "$h/.claude/mods/clawd/hooks/register.tsx" ] && [ -f "$h/.claude/themes/clawd.json" ] && has_plugin "$h"'
run "$h" /usr/bin/bash "$KIT" install.sh
ok "rerun: still one block, one marketplace, one plugin" '[ "$(blocks "$h/.bashrc")" = 1 ] && [ "$(markets "$h")" = 1 ] && has_plugin "$h"'
ok "rerun: no blank lines pile up" '[ "$(grep -c "^$" "$h/.bashrc")" -le 1 ]'

# An upgrade: the same home, a kit whose mod has changed. Claude Code reads the mod from the folder
# the installer replaces, so the new code is what loads.
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

# The wrapper's choice of when to tint, with the terminal check forced true (no terminal here).
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
ok "uninstall: blocks, mod and theme gone" '[ "$(blocks "$h/.zshrc")" = 0 ] && [ "$(blocks "$h/.bashrc")" = 0 ] && [ ! -e "$h/.claude/mods/clawd" ] && [ ! -e "$h/.claude/themes/clawd.json" ]'
ok "uninstall: plugin and marketplace gone" '! has_plugin "$h" && [ "$(markets "$h")" = 0 ]'
run "$h" /bin/zsh "$KIT" uninstall.sh
ok "uninstall twice: no error" 'grep -q "Clawd is gone" "$h/out.txt"'

echo "install.sh: $pass passed, $fail failed"
[ "$fail" = 0 ]
