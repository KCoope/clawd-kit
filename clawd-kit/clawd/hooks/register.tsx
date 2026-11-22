import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

// Clawd in the snow above the prompt: he runs and hops trees while Claude works, wanders while you
// wait, jumps when pressed. The scene is one Raster; Clawd is three Client regions
// (clawd-sprite.tsx). `$` is allowed only at call sites, so each hook starts the timer itself.
// 0.3.0 (2026-11-22) adds behaviour only: crouch and squash around jumps, eyes that follow him, a
// nap, a heart, reactions to work starting and ending. His look, orange, the pines and the snow are
// unchanged. 0.4.0: six trees, young ones with no trunk, a tall one in every 2 to 4 a little taller
// than him; he stands on the snow and tucks his feet in at the top of a jump to clear them.

const isOn = atom({ plugin: 'clawd', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'clawd', key: 'frame' } as const, 0)

const ROWS = 6
const GROUND = 5 // the ground line
const FEET = 4 // the row his legs stand on; his head is two rows up
const HOME = 4 // his column while he runs
const WIDTH = 9 // his widest row
const TICK_MS = 90
// After three quiet minutes he curls up asleep and the snow keeps falling at a quarter of the pace
// (one redraw in four). Before 0.3.0 the scene held still instead, which read as frozen.
const SETTLE_TICKS = Math.round(180_000 / TICK_MS)
const SLOW_EVERY = 4
// Lift per tick of a jump: a crouch first (anticipation), then up two rows. Over a big tree his feet
// tuck in at the top, which clears it by a hair. He crouches 4 or 5 columns before a tree (JUMP_AT): at lift 1
// his arms reach the column in front of him, and the slim tree's top row starts at its left edge,
// so 2 or 3 clipped it. The test checks every frame for an overlap.
const HOP = [0, 1, 2, 2, 2, 2, 2, 2, 2, 1]
const JUMP_AT = [4, 5]
// A little happy hop when a turn ends: crouch, up one row, down.
const HAPPY = [0, 1, 1, 0]
const LAND_TICKS = 2 // he squashes on landing
const BOB_EVERY = 10 // idle breathing: crouched for the last two ticks of every ten

const DEFAULT = 0x01000000 // the terminal's own colour
const SNOW = 0xeef3f8
const SNOW_FAR = 0x8f9aa6
const GROUND_SNOW = 0xd9dfe6
const PINE = 0x4f8f5a
const PINE_TOP = 0x7fb38a
const TRUNK = 0x8b5e3c
const SCORE = 0xa87a5f
const ORANGE = '#d97757'
const FLAKES = ['✻', '✽', '✶', '✢', '*', '·', '·', '.']

// Clawd as pixels, turned into quadrant glyphs (2 x 2 pixels a cell): an 18 x 6 grid holding the
// original Clawd (` ▐▛███▜▌` / `▝▜█████▛▘` / `  ▘▘ ▝▝`). Standing, the grid puts him one pixel
// lower than the original rows, so his legs meet the snow the trees stand on. The same shape
// crouches with his legs hidden (before a jump, landing, breathing, asleep; the original two rows
// exactly), tucks his feet in at the top of a jump, and moves his eyes to look where he goes.
const PX = 18
const GLYPH = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
const pxRow = (on: (i: number) => boolean) => Array.from({ length: PX }, (_, i) => (on(i) ? '#' : '.')).join('')
const BLANK = pxRow(() => false)
const HEAD_PX = pxRow(i => i >= 3 && i <= 14)
const ARMS_PX = pxRow(i => i >= 1 && i <= 16)
const BODY_PX = HEAD_PX
const eyesPx = (gaze: number, shut: boolean) =>
  pxRow(i => i >= 3 && i <= 14 && (shut || (i !== 5 + gaze && i !== 12 + gaze)))
const LEGS_PX = pxRow(i => [4, 6, 11, 13].includes(i))
const STEP_PX = pxRow(i => [5, 7, 10, 12].includes(i))
const TUCK_PX = pxRow(i => [5, 6, 11, 12].includes(i)) // on the way up and down

type Part = { text: string; left: number }
type Pose = 'stand' | 'step' | 'tuck' | 'apex' | 'crouch'
type Eyes = 'open' | 'left' | 'right' | 'shut'

