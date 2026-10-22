#!/usr/bin/env bash
# Takes out everything install.sh put in: the mod and its marketplace, the theme, and the window
# colour block in ~/.bashrc, ~/.bash_profile or ~/.zshrc. Nothing else in those files is touched.
set -euo pipefail

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if command -v claude >/dev/null 2>&1; then
  claude plugin uninstall clawd@clawd >/dev/null 2>&1 || true
  claude plugin marketplace remove clawd >/dev/null 2>&1 || true
fi
rm -rf "$config/mods/clawd"
rm -f "$config/themes/clawd.json"

strip_block() {
  [ -f "$1" ] && grep -q '>>> clawd window colour' "$1" || return 0
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
for f in "$HOME/.bashrc" "$HOME/.bash_profile" "${ZDOTDIR:-$HOME}/.zshrc"; do strip_block "$f"; done

echo "Clawd is gone. Open a new terminal tab; if Claude Code still shows the Clawd colours, run /theme and pick another."
