import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  MultiplyBlending,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";
import CURL_NOISE_GLSL from "./shaders/curlNoise.glsl?raw";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  FIELD_SPIN,
  STAR_MOUSE_LERP,
  STAR_MOUSE_PARALLAX,
  VORTEX_MAX_R,
  pointerNdcFromEvent,
} from "./vortex-motion";

type VortexQuality = {
  particleCount: number;
  octaves: number;
  bloom: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomSmoothing: number;
  dpr: number | [number, number];
  pointSize: number;
  curlAmp: number;
  streaks: boolean;
  dof: boolean;
  starCount: number;
  dustCount: number;
  gasOctaves: number;
  /** Multiplier on gas density/alpha — raised when bloom is off. */
  gasGain: number;
  /** Multiplier on particle sprite alpha — raised slightly when bloom is off. */
  sparkGain: number;
  coreBoost: number;
};

export type VortexShaderProps = {
  onContextLost: () => void;
  onReady: () => void;
};

/**
 * Actually allocate a 4×4 half-float color attachment and check framebuffer
 * completeness. Extension presence alone is not enough — Safari often lists
 * EXT_color_buffer_half_float and still returns FRAMEBUFFER_INCOMPLETE.
 */
function probeHalfFloatFbo(): boolean {
  if (typeof document === "undefined") return false;

  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const attrs: WebGLContextAttributes = {
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  };

  try {
    const gl2 = canvas.getContext("webgl2", attrs);
    if (gl2) {
      const ok = testHalfFloatAttachment(gl2, true);
      gl2.getExtension("WEBGL_lose_context")?.loseContext();
      return ok;
    }

    const gl1 = canvas.getContext("webgl", attrs) ?? canvas.getContext("experimental-webgl", attrs);
    if (!gl1 || !("createFramebuffer" in gl1)) return false;
    const ok = testHalfFloatAttachment(gl1 as WebGLRenderingContext, false);
    (gl1 as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function testHalfFloatAttachment(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  isWebGL2: boolean,
): boolean {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) return false;

  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.getExtension("EXT_color_buffer_float");
      gl2.getExtension("EXT_color_buffer_half_float");
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA16F, 4, 4, 0, gl2.RGBA, gl2.HALF_FLOAT, null);
    } else {
      const halfBuf = gl.getExtension("EXT_color_buffer_half_float");
      const halfTex = gl.getExtension("OES_texture_half_float");
      if (!halfBuf || !halfTex) return false;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, halfTex.HALF_FLOAT_OES, null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!complete) return false;

    gl.viewport(0, 0, 4, 4);
    gl.clearColor(0.2, 0.4, 0.8, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
  }
}

function detectLowPower(): boolean {
  const cores = navigator.hardwareConcurrency ?? 8;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches ||
    cores <= 4
  );
}

function detectQuality(halfFloatFbo: boolean): VortexQuality {
  const lowPower = detectLowPower();
  const bloom = halfFloatFbo && !lowPower;
  const noBloomBoost = !bloom;

  if (lowPower) {
    return {
      particleCount: 1600,
      octaves: 2,
      bloom: false,
      bloomIntensity: 0.08,
      bloomThreshold: 0.72,
      bloomSmoothing: 0.35,
      dpr: 1,
      pointSize: 0.05,
      curlAmp: 0.036,
      streaks: false,
      dof: false,
      starCount: 140,
      dustCount: 0,
      gasOctaves: 3,
      gasGain: 1.38,
      sparkGain: 1.18,
      coreBoost: 0.62,
    };
  }

  return {
    particleCount: 4200,
    octaves: 3,
    bloom,
    bloomIntensity: 0.08,
    bloomThreshold: 0.72,
    bloomSmoothing: 0.35,
    dpr: [1, 1.5],
    pointSize: 0.04,
    curlAmp: 0.048,
    streaks: true,
    dof: true,
    starCount: 180,
    dustCount: 800,
    gasOctaves: 5,
    gasGain: noBloomBoost ? 1.32 : 1.0,
    sparkGain: noBloomBoost ? 1.15 : 1.0,
    coreBoost: noBloomBoost ? 0.62 : 0.55,
  };
}

const ARM_COUNT = 2;
const SPIRAL_PITCH = 9.8;
const MIN_R = 0.48;
const MAX_R = VORTEX_MAX_R;
const CAMERA_INCLINATION = (48 * Math.PI) / 180;
const CAMERA_POSITION: [number, number, number] = [
  0,
  Math.sin(CAMERA_INCLINATION) * CAMERA_DISTANCE,
  Math.cos(CAMERA_INCLINATION) * CAMERA_DISTANCE,
];

