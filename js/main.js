/* Сборка всего вместе: навигация по ступеням, песочница, шпаргалка, главный цикл. */
(function () {
  'use strict';
  const K = window.K, { h, fmt, num, pl, icon, Chart, control, terminal } = K;
  const $ = (id) => document.getElementById(id);
  const LV = K.LEVELS;

  /* ---------- память ---------- */
  const store = {
    load() { try { return JSON.parse(localStorage.getItem('kafka-na-paltsah') || '{}'); } catch (_) { return {}; } },
    save(o) { try { localStorage.setItem('kafka-na-paltsah', JSON.stringify(o)); } catch (_) { /* приватный режим */ } },
  };
  const P = Object.assign({ done: {}, lvl: 0 }, store.load());

  const w = new K.World();
  // Две схемы на одних и тех же данных: 3D (WebGL) и 2D (обычный canvas). Рисуется только выбранная.
  const scenes = { '2d': new K.Scene2D($('c2d'), w) };
  try { scenes['3d'] = new K.Scene($('gl'), $('labels'), w); } catch (e) { console.warn('3D недоступно, остаёмся в 2D:', e); }
  let view = scenes[P.view] ? P.view : scenes['3d'] ? '3d' : '2d', scene = scenes[view];
  const eachScene = (f) => Object.values(scenes).forEach(f);

  const S = { mode: 'level', lvl: 0, beat: 0, v: {}, passed: false, ctls: [], tick: null, findI: 0 };
  let paused = false, speed = 1;

  /* ---------- лента событий ---------- */
  w.onSay = (text, kind) => {
    const el = h('div', { class: 'say-line ' + (kind || '') }, text); $('feed').append(el);
    while ($('feed').children.length > 2) $('feed').firstChild.remove();
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 500); }, 6500);
  };
  w.onEvent = (type, d) => { const b = beatDef(); if (S.mode === 'level' && b && b.onEvent) b.onEvent(type, d, w, S.v); };

  const level = () => LV[S.lvl];
  const beatDef = () => (S.mode === 'level' ? level().beats[S.beat] : null);

  /* В некоторых заданиях лишние сообщения уедут за край дорожки и помешают. Там отправку придерживаем. */
  K.canSend = () => {
    const b = beatDef(); if (!b || !b.cap || S.passed) return true;
    const t = w.topic('orders'), full = typeof b.cap === 'function' ? b.cap(w) : t && t.parts.reduce((x, p) => x + p.end, 0) + w.flights.length >= b.cap;
    if (full) w.say('Пока хватит сообщений: сначала выполни задание слева.', 'warn');
    return !full;
  };

  /* ---------- дорожка ступеней ---------- */
  function drawTrack() {
    $('track').replaceChildren(...LV.map((l, i) => h('button', { type: 'button', class: (P.done[l.id] ? 'done ' : '') + (S.mode === 'level' && i === S.lvl ? 'cur ' : '') + (l.nt ? 'nt' : ''), title: `${i + 1}. ${l.title}${l.nt ? ' (для НТ)' : ''}`, 'aria-label': `Ступень ${i + 1}: ${l.title}`, 'aria-current': S.mode === 'level' && i === S.lvl ? 'step' : null, onclick: () => goLevel(i) }, String(i + 1))));
    $('goSandbox').classList.toggle('on', S.mode === 'sandbox');
  }

  /* ---------- ступени ---------- */
  function leaveBeat() { const b = beatDef(); if (b && b.leave) b.leave(w, S.v); S.tick = null; eachScene((x) => { x.findMode = false; x.flashType = null; }); }
  function goLevel(i) {
    leaveBeat(); S.mode = 'level'; S.lvl = i; P.lvl = i; store.save(P);
    w.paused = false; level().setup(w); eachScene((x) => x.clear()); $('feed').replaceChildren(); setPause(false);
    goBeat(0);
  }
  function goBeat(i) {
    if (i !== 0) leaveBeat();
    S.beat = i; S.v = {}; S.passed = false; S.findI = 0; S.tick = null; w.paused = false;
    const b = beatDef(); if (b.enter) b.enter(w, S.v);
    drawTrack(); drawPage(); drawDock(b.controls || []);
    $('page').scrollTop = 0;
    if (b.final) { markDone(); scene.party(); }
  }
  function markDone() { P.done[level().id] = true; store.save(P); drawTrack(); }
  function pass() {
    if (S.passed) return; S.passed = true;
    const t = $('page').querySelector('.task'); if (t) t.classList.add('done');
    if ($('hint') && beatDef().hintLive) $('hint').textContent = '';
    const b = beatDef(), a = $('page').querySelector('.after-slot'); if (a) a.replaceWith(...afterBlock(b));
    const n = $('next'); if (n) { n.disabled = false; n.classList.add('pulse'); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const sk = $('skip'); if (sk) sk.hidden = true;
  }
  function next() { if (S.beat < level().beats.length - 1) goBeat(S.beat + 1); else if (S.lvl < LV.length - 1) goLevel(S.lvl + 1); else goSandbox(); }

  const api = {
    w, pass, markDone, goLevel, goSandbox: () => goSandbox(),
    party: () => scene.party(), setTick: (f) => { S.tick = f; }, get v() { return S.v; },
    restart: () => { level().setup(w); eachScene((x) => { const u = x.cam.user; x.clear(); x.cam.user = u; }); },
    flash: (type) => { eachScene((x) => { x.flashType = type; }); clearTimeout(api._f); api._f = setTimeout(() => eachScene((x) => { x.flashType = null; }), 1600); },
  };

  const real = (b) => h('div', { class: 'real' }, h('b', {}, 'Как в настоящей Kafka'), h('p', { html: fmt(b.real) }));
  const afterBlock = (b) => [b.after ? h('p', { class: 'after', html: fmt(b.after) }) : null, b.real ? real(b) : null, b.say && !b.final ? h('div', { class: 'say' }, h('small', {}, 'Как ответить на собесе'), b.say) : null].filter(Boolean);
  function drawPage() {
    const l = level(), b = beatDef(), pg = $('page'), kids = [];
    kids.push(h('div', { class: 'step-head' }, h('div', { class: 'step-num' }, String(S.lvl + 1)), h('div', {}, h('h1', {}, l.title), l.nt ? h('span', { class: 'nt-mark' }, 'важно для НТ') : null)));
    if (l.intro && S.beat === 0) kids.push(h('p', { class: 'intro', html: fmt(l.intro) }));
    if (l.terms.length && S.beat === 0) kids.push(h('div', { class: 'parts-box' }, h('span', {}, 'Детали этой ступени'), ...l.terms.map((t) => h('span', { class: 'part-item', html: icon(t) + `<span class="term" tabindex="0" data-term="${t}">${K.TERMS[t][0]}</span>` }))));
    const past = l.beats.slice(0, S.beat).filter((x) => x.h && x.p);
    if (past.length) kids.push(h('div', { class: 'past-wrap' }, past.map((x) => h('details', { class: 'past' }, h('summary', {}, x.h), ...x.p.concat(x.after || [], x.real ? '**Как в настоящей Kafka:** ' + x.real : []).map((t) => h('p', { html: fmt(t) }))))));

    const body = h('div', { class: 'beat' });
    if (b.h) body.append(h('h2', {}, b.h));
    (b.p || []).forEach((t) => body.append(h('p', { html: fmt(t) })));
    if (b.code) body.append(h('div', { class: 'code' }, b.code));
    if (b.look) body.append(h('div', { class: 'look' }, h('b', {}, 'На что смотреть'), h('ul', {}, b.look.map((t) => h('li', { html: fmt(t) })))));
    let needs = false;
    if (b.task) {
      needs = true;
      body.append(h('div', { class: 'task' }, h('span', { class: 'box', 'aria-hidden': 'true' }, '✓'), h('b', { html: fmt(b.task) }), b.steps ? h('ol', { class: 'steps' }, b.steps.map((t) => h('li', { html: fmt(t) }))) : null, h('small', { id: 'hint' }, b.hint || '')));
    }
    if (b.find) { needs = true; body.append(h('ol', { class: 'find-list', id: 'find' }, b.find.map((f, i) => h('li', { class: i ? '' : 'cur', html: fmt(f.ask) })))); eachScene((x) => { x.findMode = true; }); }
    if (b.quiz) { needs = true; body.append(quiz(b.quiz)); }
    if (b.num) { needs = true; body.append(numq(b.num)); }
    if (b.custom) { needs = true; const c = h('div'); body.append(c); K.CUSTOM[b.custom](c, api); }
    if (needs) body.append(h('span', { class: 'after-slot' })); else if (!b.final) body.append(...afterBlock(b));
    if (b.final) body.append(h('div', { class: 'final' }, h('h2', {}, 'Что запомнить'), h('ul', {}, b.final.map((t) => h('li', { html: fmt(t) }))), h('div', { class: 'say' }, h('small', {}, 'Как ответить на собесе'), b.say)));
    if (b.custom !== 'exam') {
      const last = S.beat === l.beats.length - 1;
      body.append(h('div', { class: 'foot' }, h('button', { id: 'next', class: 'btn go', type: 'button', disabled: needs, onclick: next }, last ? (S.lvl < LV.length - 1 ? 'Следующая ступень' : 'В песочницу') : 'Дальше'), needs ? h('button', { id: 'skip', class: 'link', type: 'button', onclick: next }, 'Пропустить') : null));
    }
    kids.push(body); pg.replaceChildren(...kids);
    if (!needs) S.passed = true;
  }
  function quiz(q) {
    const why = h('p', { class: 'why', hidden: true });
    const opts = h('div', { class: 'opts' }, q.options.map((o, i) => {
      const b = h('button', { class: 'opt', type: 'button', onclick: () => {
        const ok = i === q.ok; b.classList.add(ok ? 'ok' : 'no'); why.hidden = false; why.className = 'why' + (ok ? '' : ' no'); why.textContent = ok ? q.why : (q.whyNot && q.whyNot[i]) || 'Не угадал. Попробуй ещё.';
        if (ok) { opts.querySelectorAll('button').forEach((x) => { x.disabled = true; }); pass(); } else b.disabled = true;
      } }, o);
      return b;
    }));
    return h('div', {}, q.intro ? h('p', {}, q.intro) : null, h('p', { class: 'quiz-q' }, q.q), opts, why);
  }
  function numq(q) {
    let v = q.min; const out = h('output', {}, String(v)), why = h('p', { class: 'why', hidden: true });
    const set = (n) => { v = Math.max(q.min, Math.min(q.max, n)); out.textContent = v; };
    const chk = h('button', { class: 'btn', type: 'button', onclick: () => {
      const ok = v === (typeof q.ok === 'function' ? q.ok(w) : q.ok); why.hidden = false; why.className = 'why' + (ok ? '' : ' no'); why.textContent = ok ? q.why : 'Не сходится. ' + (q.no || 'Попробуй ещё.');
      if (ok) { const b = beatDef(); if (b.reveal) b.reveal(w); pass(); chk.disabled = true; }
    } }, 'Проверить');
    return h('div', {}, q.intro ? h('p', {}, q.intro) : null, h('p', { class: 'quiz-q' }, q.q), h('div', { class: 'numrow' }, h('button', { class: 'st', type: 'button', 'aria-label': 'меньше', onclick: () => set(v - 1) }, '−'), out, h('button', { class: 'st', type: 'button', 'aria-label': 'больше', onclick: () => set(v + 1) }, '+'), chk), why);
  }

  /* ---------- нижняя панель ---------- */
  function drawDock(list) { S.ctls = list.map((d) => control(d, w, () => S.v)); $('dock').replaceChildren(...S.ctls.map((c) => c.el)); S.ctls.forEach((c) => c.update()); }

  /* ---------- клики по схеме ---------- */
  eachScene((sc) => {
    sc.onPick = (p) => {
      const b = beatDef();
      if (b && b.find && S.findI < b.find.length) { findClick(p, b); return; }
      if (b && b.onPick) b.onPick(p, w, S.v);
      if (p.type === 'producer') { p.data._click = scene.time; if (w.sync) w.syncOrder(); else if (K.canSend()) w.send(p.data.id); }
      else if (p.type === 'consumer') { if (p.data.sync) p.data.sync.on = !p.data.sync.on; else w.toggleConsumer(p.id); }
    };
    sc.onHover = (p, x, y) => {
      const t = $('tip'); const txt = p && tipText(p);
      if (!txt) { t.hidden = true; return; }
      t.replaceChildren(h('b', {}, txt[0]), txt[1]); t.hidden = false;
      const r = $('stage').getBoundingClientRect(); let lx = x - r.left + 16, ly = y - r.top + 16;
      if (lx + t.offsetWidth > r.width - 8) lx = x - r.left - t.offsetWidth - 12;
      if (ly + t.offsetHeight > r.height - 8) ly = y - r.top - t.offsetHeight - 12;
      t.style.transform = `translate(${lx}px,${ly}px)`;
    };
  });
  function tipText(p) {
    if (scene.findMode) return null;
    const d = p.data;
    switch (p.type) {
      case 'producer': return [w.sync ? d.name : `Producer: ${d.name}`, w.sync ? 'Клик: сделать заказ.' : 'Пишет сообщения. Клик: отправить одно.'];
      case 'consumer': return d.sync ? [d.sync.name, d.sync.on ? 'Клик: сломать.' : 'Клик: починить.'] : [w.show.robotNames ? `Читатель (consumer ${d.num}), группа «${d.group.name}»` : d.group.name, d.on ? `Обработал: ${d.done}. Клик: выключить.` : 'Выключен. Клик: включить.'];
      case 'group': return [`Группа «${d.name}»`, `Читатели одного сервиса. Не прочитано (lag): ${w.lag(d)}. Обработано: ${d.done}.`];
      case 'broker': return ['Broker', 'Сервер Kafka. Хранит топики и сообщения.'];
      case 'topic': return [d.kind === 'queue' ? 'Обычная очередь' : `Topic: ${d.name}`, d.kind === 'queue' ? 'Прочитал и забрал.' : 'Канал для сообщений на одну тему.'];
      case 'partition': return d.topic.kind === 'queue' ? ['Обычная очередь', 'Прочитал и забрал.'] : [`Дорожка (партиция P${d.idx})`, `Сообщений хранится: ${d.msgs.length}. Конец лога: ${d.end}, этот номер получит следующее.`];
      case 'flag': {
        const off = Math.max(d.g.offsets[d.p.idx] || 0, d.p.start), hid = Math.round((view === '3d' ? d.p._vb : d.p._2v) - off);
        return [`Закладка группы «${d.g.name}»`, `Следующим прочитает offset ${off}. Не прочитано в этой дорожке: ${w.partLag(d.g, d.p)}.${hid > 1 ? ` Из них ${hid} не поместились на экран, они левее.` : ''} Можно перетащить.`];
      }
      case 'msg': {
        const r = Object.keys(d.m.readBy).map((id) => (w.group(id) || K.GROUPS[id] || {}).name).filter(Boolean);
        return [`Сообщение, offset ${d.off}`, `${d.m.key ? 'Ключ: ' + d.m.key.id + '. ' : 'Без ключа. '}${w.show.stampFrom !== null && d.m.tSent >= w.show.stampFrom ? 'Внутри sentAt: ' + K.clock(d.m.tSent) + '. ' : ''}${r.length ? 'Прочитали: ' + r.join(', ') + '.' : 'Ещё никто не прочитал.'}`];
      }
    }
    return null;
  }
  function findClick(p, b) {
    const f = b.find[S.findI], li = $('find').children[S.findI];
    if (f.types.includes(p.type)) {
      li.className = 'ok'; li.innerHTML = fmt(f.ask) + `: это <b>${f.name}</b>`; S.findI++;
      if (S.findI < b.find.length) $('find').children[S.findI].className = 'cur'; else { eachScene((x) => { x.findMode = false; }); pass(); }
    } else { li.classList.remove('shake'); void li.offsetWidth; li.classList.add('shake'); w.say('Нет, это другое: ' + ({ producer: 'producer', consumer: 'consumer', group: 'consumer group', topic: 'топик', partition: 'партиция топика', broker: 'broker', msg: 'сообщение', flag: 'закладка' }[p.type] || ''), 'warn'); }
  }

  /* ---------- приборы ---------- */
  const g0 = () => w.group('kitchen') || w.groups[0];
  const sec = (x) => (x === null || x === undefined ? '…' : num(x) + ' с');
  const who = () => (w.groups.length > 1 && g0() ? ' · ' + g0().name : '');
  const CH = {
    in: () => ['Пишут', num(w.inRate()) + '/с'], out: () => ['Читают' + who(), num(g0() ? w.outRate(g0()) : 0) + '/с'],
    lag: () => { const l = g0() ? w.lag(g0()) : 0; return ['Lag' + who(), String(l), l > 30 ? 'bad' : l > 8 ? 'warn' : '']; },
    cap: () => ['Потолок чтения', num(g0() ? w.capacity(g0()) : 0) + '/с'],
    ack: () => ['Ответ (ack)', sec(w.ackAvg())], e2e: () => ['Весь путь (e2e)', sec(g0() ? w.e2eAvg(g0()) : null)],
    mack: () => { const m = w.marked; return ['Ответ от Kafka (ack)', !m ? '0,0 с' : m.ack === null ? num(w.t - m.t0) + ' с' : num(m.ack) + ' с ✓', m && m.ack !== null ? 'good' : '']; },
    me2e: () => { const m = w.marked; return ['Заказ обработан', !m ? '0,0 с' : m.done === null ? num(w.t - m.t0) + ' с' : num(m.e2e) + ' с ✓', m && m.done !== null ? (m.e2e > 5 ? 'warn' : 'good') : '']; },
    thr: () => { const p = w.producers[0]; return ['На один поток', num(p && p.threads ? w.inRate() / p.threads : 0) + '/с']; },
    smp: () => { const p = w.producers[0]; return ['Сэмплер показывает', p && p.mode === 'async' ? '≈ 0 с' : sec(w.ackNow()), p && p.mode === 'async' ? 'warn' : '']; },
    rack: () => ['Настоящий ack', sec(w.ackNow())],
    ackn: () => { const a = w.ackNow(); return ['Время записи (ack)', sec(a), a > 4 ? 'bad' : a > 2 ? 'warn' : '']; },
    brk: () => { const l = w.brokerLoad(); return ['Загрузка брокера', l === null ? 'норма' : Math.round(l * 100) + '%', l >= 0.97 ? 'bad' : l > 0.8 ? 'warn' : '']; },
    step: () => ['Ступень', S.v.step || 'ждём старта'],
  };
  let chipEls = {}, chipKey = '';
  function drawHud() {
    const b = beatDef();
    let list = S.mode === 'sandbox' ? ['in', 'out', 'lag', 'ackn', 'e2e'].concat(isFinite(w.brokerCap) ? 'brk' : []) : (b && b.hud) || level().hud || [];
    if (b && b.hudHide) { const hide = b.hudHide(S.v); list = list.filter((x) => !hide.includes(x)); }
    if (list.join() !== chipKey) { chipKey = list.join(); chipEls = {}; $('hud').replaceChildren(...list.map((id) => { const e = { b: h('b'), s: h('span') }; e.el = h('div', { class: 'chip' }, e.s, e.b); chipEls[id] = e; return e.el; })); }
    list.forEach((id) => { const [n, v, c] = CH[id](), e = chipEls[id]; if (e.s.textContent !== n) e.s.textContent = n; if (e.b.textContent !== v) e.b.textContent = v; const cl = 'chip ' + (c || ''); if (e.el.className !== cl) e.el.className = cl; });
    const ch = S.mode === 'sandbox' ? sb.view === 'charts' : b && (b.charts !== undefined ? b.charts : level().charts), tm = S.mode === 'sandbox' ? sb.view === 'term' : b && b.term;
    $('charts').hidden = !ch; $('term').hidden = !tm;
    if (ch) {
      cRate.el.hidden = ch === 'ack'; cAck.el.hidden = !(ch === 'ack' || (S.mode === 'sandbox' && isFinite(w.brokerCap)));
      cAck.update(w.hist, [{ name: 'ack', color: '#1f7fd1', get: (p) => p.ack || 0, d: 1 }], w.t);
      cRate.update(w.hist, [{ name: 'пишут', color: '#1f7fd1', get: (p) => p.in, d: 1 }, { name: w.groups.length > 1 && g0() ? g0().name + ' читает' : 'читают', color: '#d9541e', get: (p) => p.out, d: 1 }], w.t);
      cLag.update(w.hist, w.groups.map((g) => ({ name: g.name, color: g.ink, get: (p) => p.lags[g.id] || 0, d: 0 })), w.t);
    }
    if (tm) terminal($('term'), w, S.mode === 'sandbox' ? sb.termGroup : 'kitchen');
  }
  const cRate = new Chart('Скорость, в секунду'), cLag = new Chart('Lag, сообщений'), cAck = new Chart('Время записи (ack), секунд'); $('charts').append(cRate.el, cAck.el, cLag.el);

  /* ---------- песочница ---------- */
  const sb = { from: 'earliest', view: 'charts', termGroup: 'kitchen', preset: 'calm', upd: [] };
  const PRE = {
    calm: ['Спокойный день', 'Пишут 3 в секунду, читать могут 6. Lag около нуля, запас двукратный.', { parts: 3, rate: 3, n: 3, speed: 2 }, 'Поднимай запись и найди потолок: до 6 в секунду lag держится, выше начинает расти.'],
    rush: ['Чёрная пятница', 'Пишут 10 в секунду, а потолок чтения 6. Lag растёт на 4 каждую секунду.', { parts: 3, rate: 10, n: 3, speed: 2 }, 'Потуши lag. Сначала партиции до 6, потом consumer до 6. Обрати внимание: старый хвост остаётся в P0–P2.'],
    down: ['Упал consumer', 'Один из трёх лежит. Сначала его партиция стоит, потом её берёт сосед и работает за двоих.', { parts: 3, rate: 5, n: 3, speed: 2, kill: 1 }, 'Кликни по упавшему роботу, чтобы поднять. Посмотри, как партиции вернутся.'],
    extra: ['Лишние consumer', 'Читателей 6, а партиций 2. Четверо спят, а lag всё равно растёт.', { parts: 2, rate: 5, n: 6, speed: 2 }, 'Добавляй партиции по одной: каждая новая будит одного робота.'],
    hot: ['Горячая партиция', 'Один клиент шлёт 75% заказов с одним ключом. Почти вся нагрузка в одной дорожке.', { parts: 4, rate: 5, n: 4, speed: 2, key: 'hot' }, 'Добавь consumer и убедись, что не помогает. Потом смени ключ на «по клиенту» и сравни.'],
    slow: ['Тормозит обработка', 'Consumer стали медленными: например, база данных отвечает долго. Сама Kafka ни при чём.', { parts: 4, rate: 4, n: 4, speed: 0.6 }, 'Верни «Скорость одного» к 1,2 и посмотри, как lag перестанет расти.'],
    ret: ['Короткий срок хранения', 'Хранение всего 8 секунд, а чтение отстаёт. Часть сообщений удалят непрочитанными.', { parts: 2, rate: 5, n: 2, speed: 1, ret: 8 }, 'Увеличь срок хранения или скорость чтения, чтобы потери прекратились.'],
    broker: ['Упёрся брокер', 'Просят записать 8 в секунду, брокер успевает 5. Читатели свободны, lag около нуля, зато растёт время записи.', { parts: 4, rate: 8, n: 4, speed: 3, cap: 5 }, 'Добавь consumer или партиции: не поможет. Убавь запись до 4 или подними «Потолок брокера» и смотри на ack.'],
    two: ['Две группы', 'Кухня и аналитика читают одно и то же независимо. У каждой свои закладки и свой lag.', { parts: 3, rate: 4, n: 3, speed: 2, an: true }, 'Урони все роботы аналитики: кухня этого даже не заметит.'],
  };
  const KEYTXT = {
    none: 'Ключа нет, кладём по очереди в каждую партицию. Самый ровный вариант, удобно для наблюдения.',
    sticky: 'Ключа нет, кладём пачками по 8: в одну партицию, потом в другую. Так и работает настоящий producer, только пачки у него больше.',
    keys: '60 разных клиентов. Партицию выбирает настоящая формула Kafka, murmur2 от ключа. Выходит примерно поровну.',
    hot: 'Три четверти сообщений с ключом client-1. Все они попадают в одну партицию.',
  };
  function loadPreset(id) {
    sb.preset = id; const o = PRE[id][2];
    w.reset(); w.show.broker = true; w.show.lagLabels = true; w.show.flagLabels = false; w.keyMode = o.key || 'none';
    w.addTopic({ n: o.parts, retention: o.ret || Infinity }); w.addProducer({ rate: o.rate });
    w.addGroup({ id: 'kitchen', n: o.n, speed: o.speed }); if (o.an) w.addGroup({ id: 'analytics', n: 1, speed: 5 });
    sb.from = 'earliest';
    if (o.cap) w.setBrokerCap(o.cap);
    if (o.kill) w.toggleConsumer('kitchen-' + o.kill, false);
    sb.termGroup = 'kitchen'; eachScene((x) => x.clear()); $('feed').replaceChildren(); drawSandbox();
  }
  function goSandbox() {
    leaveBeat(); S.mode = 'sandbox'; S.v = {}; setPause(false); w.paused = false; drawTrack();
    loadPreset('calm');
    drawDock([{ t: 'btn', label: 'Отправить одно', primary: true, run: () => w.send() }, K.ctl.burst(20, 'Залп 20'), { t: 'btn', label: 'Уронить случайного', run: () => { const a = w.groups.flatMap((g) => g.consumers.filter((c) => c.on)); if (a.length) w.toggleConsumer(a[Math.floor(Math.random() * a.length)].id, false); } }, { t: 'btn', label: 'Перечитать с начала', run: () => w.groups.forEach((g) => w.rewind(g.id, 0)) }]);
    $('page').scrollTop = 0;
  }
  function slider(name, o) {
    const i = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': name, oninput: () => o.set(+i.value) }), out = h('output');
    sb.upd.push(() => { const v = o.get(); if (+i.value !== v) i.value = v; out.textContent = o.show(v); });
    return h('div', { class: 'row' }, h('span', { class: 'nm' }, name), i, out);
  }
  function stepper(d) { const c = control(d, w, () => S.v); sb.upd.push(c.update); return h('div', { class: 'row' }, c.el); }
  function seg(name, list, get, set) {
    const bs = list.map(([v, t]) => h('button', { type: 'button', onclick: () => { set(v); sb.upd.forEach((f) => f()); } }, t));
    sb.upd.push(() => bs.forEach((b, i) => { b.classList.toggle('on', get() === list[i][0]); b.setAttribute('aria-pressed', get() === list[i][0]); }));
    return h('div', { class: 'row' }, name ? h('span', { class: 'nm' }, name) : null, h('div', { class: 'seg' }, bs));
  }
  function drawSandbox() {
    sb.upd = [];
    const diag = h('div', { class: 'diag', 'aria-live': 'polite' }, h('b'), h('p'));
    sb.upd.push(() => { const [c, t, p] = diagnose(); const cl = 'diag ' + c; if (diag.className !== cl) diag.className = cl; if (diag.firstChild.textContent !== t) diag.firstChild.textContent = t; if (diag.lastChild.textContent !== p) diag.lastChild.textContent = p; });
    const groups = w.groups.map((g) => h('div', { class: 'gcard', style: `--c:${g.color}` }, h('header', {}, `Группа «${g.name}»`, w.groups.length > 1 ? h('button', { class: 'link', type: 'button', onclick: () => { w.removeGroup(g.id); if (sb.termGroup === g.id) sb.termGroup = w.groups[0].id; drawSandbox(); } }, 'убрать') : null),
      stepper({ t: 'cons', gid: g.id, max: 8, min: 0 }), slider('Скорость одного', { min: 0.4, max: 6, step: 0.2, get: () => g.speed, set: (v) => { g.speed = v; }, show: (v) => num(v) + '/с' })));
    const keyNote = h('p', { class: 'muted' }); sb.upd.push(() => { if (keyNote.textContent !== KEYTXT[w.keyMode]) keyNote.textContent = KEYTXT[w.keyMode]; });
    const free = Object.keys(K.GROUPS).filter((id) => !w.group(id));
    $('page').replaceChildren(h('div', { class: 'sb' },
      h('div', { class: 'step-head' }, h('div', { class: 'step-num' }, '∞'), h('div', {}, h('h1', {}, 'Песочница'))),
      h('p', { class: 'muted' }, 'Здесь можно крутить что угодно и смотреть, что выйдет. Сломать ничего нельзя. Ниже живой диагноз: что сейчас происходит и что с этим делать.'),
      diag,
      h('h2', {}, 'Готовые ситуации'),
      h('div', { class: 'presets' }, Object.keys(PRE).map((id) => h('button', { type: 'button', class: sb.preset === id ? 'on' : '', onclick: () => loadPreset(id) }, PRE[id][0]))),
      h('p', { class: 'muted', style: 'margin-top:8px' }, PRE[sb.preset][1]),
      h('p', { class: 'muted' }, h('b', {}, 'Попробуй: '), PRE[sb.preset][3]),
      h('h2', {}, 'Кто пишет'),
      h('p', { class: 'muted' }, 'Скорость записи это общая нагрузка на топик. Несколько producer делят её поровну.'),
      slider('Скорость записи', { min: 0, max: 20, step: 0.5, get: () => w.producers.reduce((s, p) => s + p.rate, 0), set: (v) => w.producers.forEach((p) => { p.rate = v / w.producers.length; }), show: (v) => num(v) + '/с' }),
      seg('Producer', [[1, '1'], [2, '2'], [3, '3']], () => w.producers.length, (n) => { const r = w.producers.reduce((s, p) => s + p.rate, 0), D = [['site', 'Сайт', 'kiosk', '#e2503f'], ['app', 'Приложение', 'kiosk', '#4c9fe0'], ['jm', 'JMeter', 'jmeter', '#e2503f']]; w.producers = w.producers.slice(0, n); while (w.producers.length < n) { const q = D[w.producers.length]; w.addProducer({ id: q[0], name: q[1], kind: q[2], color: q[3] }); } w.producers.forEach((p) => { p.rate = r / n; }); }),
      seg('Ключ', [['none', 'нет, по очереди'], ['sticky', 'нет, пачками'], ['keys', 'по клиенту'], ['hot', 'один горячий']], () => w.keyMode, (v) => { w.keyMode = v; }),
      keyNote,
      h('h2', {}, 'Топик'),
      h('p', { class: 'muted' }, 'Партиции можно только добавлять, уменьшить их число Kafka не умеет. Срок хранения решает, когда сообщения удалят, прочитаны они или нет.'),
      stepper({ t: 'parts', max: 8 }),
      h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => { const t = w.topic(); t.parts = []; t.stick = null; t.rr = 0; w.flights = []; w.fx = []; w.timers = []; t.parts.push(w._part(t, 0)); w.groups.forEach((g) => { g.offsets = { 0: 0 }; w.rebalance(g); }); w.say('Топик создан заново: одна партиция, сообщений нет.'); } }, 'Пересоздать топик с одной партицией')),
      seg('Хранить', [[8, '8 с'], [20, '20 с'], [60, '60 с'], [Infinity, 'долго']], () => w.topic().retention, (v) => { w.topic().retention = v; }),
      seg('Потолок брокера', [[Infinity, 'нет'], [8, '8/с'], [5, '5/с'], [3, '3/с']], () => w.brokerCap, (v) => w.setBrokerCap(v)),
      h('p', { class: 'muted' }, 'Сколько сообщений в секунду брокер успевает записать. Если просят больше, сообщения встают в очередь и растёт время записи (ack).'),
      h('h2', {}, 'Кто читает'),
      h('p', { class: 'muted' }, 'Потолок чтения группы это число работающих consumer, умноженное на скорость одного. Работает не больше одного consumer на партицию.'),
      ...groups,
      free.length ? seg('Новая группа читает', [['earliest', 'с начала'], ['latest', 'только новое']], () => sb.from, (v) => { sb.from = v; }) : null,
      free.length ? h('p', { class: 'muted' }, 'В настоящей Kafka по умолчанию «только новое» (auto.offset.reset=latest).') : null,
      free.length ? h('div', { class: 'row' }, free.map((id) => h('button', { class: 'btn ghost', type: 'button', onclick: () => { w.addGroup({ id, n: 1, speed: 2, from: sb.from }); drawSandbox(); } }, '+ группа «' + K.GROUPS[id].name + '»'))) : null,
      h('h2', {}, 'Приборы'),
      seg('', [['charts', 'Графики'], ['term', 'Консоль'], ['none', 'Скрыть']], () => sb.view, (v) => { sb.view = v; }),
      w.groups.length > 1 ? seg('Группа в консоли', w.groups.map((g) => [g.id, g.name]), () => sb.termGroup, (v) => { sb.termGroup = v; }) : null,
      h('p', { class: 'muted', style: 'margin-top:14px' }, 'Схему можно крутить мышкой, приближать колёсиком, а флажки таскать. Роботы выключаются кликом.')));
    sb.upd.forEach((f) => f());
  }
  function diagnose() {
    const g = g0(); if (!g) return ['warn', 'Читать некому', 'Добавь группу читателей.'];
    const t = w.topic(g.topicId), inR0 = w.producers.reduce((s, p) => s + p.rate, 0), inR = Math.min(inR0, w.brokerCap), P0 = t.parts.length, live = g.consumers.filter((c) => c.on).length, act = w.activeCount(g), cap = w.capacity(g), lag = w.lag(g), idle = w.idleCount(g);
    const lags = t.parts.map((p) => w.partLag(g, p)), mx = Math.max(...lags), hotI = lags.indexOf(mx);
    const msg = (n) => `${n} ${pl(n, 'сообщение', 'сообщения', 'сообщений')}`;
    if (!live) return ['bad', 'Читать некому', `В группе «${g.name}» нет живых consumer. Lag растёт на ${num(inR)} в секунду, но сообщения не теряются, пока не вышел срок хранения.`];
    if (g.deadUntil) { const st = g.consumers.filter((c) => !c.on && c.assigned.length).flatMap((c) => c.assigned.map((i) => 'P' + i)); if (st.length) return ['bad', 'Consumer пропал', `Группа этого ещё не заметила. ${st.length > 1 ? 'Партиции' : 'Партицию'} ${st.join(', ')} никто не читает, lag там растёт. Скоро будет rebalance.`]; }
    if (g.rebUntil) return ['warn', 'Rebalance', 'Группа делит партиции заново. На это время чтение замерло.'];
    const capB = w.brokerCap;
    if (isFinite(capB) && (inR0 > capB + 0.05 || w.waiting().length > 5)) return ['bad', inR0 > capB + 0.05 ? 'Упёрся брокер: растёт ack' : 'Брокер разгребает очередь', `Просят записать ${num(inR0)} в секунду, брокер успевает ${num(capB)}. В очереди ${msg(w.waiting().length)}, время записи уже ${num(w.ackNow() || 0)} с. Читатели ни при чём: lag ${lag}. Помогут более быстрые диски и сеть, ещё брокеры или меньше нагрузки.`];
    if (w.keyMode === 'hot' && mx > 8 && mx > lag * 0.6) return ['bad', `Перекос: почти всё падает в P${hotI}`, 'Одинаковый ключ шлёт сообщения в одну партицию. Её читает один consumer, остальные скучают. Добавление читателей не поможет, дело в ключе.'];
    if (inR > cap + 0.05) {
      const d = inR - cap, fix = live < P0 ? `Партиций ${P0}, а читателей ${live}: добавь consumer.` : `Consumer уже не меньше, чем партиций (${P0}). Добавь партиции и consumer или ускорь обработку.`;
      return ['bad', `Не успеваем: lag растёт на ${num(d)} в секунду`, `Пишут ${num(inR)}, потолок чтения ${num(cap)}. Через минуту lag будет около ${Math.round(lag + d * 60)}. ${fix}`];
    }
    const uneven = mx > 12 && g.consumers.some((c) => c.on && c.assigned.length > 1) && g.consumers.some((c) => c.on && c.assigned.length < Math.max(...g.consumers.map((x) => x.assigned.length)));
    if (uneven) return ['warn', `Копится в P${hotI}`, 'В сумме мощности хватает, но партиции поделены неровно: кому-то досталось больше работы.'];
    if (lag > 8) { const s = lag / Math.max(0.1, cap - inR); return ['warn', 'Догоняем', cap - inR < 0.15 ? `Читаем ровно с той же скоростью, что пишут. Lag ${lag} так и останется.` : `Осталось ${msg(lag)}. При запасе ${num(cap - inR)} в секунду это примерно ${Math.round(s)} с.`]; }
    if (idle) return ['warn', `${idle} consumer ${pl(idle, 'спит', 'спят', 'спят')}`, `Партиций ${P0}, работает ${act}. Лишним просто нечего читать.`];
    return ['', 'Всё спокойно', `Пишут ${num(inR)}, читать могут ${num(cap)} в секунду. Запас есть, lag около нуля.`];
  }

  /* ---------- шпаргалка ---------- */
  function openSheet() {
    const order = ['kafka', 'broker', 'topic', 'partition', 'log', 'end', 'offset', 'producer', 'consumer', 'group', 'commit', 'retention', 'lag', 'key', 'ack', 'callback', 'e2e', 'stamp', 'rebalance'];
    $('sheet').replaceChildren(h('div', { class: 'sheet-in' },
      h('header', {}, h('h1', {}, 'Шпаргалка по Kafka'), h('button', { class: 'btn ghost', type: 'button', onclick: () => $('sheet').close() }, 'Закрыть')),
      h('h2', {}, 'Слова'), h('dl', {}, order.flatMap((id) => [h('dt', {}, K.TERMS[id][0]), h('dd', {}, K.TERMS[id][1])])),
      h('h2', {}, 'Готовые фразы'), h('ul', {}, LV.flatMap((l) => l.beats.filter((b) => b.say).map((b) => h('li', {}, b.say)))),
      h('h2', {}, 'Формулы на салфетке'), h('ul', {}, ['конец лога = номер последнего сообщения + 1', 'lag партиции = конец лога − закладка', 'lag группы = сумма по её партициям', 'работающих consumer = меньшее из (партиций, consumer)', 'потолок чтения = работающих × скорость одного', 'ждать новому сообщению ≈ lag / скорость чтения', 'время до нуля ≈ lag / (читаем − пишем)', 'весь путь = время конца обработки − sentAt', 'поток с .get() шлёт ≈ 1 / ack сообщений в секунду'].map((t) => h('li', { html: fmt('`' + t + '`') }))),
      h('h2', {}, 'Что смотреть на нагрузке'), h('ul', {}, ['Скорость записи: сколько сообщений в секунду реально попадает в топик.', 'Скорость чтения каждой группы. Упёрлась и не растёт: это полка.', 'Consumer lag по группам и по партициям. Растёт на ровной нагрузке: не справляемся.', 'Время записи (ack) и ресурсы брокеров: диск, сеть, CPU. Ack вырос: упирается запись. Lag вырос: упирается чтение.', 'Перекос по партициям: если lag только в одной, проверь ключ.', 'Время всего пути: метка sentAt в сообщении, или сводим по ID время отправки из JMeter и время обработки из логов либо базы сервиса.'].map((t) => h('li', {}, t))),
      h('h2', {}, 'Где симулятор упрощает'), h('ul', {}, ['Время растянуто до секунд. В жизни запись и ack занимают миллисекунды.', 'Consumer берёт по одному сообщению. Настоящий забирает пачками, по умолчанию до 500.', 'Закладка сдвигается после каждого сообщения. По умолчанию Kafka сохраняет её раз в 5 секунд, поэтому после падения бывают повторы.', 'Пропавшего читателя замечают через 2,5 секунды. В жизни по умолчанию до 45.', 'Без ключа сообщения кладутся по очереди. Настоящий producer кладёт пачками (в песочнице есть такой режим).', 'Группы читают с начала. По умолчанию новая группа видит только новое.', 'Просроченное удаляется поштучно. В жизни целыми кусками лога.', 'О новых партициях узнают сразу. В жизни до 5 минут.', 'Потолок брокера задан одним числом. В жизни это диск, сеть, CPU и ожидание копий на других брокерах.', 'Выбор партиции по ключу и раздача партиций внутри группы такие же, как в настоящей Kafka: сверено с Java-клиентом 3.9.2.'].map((t) => h('li', {}, t))),
      h('h2', {}, 'Если спросят лишнее'), h('p', {}, 'Настройка кластера, ZooKeeper и KRaft, тонкие параметры, внутренности репликации, транзакции, Kafka Streams. Нормальный ответ: «Это не разбирал, смотрел Kafka со стороны нагрузки».')));
    $('sheet').showModal();
  }

  /* ---------- кнопки ---------- */
  function setPause(v) { paused = v; $('btnPause').textContent = v ? 'Пуск' : 'Пауза'; $('btnPause').classList.toggle('on', v); }
  $('btnPause').onclick = () => setPause(!paused);
  document.querySelectorAll('#timectl [data-speed]').forEach((b) => { b.onclick = () => { speed = +b.dataset.speed; document.querySelectorAll('#timectl [data-speed]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('btnCam').onclick = () => scene.resetCam();
  function setView(v) {
    if (!scenes[v]) return;
    if (v !== view) { scenes[v].clear(); P.view = v; store.save(P); }
    view = v; scene = scenes[v]; $('tip').hidden = true;
    $('gl').hidden = $('labels').hidden = v !== '3d'; $('c2d').hidden = v !== '2d';
    $('stage').classList.toggle('flat', v === '2d');
    document.querySelectorAll('#viewctl button').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-pressed', b.dataset.view === v); });
    slowTick();
  }
  document.querySelectorAll('#viewctl button').forEach((b) => { b.disabled = !scenes[b.dataset.view]; if (b.disabled) b.title = 'Браузер не включил WebGL2, 3D недоступно'; b.onclick = () => setView(b.dataset.view); });
  $('btnRestart').onclick = () => (S.mode === 'sandbox' ? loadPreset(sb.preset) : goLevel(S.lvl));
  $('goSandbox').onclick = () => goSandbox(); $('goSheet').onclick = openSheet; $('home').onclick = () => goLevel(0);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').close(); });

  /* ---------- главный цикл ---------- */
  function beatTick() {
    if (S.mode !== 'level') return; const b = beatDef(); if (!b) return;
    if (b.tick) b.tick(w, S.v); if (S.tick) S.tick();
    if (!S.passed && b.check && b.check(w, S.v)) pass();
  }
  let last = performance.now(), slow = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    w.scale = speed; if (!paused) { w.step(dt); beatTick(); }
    scene.draw(dt);
    slow += dt; if (slow > 0.12) { slow = 0; slowTick(); }
    requestAnimationFrame(frame);
  }
  function slowTick() {
    drawHud(); S.ctls.forEach((c) => c.update());
    if (S.mode === 'sandbox') { const a = document.activeElement; sb.upd.forEach((f) => f(a)); }
    else { const b = beatDef(), el = $('hint'); if (el && b && b.hintLive && !S.passed) { const t = b.hintLive(w, S.v) || b.hint || ''; if (el.textContent !== t) el.textContent = t; } }
    {
      const top = $('top').offsetHeight, dock = $('dock').offsetHeight;
      scene.inset.t = top + 34; scene.inset.r = w.sync || !w.groups.length ? 24 : innerWidth < 900 ? 90 : 185; scene.inset.b = Math.max(dock, 34) + (innerWidth <= 1400 ? 78 : 42);
      const H = $('stage').clientHeight; scene.inset.t = Math.min(scene.inset.t, H * 0.34); scene.inset.b = Math.min(scene.inset.b, H * 0.27);
      $('feed').style.bottom = (dock + (innerWidth <= 1400 ? 78 : 30)) + 'px';
    }
  }
  K.app = { w, get scene() { return scene; }, setView, S, P, goLevel, goBeat, next, pass, goSandbox, loadPreset, LV, diagnose, adv(sec) { for (let t = 0; t < sec; t += 0.05) { w.scale = 1; w.step(0.05); beatTick(); } slowTick(); } };

  drawTrack(); setView(view);
  const m = /^#(\d+)$/.exec(location.hash);
  if (location.hash === '#sandbox') goSandbox(); else goLevel(m ? Math.min(LV.length, Math.max(1, +m[1])) - 1 : Math.min(P.lvl || 0, LV.length - 1));
  requestAnimationFrame(frame);
})();
