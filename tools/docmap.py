"""Regenerate the map in this project's CLAUDE.md and check the docs for rot.

    python tools/docmap.py            check only, exits 1 on problems
    python tools/docmap.py --write    regenerate the map block, then check

Checks: the map block matches a fresh build; every top-level path (and in REPO when set) has a
description; every file CLAUDE.md names exists; the hand-written part stays an index.
Adapted from the studio's standard map checker.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# A nested repo folder whose top level also gets a table, or None when the project root is the repo.
REPO = None
CLAUDE = os.path.join(ROOT, "CLAUDE.md")
BEGIN, END = "<!-- MAP:BEGIN -->", "<!-- MAP:END -->"
HAND_MAX_LINES = 120

DESCRIBED = {
    "clawd-kit": "everything that ships: the mod, theme, installers, uninstallers and the README people read",
    "docs": "the README's pictures: running.gif and idle.png, cropped to the band",
    "tests": "the installers' tests, run in throwaway homes",
    "tools": "docmap.py (this checker) and make-zip.py (builds and checks clawd-kit.zip)",
    "README.md": "the repo's front page: what it is, working on it, cutting a release",
}
DESCRIBED_APP = {}
SKIP = {"CLAUDE.md", "GOTCHAS.md", "check", "clawd-kit.zip", "__pycache__", ".git", ".githooks", "node_modules", ".next", ".data", "e2e-out"}


def read(p):
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def listing(base):
    out = []
    for name in sorted(os.listdir(base), key=str.lower):
        if name in SKIP or name.startswith("."):
            continue
        full = os.path.join(base, name)
        if os.path.isdir(full) or name.endswith(".md"):
            out.append(name)
    return out


def git(*args):
    if not REPO:
        return None
    try:
        return subprocess.run(["git", "-C", REPO] + list(args), capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def repo_line():
    if not REPO:
        return "**Repo:** this folder."
    head = git("rev-parse", "--short", "HEAD")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    remotes = git("remote")
    if not head:
        return "**Repo:** no commits yet."
    return "**Repo:** branch `%s` at `%s`; remotes: %s." % (branch, head, remotes or "none (never pushed)")


def build_map():
    rows = [repo_line(), "", "| path | what it holds |", "|---|---|"]
    for p in listing(ROOT):
        slash = "/" if os.path.isdir(os.path.join(ROOT, p)) else ""
        rows.append("| `%s%s` | %s |" % (p, slash, DESCRIBED.get(p, "**UNDESCRIBED.** Add it to `DESCRIBED` in `tools/docmap.py`")))
    if not REPO:
        return "\n".join(rows)
    rows += ["", "**Inside `%s/`:**" % os.path.basename(REPO), "", "| path | what it holds |", "|---|---|"]
    for p in listing(REPO):
        slash = "/" if os.path.isdir(os.path.join(REPO, p)) else ""
        rows.append("| `%s/%s%s` | %s |" % (os.path.basename(REPO), p, slash, DESCRIBED_APP.get(p, "**UNDESCRIBED.** Add it to `DESCRIBED_APP` in `tools/docmap.py`")))
    return "\n".join(rows)


def split_map(text):
    if BEGIN not in text or END not in text:
        return None
    head, rest = text.split(BEGIN, 1)
    body, tail = rest.split(END, 1)
    return head, body.strip("\n"), tail


PATHY = re.compile(r"(/|\.(md|mjs|js|ts|py|json|ps1|sh|css|html))$")


def check():
    problems = []
    parts = split_map(read(CLAUDE))
    if parts is None:
        return ["CLAUDE.md has no map markers; add them, then run --write"]
    head, body, tail = parts
    hand = head + tail
    if body != build_map():
        problems.append("the map is STALE. Run `python tools/docmap.py --write`")
    for p in listing(ROOT):
        if p not in DESCRIBED:
            problems.append("%s has no description in DESCRIBED" % p)
    for p in (listing(REPO) if REPO else []):
        if p not in DESCRIBED_APP:
            problems.append("REPO/%s has no description in DESCRIBED_APP" % p)
    for tok in re.findall(r"`([^`\n]+)`", hand):
        if re.search(r"[<>*{}$= ]", tok) or tok.startswith(("-", "/", "http", "#")) or not PATHY.search(tok):
            continue
        t = tok.replace("\\", "/")
        if re.match(r"^[A-Za-z]:/", t):
            ok = os.path.exists(t)
        else:
            ok = any(os.path.exists(os.path.join(b, t)) for b in (ROOT, REPO or ROOT))
        if not ok:
            problems.append("CLAUDE.md names `%s`, which does not exist" % tok)
    n = hand.count("\n")
    if n > HAND_MAX_LINES:
        problems.append("CLAUDE.md's hand-written part is %d lines (cap %d)" % (n, HAND_MAX_LINES))
    return problems


def main():
    if "--write" in sys.argv[1:]:
        head, _, tail = split_map(read(CLAUDE))
        with open(CLAUDE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(head + BEGIN + "\n" + build_map() + "\n" + END + tail)
        print("map regenerated")
    problems = check()
    if problems:
        print("PROBLEMS (%d):" % len(problems))
        for p in problems:
            print("  -", p)
        return 1
    print("docs OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
