/* ==========================================================================
   放映逻辑

   交互方式: 用鼠标点选项作答
     点对了 -> 那一项变绿
     点错了 -> 点的那项变红, 同时正确答案变绿
     然后点右下角「下一题」继续

   单人模式: 一轮 5 道题, 结束时报答对几道
   双人模式: 轮流作答, 答对加一分答错不扣分, 谁先答对 5 道谁赢

   键盘只留媒体控制:
     R   重播这段媒体
     P   暂停 / 继续
     Esc 结束这一轮
   ========================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var SINGLE_COUNT = 5;   // 单人模式每轮抽几道题
  var DUO_TARGET = 5;     // 双人模式: 先答对几道算赢

  var state = {
    all: [],
    queue: [],
    i: 0,
    mode: 'single',
    names: ['玩家 A', '玩家 B'],
    turn: 0,
    scores: [0, 0],
    answered: false,
    picked: -1
  };

  // 当前媒体片段
  var clip = { el: null, kind: null, start: 0, end: 0 };

  // ------------------------------------------------------------------ 工具

  function fmt(t) {
    if (!isFinite(t) || t < 0) { return '--:--'; }
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------------ 媒体

  function clearMedia() {
    var el = clip.el;
    if (el && el.removeEventListener) {
      el.pause();
      el.removeEventListener('timeupdate', onTick);
      el.removeEventListener('play', syncPlayBtn);
      el.removeEventListener('pause', syncPlayBtn);
      el.removeEventListener('ended', syncPlayBtn);
    }
    clip = { el: null, kind: null, start: 0, end: 0 };
    $('media').innerHTML = '';
  }

  function onTick() {
    var el = clip.el;
    if (!el) { return; }
    var end = clip.end > 0 ? clip.end : (isFinite(el.duration) ? el.duration : 0);
    var cur = el.currentTime;
    var fill = $('mfill');
    var clock = $('mclock');
    if (fill && end > clip.start) {
      var pct = ((cur - clip.start) / (end - clip.start)) * 100;
      fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
    if (clock) { clock.textContent = fmt(cur) + ' / ' + fmt(end); }
    if (clip.end > 0 && cur >= clip.end) {
      el.pause();
      try { el.currentTime = clip.start; } catch (e) { /* ignore */ }
      syncPlayBtn();
    }
  }

  function syncPlayBtn() {
    var btn = $('mplay');
    if (!btn || !clip.el) { return; }
    btn.textContent = clip.el.paused ? '播放' : '暂停';
  }

  function playMedia() {
    if (!clip.el) { return; }
    var el = clip.el;
    var begin = function () {
      if (clip.el !== el) { return; }   // 已经切到别的题了, 别去动旧媒体
      try { el.currentTime = clip.start; } catch (e) { /* ignore */ }
      var p = el.play();
      if (p && p.catch) { p.catch(function () { /* 浏览器拦截时静默 */ }); }
    };
    if (el.readyState >= 1) { begin(); }
    else { el.addEventListener('loadedmetadata', begin, { once: true }); }
  }

  function toggleMedia() {
    if (!clip.el) { return; }
    if (clip.el.paused) { playMedia(); } else { clip.el.pause(); }
  }

  function bindClip(el, start, end) {
    clip.el = el;
    clip.kind = el.tagName.toLowerCase();
    clip.start = Number(start) || 0;
    clip.end = Number(end) || 0;
    el.addEventListener('timeupdate', onTick);
    el.addEventListener('play', syncPlayBtn);
    el.addEventListener('pause', syncPlayBtn);
    el.addEventListener('ended', syncPlayBtn);
    el.addEventListener('loadedmetadata', onTick);
    playMedia();
  }

  function missingNote(src) {
    var d = document.createElement('div');
    d.className = 'missing';
    d.textContent = '媒体文件找不到：' + src;
    return d;
  }

  function buildMedia(q) {
    clearMedia();
    var box = $('media');
    var m = q.media;
    if (!m || !m.src) { return; }

    if (m.kind === 'image') {
      var img = new Image();
      img.className = 'hidden-media';
      if (m.blur > 0) { img.style.filter = 'blur(' + m.blur + 'px)'; }
      img.onload = function () { img.classList.remove('hidden-media'); };
      img.onerror = function () {
        if (img.parentNode) { img.parentNode.replaceChild(missingNote(m.src), img); }
      };
      img.src = '/' + m.src;
      box.appendChild(img);
      clip.kind = 'image';
      return;
    }

    if (m.kind === 'video') {
      var v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.preload = 'auto';
      if (m.poster) { v.poster = '/' + m.poster; }
      v.onerror = function () {
        if (v.parentNode) { v.parentNode.replaceChild(missingNote(m.src), v); }
      };
      v.src = '/' + m.src;
      box.appendChild(v);
      bindClip(v, m.start, m.end);
      return;
    }

    // 音频: 自绘一条播放控制条
    var bar = document.createElement('div');
    bar.className = 'audiobar';
    bar.innerHTML =
      '<button class="play" id="mplay" type="button">播放</button>' +
      '<div class="track"><div class="fill" id="mfill"></div></div>' +
      '<div class="clock" id="mclock">0:00 / 0:00</div>';
    box.appendChild(bar);

    var a = document.createElement('audio');
    a.preload = 'auto';
    a.onerror = function () {
      if (bar.parentNode) { bar.parentNode.replaceChild(missingNote(m.src), bar); }
    };
    a.src = '/' + m.src;
    bindClip(a, m.start, m.end);
    $('mplay').addEventListener('click', toggleMedia);
  }

  // ------------------------------------------------------------------ 渲染

  function render() {
    var q = state.queue[state.i];
    if (!q) { return finish(); }

    state.answered = false;
    state.picked = -1;

    $('next').classList.add('hidden');

    if (state.mode === 'duo') {
      $('progress').textContent = '第 ' + (state.i + 1) + ' 题';
      // 进度条表示领先者离目标分还差多少
      var lead = Math.max(state.scores[0], state.scores[1]);
      $('topline').style.width = (lead / DUO_TARGET * 100) + '%';
    } else {
      $('progress').textContent = (state.i + 1) + ' / ' + state.queue.length;
      $('topline').style.width = ((state.i + 1) / state.queue.length * 100) + '%';
    }

    $('category').textContent = q.category || '';
    $('question').textContent = q.question;

    $('explain').textContent = '';
    $('explain').classList.remove('on');

    // 选项: 每一项都能点
    var ul = $('options');
    ul.innerHTML = '';
    (q.options || []).forEach(function (text, idx) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="key">' + 'ABCDEF'[idx] + '</span>' +
                     '<span class="text">' + esc(text) + '</span>';
      li.addEventListener('click', function () { pick(idx); });
      ul.appendChild(li);
    });

    buildMedia(q);
    renderTurn();
    renderHints();
  }

  function renderTurn() {
    var turn = $('turn');
    if (state.mode !== 'duo') {
      turn.textContent = '';
      $('score').classList.add('hidden');
      return;
    }
    $('score').classList.remove('hidden');
    $('label-a').textContent = state.names[0];
    $('label-b').textContent = state.names[1];
    $('who-a').textContent = state.scores[0];
    $('who-b').textContent = state.scores[1];
    $('slot-a').className = 'slot' + (state.turn === 0 ? ' active' : '');
    $('slot-b').className = 'slot' + (state.turn === 1 ? ' active' : '');
    turn.textContent = '轮到 ' + state.names[state.turn];
  }

  function renderHints() {
    var h = $('hints');
    if (!state.answered) {
      h.innerHTML = '<span class="ask">点下面的选项作答</span>';
      return;
    }
    var q = state.queue[state.i];
    var right = (state.picked === q.answer);
    if (right) {
      var extra = state.mode === 'duo'
        ? '，' + esc(state.names[state.turn]) + ' 加一分'
        : '';
      h.innerHTML = '<span class="result ok">答对了' + extra + '</span>';
    } else {
      h.innerHTML = '<span class="result no">答错了，正确答案是 ' +
                    'ABCDEF'[q.answer] + '</span>';
    }
  }

  // ------------------------------------------------------------------ 作答

  function pick(idx) {
    if (state.answered) { return; }
    var q = state.queue[state.i];
    if (!q) { return; }

    var right = (idx === q.answer);
    state.answered = true;
    state.picked = idx;

    // 上色: 点对 -> 这一项绿; 点错 -> 这一项红, 同时把正确答案标绿
    var items = $('options').children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.add('locked');
      if (i === idx) {
        items[i].classList.add(right ? 'correct' : 'wrong');
      } else if (i === q.answer) {
        items[i].classList.add('correct');
      } else {
        items[i].classList.add('dim');
      }
    }

    if (q.explain) {
      $('explain').textContent = q.explain;
      $('explain').classList.add('on');
    }
    var img = $('media').querySelector('img');
    if (img) { img.style.filter = 'none'; }   // 打码图揭晓

    // 计分: 答对加分, 答错不扣分
    if (right) {
      if (state.mode === 'duo') {
        state.scores[state.turn]++;
        bumpScore(state.turn);
      } else {
        state.scores[0]++;
      }
    }

    renderTurn();
    renderHints();
    $('next').classList.remove('hidden');
  }

  function bumpScore(idx) {
    var el = $('who-' + (idx === 0 ? 'a' : 'b'));
    if (!el) { return; }
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(function () { el.classList.remove('bump'); }, 600);
  }

  function next() {
    if (!state.answered) { return; }

    if (state.mode === 'duo') {
      // 谁先答对到目标分, 谁就赢
      if (state.scores[0] >= DUO_TARGET || state.scores[1] >= DUO_TARGET) {
        return finish();
      }
      state.turn = 1 - state.turn;   // 换人
    }

    state.i++;
    if (state.i >= state.queue.length) { return finish(); }
    render();
  }

  // ------------------------------------------------------------------ 界面切换

  function overlay(html) {
    $('card').innerHTML = html;
    $('overlay').classList.remove('hidden');
    $('stage').classList.add('hidden');
    clearMedia();
  }

  function showStage() {
    $('overlay').classList.add('hidden');
    $('stage').classList.remove('hidden');
  }

  function startMenu() {
    if (!state.all.length) {
      overlay(
        '<h2>题库还是空的</h2>' +
        '<p>先去上传页加几道题，再回来放映。</p>' +
        '<div class="actions">' +
        '<a class="btn primary" href="/admin">打开上传页</a>' +
        '<a class="btn ghost" href="/">返回首页</a></div>'
      );
      return;
    }
    var n = state.all.length;
    overlay(
      '<h2>动漫答题</h2>' +
      '<p>题库里共 ' + n + ' 道题。每轮随机抽题，同一轮里不会重复。</p>' +
      '<div class="menu">' +
      '<button class="menu-item" id="go-single" type="button">' +
      '<span class="name">单人模式</span>' +
      '<span class="desc">随机 ' + SINGLE_COUNT + ' 道，点选项作答</span>' +
      '<span class="arrow">&#8594;</span></button>' +
      '<button class="menu-item" id="go-duo" type="button">' +
      '<span class="name">双人轮流</span>' +
      '<span class="desc">轮流作答，谁先答对 ' + DUO_TARGET + ' 道谁赢</span>' +
      '<span class="arrow">&#8594;</span></button>' +
      '</div>' +
      '<div class="back">点选项作答 · R 重播 · P 暂停 · Esc 结束</div>'
    );
    $('go-single').addEventListener('click', function () { begin('single'); });
    $('go-duo').addEventListener('click', duoSetup);
  }

  function duoSetup() {
    overlay(
      '<h2>双人轮流</h2>' +
      '<p>两个人轮流点选项作答。答对加一分，答错不扣分，' +
      '谁先答对 ' + DUO_TARGET + ' 道谁赢。</p>' +
      '<div class="field"><label>左边玩家</label>' +
      '<input type="text" id="name-a" value="玩家 A" maxlength="12"></div>' +
      '<div class="field"><label>右边玩家</label>' +
      '<input type="text" id="name-b" value="玩家 B" maxlength="12"></div>' +
      '<div class="actions">' +
      '<button class="btn primary" id="go" type="button">开始</button>' +
      '<button class="btn ghost" id="back" type="button">返回</button></div>'
    );
    $('back').addEventListener('click', startMenu);
    $('go').addEventListener('click', function () {
      state.names = [
        ($('name-a').value || '玩家 A').trim(),
        ($('name-b').value || '玩家 B').trim()
      ];
      begin('duo');
    });
  }

  function begin(mode) {
    state.mode = mode;
    state.turn = 0;
    state.scores = [0, 0];
    state.i = 0;
    state.answered = false;

    var pool = shuffle(state.all);
    if (mode === 'duo') {
      // 双人是一路答到有人先到目标分, 所以把整副题库打乱备用
      state.queue = pool;
    } else {
      state.queue = pool.slice(0, Math.min(SINGLE_COUNT, pool.length));
    }

    showStage();
    render();
  }

  function finish() {
    if (state.mode === 'duo') {
      var a = state.scores[0], b = state.scores[1];
      var verdict;
      if (a === b) {
        verdict = '平局。';
      } else if (a > b) {
        verdict = esc(state.names[0]) + ' 赢了。';
      } else {
        verdict = esc(state.names[1]) + ' 赢了。';
      }
      var reach = Math.max(a, b) >= DUO_TARGET
        ? '先答对 ' + DUO_TARGET + ' 道。'
        : '题目答完了，没人到 ' + DUO_TARGET + ' 分。';

      overlay(
        '<h2>比赛结束</h2>' +
        '<p>' + verdict + reach + '</p>' +
        '<div class="scoreboard">' +
        '<div class="card-score' + (a >= b ? ' win' : '') + '">' +
        '<div class="name">' + esc(state.names[0]) + '</div>' +
        '<div class="num">' + a + '</div></div>' +
        '<div class="card-score' + (b >= a ? ' win' : '') + '">' +
        '<div class="name">' + esc(state.names[1]) + '</div>' +
        '<div class="num">' + b + '</div></div>' +
        '</div>' +
        '<div class="actions">' +
        '<button class="btn primary" id="again" type="button">再来一轮</button>' +
        '<button class="btn ghost" id="menu" type="button">回到开始</button>' +
        '</div>'
      );
    } else {
      var right = state.scores[0];
      var total = state.queue.length;
      overlay(
        '<h2>放映结束</h2>' +
        '<p>这一轮 ' + total + ' 道题，答对 ' + right + ' 道。</p>' +
        '<div class="actions">' +
        '<button class="btn primary" id="again" type="button">再来一轮</button>' +
        '<button class="btn ghost" id="menu" type="button">回到开始</button>' +
        '</div>'
      );
    }
    $('again').addEventListener('click', function () { begin(state.mode); });
    $('menu').addEventListener('click', startMenu);
  }

  // ------------------------------------------------------------------ 键盘

  // 只用键盘控制媒体, 作答一律点鼠标
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') { return; }
    if ($('stage').classList.contains('hidden')) { return; }

    switch (e.code) {
      case 'KeyR':
        e.preventDefault();
        playMedia();
        break;
      case 'KeyP':
        e.preventDefault();
        toggleMedia();
        break;
      case 'Escape':
        e.preventDefault();
        startMenu();
        break;
      // 留着当后门: 答题后回车 / 空格 也能翻页, 界面上不写
      case 'Space':
      case 'Enter':
      case 'ArrowRight':
        if (state.answered) { e.preventDefault(); next(); }
        break;
      default:
        break;
    }
  });

  $('next').addEventListener('click', next);

  // ------------------------------------------------------------------ 启动

  fetch('/api/questions')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      state.all = (d && d.questions) || [];
      startMenu();
    })
    .catch(function () {
      overlay('<h2>连不上服务</h2><p>本地服务好像没在跑。关掉窗口，重新双击启动脚本试试。</p>');
    });
})();
