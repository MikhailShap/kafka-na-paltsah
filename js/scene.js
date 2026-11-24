/* Рисует мир симулятора: брокер, дорожки, посылки, роботов-читателей. Ловит клики по схеме. */
(function () {
  'use strict';
  const K = (window.K = window.K || {});
  const N = 12, LX = 6, TOP = 1.06; // видимых ячеек, половина длины дорожки, высота пола дорожки
  const PX = -10.7, CX = 10.75, BX = LX + 2;
  const C = { cream: '#f2ead8', tray: '#d3c8a8', white: '#fbf7ec', graph: '#2c3336', graph2: '#3a4347', lane: '#46555a', rail: '#efe7d3', wood: '#b4763f', dark: '#1c2a2c', gray: '#8d9a98', red: '#e2503f', lime: '#a8e05a', amber: '#ffb52e', steel: '#c9d3d1' };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const back = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class Scene {
    constructor(canvas, labelRoot, world) {
      this.R = new K.Renderer(canvas); this.cam = new K.Camera(); this.canvas = canvas; this.w = world;
      this.labelRoot = labelRoot; this.labels = new Map(); this.time = 0; this.dt = 0.016;
      this.s = new Map(); this.seen = new Map(); this.picks = []; this.hover = null; this.dragFlag = null;
      this.inset = { t: 90, b: 130, l: 20, r: 20 }; this.box = [-10, 0, -5, 10, 3, 5];
      this.confetti = []; this.findMode = false; this.hint = null;
      this.onPick = null; this.onHover = null; this.onRewind = null;
      this._input();
    }
    clear() { this.seen.clear(); this.s.clear(); this.confetti = []; this.resetCam(); }
    resetCam() { this.cam.user = { yaw: 0, pitch: 0, zoom: 1 }; }

    /* ---------- плавность и появление ---------- */
    sm(id, v, rate) {
      const c = this.s.get(id);
      if (c === undefined) { this.s.set(id, v); return v; }
      const n = c + (v - c) * (1 - Math.exp(-(rate || 7) * this.dt)); this.s.set(id, n); return n;
    }
    spawn(id, delay) {
      if (!this.seen.has(id)) this.seen.set(id, this.time + (delay || 0));
      const t = this.time - this.seen.get(id);
      if (t < 0) return { dy: 0, k: 0 };
      if (reduce) return { dy: 0, k: 1 };
      const q = clamp(t / 0.55, 0, 1);
      return { dy: (1 - ease(q)) * 5, k: q < 1 ? Math.max(0.01, back(q)) : 1 };
    }

    /* ---------- надписи ---------- */
    label(id, x, y, z, text, cls, o) {
      const p = this.R.project(x, y, z, this.cam); if (!p) return;
      let l = this.labels.get(id);
      if (!l) { l = { el: document.createElement('div'), text: null, cls: null }; this.labelRoot.appendChild(l.el); this.labels.set(id, l); }
      if (l.text !== text) { l.el.textContent = text; l.text = text; }
      const full = 'lb ' + (cls || '');
      if (l.cls !== full) { l.el.className = full; l.cls = full; }
      if (o && o.color && l.color !== o.color) { l.el.style.setProperty('--c', o.color); l.color = o.color; }
      l.el.style.transform = `translate(${full.includes(' left') ? '0' : '-50%'},-50%) translate(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px)`;
      l.el.style.display = ''; l.frame = this.frame;
    }
    sweepLabels() { for (const [id, l] of this.labels) if (l.frame !== this.frame) { if (this.frame - l.frame > 120) { l.el.remove(); this.labels.delete(id); } else l.el.style.display = 'none'; } }

    pick(type, id, data, x, y, z, hx, hy, hz) { this.picks.push({ type, id, key: type + ':' + id, data, a: [x - hx, y - hy, z - hz], b: [x + hx, y + hy, z + hz] }); }
    hot(type, id) {
      if (this.flashType === type) return 0.28 + Math.sin(this.time * 14) * 0.2;
      return this.hover && this.hover.key === type + ':' + id ? 0.22 : 0;
    }

    /* ---------- раскладка ---------- */
    layout() {
      const w = this.w, lanes = [];
      let depth = 0;
      w.topics.forEach((t, i) => { if (i) depth += 2.0; t._d0 = depth; depth += t.parts.length * 2.15; t._d1 = depth; });
      const z0 = -depth / 2;
      w.topics.forEach((t) => {
        t._zc = this.sm('tz' + t.id, z0 + (t._d0 + t._d1) / 2); t._h = this.sm('th' + t.id, (t._d1 - t._d0) / 2 + 0.25);
        t.parts.forEach((p, k) => {
          p._z = this.sm('pz' + p.id, z0 + t._d0 + 2.15 * (k + 0.5));
          p._vb = this.sm('vb' + p.id, Math.max(0, p.end - 10), 11);
          lanes.push(p);
        });
      });
      this.lanes = lanes; this.half = this.sm('half', Math.max(1.6, depth / 2 + 0.7));

      let gd = 0; const gap = 1.0;
      w.groups.forEach((g, i) => {
        const cols = g.consumers.length > 6 ? 2 : 1, rows = Math.max(1, Math.ceil(g.consumers.length / cols));
        g._cols = cols; g._d = rows * 2.0 + 0.5; if (i) gd += gap; g._s = gd; gd += g._d;
      });
      let maxCols = 1;
      w.groups.forEach((g) => {
        maxCols = Math.max(maxCols, g._cols);
        g._zc = this.sm('gz' + g.id, -gd / 2 + g._s + g._d / 2); g._hz = this.sm('gh' + g.id, g._d / 2);
        g._hx = this.sm('gx' + g.id, g._cols * 1.15 + 0.2); g._xc = this.sm('gc' + g.id, CX + (g._cols - 1) * 1.15);
        g.consumers.forEach((c, i) => {
          const col = i % g._cols, row = Math.floor(i / g._cols);
          c._x = this.sm('rx' + c.id, CX + col * 2.3); c._z = this.sm('rz' + c.id, -gd / 2 + g._s + 0.25 + 1.0 + row * 2.0);
        });
      });
      const pn = w.producers.length;
      const px = w.sync ? -6.8 : PX - (isFinite(w.brokerCap) ? 1.7 : 0);
      w.producers.forEach((p, i) => { p._x = this.sm('px' + p.id, px); p._z = this.sm('pzz' + p.id, (i - (pn - 1) / 2) * 3.4); });

      const B = [];
      w.producers.forEach((p) => B.push([px - 1.4, 0, p._z - 1.2, px + 1.3, w.sync ? 4.0 : 3.2, p._z + 1.2]));
      if (w.sync) B.push([4.8, 0, -4.8, 7.8, 2.8, 4.8]);
      else {
        if (w.show.broker || w.topics.length) B.push([-BX, 0, -this.half, BX, 1.7, this.half + 0.3]);
        w.groups.forEach((g) => B.push([g._xc - g._hx, 0, g._zc - g._hz, g._xc + g._hx, 2.5, g._zc + g._hz + 0.4]));
      }
      if (!B.length) B.push([-BX, 0, -3, BX, 2, 3]);
      this.boxes = B;
      this.box = [0, 1, 2, 3, 4, 5].map((i) => (i < 3 ? Math.min : Math.max)(...B.map((q) => q[i])));
    }
    slotX(p, off) { return -LX + 0.5 + (off - p._vb); }

    /* ---------- детали ---------- */
    kiosk(p) {
      const R = this.R, sp = this.spawn('prod' + p.id), k = sp.k; if (!k) return;
      const x = p._x, z = p._z, h = this.hot('producer', p.id), on = p.rate > 0 || this.time - (p._click || -9) < 0.3;
      const pulse = clamp(1 - (this.w.t - p.pulse) / 0.25, 0, 1), y = sp.dy - pulse * 0.06, e = h;
      if (p.kind === 'jmeter') {
        R.box(x, y + 0.28, z, 1.0 * k, 0.2, 0.75 * k, 0.12, '#7d2f27', { e });
        for (const sx of [-0.6, 0.6]) for (const sz of [-0.75, 0.75]) R.box(x + sx, y + 0.28, z + sz, 0.28 * k, 0.28, 0.12, 0.12, C.dark);
        const rec = -pulse * 0.25, a = 0.5, dx = Math.cos(a), dy = Math.sin(a);
        R.box(x + rec * dx + 0.1, y + 1.05 + rec * dy, z, 1.15 * k, 0.4, 0.4, 0.38, C.white, { pitch: a, e });
        for (const q of [-0.7, -0.1, 0.5]) R.box(x + 0.1 + (q + rec) * dx, y + 1.05 + (q + rec) * dy, z, 0.13, 0.43 * k, 0.43 * k, 0.13, C.red, { pitch: a, e });
        R.box(x + 0.1 + (1.12 + rec) * dx, y + 1.05 + (1.12 + rec) * dy, z, 0.08, 0.3 * k, 0.3 * k, 0.08, C.dark, { pitch: a });
      } else {
        R.box(x, y + 0.5, z, 0.95 * k, 0.5 * k, 0.85 * k, 0.1, C.cream, { e });
        R.box(x + 0.12, y + 1.06, z, 1.08 * k, 0.07, 1.0 * k, 0.06, C.wood, { e });
        R.box(x - 0.45, y + 1.65, z, 0.42 * k, 0.6, 0.78 * k, 0.08, C.graph2, { e });
        R.box(x - 0.02, y + 1.62, z, 0.03, 0.36 * k, 0.56 * k, 0.03, p.waiting ? '#ff8a6b' : '#9fe3d6', { e: 0.75 });
        for (const sz of [-0.82, 0.82]) R.box(x + 0.85, y + 1.6, z + sz * k, 0.05, 0.55, 0.05, 0.05, C.steel);
        for (let i = -2; i <= 2; i++) R.box(x + 0.35, y + 2.28, z + i * 0.39 * k, 0.82 * k, 0.07, 0.2 * k, 0.06, i % 2 ? C.white : p.color, { pitch: -0.28, e });
        R.box(x - 0.45, y + 2.42, z, 0.35 * k, 0.1, 0.9 * k, 0.08, p.color, { e });
      }
      R.box(x, 0.02, z, 1.5, 0.02, 1.35, 0.02, '#17504a', { a: 0.6 });
      this.pick('producer', p.id, p, x, 1.2, z, 1.2, 1.3, 1.05);
      this.label('prod' + p.id, x - 0.2, 3.15 + sp.dy, z, p.name, 'tag' + (on ? ' on' : ''), { color: p.color });
      if (p.showAck && !this.w.sync && p.lastAck && this.w.t - p.lastAck.t < 2.4) this.label('timer', x, 4.05, z, `заказ принят за ${p.lastAck.ms.toFixed(1).replace('.', ',')} с`, 'bubble ok');
    }
    robot(o) {
      // o: id,x,z,color,state('idle'|'sleep'|'off'|'work'|'reb'),prog,y
      const R = this.R, sp = this.spawn('rob' + o.id); if (!sp.k) return;
      const k = sp.k * 1.12, t = this.time + (o.seed || 0), yaw = this.cam.base - 0.95 + (o.state === 'work' ? 0 : Math.sin(t * 0.7) * 0.08), c = Math.cos(yaw), s = Math.sin(yaw);
      const bob = reduce ? 0 : o.state === 'work' ? Math.abs(Math.sin(t * 9)) * 0.07 : o.state === 'sleep' ? Math.sin(t * 1.6) * 0.02 : 0;
      const Y = (o.y || 0.2) + sp.dy, e = this.hot('consumer', o.id);
      const P = (lx, ly, lz, hx, hy, hz, r, col, em, pitch) => R.box(o.x + (lx * c + lz * s) * k, Y + ly * k, o.z + (-lx * s + lz * c) * k, hx * k, hy * k, hz * k, r * k, col, { yaw, pitch: pitch || 0, e: Math.max(em || 0, e) });
      const off = o.state === 'off', sleep = o.state === 'sleep';
      const body = off ? K.mixc(o.color, '#6d7875', 0.85) : sleep ? K.mixc(o.color, '#8a9592', 0.5) : o.color;
      const head = off ? '#8f9996' : C.white;
      const hd = sleep || off ? -0.1 : 0;
      P(-0.21, 0.1, 0.05, 0.16, 0.1, 0.22, 0.1, C.graph); P(0.21, 0.1, 0.05, 0.16, 0.1, 0.22, 0.1, C.graph);
      P(0, 0.55 + bob, 0, 0.46, 0.36, 0.36, 0.16, body);
      P(0, 0.56 + bob, 0.35, 0.3, 0.17, 0.05, 0.05, C.dark);
      if (o.state === 'work' && o.prog > 0) { const q = clamp(o.prog, 0.02, 1) * 0.25; P(-0.25 + q, 0.56 + bob, 0.4, q, 0.07, 0.02, 0.02, C.lime, 0.9); }
      const arm = o.state === 'work' && !reduce ? Math.sin(t * 9) * 0.12 : 0;
      P(-0.56, 0.56 + bob + arm, 0.06, 0.1, 0.22, 0.12, 0.1, body); P(0.56, 0.56 + bob - arm, 0.06, 0.1, 0.22, 0.12, 0.1, body);
      P(0, 1.2 + bob + hd, 0, 0.43, 0.3, 0.34, 0.16, head);
      P(0, 1.2 + bob + hd, 0.33, 0.32, 0.18, 0.04, 0.04, C.dark);
      const ey = off ? 0.018 : sleep ? 0.018 : (Math.sin(t * 0.9) > 0.985 ? 0.02 : 0.08), ec = off ? '#5c6a67' : o.state === 'reb' ? C.amber : '#b8fff0';
      P(-0.13, 1.21 + bob + hd, 0.375, 0.06, ey, 0.02, 0.02, ec, off ? 0 : 1); P(0.13, 1.21 + bob + hd, 0.375, 0.06, ey, 0.02, 0.02, ec, off ? 0 : 1);
      P(0, 1.58 + bob + hd, 0, 0.03, 0.14, 0.03, 0.03, C.steel);
      const st = off ? '#b8433a' : sleep ? '#9aa6a3' : o.state === 'reb' ? C.amber : C.lime;
      P(0, 1.76 + bob + hd, 0, 0.1, 0.1, 0.1, 0.1, st, off ? 0.5 : 0.9);
      this.pick('consumer', o.id, o.data, o.x, Y + 0.95, o.z, 0.7, 0.95, 0.65);
    }
    parcel(x, y, z, h, color, o) { this.R.box(x, y, z, h, h, h, h * 0.2, color, Object.assign({ m: 1 }, o)); }

    /* ---------- кадр ---------- */
    draw(dt) {
      const R = this.R, w = this.w; this.dt = dt; this.time += dt; this.frame = (this.frame || 0) + 1;
      this.slow = (this.slow || 0) * 0.97 + (dt > 0.045 ? 0.03 : 0); if (this.slow > 0.7 && this.frame > 200) R.maxDpr = 1;
      R.resize();
      const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1, asp = W / H;
      this.layout();
      const hz = (this.box[5] - this.box[2]) / 2;
      this.cam.base = this.sm('base', w.sync ? 0.4 : clamp(0.68 - (hz - 2.8) * 0.06, 0.5, 0.68), 3);
      this.cam.fit(this.boxes, asp, { l: this.inset.l / W * 2, r: this.inset.r / W * 2, t: this.inset.t / H * 2, b: this.inset.b / H * 2 });
      this.cam.update(dt);
      const center = [(this.box[0] + this.box[3]) / 2, 0, (this.box[2] + this.box[5]) / 2];
      this.picks.length = 0; R.begin();
      if (!R.VP) { R.render(this.cam, center, 24); R.begin(); }

      if (w.sync) this.drawSync();
      else {
        if (w.show.broker) this.drawBroker();
        w.topics.forEach((t, ti) => this.drawTopic(t, ti));
        w.groups.forEach((g, gi) => this.drawGroup(g, gi));
        this.drawFlights();
      }
      w.producers.forEach((p) => this.kiosk(p));
      this.drawConfetti(dt);
      const rad = Math.max(15, Math.hypot(this.box[3] - this.box[0], this.box[5] - this.box[2]) / 2 + 2);
      R.render(this.cam, center, rad);
      this.sweepLabels();
    }
    drawBroker() {
      const R = this.R, sp = this.spawn('broker'), d = this.half, y = sp.dy, e = this.hot('broker', 'b') * 0.6;
      if (!sp.k) return;
      R.box(0, 0.35 + y, 0, BX * sp.k, 0.35, d * sp.k, 0.16, C.graph, { e });
      R.box(0, 0.36 + y, 0, (BX + 0.06) * sp.k, 0.16, (d + 0.04) * sp.k, 0.08, C.graph2, { m: 3, e });
      const busy = this.w.landTimes.length, hotB = this.w.waiting().length > 1;
      for (let i = 0; i < 8; i++) {
        const on = busy ? Math.sin(this.time * (5 + i * 1.7) + i * 2) > 0.1 : i < 2;
        R.box(-LX - 1.2 + i * 0.36, 0.36 + y, d + 0.06, 0.1, 0.07, 0.04, 0.04, on ? (hotB ? '#ff5a45' : C.lime) : '#3f5a3c', { e: on ? 0.95 : 0.1 });
      }
      this.pick('broker', 'b', null, 0, 0.35, 0, BX, 0.35, d);
      if (this.w.show.brokerLabel) this.label('broker', 4.7, 0.36 + y, d + 0.1, hotB ? 'broker не успевает записывать' : 'broker: сервер Kafka', 'plate');
    }
    drawTopic(t, ti) {
      const R = this.R, w = this.w, sp = this.spawn('topic' + t.id, 0.1); if (!sp.k) return;
      const e = this.hot('topic', t.id) * 0.6, k = sp.k, isQ = t.kind === 'queue';
      R.box(0, 0.82 + sp.dy, t._zc, (LX + 1.35) * k, 0.13, t._h * k, 0.1, isQ ? '#aeb9b6' : C.tray, { e });
      this.pick('topic', t.id, t, 0, 0.82, t._zc, LX + 1.35, 0.13, t._h);
      const nm = t.label || `topic: ${t.name}`;
      this.label('topic' + t.id, -3.4, 0.8 + sp.dy, t._zc + t._h + 0.05, nm, 'plate topic');

      t.parts.forEach((p) => {
        const ps = this.spawn('part' + p.id, 0.15); if (!ps.k) return;
        const z = p._z, y = ps.dy, hp = this.hot('partition', p.id);
        R.box(0, 1.0 + y, z, (LX + 0.35) * ps.k, 0.06, 0.6, 0.04, C.lane, { m: 2, mp: p._vb, e: hp * 0.5 });
        for (const s of [-1, 1]) R.box(0, 1.05 + y, z + s * 0.63, (LX + 0.4) * ps.k, 0.13, 0.06, 0.05, C.rail, { e: hp });
        R.box(-LX - 0.42, 1.08 + y, z, 0.07, 0.16, 0.66, 0.06, C.rail);
        this.pick('partition', p.id, p, 0, 1.05, z, LX + 0.4, 0.13, 0.69);
        if (!isQ && (t.parts.length > 1 || this.w.show.lagLabels)) this.label('pl' + p.id, -LX - 1.25, 1.05 + y, z + 0.3, 'P' + p.idx, 'pnum');
        if (p.start > 0 && !isQ && p.start > p._vb - 0.5) {
          const sx = -LX + (p.start - p._vb);
          if (sx < LX && sx > -LX - 0.2) { R.box(sx, 1.3, z, 0.05, 0.3, 0.55, 0.05, '#c25b4d'); }
        }
        if (ps.k > 0.9) this.drawMsgs(t, p);
      });
    }
    drawMsgs(t, p) {
      const R = this.R, w = this.w, z = p._z, vb = p._vb, vis = this.findMode;
      const reading = new Map();
      w.groups.forEach((g) => { if (g.topicId === t.id) g.consumers.forEach((c) => { if (c.busy && c.busy.p === p) reading.set(c.busy.off, g.color); }); });
      const from = Math.max(p.start, Math.floor(vb) - 1), to = Math.min(p.end, Math.ceil(vb) + N + 1);
      for (let o = from; o < to; o++) {
        const m = p.msgs[o - p.start]; if (!m) continue;
        const x = this.slotX(p, o), q = smooth(-LX - 0.1, -LX + 0.7, x) * smooth(LX + 0.1, LX - 0.3, x);
        if (q <= 0.02) continue;
        const pop = clamp((w.t - m.tLand) / 0.18, 0, 1), sq = 1 + (1 - pop) * 0.18, rd = reading.has(o), id = p.id + '#' + o;
        const hh = this.hot('msg', id);
        let e = hh + (m.marked ? 0.35 + Math.sin(this.time * 6) * 0.15 : 0) + (rd ? 0.1 : 0);
        let color = m.marked ? '#ffd23e' : m.color;
        if (isFinite(t.retention)) { const left = t.retention - (w.t - m.tLand); if (left < 2.5) color = K.mixc(color, '#7a5147', (1 - left / 2.5) * 0.8); }
        const h = 0.39 * q;
        R.box(x, TOP + h + (rd ? 0.05 : 0), z, h * sq, h, h * sq, h * 0.2, color, { m: 1, e });
        if (q > 0.6) R.digits(o, x, TOP + h * 2 + 0.015 + (rd ? 0.05 : 0), z, 0.235, q);
        this.pick('msg', id, { m, p, off: o }, x, TOP + h, z, h, h, h);
      }
      // место, куда ляжет следующее сообщение
      if (t.kind === 'log') {
        const x = this.slotX(p, p.end); if (x < LX) {
          const a = 0.28 + Math.sin(this.time * 3) * 0.08;
          for (const s of [-1, 1]) { R.box(x, TOP + 0.02, z + s * 0.38, 0.4, 0.02, 0.03, 0.02, '#e8fff6', { a, e: 0.6 }); R.box(x + s * 0.38, TOP + 0.02, z, 0.03, 0.02, 0.4, 0.02, '#e8fff6', { a, e: 0.6 }); }
          if (w.show.endLabels) this.label('end' + p.id, x, TOP + 0.12, z, 'конец: ' + p.end, 'mini end');
        }
      }
      if (t.kind !== 'log') return;
      // закладки групп и лента отставания
      const gs = w.groups.filter((g) => g.topicId === t.id);
      gs.forEach((g, gi) => {
        let off = Math.max(g.offsets[p.idx] || 0, p.start);
        const drag = this.dragFlag && this.dragFlag.g === g && this.dragFlag.p === p;
        if (drag) off = this.dragFlag.off;
        const shown = this.sm('fl' + g.id + p.id, off, 14), raw = -LX + (shown - vb), x = clamp(raw, -LX + 0.02, LX), zz = z + 0.74 + gi * 0.2;
        const fk = this.spawn('flag' + g.id + p.id, 0.25).k; if (!fk) return;
        const lag = w.partLag(g, p), endX = Math.min(LX, -LX + (p.end - vb)), hov = this.hot('flag', g.id + p.id) + (drag ? 0.4 : 0);
        if (lag > 0 && endX > x + 0.05) {
          const sev = smooth(6, 30, lag), col = K.mixc(g.color, '#ff3b2a', sev * 0.75);
          R.box((x + endX) / 2, 1.2, z + 0.71 + gi * 0.07, (endX - x) / 2, 0.035, 0.035, 0.03, col, { e: 0.75 + sev * Math.sin(this.time * 6) * 0.2 });
        }
        const lift = drag ? 0.25 : 0;
        R.box(x, 1.62 + lift, zz, 0.045, 0.62 * fk, 0.045, 0.045, C.white, { e: hov });
        R.box(x + 0.27, 2.05 + lift + (fk - 1), zz, 0.26, 0.17, 0.035, 0.03, g.color, { e: 0.15 + hov });
        R.box(x, 1.02 + lift, zz, 0.14, 0.05, 0.14, 0.05, g.color, { e: hov });
        this.pick('flag', g.id + p.id, { g, p }, x + 0.15, 1.65, zz, 0.45, 0.72, 0.3);
        const hidden = raw < -LX - 0.4 ? Math.round(vb - shown) : 0;
        const key = 'fl' + g.id + p.id;
        if (hidden > 1) this.label(key, x - 0.1, 2.5, zz, t.parts.length > 1 ? `◀ ${hidden}` : `отстал: ещё ${hidden} слева`, 'mini warn');
        else if (drag) this.label(key, x + 0.2, 2.7, zz, 'поставить на ' + off, 'mini strong');
        else if (w.show.flagLabels && gs.length === 1 && t.parts.length <= 2) this.label(key, x + 0.2, 2.5, zz, off >= p.end ? 'прочитано всё' : 'следующее: ' + off, 'mini left');
        if (w.show.lagLabels && gi === 0) this.label('lag' + p.id, LX + 1.15, 1.5, z, 'lag ' + lag, 'mini lag' + (lag > 15 ? ' bad' : lag > 5 ? ' mid' : ''));
      });
    }
    drawGroup(g, gi) {
      const R = this.R, w = this.w, t = w.topic(g.topicId), sp = this.spawn('grp' + g.id);
      if (!sp.k || !t) return;
      R.box(g._xc, 0.1 + sp.dy, g._zc, g._hx * sp.k, 0.1, g._hz * sp.k, 0.1, K.mixc(g.color, '#1d4a45', 0.55), { e: this.hot('group', g.id) * 0.5 });
      this.pick('group', g.id, g, g._xc, 0.1, g._zc, g._hx, 0.1, g._hz);
      const lag = w.lag(g);
      this.label('grp' + g.id, g._xc + g._hx + 0.15, 0.1, g._zc + g._hz - 0.25, (g.label || `группа «${g.name}»`) + (w.show.lagLabels ? ` · lag ${lag}` : ''), 'plate grp left', { color: g.color });
      const G = w.groups.length;
      g.consumers.forEach((c) => {
        const idle = c.on && !c.assigned.length && !g.rebUntil;
        const state = !c.on ? 'off' : g.rebUntil ? 'reb' : idle ? 'sleep' : c.busy ? 'work' : 'idle';
        const prog = c.busy ? (w.t - c.busy.t0) / (c.busy.t1 - c.busy.t0) : 0;
        if (c.on && !g.rebUntil) c.assigned.forEach((pi) => {
          const p = t.parts[pi]; if (!p) return;
          const a = [LX + 0.45, 1.12, p._z + (gi - (G - 1) / 2) * 0.24], b = [c._x - 0.55, 0.75, c._z];
          this.cable(a, b, g.color, c.busy && c.busy.p === p ? 0.55 : 0.05);
        });
        this.robot({ id: c.id, x: c._x, z: c._z, color: g.color, state, prog, seed: c.num * 1.7, data: c });
        const ps = c.assigned.map((i) => 'P' + i).join(', ');
        const two = g._cols > 1;
        const st = state === 'off' ? (g.deadUntil ? 'не отвечает' : 'выключен') : state === 'reb' ? 'ждёт раздачу' : state === 'sleep' ? 'спит' : t.parts.length > 1 ? ps : c.busy ? 'читает' : 'ждёт новых';
        if (two) this.label('rob' + c.id, c._x + 0.1, 2.3, c._z, state === 'sleep' ? `№${c.num} спит` : state === 'off' ? `№${c.num} выкл` : `№${c.num} · ${ps || '…'}`, 'mini rb ' + state);
        else this.label('rob' + c.id, c._x + 0.75, 0.75, c._z, w.show.robotNames ? `consumer ${c.num}: ${st}` : st, 'mini rb left ' + state);
      });
    }
    cable(a, b, color, e) {
      const R = this.R, mx = (a[0] + b[0]) / 2, n = 12; let prev = a;
      const p1 = [a[0] + 1.6, a[1] + 0.35, a[2]], p2 = [mx, 0.35, b[2]];
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const q = [0, 1, 2].map((k) => u * u * u * a[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * b[k]);
        R.seg(prev, q, 0.045, color, { e }); prev = q;
      }
    }
    drawFlights() {
      const R = this.R, w = this.w;
      const wait = w.waiting();
      if (wait.length > 1) this.label('bq', -BX - 0.8, 0.1, 3.2, `очередь на запись: ${wait.length}`, 'mini warn');
      for (const f of w.flights) {
        const p = f.part; if (p._z === undefined) continue;
        let t = clamp((w.t - f.t0) / f.dur, 0, 1), a = [f.pr._x + 1.0, 1.7, f.pr._z]; const x = clamp(this.slotX(p, f.expect), -LX, LX - 0.2); let b = [x, TOP + 0.4, p._z];
        if (f.hold1 !== undefined) {
          const e = w.t - f.t0, qi = wait.indexOf(f), gate = [-BX - 0.55, 1.3, 0];
          if (qi >= 0) { if (qi < 24) this.parcel(-BX - 0.6, 0.36 + (qi % 4) * 0.7, (Math.floor(qi / 4) - 2.5) * 0.8, 0.33, f.marked ? '#ffd23e' : f.color, { e: 0.05 }); continue; }
          if (e < f.hold0) { t = clamp(e / f.hold0, 0, 1); b = gate; } else { t = clamp((e - f.hold1) / (f.dur - f.hold1), 0, 1); a = gate; }
        }
        const top = 4.2 + Math.abs(x - a[0]) * 0.05, u = 1 - t;
        const q = [a[0] * u + b[0] * t, a[1] * u * u + top * 2 * u * t + b[1] * t * t, a[2] * u + b[2] * t];
        const s = 0.24 + 0.15 * ease(t);
        this.parcel(q[0], q[1], q[2], s, f.marked ? '#ffd23e' : f.color, { e: f.marked ? 0.5 : 0.04, yaw: (1 - t) * 1.2 });
        if (f.marked) this.label('mk', q[0], q[1] + 0.8, q[2], 'твой заказ', 'mini strong');
      }
      for (const f of w.fx) {
        const t = clamp((w.t - f.t0) / f.dur, 0, 1), u = 1 - t, p = f.part; if (p._z === undefined) continue;
        if (f.type === 'ack') {
          const a = [clamp(this.slotX(p, f.off), -LX, LX), TOP + 0.9, p._z], b = [f.pr._x + 0.7, 1.9, f.pr._z];
          const q = [a[0] * u + b[0] * t, a[1] * u + b[1] * t + Math.sin(t * Math.PI) * 0.9, a[2] * u + b[2] * t];
          R.box(q[0], q[1], q[2], 0.1, 0.1, 0.1, 0.1, C.lime, { e: 1 });
        } else if (f.type === 'burn') {
          const x = this.slotX(p, f.off); if (x < -LX || x > LX) continue;
          R.box(x, TOP + 0.4 + t * 0.9, p._z, 0.39 * u, 0.39 * u, 0.39 * u, 0.08, K.mixc(f.color, '#5a4640', 0.4 + t * 0.6), { a: u, yaw: t * 2 });
        } else {
          const c = f.c; if (c._x === undefined || !c.group.consumers.includes(c)) continue;
          const x = clamp(this.slotX(p, f.off), -LX, LX - 0.3), a = [x, TOP + 0.5, p._z], b = [c._x - 0.3, 0.9, c._z], et = t * t * (3 - 2 * t), v = 1 - et;
          const top = 3.4, q = [a[0] * v + b[0] * et, a[1] * v * v + top * 2 * v * et + b[1] * et * et, a[2] * v + b[2] * et];
          const full = f.type === 'take', s = full ? 0.39 - 0.12 * et : 0.25;
          R.box(q[0], q[1], q[2], s, s, s, s * 0.2, f.marked ? '#ffd23e' : f.color, full ? { m: 1, e: 0.05 } : { a: 0.86, e: 0.3 });
          if (!full) R.box(q[0], q[1], q[2], s * 1.12, s * 0.14, s * 1.12, s * 0.1, c.group.color, { a: 0.9, e: 0.4 });
        }
      }
      if (w.marked && w.marked.done === null) {
        for (const p of this.lanes) for (let i = Math.max(0, Math.floor(p._vb) - p.start - 1); i < p.msgs.length; i++) if (p.msgs[i].marked && p.msgs[i].id === w.marked.id) {
          const x = this.slotX(p, p.msgs[i].off); if (x > -LX && x < LX + 0.2) this.label('mk', x, 2.6, p._z, 'твой заказ', 'mini strong');
        }
      }
    }
    drawSync() {
      const R = this.R, w = this.w, s = w.sync, pr = w.producers[0], zs = [-3.6, 0, 3.6];
      if (!pr) return;
      const a = [pr._x + 1, 0.3, pr._z];
      s.services.forEach((sv, i) => {
        const b = [6.2, 0.2, zs[i]], id = sv.id + '-1';
        const x = this.sm('rx' + id, b[0]), z = this.sm('rz' + id, b[2]);
        const o = s.order, act = o && o.i === i, end = [x - 1.1, 0.3, z];
        R.seg(a, end, 0.06, act ? '#fff2cf' : '#2f716a', { e: act ? 0.4 : 0 });
        R.box(x, 0.1, z, 1.35, 0.1, 1.2, 0.1, K.mixc(sv.color, '#1d4a45', 0.55));
        const state = !sv.on ? 'off' : act && o.phase === 'work' ? 'work' : 'idle';
        this.robot({ id, x, z, color: sv.color, state, prog: act && o.phase === 'work' ? o.p / 0.9 : 0, seed: i * 2, data: { sync: sv, id, group: { name: sv.name } } });
        this.label('rob' + id, x + 0.1, 2.55, z, sv.name + (sv.on ? '' : ' · не работает'), 'tag' + (sv.on ? '' : ' off'), { color: sv.color });
        if (act) {
          if (o.phase === 'go' || o.phase === 'back') {
            const t = clamp(o.p / 0.6, 0, 1), k = o.phase === 'go' ? t : 1 - t;
            const q = [0, 1, 2].map((j) => a[j] + (end[j] - a[j]) * k);
            if (o.phase === 'go') this.parcel(q[0], 0.85 + Math.sin(k * Math.PI) * 1.2, q[2], 0.32, K.PARCEL, { e: 0.08 });
            else R.box(q[0], 0.7, q[2], 0.16, 0.16, 0.16, 0.16, C.lime, { e: 1 });
          }
          if (o.phase === 'wait') this.label('wait', x - 2.2, 1.5, z, 'нет ответа…', 'mini warn');
        }
      });
      pr.waiting = s.order ? 1 : 0;
      if (s.order) this.label('timer', pr._x, 4.1, pr._z, `клиент ждёт ${(w.t - s.order.start).toFixed(1).replace('.', ',')} с`, 'bubble wait');
      else if (s.last) this.label('timer', pr._x, 4.1, pr._z, s.last.ok ? `заказ принят за ${s.last.time.toFixed(1).replace('.', ',')} с` : 'ошибка: заказ не оформлен', 'bubble ' + (s.last.ok ? 'ok' : 'err'));
    }
    party() {
      if (reduce) return;
      const cols = ['#ffc233', '#4aa8f0', '#f07ab4', '#e2503f', '#a8e05a', '#fbf7ec'];
      for (let i = 0; i < 110; i++) this.confetti.push({ x: (Math.random() - 0.5) * 18, y: 5 + Math.random() * 6, z: (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2, a: Math.random() * 6, s: 4 + Math.random() * 6, c: cols[i % 6], t: 0 });
    }
    drawConfetti(dt) {
      for (const p of this.confetti) {
        p.t += dt; p.vy -= 7 * dt; p.vy = Math.max(p.vy, -3.4); p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.a += p.s * dt;
        if (p.y > 0.05) this.R.box(p.x, p.y, p.z, 0.16, 0.025, 0.1, 0.02, p.c, { yaw: p.a, pitch: p.a * 1.3, e: 0.25 });
      }
      this.confetti = this.confetti.filter((p) => p.y > 0.05 && p.t < 6);
    }

    /* ---------- мышь ---------- */
    hit(ex, ey) {
      const r = this.canvas.getBoundingClientRect(), nx = (ex - r.left) / r.width * 2 - 1, ny = 1 - (ey - r.top) / r.height * 2;
      const { o, d } = this.cam.ray(nx, ny, r.width / r.height);
      let best = null, bt = 1e9;
      for (const p of this.picks) {
        let t0 = 0, t1 = 1e9;
        for (let i = 0; i < 3; i++) {
          const inv = 1 / d[i]; let a = (p.a[i] - o[i]) * inv, b = (p.b[i] - o[i]) * inv; if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        }
        if (t0 <= t1 && t0 < bt) { bt = t0; best = p; }
      }
      return best;
    }
    _planeX(ex, ey, y) {
      const r = this.canvas.getBoundingClientRect(), nx = (ex - r.left) / r.width * 2 - 1, ny = 1 - (ey - r.top) / r.height * 2;
      const { o, d } = this.cam.ray(nx, ny, r.width / r.height), t = (y - o[1]) / d[1];
      return o[0] + d[0] * t;
    }
    _input() {
      const c = this.canvas; let down = null;
      c.addEventListener('pointerdown', (e) => {
        const p = this.hit(e.clientX, e.clientY);
        down = { x: e.clientX, y: e.clientY, p, moved: false, yaw: this.cam.user.yaw, pitch: this.cam.user.pitch };
        if (p && p.type === 'flag') this.dragFlag = { g: p.data.g, p: p.data.p, off: p.data.g.offsets[p.data.p.idx] || 0, from: p.data.g.offsets[p.data.p.idx] || 0, sx: this._planeX(e.clientX, e.clientY, 1.6) };
        try { c.setPointerCapture(e.pointerId); } catch (_) { /* синтетические события */ }
      });
      c.addEventListener('pointermove', (e) => {
        if (down) {
          const dx = e.clientX - down.x, dy = e.clientY - down.y;
          if (Math.hypot(dx, dy) > 5) down.moved = true;
          if (this.dragFlag) {
            const f = this.dragFlag, x = this._planeX(e.clientX, e.clientY, 1.6);
            const startX = clamp(-LX + (f.from - f.p._vb), -LX, LX);
            f.off = clamp(Math.round(startX + (x - f.sx) + LX + f.p._vb), f.p.start, f.p.end);
            c.style.cursor = 'grabbing';
          } else if (down.moved) {
            this.cam.user.yaw = clamp(down.yaw - dx * 0.005, -1.6, 0.7); this.cam.user.pitch = clamp(down.pitch + dy * 0.004, -0.42, 0.7);
            c.style.cursor = 'grabbing';
          }
          return;
        }
        this.hover = this.hit(e.clientX, e.clientY);
        c.style.cursor = this.hover ? (this.hover.type === 'flag' ? 'grab' : 'pointer') : 'default';
        if (this.onHover) this.onHover(this.hover, e.clientX, e.clientY);
      });
      const up = (e) => {
        if (!down) return;
        if (this.dragFlag) {
          const f = this.dragFlag; this.dragFlag = null;
          if (down.moved) { this.w.rewind(f.g.id, f.off, f.p.idx); if (this.onRewind) this.onRewind(f); }
          else if (this.onPick) this.onPick(down.p);
        } else if (!down.moved && down.p && this.onPick) this.onPick(down.p, e.clientX, e.clientY);
        down = null; c.style.cursor = 'default';
      };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { down = null; this.dragFlag = null; });
      c.addEventListener('pointerleave', () => { this.hover = null; if (this.onHover) this.onHover(null); });
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.user.zoom = clamp(this.cam.user.zoom * Math.exp(e.deltaY * 0.0009), 0.55, 1.6); }, { passive: false });
      c.addEventListener('dblclick', (e) => { if (!this.hit(e.clientX, e.clientY)) this.resetCam(); });
    }
  }
  K.Scene = Scene;
})();