function createParticleGeometry(count: number): BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const kind = Math.random();
    const u = Math.random();
    const r = MIN_R + Math.pow(u, 0.78) * (MAX_R - MIN_R);
    const logR = Math.log(r);
    const arm = i % ARM_COUNT;
    const armBase = (arm / ARM_COUNT) * Math.PI * 2 + SPIRAL_PITCH * logR;

    // Highlights only — the gas disk carries the continuous filaments.
    let jitter = 0.07;
    if (kind > 0.82) jitter = 0.09;
    else if (kind < 0.28) jitter = 0.13;
    const ang = armBase + (Math.random() - 0.5) * jitter;

    const inward = Math.pow((MAX_R - r) / (MAX_R - MIN_R), 1.35);
    const z = (Math.random() - 0.5) * 0.04 - inward * 0.11;

    positions[i * 3] = Math.cos(ang) * r;
    positions[i * 3 + 1] = Math.sin(ang) * r;
    positions[i * 3 + 2] = z;

    seeds[i] = Math.random();
    if (kind > 0.82) {
      sizes[i] = 0.82 + Math.random() * 0.32;
      brightness[i] = 0.48 + Math.random() * 0.22;
    } else {
      sizes[i] = 0.36 + Math.random() * 0.26;
      brightness[i] = 0.24 + Math.random() * 0.2;
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geo.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geo.setAttribute("aBrightness", new BufferAttribute(brightness, 1));
  geo.computeBoundingSphere();
  return geo;
}

function createDustGeometry(count: number): BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const r = MIN_R + 0.14 + Math.pow(u, 0.7) * (MAX_R - MIN_R - 0.14);
    const logR = Math.log(r);
    const arm = i % ARM_COUNT;
    // Sit in the trough between the two luminous arms.
    const lane = ((arm + 0.5) / ARM_COUNT) * Math.PI * 2 + SPIRAL_PITCH * logR;
    const ang = lane + (Math.random() - 0.5) * 0.42;
    const inward = Math.pow((MAX_R - r) / (MAX_R - MIN_R), 1.35);
    const z = (Math.random() - 0.5) * 0.05 - inward * 0.09;

    positions[i * 3] = Math.cos(ang) * r;
    positions[i * 3 + 1] = Math.sin(ang) * r;
    positions[i * 3 + 2] = z;
    seeds[i] = Math.random();
    sizes[i] = 1.35 + Math.random() * 1.1;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geo.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geo.computeBoundingSphere();
  return geo;
}

function createStarGeometry(count: number): BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Keep stars outside the hole so the core stays black, not a starfield window.
    const r = 1.55 + Math.pow(Math.random(), 0.55) * 2.15;
    const z = -0.45 - Math.random() * 2.4;
    const ang = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(ang) * r;
    positions[i * 3 + 1] = Math.sin(ang) * r;
    positions[i * 3 + 2] = z;
    seeds[i] = Math.random();
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geo.computeBoundingSphere();
  return geo;
}

const VORTEX_ADVANCE = /* glsl */ `
const float TAU = 6.28318530718;
const float ARM_N = 2.0;
const float PITCH = 9.8;
const float R_MIN = 0.48;
const float R_MAX = 1.84;
const float INFLOW = 0.032;
const float PATTERN_SPIN = 0.68;

float wrapTau(float a) {
  return a - TAU * floor(a / TAU);
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Crawl along the spawned log-spiral toward the hole, then wrap at the rim.
// dθ = PITCH · d(log r) so inner radii sweep faster without shearing the pattern.
// Pattern spin is a single Ω — never ω(r)·t, which winds arms into a ring.
vec3 vortexAdvance(vec3 rest, float t) {
  float r = max(length(rest.xy), 0.05);
  float restAng = atan(rest.y, rest.x);
  float span = R_MAX - R_MIN;
  float u = clamp((r - R_MIN) / span, 0.0, 0.9999);
  float uFlow = fract(u - t * INFLOW);
  float rNew = R_MIN + uFlow * span;
  float angNew = restAng + PITCH * (log(max(rNew, 0.05)) - log(r));
  float twist = wrapTau(t * PATTERN_SPIN);
  float shear = sin(wrapTau(t * 0.19)) * (0.06 / (rNew + 0.2));
  vec2 xy = rot2(vec2(cos(angNew), sin(angNew)) * rNew, wrapTau(twist + shear));
  float z = rest.z - (r - rNew) * 0.05;
  return vec3(xy, z);
}
`;

