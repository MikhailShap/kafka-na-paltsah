/* Вторая схема: плоская, вид спереди, но с объёмом. Толщина деталей, тени и лёгкий сдвиг за мышкой.
   Интерфейс тот же, что у 3D-сцены, поэтому ступени про режим ничего не знают. */
(function () {
  'use strict';
  const K = (window.K = window.K || {});
  const N = 10, PIT = 52, BOX = 43, LANEW = N * PIT, LANEH = 56, KW = 126, KH = 124, GW = 236;
  const FONT = 'Bahnschrift, "DIN Alternate", "Segoe UI", system-ui, sans-serif';
  const INK = '#14302d', INK2 = '#4b645f', ACC = '#ff7a2e';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const back = (t) => 1 + 2.6 * Math.pow(t - 1, 3) + 1.6 * Math.pow(t - 1, 2);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hexc = new Map();
  function parse(c) { let v = hexc.get(c); if (!v) { const n = parseInt(c.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; hexc.set(c, v); } return v; }
  const toHex = (a) => '#' + a.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mixMemo = new Map();
  function mix(a, b, t) {
    const q = Math.round(t * 20), key = a + b + q; let v = mixMemo.get(key);
    if (!v) { const x = parse(a), y = parse(b), k = q / 20; v = toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * k)); mixMemo.set(key, v); }
    return v;
  }
  const dark = (c, k) => mix(c, '#0b1f1d', k === undefined ? 0.35 : k);

  class Scene2D {
    constructor(canvas, world) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.w = world;
      this.time = 0; this.dt = 0.016; this.s = new Map(); this.seen = new Map(); this.picks = [];
      this.hover = null; this.dragFlag = null; this.confetti = []; this.findMode = false; this.flashType = null;
      this.inset = { t: 90, b: 130, l: 20, r: 20 };
      this.cam = { user: { x: 0, y: 0, zoom: 1 } };
      this.v = { s: 0.8, x: 0, y: 0, ready: false };
      this.mx = 0; this.my = 0; this.tmx = 0; this.tmy = 0;
      this.onPick = null; this.onHover = null; this.onRewind = null;
      this._input();
    }
    clear() { this.seen.clear(); this.s.clear(); this.confetti = []; this.v.ready = false; this.resetCam(); }
    resetCam() { this.cam.user = { x: 0, y: 0, zoom: 1 }; }

    sm(id, v, rate) {
      const c = this.s.get(id);
      if (c === undefined) { this.s.set(id, v); return v; }
      const n = c + (v - c) * (1 - Math.exp(-(rate || 8) * this.dt)); this.s.set(id, n); return n;
    }
    /* Появление детали: падает сверху и чуть пружинит. */
    pop(id, cx, cy, delay, fn) {
      if (!this.seen.has(id)) this.seen.set(id, this.time + (delay || 0));
      const t = this.time - this.seen.get(id); if (t < 0) return false;
      const q = reduce ? 1 : clamp(t / 0.5, 0, 1);
      if (q >= 1) { fn(); return true; }
      const g = this.ctx, k = Math.max(0.01, 0.7 + 0.3 * back(q));
      g.save(); g.globalAlpha *= Math.min(1, q * 2); g.translate(cx, cy - (1 - ease(q)) * 70); g.scale(k, k); g.translate(-cx, -cy); fn(); g.restore();
      return q > 0.6;
    }
    pick(type, id, data, x, y, w, h) { this.picks.push({ type, id, key: type + ':' + id, data, x, y, w, h }); }
    hot(type, id) {
      if (this.flashType === type) return 0.55 + Math.sin(this.time * 14) * 0.45;
      return this.hover && this.hover.key === type + ':' + id ? 1 : 0;
    }

    /* ---------- кисти ---------- */
    rr(x, y, w, h, r) { const g = this.ctx; r = Math.min(r, w / 2, h / 2); g.beginPath(); if (r > 0.1) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
    /* Плитка с толщиной d: лицо в (x, y), снизу видно боковину, под ней тень. */
    solid(x, y, w, h, r, d, face, o) {
      if (w <= 0.5 || h <= 0.5) return; o = o || {};
      const g = this.ctx, hot = o.hot || 0;
      const lift = hot * Math.min(3, d * 0.4); y -= lift;
      const D = d + lift, bx = -this.mx * D * 0.85, by = D * (1 + this.my * 0.3);
      if (o.soft) { g.save(); g.shadowColor = 'rgba(16,48,44,.34)'; g.shadowBlur = o.soft * this.v.s * this.dpr; g.shadowOffsetX = (bx * 1.2) * this.v.s * this.dpr; g.shadowOffsetY = (by * 0.9 + 4) * this.v.s * this.dpr; g.fillStyle = o.side || dark(face); this.rr(x + bx, y + by, w, h, r); g.fill(); g.restore(); }
      else { g.fillStyle = 'rgba(12,40,37,.17)'; this.rr(x + bx * 1.9 + 1, y + by * 1.75 + 1, w, h, r); g.fill(); }
      g.fillStyle = o.side || dark(face);
      const n = o.flat && D < 9 ? 2 : Math.max(1, Math.ceil(D / 2));
      for (let i = n; i >= 1; i--) { this.rr(x + bx * i / n, y + by * i / n, w, h, r); g.fill(); }
      g.fillStyle = face; this.rr(x, y, w, h, r); g.fill();
      if (!o.flat) {
        const gr = g.createLinearGradient(0, y, 0, y + Math.min(h, 60)); gr.addColorStop(0, 'rgba(255,255,255,.34)'); gr.addColorStop(0.35, 'rgba(255,255,255,.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; this.rr(x, y, w, h, r); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + r, y + 0.9); g.lineTo(x + w - r, y + 0.9); g.stroke();
      }
      if (hot > 0) { g.strokeStyle = ACC; g.globalAlpha *= hot; g.lineWidth = 3; this.rr(x - 2, y - 2, w + 4, h + 4, r + 2); g.stroke(); g.globalAlpha /= hot; }
    }
    /* Углубление: тёмная кромка сверху, светлая снизу. */
    groove(x, y, w, h, r, face) {
      const g = this.ctx; g.fillStyle = 'rgba(255,255,255,.5)'; this.rr(x, y + 2, w, h, r); g.fill();
      g.fillStyle = face; this.rr(x, y, w, h, r); g.fill();
      g.save(); this.rr(x, y, w, h, r); g.clip();
      const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, 'rgba(0,0,0,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, 16); g.restore();
    }
    txt(s, x, y, size, color, o) {
      const g = this.ctx; o = o || {};
      g.font = `${o.w || 600} ${size}px ${FONT}`; g.textAlign = o.a || 'left'; g.textBaseline = 'middle'; g.fillStyle = color;
      if (o.max) { const m = g.measureText(s).width; if (m > o.max) g.font = `${o.w || 600} ${Math.max(9, size * o.max / m)}px ${FONT}`; }
      g.fillText(s, x, y + 0.5);
    }
    pill(s, x, y, o) {
      o = o || {}; const g = this.ctx, size = o.size || 16; g.font = `${o.w || 600} ${size}px ${FONT}`;
      const tw = g.measureText(s).width, pad = o.pad || 10, dot = o.dot ? 16 : 0, w = tw + pad * 2 + dot, h = size + 11, X = o.a === 'left' ? x : o.a === 'right' ? x - w : x - w / 2;
      this.solid(X, y - h / 2, w, h, 7, o.d === undefined ? 3 : o.d, o.bg || '#ffffff', { flat: true, side: o.side || dark(o.bg || '#ffffff', 0.22) });
      if (o.dot) { g.fillStyle = o.dot; this.rr(X + pad, y - 5, 10, 10, 3); g.fill(); }
      this.txt(s, X + pad + dot, y, size, o.fg || INK, { w: o.w });
      return w;
    }

    /* ---------- раскладка ---------- */
    layout(W, H) {
      const w = this.w, vert = W / H < 0.7; this.vert = vert;
      const B = []; // коробки, которые надо вписать в экран
      if (w.sync) {
        w.producers.forEach((p) => { p._2x = this.sm('px' + p.id, vert ? 130 : 0); p._2y = this.sm('py' + p.id, vert ? -300 : -KH / 2); B.push([p._2x - 30, p._2y - 74, p._2x + KW + 40, p._2y + KH + 20]); });
        w.sync.services.forEach((sv, i) => { sv._2x = vert ? (i - 1) * 250 + 75 : 560; sv._2y = vert ? 60 : (i - 1) * 138 - 50; B.push([sv._2x, sv._2y, sv._2x + GW, sv._2y + 108]); });
        this.box = this.union(B); return;
      }
      const np = w.topics.reduce((s, t) => s + t.parts.length, 0), pitch = this.sm('pitch', np <= 2 ? 112 : np <= 3 ? 102 : np <= 5 ? 88 : 76);
      this.lagW = this.sm('lagW', w.show.lagLabels ? 88 : 12);
      const trayW = 48 + LANEW + 14 + this.lagW, BW = trayW + 40; this.BW = BW; this.trayW = trayW;
      let y = 20; w.topics.forEach((t, i) => { if (i) y += 20; t._2t = y; y += 44 + t.parts.length * pitch + 6; });
      if (!w.topics.length) y = 150;
      const bh = this.sm('bh', y + 48), top = -bh / 2; this.by = top; this.bh = bh;
      w.topics.forEach((t) => {
        t._2y = this.sm('ty' + t.id, top + t._2t); t._2h = this.sm('th' + t.id, 44 + t.parts.length * pitch + 6);
        t.parts.forEach((p, k) => { p._2y = this.sm('ly' + p.id, top + t._2t + 44 + pitch * (k + 0.5) + 4); p._2v = this.sm('vb' + p.id, Math.max(0, p.end - (N - 2)), 11); });
      });
      if (w.show.broker || w.topics.length) B.push([0, top, BW, top + bh + 14]);

      w.groups.forEach((g) => {
        g._2c = g.consumers.length > 4; g._2ch = g._2c ? 58 : 78;
        const rows = Math.max(1, Math.ceil(g.consumers.length / (g._2c ? 2 : 1)));
        g._2H = 42 + rows * (g._2ch + 10) + 6; g._2h = this.sm('gh' + g.id, g._2H);
      });
      if (!vert) {
        const gap = 22, sum = w.groups.reduce((s, g) => s + g._2H, 0) + gap * Math.max(0, w.groups.length - 1); let gy = -sum / 2;
        w.groups.forEach((g) => { g._2x = this.sm('gx' + g.id, BW + 78); g._2y = this.sm('gy' + g.id, gy); gy += g._2H + gap; });
        const n = w.producers.length; w.producers.forEach((p, i) => { p._2x = this.sm('px' + p.id, -KW - 58 - (isFinite(w.brokerCap) ? 96 : 0)); p._2y = this.sm('py' + p.id, (i - (n - 1) / 2) * 190 - KH / 2 + 10); });
      } else {
        const per = 3, gap = 14; let gx = 0, gy = top + bh + 66, rowH = 0;
        w.groups.forEach((g, i) => { if (i && i % per === 0) { gx = 0; gy += rowH + gap; rowH = 0; } const inRow = Math.min(per, w.groups.length - Math.floor(i / per) * per), st = (BW - inRow * GW - (inRow - 1) * gap) / 2; g._2x = this.sm('gx' + g.id, st + (i % per) * (GW + gap)); g._2y = this.sm('gy' + g.id, gy); rowH = Math.max(rowH, g._2H); gx += GW + gap; });
        const n = w.producers.length; w.producers.forEach((p, i) => { p._2x = this.sm('px' + p.id, BW / 2 - KW / 2 + (i - (n - 1) / 2) * 190); p._2y = this.sm('py' + p.id, top - 70 - KH); });
      }
      w.groups.forEach((g) => {
        B.push([g._2x, g._2y, g._2x + GW, g._2y + g._2H + 10]);
        const cols = g._2c ? 2 : 1, ch = g._2ch, cw = g._2c ? (GW - 30) / 2 : GW - 20;
        g.consumers.forEach((c, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          c._2x = this.sm('cx' + c.id, g._2x + 10 + col * (cw + 10)); c._2y = this.sm('cy' + c.id, g._2y + 40 + row * (ch + 10)); c._2w = cw; c._2hh = ch;
        });
      });
      w.producers.forEach((p) => B.push([p._2x - 8, p._2y - (p.showAck ? 76 : 40), p._2x + KW + 8, p._2y + KH + 14]));
      if (!B.length) B.push([0, -150, 700, 150]);
      this.box = this.union(B);
    }
    union(B) { return [Math.min(...B.map((b) => b[0])), Math.min(...B.map((b) => b[1])), Math.max(...B.map((b) => b[2])), Math.max(...B.map((b) => b[3]))]; }
    laneX() { return 20 + 48; }
    slotX(p, off) { return this.laneX() + (off - p._2v + 0.5) * PIT; }
    out(p) { return this.vert ? [p._2x + KW / 2, p._2y + KH] : [p._2x + KW, p._2y + 76]; }
    face(c) { const s = c._2hh - 14; return [c._2x + 8 + s / 2, c._2y + 8 + s / 2]; }

    /* ---------- кадр ---------- */
    draw(dt) {
      const g = this.ctx, c = this.canvas; this.dt = dt; this.time += dt;
      this.slow = (this.slow || 0) * 0.97 + (dt > 0.045 ? 0.03 : 0); this.frame = (this.frame || 0) + 1; if (this.slow > 0.7 && this.frame > 200) this.maxDpr = 1;
      const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2)), W = c.clientWidth || 1, H = c.clientHeight || 1;
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr); if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const k = 1 - Math.exp(-dt * 6); this.mx += (this.tmx - this.mx) * k; this.my += (this.tmy - this.my) * k;

      this.layout(W, H);
      const b = this.box, i = this.inset, side = 26, aw = Math.max(60, W - side * 2), ah = Math.max(60, H - i.t - i.b), u = this.cam.user;
      const fit = Math.min(aw / (b[2] - b[0]), ah / (b[3] - b[1]), 1.35), s = fit * u.zoom;
      const gx = side + aw / 2 - (b[0] + b[2]) / 2 * s + u.x, gy = i.t + ah / 2 - (b[1] + b[3]) / 2 * s + u.y, v = this.v;
      const q = v.ready ? 1 - Math.exp(-dt * 7) : 1; v.ready = true; v.s += (s - v.s) * q; v.x += (gx - v.x) * q; v.y += (gy - v.y) * q;

      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1; this.ground(W, H);
      g.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
      this.picks.length = 0;
      const w = this.w;
      if (w.sync) this.drawSync();
      else {
        if (w.show.broker) this.drawBroker();
        w.topics.forEach((t) => this.drawTopic(t));
        w.groups.forEach((gr, n) => this.drawCables(gr, n));
        w.groups.forEach((gr) => this.drawGroup(gr));
      }
      w.producers.forEach((p) => this.kiosk(p));
      if (!w.sync) this.drawFlights();
      g.setTransform(dpr, 0, 0, dpr, 0, 0); this.drawConfetti(dt, W, H);
    }
    ground(W, H) {
      const g = this.ctx;
      if (!this.pat) { const p = document.createElement('canvas'); p.width = p.height = 30; const x = p.getContext('2d'); x.fillStyle = '#d9e7df'; x.fillRect(0, 0, 30, 30); x.fillStyle = '#bfd3c8'; x.beginPath(); x.arc(15, 15, 1.5, 0, 7); x.fill(); this.pat = g.createPattern(p, 'repeat'); }
      g.save(); const px = this.v.x * 0.25 - this.mx * 5, py = this.v.y * 0.25 - this.my * 5; g.translate(px % 30, py % 30); g.fillStyle = this.pat; g.fillRect(-60, -60, W + 120, H + 120); g.restore();
      const gr = g.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.75); gr.addColorStop(0, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(80,130,115,.2)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }

    /* ---------- producer ---------- */
    kiosk(p) {
      const g = this.ctx, w = this.w, x = p._2x, y = p._2y, hot = this.hot('producer', p.id);
      const pulse = clamp(1 - (w.t - p.pulse) / 0.25, 0, 1);
      this.pop('prod' + p.id, x + KW / 2, y + KH / 2, 0, () => {
        g.save(); g.translate(x + KW / 2, y + KH); g.scale(1 + pulse * 0.04, 1 - pulse * 0.05); g.translate(-x - KW / 2, -y - KH);
        if (p.kind === 'jmeter') {
          this.solid(x + 14, y + 86, 98, 26, 9, 7, '#8a3429', { hot, soft: 12 });
          for (const wx of [36, 90]) { this.solid(x + wx - 15, y + 96, 30, 30, 15, 4, '#2c3336'); g.fillStyle = '#c9d3d1'; g.beginPath(); g.arc(x + wx, y + 111, 5, 0, 7); g.fill(); }
          g.save(); g.translate(x + 56, y + 76); g.rotate(this.vert ? 0.75 : -0.5); const rec = -pulse * 9;
          this.solid(rec - 46, -22, 106, 42, 20, 6, '#fbf7ec', { hot });
          for (const q of [-28, 0, 28]) { g.fillStyle = '#e2503f'; g.fillRect(rec + q - 7, -22, 14, 42); }
          this.solid(rec + 52, -26, 16, 50, 7, 5, '#3a4347'); g.restore();
        } else {
          this.solid(x + 10, y + 48, 106, 70, 10, 9, '#f5ebd3', { hot, soft: 14, side: '#c5b489' });
          this.groove(x + 22, y + 54, 82, 36, 7, '#2d3a3d');
          g.fillStyle = p.waiting ? '#ff9b7a' : '#8fe0d0'; this.rr(x + 27, y + 59, 72, 27, 4); g.fill();
          g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x + 30, y + 83); g.lineTo(x + 52, y + 60); g.lineTo(x + 66, y + 60); g.lineTo(x + 44, y + 83); g.fill();
          this.solid(x + 1, y + 92, 124, 13, 6, 6, '#bb8146', { side: '#85562a' });
          g.fillStyle = 'rgba(12,40,37,.2)'; g.fillRect(x + 10, y + 50, 106, 9);
          for (let i = 0; i < 5; i++) { const ax = x - 1 + i * 25.6, col = i % 2 ? '#fffaf0' : p.color; g.fillStyle = dark(col, 0.25); g.beginPath(); g.roundRect(ax, y + 22, 25.8, 34, [0, 0, 12, 12]); g.fill(); g.fillStyle = col; g.beginPath(); g.roundRect(ax, y + 18, 25.8, 34, [0, 0, 12, 12]); g.fill(); }
          this.solid(x - 2, y + 8, 130, 15, 7, 4, p.color);
        }
        g.restore();
        this.pill(p.name, x + KW / 2, y - 14, { size: 18, bg: '#ffffff' });
        this.pick('producer', p.id, p, x - 4, y, KW + 8, KH);
      });
      if (p.showAck && !w.sync && p.lastAck && w.t - p.lastAck.t < 2.4) this.bubble(x + KW / 2, y - 52, `заказ принят за ${p.lastAck.ms.toFixed(1).replace('.', ',')} с`, '#cdeebb');
    }
    bubble(x, y, s, bg) { this.pill(s, x, y, { size: 19, bg, d: 4, pad: 13 }); const g = this.ctx; g.fillStyle = bg; g.beginPath(); g.moveTo(x - 8, y + 14); g.lineTo(x + 8, y + 14); g.lineTo(x, y + 24); g.fill(); }

    /* ---------- робот-читатель ---------- */
    robot(cx, cy, k, color, state, seed) {
      const g = this.ctx, t = this.time + seed, off = state === 'off', sl = state === 'sleep', work = state === 'work';
      const bob = reduce ? 0 : work ? Math.abs(Math.sin(t * 9)) * 3 * k : sl ? Math.sin(t * 1.6) * 0.8 * k : 0, hd = off || sl ? 3 * k : 0;
      const body = off ? '#8d9894' : sl ? mix(color, '#9aa6a2', 0.6) : color, head = off ? '#c5ccc9' : '#fffaf0', arm = work && !reduce ? Math.sin(t * 9) * 3 * k : 0;
      this.solid(cx - 25 * k, cy + 7 * k + arm, 9 * k, 16 * k, 5 * k, 2 * k, body, { flat: true }); this.solid(cx + 16 * k, cy + 7 * k - arm, 9 * k, 16 * k, 5 * k, 2 * k, body, { flat: true });
      this.solid(cx - 18 * k, cy + 2 * k, 36 * k, 24 * k, 8 * k, 3 * k, body);
      const hy = cy - 27 * k - bob + hd;
      g.strokeStyle = '#8fa09b'; g.lineWidth = 2.6 * k; g.beginPath(); g.moveTo(cx, hy + 2 * k); g.lineTo(cx, hy - 5 * k); g.stroke();
      g.fillStyle = off ? '#c0453a' : sl ? '#9aa6a3' : state === 'reb' ? '#ffb52e' : '#7cc52f'; g.beginPath(); g.arc(cx, hy - 7 * k, 4 * k, 0, 7); g.fill();
      this.solid(cx - 21 * k, hy, 42 * k, 30 * k, 11 * k, 3.5 * k, head, { side: '#c9c1ab' });
      g.fillStyle = '#20302f'; this.rr(cx - 15.5 * k, hy + 6 * k, 31 * k, 18 * k, 7 * k); g.fill();
      const blink = Math.sin(t * 0.9) > 0.985, eh = off || sl ? 2.2 * k : blink ? 2 * k : 8 * k; g.fillStyle = off ? '#75847f' : state === 'reb' ? '#ffcf6b' : '#a9fbe9';
      for (const s of [-1, 1]) { this.rr(cx + s * 7 * k - 3 * k, hy + 15 * k - eh / 2, 6 * k, eh, 3 * k); g.fill(); }
      if (sl && !reduce) { const z = (t * 0.6) % 1; g.globalAlpha *= 1 - z; this.txt('z', cx + 18 * k + z * 8, hy - 2 * k - z * 14, 15 * k, INK2, { w: 700 }); g.globalAlpha /= 1 - z || 1; }
    }
    card(o) {
      const g = this.ctx, { x, y, w, h } = o, bg = o.state === 'off' ? '#f6d8d1' : o.state === 'sleep' ? '#e1e7e3' : o.state === 'reb' ? '#fff0cc' : '#ffffff';
      this.solid(x, y, w, h, 12, 6, bg, { hot: o.hot, side: dark(bg, 0.28) });
      const s = h - 14; this.groove(x + 7, y + 7, s, s, 9, mix(o.color, '#ffffff', o.state === 'off' ? 0.75 : 0.45));
      this.robot(x + 7 + s / 2, y + 7 + s / 2 + s * 0.06, s / 66, o.color, o.state, o.seed);
      const tx = x + s + 18, tw = w - s - 26;
      if (o.compact) { this.txt(o.name, tx, y + h / 2 - 9, 17, INK, { w: 700, max: tw }); this.txt(o.status, tx, y + h / 2 + 10, 15, INK2, { w: 500, max: tw }); }
      else {
        this.txt(o.name, tx, y + 22, 18, INK, { w: 700, max: tw }); this.txt(o.status, tx, y + 43, 16, INK2, { w: 500, max: tw });
        g.fillStyle = '#dfe7e1'; this.rr(tx, y + h - 17, tw, 7, 4); g.fill();
        if (o.prog > 0) { g.fillStyle = '#6fae2c'; this.rr(tx, y + h - 17, Math.max(7, tw * clamp(o.prog, 0, 1)), 7, 4); g.fill(); }
      }
    }

    /* ---------- брокер и дорожки ---------- */
    drawBroker() {
      const g = this.ctx, x = 0, y = this.by, w = this.BW, h = this.bh;
      this.pop('broker', w / 2, y + h / 2, 0, () => {
        this.solid(x, y, w, h, 20, 14, '#3b474b', { hot: this.hot('broker', 'b'), soft: 34, side: '#1f282b' });
        this.pick('broker', 'b', null, x, y, w, h);
        const busy = this.w.landTimes.length, ly = y + h - 24, hotB = this.w.waiting().length > 1;
        for (let i = 0; i < 8; i++) { const on = busy ? Math.sin(this.time * (5 + i * 1.7) + i * 2) > 0.1 : i < 2; g.fillStyle = on ? (hotB ? '#ff5a45' : '#a8e05a') : '#56635f'; g.beginPath(); g.arc(x + 30 + i * 17, ly, 4.5, 0, 7); g.fill(); }
        if (this.w.show.brokerLabel) this.txt(hotB ? 'broker не успевает записывать' : 'broker: сервер Kafka', x + w - 24, ly, 18, hotB ? '#ffb3a6' : '#eef5ef', { a: 'right' });
      });
    }
    drawTopic(t) {
      const x = 20, y = t._2y, w = this.trayW, h = t._2h, isQ = t.kind === 'queue';
      this.pop('topic' + t.id, x + w / 2, y + h / 2, 0.1, () => {
        this.solid(x, y, w, h, 13, 8, isQ ? '#cfd8d4' : '#f0e5c7', { hot: this.hot('topic', t.id), side: isQ ? '#97a5a0' : '#bda979' });
        this.pick('topic', t.id, t, x, y, w, h);
        this.txt(t.label || `topic: ${t.name}`, x + 18, y + 22, 18, '#4a3d1c', { w: 700 });
      });
      t.parts.forEach((p) => {
        const lx = this.laneX(), cy = p._2y;
        const ok = this.pop('part' + p.id, lx + LANEW / 2, cy, 0.18, () => {
          this.groove(lx - 6, cy - LANEH / 2, LANEW + 12, LANEH, 9, '#51626a');
          const g = this.ctx; g.save(); this.rr(lx - 6, cy - LANEH / 2, LANEW + 12, LANEH, 9); g.clip(); g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 2; g.beginPath();
          const f = p._2v % 1; for (let i = 0; i <= N + 1; i++) { const sx = lx + (i - f) * PIT; g.moveTo(sx, cy - LANEH / 2 + 8); g.lineTo(sx, cy + LANEH / 2 - 8); } g.stroke(); g.restore();
          const hp = this.hot('partition', p.id); if (hp) { g.strokeStyle = ACC; g.globalAlpha *= hp; g.lineWidth = 3; this.rr(lx - 8, cy - LANEH / 2 - 2, LANEW + 16, LANEH + 4, 11); g.stroke(); g.globalAlpha /= hp; }
          this.pick('partition', p.id, p, lx - 6, cy - LANEH / 2, LANEW + 12, LANEH);
          if (!isQ && (t.parts.length > 1 || this.w.show.lagLabels)) this.txt('P' + p.idx, lx - 28, cy, 21, '#4a3d1c', { a: 'center', w: 700 });
        });
        if (ok) this.drawMsgs(t, p);
      });
    }
    parcel(x, y, size, color, o) {
      o = o || {}; const g = this.ctx, d = o.d === undefined ? size * 0.16 : o.d, l = x - size / 2, tp = y - size / 2 - d * 0.5;
      this.solid(l, tp, size, size, size * 0.17, d, color, { flat: true, hot: o.hot });
      const lift = (o.hot || 0) * Math.min(3, d * 0.4), T = tp - lift;
      g.fillStyle = 'rgba(255,243,205,.5)'; g.fillRect(l + size * 0.41, T, size * 0.18, size);
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(l + size * 0.17, T + 1); g.lineTo(l + size * 0.83, T + 1); g.stroke();
      if (o.num !== undefined) { g.fillStyle = '#fbf6e6'; this.rr(l + size * 0.13, T + size * 0.2, size * 0.74, size * 0.58, 5); g.fill(); this.txt(String(o.num), x, T + size * 0.5, size * (o.num > 999 ? 0.3 : o.num > 99 ? 0.38 : 0.46), '#1c2f2c', { a: 'center', w: 700 }); }
    }
    drawMsgs(t, p) {
      const g = this.ctx, w = this.w, cy = p._2y, vb = p._2v, lx = this.laneX(), rx = lx + LANEW;
      const reading = new Set();
      w.groups.forEach((gr) => { if (gr.topicId === t.id) gr.consumers.forEach((c) => { if (c.busy && c.busy.p === p) reading.add(c.busy.off); }); });
      // ленты отставания лежат на дне дорожки
      const gs = w.groups.filter((gr) => gr.topicId === t.id), log = t.kind === 'log';
      const pos = gs.map((gr) => {
        const drag = this.dragFlag && this.dragFlag.g === gr && this.dragFlag.p === p;
        const off = drag ? this.dragFlag.off : Math.max(gr.offsets[p.idx] || 0, p.start), shown = this.sm('fl' + gr.id + p.id, off, 14);
        return { gr, off, shown, drag, raw: lx + (shown - vb) * PIT, x: clamp(lx + (shown - vb) * PIT, lx - 3, rx) };
      });
      if (log) pos.forEach((q, gi) => {
        const lag = w.partLag(q.gr, p), ex = Math.min(rx, lx + (p.end - vb) * PIT);
        if (lag > 0 && ex > q.x + 2) { const sev = smooth(6, 30, lag); g.fillStyle = mix(q.gr.color, '#ff3b2a', sev * 0.8); g.globalAlpha *= 0.85 + Math.sin(this.time * 6) * 0.15 * sev; this.rr(q.x, cy + LANEH / 2 - 6 + gi * 8, ex - q.x, 6, 3); g.fill(); g.globalAlpha = 1; }
      });
      if (log) { // место, куда ляжет следующее
        const x = this.slotX(p, p.end); if (x < rx) { g.strokeStyle = `rgba(232,255,246,${0.5 + Math.sin(this.time * 3) * 0.15})`; g.lineWidth = 2; g.setLineDash([6, 5]); this.rr(x - BOX / 2, cy - BOX / 2, BOX, BOX, 8); g.stroke(); g.setLineDash([]); if (w.show.endLabels) { this.txt('конец', x, cy - 9, 12.5, '#e8fff6', { a: 'center', w: 600 }); this.txt(String(p.end), x, cy + 8, 19, '#e8fff6', { a: 'center', w: 700 }); } }
        if (p.start > 0 && p.start > vb - 0.4) { const sx = lx + (p.start - vb) * PIT; if (sx < rx) { g.fillStyle = '#c25b4d'; this.rr(sx - 3, cy - LANEH / 2 + 3, 6, LANEH - 6, 3); g.fill(); } }
      }
      const from = Math.max(p.start, Math.floor(vb) - 1), to = Math.min(p.end, Math.ceil(vb) + N + 1);
      for (let o = from; o < to; o++) {
        const m = p.msgs[o - p.start]; if (!m) continue;
        const x = this.slotX(p, o), q = smooth(lx - 2, lx + 26, x) * smooth(rx + 2, rx - 20, x); if (q <= 0.03) continue;
        const id = p.id + '#' + o, landing = clamp((w.t - m.tLand) / 0.16, 0, 1), rd = reading.has(o);
        let color = m.marked ? '#ffd23e' : m.color;
        if (isFinite(t.retention)) { const left = t.retention - (w.t - m.tLand); if (left < 2.5) color = mix(color, '#7a5147', (1 - left / 2.5) * 0.8); }
        if (m.marked) { g.save(); g.shadowColor = '#ffd23e'; g.shadowBlur = 24 * this.v.s * this.dpr; g.fillStyle = '#ffd23e'; this.rr(x - BOX / 2, cy - BOX / 2, BOX, BOX, 8); g.fill(); g.restore(); }
        g.globalAlpha = q; this.parcel(x, cy - (rd ? 4 : 0), BOX * (0.75 + 0.25 * q) * (1 + (1 - landing) * 0.16), color, { num: o, hot: this.hot('msg', id) }); g.globalAlpha = 1;
        this.pick('msg', id, { m, p, off: o }, x - BOX / 2, cy - BOX / 2, BOX, BOX);
        if (m.marked && w.marked && w.marked.id === m.id && w.marked.done === null) this.pill('твой заказ', x, cy - 46, { bg: '#ffd23e', size: 17, w: 700 });
      }
      if (!log) return;
      pos.forEach((q, gi) => {
        const { gr, x, off, drag, raw, shown } = q, hov = this.hot('flag', gr.id + p.id), lift = drag ? 6 : 0, X = x + gi * 3, tp = cy - LANEH / 2 - 15 + gi * 9 - lift, bt = cy + LANEH / 2 + 2 - lift;
        g.fillStyle = 'rgba(12,40,37,.35)'; this.rr(X + 1, tp + 3, 5, bt - tp, 2.5); g.fill();
        g.fillStyle = '#fffaf0'; this.rr(X - 2.5, tp, 5, bt - tp, 2.5); g.fill();
        const wv = reduce ? 0 : Math.sin(this.time * 4 + gi) * 1.5, pen = (dx, dy, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(X + 2 + dx, tp + dy); g.lineTo(X + 30 + dx, tp + 8 + wv + dy); g.lineTo(X + 2 + dx, tp + 17 + dy); g.closePath(); g.fill(); };
        pen(1 - this.mx * 2, 4, dark(gr.color, 0.4)); pen(0, 0, gr.color);
        if (hov || drag) { g.strokeStyle = ACC; g.lineWidth = 2.5; g.beginPath(); g.moveTo(X + 2, tp); g.lineTo(X + 30, tp + 8 + wv); g.lineTo(X + 2, tp + 17); g.closePath(); g.stroke(); }
        this.pick('flag', gr.id + p.id, { g: gr, p }, X - 9, tp - 4, 42, 24); this.pick('flag', gr.id + p.id, { g: gr, p }, X - 7, tp, 14, bt - tp);
        const hidden = raw < lx - 12 ? Math.round(vb - shown) : 0;
        if (drag) this.pill('поставить на ' + off, X + 40, tp + 8, { a: 'left', bg: '#ffd23e', size: 16, w: 700, d: 2 });
        else if (hidden > 1 && (gs.length === 1 || t.parts.length <= 2)) this.pill(t.parts.length > 1 ? `◀ ${hidden}` : `отстал: ещё ${hidden} слева`, X + 36, tp + 8, { a: 'left', bg: '#ffd9a8', fg: '#5c2b00', size: 15, d: 2 });
        else if (w.show.flagLabels && gs.length === 1 && t.parts.length <= 2) this.txt(off >= p.end ? 'прочитано всё' : 'следующее: ' + off, X + 37, tp + 8, 16, '#4a3d1c', { w: 600 });
        if (w.show.lagLabels && gi === 0) { const lag = w.partLag(gr, p); this.pill('lag ' + lag, rx + 16, cy, { a: 'left', size: 17, d: 3, bg: lag > 15 ? '#ff8573' : lag > 5 ? '#ffdf9c' : '#ffffff', fg: lag > 15 ? '#2b0400' : INK }); }
      });
    }

    /* ---------- группы ---------- */
    drawCables(gr, gi) {
      const g = this.ctx, w = this.w, t = w.topic(gr.topicId); if (!t || gr.rebUntil || !this.seen.has('grp' + gr.id)) return;
      const G = w.groups.length, x0 = 20 + this.trayW + 4;
      gr.consumers.forEach((c) => {
        if (!c.on) return;
        c.assigned.forEach((pi) => {
          const p = t.parts[pi]; if (!p || p._2y === undefined) return;
          const a = [x0, p._2y + (gi - (G - 1) / 2) * 9], busy = c.busy && c.busy.p === p;
          const b = this.vert ? [c._2x + c._2w / 2, c._2y] : [c._2x, c._2y + c._2hh / 2];
          const path = (dy) => { g.beginPath(); g.moveTo(a[0], a[1] + dy); if (this.vert) g.bezierCurveTo(a[0] + 60, a[1] + dy, b[0], b[1] - 120 + dy, b[0], b[1] + dy); else g.bezierCurveTo(a[0] + 58, a[1] + dy, b[0] - 52, b[1] + dy, b[0], b[1] + dy); };
          g.lineCap = 'round';
          g.strokeStyle = 'rgba(12,40,37,.16)'; g.lineWidth = 7; path(7); g.stroke();
          g.strokeStyle = dark(gr.color, 0.4); g.lineWidth = 6; path(2); g.stroke();
          g.strokeStyle = gr.color; g.lineWidth = 5; path(0); g.stroke();
          if (busy && !reduce) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.4; g.setLineDash([5, 13]); g.lineDashOffset = -this.time * 70; path(0); g.stroke(); g.setLineDash([]); }
        });
      });
    }
    drawGroup(gr) {
      const w = this.w, t = w.topic(gr.topicId); if (!t) return;
      const x = gr._2x, y = gr._2y, h = gr._2h;
      this.pop('grp' + gr.id, x + GW / 2, y + h / 2, 0.1, () => {
        this.solid(x, y, GW, h, 17, 10, mix(gr.color, '#ffffff', 0.5), { hot: this.hot('group', gr.id), soft: 20, side: dark(mix(gr.color, '#ffffff', 0.3), 0.3) });
        this.pick('group', gr.id, gr, x, y, GW, h);
        const lag = w.lag(gr), lw = w.show.lagLabels ? this.measure('lag ' + lag, 15) + 26 : 0;
        this.txt(gr.label || `группа «${gr.name}»`, x + 14, y + 21, 18, INK, { w: 700, max: GW - 24 - lw });
        if (w.show.lagLabels) this.pill('lag ' + lag, x + GW - 10, y + 21, { a: 'right', size: 15, d: 2, bg: lag > 30 ? '#ff8573' : lag > 8 ? '#ffdf9c' : '#ffffff' });
      });
      gr.consumers.forEach((c) => {
        const idle = c.on && !c.assigned.length && !gr.rebUntil, state = !c.on ? 'off' : gr.rebUntil ? 'reb' : idle ? 'sleep' : c.busy ? 'work' : 'idle';
        const n = c.assigned.length, ps = n > (gr._2c ? 2 : 3) ? `P${c.assigned[0]}…P${c.assigned[n - 1]}` : c.assigned.map((i) => 'P' + i).join(', '), many = t.parts.length > 1;
        const st = state === 'off' ? (gr.deadUntil ? 'не отвечает' : 'выключен') : state === 'reb' ? 'ждёт раздачу' : state === 'sleep' ? 'спит' : many ? ps : c.busy ? 'читает' : 'ждёт новых';
        this.pop('rob' + c.id, c._2x + c._2w / 2, c._2y + c._2hh / 2, 0.15, () => {
          this.card({ x: c._2x, y: c._2y, w: c._2w, h: c._2hh, color: gr.color, state, seed: c.num * 1.7, hot: this.hot('consumer', c.id), compact: gr._2c, name: gr._2c ? '№' + c.num : w.show.robotNames ? 'consumer ' + c.num : 'робот', status: gr._2c && state === 'off' ? 'выкл' : gr._2c && state === 'reb' ? '…' : st, prog: c.busy ? (w.t - c.busy.t0) / (c.busy.t1 - c.busy.t0) : 0 });
          this.pick('consumer', c.id, c, c._2x, c._2y, c._2w, c._2hh);
        });
      });
    }
    measure(s, size) { this.ctx.font = `600 ${size}px ${FONT}`; return this.ctx.measureText(s).width; }

    /* ---------- что летает ---------- */
    drawFlights() {
      const g = this.ctx, w = this.w, lx = this.laneX(), rx = lx + LANEW;
      const fly = (a, b, t, up, size, color, o) => {
        const e = t * t * (3 - 2 * t), x = a[0] + (b[0] - a[0]) * e, y = a[1] + (b[1] - a[1]) * e, hgt = Math.sin(Math.PI * e) * up;
        g.fillStyle = `rgba(12,40,37,${0.26 - 0.12 * Math.sin(Math.PI * e)})`; g.beginPath(); g.ellipse(x - this.mx * hgt * 0.15, y + size * 0.45, size * 0.5 + hgt * 0.05, size * 0.22 + hgt * 0.02, 0, 0, 7); g.fill();
        this.parcel(x, y - hgt, size * (1 + 0.22 * Math.sin(Math.PI * e)), color, o); return [x, y - hgt];
      };
      for (const f of w.fx) {
        const t = clamp((w.t - f.t0) / f.dur, 0, 1), p = f.part; if (p._2y === undefined) continue;
        if (f.type === 'ack') {
          const a = [clamp(this.slotX(p, f.off), lx, rx), p._2y - 20], b = this.out(f.pr);
          for (let k = 0; k < 4; k++) { const q = clamp(t - k * 0.035, 0, 1), x = a[0] + (b[0] - a[0]) * q, y = a[1] + (b[1] - a[1]) * q - Math.sin(Math.PI * q) * 46; g.fillStyle = `rgba(92,178,32,${0.95 - k * 0.24})`; g.beginPath(); g.arc(x, y, 8 - k * 1.4, 0, 7); g.fill(); }
        } else if (f.type === 'burn') {
          const x = this.slotX(p, f.off); if (x < lx || x > rx) continue;
          g.globalAlpha = 1 - t; this.parcel(x, p._2y - t * 34, BOX * (1 - t * 0.7), mix(f.color, '#5a4640', 0.4 + t * 0.6)); g.globalAlpha = 1;
        } else {
          const c = f.c; if (c._2x === undefined || !c.group.consumers.includes(c)) continue;
          const a = [clamp(this.slotX(p, f.off), lx, rx - 12), p._2y], b = this.face(c), full = f.type === 'take';
          g.globalAlpha = t > 0.85 ? Math.max(0.05, (1 - t) / 0.15) : 1;
          const q = fly(a, b, t, 64, full ? 40 - 12 * t : 27, f.marked ? '#ffd23e' : f.color, { d: 4 });
          if (!full) { g.strokeStyle = c.group.color; g.lineWidth = 4; const s = 34 * (1 + 0.22 * Math.sin(Math.PI * t)); this.rr(q[0] - s / 2, q[1] - s / 2 - 2, s, s, 8); g.stroke(); }
          g.globalAlpha = 1;
        }
      }
      const wait = w.waiting(), gate = this.vert ? [this.BW / 2, this.by - 24] : [-24, this.by + this.bh - 60];
      if (wait.length > 1) this.pill(`очередь на запись: ${wait.length}`, this.vert ? this.BW / 2 + 250 : -82, this.vert ? this.by - 24 : this.by + this.bh - 8, { bg: '#ffd9a8', fg: '#5c2b00', size: 17, w: 700 });
      for (const f of w.flights) {
        const p = f.part; if (p._2y === undefined) continue;
        let t = clamp((w.t - f.t0) / f.dur, 0, 1), a = this.out(f.pr), b = [clamp(this.slotX(p, f.expect), lx, rx - 14), p._2y], up = 96;
        if (f.hold1 !== undefined) {
          const e = w.t - f.t0, qi = wait.indexOf(f);
          if (qi >= 0) { if (qi < 24) this.parcel(this.vert ? this.BW / 2 - 130 + (qi % 8) * 37 : gate[0] - Math.floor(qi / 8) * 37, this.vert ? gate[1] - Math.floor(qi / 8) * 37 : this.by + this.bh - 46 - (qi % 8) * 37, 30, f.marked ? '#ffd23e' : f.color); continue; }
          up = 40; if (e < f.hold0) { t = clamp(e / f.hold0, 0, 1); b = gate; } else { t = clamp((e - f.hold1) / (f.dur - f.hold1), 0, 1); a = gate; }
        }
        const q = fly(a, b, t, up, 28 + 15 * ease(t), f.marked ? '#ffd23e' : f.color);
        if (f.marked) this.pill('твой заказ', q[0], q[1] - 42, { bg: '#ffd23e', size: 17, w: 700 });
      }
    }
    drawSync() {
      const g = this.ctx, w = this.w, s = w.sync, pr = w.producers[0]; if (!pr) return;
      const a = this.out(pr), o = s.order;
      const ends = s.services.map((sv) => (this.vert ? [sv._2x + GW / 2, sv._2y] : [sv._2x, sv._2y + 54]));
      const at = (e, t) => { const u = 1 - t, p1 = this.vert ? [a[0], a[1] + 120] : [a[0] + 190, a[1]], p2 = this.vert ? [e[0], e[1] - 120] : [e[0] - 190, e[1]]; return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * e[k]); };
      ends.forEach((e, i) => {
        const act = o && o.i === i, path = (dy) => { g.beginPath(); const p1 = this.vert ? [a[0], a[1] + 120] : [a[0] + 190, a[1]], p2 = this.vert ? [e[0], e[1] - 120] : [e[0] - 190, e[1]]; g.moveTo(a[0], a[1] + dy); g.bezierCurveTo(p1[0], p1[1] + dy, p2[0], p2[1] + dy, e[0], e[1] + dy); };
        g.lineCap = 'round'; g.strokeStyle = 'rgba(12,40,37,.16)'; g.lineWidth = 8; path(7); g.stroke();
        g.strokeStyle = act ? '#b98a2d' : '#7f9b91'; g.lineWidth = 7; path(2); g.stroke(); g.strokeStyle = act ? '#ffc85c' : '#a6bfb5'; g.lineWidth = 6; path(0); g.stroke();
      });
      s.services.forEach((sv, i) => {
        const x = sv._2x, y = sv._2y, act = o && o.i === i, id = sv.id + '-1', state = !sv.on ? 'off' : act && o.phase === 'work' ? 'work' : 'idle';
        this.pop('rob' + id, x + GW / 2, y + 50, 0.1 + i * 0.08, () => {
          this.solid(x, y, GW, 102, 17, 10, mix(sv.color, '#ffffff', 0.5), { soft: 20, side: dark(mix(sv.color, '#ffffff', 0.3), 0.3) });
          this.card({ x: x + 11, y: y + 11, w: GW - 22, h: 78, color: sv.color, state, seed: i * 2, hot: this.hot('consumer', id), name: sv.name, status: !sv.on ? 'не работает' : state === 'work' ? 'обрабатывает' : 'готов', prog: state === 'work' ? o.p / 0.9 : 0 });
          this.pick('consumer', id, { sync: sv, id, group: { name: sv.name } }, x, y, GW, 102);
        });
        if (!act) return;
        if (o.phase === 'go' || o.phase === 'back') { const t = clamp(o.p / 0.6, 0, 1), q = at(ends[i], o.phase === 'go' ? t : 1 - t); if (o.phase === 'go') this.parcel(q[0], q[1] - 8, 40, K.PARCEL); else { g.fillStyle = '#5cb220'; g.beginPath(); g.arc(q[0], q[1], 11, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(q[0] - 3, q[1] - 3, 3.5, 0, 7); g.fill(); } }
        if (o.phase === 'wait') this.pill('нет ответа…', this.vert ? x + GW / 2 : x - 78, this.vert ? y - 24 : y + 16, { bg: '#ffd9a8', fg: '#5c2b00', size: 17 });
      });
      pr.waiting = o ? 1 : 0;
      const bx = pr._2x + KW / 2, by = pr._2y - 54;
      if (o) this.bubble(bx, by, `клиент ждёт ${(w.t - o.start).toFixed(1).replace('.', ',')} с`, '#ffe1a3');
      else if (s.last) this.bubble(bx, by, s.last.ok ? `принят за ${s.last.time.toFixed(1).replace('.', ',')} с` : 'заказ не оформлен', s.last.ok ? '#cdeebb' : '#ffc2b6');
    }
    party() {
      if (reduce) return;
      const cols = ['#ffc233', '#4aa8f0', '#f07ab4', '#e2503f', '#7cc52f', '#ffffff'], W = this.canvas.clientWidth;
      for (let i = 0; i < 130; i++) this.confetti.push({ x: Math.random() * W, y: -20 - Math.random() * 260, vx: (Math.random() - 0.5) * 60, vy: 90 + Math.random() * 120, a: Math.random() * 6, s: 3 + Math.random() * 6, c: cols[i % 6] });
    }
    drawConfetti(dt, W, H) {
      const g = this.ctx;
      this.confetti.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.s * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.a * 0.6); g.scale(1, Math.cos(p.a)); g.fillStyle = p.c; g.fillRect(-6, -4, 12, 8); g.restore(); });
      this.confetti = this.confetti.filter((p) => p.y < H + 20);
    }

    /* ---------- мышь ---------- */
    toWorld(ex, ey) { const r = this.canvas.getBoundingClientRect(); return [(ex - r.left - this.v.x) / this.v.s, (ey - r.top - this.v.y) / this.v.s]; }
    hit(ex, ey) {
      const [x, y] = this.toWorld(ex, ey);
      for (let i = this.picks.length - 1; i >= 0; i--) { const p = this.picks[i]; if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p; }
      return null;
    }
    _input() {
      const c = this.canvas; let down = null;
      c.addEventListener('pointerdown', (e) => {
        const p = this.hit(e.clientX, e.clientY), u = this.cam.user; down = { x: e.clientX, y: e.clientY, p, moved: false, ux: u.x, uy: u.y };
        if (p && p.type === 'flag') { const o = p.data.g.offsets[p.data.p.idx] || 0; this.dragFlag = { g: p.data.g, p: p.data.p, off: o, from: Math.max(o, p.data.p._2v), sx: this.toWorld(e.clientX, e.clientY)[0] }; }
        try { c.setPointerCapture(e.pointerId); } catch (_) { /* синтетические события */ }
      });
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        if (!reduce) { this.tmx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); this.tmy = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1); }
        if (down) {
          const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 5) down.moved = true;
          if (this.dragFlag) { const f = this.dragFlag; f.off = clamp(Math.round(f.from + (this.toWorld(e.clientX, e.clientY)[0] - f.sx) / PIT), f.p.start, f.p.end); c.style.cursor = 'grabbing'; }
          else if (down.moved) { this.cam.user.x = clamp(down.ux + dx, -r.width, r.width); this.cam.user.y = clamp(down.uy + dy, -r.height, r.height); c.style.cursor = 'grabbing'; }
          return;
        }
        this.hover = this.hit(e.clientX, e.clientY);
        c.style.cursor = this.hover ? (this.hover.type === 'flag' ? 'grab' : 'pointer') : 'default';
        if (this.onHover) this.onHover(this.hover, e.clientX, e.clientY);
      });
      c.addEventListener('pointerup', (e) => {
        if (!down) return;
        if (this.dragFlag) { const f = this.dragFlag; this.dragFlag = null; if (down.moved) { this.w.rewind(f.g.id, f.off, f.p.idx); if (this.onRewind) this.onRewind(f); } else if (this.onPick) this.onPick(down.p); }
        else if (!down.moved && down.p && this.onPick) this.onPick(down.p, e.clientX, e.clientY);
        down = null; c.style.cursor = 'default';
      });
      c.addEventListener('pointercancel', () => { down = null; this.dragFlag = null; });
      c.addEventListener('pointerleave', () => { this.hover = null; this.tmx = this.tmy = 0; if (this.onHover) this.onHover(null); });
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.user.zoom = clamp(this.cam.user.zoom * Math.exp(-e.deltaY * 0.0009), 0.6, 2.2); }, { passive: false });
      c.addEventListener('dblclick', (e) => { if (!this.hit(e.clientX, e.clientY)) this.resetCam(); });
    }
  }
  K.Scene2D = Scene2D;
})();
