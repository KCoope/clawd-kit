import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const TICK_MS = 90
// The top of his three rows while standing; his legs stand on row 4, the ground is row 5.
const STANDING = 2
const HOP_TICKS = 10
const WIDTH = 9
const COLUMNS = 80
// GOTCHAS 15: tests that run thousands of ticks take 2 to 4 s alone and passed the kit's 5 s default on a busy
// machine (7.0 s and 6.4 s on 2026-11-22, failing as if broken); they get 30 s.
const LONG = { timeoutMs: 30_000 }
const GLYPH = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█' // bit 1 upper left, 2 upper right, 4 lower left, 8 lower right
// A scene cell belongs to a tree when its glyph colour or its background is a tree colour.
const TRUNK = 0x8b5e3c
// three greens, each a light upper tier and a darker lower one: pine, fir, spring
const GREENS = [[0x7fb38a, 0x4f8f5a], [0x6da693, 0x3b7560], [0x9dc27c, 0x5e934e]]
const TREE = new Set([...GREENS.flat(), TRUNK])
// His rows as the pixel converter draws them. Standing he is one pixel lower than the original
// Clawd so his legs meet the snow; crouched and at the top of a jump he shows the original two rows.
const TOP = '▗▄▄▄▄▄▖' // the top edge of his head, standing
const FACE = { open: '▗▟▙███▟▙▖', right: '▗▟█▟██▙▙▖', left: '▗▟▟██▙█▙▖', shut: '▗▟█████▙▖' }
const LEGS = { stand: '▝▛▛▀▜▜▘', step: '▝▜▜▀▛▛▘', tuck: '▝▜▛▀▜▛▘' }
const ORIGINAL = { head: '▐▛███▜▌', shut: '▐█████▌', body: '▝▜█████▛▘' }

const BAND = {
  plugin: 'clawd',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: COLUMNS,
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
// A crouch leaves his top row empty and the top of a jump his legs row, so either can be missing (GOTCHAS 14).
const rowBox = async (ui: Ui, r: number) => (await ui.find({ type: 'Box', key: `clawd-${r}` }))?.props as { top: number; left: number } | undefined
// Rows lifted off the ground, read from his middle row, which every pose draws.
const liftOf = async (ui: Ui) => STANDING + 1 - ((await rowBox(ui, 1))?.top ?? NaN)
const crouched = async (ui: Ui) => (await rowBox(ui, 0)) === undefined && (await liftOf(ui)) === 0

// The scene's cells, decoded: three 32-bit words a cell (glyph, colour, background), row by row.
function cellsOf(base64: string, columns = COLUMNS) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer)
  const at = (cx: number, cy: number) => (cy * columns + cx) * 3
  return {
    glyph: (cx: number, cy: number) => words[at(cx, cy)],
    colour: (cx: number, cy: number) => words[at(cx, cy) + 1],
    tree:(cx: number, cy: number) => TREE.has(words[at(cx, cy) + 1] ?? 0) || TREE.has(words[at(cx, cy) + 2] ?? 0),
    trunk: (cx: number, cy: number) => words[at(cx, cy) + 1] === TRUNK || words[at(cx, cy) + 2] === TRUNK,
    // the greens a cell shows, in its glyph and its background
    greens: (cx: number, cy: number) => [words[at(cx, cy) + 1] ?? 0, words[at(cx, cy) + 2] ?? 0].filter(c => c !== TRUNK && TREE.has(c)),
  }
}
const sceneOf = async (ui: Ui, columns = COLUMNS) => cellsOf(String((await ui.find({ key: 'scene' }))?.props.cells), columns)
const hasUpperHalf = (g: string) => (GLYPH.indexOf(g) & 3) !== 0

