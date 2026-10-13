export interface ScrollSurface {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface WheelDelta {
  deltaY: number
  deltaMode: number
}

const LINE_HEIGHT = 18

export function consumeVerticalWheel(surface: ScrollSurface, wheel: WheelDelta): boolean {
  const maximum = Math.max(0, surface.scrollHeight - surface.clientHeight)
  if (maximum === 0 || wheel.deltaY === 0) return false

  const pixels = wheel.deltaMode === 1
    ? wheel.deltaY * LINE_HEIGHT
    : wheel.deltaMode === 2
      ? wheel.deltaY * Math.max(1, surface.clientHeight)
      : wheel.deltaY
  const next = Math.min(maximum, Math.max(0, surface.scrollTop + pixels))
  if (Math.abs(next - surface.scrollTop) < 0.01) return false
  surface.scrollTop = next
  return true
}
