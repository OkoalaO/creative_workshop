import { useEffect, useRef, useState } from 'react'
import { Color, Mesh, Program, Renderer, Triangle } from 'ogl'
import './AuroraBackground.css'

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) { \
  int index = 0; \
  for (int i = 0; i < 2; i++) { \
    ColorStop currentColor = colors[i]; \
    bool isInBetween = currentColor.position <= factor; \
    index = int(mix(float(index), float(i), float(isInBetween))); \
  } \
  ColorStop currentColor = colors[index]; \
  ColorStop nextColor = colors[index + 1]; \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float wave = snoise(vec2(uv.x * 2.15 + uTime * 0.12, uTime * 0.22));
  float height = exp(wave * 0.34 * uAmplitude);
  height = uv.y * 2.75 - height + 0.18;
  float intensity = 0.74 * height;

  float midPoint = 0.22;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`

type AuroraBackgroundProps = {
  colorStops?: string[]
  amplitude?: number
  blend?: number
  speed?: number
}

const DEFAULT_STOPS = ['#f4b8d2', '#df82ad', '#6f8cff']

export default function AuroraBackground({
  colorStops = DEFAULT_STOPS,
  amplitude = 0.72,
  blend = 0.66,
  speed = 0.68,
}: AuroraBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ colorStops, amplitude, blend, speed })
  const [reducedMotion, setReducedMotion] = useState(false)
  const [webglFallback, setWebglFallback] = useState(false)
  propsRef.current = { colorStops, amplitude, blend, speed }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotionPreference = () => setReducedMotion(mediaQuery.matches)

    syncMotionPreference()
    mediaQuery.addEventListener('change', syncMotionPreference)

    return () => mediaQuery.removeEventListener('change', syncMotionPreference)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || reducedMotion || webglFallback) return undefined

    let renderer: Renderer
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      })
    } catch {
      setWebglFallback(true)
      return undefined
    }

    const gl = renderer.gl
    let program: Program | undefined

    let animationId = 0
    const resize = () => {
      const width = container.offsetWidth
      const height = container.offsetHeight
      renderer.setSize(width, height)
      if (program) {
        program.uniforms.uResolution.value = [width, height]
      }
    }

    try {
      gl.clearColor(0, 0, 0, 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.canvas.style.backgroundColor = 'transparent'

      window.addEventListener('resize', resize)

      const geometry = new Triangle(gl)
      if (geometry.attributes.uv) {
        delete geometry.attributes.uv
      }

      const colorStopsArray = colorStops.map((hex) => {
        const color = new Color(hex)
        return [color.r, color.g, color.b]
      })

      program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: amplitude },
          uColorStops: { value: colorStopsArray },
          uResolution: { value: [container.offsetWidth, container.offsetHeight] },
          uBlend: { value: blend },
        },
      })

      const mesh = new Mesh(gl, { geometry, program })
      container.appendChild(gl.canvas)

      const update = (time: number) => {
        animationId = requestAnimationFrame(update)
        const currentProps = propsRef.current

        if (program) {
          program.uniforms.uTime.value = time * 0.001 * currentProps.speed
          program.uniforms.uAmplitude.value = currentProps.amplitude
          program.uniforms.uBlend.value = currentProps.blend
          program.uniforms.uColorStops.value = currentProps.colorStops.map((hex) => {
            const color = new Color(hex)
            return [color.r, color.g, color.b]
          })
          renderer.render({ scene: mesh })
        }
      }

      animationId = requestAnimationFrame(update)
      resize()
    } catch {
      setWebglFallback(true)
    }

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
      if (gl.canvas.parentNode === container) {
        container.removeChild(gl.canvas)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [amplitude, blend, colorStops, reducedMotion, speed, webglFallback])

  return (
    <div
      ref={containerRef}
      className={`aurora-background ${reducedMotion || webglFallback ? 'is-static' : ''}`}
      aria-hidden="true"
    />
  )
}