// The whole trees in a frame, read off the ground row (row 4): each one's middle column, whether its
// top is above Clawd's head (a pixel in the upper half of row 2), and its trunk: none, short (the
// cell's background under branches) or bare (a whole cell of trunk).
type Seen = { mid: number; tall: boolean; trunk: 'none' | 'short' | 'bare'; trunkCells: number; width: number }
function treesIn(scene: ReturnType<typeof cellsOf>): Seen[] {
  const found: Seen[] = []
  let cx = 0
  while (cx < COLUMNS) {
    if (!scene.tree(cx, 4)) {
      cx += 1
      continue
    }
    const start = cx
    while (cx < COLUMNS && scene.tree(cx, 4)) cx += 1
    if (start === 0 || cx === COLUMNS) continue // cut by the edge
    const mid = start + Math.floor((cx - start) / 2)
    const trunkCells = Array.from({ length: cx - start }, (_, i) => scene.trunk(start + i, 4)).filter(Boolean).length
    const top = String.fromCodePoint(scene.glyph(mid, 2) ?? 0x20)
    found.push({
      mid,
      width: cx - start,
      trunkCells,
      tall: scene.tree(mid, 2) && hasUpperHalf(top),
      trunk: !scene.trunk(mid, 4) ? 'none' : String.fromCodePoint(scene.glyph(mid, 4) ?? 0x20) === '█' ? 'bare' : 'short',
    })
  }
  return found
}
async function sceneHas(ui: Ui, glyphs: string[], columns = COLUMNS) {
  const { glyph } = await sceneOf(ui, columns)
  const wanted = new Set(glyphs.map(g => g.codePointAt(0)))
  for (let cy = 0; cy < 6; cy += 1) for (let cx = 0; cx < columns; cx += 1) if (wanted.has(glyph(cx, cy))) return true
  return false
}

test('Clawd stands on the snow: the original Clawd a pixel lower, in his own regions, no Button', async ($, on) => {
  await begin($, on)

  const ui = await $.ui.mount(BAND)
  const scene = await ui.find({ key: 'scene' })
  expect(scene?.type).toBe('Raster')
  expect(scene?.props.columns).toBe(COLUMNS)
  expect(scene?.props.rows).toBe(6)
  // The terminal flips a Button's colours under the pointer, which leaves holes in block art.
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  for (const [i, text] of [TOP, FACE.open, LEGS.stand].entries()) {
    expect((await ui.find({ type: 'Client', key: `clawd-${i}` }))?.props.width).toBe([...text].length)
    expect(await rowText(ui, i)).toBe(text)
    expect((await rowBox(ui, i))?.top).toBe(STANDING + i)
  }
  // his head starts on the lower half of row 2 and his legs end on the bottom of row 4, above the ground line
  expect([...TOP].some(hasUpperHalf)).toBe(false)
  expect([...LEGS.stand].some(g => (GLYPH.indexOf(g) & 12) !== 0)).toBe(true)
  expect(await ui.find({ type: 'Client', key: 'clawd-3' })).toBeUndefined()
  await ui.unmount()
})

test('a click: he crouches, springs up two rows with his legs out, and lands squashed', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
  await ui.redraw()
  expect(await crouched(ui)).toBe(true) // ready to spring: the original two rows, legs hidden
  expect(await rowText(ui, 1)).toBe(ORIGINAL.head)
  expect(await rowText(ui, 2)).toBe(ORIGINAL.body)

  await clock.advance(TICK_MS)
  expect(await liftOf(ui)).toBe(1)
  expect(await rowText(ui, 2)).toBe(LEGS.tuck) // on the way up his legs pull in

  await clock.advance(TICK_MS)
  expect(await liftOf(ui)).toBe(2)
  expect(await rowText(ui, 2)).toBe(LEGS.tuck) // no tree to clear, so his legs stay out at the top
  expect((await rowBox(ui, 0))?.top).toBe(0)

  await clock.advance(TICK_MS * (HOP_TICKS - 2))
  expect(await crouched(ui)).toBe(true) // squash on landing
  let upAgain = false // then he stands; a breathing crouch may fall on any one tick, so look at three
  for (let i = 0; i < 3; i += 1) {
    await clock.advance(TICK_MS)
    if (!(await crouched(ui))) upAgain = true
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
  expect(await liftOf(ui)).toBe(0)
  await ui.unmount()
})

