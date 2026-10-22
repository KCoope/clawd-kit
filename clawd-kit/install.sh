#!/usr/bin/env bash
# Clawd for Claude Code: Clawd in falling snow above the prompt, the Clawd theme, and a dark brown
# window while Claude Code runs. For macOS, Linux, WSL and Git Bash; in Windows PowerShell, use
# install.ps1. Safe to run again: it replaces what it put there before.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dest="$config/mods/clawd"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't on the PATH in this shell. Install it here first, then run this again." >&2
  exit 1
fi

# The mod lives in the config folder and installs from there as a one-plugin marketplace, so
# Claude Code reads that folder directly.
mkdir -p "$config/mods" "$config/themes"
rm -rf "$dest"
cp -R "$here/clawd" "$dest"
if claude plugin marketplace list 2>/dev/null | grep -qw clawd; then
  claude plugin marketplace update clawd
else
  claude plugin marketplace add "$dest"
fi
if ! claude plugin list 2>/dev/null | grep -q 'clawd@clawd'; then
  claude plugin install clawd@clawd
fi
cp "$here/clawd-theme.json" "$config/themes/clawd.json"

# The window colour is a small `claude` wrapper in the start-up file of the shell this person uses:
# zsh (the macOS default) reads ~/.zshrc, bash on macOS reads ~/.bash_profile, bash elsewhere
# ~/.bashrc. Any block an earlier version added is taken out of all three first, so a rerun or a
# change of shell leaves exactly one.
zrc="${ZDOTDIR:-$HOME}/.zshrc"
case "$(basename "${SHELL:-bash}")" in
  zsh) rc="$zrc" ;;
  bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  *) rc="" ;;
esac

strip_block() {
  [ -f "$1" ] && grep -q '>>> clawd window colour' "$1" || return 0
  # Blank lines wait to be printed, so the one written above the old block goes with it.
  awk '
    /^# >>> clawd window colour/ { skip = 1; blank = 0; next }
    skip { if (/^# <<< clawd window colour/) skip = 0; next }
    /^$/ { blank++; next }
    { while (blank > 0) { print ""; blank-- } print }
    END { while (blank > 0) { print ""; blank-- } }
  ' "$1" > "$1.clawd-tmp"
  cat "$1.clawd-tmp" > "$1"
  rm -f "$1.clawd-tmp"
}
for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$zrc"; do strip_block "$f"; done

note=""
if [ -z "$rc" ]; then
  note="Your shell is $(basename "${SHELL:-unknown}"), so the brown window was left out. Clawd and the theme work as usual."
elif [ -f "$rc" ] && grep -Eq '^[[:space:]]*(alias[[:space:]]+claude=|function[[:space:]]+claude([[:space:]]|\{|$)|claude[[:space:]]*\(\))' "$rc"; then
  # A command of their own named claude stays theirs; the wrapper would replace it or never run.
  note="$rc already has its own claude command, so the brown window was left out. Clawd and the theme work as usual."
else
  touch "$rc"
  cat >> "$rc" <<'EOF'

# >>> clawd window colour (added by Clawd's install.sh; delete this block to undo)
# Brown while Claude Code runs, the terminal's own colour back afterwards. Only Windows Terminal and
# VS Code are known to put the colour back, so other terminals are left alone. CLAWD_WINDOW=1 tries
# it anyway; CLAWD_WINDOW=0 turns it off.
function claude {
  local tint=0
  if [ -t 1 ] && [ -z "${TMUX:-}" ] && [ "${CLAWD_WINDOW:-}" != 0 ]; then
    if [ -n "${WT_SESSION:-}" ] || [ "${TERM_PROGRAM:-}" = vscode ] || [ "${CLAWD_WINDOW:-}" = 1 ]; then tint=1; fi
  fi
  if [ "$tint" = 1 ]; then printf '\033]11;#211812\007'; fi
  command claude "$@"
  local code=$?
  if [ "$tint" = 1 ]; then printf '\033]111\007'; fi
  return $code
}
# <<< clawd window colour
EOF
fi

echo
echo "Clawd is installed. Open a new terminal tab, start Claude Code, run /theme and pick Clawd."
if [ -n "$note" ]; then echo "$note"; fi