const VERTEX_SHADER = `${CURL_NOISE_GLSL}
${VORTEX_ADVANCE}

attribute float aSeed;
attribute float aSize;
attribute float aBrightness;

uniform float uTime;
uniform vec2 uMouse;
uniform float uOctaves;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform float uSize;
uniform float uCurlAmp;
uniform float uTempVariance;
uniform float uRimDark;
uniform float uStreak;
uniform float uDof;
uniform float uDofBoost;
uniform float uSparkGain;

varying vec3 vColor;
varying float vAlpha;
varying float vHotspot;
varying float vStretch;
varying float vSoft;
varying vec2 vScreenTan;

// Inverse Oklab (Ottosson). Mix in Lab so the hue path stays even; RGB lerp
// dipped through muddy magenta at mid-radius.
vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0897336600 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

// Time lives on a unit circle so curl/snoise never see an unbounded clock.
vec3 timeOrbit(float t, float speed, float phase) {
  float a = wrapTau(t * speed + phase);
  float b = wrapTau(t * speed * 0.81 + phase * 1.37);
  return vec3(cos(a), sin(a), sin(b));
}

void main() {
  vec3 rest = position;
  float r = max(length(rest.xy), 0.05);
  vec3 pos = vortexAdvance(rest, uTime);

  vec3 orbit = timeOrbit(uTime, 0.17, aSeed * TAU);
  vec3 curlP = pos * 1.35 + orbit * 0.28 + vec3(uMouse * 0.08, 0.0);
  vec3 flow = curlFbm(curlP, uOctaves);

  // Curl is turbulence along the vortex, not a 3D scramble into a blob.
  float rNow = max(length(pos.xy), 0.05);
  vec2 radial = pos.xy / rNow;
  vec2 tangent = vec2(-radial.y, radial.x);
  float amp = uCurlAmp * mix(0.45, 1.0, smoothstep(0.5, 1.7, rNow));
  pos.xy += tangent * dot(flow.xy, tangent) * amp;
  pos.xy += radial * dot(flow.xy, radial) * amp * 0.22;
  pos.z += flow.z * amp * 0.1;

  float r2 = length(pos.xy);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 0.12);
  float atten = uViewportHeight / dist;

  float hotspot = smoothstep(0.70, 1.35, aSize);
  float orbitStretch = mix(2.15, 1.12, smoothstep(0.48, 1.72, r2));
  float stretch = mix(1.0, mix(orbitStretch, uStreak, hotspot * hotspot), step(1.05, uStreak));

  vec2 ndc = gl_Position.xy / max(gl_Position.w, 1e-4);
  float screenR = length(ndc);
  float dof = max(smoothstep(0.82, 1.68, r2), smoothstep(0.34, 0.9, screenR)) * uDof;

  gl_PointSize = clamp(
    uSize * aSize * atten * uPixelRatio * stretch * mix(1.0, uDofBoost, dof),
    0.9,
    64.0
  );

  vec4 mvTan = mv + modelViewMatrix * vec4(tangent, 0.0, 0.0);
  vec4 clipTan = projectionMatrix * mvTan;
  vec2 ndcTan = clipTan.xy / max(clipTan.w, 1e-4);
  vec2 screenTan = ndcTan - ndc;
  vScreenTan = dot(screenTan, screenTan) > 1e-10 ? normalize(screenTan) : vec2(1.0, 0.0);

  // Arm mask in rest-space so membership stays locked while motes crawl inward.
  float restAng = atan(rest.y, rest.x);
  float armPhase = ARM_N * (restAng - PITCH * log(r));
  float armNoise = snoise(vec3(rest.xy * 0.85, aSeed));
  float armSharp = mix(1.55, 2.65, 0.5 + 0.5 * armNoise);
  float armCore = pow(clamp(0.5 + 0.5 * cos(armPhase), 0.0, 1.0), armSharp);
  float arm = mix(0.10, 1.0, armCore);

  float hole = smoothstep(0.36, 0.50, r2);
  float disk = 1.0 - smoothstep(1.42, 1.92, r2);
  float innerRim = smoothstep(0.50, 0.64, r2) * (1.0 - smoothstep(0.64, 1.08, r2));
  float photon = smoothstep(0.50, 0.58, r2) * (1.0 - smoothstep(0.58, 0.72, r2));

  // Hot inner (blue-white) → dimmer outer. Accretion, not champagne jewelry.
  float rt = smoothstep(0.50, 1.15, r2);
  vec3 hotLab   = vec3(0.82, -0.016, -0.068);
  vec3 midLab   = vec3(0.74, -0.006, -0.028);
  vec3 outerLab = vec3(0.62,  0.008,  0.012);
  vec3 lab = mix(hotLab, midLab, rt);
  lab = mix(lab, outerLab, smoothstep(1.05, 1.72, r2));

  // aSeed also phases curl; reuse as star type so the field mixes K/G/A tints
  // without a second attribute. Shift is on Lab b (yellow–blue), not RGB.
  float star = aSeed * 2.0 - 1.0;
  lab.z += star * uTempVariance;
  lab.y += star * uTempVariance * 0.22;

  vec3 col = max(oklabToLinear(lab), vec3(0.0));
  float coreGlow = 1.0 - smoothstep(0.50, 1.12, r2);
  col *= 0.22 + innerRim * 0.75 + aBrightness * 0.22 + coreGlow * 0.32;
  col *= mix(1.12, 0.4, smoothstep(0.50, 1.55, r2));
  col += vec3(0.62, 0.74, 0.98) * photon * 0.55;

  float proximity = smoothstep(8.0, 3.4, dist);
  float pulse = 0.5 + 0.5 * sin(wrapTau(r2 * 9.0) - wrapTau(uTime * 1.55));

  float rim = smoothstep(0.50, 1.58, r2);
  float rimDim = mix(1.15, 1.0 - 0.88 * uRimDark, rim);
  rimDim = mix(rimDim, max(rimDim, 0.38), hotspot);

  vColor = col;
  vAlpha = aBrightness * hole * disk * arm * mix(0.55, 1.0, proximity) * (0.88 + 0.12 * pulse) * rimDim * uSparkGain;
  vHotspot = hotspot;
  vStretch = stretch;
  vSoft = dof;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHotspot;
varying float vStretch;
varying float vSoft;
varying vec2 vScreenTan;

uniform float uCoreBoost;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  if (vStretch > 1.05) {
    vec2 t = vScreenTan;
    vec2 n = vec2(-t.y, t.x);
    uv = vec2(dot(uv, t), dot(uv, n) * vStretch);
  }
  float dist = length(uv) * 2.0;
  if (dist >= 1.0) discard;

  float glowInner = mix(0.16, 0.0, vSoft);
  float glow = 1.0 - smoothstep(glowInner, 1.0, dist);
  float coreR = mix(mix(0.18, 0.34, vHotspot), 0.55, vSoft);
  float core = 1.0 - smoothstep(0.0, coreR, dist);
  float pin = 1.0 - smoothstep(0.0, mix(0.08, 0.2, vSoft), dist);

  float sprite = glow * mix(0.32, 0.18, vHotspot)
    + core * mix(0.1, 0.32, vHotspot) * uCoreBoost
    + pin * mix(0.02, 0.18, vHotspot) * uCoreBoost;

  float a = sprite * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const STAR_VERTEX = /* glsl */ `
