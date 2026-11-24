/* JOSIE website behaviour. Without JavaScript every panel stays readable and every link works. */
(function () {
  'use strict';

  var RELEASE_AT = Date.parse('2026-12-01T00:00:00+01:00');   // launch: midnight Central European Time
  var RELEASES_URL = 'https://github.com/Goekdeniz-Guelmez/JOSIE-Voice/releases';
  var RELEASES_API = 'https://api.github.com/repos/Goekdeniz-Guelmez/JOSIE-Voice/releases?per_page=100';
  var TWEET_WIDGET = 'https://platform.x.com/widgets.js';
  // Scroll position (0..1) → hour of a midsummer day for the sky; labels feed the "Scroll the day" pill.
  var DAY = [[0, 'Morning', 8.5], [0.12, 'Midday', 13], [0.3, 'Golden hour', 19.6], [0.42, 'Sunset', 21.4], [0.55, 'Blue hour', 22.3], [0.7, 'Night', 23.4], [1, 'Night', 24.5]];
  // The scripted call and chat replies in the hero (the real app answers with your chosen model).
  var CALL = [
    [1800, { who: 'you', text: 'What’s the weather in Stuttgart tomorrow?' }, 'thinking'],
    [1300, { who: 'josie', text: 'Mostly cloudy with a high of 14 °C. Rain holds off until the evening.', tool: 'get weather', ms: '212 ms' }, 'speaking'],
    [3000, { who: 'you', text: 'Perfect. Remind me at eight to take an umbrella anyway.' }, 'thinking'],
    [1300, { who: 'josie', text: 'Done. You’ll get a reminder at 8:00 tomorrow morning.', tool: 'add reminder', ms: '186 ms' }, 'speaking'],
    [2800, null, 'listening']
  ];
  var PROMPTS = [
    ['What’s on tomorrow?', 'Stand-up at 9:30 and lunch with Sam at noon. The afternoon is free.', 'read calendar', '94 ms'],
    ['Text Alex I’m ten minutes late', 'Drafted in Messages. Tap Send when it looks right.', 'draft message', '120 ms'],
    ['Find a pharmacy that’s still open', 'Apotheke am Markt is open until 20:00, six minutes on foot.', 'search places', '340 ms']
  ];
  var STATUS = { idle: 'Tap Start call to talk', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };

  var root = document.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  // ---------- orbs (orb.js) ----------
  var orbs = $$('[data-orb]').map(function (wrap) {
    var orb = window.JosieOrb && window.JosieOrb.create($('canvas', wrap));
    if (orb) wrap.classList.add('is-gl');
    return { name: wrap.getAttribute('data-orb'), orb: orb };
  });
  var heroOrb = (orbs.filter(function (o) { return o.name === 'hero'; })[0] || {}).orb;

  // ---------- sky (sky.js), driven by the scroll ----------
  var skyEl = $('.sky'), scrimEl = $('.sky__scrim', skyEl);
  var sky = window.JosieSky && window.JosieSky.create($('canvas', skyEl), { hour: DAY[0][2] });
  var pill = $('[data-sky-pill]'), pillButtons = [];
  function progress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  function hourAt(p) {
    var i = 0;
    while (i < DAY.length - 2 && DAY[i + 1][0] <= p) i++;
    return DAY[i][2] + (DAY[i + 1][2] - DAY[i][2]) * (p - DAY[i][0]) / (DAY[i + 1][0] - DAY[i][0]);
  }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  if (pill) {
    DAY.slice(0, 6).forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = d[1];
      b.addEventListener('click', function () { window.scrollTo({ top: d[0] * (document.documentElement.scrollHeight - window.innerHeight), behavior: reduce ? 'auto' : 'smooth' }); });
      pill.appendChild(b);
      pillButtons.push(b);
    });
  }
  var skyQueued = false;
  function updateSky() {
    skyQueued = false;
    var p = progress(), hour = hourAt(p);
    if (sky) sky.setHour(hour);
    else if (window.JosieSky) {
      var c = window.JosieSky.stateAt(hour).palette, css = window.JosieSky.css;
      skyEl.style.background = 'linear-gradient(180deg, ' + css(c.zenith) + ', ' + css(c.mid) + ' 55%, ' + css(c.horizon) + ')';
    }
    // A light scrim keeps white text readable over the bright midday sky; it fades out again at night.
    scrimEl.style.setProperty('--scrim', (Math.min(0.42, p * 3.2) * (1 - 0.6 * smooth(0.55, 0.9, p))).toFixed(3));
    var current = 0;
    DAY.slice(0, 6).forEach(function (d, i) { if (d[0] <= p + 0.001) current = i; });
    pillButtons.forEach(function (b, i) { b.setAttribute('aria-current', String(i === current)); });
  }
  window.addEventListener('scroll', function () { if (!skyQueued) { skyQueued = true; requestAnimationFrame(updateSky); } }, { passive: true });
  window.addEventListener('resize', updateSky);
  updateSky();

  // ---------- the live app in the hero ----------
  var app = $('[data-app]');
  if (app) {
    var msgs = $('[data-msgs]', app), status = $('[data-status]', app), call = $('[data-call]', app), callLabel = $('[data-call-label]', app);
    var live = $('[data-live]', app), voice = $('[data-voice]', app), chat = $('[data-chat]', app), hint = $('[data-chat-hint]', app);
    var timers = [], inCall = false, mode = 'voice';
    $$('.wave span', app).forEach(function (s, i) {
      var c = 1 - Math.abs(i - 14) / 14;
      s.style.setProperty('--h', (c * c).toFixed(2));
      s.style.setProperty('--d', ((i * 0.07) % 0.9).toFixed(2) + 's');
    });
    function setPhase(phase) {
      status.textContent = STATUS[phase];
      if (heroOrb) heroOrb.setState(phase === 'idle' ? 'idle' : phase);
      if (sky) sky.setGlow(window.JosieOrb ? window.JosieOrb.glow(phase) : '#ffd2c2', phase === 'idle' ? 0.3 : 1);
    }
    function clear() { timers.forEach(clearTimeout); timers = []; msgs.innerHTML = ''; app.classList.remove('has-msgs'); }
    function add(m, keep) {
      var li = document.createElement('li');
      li.className = 'msg msg--' + m.who;
      if (m.who === 'josie') { var o = document.createElement('img'); o.src = 'logo.png'; o.alt = ''; li.appendChild(o); }
      var b = document.createElement('div');
      b.className = 'bubble bubble--' + m.who;
      if (m.tool) {
        var t = document.createElement('span');
        t.className = 'tool';
        t.innerHTML = '<svg viewBox="0 0 24 24" class="i i--check" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';
        t.appendChild(document.createTextNode(m.tool + ' '));
        var ms = document.createElement('span'); ms.textContent = m.ms; t.appendChild(ms);
        b.appendChild(t);
      }
      var p = document.createElement('p'); p.textContent = m.text; b.appendChild(p);
      li.appendChild(b);
      msgs.appendChild(li);
      while (msgs.children.length > keep) msgs.removeChild(msgs.firstChild);
      app.classList.add('has-msgs');
      hint.hidden = true;
    }
    function endCall() {
      inCall = false; clear();
      app.classList.remove('is-calling'); live.hidden = true;
      call.setAttribute('aria-label', 'Start call'); callLabel.textContent = 'Start call';
      setPhase('idle');
    }
    function startCall() {
      clear(); inCall = true;
      app.classList.add('is-calling'); live.hidden = false;
      call.setAttribute('aria-label', 'End call'); callLabel.textContent = 'End call';
      setPhase('listening');
      var at = 0;
      CALL.forEach(function (step) {
        at += step[0];
        timers.push(setTimeout(function () { if (step[1]) add(step[1], 2); setPhase(step[2]); }, at));
      });
    }
    call.addEventListener('click', function () { if (inCall) endCall(); else startCall(); });
    function setMode(next) {
      if (inCall) endCall();
      clear(); hint.hidden = false; mode = next;
      app.setAttribute('data-mode', next);
      voice.hidden = next !== 'voice'; chat.hidden = next !== 'chat';
      $$('[data-mode-tab]', app).forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-mode-tab') === next)); });
    }
    $$('[data-mode-tab]', app).forEach(function (t) { t.addEventListener('click', function () { setMode(t.getAttribute('data-mode-tab')); }); });
    function ask(text, reply, tool, ms) {
      add({ who: 'you', text: text }, 4);
      if (heroOrb) heroOrb.setState('thinking');
      timers.push(setTimeout(function () {
        add({ who: 'josie', text: reply, tool: tool, ms: ms }, 4);
        if (heroOrb) heroOrb.setState('idle');
      }, 900));
    }
    $$('[data-prompt]', app).forEach(function (b) {
      b.addEventListener('click', function () { var p = PROMPTS[+b.getAttribute('data-prompt')]; ask(p[0], p[1], p[2], p[3]); });
    });
    $('[data-composer]', app).addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('input', e.target), text = input.value.trim();
      if (!text) return;
      input.value = '';
      ask(text, 'Replies here are scripted. In the app, the model you chose answers.', '', '');
    });
  }

  // ---------- tabs: every [role=tablist] whose tabs control panels ----------
  $$('[role="tablist"]').forEach(function (list) {
    var tabs = $$(':scope > [role="tab"][aria-controls]', list);
    if (!tabs.length) return;
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });
    var vertical = list.getAttribute('aria-orientation') === 'vertical';
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        t.setAttribute('aria-selected', String(i === j));
        t.tabIndex = i === j ? 0 : -1;
        panels[j].hidden = i !== j;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (e) {
        var next = { ArrowRight: i + 1, ArrowDown: vertical ? i + 1 : null, ArrowLeft: i - 1, ArrowUp: vertical ? i - 1 : null, Home: 0, End: tabs.length - 1 }[e.key];
        if (next == null) return;
        e.preventDefault();
        select((next + tabs.length) % tabs.length, true);
      });
    });
    var start = tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; });
    select(start < 0 ? 0 : start, false);
  });

  // ---------- feature filter ----------
  var filters = $('[data-filters]');
  if (filters) {
    filters.hidden = false;
    var items = $$('[data-features] > li');
    $$('[data-filter]', filters).forEach(function (b) {
      b.addEventListener('click', function () {
        var cat = b.getAttribute('data-filter');
        $$('[data-filter]', filters).forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        items.forEach(function (li) { li.hidden = cat !== 'All' && li.getAttribute('data-cat') !== cat; });
      });
    });
  }

  // ---------- countdown + release dialog ----------
  function secondsLeft() { return Math.max(0, Math.floor((RELEASE_AT - Date.now()) / 1000)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  var units = {};
  $$('[data-unit]').forEach(function (el) { units[el.getAttribute('data-unit')] = el; });
  var shortCountdown = $('[data-countdown-short]');
  function tick() {
    var s = secondsLeft();
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (units.days) { units.days.textContent = pad(d); units.hours.textContent = pad(h); units.minutes.textContent = pad(m); units.seconds.textContent = pad(sec); }
    if (shortCountdown) shortCountdown.textContent = s ? 'Dec 1 · ' + d + 'd ' + pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's' : 'Out now';
  }
  tick();
  setInterval(tick, 1000);

  var dialog = $('[data-release]');
  var toast = document.getElementById('download-status');
  function announce(message, withLink) {
    toast.textContent = message;
    if (withLink) {
      var a = document.createElement('a');
      a.href = RELEASES_URL; a.textContent = 'View GitHub Releases ↗';
      toast.appendChild(a);
    }
    toast.hidden = false;
  }
  // After launch: resolve the newest Apple Silicon DMG on click, so a new release needs no site update.
  var busy = false;
  async function downloadLatest(buttons) {
    if (busy) return;
    busy = true;
    buttons.forEach(function (b) { b.setAttribute('aria-busy', 'true'); });
    announce('Finding the latest Mac download…');
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error('lookup failed');
      var releases = (await res.json()).filter(function (r) { return !r.draft && r.published_at; })
        .sort(function (a, b) { return Date.parse(b.published_at) - Date.parse(a.published_at); });
      var asset;
      for (var i = 0; i < releases.length && !asset; i++) {
        var dmgs = (releases[i].assets || []).filter(function (a) {
          return /\.dmg$/i.test(a.name) && !/(?:x64|x86|intel|amd64)/i.test(a.name) && String(a.browser_download_url).indexOf(RELEASES_URL + '/download/') === 0;
        });
        asset = dmgs.filter(function (a) { return /arm64|aarch64|universal|apple.?silicon/i.test(a.name); })[0] || dmgs[0];
      }
      if (!asset) { announce('No Mac DMG is published yet. ', true); return; }
      announce('Starting download: ' + asset.name + '. ', true);
      window.location.assign(asset.browser_download_url);
    } catch (err) {
      announce('Couldn’t reach the download right now. ', true);
    } finally {
      clearTimeout(timeout);
      busy = false;
      buttons.forEach(function (b) { b.removeAttribute('aria-busy'); });
    }
  }
  var downloadButtons = $$('[data-download]');
  downloadButtons.forEach(function (b) {
    b.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (secondsLeft() > 0 && dialog && dialog.showModal) { tick(); dialog.showModal(); }
      else downloadLatest(downloadButtons);
    });
  });
  if (dialog) dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

  // ---------- the six-minute call: load the X post in place on demand ----------
  var play = $('[data-demo-play]'), embed = $('[data-demo-embed]');
  if (play && embed) {
    play.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      play.hidden = true;
      embed.hidden = false;
      var s = document.createElement('script');
      s.src = TWEET_WIDGET; s.async = true; s.charset = 'utf-8';
      document.body.appendChild(s);
    });
  }

  // ---------- section in view → nav link ----------
  var links = $$('.nav__links a');
  if ('IntersectionObserver' in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || !byId[en.target.id]) return;
        links.forEach(function (l) { l.removeAttribute('aria-current'); });
        byId[en.target.id].setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) navIO.observe(s); });

    // Reveal once, on the way in.
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); revealIO.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach(function (el) { revealIO.observe(el); });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }
})();