function glyphRows(px: string[]): Part[] {
  const parts: Part[] = []
  for (let r = 0; r < px.length; r += 2) {
    let text = ''
    for (let c = 0; c < PX; c += 2) {
      const on = (y: number, x: number) => px[y]?.[x] === '#'
      text += GLYPH[(on(r, c) ? 1 : 0) | (on(r, c + 1) ? 2 : 0) | (on(r + 1, c) ? 4 : 0) | (on(r + 1, c + 1) ? 8 : 0)]
    }
    const left = text.length - text.trimStart().length
    parts.push({ text: text.trim(), left })
  }
  return parts
}

function sprite(pose: Pose, eyes: Eyes): Part[] {
  const gaze = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0
  const face = eyesPx(gaze, eyes === 'shut')
  // crouch and apex leave one row empty: his top row or his legs row
  if (pose === 'crouch') return glyphRows([BLANK, BLANK, HEAD_PX, face, ARMS_PX, BODY_PX])
  if (pose === 'apex') return glyphRows([HEAD_PX, face, ARMS_PX, BODY_PX, BLANK, BLANK])
  const legs = pose === 'step' ? STEP_PX : pose === 'tuck' ? TUCK_PX : LEGS_PX
  return glyphRows([BLANK, HEAD_PX, face, ARMS_PX, BODY_PX, legs])
}

const PUFF = '·'
const PUFF_TICKS = 3
const HEART = '♥'
const HEART_TICKS = 8
const HEART_COLOR = 0xff8fb1
const BANG = '!'
const BANG_TICKS = 8
const BANG_COLOR = 0xffd27c
const ZZZ = ['z', 'z', 'Z']
const ZZZ_COLOR = 0xf0a27e

type Flake = { x: number; y: number; v: number; glyph: string; color: number }

// Trees as pixels on the same 2 x 2 grid as Clawd, one letter a pixel: l lit upper branches,
// g lower branches, t trunk, . nothing. A cell shows at most two colours (its glyph's and its
// background), so a design needing three in one cell is refused at load (GOTCHAS 13): the light and
// dark tiers change on a cell row, and a trunk fills a whole cell in the middle of a tree an odd
// number of cells wide. Young trees keep their branches to the snow and show no trunk; bigger ones
// show more. The tall ones (6 pixels) stand a pixel taller than Clawd; 6 is the most a jump clears.
// Each tree takes one of three greens.
const GREENS: Record<string, number>[] = [
  { l: PINE_TOP, g: PINE }, // pine, the 0.3.0 colours
  { l: 0x6da693, g: 0x3b7560 }, // fir
  { l: 0x9dc27c, g: 0x5e934e }, // spring
]
const SHORT_TREES = [
  ['..ll..', '.gggg.', 'gggggg'], // tiny
  ['....ll....', '...llll...', '..gggggg..', '.gggggggg.'], // young
  ['....ll....', '...llll...', '..llllll..', '.gggggggg.', '....tt....'], // level with his head
]
const TALL_TREES = [
  ['..ll..', '.llll.', '.gggg.', 'gggggg', 'gggggg', '..tt..'], // slim
  ['....ll....', '...llll...', '..gggggg..', '...gggg...', '.gggggggg.', '....tt....'], // tiered
  ['....ll....', '...llll...', '..gggggg..', '.gggggggg.', '....tt....', '....tt....'], // bare trunk
]
type TreeCell = { dx: number; dy: number; glyph: string; fg: number; bg: number } // dy: rows above FEET
// big: it reaches his head's row (5 pixels or more), so he tucks his feet in to clear it
type TreeShape = { cells: TreeCell[]; width: number; big: boolean; id: string; green: number }

function treeShape(design: string[], id: string, green: number): TreeShape {
  const palette: Record<string, number> = { ...GREENS[green], t: TRUNK }
  const width = (design[0]?.length ?? 0) / 2
  if (!Number.isInteger(width) || design.some(r => r.length !== width * 2) || design.length > 6) {
    throw new Error('a tree is an even number of pixels wide, every row the same, at most 6 tall')
  }
  const px = design.length % 2 === 0 ? design : ['.'.repeat(width * 2), ...design] // pairs rows from the top
  const rows = px.length / 2
  const cells: TreeCell[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < width; c += 1) {
      // upper left, upper right, lower left, lower right: the bit order of GLYPH
      const quad = [px[2 * r]?.[2 * c], px[2 * r]?.[2 * c + 1], px[2 * r + 1]?.[2 * c], px[2 * r + 1]?.[2 * c + 1]].map(p => p ?? '.')
      const colours = [...new Set(quad.filter(p => p !== '.'))]
      if (colours.length === 0) continue
      if (colours.length + (quad.includes('.') ? 1 : 0) > 2) throw new Error(`tree cell ${r},${c} needs three colours`)
      const front = colours[0] ?? 'g'
      const back = colours[1]
      const mask = quad.reduce((m, p, i) => (p === front ? m | (1 << i) : m), 0)
      cells.push({
        dx: c,
        dy: rows - 1 - r,
        glyph: GLYPH[mask] ?? ' ',
        fg: palette[front] ?? PINE,
        bg: back === undefined ? DEFAULT : palette[back] ?? PINE,
      })
    }
  }
  return { cells, width, big: design.length >= 5, id, green }
}
// every shape in every green: SHORT[shape][green]
const SHORT = SHORT_TREES.map((d, i) => GREENS.map((_, g) => treeShape(d, `short ${i}`, g)))
const TALL = TALL_TREES.map((d, i) => GREENS.map((_, g) => treeShape(d, `tall ${i}`, g)))
type Tree = { x: number; passed: boolean; shape: TreeShape }

