/** Web Audio 音量检测；调用方负责在离开页面时销毁。 */
import { logger } from './logger'
export function observeMicrophone(stream: MediaStream, onLevel: (level: number) => void) {
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  const source = context.createMediaStreamSource(stream)
  source.connect(analyser)
  const samples = new Uint8Array(analyser.fftSize)
  let frame = 0
  const update = () => {
    analyser.getByteTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length)
    onLevel(Math.min(1, rms * 5))
    frame = requestAnimationFrame(update)
  }
  void context.resume().catch(error => logger.warn('麦克风音量检测无法恢复音频上下文', error))
  update()
  return () => {
    cancelAnimationFrame(frame)
    source.disconnect()
    void context.close()
    onLevel(0)
  }
}
