import { Canvas } from '@react-three/fiber'
import type { TimePhase } from '@shared/preferences'
import { HeroAmbientShaderPlane } from './HeroAmbientShaderPlane'

interface HeroAmbientCanvasProps {
  phase: TimePhase
  animated: boolean
  visible: boolean
}

/**
 * The actual WebGL surface for the hero ambient light field. Loaded via
 * React.lazy from HeroAmbientLightField so three.js stays out of the main
 * bundle — machines running reduced/off motion never download or parse it.
 */
export default function HeroAmbientCanvas({
  phase,
  animated,
  visible
}: HeroAmbientCanvasProps): React.JSX.Element {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{
        alpha: true,
        antialias: false,
        stencil: false,
        depth: false,
        powerPreference: 'high-performance',
        premultipliedAlpha: false
      }}
      camera={{ position: [0, 0, 1], near: 0.1, far: 10 }}
    >
      <HeroAmbientShaderPlane phase={phase} animated={animated} visible={visible} />
    </Canvas>
  )
}
