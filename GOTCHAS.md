# Gotchas: read before changing this project

One entry per trap that cost time, written as a trip-wire: what breaks, how to spot it, the fix,
and the date. Number them; cite the number from the code that the trap touches.

1. **A Button under the pointer or the focus is drawn inverted.** On block art that reads as chunks
   of Clawd missing, and no prop turns it off. His rows are `Client` regions (`hooks/clawd-sprite.tsx`)
   drawing plain Text that post a press. A test fails if a Button ever wraps him again. (2026-10-22)
2. **A hidden band's timer can't be counted in the test suite.** The kit allows one hook per event
   and `mock.clock` owns `clock.every`; a hidden tick writes no state. Prove a timer change with a
   throwaway copy that counts ticks and reports them through `/clawd`'s reply. Hidden, the old code
   ticked 6,666 times in ten minutes; it now stops after one. (2026-10-22)
3. **The plugins cache keeps a stale copy after an upgrade, and nothing loads it.** A folder
   marketplace's plugin is read from that folder (`~/.claude/mods/clawd`, which the installer
   replaces): the debug log says `Read hooks.json for plugin clawd ... mods\clawd`. Don't "fix" the
   cache copy. (2026-10-22)
4. **zsh's `$status` is read-only,** so `local status=$?` breaks the wrapper in zsh. The block uses
   `local code`. (2026-10-22)
5. **Apple Terminal.app takes OSC 11 (set the background) and ignores OSC 111 (put it back),** so a
   Mac window stayed brown. The wrapper tints only in Windows Terminal (`WT_SESSION`) and VS Code
   (`TERM_PROGRAM=vscode`); `CLAWD_WINDOW=1` forces it. (2026-10-22)
6. **Windows PowerShell 5.1 reads a file with no byte-order mark as ANSI.** Keep the `.ps1` files
   ASCII (`./check` fails otherwise). A profile is rewritten in its own encoding, and one with no mark
   and non-ASCII bytes is left alone. (2026-10-22)
7. **A checkout that turns LF into CRLF breaks `install.sh` in bash** (`$'\r': command not found`).
   `.gitattributes` keeps every text file LF. (2026-10-22)
8. **In the PowerShell test helper, a scriptblock sees the helper's variables first** (dynamic
   scope): a test that read `$r` got the helper's own `$r` and failed on a right answer. Name test
   values so they can't collide. (2026-10-22)
9. **A test's `on(...)` hooks must come before its first `$` call;** later ones are refused. (2026-10-22)
10. **On Windows, `command -v python3` can find the Microsoft Store's install prompt,** which exits
    49, so `./check` died and the pre-push hook refused the first push. `check` runs each candidate
    and keeps the first real Python 3. Run `./check` after every change to it. (2026-10-22)
11. **A click in classic mode stays with the terminal.** It turns into a one-cell text selection and
    the mod never hears it (seen in mintty). Fullscreen mode (`/tui fullscreen`) routes clicks to the
    mod. The install README tells people. (2026-11-22)
12. **Idle hops leave his sleep timer alone.** A hop that reset the quiet counter kept him awake for
    good. `jump(seq, wake)` takes `wake = false` for idle hops; the sleep test caught it. (2026-11-22)
13. **A terminal cell shows two colours at most:** its glyph's and its background. A tree pixel grid
    that puts three in one 2 x 2 cell (pine, trunk and nothing, say) cannot be drawn; `treeShape`
    refuses it at load, so every test fails at once. Keep the trunk under a whole cell, which means
    an odd number of cells wide. (2026-11-22)
14. **The test kit's `find({ type: 'Text', in: 'clawd-0' })` throws when that region is absent;** it
    does not return undefined. A crouch drops his top row and the top of a jump drops his legs row,
    so look up the row's Box first (`rowBox`) and read its text only when it is there. (2026-11-22)
15. **A test past 5 seconds fails as if broken.** The test kit gives each test 5000 ms unless it
    passes `{ timeoutMs }`; the nap and tree tests run thousands of ticks (2 to 4 s alone) and hit
    7.0 s and 6.4 s on a busy machine. They take `LONG` (30 s). A failure that names a long test
    and does not repeat on the next run is this. (2026-11-22)