attribute float aSeed;

uniform vec2 uMouse;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform float uParallax;
uniform float uTime;
uniform float uFieldSpin;
uniform float uMaxR;
uniform float uMaskSolid;
uniform float uMaskEdge;
uniform vec2 uMaskCenter;

varying vec3 vColor;
varying float vAlpha;

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec3 pos = position;
  // Same Ω(u) as VortexAtmosphere motes (u = 1 at the vortex rim).
  float u = max(length(pos.xy) / uMaxR, 0.05);
  float speedMul = mix(0.55, 1.1, aSeed);
  float omega = uFieldSpin * speedMul * (0.85 / (u + 0.35));
  pos.xy = rot2(pos.xy, uTime * omega);

  pos.xy += uMouse * uParallax * mix(0.55, 1.35, aSeed);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.2);
  float spark = step(0.9, aSeed);
  float size = clamp(
    mix(2.4, 5.5, aSeed) * (uViewportHeight / dist) * 0.032 * uPixelRatio * mix(1.0, 1.8, spark),
    1.2,
    9.0
  );

  // Card-edge falloff — matches .vortex-card --vortex-mask / --vortex-mask-edge.
  vec2 ndc = gl_Position.xy / max(gl_Position.w, 1e-4);
  vec2 origin = vec2(uMaskCenter.x * 2.0 - 1.0, 1.0 - uMaskCenter.y * 2.0);
  float radial = 1.0 - smoothstep(uMaskSolid, 1.0, length(ndc - origin));
  float e = uMaskEdge * 2.0;
  float fadeX = smoothstep(-1.0, -1.0 + e, ndc.x) * (1.0 - smoothstep(1.0 - e, 1.0, ndc.x));
  float fadeY = smoothstep(-1.0, -1.0 + e, ndc.y) * (1.0 - smoothstep(1.0 - e, 1.0, ndc.y));
  float cardMask = radial * fadeX * fadeY;

  gl_PointSize = size * mix(0.25, 1.0, cardMask);

  vec3 cool = vec3(0.62, 0.74, 1.0);
  vec3 warm = vec3(1.0, 0.86, 0.62);
  vColor = mix(cool, warm, aSeed * 0.45);
  vAlpha = (mix(0.32, 0.7, aSeed) + spark * 0.4) * cardMask;
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  if (vAlpha < 0.012) discard;
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p) * 2.0;
  if (d >= 1.0) discard;
  float g = 1.0 - smoothstep(0.0, 1.0, d);
  float a = g * g * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const DUST_VERTEX = `${CURL_NOISE_GLSL}
${VORTEX_ADVANCE}

attribute float aSeed;
attribute float aSize;

uniform float uTime;
uniform vec2 uMouse;
uniform float uOctaves;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform float uSize;
uniform float uCurlAmp;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 pos = vortexAdvance(position, uTime);
  vec3 orbit = vec3(
    cos(wrapTau(uTime * 0.14 + aSeed * TAU)),
    sin(wrapTau(uTime * 0.14 + aSeed * TAU)),
    sin(wrapTau(uTime * 0.11 + aSeed * 1.37))
  );
  vec3 flow = curlFbm(pos * 1.15 + orbit * 0.22 + vec3(uMouse * 0.06, 0.0), uOctaves);
  float rNow = max(length(pos.xy), 0.05);
  vec2 radial = pos.xy / rNow;
  vec2 tangent = vec2(-radial.y, radial.x);
  float amp = uCurlAmp * 0.7;
  pos.xy += tangent * dot(flow.xy, tangent) * amp;
  pos.xy += radial * dot(flow.xy, radial) * amp * 0.18;
  pos.z += flow.z * amp * 0.08;

  float r2 = length(pos.xy);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.12);

  gl_PointSize = clamp(uSize * aSize * (uViewportHeight / dist) * uPixelRatio, 2.0, 48.0);

  float hole = smoothstep(0.52, 0.70, r2);
  float disk = 1.0 - smoothstep(1.36, 1.86, r2);
  vColor = vec3(0.46, 0.52, 0.64);
  vAlpha = mix(0.22, 0.48, aSeed) * hole * disk;
}
`;

