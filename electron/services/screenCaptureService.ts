import { desktopCapturer, nativeImage, screen } from 'electron'

export interface SelectionRectangle {
  x: number
  y: number
  width: number
  height: number
}

const MAX_IMAGE_EDGE = 3200
const MIN_IMAGE_EDGE = 48
type CaptureOperationState =
  | 'IDLE'
  | 'CAPTURING_ONE_FRAME'
  | 'CROPPING'
  | 'COMPLETE'

export class ScreenCaptureService {
  private state: CaptureOperationState = 'IDLE'

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  async captureRegion(
    displayId: number,
    selection: SelectionRectangle,
  ): Promise<Buffer> {
    if (this.state !== 'IDLE') throw new Error('A screenshot capture is already active.')
    const display = screen.getAllDisplays().find((item) => item.id === displayId)
    if (!display) throw new Error('The selected display is no longer available.')

    try {
      this.state = 'CAPTURING_ONE_FRAME'
      this.log('[Capture] one-shot acquisition started')
      const requestedPixelSize = {
        width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: requestedPixelSize,
        fetchWindowIcons: false,
      })
      const source = sources.find((item) => item.display_id === String(display.id))
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error('The selected display could not be captured.')
      }
      this.log('[Capture] screenshot acquired')

      this.state = 'CROPPING'
      const capturedPixelSize = source.thumbnail.getSize()
      const dipToPixelX = capturedPixelSize.width / display.bounds.width
      const dipToPixelY = capturedPixelSize.height / display.bounds.height
      const capturePixelBounds = {
        x: Math.min(capturedPixelSize.width - 1, Math.max(0, Math.round(selection.x * dipToPixelX))),
        y: Math.min(capturedPixelSize.height - 1, Math.max(0, Math.round(selection.y * dipToPixelY))),
        width: Math.min(
          capturedPixelSize.width,
          Math.max(1, Math.round(selection.width * dipToPixelX)),
        ),
        height: Math.min(
          capturedPixelSize.height,
          Math.max(1, Math.round(selection.height * dipToPixelY)),
        ),
      }
      capturePixelBounds.width = Math.min(
        capturePixelBounds.width,
        capturedPixelSize.width - capturePixelBounds.x,
      )
      capturePixelBounds.height = Math.min(
        capturePixelBounds.height,
        capturedPixelSize.height - capturePixelBounds.y,
      )
      if (capturePixelBounds.width <= 0 || capturePixelBounds.height <= 0) {
        throw new Error('The selected screen region is empty.')
      }

      let image = source.thumbnail.crop(capturePixelBounds)
      const size = image.getSize()
      if (size.width < MIN_IMAGE_EDGE || size.height < MIN_IMAGE_EDGE) {
        throw new Error('The selected screen region is too small to analyze reliably.')
      }
      const resizeScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(size.width, size.height))
      if (resizeScale < 1) {
        image = image.resize({
          width: Math.max(1, Math.round(size.width * resizeScale)),
          height: Math.max(1, Math.round(size.height * resizeScale)),
          quality: 'best',
        })
      }
      const png = image.toPNG()
      if (
        png.byteLength < 8 ||
        !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ) throw new Error('The selected image could not be encoded as a valid PNG.')
      const decoded = nativeImage.createFromBuffer(png)
      if (decoded.isEmpty()) throw new Error('The selected image could not be decoded.')
      if (isVisuallyBlank(decoded.toBitmap())) {
        throw new Error('The selected screen region appears blank. Capture a larger visible region.')
      }
      this.state = 'COMPLETE'
      this.log('[Capture] crop complete')
      return png
    } finally {
      this.log('[Capture] screenshot resources released')
      this.state = 'IDLE'
    }
  }
}

function isVisuallyBlank(bitmap: Buffer) {
  if (bitmap.byteLength < 4) return true
  const pixelCount = bitmap.byteLength / 4
  const step = Math.max(1, Math.floor(pixelCount / 4096))
  let minimum = 255
  let maximum = 0
  let visibleSamples = 0
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4
    if (bitmap[offset + 3] === 0) continue
    visibleSamples += 1
    const luminance = Math.round(
      bitmap[offset] * 0.0722 + bitmap[offset + 1] * 0.7152 + bitmap[offset + 2] * 0.2126,
    )
    minimum = Math.min(minimum, luminance)
    maximum = Math.max(maximum, luminance)
  }
  return visibleSamples === 0 || maximum - minimum < 3
}