test('only a left click makes him jump; a right click is left to the terminal', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'right', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await liftOf(ui)).toBe(0)
  await ui.unmount()
})

test('idle, he breathes: a crouch for two ticks in every ten, never leaving the ground', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  let crouches = 0
  for (let i = 0; i < 20; i += 1) {
    await clock.advance(TICK_MS)
    expect(await liftOf(ui)).toBe(0)
    if (await crouched(ui)) crouches += 1
  }
  expect(crouches).toBeGreaterThanOrEqual(3)
  expect(crouches).toBeLessThanOrEqual(5)
  await ui.unmount()
})

// Each tick of the scene writes `frame`: counting the writes shows whether the timer still runs.
// Registered before anything calls `$`, as the kit's hooks must be.
function countTicks(on: On) {
  const seen = { ticks: 0 }
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd' && e.key === 'frame') seen.ticks += 1
    return next(e)
  })
  return seen
}

test('after three quiet minutes he curls up asleep with z, the snow still falling slowly; a press wakes him', LONG, async ($, on) => {
  const seen = countTicks(on)
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)

  await clock.advance(200_000)
  expect(await crouched(ui)).toBe(true)
  expect(await rowText(ui, 1)).toBe(ORIGINAL.shut) // eyes shut, curled up
  expect(await rowText(ui, 2)).toBe(ORIGINAL.body)
  const held = seen.ticks
  const where = (await rowBox(ui, 1))?.left
  const before = String((await ui.find({ key: 'scene' }))?.props.cells)
  let sawZ = false
  for (let i = 0; i < 40; i += 1) {
    await clock.advance(TICK_MS)
    if (await sceneHas(ui, ['z', 'Z'])) sawZ = true
  }
  // a quarter of the pace: about one redraw in four ticks, never none (the snow used to freeze)
  expect(seen.ticks - held).toBeGreaterThanOrEqual(8)
  expect(seen.ticks - held).toBeLessThanOrEqual(12)
  expect(String((await ui.find({ key: 'scene' }))?.props.cells)).not.toBe(before)
  expect((await rowBox(ui, 1))?.left).toBe(where)
  expect(sawZ).toBe(true)

  // napping against the right edge his z still shows: bring the band's edge to him (it can shrink
  // to 21 columns, so from column 10 on he ends up against it)
  const napX = ((await rowBox(ui, 1))?.left ?? 0) - 1 // crouched, his head row starts one column in
  const narrow = Math.max(WIDTH + 12, napX + WIDTH)
  await ui.redraw({ ...BAND.props, bodyColumns: narrow })
  let edgeZ = false
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(TICK_MS)
    if (await sceneHas(ui, ['z', 'Z'], narrow)) edgeZ = true
  }
  expect(edgeZ).toBe(true)

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await liftOf(ui)).toBe(1)
  expect(await crouched(ui)).toBe(false) // awake and up, no longer curled
  expect(await sceneHas(ui, ['z', 'Z'], narrow)).toBe(false)
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