const DUST_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p) * 2.0;
  if (d >= 1.0) discard;
  float g = 1.0 - smoothstep(0.0, 1.0, d);
  float a = g * g * vAlpha;
  // Multiply dest by mix(1, dust, a) so empty sprite pixels do not dim the disk.
  gl_FragColor = vec4(mix(vec3(1.0), vColor, a), 1.0);
}
`;

const GAS_VERTEX = `${VORTEX_ADVANCE}

varying vec2 vXy;

void main() {
  vXy = position.xy;
  float r = max(length(position.xy), 0.05);
  float span = R_MAX - R_MIN;
  float inward = pow(clamp((R_MAX - r) / span, 0.0, 1.0), 1.35);
  vec3 pos = vec3(position.xy, -inward * 0.11);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const GAS_FRAGMENT = `${CURL_NOISE_GLSL}
${VORTEX_ADVANCE}

varying vec2 vXy;

uniform float uTime;
uniform vec2 uMouse;
uniform float uOctaves;
uniform float uGasGain;

vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0897336600 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

float fbm3(vec3 p, float octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  vec3 q = p;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= octaves) break;
    s += a * snoise(q);
    n += a;
    q = q * 2.08 + vec3(1.27, 0.63, 0.41);
    a *= 0.5;
  }
  return s / max(n, 0.001) * 0.5 + 0.5;
}

void main() {
  vec2 xy = rot2(vXy - uMouse * 0.045, wrapTau(uTime * PATTERN_SPIN));
  float r = max(length(xy), 0.05);
  float shear = sin(wrapTau(uTime * 0.19)) * (0.06 / (r + 0.2));
  xy = rot2(xy, shear);
  r = max(length(xy), 0.05);

  float ang = atan(xy.y, xy.x);
  float logR = log(r);
  float spiral = ang - PITCH * logR;

  vec3 orbit = vec3(
    cos(wrapTau(uTime * 0.11)),
    sin(wrapTau(uTime * 0.11)),
    sin(wrapTau(uTime * 0.09 + 1.3))
  );
  float warp = snoise(vec3(cos(spiral) * 1.35, sin(spiral) * 1.35, logR * 1.7) + orbit * 0.32);
  spiral += warp * 0.3;

  float armPhase = ARM_N * spiral;
  float armNoise = snoise(vec3(xy * 0.8, warp));
  float armSharp = mix(1.45, 2.45, 0.5 + 0.5 * armNoise);
  float armCore = pow(clamp(0.5 + 0.5 * cos(armPhase), 0.0, 1.0), armSharp);

  // Cylinder in noise space so the atan 2π cut on -X does not seam the filaments.
  // Radius 0.52 matches the old angular frequency (d(noise)/dθ); logR stays the axis.
  vec3 filP = vec3(cos(spiral) * 0.52, sin(spiral) * 0.52, logR * 4.15 - uTime * 0.085);
  float n1 = fbm3(filP, uOctaves);
  float n2 = fbm3(filP * 2.18 + vec3(1.6, 0.73, -uTime * 0.04), max(uOctaves - 1.0, 1.0));
  float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
  float haze = pow(n1, 2.05) * 0.24 * mix(0.22, 1.0, armCore);
  float threads = pow(ridge, 2.75) * mix(0.14, 1.18, armCore);
  float wisps = pow(n2, 3.15) * 0.78 * armCore;
  float grain = 0.9 + 0.1 * snoise(vec3(xy * 22.0, orbit.z * 0.5));
  float density = (haze + threads + wisps) * grain * uGasGain;

  float hole = smoothstep(0.36, 0.52, r);
  float disk = 1.0 - smoothstep(1.42, 1.92, r);
  float photon = smoothstep(0.48, 0.64, r) * (1.0 - smoothstep(0.64, 0.92, r));
  float innerRim = smoothstep(0.50, 0.64, r) * (1.0 - smoothstep(0.64, 1.08, r));

  float rt = smoothstep(0.50, 1.15, r);
  vec3 hotLab   = vec3(0.82, -0.016, -0.068);
  vec3 midLab   = vec3(0.74, -0.006, -0.028);
  vec3 outerLab = vec3(0.62,  0.008,  0.012);
  vec3 lab = mix(hotLab, midLab, rt);
  lab = mix(lab, outerLab, smoothstep(1.05, 1.72, r));
  vec3 col = max(oklabToLinear(lab), vec3(0.0));
  col *= 0.4 + innerRim * 0.55 + (1.0 - smoothstep(0.50, 1.12, r)) * 0.34;
  col *= mix(1.08, 0.42, smoothstep(0.50, 1.55, r));
  col += vec3(0.62, 0.74, 0.98) * photon * 0.22;

  float alpha = density * hole * disk;
  alpha += photon * 0.16 * hole;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha < 0.012) discard;

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

function VortexMesh({
  mouseTarget,
  simTimeRef,
  quality,
}: {
  mouseTarget: MutableRefObject<Vector2>;
  simTimeRef: MutableRefObject<number>;
  quality: VortexQuality;
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  const mouseCurrent = useRef(new Vector2(0, 0));

  const geometry = useMemo(
    () => createParticleGeometry(quality.particleCount),
    [quality.particleCount],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0, 0) },
      uOctaves: { value: quality.octaves },
      uPixelRatio: { value: 1 },
      uViewportHeight: { value: 1 },
      uSize: { value: quality.pointSize },
      uCurlAmp: { value: quality.curlAmp },
      uTempVariance: { value: 0.048 },
      uCoreBoost: { value: quality.coreBoost },
      uRimDark: { value: 1.0 },
      uStreak: { value: quality.streaks ? 2.9 : 1.0 },
      uDof: { value: quality.dof ? 1.0 : 0.0 },
      uDofBoost: { value: 1.22 },
      uSparkGain: { value: quality.sparkGain },
    }),
    [quality],
  );

  // ShaderMaterial clones the uniforms object — write through the material ref.
  // Priority -1: run before EffectComposer (priority 1) captures the scene.
  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    const uTime = mat.uniforms["uTime"];
    const uMouse = mat.uniforms["uMouse"];
    const uPixelRatio = mat.uniforms["uPixelRatio"];
    const uViewportHeight = mat.uniforms["uViewportHeight"];

    if (uTime) uTime.value = simTimeRef.current;

    mouseCurrent.current.lerp(mouseTarget.current, 0.035);
    const mouseVal = uMouse?.value;
    if (mouseVal instanceof Vector2) {
      mouseVal.copy(mouseCurrent.current);
    }

    if (uPixelRatio) uPixelRatio.value = state.viewport.dpr;
    if (uViewportHeight) uViewportHeight.value = state.size.height;
  }, -1);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={2}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function GasDisk({
  mouseTarget,
  simTimeRef,
  quality,
}: {
  mouseTarget: MutableRefObject<Vector2>;
  simTimeRef: MutableRefObject<number>;
  quality: VortexQuality;
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  const mouseCurrent = useRef(new Vector2(0, 0));
  const segments = quality.gasOctaves >= 5 ? 96 : 64;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0, 0) },
      uOctaves: { value: quality.gasOctaves },
      uGasGain: { value: quality.gasGain },
    }),
    [quality.gasGain, quality.gasOctaves],
  );

  useFrame(() => {
    const mat = materialRef.current;
    if (!mat) return;
    const uTime = mat.uniforms["uTime"];
    if (uTime) uTime.value = simTimeRef.current;
    mouseCurrent.current.lerp(mouseTarget.current, 0.035);
    const mouseVal = mat.uniforms["uMouse"]?.value;
    if (mouseVal instanceof Vector2) {
      mouseVal.copy(mouseCurrent.current);
    }
  }, -1);

  return (
    <mesh frustumCulled={false} renderOrder={1}>
      <circleGeometry args={[MAX_R * 1.02, segments]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={GAS_VERTEX}
        fragmentShader={GAS_FRAGMENT}
        uniforms={uniforms}
        transparent
        premultipliedAlpha
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function DustLanes({
  mouseTarget,
  simTimeRef,
  quality,
}: {
  mouseTarget: MutableRefObject<Vector2>;
  simTimeRef: MutableRefObject<number>;
  quality: VortexQuality;
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  const mouseCurrent = useRef(new Vector2(0, 0));
  const geometry = useMemo(() => createDustGeometry(quality.dustCount), [quality.dustCount]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0, 0) },
      uOctaves: { value: quality.octaves },
      uPixelRatio: { value: 1 },
      uViewportHeight: { value: 1 },
      uSize: { value: quality.pointSize * 1.55 },
      uCurlAmp: { value: quality.curlAmp },
    }),
    [quality.curlAmp, quality.octaves, quality.pointSize],
  );

  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    const uTime = mat.uniforms["uTime"];
    if (uTime) uTime.value = simTimeRef.current;
    mouseCurrent.current.lerp(mouseTarget.current, 0.035);
    const mouseVal = mat.uniforms["uMouse"]?.value;
    if (mouseVal instanceof Vector2) {
      mouseVal.copy(mouseCurrent.current);
    }
    const uPixelRatio = mat.uniforms["uPixelRatio"];
    const uViewportHeight = mat.uniforms["uViewportHeight"];
    if (uPixelRatio) uPixelRatio.value = state.viewport.dpr;
    if (uViewportHeight) uViewportHeight.value = state.size.height;
  }, -1);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={3}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={DUST_VERTEX}
        fragmentShader={DUST_FRAGMENT}
        uniforms={uniforms}
        transparent
        premultipliedAlpha
        depthWrite={false}
        depthTest={false}
        blending={MultiplyBlending}
        toneMapped={false}
      />
    </points>
  );
}

function SimClock({
  simTimeRef,
  reducedMotion,
}: {
  simTimeRef: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const lastElapsedRef = useRef<number | null>(null);

  useFrame((state, delta) => {
    const elapsed = state.clock.getElapsedTime();
    const prev = lastElapsedRef.current;
    lastElapsedRef.current = elapsed;
    const rawDt = prev == null ? delta : elapsed - prev;
    const dt = Math.min(Math.max(rawDt, 0), 0.1);
    if (!reducedMotion) simTimeRef.current += dt;
  }, -2);

  return null;
}

function StarField({
  mouseTarget,
  simTimeRef,
  reducedMotion,
  containerRef,
  quality,
}: {
  mouseTarget: MutableRefObject<Vector2>;
  simTimeRef: MutableRefObject<number>;
  reducedMotion: boolean;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  quality: VortexQuality;
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  const mouseCurrent = useRef(new Vector2(0, 0));
  const lastCssW = useRef(-1);
  const geometry = useMemo(() => createStarGeometry(quality.starCount), [quality.starCount]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const uniforms = useMemo(
    () => ({
      uMouse: { value: new Vector2(0, 0) },
      uPixelRatio: { value: 1 },
      uViewportHeight: { value: 1 },
      uParallax: { value: STAR_MOUSE_PARALLAX },
      uTime: { value: 0 },
      uFieldSpin: { value: FIELD_SPIN },
      uMaxR: { value: VORTEX_MAX_R },
      uMaskSolid: { value: 0.72 },
      uMaskEdge: { value: 0.07 },
      uMaskCenter: { value: new Vector2(0.5, 0.48) },
    }),
    [],
  );

  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    mouseCurrent.current.lerp(mouseTarget.current, STAR_MOUSE_LERP);
    const mouseVal = mat.uniforms["uMouse"]?.value;
    if (mouseVal instanceof Vector2) {
      mouseVal.copy(mouseCurrent.current);
    }
    const uPixelRatio = mat.uniforms["uPixelRatio"];
    const uViewportHeight = mat.uniforms["uViewportHeight"];
    if (uPixelRatio) uPixelRatio.value = state.viewport.dpr;
    if (uViewportHeight) uViewportHeight.value = state.size.height;
    const uTime = mat.uniforms["uTime"];
    if (uTime) uTime.value = simTimeRef.current;
    const uFieldSpin = mat.uniforms["uFieldSpin"];
    if (uFieldSpin) uFieldSpin.value = reducedMotion ? 0 : FIELD_SPIN;

    // Mask stops come from .vortex-card CSS — refresh when the canvas resizes.
    if (state.size.width !== lastCssW.current) {
      lastCssW.current = state.size.width;
      const card = containerRef.current?.closest(".vortex-card");
      if (card instanceof HTMLElement) {
        const style = getComputedStyle(card);
        const solid = parseFloat(style.getPropertyValue("--vortex-mask-solid")) / 100;
        const edge = parseFloat(style.getPropertyValue("--vortex-mask-edge")) / 100;
        const uMaskSolid = mat.uniforms["uMaskSolid"];
        const uMaskEdge = mat.uniforms["uMaskEdge"];
        if (uMaskSolid && Number.isFinite(solid)) uMaskSolid.value = solid;
        if (uMaskEdge && Number.isFinite(edge)) uMaskEdge.value = edge;
      }
    }
  }, -1);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={0}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={STAR_VERTEX}
        fragmentShader={STAR_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function cssVarToRgb(host: Element, variable: string): Vector3 {
  const probe = document.createElement("span");
  probe.style.cssText = `color: var(${variable}); position: absolute; width: 0; height: 0; overflow: hidden;`;
  host.appendChild(probe);
  const parsed = getComputedStyle(probe).color;
  probe.remove();
  const m = parsed.match(/[\d.]+/g);
  if (!m || m.length < 3) return new Vector3(0, 0, 0);
  return new Vector3(Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255);
}

const CARD_FLOOR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* Same stops as .vortex-card__media background: fill → mix 40% → mix 70% → backdrop. */
const CARD_FLOOR_FRAGMENT = /* glsl */ `
uniform vec3 uFill;
uniform vec3 uBackdrop;
uniform vec2 uCenter;

varying vec2 vUv;

void main() {
  vec2 origin = vec2(uCenter.x, 1.0 - uCenter.y);
  float d = length((vUv - origin) * 2.0);
  vec3 s0 = uFill;
  vec3 s1 = mix(uFill, uBackdrop, 0.40);
  vec3 s2 = mix(uFill, uBackdrop, 0.70);
  vec3 s3 = uBackdrop;
  vec3 col = s3;
  if (d < 0.4) col = mix(s0, s1, clamp(d / 0.4, 0.0, 1.0));
  else if (d < 0.7) col = mix(s1, s2, (d - 0.4) / 0.3);
  else col = mix(s2, s3, clamp((d - 0.7) / 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function CardFloor({ containerRef }: { containerRef: MutableRefObject<HTMLDivElement | null> }) {
  const materialRef = useRef<ShaderMaterial>(null);
  const lastW = useRef(-1);

  const uniforms = useMemo(
    () => ({
      uFill: { value: new Vector3(0.09, 0.09, 0.1) },
      uBackdrop: { value: new Vector3(0, 0, 0) },
      uCenter: { value: new Vector2(0.5, 0.48) },
    }),
    [],
  );

  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    if (state.size.width === lastW.current) return;
    lastW.current = state.size.width;
    const host = containerRef.current?.closest(".vortex-card") ?? document.documentElement;
    const fillVar =
      host instanceof HTMLElement && host.classList.contains("vortex-card")
        ? "--vortex-fill"
        : "--card";
    const backdropVar =
      host instanceof HTMLElement && host.classList.contains("vortex-card")
        ? "--vortex-backdrop"
        : "--background";
    const fill = mat.uniforms["uFill"]?.value;
    const backdrop = mat.uniforms["uBackdrop"]?.value;
    if (fill instanceof Vector3) fill.copy(cssVarToRgb(host, fillVar));
    if (backdrop instanceof Vector3) backdrop.copy(cssVarToRgb(host, backdropVar));
  }, -2);

  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={CARD_FLOOR_VERTEX}
        fragmentShader={CARD_FLOOR_FRAGMENT}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function ContextLostBridge({ onLost }: { onLost: () => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const handler = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", handler);
    return () => canvas.removeEventListener("webglcontextlost", handler);
  }, [gl, onLost]);

  return null;
}

function InvalidateOnShow({ visible }: { visible: boolean }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (visible) invalidate();
  }, [visible, invalidate]);

  return null;
}

