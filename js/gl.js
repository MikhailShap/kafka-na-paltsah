/* Мини 3D-движок на чистом WebGL2. Никаких библиотек, работает офлайн.
   Всё в сцене собрано из одной фигуры: куба со скруглёнными углами. */
(function () {
  'use strict';
  const K = (window.K = window.K || {});

  /* ---------- математика ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function persp(fovY, asp, n, f) {
    const t = 1 / Math.tan(fovY / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  }
  function ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }
  function lookAt(e, c, u) {
    const z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }

  /* ---------- цвет ---------- */
  const cache = new Map();
  function rgb(c) {
    if (Array.isArray(c)) return c;
    let v = cache.get(c);
    if (!v) {
      const n = parseInt(c.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.pow(x / 255, 2.2));
      cache.set(c, v);
    }
    return v;
  }
  function mix(a, b, t) { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* ---------- шейдеры ---------- */
  const COMMON_VS = `
    layout(location=0) in vec3 aN; layout(location=1) in vec3 aS;
    layout(location=2) in vec4 iPosR; layout(location=3) in vec4 iHalfA;
    layout(location=4) in vec4 iColE; layout(location=5) in vec4 iRot;
    vec3 rot(vec3 p, vec2 r){
      float c=cos(r.y), s=sin(r.y); p=vec3(p.x*c-p.y*s, p.x*s+p.y*c, p.z);
      c=cos(r.x); s=sin(r.x); return vec3(p.x*c+p.z*s, p.y, -p.x*s+p.z*c);
    }
    vec3 localPos(){
      vec3 h=iHalfA.xyz; float r=min(iPosR.w, min(h.x,min(h.y,h.z)));
      return aS*(h-r)+aN*r;
    }`;
  const VS = `#version 300 es
    ${COMMON_VS}
    uniform mat4 uVP, uLVP; uniform vec2 uShift;
    out vec3 vN, vW, vL; out vec4 vC; out vec4 vLS; flat out vec3 vH; flat out vec2 vM; flat out float vE;
    void main(){
      vec3 lp=localPos(); vec3 w=rot(lp,iRot.xy)+iPosR.xyz;
      vN=rot(aN,iRot.xy); vW=w; vL=lp; vH=iHalfA.xyz; vM=iRot.zw;
      vC=vec4(iColE.rgb,iHalfA.a); vE=iColE.a; vLS=uLVP*vec4(w,1.);
      gl_Position=uVP*vec4(w,1.); gl_Position.xy+=uShift*gl_Position.w;
    }`;
  const LIGHT = `
    uniform highp sampler2DShadow uSh; uniform vec3 uL, uEye, uBg; uniform float uFade;
    float shadow(vec4 ls, float ndl){
      vec3 p=ls.xyz/ls.w*.5+.5; if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.) return 1.;
      float b=.0012+.0022*(1.-ndl), s=0.; float tx=1./2048.;
      for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s+=texture(uSh, vec3(p.xy+vec2(i,j)*tx*1.35, p.z-b));
      return s/9.;
    }
    vec3 tone(vec3 c){ c=c*(1.+c*.12)/(1.+c*.42); return pow(max(c,0.),vec3(1./2.2)); }`;
  const FS = `#version 300 es
    precision highp float; precision highp sampler2DShadow;
    in vec3 vN, vW, vL; in vec4 vC; in vec4 vLS; flat in vec3 vH; flat in vec2 vM; flat in float vE;
    out vec4 o;
    ${LIGHT}
    void main(){
      vec3 N=normalize(vN), V=normalize(uEye-vW); vec3 base=vC.rgb; float m=vM.x;
      if(m>.5&&m<1.5){ // посылка: наклейка сверху и скотч по бокам
        vec3 q=abs(vL)/vH;
        if(vL.y>vH.y*.8 && q.x<.74 && q.z<.6) base=vec3(.93,.92,.86);
        else if(q.x<.16) base=mix(base,vec3(.95,.86,.66),.45);
      } else if(m>1.5&&m<2.5){ // пол дорожки: риски между ячейками
        float u=fract(vL.x+vM.y); float d=min(u,1.-u); float w=fwidth(vL.x);
        base=mix(base*1.75+.02, base, smoothstep(.02,.02+w*1.5,d));
      } else if(m>2.5&&m<3.5){ // решётка корпуса
        float u=fract(vL.x*2.2); base*= u<.3?.72:1.;
      }
      float ndl=dot(N,uL); float wrap=clamp((ndl+.22)/1.22,0.,1.);
      float sh=mix(1.,shadow(vLS,max(ndl,0.)),step(0.,ndl));
      vec3 sky=vec3(.74,.86,.88), gnd=vec3(.20,.31,.28);
      vec3 amb=mix(gnd,sky,N.y*.5+.5)*.62;
      float ao=mix(.72,1.,smoothstep(0.,1.2,vW.y));
      vec3 c=base*(amb*ao+vec3(1.12,1.06,.96)*wrap*wrap*sh*1.25);
      vec3 H=normalize(uL+V); c+=vec3(1.)*pow(max(dot(N,H),0.),48.)*.14*sh;
      c+=base*pow(1.-max(dot(N,V),0.),3.)*.35*(N.y*.5+.5);
      c=mix(c,base*1.55+.02,vE);
      o=vec4(tone(c),vC.a);
    }`;
  const SHVS = `#version 300 es
    ${COMMON_VS}
    uniform mat4 uLVP; void main(){ gl_Position=uLVP*vec4(rot(localPos(),iRot.xy)+iPosR.xyz,1.); }`;
  const SHFS = `#version 300 es
    precision mediump float; void main(){}`;
  const GVS = `#version 300 es
    layout(location=0) in vec2 aP; uniform mat4 uVP,uLVP; uniform vec2 uShift; out vec3 vW; out vec4 vLS;
    void main(){ vW=vec3(aP.x*140.,0.,aP.y*140.); vLS=uLVP*vec4(vW,1.); gl_Position=uVP*vec4(vW,1.); gl_Position.xy+=uShift*gl_Position.w; }`;
  const GFS = `#version 300 es
    precision highp float; precision highp sampler2DShadow;
    in vec3 vW; in vec4 vLS; out vec4 o; uniform vec3 uMat, uLine, uCenter;
    ${LIGHT}
    float grid(float s,float w){ vec2 g=abs(fract(vW.xz/s-.5)-.5)/fwidth(vW.xz/s); return 1.-smoothstep(0.,w,min(g.x,g.y)); }
    void main(){
      float sh=shadow(vLS,1.);
      vec3 c=uMat;
      c=mix(c,uLine,grid(1.,1.1)*.22); c=mix(c,uLine,grid(5.,1.4)*.6);
      c*=mix(.50,1.,sh);
      float d=length((vW-uCenter).xz)/uFade;
      o=vec4(mix(tone(c),uBg,smoothstep(.35,1.,d)),1.);
    }`;
  const TVS = `#version 300 es
    layout(location=0) in vec2 aQ; layout(location=1) in vec4 iP; layout(location=2) in vec4 iU;
    uniform mat4 uVP; uniform vec2 uShift; out vec2 vU; out float vA;
    void main(){ vec3 w=iP.xyz+vec3(aQ.x*iP.w*.62,0.,-aQ.y*iP.w); vU=vec2((iU.x+aQ.x*.5+.5)/10., .5-aQ.y*.5); vA=iU.y;
      gl_Position=uVP*vec4(w,1.); gl_Position.xy+=uShift*gl_Position.w; }`;
  const TFS = `#version 300 es
    precision mediump float; in vec2 vU; in float vA; uniform sampler2D uT; out vec4 o;
    void main(){ float a=texture(uT,vU).a; if(a<.05) discard; o=vec4(.07,.13,.12,a*vA); }`;

  function prog(gl, vs, fs) {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, src]) => {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }

  /* Скруглённый куб: у каждой вершины есть нормаль и «знак» угла. */
  function roundedBox(k) {
    const V = [], I = [];
    const ticks = [];
    for (let i = 0; i < k; i++) ticks.push([-1 + i / (k - 1), -1]);
    for (let i = 0; i < k; i++) ticks.push([i / (k - 1), 1]);
    const m = ticks.length;
    for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
      const b = V.length / 6, u = (ax + 1) % 3, v = (ax + 2) % 3;
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        const P = [0, 0, 0], S = [0, 0, 0];
        P[ax] = s; S[ax] = s;
        P[u] = Math.tan(ticks[i][0] * Math.PI / 4); S[u] = ticks[i][1];
        P[v] = Math.tan(ticks[j][0] * Math.PI / 4); S[v] = ticks[j][1];
        const N = norm(P); V.push(N[0], N[1], N[2], S[0], S[1], S[2]);
      }
      for (let i = 0; i < m - 1; i++) for (let j = 0; j < m - 1; j++) {
        const a = b + i * m + j, c = a + 1, d = a + m, e = d + 1;
        if (s > 0) I.push(a, d, c, c, d, e); else I.push(a, c, d, c, e, d);
      }
    }
    return { v: new Float32Array(V), i: new Uint16Array(I) };
  }

  const STRIDE = 16, MAX = 7000, MAXT = 900, MAXG = 1400;

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('no-webgl2');
      this.gl = gl; this.canvas = canvas;
      this.pMain = prog(gl, VS, FS); this.pSh = prog(gl, SHVS, SHFS); this.pG = prog(gl, GVS, GFS); this.pT = prog(gl, TVS, TFS);
      this.data = new Float32Array(STRIDE * MAX); this.n = 0;
      this.tr = [];
      this.trData = new Float32Array(STRIDE * MAXT);
      this.gd = new Float32Array(8 * MAXG); this.gn = 0;

      const mesh = roundedBox(4);
      this.count = mesh.i.length;
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.v, gl.STATIC_DRAW);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.i, gl.STATIC_DRAW);
      const makeVao = (size) => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, size, gl.DYNAMIC_DRAW);
        for (let a = 0; a < 4; a++) {
          gl.enableVertexAttribArray(2 + a); gl.vertexAttribPointer(2 + a, 4, gl.FLOAT, false, STRIDE * 4, a * 16); gl.vertexAttribDivisor(2 + a, 1);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bindVertexArray(null);
        return { vao, inst };
      };
      this.op = makeVao(this.data.byteLength); this.ta = makeVao(this.trData.byteLength);

      this.gVao = gl.createVertexArray(); gl.bindVertexArray(this.gVao);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.tVao = gl.createVertexArray(); gl.bindVertexArray(this.tVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.gInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.gInst); gl.bufferData(gl.ARRAY_BUFFER, this.gd.byteLength, gl.DYNAMIC_DRAW);
      for (let a = 0; a < 2; a++) { gl.enableVertexAttribArray(1 + a); gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, 32, a * 16); gl.vertexAttribDivisor(1 + a, 1); }
      gl.bindVertexArray(null);

      // цифры для номеров на посылках
      const c = document.createElement('canvas'); c.width = 640; c.height = 64 * 1.6 | 0;
      const x = c.getContext('2d'); x.font = '700 92px Bahnschrift, "Segoe UI", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let i = 0; i < 10; i++) x.fillText(String(i), i * 64 + 32, c.height / 2 + 5);
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.sh = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.sh);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 2048, 2048, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sh, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.L = norm([-0.42, 1, 0.46]);
      this.bg = [0x12 / 255, 0x3f / 255, 0x3b / 255];
      this.mat = rgb('#1d5b55'); this.line = rgb('#5d9a90');
    }
    begin() { this.n = 0; this.tr.length = 0; this.gn = 0; }

    /* Добавить скруглённый куб. o: {a, e, yaw, pitch, m, mp} */
    box(x, y, z, hx, hy, hz, r, color, o) {
      const a = o && o.a !== undefined ? o.a : 1;
      if (a <= 0.01 || hx <= 0.001 || hy <= 0.001 || hz <= 0.001) return;
      const c = rgb(color);
      if (a < 0.995) {
        if (this.tr.length < MAXT) this.tr.push([x, y, z, r, hx, hy, hz, a, c[0], c[1], c[2], (o && o.e) || 0, (o && o.yaw) || 0, (o && o.pitch) || 0, (o && o.m) || 0, (o && o.mp) || 0]);
        return;
      }
      if (this.n >= MAX) return;
      const d = this.data, i = this.n++ * STRIDE;
      d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = r; d[i + 4] = hx; d[i + 5] = hy; d[i + 6] = hz; d[i + 7] = 1;
      d[i + 8] = c[0]; d[i + 9] = c[1]; d[i + 10] = c[2]; d[i + 11] = (o && o.e) || 0;
      d[i + 12] = (o && o.yaw) || 0; d[i + 13] = (o && o.pitch) || 0; d[i + 14] = (o && o.m) || 0; d[i + 15] = (o && o.mp) || 0;
    }
    /* Отрезок-капсула между двумя точками. */
    seg(a, b, r, color, o) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz);
      if (l < 1e-4) return;
      const h = Math.hypot(dx, dz);
      this.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, l / 2 + r * 0.6, r, r, r, color,
        Object.assign({}, o, { yaw: Math.atan2(-dz, dx), pitch: Math.atan2(dy, h) }));
    }
    /* Число, лежащее на верхней грани. */
    digits(num, x, y, z, size, alpha) {
      const s = String(num), n = s.length, h = n > 2 ? size * 0.78 : size, w = h * 1.12;
      for (let i = 0; i < n && this.gn < MAXG; i++) {
        const j = this.gn++ * 8;
        this.gd[j] = x + (i - (n - 1) / 2) * w; this.gd[j + 1] = y; this.gd[j + 2] = z; this.gd[j + 3] = h;
        this.gd[j + 4] = s.charCodeAt(i) - 48; this.gd[j + 5] = alpha === undefined ? 1 : alpha;
      }
    }
    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    render(cam, center, radius) {
      const gl = this.gl; this.resize();
      const asp = this.canvas.width / this.canvas.height;
      const eye = cam.eye();
      const view = lookAt(eye, cam.target, [0, 1, 0]), pr = persp(cam.fov, asp, 1, 400), VP = mul(pr, view);
      const le = [center[0] + this.L[0] * 60, center[1] + this.L[1] * 60, center[2] + this.L[2] * 60];
      const LVP = mul(ortho(-radius, radius, -radius, radius, 10, 110), lookAt(le, center, [0, 0, -1]));
      this.VP = VP; this.asp = asp; this.eye = eye;

      const ex = [eye[0], eye[1], eye[2]];
      this.tr.sort((p, q) => {
        const a = (p[0] - ex[0]) ** 2 + (p[1] - ex[1]) ** 2 + (p[2] - ex[2]) ** 2, b = (q[0] - ex[0]) ** 2 + (q[1] - ex[1]) ** 2 + (q[2] - ex[2]) ** 2;
        return b - a;
      });
      for (let i = 0; i < this.tr.length; i++) this.trData.set(this.tr[i], i * STRIDE);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.op.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * STRIDE);
      if (this.tr.length) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ta.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trData, 0, this.tr.length * STRIDE); }
      if (this.gn) { gl.bindBuffer(gl.ARRAY_BUFFER, this.gInst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.gd, 0, this.gn * 8); }

      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      // тени
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, 2048, 2048); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.pSh.p); gl.uniformMatrix4fv(this.pSh.u.uLVP, false, LVP);
      gl.bindVertexArray(this.op.vao); gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0, this.n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sh);
      const common = (P) => {
        gl.useProgram(P.p);
        gl.uniformMatrix4fv(P.u.uVP, false, VP); gl.uniformMatrix4fv(P.u.uLVP, false, LVP);
        gl.uniform2f(P.u.uShift, cam.shift[0], cam.shift[1]);
        gl.uniform3fv(P.u.uL, this.L); gl.uniform3fv(P.u.uEye, eye); gl.uniform3fv(P.u.uBg, this.bg);
        gl.uniform1f(P.u.uFade, Math.max(34, cam.dist * 0.95)); gl.uniform1i(P.u.uSh, 0);
      };
      gl.disable(gl.CULL_FACE);
      common(this.pG); gl.uniform3fv(this.pG.u.uMat, this.mat); gl.uniform3fv(this.pG.u.uLine, this.line); gl.uniform3fv(this.pG.u.uCenter, center);
      gl.bindVertexArray(this.gVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.CULL_FACE);
      common(this.pMain);
      gl.bindVertexArray(this.op.vao); gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0, this.n);

      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      if (this.gn) {
        gl.disable(gl.CULL_FACE);
        gl.useProgram(this.pT.p); gl.uniformMatrix4fv(this.pT.u.uVP, false, VP); gl.uniform2f(this.pT.u.uShift, cam.shift[0], cam.shift[1]);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.pT.u.uT, 1); gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(this.tVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.gn);
        gl.enable(gl.CULL_FACE);
      }
      if (this.tr.length) {
        common(this.pMain);
        gl.bindVertexArray(this.ta.vao); gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0, this.tr.length);
      }
      gl.depthMask(true); gl.bindVertexArray(null);
    }
    /* Мировая точка -> пиксели холста. */
    project(x, y, z, cam) {
      const m = this.VP; if (!m) return null;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w + cam.shift[0], cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w + cam.shift[1];
      return [(cx * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - cy * 0.5) * this.canvas.clientHeight, w];
    }
  }

  const YAW = 0.52, PITCH = 0.62;
  class Camera {
    constructor() {
      this.fov = 0.44; this.target = [0, 0, 0]; this.dist = 46; this.yaw = YAW; this.base = YAW; this.pitch = PITCH; this.shift = [0, 0];
      this.user = { yaw: 0, pitch: 0, zoom: 1 };
      this.goal = { target: [0, 0, 0], dist: 46 };
      this.first = true;
    }
    basis(yaw, pitch) {
      const b = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const f = [-b[0], -b[1], -b[2]], r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
      return { b, f, r, u };
    }
    eye() { const { b } = this.basis(this.yaw, this.pitch); return [this.target[0] + b[0] * this.dist, this.target[1] + b[1] * this.dist, this.target[2] + b[2] * this.dist]; }
    /* Вписать коробку в прямоугольник экрана (inset в долях NDC). */
    fit(boxes, asp, inset) {
      const { f, r, u } = this.basis(this.base + this.user.yaw * 0.6, PITCH + this.user.pitch * 0.6);
      const ty = Math.tan(this.fov / 2), tx = ty * asp;
      const sx = 1 - (inset.l + inset.r) / 2, sy = 1 - (inset.t + inset.b) / 2;
      const C = [];
      for (const box of boxes) for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) C.push([x, y, z]);
      let t = [0, 0, 0], d = 40;
      for (let k = 0; k < 5; k++) {
        d = 0;
        for (const c of C) {
          const q = sub(c, t), z = dot(q, f);
          d = Math.max(d, Math.abs(dot(q, r)) / (tx * sx) - z, Math.abs(dot(q, u)) / (ty * sy) - z);
        }
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        for (const c of C) {
          const q = sub(c, t), z = d + dot(q, f), X = dot(q, r) / z, Y = dot(q, u) / z;
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
        }
        const mx = (x0 + x1) / 2 * d, my = (y0 + y1) / 2 * d;
        t = [t[0] + r[0] * mx + u[0] * my, t[1] + r[1] * mx + u[1] * my, t[2] + r[2] * mx + u[2] * my];
      }
      this.goal.target = t; this.goal.dist = d;
      this.goalShift = [(inset.l - inset.r) / 2, (inset.b - inset.t) / 2];
    }
    update(dt) {
      const k = this.first ? 1 : 1 - Math.exp(-dt * 4.2), k2 = this.first ? 1 : 1 - Math.exp(-dt * 12);
      this.first = false;
      for (let i = 0; i < 3; i++) this.target[i] += (this.goal.target[i] - this.target[i]) * k;
      this.dist += (this.goal.dist * this.user.zoom - this.dist) * k;
      this.yaw += (this.base + this.user.yaw - this.yaw) * k2; this.pitch += (PITCH + this.user.pitch - this.pitch) * k2;
      const s = this.goalShift || [0, 0];
      for (let i = 0; i < 2; i++) this.shift[i] += (s[i] - this.shift[i]) * k;
    }
    ray(nx, ny, asp) {
      const { f, r, u } = this.basis(this.yaw, this.pitch), ty = Math.tan(this.fov / 2), tx = ty * asp;
      const x = (nx - this.shift[0]) * tx, y = (ny - this.shift[1]) * ty;
      return { o: this.eye(), d: norm([f[0] + r[0] * x + u[0] * y, f[1] + r[1] * x + u[1] * y, f[2] + r[2] * x + u[2] * y]) };
    }
  }

  K.Renderer = Renderer; K.Camera = Camera; K.rgb = rgb; K.mixc = mix;
})();
