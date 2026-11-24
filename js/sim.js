/* Симулятор Kafka. Чистая логика без графики: можно гонять и в Node. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const K = (root.K = root.K || {});

  /* Настоящая формула Kafka для сообщений с ключом: toPositive(murmur2(ключ)) % число партиций. */
  function utf8(str) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8'); }
  function murmur2(str) {
    const d = utf8(str), len = d.length, M = 0x5bd1e995, n4 = len >> 2;
    let h = (0x9747b28c ^ len) | 0;
    for (let i = 0; i < n4; i++) {
      const j = i * 4;
      let k = d[j] | (d[j + 1] << 8) | (d[j + 2] << 16) | (d[j + 3] << 24);
      k = Math.imul(k, M); k ^= k >>> 24; k = Math.imul(k, M);
      h = Math.imul(h, M); h ^= k;
    }
    const r = n4 * 4, tail = len % 4;
    if (tail >= 3) h ^= d[r + 2] << 16;
    if (tail >= 2) h ^= d[r + 1] << 8;
    if (tail >= 1) { h ^= d[r]; h = Math.imul(h, M); }
    h ^= h >>> 13; h = Math.imul(h, M); h ^= h >>> 15;
    return h | 0;
  }
  const keyPart = (key, n) => (murmur2(key) & 0x7fffffff) % n;
  const CLIENTS = [
    { id: 'anna', name: 'Аня', color: '#e8604c' },
    { id: 'ivan', name: 'Ваня', color: '#4c9fe0' },
    { id: 'vera', name: 'Вера', color: '#7fb83a' },
    { id: 'olga', name: 'Оля', color: '#b57be0' },
  ];
  const PARCEL = '#d9a15c';
  const PALETTE = ['#e8604c', '#4c9fe0', '#7fb83a', '#b57be0', '#e0a83a', '#3fb8a6'];
  const GROUPS = {
    kitchen: { id: 'kitchen', name: 'Кухня', color: '#ffc233', ink: '#b07400' },
    sms: { id: 'sms', name: 'СМС', color: '#4aa8f0', ink: '#1f7fd1' },
    analytics: { id: 'analytics', name: 'Аналитика', color: '#f07ab4', ink: '#c2408f' },
  };
  const WINDOW = 3; // секунд для расчёта скоростей
  const SESSION = 2.5; // через сколько группа замечает пропавшего читателя (в Kafka session.timeout.ms, по умолчанию 45 с)
  const STICKY = 8; // сколько сообщений подряд «липнет» к одной партиции в режиме пачек

  class World {
    constructor() { this.reset(); }
    reset() {
      this.t = 0; this.paused = false; this.scale = 1;
      this.producers = []; this.topics = []; this.groups = []; this.flights = []; this.fx = []; this.timers = [];
      this.brokerCap = Infinity; this.brokerFree = 0;
      this.show = { broker: false, brokerLabel: true, flagLabels: true, lagLabels: false, endLabels: false, robotNames: true, keys: false, stampFrom: null };
      this.keyMode = 'none'; // none (по очереди) | sticky (пачками) | keys | hot
      this.sync = null;
      this.c = { sent: 0, landed: 0, burned: 0, lost: 0 };
      this.landTimes = []; this.ackTimes = [];
      this.hist = []; this.histT = 0;
      this.msgSeq = 0; this.lastRewind = null; this.marked = null;
      this.onSay = this.onSay || null; this.onEvent = this.onEvent || null;
      this.rng = 1234567;
      return this;
    }
    rnd() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }
    say(text, kind) { if (this.onSay) this.onSay(text, kind || 'info'); }
    emit(type, data) { if (this.onEvent) this.onEvent(type, data || {}); }

    /* Отложенное действие в игровом времени: пауза и сброс его тоже касаются. */
    later(sec, fn) { this.timers.push({ t: this.t + sec, fn }); }

    /* ---------- сборка ---------- */
    addTopic(o) {
      const t = Object.assign({ id: 'orders', name: 'orders', kind: 'log', retention: Infinity, rr: 0, parts: [] }, o);
      const n = o.n || 1; t.parts = [];
      this.topics.push(t);
      for (let i = 0; i < n; i++) t.parts.push(this._part(t, i));
      return t;
    }
    _part(t, i) { return { id: t.id + '-' + i, idx: i, topic: t, start: 0, msgs: [], get end() { return this.start + this.msgs.length; } }; }
    topic(id) { return this.topics.find((t) => t.id === (id || 'orders')); }
    setPartitions(n, id) {
      const t = this.topic(id); if (!t) return;
      n = Math.min(8, n); if (n <= t.parts.length) return;
      while (t.parts.length < n) t.parts.push(this._part(t, t.parts.length));
      this.groups.forEach((g) => {
        if (g.topicId !== t.id) return;
        t.parts.forEach((p) => { if (g.offsets[p.idx] === undefined) g.offsets[p.idx] = 0; });
        this.rebalance(g);
      });
      this.say(`Партиций в топике теперь: ${t.parts.length}. Старые сообщения остались, где лежали.`);
      this.emit('parts', { topic: t });
    }
    addProducer(o) {
      const p = Object.assign({ id: 'site', name: 'Сайт', kind: 'kiosk', rate: 0, acc: 0, topics: ['orders'], color: '#e2503f', lastAck: null, pulse: -9, waiting: 0 }, o);
      this.producers.push(p); return p;
    }
    producer(id) { return id ? this.producers.find((p) => p.id === id) : this.producers[0]; }
    addGroup(o) {
      const base = GROUPS[o.id] || { name: o.id, color: '#ffc233', ink: '#b07400' };
      const g = Object.assign({}, base, { topicId: 'orders', speed: 1.5, offsets: {}, consumers: [], rebUntil: 0, deadUntil: 0, seq: 0, done: 0, doneTimes: [], e2e: [], max: 8, from: 'earliest' }, o);
      const t = this.topic(g.topicId);
      t.parts.forEach((p) => { g.offsets[p.idx] = g.from === 'latest' ? p.end : p.start; });
      this.groups.push(g);
      const n = o.n === undefined ? 1 : o.n;
      for (let i = 0; i < n; i++) this._addConsumer(g, o.on !== false);
      this.assign(g);
      return g;
    }
    group(id) { return this.groups.find((g) => g.id === id); }
    removeGroup(id) { this.groups = this.groups.filter((g) => g.id !== id); }
    _addConsumer(g, on) {
      g.seq++;
      g.consumers.push({ id: `${g.id}-${g.seq}`, num: g.seq, group: g, on: on !== false, assigned: [], busy: null, rr: 0, done: 0, born: this.t });
    }
    setConsumers(gid, n) {
      const g = this.group(gid); if (!g) return;
      n = Math.max(0, Math.min(g.max, n));
      const was = g.consumers.length; if (n === was) return;
      while (g.consumers.length < n) this._addConsumer(g, true);
      while (g.consumers.length > n) { g.consumers.pop(); }
      if (!g.consumers.length) g.seq = 0; else g.seq = Math.max(...g.consumers.map((c) => c.num));
      this.rebalance(g);
      this.emit('consumers', { g });
    }
    consumer(id) { for (const g of this.groups) for (const c of g.consumers) if (c.id === id) return c; return null; }
    toggleConsumer(id, on) {
      const c = this.consumer(id); if (!c) return;
      const want = on === undefined ? !c.on : on; if (want === c.on) return;
      const g = c.group, again = c.busy && !c.busy.queue ? c.busy : null, many = this.topic(g.topicId).parts.length > 1 || g.consumers.length > 1;
      c.on = want; c.busy = null;
      if (want) {
        this.rebalance(g);
        this.say(many ? `${g.name}: consumer ${c.num} вернулся. Группа заново делит партиции.` : `${g.name}: читатель включён, продолжит с того места, где остановился.`, 'good');
      } else if (g.consumers.some((x) => x.on)) {
        // Как в жизни: соседи продолжают читать своё, а партиции упавшего стоят, пока группа не заметит пропажу.
        const own = c.assigned.length && !g.rebUntil;
        if (g.rebUntil) this.rebalance(g); else g.deadUntil = this.t + SESSION;
        this.say(own ? `${g.name}: consumer ${c.num} упал. Пока группа не заметила, ${c.assigned.length > 1 ? 'партиции' : 'партицию'} ${c.assigned.map((i) => 'P' + i).join(', ')} никто не читает.` : `${g.name}: consumer ${c.num} упал.`, 'bad');
      } else this.say(`${g.name}: читать некому. Сообщения копятся, но не пропадают.`, 'bad');
      if (again) this.say(`Сообщение ${again.off}${many ? ' из P' + again.p.idx : ''} он доделать не успел. Закладка не сдвинулась, его обработают ещё раз.`, 'warn');
      this.emit('toggle', { c });
    }

    /* ---------- consumer group ---------- */
    rebalance(g, delay) { g.deadUntil = 0; g.rebUntil = this.t + (delay === undefined ? 0.7 : delay); g.consumers.forEach((c) => { c.busy = null; c.assigned = []; }); }
    assign(g) {
      g.rebUntil = 0; g.deadUntil = 0;
      const t = this.topic(g.topicId), live = g.consumers.filter((c) => c.on);
      g.consumers.forEach((c) => { c.assigned = []; c.busy = null; c.rr = 0; });
      if (!live.length) return;
      if (t.kind === 'queue') { live.forEach((c) => { c.assigned = [0]; }); return; }
      const n = live.length, P = t.parts.length, base = Math.floor(P / n), extra = P % n;
      let k = 0;
      live.forEach((c, i) => { const cnt = base + (i < extra ? 1 : 0); for (let j = 0; j < cnt; j++) c.assigned.push(k++); });
      const idle = live.filter((c) => !c.assigned.length).length;
      if (idle && g._idle !== idle) this.say(`${g.name}: ${idle} consumer без дела. Партиций всего ${P}, на всех не хватило.`, 'warn');
      g._idle = idle;
    }
    activeCount(g) { return g.consumers.filter((c) => c.on && c.assigned.length).length; }
    idleCount(g) { return g.rebUntil ? 0 : g.consumers.filter((c) => c.on && !c.assigned.length).length; }
    capacity(g) { return this.activeCount(g) * g.speed; }
    partLag(g, p) { return Math.max(0, p.end - Math.max(g.offsets[p.idx] || 0, p.start)); }
    lag(g) { const t = this.topic(g.topicId); return t ? t.parts.reduce((s, p) => s + this.partLag(g, p), 0) : 0; }
    rewind(gid, off, partIdx, quiet) {
      const g = this.group(gid); if (!g) return;
      const t = this.topic(g.topicId);
      t.parts.forEach((p) => {
        if (partIdx !== undefined && p.idx !== partIdx) return;
        const to = Math.max(p.start, Math.min(p.end, off));
        if (to < g.offsets[p.idx]) this.lastRewind = { g: gid, to, t: this.t };
        g.offsets[p.idx] = to;
        g.consumers.forEach((c) => { if (c.busy && c.busy.p === p) c.busy = null; });
      });
      // Переставить закладку командой можно только у остановленной группы, поэтому чтение на миг встаёт.
      if (!quiet && g.consumers.some((c) => c.on)) { this.rebalance(g, 0.9); this.say(`${g.name}: группу остановили, переставили закладку и запустили снова.`); }
      this.emit('rewind', { g, off });
    }

    /* ---------- отправка ---------- */
    _pick(t, key) {
      if (key) return t.parts[keyPart(key.id, t.parts.length)];
      if (this.keyMode === 'sticky') {
        if (!t.stick || t.stick.left <= 0 || t.stick.p >= t.parts.length) {
          let p = Math.floor(this.rnd() * t.parts.length);
          if (t.stick && t.parts.length > 1 && p === t.stick.p) p = (p + 1) % t.parts.length;
          t.stick = { p, left: STICKY };
        }
        t.stick.left--; return t.parts[t.stick.p];
      }
      return t.parts[t.rr++ % t.parts.length];
    }
    autoKey() {
      const cl = (n) => ({ id: 'client-' + n, name: 'client-' + n, color: PALETTE[n % 6] });
      if (this.keyMode === 'keys') return cl(Math.floor(this.rnd() * 60));
      if (this.keyMode === 'hot') return cl(this.rnd() < 0.75 ? 1 : Math.floor(this.rnd() * 60));
      return null;
    }
    send(pid, o) {
      o = o || {};
      const pr = this.producer(pid); if (!pr) return null;
      const key = o.key === undefined ? this.autoKey() : o.key;
      let first = null;
      (o.topics || pr.topics).forEach((tid) => {
        const t = this.topic(tid); if (!t) return;
        const part = o.part !== undefined ? t.parts[o.part] : this._pick(t, key);
        const ahead = this.flights.filter((f) => f.part === part).length;
        const f = { id: ++this.msgSeq, pr, topic: t, part, key, color: (key && key.color) || PARCEL, t0: this.t, dur: 0.75, expect: part.end + ahead, marked: !!o.marked, tok: !!o.tok };
        // У брокера есть потолок записи: сообщение долетает, ждёт своей очереди и только потом ложится в лог.
        if (isFinite(this.brokerCap)) {
          const grant = Math.max(this.t + 0.4, this.brokerFree); this.brokerFree = grant + 1 / this.brokerCap;
          f.hold0 = 0.4; f.hold1 = grant - this.t; f.dur = f.hold1 + 0.35;
        }
        this.flights.push(f); first = first || f;
      });
      pr.pulse = this.t; this.c.sent++;
      if (o.marked) this.marked = { id: first.id, t0: this.t, ack: null, done: null, e2e: null };
      this.emit('send', { f: first });
      return first;
    }
    /* Сразу положить сообщение в лог (для подготовки сцены). */
    put(n, o) {
      o = o || {};
      const t = this.topic(o.topic);
      for (let i = 0; i < n; i++) {
        const key = o.key || null, part = o.part !== undefined ? t.parts[o.part] : this._pick(t, key);
        this._append(part, { id: ++this.msgSeq, color: (key && key.color) || PARCEL, key, tSent: this.t, tLand: this.t, marked: false, readBy: {} });
      }
    }
    _append(part, m) {
      m.off = part.end; part.msgs.push(m);
      if (part.msgs.length > 2500) { part.msgs.shift(); part.start++; }
    }
    _land(f) {
      const m = { id: f.id, color: f.color, key: f.key, tSent: f.t0, tLand: this.t, marked: f.marked, readBy: {} };
      this._append(f.part, m);
      this.c.landed++; this.landTimes.push(this.t);
      this.fx.push({ type: 'ack', part: f.part, off: m.off, pr: f.pr, t0: this.t, dur: 0.45, tSent: f.t0, id: f.id, tok: f.tok });
      this.emit('land', { m, part: f.part });
    }

    /* ---------- чтение ---------- */
    _take(g, c, t0) {
      const t = this.topic(g.topicId), n = c.assigned.length;
      for (let k = 0; k < n; k++) {
        const p = t.parts[c.assigned[(c.rr + k) % n]]; if (!p) continue;
        if (t.kind === 'queue') {
          if (!p.msgs.length) continue;
          const m = p.msgs.shift(); p.start++;
          g.offsets[p.idx] = p.start;
          const s = Math.max(t0, m.tLand);
          c.busy = { p, off: m.off, m, t0: s, t1: s + 1 / g.speed, queue: true };
          this.fx.push({ type: 'take', part: p, off: m.off, c, color: m.color, t0: this.t, dur: Math.min(0.6, 0.8 / g.speed) });
          return true;
        }
        let off = g.offsets[p.idx] || 0; if (off < p.start) off = p.start;
        if (off < p.end) {
          const m = p.msgs[off - p.start], s = Math.max(t0, m.tLand);
          c.busy = { p, off, m, t0: s, t1: s + 1 / g.speed };
          c.rr = (c.rr + k + 1) % n;
          this.fx.push({ type: 'copy', part: p, off, c, color: m.color, t0: this.t, dur: Math.max(0.28, Math.min(0.6, 0.75 / g.speed)), marked: m.marked });
          return true;
        }
      }
      return false;
    }
    _finish(g, c) {
      const b = c.busy;
      if (!b.queue) g.offsets[b.p.idx] = Math.max(g.offsets[b.p.idx] || 0, b.off + 1);
      b.m.readBy[g.id] = b.t1;
      c.done++; g.done++; g.doneTimes.push(b.t1);
      const e = b.t1 - b.m.tSent;
      g.e2e.push(e); if (g.e2e.length > 12) g.e2e.shift();
      if (b.m.marked && this.marked && this.marked.id === b.m.id && this.marked.done === null) { this.marked.done = b.t1; this.marked.e2e = e; }
      this.emit('done', { g, c, m: b.m, part: b.p, e2e: e });
      c.busy = null;
      return b.t1;
    }

    /* ---------- синхронный режим (ступень 1) ---------- */
    startSync(services) { this.sync = { services, order: null, done: 0, fail: 0, last: null, waitLimit: 3.5 }; }
    syncOrder() {
      const s = this.sync; if (!s || s.order) return;
      s.order = { i: 0, phase: 'go', p: 0, start: this.t }; s.last = null;
    }
    _stepSync(dt) {
      const s = this.sync, o = s && s.order; if (!o) return;
      o.p += dt;
      const sv = s.services[o.i];
      if (o.phase === 'go' && o.p >= 0.6) { o.phase = sv.on ? 'work' : 'wait'; o.p = 0; }
      else if (o.phase === 'work') {
        if (!sv.on) { o.phase = 'wait'; o.p = 0; } else if (o.p >= 0.9) { o.phase = 'back'; o.p = 0; }
      } else if (o.phase === 'wait') {
        if (sv.on) { o.phase = 'work'; o.p = 0; }
        else if (o.p >= s.waitLimit) {
          s.fail++; s.last = { ok: false, time: this.t - o.start, who: sv.name }; s.order = null;
          this.say(`${sv.name} не отвечает. Сайт прождал ${s.last.time.toFixed(1).replace('.', ',')} с и показал клиенту ошибку.`, 'bad');
          this.emit('syncFail');
        }
      } else if (o.phase === 'back' && o.p >= 0.6) {
        o.i++; o.p = 0; o.phase = 'go';
        if (o.i >= s.services.length) {
          s.done++; s.last = { ok: true, time: this.t - o.start }; s.order = null;
          this.say(`Заказ принят, но клиент ждал ${s.last.time.toFixed(1).replace('.', ',')} с.`);
          this.emit('syncDone');
        }
      }
    }

    /* ---------- шаг времени ---------- */
    step(dt) {
      if (this.paused) return;
      dt *= this.scale;
      while (dt > 0) { const d = Math.min(dt, 0.05); this._tick(d); dt -= d; }
    }
    _tick(dt) {
      this.t += dt; const now = this.t;
      if (this.timers.length) {
        const due = this.timers.filter((x) => x.t <= now);
        if (due.length) { this.timers = this.timers.filter((x) => x.t > now); due.forEach((x) => x.fn()); }
      }
      if (this.sync) this._stepSync(dt);

      for (const p of this.producers) {
        // get: каждый поток ждёт ack и только потом шлёт следующее. async: шлёт, не дожидаясь.
        if (p.mode === 'get') {
          if ((p.out || 0) < p.threads && now >= (p.nextAt || 0)) { p.out = (p.out || 0) + 1; p.nextAt = now + 0.12; this.send(p.id, { tok: true }); }
        } else {
          const rate = p.mode === 'async' ? p.threads * p.asyncRate : p.rate;
          if (rate > 0) { p.acc += rate * dt; while (p.acc >= 1) { p.acc -= 1; this.send(p.id); } }
        }
      }
      if (this.flights.length) {
        const land = this.flights.filter((f) => now - f.t0 >= f.dur);
        if (land.length) { this.flights = this.flights.filter((f) => now - f.t0 < f.dur); land.forEach((f) => this._land(f)); }
      }
      if (this.fx.length) {
        const end = this.fx.filter((f) => now - f.t0 >= f.dur);
        if (end.length) {
          this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
          end.forEach((f) => {
            if (f.type !== 'ack') return;
            const a = now - f.tSent; f.pr.lastAck = { t: now, ms: a };
            if (f.tok) f.pr.out = Math.max(0, (f.pr.out || 0) - 1);
            this.ackTimes.push(a); if (this.ackTimes.length > 12) this.ackTimes.shift();
            if (this.marked && this.marked.id === f.id) this.marked.ack = a;
            this.emit('ack', { f });
          });
        }
      }
      for (const t of this.topics) {
        if (!isFinite(t.retention)) continue;
        for (const p of t.parts) {
          while (p.msgs.length && now - p.msgs[0].tLand > t.retention) {
            const m = p.msgs.shift(); const off = p.start; p.start++; this.c.burned++;
            this.fx.push({ type: 'burn', part: p, off, color: m.color, t0: now, dur: 0.7 });
            for (const g of this.groups) if (g.topicId === t.id && (g.offsets[p.idx] || 0) < p.start) {
              g.offsets[p.idx] = p.start; this.c.lost++;
              if (!g._lostSay || now - g._lostSay > 6) { g._lostSay = now; this.say(`Срок хранения вышел: «${g.name}» не успела прочитать часть сообщений, они удалены.`, 'bad'); }
            }
          }
        }
      }
      for (const g of this.groups) {
        if (g.deadUntil && now >= g.deadUntil) { this.rebalance(g); this.say(`${g.name}: пропажу заметили, партиции делят заново (rebalance).`, 'warn'); }
        if (g.rebUntil) { if (now >= g.rebUntil) this.assign(g); else continue; }
        for (const c of g.consumers) {
          if (!c.on) continue;
          let guard = 0;
          while (guard++ < 30) {
            if (c.busy) {
              if (now < c.busy.t1) break;
              const t1 = this._finish(g, c);
              if (!this._take(g, c, t1)) break;
            } else if (!this._take(g, c, now)) break;
          }
        }
      }
      const cut = now - WINDOW;
      while (this.landTimes.length && this.landTimes[0] < cut) this.landTimes.shift();
      for (const g of this.groups) while (g.doneTimes.length && g.doneTimes[0] < cut) g.doneTimes.shift();

      if (now - this.histT >= 0.25) {
        this.histT = now;
        const lags = {}; this.groups.forEach((g) => { lags[g.id] = this.lag(g); });
        this.hist.push({ t: now, in: this.inRate(), out: this.groups.length ? this.outRate(this.groups[0]) : 0, lags, ack: avg(this.ackTimes.slice(-3)) || 0 });
        if (this.hist.length > 240) this.hist.shift();
      }
    }
    _win() { return Math.max(1, Math.min(WINDOW, this.t)); }
    inRate() { return this.landTimes.length / this._win(); }
    outRate(g) { return g.doneTimes.length / this._win(); }
    ackAvg() { return avg(this.ackTimes); }
    ackNow() { return avg(this.ackTimes.slice(-3)); }
    setBrokerCap(x) { this.brokerCap = x; this.brokerFree = Math.max(this.t, isFinite(x) ? this.brokerFree : 0); }
    waiting() { return this.flights.filter((f) => f.hold1 !== undefined && this.t - f.t0 >= f.hold0 && this.t - f.t0 < f.hold1); }
    brokerLoad() { return !isFinite(this.brokerCap) ? null : this.waiting().length > 1 ? 1 : Math.min(1, this.inRate() / this.brokerCap); }
    e2eAvg(g) { return avg(g.e2e); }
    lagAgo(g, sec) {
      const h = this.hist, t = this.t - sec;
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i].lags[g.id];
      return null;
    }
  }
  function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }

  K.World = World; K.CLIENTS = CLIENTS; K.GROUPS = GROUPS; K.PARCEL = PARCEL; K.keyPart = keyPart; K.murmur2 = murmur2;
  if (typeof module !== 'undefined') module.exports = K;
})();