function CameraRig({ mouseTarget }: { mouseTarget: MutableRefObject<Vector2> }) {
  const camera = useThree((state) => state.camera);
  const mouseCurrent = useRef(new Vector2(0, 0));

  useFrame(() => {
    mouseCurrent.current.lerp(mouseTarget.current, 0.035);
    camera.position.x = mouseCurrent.current.x * 0.2;
    camera.position.y = CAMERA_POSITION[1] - mouseCurrent.current.y * 0.12;
    camera.position.z = CAMERA_POSITION[2];
    camera.lookAt(0, 0, 0);
  }, -1);

  return null;
}

function VortexEffects({
  reducedMotion,
  quality,
}: {
  reducedMotion: boolean;
  quality: VortexQuality;
}) {
  const bloom = !reducedMotion && quality.bloom;

  return (
    <EffectComposer multisampling={0} enableNormalPass={false} frameBufferType={UnsignedByteType}>
      {bloom ? (
        <Bloom
          luminanceThreshold={quality.bloomThreshold}
          luminanceSmoothing={quality.bloomSmoothing}
          intensity={quality.bloomIntensity}
          mipmapBlur={false}
          kernelSize={KernelSize.SMALL}
        />
      ) : null}
      <Vignette offset={0.58} darkness={0.14} />
    </EffectComposer>
  );
}