// A tree from the pool, never the same shape or the same green as the one before it.
function pickTree(pool: TreeShape[][], last: TreeShape | undefined): TreeShape {
  const shapes = pool.filter(s => s[0]?.id !== last?.id)
  const greens = (shapes[rand(0, shapes.length - 1)] ?? []).filter(s => s.green !== last?.green)
  const pick = greens[rand(0, greens.length - 1)]
  if (pick === undefined) throw new Error('a tree pool is empty')
  return pick
}

// Scene state; a reload starts it over.
let timer: Timer | undefined
let site: string | undefined // the band's requestId while Clawd is drawn
let width = 0
let working = false
let flakes: Flake[] = []
let trees: Tree[] = []
let untilTall = 2 // trees until the next tall one: every 2 to 4
let nextGap = 40
let groundShift = 0
let x = HOME
let target = HOME
let hop = -1 // index into hopSeq; -1 on the ground
let hopSeq = HOP
let tuckFeet = false // this jump clears a big tree: his feet tuck in at the top
let step = 0
let blink = 0
let gaze = 0 // -1 looking left, 1 right
let gazeTicks = 0
// Ticks left of turning around: when work starts with him off to the right he walks back facing
// left, then turns (eyes to the front) before he runs, rather than back-pedalling.
let turning = 0
const TURN_TICKS = 2
let landing = 0
let puff = 0
let heart = 0
let heartX = 0
let bang = 0
let asleep = false
let zzz = 0
let rest = 40 // ticks until he next wanders off
let quiet = 0 // ticks since the last turn or press
let score = 0
let best = 0
let spriteFailed = false // a surface that cannot run his regions draws him as plain text instead

const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

function newFlake(y: number): Flake {
  const near = Math.random() < 0.6
  return {
    x: rand(0, Math.max(0, width - 1)),
    y,
    v: near ? 0.25 + Math.random() * 0.2 : 0.1 + Math.random() * 0.1,
    glyph: FLAKES[rand(0, FLAKES.length - 1)] ?? '*',
    color: near ? SNOW : SNOW_FAR,
  }
}

function resize(columns: number) {
  width = columns
  flakes = Array.from({ length: Math.max(4, Math.floor(width / 7)) }, () => newFlake(Math.random() * GROUND))
  trees = trees.filter(t => t.x < width)
  x = Math.min(x, Math.max(0, width - WIDTH))
  target = Math.min(target, Math.max(0, width - WIDTH))
}

function stop() {
  timer?.cancel()
  timer = undefined
}

// `wake`: a press or work wakes him; his own idle hops must not, or he never falls asleep.
// `tuck`: only a jump over a big tree tucks his feet in; the rest keep the legs out.
function jump(seq: number[], wake = true, tuck = false) {
  if (hop < 0) {
    hop = 0
    hopSeq = seq
    tuckFeet = tuck
  }
  if (wake) {
    quiet = 0
    asleep = false
  }
}

function fall() {
  for (const [i, f] of flakes.entries()) {
    f.y += f.v
    if (Math.random() < 0.04) f.x = (f.x + (Math.random() < 0.5 ? -1 : 1) + width) % width
    if (f.y >= GROUND) flakes[i] = newFlake(0)
  }
}

