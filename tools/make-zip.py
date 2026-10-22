"""Builds clawd-kit.zip from clawd-kit/, or checks the files that go into it.

    python tools/make-zip.py           build clawd-kit.zip in the repo root
    python tools/make-zip.py --check   check the kit's files only

Entry names use forward slashes (a backslash name breaks on a Mac), shell scripts are marked
executable, and every entry carries one fixed date so two builds of the same files match. The
check fails on a CR in any text file (GOTCHAS 7), a non-ASCII byte in a script (GOTCHAS 6), or a
local user path.
"""
import os, re, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, "clawd-kit")
OUT = os.path.join(ROOT, "clawd-kit.zip")
TEXT = (".sh", ".ps1", ".md", ".json", ".tsx", ".ts")
LOCAL_PATH = re.compile(rb"[A-Za-z]:[\\/]+Users[\\/]+|/Users/[^/\s]+/|/home/[^/\s]+/")


def files():
    # Tracked files only: Claude Code writes `.claude-plugin/types/` and `tsconfig.json` beside a mod
    # it loads, and those must never reach the zip.
    out = subprocess.run(["git", "-C", ROOT, "ls-files", "-z", "clawd-kit"], capture_output=True, check=True).stdout
    for rel in sorted(p for p in out.decode("utf-8").split("\0") if p):
        yield os.path.join(ROOT, rel)


def check():
    problems = []
    for p in files():
        rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
        with open(p, "rb") as fh:
            b = fh.read()
        if p.endswith(TEXT) and b"\r" in b:
            problems.append(rel + ": has CR line endings")
        if p.endswith((".sh", ".ps1")) and any(x > 127 for x in b):
            problems.append(rel + ": has a non-ASCII byte")
        if LOCAL_PATH.search(b):
            problems.append(rel + ": names a local user path")
    for line in problems:
        print("make-zip check: " + line)
    return not problems


def build():
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        # The repo's LICENSE rides along as clawd-kit/LICENSE: one file, so no copy to drift.
        kit = [(os.path.relpath(p, ROOT).replace(os.sep, "/"), p) for p in files()]
        for name, p in kit + [("clawd-kit/LICENSE", os.path.join(ROOT, "LICENSE"))]:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100000 | (0o755 if p.endswith(".sh") else 0o644)) << 16
            with open(p, "rb") as fh:
                z.writestr(info, fh.read())
    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
    if any(chr(92) in n for n in names):
        sys.exit("make-zip: a backslash entry name got in")
    print("wrote clawd-kit.zip: %d files, %d bytes" % (len(names), os.path.getsize(OUT)))


if __name__ == "__main__":
    if not check():
        sys.exit(1)
    if "--check" not in sys.argv:
        build()
