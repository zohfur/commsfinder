// Dithered wave background. Ported/adapted from ditherwave
// (github.com/sahilsaini5/ditherwave, MIT). WebGL2 fragment shader renders
// fBm noise quantized through a Bayer matrix (modes: bayer | floyd | dots).
//
// Usage: mountDitheredWave(targetEl, { mode, matrixSize, waveColor, baseColor,
//   pixelSize, colorNum, waveSpeed, waveFrequency, waveAmplitude, pixelRatio })
// Returns { destroy(), setColors(waveHex, baseHex), setOptions(partial) }.

(function () {
  const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_frag;

uniform vec2  u_res;
uniform float u_time;
uniform float u_waveSpeed;
uniform float u_waveFrequency;
uniform float u_waveAmplitude;
uniform vec3  u_waveColor;
uniform vec3  u_baseColor;
uniform float u_pixelSize;
uniform float u_colorNum;
uniform int   u_mode;        // 0 bayer · 1 floyd · 2 dots
uniform float u_matrixSize;  // 2 | 4 | 8

vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P){
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

float fbm(vec2 p){
  float v = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 4; i++) {
    v += amp * abs(cnoise(p));
    p *= u_waveFrequency;
    amp *= u_waveAmplitude;
  }
  return v;
}
float pattern(vec2 p){
  vec2 q = p - vec2(u_time * u_waveSpeed, 0.0);
  return fbm(p + fbm(q));
}

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

const float BAYER[64] = float[64](
   0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0, 16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0, 19.0/64.0, 47.0/64.0, 31.0/64.0,
   8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0, 59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0, 24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0, 27.0/64.0, 39.0/64.0, 23.0/64.0,
   2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0, 49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0, 18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0, 17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0, 58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0, 57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0, 26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0, 25.0/64.0, 37.0/64.0, 21.0/64.0
);

float bayer8(vec2 p){
  int x = int(mod(p.x, 8.0));
  int y = int(mod(p.y, 8.0));
  return BAYER[y * 8 + x] - 0.5;
}
float bayer2(vec2 p){
  int x = int(mod(p.x, 2.0));
  int y = int(mod(p.y, 2.0));
  float m[4] = float[4](0.0/4.0, 2.0/4.0, 3.0/4.0, 1.0/4.0);
  return m[y * 2 + x] - 0.5;
}
float bayer4(vec2 p){
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  float m[16] = float[16](
     0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
    12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
     3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
    15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
  );
  return m[y * 4 + x] - 0.5;
}
float bayerN(vec2 p, float n){
  if (n < 3.0) return bayer2(p);
  if (n < 5.0) return bayer4(p);
  return bayer8(p);
}

float sampleWave(vec2 snappedUV){
  vec2 p = snappedUV - 0.5;
  p.x *= u_res.x / u_res.y;
  float f = pattern(p);
  return clamp(f, 0.0, 1.0);
}

void main(){
  vec2 px = u_pixelSize / u_res;
  vec2 snappedUV = px * floor(v_uv / px);
  vec2 cell = floor(v_uv * u_res / u_pixelSize);

  float f = sampleWave(snappedUV);
  vec3 col = mix(u_baseColor, u_waveColor, f);

  // ----- bayer (default) -----
  if (u_mode == 0) {
    float threshold = bayerN(cell, u_matrixSize) * 0.5;
    float step = 1.0 / max(u_colorNum - 1.0, 1.0);
    vec3 c = col + vec3(threshold) * step;
    c = clamp(c - 0.15, 0.0, 1.0);
    c = floor(c * (u_colorNum - 1.0) + 0.5) / (u_colorNum - 1.0);
    o_frag = vec4(c, 1.0);
    return;
  }

  // ----- floyd / riemersma approximation -----
  if (u_mode == 1) {
    float n = hash(cell + u_time * 13.0) - 0.5;
    float b = bayerN(cell, u_matrixSize) * 0.4;
    float threshold = (n * 0.65 + b) * 0.9;
    float step = 1.0 / max(u_colorNum - 1.0, 1.0);
    vec3 c = col + vec3(threshold) * step;
    c = clamp(c, 0.0, 1.0);
    c = floor(c * (u_colorNum - 1.0) + 0.5) / (u_colorNum - 1.0);
    o_frag = vec4(c, 1.0);
    return;
  }

  // ----- dots / halftone -----
  float ang = radians(15.0);
  float cs = cos(ang), sn = sin(ang);
  mat2 rot = mat2(cs, -sn, sn, cs);
  vec2 uvCentered = v_uv - 0.5;
  uvCentered.x *= u_res.x / u_res.y;
  float dotsAcross = u_res.y / (u_pixelSize * 2.0);
  vec2 dp = rot * uvCentered * dotsAcross;
  vec2 fc = fract(dp) - 0.5;
  float dark = 1.0 - f;
  float r = sqrt(dark) * 0.58;
  float d = length(fc);
  float edge = fwidth(d) + 0.01;
  float mask = smoothstep(r + edge, r - edge, d);
  o_frag = vec4(mix(u_baseColor, u_waveColor, mask), 1.0);
}`;

  const MODE_INDEX = { bayer: 0, floyd: 1, dots: 2 };

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[dither] shader error', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function mountDitheredWave(target, opts = {}) {
    const cfg = Object.assign({
      mode: 'bayer',
      matrixSize: 8,
      waveColor: '#8b6dff',
      baseColor: '#1a1530',
      pixelSize: 3,
      colorNum: 3,
      waveSpeed: 0.04,
      waveFrequency: 2.4,
      waveAmplitude: 0.45,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      fps: 30,
    }, opts);

    const canvas = document.createElement('canvas');
    canvas.className = 'dither-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.insertBefore(canvas, target.firstChild);

    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      console.warn('[dither] WebGL2 unavailable, skipping');
      canvas.remove();
      return { destroy() {}, setColors() {}, setOptions() {} };
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return { destroy() { canvas.remove(); }, setColors() {}, setOptions() {} };

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[dither] link error', gl.getProgramInfoLog(prog));
      return { destroy() { canvas.remove(); }, setColors() {}, setOptions() {} };
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const loc = {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      waveSpeed: gl.getUniformLocation(prog, 'u_waveSpeed'),
      waveFreq: gl.getUniformLocation(prog, 'u_waveFrequency'),
      waveAmp: gl.getUniformLocation(prog, 'u_waveAmplitude'),
      waveColor: gl.getUniformLocation(prog, 'u_waveColor'),
      baseColor: gl.getUniformLocation(prog, 'u_baseColor'),
      pixelSize: gl.getUniformLocation(prog, 'u_pixelSize'),
      colorNum: gl.getUniformLocation(prog, 'u_colorNum'),
      mode: gl.getUniformLocation(prog, 'u_mode'),
      matrixSize: gl.getUniformLocation(prog, 'u_matrixSize'),
    };

    function applyUniforms() {
      const waveRgb = hexToRgb(cfg.waveColor);
      const baseRgb = hexToRgb(cfg.baseColor);
      gl.uniform3f(loc.waveColor, waveRgb[0], waveRgb[1], waveRgb[2]);
      gl.uniform3f(loc.baseColor, baseRgb[0], baseRgb[1], baseRgb[2]);
      gl.uniform1f(loc.waveSpeed, cfg.waveSpeed);
      gl.uniform1f(loc.waveFreq, cfg.waveFrequency);
      gl.uniform1f(loc.waveAmp, cfg.waveAmplitude);
      gl.uniform1f(loc.pixelSize, Math.max(1, cfg.pixelSize));
      gl.uniform1f(loc.colorNum, Math.max(2, Math.min(8, cfg.colorNum)));
      gl.uniform1i(loc.mode, MODE_INDEX[cfg.mode] ?? 0);
      gl.uniform1f(loc.matrixSize, cfg.matrixSize);
    }
    applyUniforms();

    let rafId = 0;
    let startTime = performance.now();
    let lastW = 0;
    let lastH = 0;
    let visible = true;

    function resize() {
      const cssW = canvas.clientWidth || target.clientWidth || 1;
      const cssH = canvas.clientHeight || target.clientHeight || 1;
      const w = Math.max(1, Math.floor(cssW * cfg.pixelRatio));
      const h = Math.max(1, Math.floor(cssH * cfg.pixelRatio));
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(loc.res, w, h);
    }

    const frameInterval = cfg.fps > 0 ? 1000 / cfg.fps : 0;
    let lastDraw = 0;

    function frame(now) {
      if (!visible) return;
      rafId = requestAnimationFrame(frame);
      // Throttle to cfg.fps. The wave drifts slowly (waveSpeed ~0.04-0.1),
      // so capping the draw rate is visually transparent but cuts shader and
      // draw-call work substantially when several canvases are mounted.
      if (frameInterval && now - lastDraw < frameInterval) return;
      lastDraw = now;
      const t = (performance.now() - startTime) / 1000;
      gl.uniform1f(loc.time, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Size once up front; the ResizeObserver below keeps it in sync. Reading
    // clientWidth/clientHeight inside the rAF loop would force a layout reflow
    // every frame, so resize stays entirely off the render path.
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(target);
    ro.observe(canvas);
    if (target.parentElement) ro.observe(target.parentElement);

    function onVisChange() {
      if (document.hidden) {
        visible = false;
        cancelAnimationFrame(rafId);
      } else if (!visible) {
        visible = true;
        startTime = performance.now() - 1000;
        rafId = requestAnimationFrame(frame);
      }
    }
    document.addEventListener('visibilitychange', onVisChange);

    rafId = requestAnimationFrame(frame);

    return {
      destroy() {
        cancelAnimationFrame(rafId);
        ro.disconnect();
        document.removeEventListener('visibilitychange', onVisChange);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        canvas.remove();
      },
      setColors(waveHex, baseHex) {
        cfg.waveColor = waveHex;
        cfg.baseColor = baseHex;
        gl.useProgram(prog);
        applyUniforms();
      },
      setOptions(next) {
        Object.assign(cfg, next);
        gl.useProgram(prog);
        applyUniforms();
      },
    };
  }

  window.mountDitheredWave = mountDitheredWave;
})();
