import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const TICK_MS = 90
// His head row's top, standing: one row above his legs, which stand on row 4.
const STANDING = 3
const HOP_TICKS = 12
// The test kit fails any test past 5 s; the nap, mountain and turn-around tests run thousands of
// ticks and can pass 5 s on a busy machine (GOTCHAS 15), so they get 30 s.
const LONG = { timeoutMs: 30_000 }
const WIDTH = 7
const MOUNTAIN = new Set(['▟', '▙', '█'].map(g => g.codePointAt(0)))
// His rows as the pixel converter draws them (7 wide, 2 rows).
const HEAD = { open: '▄█▜█▛█▄', right: '▄█▛██▜▄', left: '▄▛██▜█▄', shut: '▄█████▄', crouch: '▄▄▄▄▄' }
const LEGS = { stand: '▜▜▀▛▛', step: '▛▛▀▜▜', curled: '▀█████▀' }

const BAND = {
  plugin: 'clawd-peaks',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const
const WORKING = { ...BAND, props: { ...BAND.props, isWorking: true } }

async function begin($: Parameters<TestBody>[0], on: On, engineDraws = false) {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'clawd' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (engineDraws) {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>engine</Text>
    })
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return clock
}

// What the helpers need of a mounted band: its `find`.
type Ui = { find: (query: { type?: string; key?: string; in?: string }) => Promise<{ text?: string; props: Record<string, unknown> } | undefined> }
const rowText = async (ui: Ui, r: number) => String((await ui.find({ type: 'Text', in: `clawd-${r}` }))?.text)
const rowBox = async (ui: Ui, r: number) => (await ui.find({ type: 'Box', key: `clawd-${r}` }))?.props as { top: number; left: number }

// The scene's cells, decoded: three 32-bit words a cell (glyph, colour, background), row by row.
// `word` 0 reads the glyph, 1 its colour.
function cellsOf(base64: string, columns: number) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer)
  return (cx: number, cy: number, word = 0) => words[(cy * columns + cx) * 3 + word]
}
async function sceneHas(ui: Ui, glyphs: string[], columns = 80) {
  const glyphAt = cellsOf(String((await ui.find({ key: 'scene' }))?.props.cells), columns)
  const wanted = new Set(glyphs.map(g => g.codePointAt(0)))
  for (let cy = 0; cy < 6; cy += 1) for (let cx = 0; cx < columns; cx += 1) if (wanted.has(glyphAt(cx, cy))) return true
  return false
}

test('he stands whole in the snow: two rows of plain text in his own regions, no Button', async ($, on) => {
  await begin($, on)

  const ui = await $.ui.mount(BAND)
  const scene = await ui.find({ key: 'scene' })
  expect(scene?.type).toBe('Raster')
  expect(scene?.props.columns).toBe(80)
  expect(scene?.props.rows).toBe(6)
  // The terminal flips a Button's colours under the pointer, which leaves holes in block art.
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  for (const [i, text] of [HEAD.open, LEGS.stand].entries()) {
    expect((await ui.find({ type: 'Client', key: `clawd-${i}` }))?.props.width).toBe([...text].length)
    expect(await rowText(ui, i)).toBe(text)
  }
  expect((await rowBox(ui, 0)).left + WIDTH - 1).toBe((await rowBox(ui, 1)).left + 5) // legs sit inside his width
  expect(await ui.find({ type: 'Client', key: 'clawd-2' })).toBeUndefined()
  await ui.unmount()
})

test('a click: he crouches, springs up three rows, and lands squashed', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'clawd-0' })
  await ui.redraw()
  expect(await rowText(ui, 0)).toBe(HEAD.crouch) // ready to spring
  expect((await rowBox(ui, 0)).top).toBe(STANDING)
  for (const top of [STANDING - 1, STANDING - 2, STANDING - 3]) {
    await clock.advance(TICK_MS)
    expect((await rowBox(ui, 0)).top).toBe(top)
  }
  expect(await rowText(ui, 0)).not.toBe(HEAD.crouch) // stretched out in the air (open or blinking)
  await clock.advance(TICK_MS * (HOP_TICKS - 3))
  expect((await rowBox(ui, 0)).top).toBe(STANDING)
  expect(await rowText(ui, 0)).toBe(HEAD.crouch) // squash on landing
  let upAgain = false // then he stands; a breathing crouch may fall on any one tick, so look at three
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(TICK_MS)
    if ((await rowText(ui, 0)) !== HEAD.crouch) upAgain = true
  }
  expect(upAgain).toBe(true)
  await ui.unmount()
})

test('the pointer passing over him leaves him on the ground', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'clawd-0' })
  await ui.pointer({ type: 'move', x: 2, y: 0, in: 'clawd-0' })
  await ui.pointer({ type: 'leave', x: 2, y: 0, in: 'clawd-0' })
  await clock.advance(TICK_MS * 2)
  expect((await rowBox(ui, 0)).top).toBe(STANDING)
  await ui.unmount()
})

