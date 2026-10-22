import type { ClientModule } from 'claude-code'

// One row of Clawd, drawn as plain text in a region of its own. A Button would do the same job, but
// the terminal flips a Button's colours under the pointer, and on block art that reads as chunks of
// him going missing. A region hears the click without that; a press anywhere on him asks the hooks
// module to make him jump.

type Row = { text: string; color: string }

const Sprite: ClientModule<Row> = (row, surface) => {
  surface.onPointer(e => {
    // A left click; a terminal that names no button counts as one. Right-click stays the terminal's.
    if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post('jump')
  })
  const { Text } = surface.elements
  return <Text color={row.color}>{row.text}</Text>
}

export default Sprite
