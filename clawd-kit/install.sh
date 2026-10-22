#!/usr/bin/env bash
# Clawd for Claude Code on macOS, Linux, WSL and Git Bash. Safe to rerun.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dest="$config/mods/clawd"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't on the PATH in this shell. Install it here first, then run this again." >&2
  exit 1
fi

# The mod installs from the config folder as a one-plugin marketplace.
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

# Window colour: a claude wrapper in the shell's start-up file. Old blocks come out of all three first.
zrc="${ZDOTDIR:-$HOME}/.zshrc"
case "$(basename "${SHELL:-bash}")" in
  zsh) rc="$zrc" ;;
  bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  *) rc="" ;;
esac

strip_block() {
  [ -f "$1" ] && grep -q '>>> clawd window colour' "$1" || return 0
  # drop the old block and the blank line above it
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
  # their own claude command stays theirs
  note="$rc already has its own claude command, so the brown window was left out. Clawd and the theme work as usual."
else
  touch "$rc"
  cat >> "$rc" <<'EOF'

# >>> clawd window colour (added by Clawd's install.sh; delete this block to undo)
# Brown while Claude Code runs, in Windows Terminal and VS Code only.
# CLAWD_WINDOW=1 forces it, CLAWD_WINDOW=0 turns it off.
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