test('only a left click makes him jump; a right click is left to the terminal', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'right', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect((await rowBox(ui, 0)).top).toBe(STANDING)
  await ui.unmount()
})

test('idle, he breathes: a crouch for two ticks in every ten, never leaving the ground', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  let crouched = 0
  for (let i = 0; i < 20; i += 1) {
    await clock.advance(TICK_MS)
    expect((await rowBox(ui, 0)).top).toBe(STANDING)
    if ((await rowText(ui, 0)) === HEAD.crouch) crouched += 1
  }
  expect(crouched).toBeGreaterThanOrEqual(3)
  expect(crouched).toBeLessThanOrEqual(5)
  await ui.unmount()
})

// Each tick of the scene writes `frame`: counting the writes shows whether the timer still runs.
// Registered before anything calls `$`, as the kit's hooks must be.
function countTicks(on: On) {
  const seen = { ticks: 0 }
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-peaks' && e.key === 'frame') seen.ticks += 1
    return next(e)
  })
  return seen
}

test('after three quiet minutes he curls up asleep with z, the snow still falling slowly; a press wakes him', LONG, async ($, on) => {
  const seen = countTicks(on)
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await clock.advance(200_000)
  expect(await rowText(ui, 0)).toBe(HEAD.crouch)
  expect(await rowText(ui, 1)).toBe(LEGS.curled) // eyes shut, curled up
  const held = seen.ticks
  const where = (await rowBox(ui, 0)).left
  const before = String((await ui.find({ key: 'scene' }))?.props.cells)
  let sawZ = false
  for (let i = 0; i < 40; i += 1) {
    await clock.advance(TICK_MS)
    if (await sceneHas(ui, ['z', 'Z'])) sawZ = true
  }
  // a quarter of the pace: about one redraw in four ticks, never none
  expect(seen.ticks - held).toBeGreaterThanOrEqual(8)
  expect(seen.ticks - held).toBeLessThanOrEqual(12)
  expect(String((await ui.find({ key: 'scene' }))?.props.cells)).not.toBe(before)
  expect((await rowBox(ui, 0)).left).toBe(where)
  expect(sawZ).toBe(true)

  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'clawd-0' })
  await clock.advance(TICK_MS)
  expect((await rowBox(ui, 0)).top).toBe(STANDING - 1)
  expect(await rowText(ui, 0)).not.toBe(HEAD.crouch) // awake and up, no longer curled
  expect(await sceneHas(ui, ['z', 'Z'])).toBe(false)
  await ui.unmount()
})

test('napping against the right edge his z shows on his left', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  // the band shrinks no narrower than 19 columns, so bring its edge to a nap from column 12 on
  let napX = 0
  for (let nap = 0; nap < 4 && napX < 12; nap += 1) {
    if (nap > 0) await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'clawd-0' })
    await clock.advance(200_000)
    napX = (await rowBox(ui, 1)).left
  }
  expect(napX).toBeGreaterThanOrEqual(12)
  const narrow = napX + WIDTH
  await ui.redraw({ ...BAND.props, bodyColumns: narrow })
  expect(await rowText(ui, 1)).toBe(LEGS.curled)
  let sawZ = false
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(TICK_MS)
    if (await sceneHas(ui, ['z', 'Z'], narrow)) sawZ = true
  }
  expect(sawZ).toBe(true)
  await ui.unmount()
})

test('a band drawn after the timer gave up starts the scene again', async ($, on) => {
  const seen = countTicks(on)
  const clock = await begin($, on)
  await clock.advance(TICK_MS * 3) // ticks with no band drawn yet: the timer stops
  const ui = await $.ui.mount(BAND)
  const before = seen.ticks
  await clock.advance(TICK_MS * 3)
  expect(seen.ticks).toBeGreaterThan(before)
  await ui.unmount()
})

test('while Claude works he clears every mountain and never touches one', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(WORKING)

  let highest = STANDING
  let framesWithMountains = 0
  const touches: string[] = []
  for (let tick = 0; tick < 300; tick += 1) {
    await clock.advance(TICK_MS)
    const glyphAt = cellsOf(String((await ui.find({ key: 'scene' }))?.props.cells), 80)
    let mountainHere = false
    for (let cy = 0; cy < 6; cy += 1) for (let cx = 0; cx < 80; cx += 1) if (MOUNTAIN.has(glyphAt(cx, cy))) mountainHere = true
    if (mountainHere) framesWithMountains += 1
    for (const r of [0, 1]) {
      const { top, left } = await rowBox(ui, r)
      if (r === 0) highest = Math.min(highest, top)
      for (const [i, ch] of [...(await rowText(ui, r))].entries()) {
        if (ch !== ' ' && top >= 0 && top < 6 && MOUNTAIN.has(glyphAt(left + i, top))) touches.push(`tick ${tick} row ${r} col ${left + i}`)
      }
    }
  }
  expect(framesWithMountains).toBeGreaterThan(30)
  expect(highest).toBe(STANDING - 3)
  expect(touches).toEqual([])
  await ui.unmount()
})

