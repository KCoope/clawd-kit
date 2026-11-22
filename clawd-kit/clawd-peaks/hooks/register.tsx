import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

// A small blue Clawd in falling snow, hopping snow-capped mountains while Claude works.
// `$` is allowed only at call sites, so each hook starts the timer itself.

const isOn = atom({ plugin: 'clawd-peaks', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'clawd-peaks', key: 'frame' } as const, 0)

const ROWS = 6
const GROUND = 5 // the ground line
const FEET = 4 // the row his legs stand on; his head is one row up
const HOME = 4 // his column while he runs
const WIDTH = 7 // his widest row
const TICK_MS = 90
// After three quiet minutes he curls up asleep and the snow keeps falling at a quarter of the pace
// (one redraw in four), so the band never looks frozen.
const SETTLE_TICKS = Math.round(180_000 / TICK_MS)
const SLOW_EVERY = 4
// Lift per tick of a jump: a crouch, then up to three rows, which clears a peak.
// He takes off 3 or 4 columns before a mountain (JUMP_AT).
const HOP = [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1]
const JUMP_AT = [3, 4]
// A little happy hop when a turn ends: crouch, up one row, down.
const HAPPY = [0, 1, 1, 0]
const LAND_TICKS = 2 // he squashes on landing
const BOB_EVERY = 10 // idle breathing: crouched for the last two ticks of every ten

const DEFAULT = 0x01000000 // the terminal's own colour
const SNOW = 0xeef3f8
const SNOW_FAR = 0x7f93ad
const GROUND_SNOW = 0xd9e4f0
const CAP = 0xeaf2fb
const ROCK = 0x4a6c96
const ROCK_LOW = 0x34506f
const SCORE = 0x7fa6d6
const BLUE = '#7cc4ff'
const FLAKES = ['✻', '✽', '✶', '✢', '*', '·', '·', '.']

// Clawd as pixels in quadrant glyphs (2 x 2 a cell): head; eyes with arms out; body; four legs.
// Crouch and squash are the whole sprite a pixel lower, legs tucked.
const PX = 14
const GLYPH = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
const pxRow = (on: (i: number) => boolean) => Array.from({ length: PX }, (_, i) => (on(i) ? '#' : '.')).join('')
const BLANK = pxRow(() => false)
const HEAD_PX = pxRow(i => i >= 2 && i <= 11)
const BODY_PX = HEAD_PX
const eyesPx = (gaze: number, shut: boolean) =>
  pxRow(i => i >= 0 && i <= 13 && (shut || (i !== 4 + gaze && i !== 9 + gaze)))
const LEGS_PX = pxRow(i => [3, 5, 8, 10].includes(i))
const STEP_PX = pxRow(i => [2, 4, 9, 11].includes(i))

type Part = { text: string; left: number }
type Pose = 'stand' | 'step' | 'crouch'
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
  if (pose === 'crouch') return glyphRows([BLANK, HEAD_PX, face, BODY_PX])
  return glyphRows([HEAD_PX, face, BODY_PX, pose === 'step' ? STEP_PX : LEGS_PX])
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
const ZZZ_COLOR = 0x9ccbff

type Flake = { x: number; y: number; v: number; glyph: string; color: number }
// tall: a snow-capped peak 3 rows high and 6 wide; otherwise a hill 2 rows high and 4 wide
type Peak = { x: number; tall: boolean; passed: boolean }
const peakWidth = (p: Peak) => (p.tall ? 6 : 4)

// Scene state; a reload starts it over.
let timer: Timer | undefined
let site: string | undefined // the band's requestId while Clawd is drawn
let width = 0
let working = false
let flakes: Flake[] = []
let peaks: Peak[] = []
let nextGap = 40
let groundShift = 0
let x = HOME
let target = HOME
let hop = -1 // index into hopSeq; -1 on the ground
let hopSeq = HOP
let step = 0
let blink = 0
let gaze = 0 // -1 looking left, 1 right
let gazeTicks = 0
// Ticks left of turning around: when work starts with him off to the right he walks back facing
// left, then turns (eyes to the front) before he runs, instead of back-pedalling.
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
  peaks = peaks.filter(p => p.x < width)
  x = Math.min(x, Math.max(0, width - WIDTH))
  target = Math.min(target, Math.max(0, width - WIDTH))
}

