/* Кирпичики интерфейса: разметка, график, терминал, кнопки управления, подсказки. */
(function () {
  'use strict';
  const K = (window.K = window.K || {});
  const NS = 'http://www.w3.org/2000/svg';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k]; if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.setAttribute('style', v); else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c)); });
    return el;
  }
  function svg(tag, props, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const k in props || {}) el.setAttribute(k, props[k]);
    kids.flat().forEach((c) => c && el.append(c));
    return el;
  }
  function fmt(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[\[([a-z0-9]+)(?:\|(.+?))?\]\]/g, (_, id, t) => `<span class="term" tabindex="0" data-term="${id}">${t || K.TERMS[id][0]}</span>`);
  }
  const pl = (n, a, b, c) => { const m = Math.abs(n) % 100, d = m % 10; return m > 10 && m < 20 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; };
  const num = (x, d) => x.toFixed(d === undefined ? 1 : d).replace('.', ',');

  // время симулятора в виде часов: 12:00:07,3
  const clock = (t) => { const x = Math.max(0, Math.round(t * 10)), s = Math.floor(x / 10), p = (n) => String(n).padStart(2, '0'); return `${p(12 + Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)},${x % 10}`; };

  /* значок-кубик для списка деталей */
  const ICON = { broker: '#2c3336', topic: '#d9c48f', producer: '#e2503f', consumer: '#ffc233', kafka: '#2c3336', partition: '#5d7076', offset: '#d9a15c', log: '#46555a', end: '#7fcfc0', commit: '#ffc233', retention: '#c25b4d', group: '#ffc233', rebalance: '#ffb52e', lag: '#ff6b57', key: '#4c9fe0', ack: '#8fc84a', e2e: '#b57be0', stamp: '#e0a100', async: '#8fc84a', sync: '#c25b4d', jsr: '#e2503f' };
  function icon(id) {
    const c = ICON[id] || '#8d9a98', n = parseInt(c.slice(1), 16), sh = (k) => '#' + [16, 8, 0].map((s) => Math.round(Math.min(255, ((n >> s) & 255) * k)).toString(16).padStart(2, '0')).join('');
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${sh(1.18)}" d="M12 2 22 7 12 12 2 7z"/><path fill="${sh(.72)}" d="M2 7 12 12 12 22 2 17z"/><path fill="${sh(.92)}" d="M22 7 12 12 12 22 22 17z"/></svg>`;
  }

  /* ---------- график ---------- */
  class Chart {
    constructor(title) {
      this.W = 248; this.H = 84; this.pl = 24; this.pr = 8; this.pt = 8; this.pb = 14; this.span = 60;
      this.lg = h('div', { class: 'lg' });
      this.s = svg('svg', { viewBox: `0 0 ${this.W} ${this.H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': title });
      this.tip = h('div', { class: 'ctip', hidden: true });
      this.el = h('div', { class: 'chart' }, h('header', {}, h('b', {}, title), this.lg), this.s, this.tip);
      this.hx = null;
      this.s.addEventListener('pointermove', (e) => { const r = this.s.getBoundingClientRect(); this.hx = (e.clientX - r.left) / r.width * this.W; this.draw(); });
      this.s.addEventListener('pointerleave', () => { this.hx = null; this.tip.hidden = true; this.draw(); });
    }
    update(hist, series, now) { this.hist = hist; this.series = series; this.now = now; this.draw(); }
    draw() {
      const { W, H, pl: L, pr: R, pt: T, pb: B, span } = this, hist = this.hist || [], S = this.series || [];
      const vis = hist.filter((p) => p.t >= this.now - span);
      let max = 4; vis.forEach((p) => S.forEach((s) => { max = Math.max(max, s.get(p) || 0); }));
      const step = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((x) => x * 2 >= max) || Math.ceil(max / 2), top = step * 2;
      const X = (t) => W - R - (this.now - t) / span * (W - L - R), Y = (v) => H - B - (v / top) * (H - T - B);
      const kids = [];
      [0, step, top].forEach((v) => { kids.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: v ? '#e6e9e4' : '#c3cbc5', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' })); const t = svg('text', { x: L - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }); t.textContent = v; kids.push(t); });
      const a = svg('text', { x: L, y: H - 2 }); a.textContent = 'минуту назад'; const b = svg('text', { x: W - R, y: H - 2, 'text-anchor': 'end' }); b.textContent = 'сейчас'; kids.push(a, b);
      S.forEach((s) => {
        const pts = vis.map((p) => [X(p.t), Y(s.get(p) || 0)]); if (pts.length < 2) return;
        const d = 'M' + pts.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L');
        if (S.length === 1) kids.push(svg('path', { d: d + `L${pts[pts.length - 1][0].toFixed(1)} ${Y(0)}L${pts[0][0].toFixed(1)} ${Y(0)}Z`, fill: s.color, 'fill-opacity': 0.1 }));
        kids.push(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
      });
      S.forEach((s) => { const p = vis[vis.length - 1]; if (p) kids.push(svg('circle', { cx: X(p.t), cy: Y(s.get(p) || 0), r: 4, fill: s.color, stroke: '#fcfcfb', 'stroke-width': 2 })); });
      if (this.hx !== null && vis.length) {
        let best = vis[0]; vis.forEach((p) => { if (Math.abs(X(p.t) - this.hx) < Math.abs(X(best.t) - this.hx)) best = p; });
        const x = X(best.t); kids.push(svg('line', { x1: x, x2: x, y1: T, y2: H - B, stroke: '#66756f', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
        this.tip.replaceChildren(...S.map((s) => h('div', {}, h('i', { style: `background:${s.color}` }), h('b', {}, num(s.get(best) || 0, s.d)), h('span', {}, s.name))));
        this.tip.hidden = false; const px = x / W * this.s.clientWidth + 10; this.tip.style.left = (px > this.s.clientWidth * 0.6 ? px - this.tip.offsetWidth - 8 : px + 12) + 'px';
      }
      this.s.replaceChildren(...kids);
      const last = vis[vis.length - 1];
      const key = S.map((s) => s.name + (last ? num(s.get(last) || 0, s.d) : '')).join();
      if (key !== this._k) { this._k = key; this.lg.replaceChildren(...S.map((s) => h('span', {}, S.length > 1 ? h('i', { style: `background:${s.color}` }) : null, S.length > 1 ? s.name : '', h('b', {}, last ? num(s.get(last) || 0, s.d) : '0')))); }
    }
  }

  /* ---------- «терминал» ---------- */
  function terminal(el, w, gid) {
    const g = w.group(gid) || w.groups[0]; if (!g) { el.textContent = 'нет групп'; return; }
    const t = w.topic(g.topicId), nm = g.id;
    const rows = t.parts.map((p) => {
      const c = g.rebUntil ? null : g.consumers.find((x) => (x.on || g.deadUntil) && x.assigned.includes(p.idx)), cur = Math.max(g.offsets[p.idx] || 0, p.start);
      return `<tr><td>${t.name}</td><td>${p.idx}</td><td>${cur}</td><td>${p.end}</td><td class="lag">${p.end - cur}</td><td>${c ? 'consumer-' + c.num : '-'}</td></tr>`;
    }).join('');
    const warn = !g.consumers.some((c) => c.on) ? `<div class="warn">Consumer group '${nm}' has no active members.</div>` : g.rebUntil ? `<div class="warn">Warning: Consumer group '${nm}' is rebalancing.</div>` : '';
    el.innerHTML = `<div class="cmd">$ <b>kafka-consumer-groups.sh</b> --bootstrap-server kafka:9092 --describe --group ${nm}</div>${warn}<table><tr><th>TOPIC</th><th>PARTITION</th><th>CURRENT-OFFSET</th><th>LOG-END-OFFSET</th><th>LAG</th><th>CONSUMER-ID</th></tr>${rows}</table>`;
  }

  /* ---------- элементы управления ---------- */
  function control(d, w, getV) {
    const upd = []; let el;
    if (d.t === 'btn') {
      el = h('button', { class: 'btn' + (d.primary ? ' go' : ' ghost'), type: 'button', onclick: () => { if (d.send && K.canSend && !K.canSend()) return; d.run(w, getV()); } }, d.label);
      upd.push(() => {
        const fin = d.until && d.until(w, getV());
        el.disabled = !!fin; el.hidden = (d.when && !d.when(w, getV())) || (fin && d.hideDone) || false;
      });
    } else if (d.t === 'svc') {
      el = h('button', { class: 'sw', type: 'button', onclick: () => { const s = w.sync && w.sync.services.find((x) => x.id === d.id); if (s) s.on = !s.on; } }, d.label, h('i'));
      upd.push(() => { const s = w.sync && w.sync.services.find((x) => x.id === d.id); el.classList.toggle('on', !!(s && s.on)); el.setAttribute('aria-pressed', !!(s && s.on)); });
    } else if (d.t === 'power') {
      el = h('button', { class: 'sw', type: 'button', onclick: () => { const g = w.group(d.gid); if (!g) return; const on = g.consumers.some((c) => !c.on); g.consumers.forEach((c) => w.toggleConsumer(c.id, on)); } }, d.label || 'Consumer', h('i'));
      upd.push(() => { const g = w.group(d.gid), on = !!g && g.consumers.every((c) => c.on); el.classList.toggle('on', on); el.setAttribute('aria-pressed', on); });
    } else if (d.t === 'cons' || d.t === 'parts') {
      const isC = d.t === 'cons', cur = () => (isC ? (w.group(d.gid) ? w.group(d.gid).consumers.length : 0) : w.topic() ? w.topic().parts.length : 0);
      const set = (n) => { if (isC) w.setConsumers(d.gid, n); else w.setPartitions(n); };
      const m = h('button', { class: 'st', type: 'button', 'aria-label': 'меньше', onclick: () => set(cur() - 1) }, '−'), o = h('output'), p = h('button', { class: 'st', type: 'button', 'aria-label': 'больше', onclick: () => set(cur() + 1) }, '+');
      if (!isC) m.title = 'Партиции можно только добавлять. Уменьшить их число в Kafka нельзя.';
      el = h('div', { class: 'ctl' }, h('span', { class: 'nm' }, d.label || (isC ? 'Consumer' : 'Партиции')), m, o, p);
      upd.push(() => { const n = cur(); o.textContent = n; m.disabled = isC ? n <= d.min : true; p.disabled = n >= d.max; });
    } else if (d.t === 'rate') {
      const i = h('input', { type: 'range', min: 0, max: d.max, step: d.step, 'aria-label': 'Скорость записи', oninput: () => { w.producers.forEach((p) => { p.rate = +i.value / w.producers.length; }); } }), o = h('output');
      el = h('div', { class: 'ctl' }, h('span', { class: 'nm' }, 'Запись'), i, o);
      upd.push(() => { const r = w.producers.reduce((s, p) => s + p.rate, 0); if (document.activeElement !== i || Math.abs(+i.value - r) > 0.01) i.value = r; o.textContent = num(r) + '/с'; });
    } else if (d.t === 'ret') {
      const i = h('input', { type: 'range', min: 4, max: 60, step: 2, 'aria-label': 'Срок хранения', oninput: () => { w.topic('orders').retention = +i.value; } }), o = h('output');
      el = h('div', { class: 'ctl' }, h('span', { class: 'nm' }, 'Хранить'), i, o);
      upd.push(() => { const r = w.topic('orders').retention; i.value = isFinite(r) ? r : 60; o.textContent = (isFinite(r) ? r : 60) + ' с'; });
    } else if (d.t === 'seg') {
      const bs = d.list.map(([v, t]) => h('button', { type: 'button', onclick: () => d.set(w, v, getV()) }, t));
      el = h('div', { class: 'ctl' }, h('span', { class: 'nm' }, d.label), h('div', { class: 'seg' }, bs));
      upd.push(() => bs.forEach((b, i) => { const on = d.get(w, getV()) === d.list[i][0]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }));
    } else if (d.t === 'step') {
      const m = h('button', { class: 'st', type: 'button', 'aria-label': 'меньше', onclick: () => d.set(w, d.get(w) - 1) }, '−'), o = h('output'), p = h('button', { class: 'st', type: 'button', 'aria-label': 'больше', onclick: () => d.set(w, d.get(w) + 1) }, '+');
      el = h('div', { class: 'ctl' }, h('span', { class: 'nm' }, d.label), m, o, p);
      upd.push(() => { const n = d.get(w); o.textContent = n; m.disabled = n <= d.min; p.disabled = n >= d.max; });
    } else if (d.t === 'keys') {
      el = h('div', { class: 'ctl' }, ...K.CLIENTS.slice(0, d.n || 3).map((c) => h('button', { class: 'keyb', type: 'button', style: `background:${c.color}`, onclick: () => w.send(undefined, { key: c }) }, 'Заказ: ' + c.name)));
    }
    return { el, update: () => upd.forEach((f) => f()) };
  }

  /* ---------- подсказки по терминам ---------- */
  let ft = null;
  function showTerm(e) {
    const s = e.target.closest && e.target.closest('.term'); if (!s) return;
    hideTerm(); const t = K.TERMS[s.dataset.term]; if (!t) return;
    ft = h('div', { class: 'floattip' }, t[1]); document.body.append(ft);
    const r = s.getBoundingClientRect(); ft.style.left = Math.max(10, Math.min(innerWidth - ft.offsetWidth - 10, r.left)) + 'px';
    const below = r.bottom + 8 + ft.offsetHeight < innerHeight; ft.style.top = (below ? r.bottom + 8 : r.top - ft.offsetHeight - 8) + 'px';
  }
  function hideTerm() { if (ft) { ft.remove(); ft = null; } }
  document.addEventListener('mouseover', showTerm); document.addEventListener('focusin', showTerm);
  document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.term')) hideTerm(); }); document.addEventListener('focusout', hideTerm);

  Object.assign(K, { h, svg, fmt, pl, num, clock, icon, Chart, terminal, control });
})();
