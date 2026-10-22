import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TICK_MS = 90
// Clawd's body row, standing: two rows under his head, which sits two rows above his feet (row 4).
const STANDING = 3

const BAND = {
  plugin: 'clawd',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

async function begin($: Parameters<Parameters<typeof test>[1]>[0], on: On, engineDraws = false) {
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

test('Clawd stands whole in the snow: plain text in his own regions, no Button anywhere', async ($, on) => {
  await begin($, on)

  const ui = await $.ui.mount(BAND)
  const scene = await ui.find({ key: 'scene' })
  expect(scene?.type).toBe('Raster')
  expect(scene?.props.columns).toBe(80)
  expect(scene?.props.rows).toBe(6)
  // The terminal flips a Button's colours under the pointer, which leaves holes in block art.
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  const rows = ['▐▛███▜▌', '▝▜█████▛▘', '▘▘ ▝▝']
  for (const [i, text] of rows.entries()) {
    expect((await ui.find({ type: 'Client', key: `clawd-${i}` }))?.props.width).toBe([...text].length)
    expect((await ui.find({ type: 'Text', in: `clawd-${i}` }))?.text).toBe(text)
  }
  await ui.unmount()
})

test('a click on him makes him jump two rows and land again', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const bodyTop = async () => (await ui.find({ type: 'Box', key: 'clawd-1' }))?.props.top

  expect(await bodyTop()).toBe(STANDING)
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await bodyTop()).toBe(STANDING - 2)
  await clock.advance(TICK_MS * 9)
  expect(await bodyTop()).toBe(STANDING)
  await ui.unmount()
})

test('the pointer passing over him leaves him standing', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const bodyTop = async () => (await ui.find({ type: 'Box', key: 'clawd-1' }))?.props.top

  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'clawd-0' })
  await ui.pointer({ type: 'move', x: 2, y: 0, in: 'clawd-0' })
  await ui.pointer({ type: 'leave', x: 2, y: 0, in: 'clawd-0' })
  await clock.advance(TICK_MS * 2)
  expect(await bodyTop()).toBe(STANDING)
  await ui.unmount()
})

test('only a left click makes him jump; a right click is left to the terminal', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const bodyTop = async () => (await ui.find({ type: 'Box', key: 'clawd-1' }))?.props.top

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'right', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await bodyTop()).toBe(STANDING)
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

test('after three quiet minutes the scene holds still, and a click wakes him', async ($, on) => {
  const seen = countTicks(on)
  const clock = await begin($, on)
  const ui = await $.ui.mount(BAND)
  const bodyTop = async () => (await ui.find({ type: 'Box', key: 'clawd-1' }))?.props.top

  await clock.advance(200_000)
  const held = seen.ticks
  await clock.advance(TICK_MS * 20)
  expect(seen.ticks).toBe(held)
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'clawd-1' })
  await clock.advance(TICK_MS)
  expect(await bodyTop()).toBe(STANDING - 2)
  expect(seen.ticks).toBeGreaterThan(held)
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

test('while Claude works he hops the pines on his own', async ($, on) => {
  const clock = await begin($, on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })

  let highest = STANDING
  for (let i = 0; i < 60; i += 1) {
    await clock.advance(TICK_MS)
    highest = Math.min(highest, Number((await ui.find({ type: 'Box', key: 'clawd-1' }))?.props.top))
  }
  expect(highest).toBe(STANDING - 2)
  await ui.unmount()
})

test('/clawd hides the band and gives it back to the engine', async ($, on) => {
  await begin($, on, true)

  const hidden = await $.command.run({ command: 'clawd' })
  expect(hidden.text).toMatch(/hidden/)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'scene' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()

  const shown = await $.command.run({ command: 'clawd' })
  expect(shown.text).toMatch(/back/)
})

test('a narrow band is left to the engine', async ($, on) => {
  await begin($, on, true)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 12 } })
  expect(await ui.find({ key: 'scene' })).toBeUndefined()
  await ui.unmount()
})
