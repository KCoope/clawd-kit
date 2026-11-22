"""Draws the README's pictures from the mods' own frames.

    python tools/make-pictures.py

Each mod runs under `claude plugin test` in a temporary copy, with a recording test in place of
its own tests. The frames come back as JSON and are drawn cell by cell the way a terminal draws
them: block glyphs as exact quarters, the ground line as the top eighth of a cell, anything else
in a font. Writes docs/running.gif, docs/idle.png and docs/blue.gif at twice their shown size, so
they stay sharp on high-density screens. Needs Pillow; each run picks new trees.
"""
import base64, json, os, shutil, struct, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLUMNS, ROWS, TICK_MS = 72, 6, 90
CW, CH = 16, 32  # one cell, at twice the 8 x 16 it is shown at
DEFAULT = 0x01000000
GLYPH = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█"
FONTS = {  # first one found; text for ASCII, symbols for the snowflakes and heart
    "text": ["C:/Windows/Fonts/consola.ttf", "/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"],
    "symbols": ["C:/Windows/Fonts/seguisym.ttf", "/System/Library/Fonts/Apple Symbols.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
}
MODS = {
    "clawd": {"window": 0x211812, "sprite": 0xD97757},
    "clawd-peaks": {"window": 0x0F1724, "sprite": 0x7CC4FF},
}

RECORDER = """import { mock, test } from 'claude-code/testing'

const PLUGIN = '%(plugin)s'
const PHASES: [boolean, number][] = %(phases)s
const props = (isWorking: boolean) => ({ hasSurvey: false, isCollapsed: false, isWorking, maxRows: 20, bodyColumns: %(columns)d, scroll: { offset: 0, bodyRows: 20 }, view: {} })

test('record frames', { timeoutMs: 300_000 }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'clawd' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: props(PHASES[0][0]) })
  const frames: unknown[] = []
  for (const [isWorking, ticks] of PHASES) {
    await ui.redraw(props(isWorking))
    for (let t = 0; t < ticks; t += 1) {
      await clock.advance(%(tick)d)
      const cells = String((await ui.find({ key: 'scene' }))?.props.cells)
      const rows = []
      for (const r of [0, 1, 2]) {
        const box = (await ui.find({ type: 'Box', key: `clawd-${r}` }))?.props as { top: number; left: number } | undefined
        if (box) rows.push({ top: box.top, left: box.left, text: (await ui.find({ type: 'Text', in: `clawd-${r}` }))?.text ?? '' })
      }
      frames.push({ working: isWorking, cells, rows })
    }
  }
  console.log('FRAMES' + JSON.stringify(frames))
  await ui.unmount()
})
"""


def font(kind, size):
    for path in FONTS[kind]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    sys.exit("make-pictures: no %s font found; add one to FONTS" % kind)


TEXT, SYMBOLS = font("text", 26), font("symbols", 24)


def record(mod, phases):
    tmp = tempfile.mkdtemp(prefix="clawd-pictures-")
    try:
        copy = os.path.join(tmp, mod)
        shutil.copytree(os.path.join(ROOT, "clawd-kit", mod), copy, ignore=shutil.ignore_patterns("tests"))
        os.makedirs(os.path.join(copy, "tests"))
        with open(os.path.join(copy, "tests", "record.test.tsx"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(RECORDER % {"plugin": mod, "phases": json.dumps(phases), "columns": COLUMNS, "tick": TICK_MS})
        out = subprocess.run([shutil.which("claude") or "claude", "plugin", "test", copy], capture_output=True, encoding="utf-8", errors="replace")
        text = out.stdout + out.stderr
        if "FRAMES" not in text:
            sys.exit("make-pictures: no frames from %s:\n%s" % (mod, text[-2000:]))
        return json.loads(text[text.index("FRAMES") + 6:].split("\n")[0])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def rgb(word, fallback):
    return fallback if word == DEFAULT else ((word >> 16) & 255, (word >> 8) & 255, word & 255)


def cell(d, cx, cy, ch, fg, bg):
    x0, y0 = cx * CW, cy * CH
    d.rectangle([x0, y0, x0 + CW - 1, y0 + CH - 1], fill=bg)
    if ch in GLYPH and ch != " ":
        m, hw, hh = GLYPH.index(ch), CW // 2, CH // 2
        for bit, (qx, qy) in zip((1, 2, 4, 8), ((0, 0), (1, 0), (0, 1), (1, 1))):
            if m & bit:
                d.rectangle([x0 + qx * hw, y0 + qy * hh, x0 + qx * hw + hw - 1, y0 + qy * hh + hh - 1], fill=fg)
    elif ch == "▔":
        d.rectangle([x0, y0, x0 + CW - 1, y0 + CH // 8 - 1], fill=fg)
    elif ch.strip():
        d.text((x0 + CW / 2, y0 + CH / 2), ch, fill=fg, font=TEXT if ord(ch) < 128 else SYMBOLS, anchor="mm")


def draw(frame, mod):
    window, sprite = rgb(MODS[mod]["window"], None), rgb(MODS[mod]["sprite"], None)
    img = Image.new("RGB", (COLUMNS * CW, ROWS * CH), window)
    d = ImageDraw.Draw(img)
    raw = base64.b64decode(frame["cells"])
    words = struct.unpack("<%dI" % (len(raw) // 4), raw)
    for cy in range(ROWS):
        for cx in range(COLUMNS):
            i = (cy * COLUMNS + cx) * 3
            cell(d, cx, cy, chr(words[i]), rgb(words[i + 1], (0xEE, 0xEE, 0xEE)), rgb(words[i + 2], window))
    for row in frame["rows"]:
        for i, ch in enumerate(row["text"]):
            if 0 <= row["top"] < ROWS:
                cell(d, row["left"] + i, row["top"], ch, sprite, window)
    return img


def save_gif(frames, mod, name):
    imgs = [draw(f, mod) for f in frames]
    path = os.path.join(ROOT, "docs", name)
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=TICK_MS, loop=0)
    print("wrote docs/%s: %d frames, %d bytes" % (name, len(imgs), os.path.getsize(path)))


def main():
    orange = record("clawd", [[True, 500], [False, 60]])
    # the orange one tucks his feet in over a tall tree: his head row on row 0 and two rows drawn
    tuck = next((i for i, f in enumerate(orange) if f["working"] and i > 80 and len(f["rows"]) == 2 and f["rows"][0]["top"] == 0), None)
    if tuck is None:
        sys.exit("make-pictures: no tucked jump recorded; run it again")
    save_gif(orange[tuck - 80:tuck + 70], "clawd", "running.gif")

    # between turns: standing with his eyes to the front, the score from the work before
    idle = [f for f in orange[-40:] if len(f["rows"]) == 3]
    front = max(set(f["rows"][1]["text"] for f in idle), key=lambda t: sum(f["rows"][1]["text"] == t for f in idle))
    still = [f for f in idle if f["rows"][1]["text"] == front][-1]
    draw(still, "clawd").save(os.path.join(ROOT, "docs", "idle.png"))
    print("wrote docs/idle.png")

    blue = record("clawd-peaks", [[True, 500]])
    # the blue one clears a tall peak at three rows up: his head row on row 0
    top = next((i for i, f in enumerate(blue) if i > 80 and f["rows"] and f["rows"][0]["top"] == 0), None)
    if top is None:
        sys.exit("make-pictures: no three-row jump recorded; run it again")
    save_gif(blue[top - 80:top + 70], "clawd-peaks", "blue.gif")


if __name__ == "__main__":
    main()
