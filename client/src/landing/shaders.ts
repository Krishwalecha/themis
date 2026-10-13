
export const PRELUDE = /* glsl */ `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_hover;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec3 dither(float v) {
  float t = bayer8(gl_FragCoord.xy) + 0.0078125;
  float s = clamp(v, 0.0, 1.0) * 3.0;
  float b = floor(s);
  float i = b + step(t, s - b);
  if (i < 0.5) return u_c0;
  if (i < 1.5) return u_c1;
  if (i < 2.5) return u_c2;
  return u_c3;
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

// A wall of checks: every cell is a monitor run, quietly passing, now and then failing
export const MATRIX = /* glsl */ `
float cellState(vec2 id, float t, out float flash, out float fail) {
  float rate = 0.25 + 0.6 * hash(id);
  float k = floor(t * rate + hash(id + 3.0) * 10.0);
  float ph = fract(t * rate + hash(id + 3.0) * 10.0);
  fail = step(0.965, hash(id + k * 0.37));
  flash = exp(-ph * 5.0);
  return ph;
}

// the ticker's latest failure: cell x, cell y, age in seconds
uniform vec3 u_ping;

void main() {
  vec2 cellPx = vec2(5.0);
  vec2 id = floor(gl_FragCoord.xy / cellPx);
  vec2 f = fract(gl_FragCoord.xy / cellPx);
  vec2 uv = gl_FragCoord.xy / u_res;
  float ar = u_res.x / u_res.y;
  float t = u_time;
  float inside = step(f.x, 0.72) * step(f.y, 0.72);

  float flash;
  float fail;
  float ph = cellState(id, t, flash, fail);

  // neighbours that just failed light this cell a little
  float nb = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    float nf;
    float nfl;
    cellState(id + o, t, nfl, nf);
    nb = max(nb, nf * nfl);
  }

  // organic clusters that drift, so the wall breathes instead of buzzing uniformly
  float cluster = smoothstep(0.35, 0.7, fbm(id * 0.04 + vec2(t * 0.02, -t * 0.015)));

  float region = smoothstep(0.3, 0.75, uv.x) * smoothstep(0.0, 0.2, uv.y) * smoothstep(1.0, 0.7, uv.y);
  vec2 q = vec2((uv.x - u_mouse.x) * ar, uv.y - u_mouse.y);
  float lens = u_hover * exp(-dot(q, q) * 30.0);

  float v = (0.15 + 0.07 * cluster) + 0.3 * flash * (0.8 + 0.2 * cluster);
  v = max(v, nb * 0.32);
  // a failure flashes white, then cools to ember
  v = mix(v, mix(0.72, 1.12, flash), fail * (0.4 + 0.6 * flash));
  v *= region + lens * 0.8;

  // a failure from the ticker lands: flashes white, holds ember, fades out
  vec2 dp = abs(id - u_ping.xy);
  float age = u_ping.z;
  float landed = step(max(dp.x, dp.y), 0.5) * smoothstep(5.0, 3.5, age);
  v = max(v, landed * mix(0.72, 1.15, exp(-age * 2.0)));
  // ...inside a thin ember frame, so it reads as the one the ticker just reported
  float frame = step(max(dp.x, dp.y), 2.5) * (1.0 - step(max(dp.x, dp.y), 1.5));
  v = max(v, frame * 0.62 * smoothstep(4.0, 2.5, age) * smoothstep(0.0, 0.15, age));

  gl_FragColor = vec4(dither(v * inside), 1.0);
}
`;


/* ------------------------------------------------------------------ */
/* Product objects: one sculpted shape each, ray-marched and lit from  */
/* the cursor. Each scene defines map(p) and emit(p); OBJ_MAIN shades. */
/* ------------------------------------------------------------------ */

const OBJ_LIB = /* glsl */ `
float sdRB(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float sdCyl(vec3 p, float r, float h) { vec2 d = vec2(length(p.xy) - r, abs(p.z) - h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a; vec2 e1 = c - b; vec2 e2 = a - c;
  vec2 v0 = p - a; vec2 v1 = p - b; vec2 v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// a flat triangle in the xz plane, t thick along y
float plate(vec3 p, vec2 a, vec2 b, vec2 c, float t) { vec2 w = vec2(sdTri(p.xz, a, b, c), abs(p.y) - t); return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)); }
`;

const OBJ_MAIN = /* glsl */ `
vec3 nrm(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
// LITE (phones): no soft shadows or occlusion, fewer march steps
#ifdef LITE
#define STEPS 40
#else
#define STEPS 64
#endif
float softShadow(vec3 ro, vec3 rd) {
#ifdef LITE
  return 1.0;
#endif
  float res = 1.0;
  float t = 0.03;
  for (int i = 0; i < 24; i++) {
    float h = map(ro + rd * t);
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.03, 0.25);
    if (res < 0.02 || t > 5.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
float occlusion(vec3 p, vec3 n) {
#ifdef LITE
  return 1.0;
#endif
  float o = 0.0;
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.03 + 0.07 * float(i);
    o += (h - map(p + n * h)) * s;
    s *= 0.7;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  // close in, so the object fills its frame
  vec3 ro = vec3(0.0, 0.62, 3.8);
  vec3 ww = normalize(vec3(0.0, 0.05, 0.0) - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.55 * ww);

  float d = 0.0;
  float hit = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float h = map(ro + rd * d);
    if (h < 0.002) { hit = 1.0; break; }
    d += h;
    if (d > 9.0) break;
  }
  vec3 lp = vec3((u_mouse.x - 0.5) * 6.0, 2.0 + (u_mouse.y - 0.5) * 4.0, 3.0);
  lp = mix(vec3(-2.4, 3.2, 2.6), lp, u_hover);

  // the floor: a soft pool of light under the object, with its shadow cast into it
  float floorY = -1.2;
  float v = 0.0;
  float tf = rd.y < 0.0 ? (floorY - ro.y) / rd.y : 1e3;
  if (tf < 1e3 && (hit < 0.5 || tf < d)) {
    vec3 fp = ro + rd * tf;
    float pool = exp(-dot(fp.xz - vec2(0.3, -0.2), fp.xz - vec2(0.3, -0.2)) * 0.45);
    float sh = softShadow(fp + vec3(0.0, 0.01, 0.0), normalize(lp - fp));
    v = 0.16 * pool * mix(0.1, 1.0, sh);
    hit = 0.0;
  }
  if (hit > 0.5) {
    vec3 p = ro + rd * d;
    vec3 n = nrm(p);
    vec3 l = normalize(lp - p);
    float sh = softShadow(p + n * 0.01, l);
    float diff = max(dot(n, l), 0.0) * mix(0.25, 1.0, sh);
    float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 36.0) * sh;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    float fill = 0.5 + 0.5 * n.y;
    v = (0.2 + 0.18 * fill + 0.75 * diff) * occlusion(p, n) + 0.6 * spec + 0.25 * rim;
    // lift the mid-tones so the shape reads clearly against the dark ground
    v = pow(clamp(v, 0.0, 1.0), 0.8);
    // emit > 0 glows; emit < 0 inks the surface darker
    float e = emit(p);
    v = e < 0.0 ? v * (1.0 + e) : max(v, e);
  }
  gl_FragColor = vec4(dither(v), 1.0);
}
`;

// Send: a folded paper plane gliding, with a dotted trail behind it
export const OBJ_SEND = OBJ_LIB + /* glsl */ `
vec3 pose(vec3 p) {
  float t = u_time;
  p.y -= 0.07 * sin(t * 1.3);
  p.xz *= rot(-0.35 + 0.1 * sin(t * 0.45));
  p.xy *= rot(-0.3 + 0.06 * sin(t * 0.9));
  p.yz *= rot(-0.6 + 0.08 * sin(t * 1.1));
  p.yz *= rot(0.12 * sin(t * 1.1));
  return p;
}
float map(vec3 p) {
  p = pose(p);
  vec3 q = p;
  q.yz *= rot(-0.5);
  float d = plate(q, vec2(1.0, 0.0), vec2(-0.75, 0.62), vec2(-0.75, 0.04), 0.014);
  q = p;
  q.yz *= rot(0.5);
  d = min(d, plate(q, vec2(1.0, 0.0), vec2(-0.75, -0.62), vec2(-0.75, -0.04), 0.014));
  d = min(d, plate(vec3(p.x, p.z, p.y), vec2(1.0, 0.0), vec2(-0.75, 0.0), vec2(-0.75, -0.3), 0.014));
  // the trail: dots drifting away from the tail
  float flow = fract(u_time * 1.2);
  for (int i = 0; i < 4; i++) {
    float fi = float(i) + flow;
    d = min(d, length(p - vec3(-0.95 - fi * 0.3, -0.06 - fi * 0.03, 0.0)) - 0.055 * (1.0 - fi * 0.2));
  }
  return d;
}
float emit(vec3 p) { return 0.0; }
` + OBJ_MAIN;

// Monitor: a stopwatch whose hand never stops, leaving a glow where it has been
export const OBJ_RING = OBJ_LIB + /* glsl */ `
vec3 pose(vec3 p) {
  p.xz *= rot(0.35 * sin(u_time * 0.35));
  p.yz *= rot(-0.22 + 0.06 * sin(u_time * 0.5));
  p.y += 0.1;
  return p;
}
float hand(vec3 p) {
  vec3 q = p;
  q.xy *= rot(u_time * 1.2);
  return sdRB(q - vec3(0.0, 0.27, 0.13), vec3(0.022, 0.32, 0.018), 0.008);
}
float map(vec3 p) {
  p = pose(p);
  float body = sdCyl(p, 0.74, 0.12) - 0.04;
  body = max(body, -sdCyl(p - vec3(0.0, 0.0, 0.17), 0.63, 0.07));
  body = min(body, sdCyl((p - vec3(0.0, 0.88, 0.0)).xzy, 0.05, 0.1));
  body = min(body, sdCyl((p - vec3(0.0, 1.0, 0.0)).xzy, 0.11, 0.05) - 0.01);
  vec3 b = p;
  b.xy *= rot(-0.75);
  body = min(body, sdCyl((b - vec3(0.0, 0.86, 0.0)).xzy, 0.06, 0.06) - 0.01);
  // twelve ticks around the face
  float sec = 6.2831 / 12.0;
  float an = floor(atan(p.x, p.y) / sec + 0.5) * sec;
  vec2 tq = p.xy;
  tq *= rot(an);
  body = min(body, sdRB(vec3(tq.x, tq.y - 0.52, p.z - 0.1), vec3(0.016, 0.055, 0.02), 0.004));
  body = min(body, sdCyl(p - vec3(0.0, 0.0, 0.12), 0.055, 0.035));
  return min(body, hand(p));
}
float emit(vec3 p) {
  p = pose(p);
  if (hand(p) < 0.01) return 1.1;
  if (p.z > 0.06 && length(p.xy) < 0.6) {
    float da = mod(u_time * 1.2 - atan(p.x, p.y), 6.2831);
    return 0.42 * exp(-da * 1.6);
  }
  return 0.0;
}
` + OBJ_MAIN;

// Contract: a shield with a check pressed into it
export const OBJ_SEAL = OBJ_LIB + /* glsl */ `
vec3 pose(vec3 p) {
  p.y -= 0.04 * sin(u_time * 0.9);
  p.xz *= rot(0.45 * sin(u_time * 0.35));
  p.yz *= rot(-0.12);
  return p;
}
float shield2(vec2 p) {
  float w = p.y > 0.0 ? 0.6 : 0.6 * sqrt(max(0.0, 1.0 - pow(p.y / 0.88, 2.0)));
  return max(max(abs(p.x) - w, p.y - 0.62 - 0.06 * (1.0 - p.x * p.x)), -p.y - 0.88) * 0.8;
}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float tick(vec3 p) {
  float d2 = min(seg(p.xy, vec2(-0.27, 0.0), vec2(-0.07, -0.2)), seg(p.xy, vec2(-0.07, -0.2), vec2(0.3, 0.26))) - 0.065;
  return max(d2, abs(p.z - 0.13) - 0.04);
}
float map(vec3 p) {
  p = pose(p);
  float s = shield2(p.xy);
  float body = min(max(s, abs(p.z) - 0.1), 0.0) + length(max(vec2(s, abs(p.z) - 0.1), 0.0)) - 0.04;
  return min(body, tick(p));
}
float emit(vec3 p) {
  p = pose(p);
  float press = smoothstep(0.6, 0.68, fract(u_time / 4.0)) * smoothstep(1.0, 0.82, fract(u_time / 4.0));
  return tick(p) < 0.01 ? 0.75 + 0.4 * press : 0.0;
}
` + OBJ_MAIN;

// Summary: a pencil writing the write-up, one line at a time
export const OBJ_BUBBLE = OBJ_LIB + /* glsl */ `
const float T = 7.0;
vec3 pose(vec3 p) {
  p.xz *= rot(0.3 * sin(u_time * 0.3) - 0.1);
  p.yz *= rot(0.4);
  p.y += 0.05;
  return p;
}
float lineW(float i) { return i < 0.5 ? 0.92 : i < 1.5 ? 0.74 : i < 2.5 ? 0.86 : 0.48; }
float drawn(float i) { return lineW(i) * clamp((mod(u_time, T) - i * 1.3) / 1.2, 0.0, 1.0); }
float lines(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float w = drawn(fi) * 0.5;
    if (w > 0.005) d = min(d, sdRB(p - vec3(-0.5 + w, 0.4 - fi * 0.24, 0.018), vec3(w, 0.022, 0.006), 0.006));
  }
  return d;
}
vec3 tipAt() {
  float c = mod(u_time, T);
  float i = clamp(floor(c / 1.3), 0.0, 3.0);
  float lift = smoothstep(0.0, 0.1, fract(c / 1.3) * 1.3 - 1.2) + step(5.2, c);
  return vec3(-0.5 + drawn(i), 0.4 - i * 0.24, 0.03 + 0.12 * min(lift, 1.0));
}
float pencil(vec3 p) {
  vec3 a = tipAt();
  vec3 dir = normalize(vec3(0.4, 0.5, 0.78));
  vec3 pa = p - a;
  float h = clamp(dot(pa, dir), 0.0, 0.9);
  float r = mix(0.012, 0.075, clamp(h / 0.2, 0.0, 1.0));
  return (length(pa - dir * h) - r) * 0.85;
}
float map(vec3 p) {
  p = pose(p);
  float page = sdRB(p, vec3(0.72, 0.62, 0.01), 0.008);
  return min(min(page, lines(p)), pencil(p));
}
float emit(vec3 p) {
  p = pose(p);
  return lines(p) < 0.01 ? -0.8 : 0.0;
}
` + OBJ_MAIN;