test('while Claude works he clears every tree, tucking his feet in only over the big ones, and never shares a cell with one', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(WORKING)

  let highest = 0
  let framesWithTrees = 0
  const kinds = new Set<string>()
  const touches: string[] = []
  const tops = { tucked: 0, legsOut: 0, wrong: [] as string[] }
  for (let tick = 0; tick < 600; tick += 1) {
    await clock.advance(TICK_MS)
    const scene = await sceneOf(ui)
    const { tree } = scene
    let treeHere = false
    for (let cy = 0; cy < 6; cy += 1) for (let cx = 0; cx < COLUMNS; cx += 1) if (tree(cx, cy)) treeHere = true
    if (treeHere) framesWithTrees += 1
    for (const t of treesIn(scene)) kinds.add(t.tall ? 'tall' : 'short')
    highest = Math.max(highest, await liftOf(ui))
    // at the top of a jump: feet tucked (no legs row) exactly when a big tree, one reaching row 2,
    // is beneath or just ahead of him (he runs at column 4; the next tree is 32 columns on at least)
    if ((await liftOf(ui)) === 2) {
      let bigNear = false
      for (let cx = 0; cx <= 20; cx += 1) if (tree(cx, 2)) bigNear = true
      const tucked = (await rowBox(ui, 2)) === undefined
      if (tucked) tops.tucked += 1
      else tops.legsOut += 1
      if (tucked !== bigNear) tops.wrong.push(`tick ${tick}: ${tucked ? 'tucked over a small tree' : 'legs out over a big tree'}`)
    }
    for (const r of [0, 1, 2]) {
      const box = await rowBox(ui, r)
      if (box === undefined) continue
      for (const [i, ch] of [...(await rowText(ui, r))].entries()) {
        if (ch !== ' ' && box.top >= 0 && box.top < 6 && tree(box.left + i, box.top)) touches.push(`tick ${tick} row ${r} col ${box.left + i}`)
      }
    }
  }
  expect(framesWithTrees).toBeGreaterThan(200)
  expect([...kinds].sort()).toEqual(['short', 'tall'])
  expect(highest).toBe(2)
  expect(touches).toEqual([])
  expect(tops.wrong).toEqual([])
  expect(tops.tucked).toBeGreaterThan(0)
  expect(tops.legsOut).toBeGreaterThan(0)
  await ui.unmount()
})

test('trees vary: tall ones a pixel taller than Clawd show a trunk, young ones keep branches to the snow', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(WORKING)

  const looks = new Set<string>()
  const widths = new Set<number>()
  const passing: string[] = [] // each tree's cells on rows 2 to 4, taken once as it passes column 60
  const passingGreens: string[] = [] // and its greens
  const allGreens = new Set<number>()
  let oneTone = 0
  let whole = 0
  // about 11 tall trees in 900 ticks, so the bare one can miss (1 run in 80): watch on until all four kinds show
  for (let tick = 0; tick < 3000 && !(tick >= 900 && looks.size === 4); tick += 1) {
    await clock.advance(TICK_MS)
    const scene = await sceneOf(ui)
    // nothing of a tree above row 2: a tall tip fills the upper half of row 2 and no more
    for (let cx = 0; cx < COLUMNS; cx += 1) expect(scene.tree(cx, 0) || scene.tree(cx, 1)).toBe(false)
    for (const t of treesIn(scene)) {
      whole += 1
      expect(t.trunkCells).toBeLessThanOrEqual(1) // a trunk is one cell, under the middle
      if (t.tall) expect(t.trunk).not.toBe('none') // the tall ones always show theirs
      if (t.trunk === 'none') expect(t.tall).toBe(false)
      looks.add(`${t.tall ? 'tall' : 'short'} ${t.trunk}`)
      widths.add(t.width)
      // trees move two columns a tick, so each one's middle lands on 60 or 61 exactly once
      if (t.mid === 60 || t.mid === 61) {
        let shape = ''
        const greens = new Set<number>()
        for (let cy = 2; cy <= 4; cy += 1) {
          for (let cx = t.mid - 2; cx <= t.mid + 2; cx += 1) {
            shape += scene.tree(cx, cy) ? String.fromCodePoint(scene.glyph(cx, cy) ?? 0x20) + (scene.trunk(cx, cy) ? 't' : '') : '.'
            for (const c of scene.greens(cx, cy)) greens.add(c)
          }
        }
        passing.push(shape)
        passingGreens.push([...greens].sort().join(' '))
        for (const c of greens) allGreens.add(c)
        if (greens.size < 2) oneTone += 1 // every tree has a light upper tier and a darker lower one
      }
    }
  }
  expect(oneTone).toBe(0)
  expect(allGreens.size).toBe(6) // all three greens, both tones
  expect(passingGreens.filter((g, i) => i > 0 && g === passingGreens[i - 1])).toEqual([]) // neighbours differ in green
  expect([...looks].sort()).toEqual(['short none', 'short short', 'tall bare', 'tall short'])
  expect(widths.size).toBeGreaterThan(1)
  expect(whole).toBeGreaterThan(100)
  expect(passing.length).toBeGreaterThan(25)
  expect(new Set(passing).size).toBeGreaterThanOrEqual(5) // nearly all six shapes in one long turn
  expect(passing.filter((s, i) => i > 0 && s === passing[i - 1])).toEqual([]) // never one shape twice running
  await ui.unmount()
})

