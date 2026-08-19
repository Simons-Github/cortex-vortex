// Standalone 3D curl noise (divergence-free via curl of a vector potential).
//
// LYGIA was not wired in: this TanStack Start / Vite graph has no glsl
// preprocessor, and a raw-string chunk keeps Nitro/SSR out of the shader path.
//
// Potential psi is 3D simplex (Stefan Gustavson / Ashima Arts, MIT). Curl is
// assembled from three central-difference gradient samples (one per axis) of
// that vector potential, then the cross-product / curl formula.
//
// Domain must stay bounded. Never pass an unbounded clock into snoise() —
// simplex uses floor() of the input, which loses precision as |p| grows, and
// this file itself never calls sin/cos on time. The vertex shader feeds a
// wrapTau sin/cos orbit instead of raw t.

vec3 mod289_3(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289_4(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289_4(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289_3(i);
  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)
    ) +
      i.x +
      vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Vector potential: three uncorrelated scalar fields (spatial offsets only).
vec3 snoiseVec3(vec3 x) {
  float s0 = snoise(x);
  float s1 = snoise(vec3(x.y + 31.32, x.z + 14.17, x.x + 47.29));
  float s2 = snoise(vec3(x.z + 19.19, x.x + 25.73, x.y + 8.91));
  return vec3(s0, s1, s2);
}

// curl(psi)  (Bridson). Unnormalized so vorticity magnitude stays in the field.
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  vec3 pX0 = snoiseVec3(p - dx);
  vec3 pX1 = snoiseVec3(p + dx);
  vec3 pY0 = snoiseVec3(p - dy);
  vec3 pY1 = snoiseVec3(p + dy);
  vec3 pZ0 = snoiseVec3(p - dz);
  vec3 pZ1 = snoiseVec3(p + dz);

  float x = pY1.z - pY0.z - pZ1.y + pZ0.y;
  float y = pZ1.x - pZ0.x - pX1.z + pX0.z;
  float z = pX1.y - pX0.y - pY1.x + pY0.x;

  return vec3(x, y, z) * (0.5 / e);
}

// Unrolled FBM of curls (sum of div-free fields is div-free). Octave count is
// a uniform so low-power devices skip the extra 18-simplex samples.
vec3 curlFbm(vec3 p, float octaves) {
  vec3 v = vec3(0.0);
  float a = 1.0;
  v += a * curlNoise(p);
  if (octaves > 1.5) {
    p *= 2.07;
    a *= 0.5;
    v += a * curlNoise(p);
  }
  if (octaves > 2.5) {
    p *= 2.03;
    a *= 0.5;
    v += a * curlNoise(p);
  }
  return v;
}
