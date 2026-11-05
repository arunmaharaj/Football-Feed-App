/* Isoline Bloom background – vanilla JS port of the <IsolineBloom> React component.
 *
 * A living lobed shape drawn only by its contour lines: neon hairline isolines
 * flowing outward from an indigo core, coloured violet → magenta → ember by
 * direction. The pointer is a lens (the shape leans toward it, lines bulge and
 * brighten under it, fast moves pump the flow) and a click sends a shock pulse
 * through the rings. With no pointer, an invisible lens wanders the field.
 *
 * Rendered as a fixed, full-viewport WebGL2 canvas behind the page.
 * Options (read from <script data-*> attributes, all optional):
 *   data-preset="ultraviolet|solar-flare|abyss|aurora|ghost"
 *   data-params='{"rings":14,"scale":0.6}'   (JSON overrides)
 *   data-interactive="true|false"
 */
(() => {
  "use strict";

  const DEFAULTS = {
    scale: 0.5, centerX: 0.5, centerY: 0.5, lobes: 3, lobeDepth: 0.24, wobble: 0.35,
    twist: 0.55, warp: 0.035, morph: 0.18, spin: 0.012,
    rings: 11, lineWidth: 1.6, glow: 7, glowGain: 0.42, flow: 0.22, falloff: 1.6, hollow: 0.08,
    hueAngle: 3.4, hueDrift: 0.02, heat: 0.4, coreGlow: 0.55, exposure: 1.35,
    pull: 0.18, lens: 0.07, lensRadius: 0.16, lensGlow: 0.9, energy: 1, pulseSpeed: 0.9, pulseGain: 1,
    speed: 1, vignette: 0.55, grain: 0.03,
    backgroundColor: "#000000", coreColor: "#1b0b7a", leftColor: "#7a3cff",
    midColor: "#ff3fc4", rightColor: "#ff2448", hotColor: "#ffd6f6",
  };

  const PRESETS = {
    ultraviolet: {},
    "solar-flare": {
      coreColor: "#4a0d00", leftColor: "#ff2a00", midColor: "#ff8a1f", rightColor: "#ffd23f",
      hotColor: "#fff3cf", backgroundColor: "#050100",
      lobes: 5, lobeDepth: 0.12, wobble: 0.5, twist: 1.1, rings: 14, flow: 0.35, hueAngle: 1.2,
    },
    abyss: {
      coreColor: "#00264d", leftColor: "#00c2ff", midColor: "#2bffd5", rightColor: "#3a6bff",
      hotColor: "#e0fffb", backgroundColor: "#00040a",
      lobes: 4, lobeDepth: 0.16, twist: -0.6, warp: 0.09, rings: 12, flow: 0.15, spin: -0.01,
    },
    aurora: {
      coreColor: "#06331f", leftColor: "#3cff8f", midColor: "#38e1ff", rightColor: "#b06bff",
      hotColor: "#efffee", backgroundColor: "#010604",
      lobes: 2, lobeDepth: 0.26, wobble: 0.6, twist: 1.4, warp: 0.1, rings: 16, lineWidth: 1.2, flow: 0.18,
    },
    ghost: {
      coreColor: "#202024", leftColor: "#d9d9e3", midColor: "#ffffff", rightColor: "#9a9aa8",
      hotColor: "#ffffff", backgroundColor: "#000000",
      glowGain: 0.35, heat: 0.1, rings: 18, lineWidth: 1, lobeDepth: 0.14, hueDrift: 0,
    },
  };

  const MAX_PULSES = 6;
  const UNIFORMS = [
    ["lobes", "f"], ["lobeDepth", "f"], ["wobble", "f"], ["twist", "f"], ["warp", "f"],
    ["rings", "f"], ["lineWidth", "f"], ["glow", "f"], ["glowGain", "f"],
    ["falloff", "f"], ["hollow", "f"],
    ["heat", "f"], ["coreGlow", "f"], ["exposure", "f"],
    ["lens", "f"], ["lensRadius", "f"], ["lensGlow", "f"], ["pulseGain", "f"],
    ["vignette", "f"], ["grain", "f"],
    ["backgroundColor", "c"], ["coreColor", "c"], ["leftColor", "c"],
    ["midColor", "c"], ["rightColor", "c"], ["hotColor", "c"],
  ];
  const uName = (k) => "u" + k[0].toUpperCase() + k.slice(1);
  const declare = UNIFORMS.map(([k, kind]) => `uniform ${kind === "c" ? "vec3" : "float"} ${uName(k)};`).join("\n");

  const VERT = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uMorphT;
uniform float uFlowPhase;
uniform float uSpinA;
uniform float uHueA;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform vec4 uPulse[${MAX_PULSES}];
${declare}
out vec4 frag;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float field(vec2 px, out vec2 dir){
  vec2 p = (px - uCenter) / uRadius;
  float m = uMorphT;
  vec2 w = vec2(fbm(p * 1.1 + vec2(m * 0.7, -m * 0.4)), fbm(p * 1.1 + vec2(-m * 0.5, m * 0.6) + 7.3)) - 0.5;
  vec2 q = p + w * uWarp * 4.0;
  float r = length(q);
  float a = atan(q.y, q.x) + uSpinA - uTwist * r;
  float L = max(uLobes, 1.0);
  float shape =
      uLobeDepth * sin(L * a + 0.6 * sin(m * 0.9))
    + uLobeDepth * uWobble * sin((L - 1.0) * a - m * 1.3 + 1.7)
    + uLobeDepth * uWobble * 0.45 * sin((L + 2.0) * a + m * 0.8 + 4.1);
  shape *= 0.55 + 0.45 * smoothstep(0.0, 0.5, r);
  dir = r > 1e-4 ? q / r : vec2(1.0, 0.0);
  return r / (1.0 + shape);
}
vec3 tone(vec3 c){ return 1.0 - exp(-c * uExposure); }
void main(){
  vec2 px = gl_FragCoord.xy / uDpr;
  vec2 dir;
  float f = field(px, dir);
  float minSide = min(uRes.x, uRes.y) / uDpr;
  vec2 dp = (px - uPointer) / max(minSide * uLensRadius, 1.0);
  float bump = exp(-dot(dp, dp)) * uPointerOn;
  f -= uLens * bump;
  float shock = 0.0;
  for (int i = 0; i < ${MAX_PULSES}; i++){
    vec4 pu = uPulse[i];
    if (pu.w <= 0.0) continue;
    float age = uTime - pu.z;
    if (age < 0.0) continue;
    float d = length(px - pu.xy) / uRadius;
    float front = age * pu.w;
    float k = (d - front) / 0.09;
    shock += exp(-k * k) * exp(-age * 1.4) * uPulseGain;
  }
  f += shock * 0.035;
  float v = f * uRings - uFlowPhase;
  float dv = max(fwidth(v), 1e-4);
  float dist = abs(v - floor(v + 0.5)) / dv / uDpr;
  float core = 1.0 - smoothstep(uLineWidth * 0.5 - 0.5, uLineWidth * 0.5 + 0.6, dist);
  float halo = exp(-dist / max(uGlow, 0.1)) * uGlowGain;
  float env = smoothstep(uHollow * 0.4, uHollow * 1.4 + 0.02, f)
            * pow(clamp(1.0 - f, 0.0, 1.0), uFalloff);
  float side = dot(dir, vec2(cos(uHueA), sin(uHueA)));
  vec3 col = side > 0.0 ? mix(uMidColor, uLeftColor, side) : mix(uMidColor, uRightColor, -side);
  col = mix(col, uHotColor, uHeat * exp(-f * 5.0));
  float lit = env * (1.0 + bump * uLensGlow + shock * 1.5);
  vec3 c = uBackgroundColor;
  c += uCoreColor * uCoreGlow * exp(-f * f * 11.0) * (1.0 + 0.35 * bump);
  c += col * (core * 1.25 + halo) * lit;
  c = tone(c);
  vec2 uv = gl_FragCoord.xy / uRes;
  float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
  c = mix(uBackgroundColor, c, clamp(vig, 0.0, 1.0));
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * uGrain;
  frag = vec4(max(c, 0.0), 1.0);
}`;

  function hexToRgb(hex) {
    let h = String(hex).trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
    const v = parseInt(h, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  // The idle lens wanders on incommensurate sines, never closing a loop.
  function driftPos(t) {
    const x = 0.5 + 0.28 * Math.sin(t * 0.23) + 0.1 * Math.sin(t * 0.071 + 1.9);
    const y = 0.5 + 0.24 * Math.cos(t * 0.19) + 0.11 * Math.cos(t * 0.057 + 3.4);
    return [Math.min(Math.max(x, 0.08), 0.92), Math.min(Math.max(y, 0.08), 0.92)];
  }
  function energyFrom(speed, gain) {
    if (!Number.isFinite(speed) || speed <= 0 || gain <= 0) return 0;
    return Math.min(speed * 1.6 * gain, 4);
  }
  function pushPulse(buf, slot, pulse) {
    const n = Math.floor(buf.length / 4);
    const i = ((slot % n) + n) % n;
    buf.set(pulse, i * 4);
    return (i + 1) % n;
  }

  // ---- options -------------------------------------------------------------
  const script = document.currentScript;
  const ds = (script && script.dataset) || {};
  let overrides = {};
  try { overrides = ds.params ? JSON.parse(ds.params) : {}; } catch { /* ignore bad JSON */ }
  const P = { ...DEFAULTS, ...(PRESETS[ds.preset] || {}), ...overrides };
  const interactive = ds.interactive !== "false";

  function init() {
    const root = document.documentElement;
    root.style.setProperty("--isb-bg", P.backgroundColor);
    root.style.setProperty("--isb-core", P.coreColor);
    root.style.setProperty("--isb-mid", P.midColor);

    const canvas = document.createElement("canvas");
    canvas.className = "isb__canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);

    const fallback = () => { root.dataset.isbFallback = ""; canvas.remove(); };
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
    if (!gl) return fallback();

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("isoline-bloom:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return fallback();
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("isoline-bloom:", gl.getProgramInfoLog(program));
      return fallback();
    }
    const loc = (n) => gl.getUniformLocation(program, n);
    const U = {
      res: loc("uRes"), dpr: loc("uDpr"), time: loc("uTime"), morphT: loc("uMorphT"),
      flowPhase: loc("uFlowPhase"), spinA: loc("uSpinA"), hueA: loc("uHueA"),
      center: loc("uCenter"), radius: loc("uRadius"),
      pointer: loc("uPointer"), pointerOn: loc("uPointerOn"), pulse: loc("uPulse"),
    };
    const vao = gl.createVertexArray();
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    // Static parameters only need uploading once.
    for (const [k, kind] of UNIFORMS) {
      if (kind === "c") gl.uniform3fv(loc(uName(k)), hexToRgb(P[k]));
      else gl.uniform1f(loc(uName(k)), P[k]);
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = !matchMedia("(hover: hover) and (pointer: fine)").matches;
    // The shader is per-pixel and full-screen: keep phones cheap.
    const maxDpr = coarse ? 1 : 1.5;

    let cssW = 1, cssH = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      cssW = Math.max(window.innerWidth, 1);
      cssH = Math.max(window.innerHeight, 1);
      const w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (reduced) paint();
    };

    const FROZEN = 9;
    const t0 = performance.now();
    const clock = () => (reduced ? FROZEN : ((performance.now() - t0) / 1000) * P.speed);
    let lastClock = clock();
    let morphT = FROZEN * P.morph, flowPhase = 0, spinA = 0, hueA = 0;

    // ---- the pointer (tracked on the window, since the canvas sits behind the page)
    let targetX = 0.5, targetY = 0.5, lensX = 0.5, lensY = 0.5, lensOn = 0;
    let inside = false, lastTouched = -1e9, energy = 0;
    let lastMove = { x: 0.5, y: 0.5, t: 0 };
    const pulses = new Float32Array(MAX_PULSES * 4);
    let pulseNext = 0;
    const toUv = (e) => [
      Math.min(Math.max(e.clientX / cssW, 0), 1),
      Math.min(Math.max(1 - e.clientY / cssH, 0), 1),
    ];
    if (interactive) {
      window.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return; // touch scrolls the page, it doesn't steer
        const [x, y] = toUv(e);
        const now = performance.now() / 1000;
        const dt = now - lastMove.t;
        if (inside && dt > 0 && dt < 0.25) {
          energy = Math.max(energy, energyFrom(Math.hypot(x - lastMove.x, (y - lastMove.y) * (cssH / cssW)) / dt, P.energy));
        }
        lastMove = { x, y, t: now };
        targetX = x; targetY = y; inside = true; lastTouched = now;
      }, { passive: true });
      window.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        const [x, y] = toUv(e);
        targetX = x; targetY = y; inside = e.pointerType === "mouse";
        lastTouched = performance.now() / 1000;
        lastMove = { x, y, t: lastTouched };
        pulseNext = pushPulse(pulses, pulseNext, [x * cssW, y * cssH, clock(), reduced ? 0 : Math.max(P.pulseSpeed, 0.05)]);
        if (!reduced) energy = Math.max(energy, 1.5 * P.energy);
        if (reduced) paint();
      }, { passive: true });
      document.documentElement.addEventListener("pointerleave", () => (inside = false));
      window.addEventListener("blur", () => (inside = false));
    }

    // ---- one frame -----------------------------------------------------------
    function paint() {
      const t = clock();
      const dt = Math.min(Math.max(t - lastClock, 0), 0.1);
      lastClock = t;
      energy *= Math.exp(-dt * 1.8);
      morphT += dt * P.morph * (1 + energy * 0.5);
      flowPhase += dt * P.flow * (1 + energy);
      spinA += dt * P.spin * Math.PI * 2;
      hueA += dt * P.hueDrift;
      if (reduced) { morphT = FROZEN * P.morph; flowPhase = 0.35; spinA = 0; hueA = 0; }

      const idle = !inside || performance.now() / 1000 - lastTouched > 5;
      const [gx, gy] = driftPos(t * 0.5);
      const wantX = idle ? gx : targetX, wantY = idle ? gy : targetY;
      const k = reduced ? 1 : 1 - Math.exp(-dt * (idle ? 1.2 : 8));
      lensX += (wantX - lensX) * k;
      lensY += (wantY - lensY) * k;
      const onTarget = interactive && !reduced ? (idle ? 0.45 : 1) : 0;
      lensOn += (onTarget - lensOn) * (reduced ? 1 : 1 - Math.exp(-dt * 3));

      const minSide = Math.min(cssW, cssH);
      const cx = (P.centerX + (lensX - P.centerX) * P.pull * lensOn) * cssW;
      const cy = (P.centerY + (lensY - P.centerY) * P.pull * lensOn) * cssH;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.dpr, canvas.width / cssW);
      gl.uniform1f(U.time, t);
      gl.uniform1f(U.morphT, morphT);
      gl.uniform1f(U.flowPhase, flowPhase);
      gl.uniform1f(U.spinA, spinA);
      gl.uniform1f(U.hueA, P.hueAngle + hueA);
      gl.uniform2f(U.center, cx, cy);
      gl.uniform1f(U.radius, Math.max(P.scale * minSide, 1));
      gl.uniform2f(U.pointer, lensX * cssW, lensY * cssH);
      gl.uniform1f(U.pointerOn, lensOn);
      gl.uniform4fv(U.pulse, pulses);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- loop, paused whenever the tab is hidden; ~30fps on touch devices ----
    let raf = 0, lastFrame = 0;
    const frame = (now) => {
      raf = 0;
      if (document.hidden) return;
      if (!coarse || now - lastFrame >= 33) { lastFrame = now; paint(); }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!reduced && !raf && !document.hidden) raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("resize", resize);

    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => location.reload());

    resize();
    paint(); // paint before the first rAF so nothing flashes an empty canvas
    wake();
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
