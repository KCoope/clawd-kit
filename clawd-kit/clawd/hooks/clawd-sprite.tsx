import type { ClientModule } from 'claude-code'

// One row of Clawd as plain text; a left click posts 'jump'. Not a Button: Buttons invert under
// the pointer and leave holes in block art (GOTCHAS 1).

type Row = { text: string; color: string }

const Sprite: ClientModule<Row> = (row, surface) => {
  surface.onPointer(e => {
    // a left click, or a terminal that names no button
    if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post('jump')
  })
  const { Text } = surface.elements
  return <Text color={row.color}>{row.text}</Text>
}

export default Sprite