test('standing his legs stay apart; running they step and he looks ahead', async ($, on) => {
  const clock = await begin($, on)
  const still = await $.ui.mount(BAND)
  expect(await rowText(still, 1)).toBe(LEGS.stand)
  await still.unmount()

  const ui = await $.ui.mount(WORKING)
  const legs = new Set<string>()
  const heads = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(TICK_MS)
    if ((await rowBox(ui, 0)).top === STANDING) {
      legs.add(await rowText(ui, 1))
      heads.add(await rowText(ui, 0))
    }
  }
  expect([...legs].sort()).toEqual([LEGS.stand, LEGS.step].sort())
  expect([...heads]).toEqual([HEAD.right])
  await ui.unmount()
})

test('work starting with him off to the right: he walks back facing left, turns, then runs facing right', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const HOME = 4

  // Let him wander until he is well right of where he runs (well inside three quiet minutes).
  let ticks = 0
  while ((await rowBox(ui, 0)).left <= HOME + 8 && ticks < 1900) {
    await clock.advance(TICK_MS)
    ticks += 1
  }
  expect((await rowBox(ui, 0)).left).toBeGreaterThan(HOME + 8)

  await ui.redraw(WORKING.props)
  const seen: string[] = [] // facing on each tick: L walking back, F mid-turn, R running
  for (let i = 0; i < 80 && !(seen.length > 2 && seen[seen.length - 1] === 'R' && seen[seen.length - 2] === 'R'); i += 1) {
    await clock.advance(TICK_MS)
    const head = await rowText(ui, 0)
    const left = (await rowBox(ui, 0)).left
    if (left > HOME + 1 && head === HEAD.right) throw new Error(`back-pedalling: facing right at column ${left} while walking left`)
    if (head === HEAD.left) seen.push('L')
    else if (head === HEAD.open) seen.push('F')
    else if (head === HEAD.right) seen.push('R')
  }
  const order = seen.filter((s, i) => s !== seen[i - 1]).join('')
  expect(order).toBe('LFR')
  await ui.unmount()
})

test('he notices work starting: a "!" over his head for a moment', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  expect(await sceneHas(ui, ['!'])).toBe(false)
  await ui.redraw(WORKING.props)
  expect(await sceneHas(ui, ['!'])).toBe(true)
  await clock.advance(TICK_MS * 10)
  expect(await sceneHas(ui, ['!'])).toBe(false)
  await ui.unmount()
})

test('when work ends he gives a happy little hop', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(WORKING)
  await clock.advance(TICK_MS * 3)

  await ui.redraw(BAND.props)
  await clock.advance(TICK_MS)
  expect((await rowBox(ui, 0)).top).toBe(STANDING - 1)
  await clock.advance(TICK_MS * 3)
  expect((await rowBox(ui, 0)).top).toBe(STANDING)
  await ui.unmount()
})

test('landing kicks up a puff of snow on both sides, gone a few ticks later', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const left = (await rowBox(ui, 0)).left // his widest row
  // a puff is a '·' in the ground's colour; falling '·' flakes are other colours
  const puffs = async () => {
    const cellAt = cellsOf(String((await ui.find({ key: 'scene' }))?.props.cells), 80)
    return [left - 1, left + WIDTH].filter(cx => cellAt(cx, 4) === '·'.codePointAt(0) && cellAt(cx, 4, 1) === 0xd9e4f0).length
  }

  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'clawd-0' })
  await clock.advance(TICK_MS * HOP_TICKS)
  expect(await puffs()).toBe(2)
  await clock.advance(TICK_MS * 4)
  expect(await puffs()).toBe(0)
  await ui.unmount()
})

test('a press sends a heart floating up beside him, gone a moment later', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  expect(await sceneHas(ui, ['♥'])).toBe(false)
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'clawd-0' })
  await clock.advance(TICK_MS)
  expect(await sceneHas(ui, ['♥'])).toBe(true)
  await clock.advance(TICK_MS * 10)
  expect(await sceneHas(ui, ['♥'])).toBe(false)
  await ui.unmount()
})

test('/clawd hides the band and gives it back to the engine', async ($, on) => {
  await begin($, on, true)

  // as typed at the prompt: this build's command input carries args, origin and presentation
  const typed = { command: 'clawd', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  const hidden = await $.command.run(typed)
  expect(hidden.text).toMatch(/hidden/)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'scene' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()

  const shown = await $.command.run(typed)
  expect(shown.text).toMatch(/back/)
})

test('a narrow band is left to the engine', async ($, on) => {
  await begin($, on, true)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 12 } })
  expect(await ui.find({ key: 'scene' })).toBeUndefined()
  await ui.unmount()
})
