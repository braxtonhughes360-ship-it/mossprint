import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { TimePhase } from '@shared/preferences'
import { resolveColorMode } from '@shared/preferences'
import { usePreferences } from '../../context/PreferencesProvider'
import { getAmbientPalette } from './heroAmbientPalette'
import {
  heroAmbientFragmentShader,
  heroAmbientVertexShader
} from './heroAmbientFragment.glsl'

const FRAME_MS = 1000 / 30

interface HeroAmbientShaderPlaneProps {
  phase: TimePhase
  animated: boolean
  visible: boolean
}

function AmbientInvalidateLoop({ active }: { active: boolean }): null {
  const { invalidate } = useThree()

  useEffect(() => {
    if (!active) return

    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (t - last >= FRAME_MS) {
        last = t
        invalidate()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, invalidate])

  return null
}

export function HeroAmbientShaderPlane({
  phase,
  animated,
  visible
}: HeroAmbientShaderPlaneProps): React.JSX.Element {
  const { preferences } = usePreferences()
  const { invalidate } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const timeRef = useRef(0)

  const colorMode = resolveColorMode(preferences.colorMode)
  const palette = getAmbientPalette(phase, colorMode)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: palette.intensity },
      uColorLow: { value: new THREE.Vector3(...palette.low) },
      uColorMid: { value: new THREE.Vector3(...palette.mid) },
      uColorHigh: { value: new THREE.Vector3(...palette.high) }
    }),
    [palette.high, palette.intensity, palette.low, palette.mid]
  )

  useEffect(() => {
    const mat = materialRef.current
    if (!mat) return
    mat.uniforms.uIntensity.value = palette.intensity
    mat.uniforms.uColorLow.value.set(...palette.low)
    mat.uniforms.uColorMid.value.set(...palette.mid)
    mat.uniforms.uColorHigh.value.set(...palette.high)
    invalidate()
  }, [palette, invalidate])

  useEffect(() => {
    invalidate()
  }, [animated, visible, phase, colorMode, invalidate])

  useFrame((_, delta) => {
    const mat = materialRef.current
    if (!mat || !animated || !visible) return
    timeRef.current += delta
    mat.uniforms.uTime.value = timeRef.current
  })

  return (
    <>
      <AmbientInvalidateLoop active={animated && visible} />
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={heroAmbientVertexShader}
          fragmentShader={heroAmbientFragmentShader}
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.NormalBlending}
        />
      </mesh>
    </>
  )
}
