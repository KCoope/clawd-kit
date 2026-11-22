#!/usr/bin/env bash
# Clawd for Claude Code on macOS, Linux, WSL and Git Bash. Safe to rerun.
#   bash install.sh          asks which Clawd
#   bash install.sh orange   the orange Clawd jumping trees
#   bash install.sh blue     the small blue Clawd hopping mountains
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't on the PATH in this shell. Install it here first, then run this again." >&2
  exit 1
fi

# Which Clawd: the argument, else the answer, else the one installed now (orange the first time).
current=orange
if [ -d "$config/mods/clawd-peaks" ]; then current=blue; fi
choice="${1:-}"
if [ -z "$choice" ] && [ -t 0 ]; then
  echo "Which Clawd?"
  echo "  1  orange, jumping trees"
  echo "  2  small and blue, hopping mountains"
  printf 'Type 1 or 2, or press Enter for %s: ' "$current"
  read -r choice || choice=""
fi
choice="$(printf '%s' "${choice:-$current}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
case "$choice" in
  1|orange) mod=clawd; old=clawd-peaks; who="Clawd"; theme="Clawd"; shade="Brown"; tint="#211812"; other=blue ;;
  2|blue) mod=clawd-peaks; old=clawd; who="The blue Clawd"; theme="Clawd Blue"; shade="Navy"; tint="#0f1724"; other=orange ;;
  *) echo "Pick orange or blue, like this: bash install.sh blue" >&2; exit 1 ;;
esac
dest="$config/mods/$mod"
# whole names, since clawd also matches clawd-peaks (GOTCHAS 16); the list is read first, so an
# early grep exit can't cut claude off and fail the pipe
has_market() { local l; l="$(claude plugin marketplace list 2>/dev/null)" || true; grep -Eq "^[[:space:]]*> $1\$" <<< "$l"; }
has_plugin() { local l; l="$(claude plugin list 2>/dev/null)" || true; grep -Eq "^[[:space:]]*> $1@$1\$" <<< "$l"; }

# The other Clawd comes out first: both draw in the same band and answer /clawd.
if has_plugin "$old"; then claude plugin uninstall "$old@$old" >/dev/null; fi
if has_market "$old"; then claude plugin marketplace remove "$old" >/dev/null; fi
rm -rf "$config/mods/$old"

# The mod installs from the config folder as a one-plugin marketplace.
mkdir -p "$config/mods" "$config/themes"
rm -rf "$dest"
cp -R "$here/$mod" "$dest"
if has_market "$mod"; then
  claude plugin marketplace update "$mod"
else
  claude plugin marketplace add "$dest"
fi
if ! has_plugin "$mod"; then
  claude plugin install "$mod@$mod"
fi
cp "$here/clawd-theme.json" "$config/themes/clawd.json"
cp "$here/clawd-blue-theme.json" "$config/themes/clawd-blue.json"

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
  note="Your shell is $(basename "${SHELL:-unknown}"), so the window colour was left out. Clawd and the theme work as usual."
elif [ -f "$rc" ] && grep -Eq '^[[:space:]]*(alias[[:space:]]+claude=|function[[:space:]]+claude([[:space:]]|\{|$)|claude[[:space:]]*\(\))' "$rc"; then
  # their own claude command stays theirs
  note="$rc already has its own claude command, so the window colour was left out. Clawd and the theme work as usual."
else
  touch "$rc"
  sed "s/@SHADE@/$shade/; s/@TINT@/$tint/" >> "$rc" <<'EOF'

# >>> clawd window colour (added by Clawd's install.sh; delete this block to undo)
# @SHADE@ while Claude Code runs, in Windows Terminal and VS Code only.
# CLAWD_WINDOW=1 forces it, CLAWD_WINDOW=0 turns it off.
function claude {
  local tint=0
  if [ -t 1 ] && [ -z "${TMUX:-}" ] && [ "${CLAWD_WINDOW:-}" != 0 ]; then
    if [ -n "${WT_SESSION:-}" ] || [ "${TERM_PROGRAM:-}" = vscode ] || [ "${CLAWD_WINDOW:-}" = 1 ]; then tint=1; fi
  fi
  if [ "$tint" = 1 ]; then printf '\033]11;@TINT@\007'; fi
  command claude "$@"
  local code=$?
  if [ "$tint" = 1 ]; then printf '\033]111\007'; fi
  return $code
}
# <<< clawd window colour
EOF
fi

echo
echo "$who is installed. Open a new terminal tab, type claude, run /theme and pick $theme."
echo "In VS Code, start it in the terminal (View, Terminal). The Claude Code chat panel does not show him."
echo "To switch to the $other Clawd later, run: bash install.sh $other"
if [ -n "$note" ]; then echo "$note"; fi