/**
 * Client-only WebGL vortex. Must be loaded via dynamic import after mount —
 * three.js / R3F must not run during SSR.
 */
export function VortexShader({ onContextLost, onReady }: VortexShaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseTarget = useRef(new Vector2(0, 0));
  const simTimeRef = useRef(0);
  const [quality, setQuality] = useState<VortexQuality | null>(null);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useLayoutEffect(() => {
    const halfFloatFbo = probeHalfFloatFbo();
    setQuality(detectQuality(halfFloatFbo));
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ndc = pointerNdcFromEvent(event, rect);
      mouseTarget.current.set(ndc.x, ndc.y);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.boundingClientRect;
        // Ignore the 0×0 first layout so we never latch onto frameloop="never".
        if (width <= 0 || height <= 0) return;
        setVisible(entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "80px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frameloop = !visible ? "never" : reducedMotion ? "demand" : "always";

  return (
    <div ref={containerRef} className="h-full w-full">
      {quality ? (
        <Canvas
          flat
          frameloop={frameloop}
          dpr={quality.dpr}
          gl={{
            antialias: false,
            alpha: true,
            powerPreference: "high-performance",
          }}
          camera={{ position: CAMERA_POSITION, fov: CAMERA_FOV_DEG, near: 0.1, far: 24 }}
          className="pointer-events-none h-full w-full"
          onCreated={(state) => {
            state.gl.setClearColor(0x000000, 0);
            state.camera.lookAt(0, 0, 0);
            onReady();
          }}
        >
          <SimClock simTimeRef={simTimeRef} reducedMotion={reducedMotion} />
          <CameraRig mouseTarget={mouseTarget} />
          <CardFloor containerRef={containerRef} />
          <StarField
            mouseTarget={mouseTarget}
            simTimeRef={simTimeRef}
            reducedMotion={reducedMotion}
            containerRef={containerRef}
            quality={quality}
          />
          <GasDisk mouseTarget={mouseTarget} simTimeRef={simTimeRef} quality={quality} />
          <VortexMesh mouseTarget={mouseTarget} simTimeRef={simTimeRef} quality={quality} />
          {quality.dustCount > 0 ? (
            <DustLanes mouseTarget={mouseTarget} simTimeRef={simTimeRef} quality={quality} />
          ) : null}
          <VortexEffects reducedMotion={reducedMotion} quality={quality} />
          <ContextLostBridge onLost={onContextLost} />
          <InvalidateOnShow visible={visible} />
        </Canvas>
      ) : null}
    </div>
  );
}
