/** Redraw counter: each tick of the scene bumps it. */
export type Frame = number

declare module 'claude-code' {
  interface PluginState {
    clawd: { isOn: boolean; frame: Frame }
  }
}
