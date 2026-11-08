// live/gl.js — a tiny deterministic WebGL2 layer renderer: textures (premultiplied, mipmapped or nearest), programs, render
// targets, pixel-space quads (y down) with an affine transform. Everything the scene draws is a quad with a shader.
(function () {
  const G = (window.G = {});
  let gl,
    quadBuf,
    cur = null;
  const progs = {},
    texs = {};

  // preserve: keep the drawn frame after it is shown (only to read it back later: ?render's toDataURL; a phone's GPU pays a copy a frame)
  G.init = (canvas, W, H, { preserve = false } = {}) => {
    canvas.width = W;
    canvas.height = H;
    gl = G.gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: preserve,
    });
    if (!gl) throw new Error('WebGL2 not available');
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    G.W = W;
    G.H = H;
    G.PW = W;
    G.PH = H;
    G.canvas = canvas;
  };
  // a new drawing-buffer size (the lobby takes the window's shape; the game keeps its view): W × H view px in a buffer cs of that
  // (G.PW × G.PH: a phone's run is drawn smaller and the page scales it up; draws keep using view px); true when it changed
  G.resize = (W, H, cs = 1) => {
    const pw = Math.round(W * cs),
      ph = Math.round(H * cs);
    if (G.W === W && G.H === H && G.PW === pw && G.PH === ph) return false;
    G.canvas.width = pw;
    G.canvas.height = ph;
    G.W = W;
    G.H = H;
    G.PW = pw;
    G.PH = ph;
    return true;
  };

  // nearest: NEAREST min/mag, no mipmaps (pixel art: crisp texels; lod bias has no effect)
  G.load = (name, url, { repeat = false, nearest = false } = {}) =>
    new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        if (!nearest) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
        const wr = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
        texs[name] = { t, w: im.width, h: im.height };
        res(texs[name]);
      };
      im.onerror = () => rej(new Error('failed to load ' + url));
      im.src = url;
    });
  G.canvasTex = (name, cv) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return (texs[name] = { t, w: cv.width, h: cv.height });
  };
  G.tex = (n) => {
    const t = texs[n];
    if (!t) throw new Error('no texture ' + n);
    return t;
  };

  const VS = `#version 300 es
in vec2 a_pos; uniform vec2 u_res; uniform mat3 u_xf; uniform vec2 u_flip;
out vec2 v_uv; out vec2 v_px;
void main(){ vec3 p = u_xf * vec3(a_pos, 1.0); v_px = p.xy; v_uv = mix(a_pos, 1.0 - a_pos, u_flip);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  const COMMON = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_px; out vec4 o;
uniform vec2 u_res; uniform float u_t;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
vec2 scr(vec2 px){ return vec2(px.x / u_res.x, 1.0 - px.y / u_res.y); }   // screen px -> render-target uv
`;
  G.COMMON = COMMON;

  // a program: compile and link, then read its uniforms (start and finish apart, so a big one can compile in the background)
  let vs = null,
    par;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const start = (fs) => {
    if (!vs) vs = shader(gl.VERTEX_SHADER, VS);
    const f = shader(gl.FRAGMENT_SHADER, COMMON + fs),
      p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    return { p, f };
  };
  const failed = {};
  const finish = (name, { p, f }) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = !gl.getShaderParameter(f, gl.COMPILE_STATUS)
        ? gl.getShaderInfoLog(f)
        : !gl.getShaderParameter(vs, gl.COMPILE_STATUS)
          ? gl.getShaderInfoLog(vs)
          : gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      gl.deleteShader(f);
      throw (failed[name] = new Error(name + ': ' + log));
    }
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const u = gl.getActiveUniform(p, i);
      loc[u.name.replace('[0]', '')] = { l: gl.getUniformLocation(p, u.name), type: u.type };
    }
    return (progs[name] = { p, loc, name });
  };
  const pending = {}; // started in the background, not finished yet
  G.program = (name, fs) => {
    if (progs[name]) return progs[name];
    if (failed[name]) throw failed[name];
    const q = pending[name] || start(fs);
    delete pending[name];
    return finish(name, q);
  };
  // in the background (KHR_parallel_shader_compile): null until the driver has it, then the program; without the extension it is
  // compiled when first asked for, as G.program would
  G.parallel = () => {
    if (par === undefined) par = gl.getExtension('KHR_parallel_shader_compile');
    return !!par;
  };
  G.prepare = (name, fs) => {
    if (progs[name]) return progs[name];
    if (failed[name]) throw failed[name];
    if (par === undefined) par = gl.getExtension('KHR_parallel_shader_compile');
    if (!par) return G.program(name, fs);
    const q = pending[name] || (pending[name] = start(fs));
    if (!gl.getProgramParameter(q.p, par.COMPLETION_STATUS_KHR)) return null;
    delete pending[name];
    return finish(name, q);
  };

  // view: the coordinate space draws use (default w×h), e.g. a W/k × H/k target drawn in W×H view px; nearest: sample it crisp
  G.target = (w, h, float = false, { view = [w, h], nearest = false } = {}) => {
    const t = gl.createTexture(),
      f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const store = (fl) =>
      fl
        ? gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
        : gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    store(float);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (float && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      if (!G.noFloat) console.warn('float render targets unsupported here: RGBA8 (light clamps at 1)');
      G.noFloat = true;
      store(false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur ? cur.fb : null);
    return { fb, t, w, h, vw: view[0], vh: view[1] };
  };
  G.free = (tg) => {
    if (tg) {
      gl.deleteFramebuffer(tg.fb);
      gl.deleteTexture(tg.t);
    }
  };
  // the canvas drawn into a part of itself: { x, y, w, h } buffer px from the top left, taking draws in a vw × vh view of its own (the
  // run's HUD inside a phone's safe area: scene.js hud); null, the whole canvas in G.W × G.H. Targets bound meanwhile are drawn whole
  let sub = null;
  const port = () => {
    if (cur) gl.viewport(0, 0, cur.w, cur.h);
    else if (sub) gl.viewport(sub.x, G.PH - sub.y - sub.h, sub.w, sub.h);
    else gl.viewport(0, 0, G.PW, G.PH);
  };
  G.sub = (s) => {
    sub = s;
    port();
  };
  G.bind = (tg, clear) => {
    cur = tg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fb : null);
    port();
    if (clear) {
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };
  G.view = () => (cur ? [cur.vw, cur.vh] : sub ? [sub.vw, sub.vh] : [G.W, G.H]); // the coordinate space draws use right now
  G.current = () => cur; // the bound target (null: the canvas), to come back to
  G.blend = (mode) => {
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === 'none') gl.disable(gl.BLEND);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  // affine: place the unit quad at x,y (top-left) with size w,h, rotated by rot (rad) about pivot (px,py) in local px
  G.xf = (x, y, w, h, rot = 0, px = 0, py = 0) => {
    const c = Math.cos(rot),
      s = Math.sin(rot);
    // local (u*w - px, v*h - py) rotated, then + (x + px, y + py)
    return [w * c, w * s, 0, -h * s, h * c, 0, x + px - (px * c - py * s), y + py - (px * s + py * c), 1];
  };

  // a uniform keeps its value in its program: each one is sent only when it changed since that program's last draw (u.c: a copy of
  // the value last sent; programs drawn through here get every uniform set through here). Textures are bound every draw (units are shared)
  let unit = 0;
  const same = (u, v) => {
    const c = u.c;
    if (c === undefined) return false;
    if (typeof v === 'number') return c === v;
    if (typeof c === 'number' || c.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) if (c[i] !== v[i]) return false;
    return true;
  };
  const keep = (u, v) => {
    if (typeof v === 'number') {
      u.c = v;
      return;
    }
    if (!u.c || typeof u.c === 'number' || u.c.length !== v.length) u.c = new Float64Array(v.length);
    u.c.set(v);
  };
  const setU = (P, k, v) => {
    const u = P.loc[k];
    if (!u) return;
    const T = gl;
    if (u.type === T.SAMPLER_2D) {
      const tx = v.t || v;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      if (u.c !== unit) {
        gl.uniform1i(u.l, unit);
        u.c = unit;
      }
      unit++;
      return;
    }
    if (same(u, v)) return;
    keep(u, v);
    if (u.type === T.FLOAT) gl.uniform1f(u.l, v);
    else if (u.type === T.FLOAT_VEC2) gl.uniform2fv(u.l, v);
    else if (u.type === T.FLOAT_VEC3) gl.uniform3fv(u.l, v);
    else if (u.type === T.FLOAT_VEC4) gl.uniform4fv(u.l, v);
    else if (u.type === T.FLOAT_MAT3) gl.uniformMatrix3fv(u.l, false, v);
    else if (u.type === T.INT) gl.uniform1i(u.l, v);
  };
  const RES = [0, 0],
    NOFLIP = [0, 0];
  G.draw = (P, U, xf, flip = NOFLIP) => {
    gl.useProgram(P.p);
    unit = 0;
    RES[0] = cur ? cur.vw : sub ? sub.vw : G.W;
    RES[1] = cur ? cur.vh : sub ? sub.vh : G.H;
    setU(P, 'u_res', RES);
    setU(P, 'u_xf', xf);
    setU(P, 'u_flip', flip);
    for (const k in U) setU(P, k, U[k]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  G.quadAttrib = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }; // the unit quad on attribute 0
  G.full = (P, U) => {
    const res = G.view();
    G.draw(P, U, G.xf(0, 0, res[0], res[1]));
  };
})();