// Moves the scene on one tick; true when the band should redraw.
function advance(): boolean {
  // not drawn: stop the timer; the next draw restarts it
  if (site === undefined || width === 0) {
    stop()
    return false
  }

  quiet = working ? 0 : quiet + 1
  const walking = x !== target
  asleep = !working && quiet > SETTLE_TICKS && hop < 0 && !walking
  if (asleep) {
    // He sleeps where he is, z drifting up; a press, /clawd or the next turn wakes him.
    step += 1
    if (step % SLOW_EVERY !== 0) return false
    zzz += 1
    fall()
    return true
  }

  puff = Math.max(0, puff - 1)
  heart = Math.max(0, heart - 1)
  bang = Math.max(0, bang - 1)
  landing = Math.max(0, landing - 1)
  if (hop >= 0) {
    hop += 1
    if (hop >= hopSeq.length) {
      if (hopSeq === HOP) {
        landing = LAND_TICKS
        puff = PUFF_TICKS
      }
      hop = -1
    }
  }

  // Snow falls at half speed while you wait.
  if (working || quiet % 2 === 0) fall()

  if (working) {
    target = HOME
    if (x !== target) gaze = target > x ? 1 : -1 // he faces the way he walks
    else if (gaze < 0) {
      gaze = 0 // arrived facing left: turn around
      turning = TURN_TICKS
    } else if (turning > 0) {
      turning -= 1
      if (turning === 0) gaze = 1
    } else gaze = 1 // he runs to the right
    if (x === HOME && turning === 0 && gaze === 1) {
      groundShift += 2
      for (const t of trees) {
        t.x -= 2
        if (!t.passed && t.x + t.shape.width < x) {
          t.passed = true
          score += 1
          best = Math.max(best, score)
        }
      }
      trees = trees.filter(t => t.x + t.shape.width > 0)
      const last = trees[trees.length - 1]
      if (last === undefined || last.x < width - nextGap) {
        untilTall -= 1
        trees.push({ x: width, passed: false, shape: pickTree(untilTall <= 0 ? TALL : SHORT, last?.shape) })
        if (untilTall <= 0) untilTall = rand(2, 4)
        nextGap = rand(32, 70)
      }
      const ahead = (t: Tree) => t.x - (x + WIDTH - 1)
      const next = trees.find(t => JUMP_AT.includes(ahead(t)))
      if (hop < 0 && next !== undefined) jump(HOP, true, next.shape.big)
    }
  } else {
    trees = []
    if (!walking && hop < 0) {
      rest -= 1
      if (rest <= 0) {
        rest = rand(60, 180)
        if (Math.random() < 0.25) jump(HOP, false)
        else target = rand(0, Math.max(0, width - WIDTH))
      }
      // now and then he looks around
      if (gazeTicks > 0) gazeTicks -= 1
      else if (gaze !== 0) gaze = 0
      else if (Math.random() < 0.01) {
        gaze = Math.random() < 0.5 ? -1 : 1
        gazeTicks = rand(15, 40)
      }
    } else if (walking) gaze = target > x ? 1 : -1
    if (hop < 0 && blink === 0 && Math.random() < 0.015) blink = 2
  }

  if (x !== target) x += x < target ? 1 : -1
  if (blink > 0) blink -= 1
  step += 1
  return true
}

