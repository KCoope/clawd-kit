import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

// Clawd in falling snow, drawn in the band above the prompt. The scene (snow, pines, ground,
// score) is one Raster; Clawd is three rows of plain text laid over it, each in a Client region
// (clawd-sprite.tsx) that hears a press and posts 'jump'. Buttons would flip his colours under the
// pointer and leave holes in him. Each tick bumps `frame`, which redraws the band. The engine
// allows `$` only at a call site, so every hook that wakes the scene starts the timer itself.

const isOn = atom({ plugin: 'clawd', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'clawd', key: 'frame' } as const, 0)

const ROWS = 6
const GROUND = 5 // the ground line
const FEET = 4 // the row Clawd stands on; his head is two rows up
const HOME = 4 // his column while he runs
const WIDTH = 9 // his widest row
const TICK_MS = 90
const SETTLE_TICKS = Math.round(180_000 / TICK_MS) // three quiet minutes, then the scene holds still
const SPEED = 2 // columns the ground moves per tick while Claude works
// Height per tick of a hop. Two rows clears a pine; a hop starts 11 or 12 columns before one,
// which at SPEED keeps him two rows up for the whole overlap.
const HOP = [1, 2, 2, 2, 2, 2, 2, 2, 1]

const DEFAULT = 0x01000000 // the terminal's own colour
const SNOW = 0xeef3f8
const SNOW_FAR = 0x8f9aa6
const GROUND_SNOW = 0xd9dfe6
const PINE = 0x4f8f5a
const PINE_TOP = 0x7fb38a
const SCORE = 0xa87a5f
const ORANGE = '#d97757'
const FLAKES = ['✻', '✽', '✶', '✢', '*', '·', '·', '.']

type Part = { text: string; left: number }
const HEAD: Part = { text: '▐▛███▜▌', left: 1 }
const HEAD_BLINK: Part = { text: '▐█████▌', left: 1 }
const BODY: Part = { text: '▝▜█████▛▘', left: 0 }
const LEGS: Part = { text: '▘▘ ▝▝', left: 2 }
const LEGS_STEP: Part = { text: '▝▝ ▘▘', left: 2 }
const LEGS_TUCKED: Part = { text: '▝▘ ▝▘', left: 2 }

type Flake = { x: number; y: number; v: number; glyph: string; color: number }
type Pine = { x: number; passed: boolean }

// The scene lives in the module: a reload starts it over, which loses nothing worth keeping.
let timer: Timer | undefined
let site: string | undefined // the band's requestId while Clawd is drawn
let width = 0
let working = false
let flakes: Flake[] = []
let pines: Pine[] = []
let nextGap = 40
let groundShift = 0
let x = HOME
let target = HOME
let hop = -1 // index into HOP; -1 on the ground
let step = 0
let blink = 0
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
  pines = pines.filter(p => p.x < width)
  x = Math.min(x, Math.max(0, width - WIDTH))
  target = Math.min(target, Math.max(0, width - WIDTH))
}

function stop() {
  timer?.cancel()
  timer = undefined
}

function jump() {
  if (hop < 0) hop = 0
  quiet = 0
}