function stop() {
  timer?.cancel()
  timer = undefined
}

// `wake`: a press or work wakes him; his own idle hops must not, or he never falls asleep (the
// sleep test caught that, 2026-11-22).
function jump(seq: number[], wake = true) {
  if (hop < 0) {
    hop = 0
    hopSeq = seq
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
      for (const p of peaks) {
        p.x -= 2
        if (!p.passed && p.x + peakWidth(p) < x) {
          p.passed = true
          score += 1
          best = Math.max(best, score)
        }
      }
      peaks = peaks.filter(p => p.x > -7)
      const last = peaks[peaks.length - 1]
      if (last === undefined || last.x < width - nextGap) {
        peaks.push({ x: width, tall: Math.random() < 0.6, passed: false })
        nextGap = rand(32, 70)
      }
      const ahead = (p: Peak) => p.x - (x + WIDTH - 1)
      if (hop < 0 && peaks.some(p => JUMP_AT.includes(ahead(p)))) jump(HOP)
    }
  } else {
    peaks = []
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
  const put = (cx: number, cy: number, glyph: string, color: number) => {
    if (cx < 0 || cx >= width || cy < 0 || cy >= ROWS) return
    const i = (cy * width + cx) * 3
    words[i] = glyph.codePointAt(0) ?? 0x20
    words[i + 1] = color
  }
  const row = (cx: number, cy: number, glyphs: string, color: number) => {
    for (const [i, g] of [...glyphs].entries()) put(cx + i, cy, g, color)
  }

  for (let cx = 0; cx < width; cx += 1) put(cx, GROUND, gapAt(cx + groundShift) ? ' ' : '▔', GROUND_SNOW)
  for (const f of flakes) put(f.x, Math.floor(f.y), f.glyph, f.color)
  for (const p of peaks) {
    if (p.tall) {
      row(p.x + 2, FEET - 2, '▟▙', CAP)
      row(p.x + 1, FEET - 1, '▟██▙', ROCK) // no snow streak down the face: as pixels it read as a rocket
      row(p.x, FEET, '▟████▙', ROCK_LOW)
    } else {
      row(p.x + 1, FEET - 1, '▟▙', CAP)
      row(p.x, FEET, '▟██▙', ROCK_LOW)
    }
  }
  if (puff > 0) {
    put(x - 1, FEET, PUFF, GROUND_SNOW)
    put(x + WIDTH, FEET, PUFF, GROUND_SNOW)
  }
  if (heart > 0) put(heartX, FEET - 1 - Math.floor((HEART_TICKS - heart) / 2), HEART, HEART_COLOR)
  if (bang > 0) put(x + Math.floor(WIDTH / 2), FEET - 2 - lift(), BANG, BANG_COLOR)
  if (asleep) {
    const i = zzz % ZZZ.length
    put(x + WIDTH + 2 < width ? x + WIDTH + i : x - 1 - i, FEET - 2 - i, ZZZ[i] ?? 'z', ZZZ_COLOR) // at the right edge, on his left
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
  const moving = hop < 0 && ((working && turning === 0) || x !== target) // still while he turns
  return sprite(moving && step % 4 < 2 ? 'step' : 'stand', eyes)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clawd', description: 'Show or hide Clawd and the mountains above the prompt' })
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

  // A press on either row of him, posted by his region: a jump and a heart.
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
        {clawd().map((part, r) => (
          <Box key={`clawd-${r}`} position="absolute" top={FEET - 1 + r - up} left={x + part.left}>
            {spriteFailed
              ? <Text color={BLUE}>{part.text}</Text>
              : <Client key={`clawd-${r}`} module="./clawd-sprite.tsx" props={{ text: part.text, color: BLUE }} width={[...part.text].length} height={1} />}
          </Box>
        ))}
      </Box>
    )
  })
}