function encode(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

// Gaps at fixed, uneven places along the ground, so it visibly moves while he runs.
const gapAt = (n: number) => (Math.imul(n, 2654435761) >>> 0) % 19 === 0

function scene(): string {
  const words = new Uint32Array(width * ROWS * 3)
  for (let i = 0; i < width * ROWS; i += 1) {
    words[i * 3] = 0x20
    words[i * 3 + 1] = DEFAULT
    words[i * 3 + 2] = DEFAULT
  }
  const put = (cx: number, cy: number, glyph: string, color: number, back = DEFAULT) => {
    if (cx < 0 || cx >= width || cy < 0 || cy >= ROWS) return
    const i = (cy * width + cx) * 3
    words[i] = glyph.codePointAt(0) ?? 0x20
    words[i + 1] = color
    words[i + 2] = back
  }

  for (let cx = 0; cx < width; cx += 1) put(cx, GROUND, gapAt(cx + groundShift) ? ' ' : '▔', GROUND_SNOW)
  for (const f of flakes) put(f.x, Math.floor(f.y), f.glyph, f.color)
  for (const t of trees) for (const c of t.shape.cells) put(t.x + c.dx, FEET - c.dy, c.glyph, c.fg, c.bg)
  if (puff > 0) {
    put(x - 1, FEET, PUFF, GROUND_SNOW)
    put(x + WIDTH, FEET, PUFF, GROUND_SNOW)
  }
  if (heart > 0) put(heartX, FEET - 2 - Math.floor((HEART_TICKS - heart) / 3), HEART, HEART_COLOR)
  if (bang > 0) put(x + Math.floor(WIDTH / 2), FEET - 3 - lift(), BANG, BANG_COLOR)
  if (asleep) {
    const i = zzz % ZZZ.length
    // drifting up to his right, or to his left when he naps against the right edge
    put(x + WIDTH + 2 < width ? x + WIDTH + i : x - 1 - i, FEET - 2 - i, ZZZ[i] ?? 'z', ZZZ_COLOR)
  }
  if (best > 0 && width >= 40) {
    const pad = (n: number) => String(n).padStart(5, '0')
    const line = `HI ${pad(best)}  ${pad(score)}`
    for (const [i, ch] of [...line].entries()) put(width - line.length - 1 + i, 0, ch, SCORE)
  }
  return encode(words)
}

const lift = () => (hop >= 0 ? hopSeq[hop] ?? 0 : 0)

function clawd(): Part[] {
  const eyes: Eyes = asleep || blink > 0 ? 'shut' : gaze < 0 ? 'left' : gaze > 0 ? 'right' : 'open'
  if (asleep) return sprite('crouch', 'shut') // curled up
  const crouched =
    (hop >= 0 && lift() === 0) || // ready to spring, or the end of a happy hop
    landing > 0 ||
    (hop < 0 && !working && x === target && step % BOB_EVERY >= BOB_EVERY - 2) // breathing
  if (crouched) return sprite('crouch', eyes)
  if (hop >= 0) return sprite(lift() >= 2 && tuckFeet ? 'apex' : 'tuck', eyes) // in the air; over a big tree, feet in at the top
  const moving = (working && turning === 0) || x !== target // still while he turns
  return sprite(moving && step % 4 < 2 ? 'step' : 'stand', eyes)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clawd', description: 'Show or hide Clawd and the snow above the prompt' })
    timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    const stored = await $.store.get('isOn')
    best = Number((await $.store.get('best')) ?? 0) || 0
    await update($, isOn, () => stored !== false)
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async $ => {
    const shown = !(await read($, isOn))
    await update($, isOn, () => shown)
    if (shown) quiet = 0 // brought back, he is awake
    await $.store.set('isOn', shown)
    if (shown) timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    else stop()
    return { text: shown ? 'Clawd is back above the prompt.' : 'Clawd is hidden. Run /clawd to bring Clawd back.' }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      score = 0
      quiet = 0
      timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      quiet = 0
      rest = rand(20, 60)
      void $.store.set('best', best)
    }
    return next(e)
  })

  // A press on any row of him, posted by his region: a jump and a heart.
  on('ui.message', ($, e, next) => {
    if (!e.module.endsWith('clawd-sprite.tsx') || e.data !== 'jump') return next(e)
    jump(HOP)
    heart = HEART_TICKS
    heartX = x + WIDTH + 1
    timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    return {}
  })

  // his regions failed: draw him as plain text, not pressable
  on('ui.fault', ($, e, next) => {
    if (e.module.endsWith('clawd-sprite.tsx')) {
      spriteFailed = true
      $.ui.log(`Clawd is drawn without his click: ${e.reason}`, { to: 'debug' })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, isOn)
    await read($, frame) // subscribes the band to each tick
    if (!shown || e.surface !== 'terminal' || e.props.hasSurvey || e.props.maxRows < ROWS || e.props.bodyColumns < WIDTH + 12) {
      site = undefined
      return next(e)
    }

    site = e.requestId
    // restart a timer that stopped for want of a band; a settled scene still snows, slowly
    timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    if (e.props.isWorking && !working) {
      bang = BANG_TICKS // he notices the work start
      quiet = 0
      asleep = false
    } else if (!e.props.isWorking && working && hop < 0) {
      jump(HAPPY) // and is pleased when it ends
    }
    working = e.props.isWorking
    const columns = Math.min(e.props.bodyColumns, 512)
    if (columns !== width) resize(columns)

    const { Box, Client, Raster, Text } = $.ui.resolve(e)
    const up = lift()

    return (
      <Box width={columns} height={ROWS}>
        <Raster key="scene" columns={columns} rows={ROWS} cells={scene()} />
        {clawd().flatMap((part, r) => part.text === '' ? [] : [ // a crouch or a jump's top leaves a row empty
          <Box key={`clawd-${r}`} position="absolute" top={FEET - 2 + r - up} left={x + part.left}>
            {spriteFailed
              ? <Text color={ORANGE}>{part.text}</Text>
              : <Client key={`clawd-${r}`} module="./clawd-sprite.tsx" props={{ text: part.text, color: ORANGE }} width={[...part.text].length} height={1} />}
          </Box>,
        ])}
      </Box>
    )
  })
}