// Moves the scene on one tick; true when the band should redraw.
function advance(): boolean {
  // Not drawn (hidden, a survey up, too narrow): the timer stops, and the next draw starts it again.
  if (site === undefined || width === 0) {
    stop()
    return false
  }

  quiet = working ? 0 : quiet + 1
  const walking = x !== target
  if (!working && quiet > SETTLE_TICKS && hop < 0 && !walking) {
    stop() // a press, /clawd or the next turn wakes it
    return false
  }

  if (hop >= 0) {
    hop += 1
    if (hop >= HOP.length) hop = -1
  }

  // Snow falls at half speed while you wait.
  if (working || quiet % 2 === 0) {
    for (const [i, f] of flakes.entries()) {
      f.y += f.v
      if (Math.random() < 0.04) f.x = (f.x + (Math.random() < 0.5 ? -1 : 1) + width) % width
      if (f.y >= GROUND) flakes[i] = newFlake(0)
    }
  }

  if (working) {
    target = HOME
    if (x === HOME) {
      groundShift += SPEED
      for (const p of pines) {
        p.x -= SPEED
        if (!p.passed && p.x + 4 < x) {
          p.passed = true
          score += 1
          best = Math.max(best, score)
        }
      }
      pines = pines.filter(p => p.x > -5)
      const last = pines[pines.length - 1]
      if (last === undefined || last.x < width - nextGap) {
        pines.push({ x: width, passed: false })
        nextGap = rand(32, 70)
      }
      const ahead = (p: Pine) => p.x - (x + WIDTH - 1)
      if (hop < 0 && pines.some(p => ahead(p) >= 3 && ahead(p) <= 4)) hop = 0
    }
  } else {
    pines = []
    if (!walking && hop < 0) {
      rest -= 1
      if (rest <= 0) {
        rest = rand(60, 180)
        if (Math.random() < 0.25) hop = 0
        else target = rand(0, Math.max(0, width - WIDTH))
      }
    }
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

  for (let cx = 0; cx < width; cx += 1) put(cx, GROUND, gapAt(cx + groundShift) ? ' ' : '▔', GROUND_SNOW)
  for (const f of flakes) put(f.x, Math.floor(f.y), f.glyph, f.color)
  for (const p of pines) {
    put(p.x + 1, FEET - 1, '▟', PINE_TOP)
    put(p.x + 2, FEET - 1, '▙', PINE_TOP)
    put(p.x, FEET, '▟', PINE)
    put(p.x + 1, FEET, '█', PINE)
    put(p.x + 2, FEET, '█', PINE)
    put(p.x + 3, FEET, '▙', PINE)
  }
  if (best > 0 && width >= 40) {
    const pad = (n: number) => String(n).padStart(5, '0')
    const line = `HI ${pad(best)}  ${pad(score)}`
    for (const [i, ch] of [...line].entries()) put(width - line.length - 1 + i, 0, ch, SCORE)
  }
  return encode(words)
}

function clawd(): Part[] {
  const legs = hop >= 0 ? LEGS_TUCKED : (working || x !== target) && step % 4 < 2 ? LEGS_STEP : LEGS
  return [blink > 0 ? HEAD_BLINK : HEAD, BODY, legs]
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
      working = true
      score = 0
      quiet = 0
      timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      working = false
      quiet = 0
      rest = rand(20, 60)
      void $.store.set('best', best)
    }
    return next(e)
  })

  // A press on any row of him, posted by his region.
  on('ui.message', ($, e, next) => {
    if (!e.module.endsWith('clawd-sprite.tsx') || e.data !== 'jump') return next(e)
    jump()
    timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    return {}
  })

  // His regions failed to load or draw: from here on he is plain text, whole but not pressable.
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
    // Drawn again after the timer stopped for want of a band: wake the scene, unless it had settled.
    if (quiet <= SETTLE_TICKS) timer ??= $.clock.every(TICK_MS, () => { if (advance()) void update($, frame, n => n + 1) })
    working = e.props.isWorking
    const columns = Math.min(e.props.bodyColumns, 512)
    if (columns !== width) resize(columns)

    const { Box, Client, Raster, Text } = $.ui.resolve(e)
    const lift = hop >= 0 ? HOP[hop] ?? 0 : 0

    return (
      <Box width={columns} height={ROWS}>
        <Raster key="scene" columns={columns} rows={ROWS} cells={scene()} />
        {clawd().map((part, row) => (
          <Box key={`clawd-${row}`} position="absolute" top={FEET - 2 + row - lift} left={x + part.left}>
            {spriteFailed
              ? <Text color={ORANGE}>{part.text}</Text>
              : <Client key={`clawd-${row}`} module="./clawd-sprite.tsx" props={{ text: part.text, color: ORANGE }} width={[...part.text].length} height={1} />}
          </Box>
        ))}
      </Box>
    )
  })
}
