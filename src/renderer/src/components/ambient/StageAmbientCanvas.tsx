import { Canvas } from '@react-three/fiber'
import type { TimePhase } from '@shared/preferences'
import { StageAmbientPlane } from './StageAmbientPlane'

interface StageAmbientCanvasProps {
  phase: TimePhase
  animated: boolean
  visible: boolean
}

/**
 * The actual WebGL surface for the stage ambient field. Loaded via React.lazy
 * from StageAmbientField so three.js stays out of the main bundle — machines
 * running reduced/off motion never download or parse it.
 */
export default function StageAmbientCanvas({
  phase,
  animated,
  visible
}: StageAmbientCanvasProps): React.JSX.Element {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
        premultipliedAlpha: false
      }}
      camera={{ position: [0, 0, 1], near: 0.1, far: 10 }}
    >
      <StageAmbientPlane phase={phase} animated={animated} visible={visible} />
    </Canvas>
  )
}