test('standing his legs stay put; running they step and he looks ahead', async ($, on) => {
  const clock = await begin($, on)
  const still = await $.ui.mount(BAND)
  expect(await rowText(still, 2)).toBe(LEGS.stand)
  await still.unmount()

  const ui = await $.ui.mount(WORKING)
  const legs = new Set<string>()
  const faces = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(TICK_MS)
    if ((await liftOf(ui)) === 0 && !(await crouched(ui))) {
      legs.add(await rowText(ui, 2))
      faces.add(await rowText(ui, 1))
    }
  }
  expect([...legs].sort()).toEqual([LEGS.stand, LEGS.step].sort())
  expect([...faces]).toEqual([FACE.right])
  await ui.unmount()
})

test('work starting with him off to the right: he walks back facing left, turns, then runs facing right', LONG, async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const HOME = 4
  const leftOf = async () => (await rowBox(ui, 1))?.left ?? NaN

  // Let him wander until he is well right of where he runs (well inside three quiet minutes).
  let ticks = 0
  while ((await leftOf()) <= HOME + 8 && ticks < 1900) {
    await clock.advance(TICK_MS)
    ticks += 1
  }
  expect(await leftOf()).toBeGreaterThan(HOME + 8)

  await ui.redraw(WORKING.props)
  const seen: string[] = [] // facing on each tick: L walking back, F mid-turn, R running
  for (let i = 0; i < 80 && !(seen.length > 2 && seen[seen.length - 1] === 'R' && seen[seen.length - 2] === 'R'); i += 1) {
    await clock.advance(TICK_MS)
    const face = await rowText(ui, 1)
    const left = await leftOf()
    if (left > HOME + 1 && face === FACE.right) throw new Error(`back-pedalling: facing right at column ${left} while walking left`)
    if (face === FACE.left) seen.push('L')
    else if (face === FACE.open) seen.push('F')
    else if (face === FACE.right) seen.push('R')
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
  expect(await liftOf(ui)).toBe(1)
  await clock.advance(TICK_MS * 3)
  expect(await liftOf(ui)).toBe(0)
  await ui.unmount()
})

test('landing kicks up a puff of snow on both sides, gone a few ticks later', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const left = (await rowBox(ui, 1))?.left ?? NaN // his widest row
  // a puff is a '·' in the ground's colour; falling '·' flakes are other colours
  const puffs = async () => {
    const { glyph, colour } = await sceneOf(ui)
    return [left - 1, left + WIDTH].filter(cx => glyph(cx, 4) === '·'.codePointAt(0) && colour(cx, 4) === 0xd9dfe6).length
  }

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
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
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await sceneHas(ui, ['♥'])).toBe(true)
  await clock.advance(TICK_MS * 10)
  expect(await sceneHas(ui, ['♥'])).toBe(false)
  await ui.unmount()
})

test('/clawd hides the band and gives it back to the engine', async ($, on) => {
  await begin($, on, true)

  // as typed at the prompt: this build's command input carries args, origin and presentation
  const typed = { command: 'clawd', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: COLUMNS } } as const
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
