/* Особые задания: способы подачи нагрузки, сборка скрипта, выбор графика, метка времени, поиск по ID, босс, мини-собес. */
(function () {
  'use strict';
  const K = window.K, { h, svg, fmt, num } = K;
  const C = (K.CUSTOM = {});

  /* ---------- два способа ---------- */
  C.ways = (el, api) => {
    const seen = new Set(), hint = h('p', { class: 'muted' }, 'Нажми на карточку, чтобы раскрыть.');
    const card = (id, title, tag, html) => {
      const body = h('div', { class: 'in', hidden: true, html });
      const box = h('div', { class: 'way' }, h('button', { type: 'button', 'aria-expanded': 'false', onclick: (e) => {
        body.hidden = !body.hidden; box.classList.toggle('open', !body.hidden); e.currentTarget.setAttribute('aria-expanded', !body.hidden); seen.add(id); if (seen.size === 2) api.pass(); else if (!body.hidden) hint.textContent = 'Теперь открой второй способ.';
      } }, title, h('span', {}, tag)), body);
      return box;
    };
    el.append(hint, h('div', { class: 'ways' },
      card('p', 'Плагин', 'быстро и без кода', fmt('<p>Например, **Pepper-Box** или **KafkaMeter**. Готовый плагин кладут в папку `lib/ext` и перезапускают JMeter. В тест-плане появляется Kafka-сэмплер.</p><p>В его полях указывают адрес брокера, имя топика, ключ и шаблон сообщения. Код писать не нужно.</p><p>**Плюсы:** быстрый старт, понятно без программирования.</p><p>**Минусы:** меньше свободы, плагины обновляются редко и могут не подойти к твоей версии Kafka. Эти два умеют только писать, читателя делают отдельно.</p>')),
      card('j', 'JSR223 + Java-клиент', 'полный контроль', fmt('<p>Берут официальную библиотеку `kafka-clients.jar` (и её зависимости), кладут в папку `lib`, перезапускают JMeter. Дальше пишут код в **JSR223 Sampler** на Groovy.</p><p>Синтаксис почти как в Java, поэтому примеры с Java-кодом работают почти без изменений.</p><p>**Плюсы:** любой формат сообщения, свои ключи, метка времени внутри, можно написать и читателя.</p><p>**Минусы:** код надо написать и отладить самому.</p>'))));
  };

  /* ---------- сборка скрипта ---------- */
  const LINES = [
    ['cfg.put("bootstrap.servers", "kafka:9092")', 'Говорим, по какому адресу живёт брокер', 'broker'],
    ['def producer = new KafkaProducer(cfg)', 'Создаём producer, он подключается к брокеру', 'producer'],
    ['def rec = new ProducerRecord("orders", key, json)', 'Собираем сообщение: топик, ключ, содержимое', 'topic'],
    ['producer.send(rec).get()', 'Отправляем и ждём ack. Это время и покажет сэмплер', 'partition'],
    ['producer.close()', 'В самом конце теста закрываем соединение', 'producer'],
  ];
  const FULL = `<span class="cm">// setUp Thread Group: один раз до теста</span>
import org.apache.kafka.clients.producer.*

def cfg = new Properties()
cfg.put("bootstrap.servers", "kafka:9092")
def ser = "org.apache.kafka.common.serialization.StringSerializer"
cfg.put("key.serializer", ser)
cfg.put("value.serializer", ser)
props.put("producer", new KafkaProducer(cfg))

<span class="cm">// основной JSR223 Sampler: на каждое сообщение</span>
import org.apache.kafka.clients.producer.*

def key  = "client-" + vars.get("clientId")
def json = '{"sentAt":' + System.currentTimeMillis() + '}'
def rec  = new ProducerRecord("orders", key, json)
props.get("producer").send(rec).get()

<span class="cm">// tearDown Thread Group: один раз после теста</span>
props.get("producer").close()`;
  C.code = (el, api) => {
    let i = 0;
    const slots = h('div', { class: 'slots' }, h('div', { class: 'empty' }, 'Скрипт пока пустой')), pool = h('div', { class: 'pool' }), note = h('p', { class: 'why no', hidden: true });
    const order = [2, 4, 0, 3, 1];
    order.forEach((k) => {
      const b = h('button', { type: 'button', onclick: () => {
        if (k !== i) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); note.hidden = false; note.textContent = ['Рано. Сначала скажи, к кому подключаемся.', 'Рано. Адрес есть, но отправлять пока некому.', 'Рано. Отправлять пока нечего: сообщение не собрано.', 'Рано. Сообщение готово, но ещё не отправлено.', 'Осталась последняя строчка.'][i]; return; }
        note.hidden = true; if (i === 0) slots.replaceChildren();
        slots.append(h('div', { class: 'ln' }, LINES[k][0], h('small', {}, LINES[k][1]))); b.remove(); i++;
        api.flash(LINES[k][2]); if (k === 3) api.w.send('jm');
        if (i === LINES.length) { pool.remove(); el.append(h('p', { html: fmt('Готово. Так это выглядит в JMeter целиком. Код разложен по трём местам: **setUp Thread Group** один раз создаёт producer, **основной сэмплер** отправляет сообщения, **tearDown Thread Group** закрывает соединение.') }), h('div', { class: 'code', html: FULL }), h('ul', { class: 'notes' }, [
          'Producer создают один раз на весь тест и кладут в `props`, оттуда его берут все потоки. Если создавать его на каждое сообщение, замерим создание, а не Kafka.',
          'Сериализаторы превращают ключ и текст в байты: Kafka хранит только байты.',
          '`vars.get("clientId")` это переменная JMeter, например из CSV. Ключи должны быть разными, иначе всё упадёт в одну партицию.',
          '`sentAt` это поле, которое мы придумали сами: время отправки в миллисекундах. Зачем оно нужно, разберём в ступени 10.',
          '`.get()` ждёт ack. Без него `send()` только складывает сообщение в буфер и возвращается сразу, сэмплер покажет почти ноль. Цену ожидания разберём на следующем шаге.',
          '`kafka:9092` замени на адрес своего брокера.',
        ].map((t) => h('li', { html: fmt(t) })))); api.pass(); }
      } }, LINES[k][0]);
      pool.append(b);
    });
    el.append(slots, pool, note);
  };

  /* ---------- выбери график ---------- */
  C.pickChart = (el, api) => {
    const G = [
      ['А', 'M2 52 L14 50 L26 53 L38 49 L50 52 L62 50 L74 53 L86 50 L98 52', 'Lag всё время около нуля. Система успевает.'],
      ['Б', 'M2 52 L24 52 L34 30 L46 14 L56 18 L70 40 L80 51 L98 52', 'Был пик, потом догнали. Запас есть.'],
      ['В', 'M2 52 L20 49 L36 40 L52 31 L68 22 L84 13 L98 5', 'Lag растёт и не останавливается. Не справляется.'],
    ];
    const why = h('p', { class: 'why', hidden: true });
    const row = h('div', { class: 'graphs' }, G.map((g, i) => {
      const s = svg('svg', { viewBox: '0 0 100 58', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'График ' + g[0] }, svg('line', { x1: 0, x2: 100, y1: 55, y2: 55, stroke: '#c3cbc5', 'vector-effect': 'non-scaling-stroke' }), svg('path', { d: g[1], fill: 'none', stroke: '#b07400', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
      const b = h('button', { type: 'button', onclick: () => {
        b.classList.add(i === 2 ? 'ok' : 'no'); why.hidden = false; why.className = 'why' + (i === 2 ? '' : ' no'); why.textContent = `График ${g[0]}. ${g[2]}`;
        if (i === 2) { row.querySelectorAll('button').forEach((x) => { x.disabled = true; }); api.pass(); }
      } }, s, g[0]);
      return b;
    }));
    el.append(row, why);
  };

  /* ---------- метка времени: живой расчёт ---------- */
  C.stamp = (el, api) => {
    const a = h('dd', {}, ''), b = h('dd', {}, ''), c = h('dd', { class: 'big' }, ''), head = h('b', {}, ''), empty = h('p', { class: 'muted' }, '');
    const dl = h('dl', {}, h('dt', {}, 'Кухня закончила, это «сейчас»'), b, h('dt', {}, 'Внутри сообщения sentAt'), a, h('dt', {}, 'Сейчас минус sentAt'), c);
    el.append(h('div', { class: 'slip' }, head, empty, dl));
    let key = null;
    const draw = () => {
      const v = api.v, x = v.last, k = `${!!v.stamp} ${x ? x.off : ''}`; if (k === key) return; key = k;
      dl.hidden = !x; empty.hidden = !!x;
      head.textContent = x ? `Готов заказ из посылки ${x.off}` : 'Расчёт кухни';
      empty.textContent = v.stamp ? 'Метка есть. Ждём, пока кухня закончит первый заказ с ней.' : 'В сообщении нет времени отправки, вычитать нечего.';
      if (x) { const s = Math.round(x.sent * 10) / 10, d = Math.round((x.sent + x.e2e) * 10) / 10; a.textContent = K.clock(s); b.textContent = K.clock(d); c.textContent = num(d - s) + ' с'; }
    };
    draw(); api.setTick(draw);
  };

  /* ---------- поиск по ID ---------- */
  const SENT = [['1041', 4], ['1042', 5], ['1043', 5.5]];
  const LOGS = [[4.6, '1040', 'готов'], [4.9, '1041', 'взят в работу'], [6, '1041', 'готов'], [6.1, '1042', 'взят в работу'], [9.5, '1042', 'готов'], [9.6, '1043', 'взят в работу'], [13.5, '1043', 'готов']];
  const JM = `<span class="cm">// JSR223 Sampler, перед send</span>
def id  = UUID.randomUUID().toString()
def now = System.currentTimeMillis()
vars.put("orderId", id)
vars.put("sentAt", "" + now)
def json = '{"orderId":"' + id + '"}'

<span class="cm"># файл user.properties в папке bin</span>
sample_variables=orderId,sentAt`;
  const HOW = [
    '**Номер** придумывает сам JMeter. `UUID` это случайный номер, который не повторяется. Он лежит и в сообщении, и в переменной `orderId`.',
    '**Время отправки.** Строка `sample_variables` просит JMeter дописать переменные `orderId` и `sentAt` отдельными столбцами в файл результатов (`.jtl`). После правки `user.properties` JMeter перезапускают.',
    '**Время обработки в логах.** Ищут строку с этим номером: поиском по файлу или в системе, куда собирают логи.',
    '**Время обработки в базе.** Если сервис хранит заказы в таблице, берут столбец со временем: `SELECT order_id, done_at FROM orders`. Как он называется у вас, спроси у разработчиков.',
    '**Сводят после теста и сразу все номера:** скриптом, SQL или функцией ВПР в Excel. Потом считают среднее и перцентили, как для обычного времени отклика.',
  ];
  C.match = (el, api) => {
    let i = 0; const why = h('p', { class: 'why no', hidden: true });
    const cells = SENT.map(([id, t]) => { const done = h('td', {}, '?'), path = h('td', {}, '?'); return { done, path, tr: h('tr', {}, h('td', {}, id), h('td', {}, K.clock(t)), done, path) }; });
    const mark = () => cells.forEach((c, k) => { c.tr.className = k < i ? 'ok' : k === i ? 'cur' : ''; });
    const tbl = h('table', { class: 'match' }, h('thead', {}, h('tr', {}, ['Заказ', 'Отправлен', 'Готов', 'Весь путь'].map((x) => h('th', {}, x)))), h('tbody', {}, cells.map((c) => c.tr)));
    const lines = LOGS.map(([t, id, what]) => {
      const b = h('button', { type: 'button', onclick: () => {
        const need = SENT[i]; if (!need) return;
        if (id !== need[0] || what !== 'готов') {
          b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); why.hidden = false;
          why.textContent = id !== need[0] ? `Это заказ ${id}, а сейчас ищем ${need[0]}. Сводим только по одинаковому номеру.` : 'Номер верный, но здесь заказ только взяли в работу. Нам нужен конец обработки: «готов».'; return;
        }
        why.hidden = true; b.classList.add('ok'); b.disabled = true; cells[i].done.textContent = K.clock(t); cells[i].path.textContent = num(t - need[1]) + ' с'; i++; mark();
        if (i === SENT.length) {
          lines.forEach((x) => { x.disabled = true; });
          const all = SENT.map(([n, t0]) => LOGS.find((x) => x[1] === n && x[2] === 'готов')[0] - t0);
          const sum = h('p', { class: 'why' }, `Свёл. Средний путь ${num(all.reduce((x, y) => x + y, 0) / all.length)} с, худший ${num(Math.max(...all))} с. На тесте таких строк тысячи, поэтому сводит их не человек, а скрипт.`);
          el.append(sum, h('p', { class: 'cap' }, 'Как это выглядит в жизни'), h('div', { class: 'code', html: JM }), h('ul', { class: 'notes' }, HOW.map((x) => h('li', { html: fmt(x) }))));
          api.pass(); sum.scrollIntoView({ block: 'start', behavior: 'smooth' }); // иначе экран уедет к кнопке мимо объяснения
        }
      } }, `${K.clock(t)}  заказ ${id} ${what}`);
      return b;
    });
    mark();
    el.append(h('p', { class: 'cap' }, 'Что записал JMeter при отправке'), tbl, h('p', { class: 'cap' }, 'Лог сервиса «Кухня». Нажми на нужную строку'), h('div', { class: 'loglines' }, lines), why);
  };

  /* ---------- босс ---------- */
  const PROF = [[0, 2], [12, 5], [30, 8], [50, 4], [62, 2], [80, 0]], LEN = 80, LIMIT = 60, BUDGET = 380;
  C.boss = (el, api) => {
    const w = api.w; let run = null;
    const X = (t) => 4 + t / LEN * 292, Y = (r) => 78 - r / 8 * 66;
    let d = ''; PROF.forEach(([t, r], i) => { d += i ? `H${X(t)}V${Y(r)}` : `M${X(t)} ${Y(r)}`; });
    const cur = svg('line', { x1: 4, x2: 4, y1: 4, y2: 78, stroke: '#14302d', 'stroke-width': 2 });
    const tx = (x, y, s, a) => { const t = svg('text', { x, y, 'font-size': 11, fill: '#4b645f', 'text-anchor': a || 'middle' }); t.textContent = s; return t; };
    const chart = svg('svg', { viewBox: '0 0 300 92', role: 'img', 'aria-label': 'План нагрузки на смену' }, svg('line', { x1: 4, x2: 296, y1: 78, y2: 78, stroke: '#c3cbc5' }), svg('path', { d: d + 'H4Z', fill: '#1f7fd1', 'fill-opacity': 0.1 }), svg('path', { d, fill: 'none', stroke: '#1f7fd1', 'stroke-width': 2 }),
      tx(X(6), Y(2) - 5, '2/с'), tx(X(21), Y(5) - 5, '5/с'), tx(X(40), Y(8) - 4, '8/с'), tx(X(56), Y(4) - 5, '4/с'), tx(X(71), Y(2) - 5, '2/с'), tx(4, 90, '0 с', 'start'), tx(296, 90, '80 с', 'end'), cur);
    const dMax = h('dd', {}, '0'), dCost = h('dd', {}, '0 из ' + BUDGET), alarm = h('p', { class: 'alarm', hidden: true }), res = h('div');
    const go = h('button', { class: 'btn go', type: 'button', onclick: start }, 'Начать смену');
    el.append(alarm, go, h('div', { class: 'bossbox' }, h('b', {}, 'План нагрузки'), chart, h('dl', {}, h('dt', {}, 'Худший lag за смену (предел 60)'), dMax, h('dt', {}, 'Потрачено робото-секунд'), dCost)), res);
    function start() {
      res.replaceChildren(); api.restart(); run = { t0: w.t, max: 0, cost: 0, killed: false, last: w.t }; go.hidden = true; alarm.hidden = true; api.setTick(tick);
      w.say('Смена началась. Следи за потоком.');
    }
    function tick() {
      if (!run) return;
      const t = w.t - run.t0, g = w.group('kitchen'), p = w.producer(), dt = w.t - run.last; run.last = w.t;
      let r = 0; PROF.forEach(([a, x]) => { if (t >= a) r = x; }); p.rate = r;
      const lag = w.lag(g); run.max = Math.max(run.max, lag); run.cost += g.consumers.filter((c) => c.on).length * dt;
      cur.setAttribute('x1', X(Math.min(t, LEN))); cur.setAttribute('x2', X(Math.min(t, LEN)));
      dMax.textContent = run.max; dCost.textContent = `${Math.round(run.cost)} из ${BUDGET}`;
      if (!run.killed && t > 38) { run.killed = true; const c = g.consumers.find((x) => x.on && x.assigned.length); if (c) { w.toggleConsumer(c.id, false); run.vic = c.id; alarm.hidden = false; alarm.textContent = `Авария: consumer ${c.num} упал! Кликни по нему на схеме, чтобы поднять.`; } }
      if (run.vic) { const c = w.consumer(run.vic); if (!c || c.on) { alarm.hidden = true; run.vic = null; } }
      if (lag > LIMIT) return end(false, 'Lag перевалил за 60. Заказы встали, клиенты злятся.');
      if (t >= LEN) return end(lag <= 5, lag <= 5 ? '' : `К концу смены осталось ${lag} непрочитанных. Нужно не больше 5.`);
    }
    function end(ok, why) {
      const x = run; run = null; api.setTick(null); w.producer().rate = 0; go.hidden = false; go.textContent = 'Ещё раз'; alarm.hidden = true;
      if (!ok) { res.replaceChildren(h('p', { class: 'why no' }, why + ' Как посчитать: на пике 8 в секунду, один робот делает 1,5, значит нужно 8 / 1,5 = 5,3, то есть 6 роботов. И столько же партиций, иначе лишние будут спать. Партиции добавь заранее: хвост в старых сам не разъедется.')); return; }
      const s = 1 + (x.max <= 40 ? 1 : 0) + (x.cost <= BUDGET ? 1 : 0);
      res.replaceChildren(h('div', { class: 'stars', 'aria-label': s + ' из 3' }, '★'.repeat(s), h('i', {}, '★'.repeat(3 - s))), h('p', {}, 'Смена выстояла.' + (x.max > 40 ? ' За вторую звезду: держи худший lag до 40.' : '') + (x.cost > BUDGET ? ` За звезду экономии: не держи лишних роботов, уложись в ${BUDGET}.` : '')));
      api.party(); api.pass();
    }
  };

  /* ---------- мини-собес ---------- */
  C.exam = (el, api) => {
    let i = 0, score = 0; const weak = new Set();
    const chat = h('div', { class: 'chat' }), box = h('div'); el.append(chat, box);
    const down = () => { const p = document.getElementById('page'); p.scrollTop = p.scrollHeight; };
    function ask() {
      const q = K.EXAM[i];
      chat.append(h('div', { class: 'msg him' }, h('small', {}, `Вопрос ${i + 1} из ${K.EXAM.length}`), q.q));
      box.replaceChildren(h('div', { class: 'opts' }, q.o.map((o, k) => h('button', { class: 'opt', type: 'button', onclick: () => answer(k) }, o))));
      down();
    }
    function answer(k) {
      const q = K.EXAM[i], ok = k === q.ok; if (ok) score++; else if (q.lvl !== null) weak.add(q.lvl);
      chat.append(h('div', { class: 'msg me' + (ok ? '' : ' no') }, q.o[k]), h('div', { class: 'msg note' + (ok ? '' : ' no') }, h('small', {}, ok ? 'Верно. Своими словами:' : 'Не то. Лучше так:'), q.say));
      if (q.demo) { q.demo(api.w); api.w.say('На схеме ответ вживую.'); }
      i++;
      box.replaceChildren(h('button', { class: 'btn go', type: 'button', onclick: i < K.EXAM.length ? ask : finish }, i < K.EXAM.length ? 'Следующий вопрос' : 'Итог'));
      down();
    }
    function finish() {
      const n = K.EXAM.length;
      box.replaceChildren(h('div', { class: 'score' }, `${score} / ${n}`),
        h('p', {}, score === n ? 'Без единой ошибки. Можно идти на собес.' : score >= n - 3 ? 'Хороший уровень. Подтяни мелочи и вперёд.' : 'Пройди ещё раз слабые места, это быстро.'),
        weak.size ? h('div', { class: 'opts' }, h('b', {}, 'Что повторить:'), [...weak].sort((a, b) => a - b).map((l) => h('button', { class: 'opt', type: 'button', onclick: () => api.goLevel(l) }, `${l + 1}. ${K.LEVELS[l].title}`))) : null,
        h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: () => api.goLevel(K.LEVELS.length - 1) }, 'Пройти заново'), h('button', { class: 'link', type: 'button', onclick: () => api.goSandbox() }, 'В песочницу')));
      if (score >= n - 3) { api.party(); api.markDone(); }
      down();
    }
    ask();
  };
})();
