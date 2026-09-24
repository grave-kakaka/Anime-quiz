/* ==========================================================================
   题库管理页
   ========================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var OPT_COUNT = 4;

  var state = {
    questions: [],
    answer: 0,
    editId: null,
    media: null,      // { path, kind, name }
    start: 0,
    end: 0,
    blur: 0,
    busy: false
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 本地相对路径要补前缀, http(s) 外链原样用
  function mediaURL(src) {
    return /^https?:\/\//i.test(src) ? src : '/' + src;
  }

  function guessKind(url) {
    var ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'opus'].indexOf(ext) >= 0) { return 'audio'; }
    if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].indexOf(ext) >= 0) { return 'video'; }
    return 'image';
  }

  function kindLabel(kind) {
    return kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片';
  }

  var toastTimer = null;
  function toast(text, isError) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'toast on' + (isError ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  // ------------------------------------------------------------------ 选项

  function initOptions() {
    var box = $('opts');
    box.innerHTML = '';
    for (var i = 0; i < OPT_COUNT; i++) {
      var row = document.createElement('div');
      row.className = 'optrow';
      row.innerHTML =
        '<button class="pick" type="button" data-i="' + i + '">' + 'ABCD'[i] + '</button>' +
        '<input type="text" data-i="' + i + '" placeholder="选项 ' + 'ABCD'[i] + '">';
      box.appendChild(row);
    }
    box.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.pick') : null;
      if (!btn) { return; }
      setAnswer(Number(btn.dataset.i));
    });
  }

  function setAnswer(idx) {
    state.answer = idx;
    var picks = $('opts').querySelectorAll('.pick');
    for (var i = 0; i < picks.length; i++) {
      picks[i].className = 'pick' + (i === idx ? ' on' : '');
    }
  }

  function getOptionValues() {
    var inputs = $('opts').querySelectorAll('input[type="text"]');
    var out = [];
    for (var i = 0; i < inputs.length; i++) { out.push(inputs[i].value); }
    return out;
  }

  function setOptionValues(values) {
    var inputs = $('opts').querySelectorAll('input[type="text"]');
    for (var i = 0; i < inputs.length; i++) { inputs[i].value = values[i] || ''; }
  }

  // ------------------------------------------------------------------ 媒体

  function upload(file) {
    if (!file || state.busy) { return; }
    state.busy = true;
    $('dropmsg').textContent = '上传中 0%';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        $('dropmsg').textContent = '上传中 ' + Math.round(e.loaded / e.total * 100) + '%';
      }
    };

    xhr.onload = function () {
      state.busy = false;
      $('dropmsg').textContent = '把图片 / 音频 / 视频拖到这里，或点击选择文件';
      if (xhr.status !== 200) {
        var msg = '上传失败';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) { /* ignore */ }
        return toast(msg, true);
      }
      var info = JSON.parse(xhr.responseText);
      state.media = { path: info.path, kind: info.kind, name: info.name };
      state.start = 0;
      state.end = 0;
      state.blur = 0;
      renderPreview();
      toast('文件已存到 ' + info.path);
    };

    xhr.onerror = function () {
      state.busy = false;
      $('dropmsg').textContent = '把图片 / 音频 / 视频拖到这里，或点击选择文件';
      toast('上传出错', true);
    };

    xhr.send(file);
  }

  function renderPreview() {
    var box = $('preview');
    box.innerHTML = '';
    if (!state.media) { return; }

    var m = state.media;
    var wrap = document.createElement('div');
    wrap.className = 'media-preview';

    var head = '<div class="head"><span>' + kindLabel(m.kind) + '</span>' +
               '<span class="nm">' + esc(m.path) + '</span>' +
               '<button class="btn sm danger" id="rm-media" type="button">移除</button></div>';

    if (m.kind === 'image') {
      wrap.innerHTML = head +
        '<img src="' + mediaURL(m.path) + '">' +
        '<div class="clipctl"><span>初始模糊（猜图用，0 表示清晰）</span>' +
        '<input type="number" id="blur" min="0" max="40" step="1" value="' + state.blur + '">' +
        '<span>px</span></div>';
    } else {
      var player = m.kind === 'audio'
        ? '<audio id="player" src="' + mediaURL(m.path) + '" controls preload="metadata"></audio>'
        : '<video id="player" src="' + mediaURL(m.path) + '" controls preload="metadata"></video>';
      wrap.innerHTML = head + player +
        '<div class="clipctl">' +
        '<button class="btn sm" id="mark-start" type="button">设为起点</button>' +
        '<button class="btn sm" id="mark-end" type="button">设为终点</button>' +
        '<button class="btn sm ghost" id="clear-range" type="button">整段</button>' +
        '<span>起点</span><input type="number" id="start" min="0" step="0.1" value="' + state.start + '">' +
        '<span>终点</span><input type="number" id="end" min="0" step="0.1" value="' + state.end + '">' +
        '<span class="mark" id="range"></span>' +
        '</div>';
    }

    box.appendChild(wrap);
    bindPreview();
  }

  function bindPreview() {
    var rm = $('rm-media');
    if (rm) {
      rm.addEventListener('click', function () {
        state.media = null;
        state.start = 0;
        state.end = 0;
        state.blur = 0;
        renderPreview();
      });
    }

    var blur = $('blur');
    if (blur) {
      blur.addEventListener('input', function () {
        state.blur = Math.max(0, Number(blur.value) || 0);
      });
    }

    var player = $('player');
    if (player) {
      $('mark-start').addEventListener('click', function () {
        state.start = Math.round(player.currentTime * 10) / 10;
        $('start').value = state.start;
        updateRange();
      });
      $('mark-end').addEventListener('click', function () {
        state.end = Math.round(player.currentTime * 10) / 10;
        $('end').value = state.end;
        updateRange();
      });
      $('clear-range').addEventListener('click', function () {
        state.start = 0;
        state.end = 0;
        $('start').value = 0;
        $('end').value = 0;
        updateRange();
      });
      $('start').addEventListener('input', function () {
        state.start = Math.max(0, Number($('start').value) || 0);
        updateRange();
      });
      $('end').addEventListener('input', function () {
        state.end = Math.max(0, Number($('end').value) || 0);
        updateRange();
      });
      updateRange();
    }
  }

  function updateRange() {
    var el = $('range');
    if (!el) { return; }
    if (!state.end || state.end <= state.start) {
      el.textContent = state.start > 0 ? ('从 ' + state.start + 's 播到结尾') : '整段播放';
    } else {
      el.textContent = '只播 ' + state.start + 's — ' + state.end + 's';
    }
  }

  // ------------------------------------------------------------------ 表单

  function resetForm() {
    $('mediaurl').value = '';
    state.editId = null;
    state.media = null;
    state.start = 0;
    state.end = 0;
    state.blur = 0;
    $('form-title').textContent = '新增题目';
    $('question').value = '';
    $('explain').value = '';
    $('category').value = '';
    setOptionValues([]);
    setAnswer(0);
    renderPreview();
  }

  function collect() {
    var qtext = $('question').value.trim();
    if (!qtext) { return { error: '题干不能为空' }; }

    var raw = getOptionValues();
    var opts = [];
    var answer = 0;
    for (var i = 0; i < raw.length; i++) {
      var v = raw[i].trim();
      if (!v) { continue; }
      if (i === state.answer) { answer = opts.length; }
      opts.push(v);
    }
    if (opts.length < 2) { return { error: '至少要填两个选项' }; }

    var item = {
      question: qtext,
      options: opts,
      answer: answer,
      explain: $('explain').value.trim(),
      category: $('category').value.trim()
    };
    if (state.editId) { item.id = state.editId; }

    if (state.media) {
      item.media = {
        kind: state.media.kind,
        src: state.media.path,
        start: state.start,
        end: state.end,
        blur: state.blur
      };
    }
    return { item: item };
  }

  function save() {
    var r = collect();
    if (r.error) { return toast(r.error, true); }
    fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r.item)
    })
      .then(function (resp) { return resp.json().then(function (d) { return { ok: resp.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { return toast(res.d.error || '保存失败', true); }
        toast(res.d.created ? '已保存' : '已更新');
        var wasEdit = !!state.editId;
        resetForm();
        load();
        if (!wasEdit) { $('question').focus(); }
      })
      .catch(function () { toast('保存失败，服务可能断了', true); });
  }

  // ------------------------------------------------------------------ 列表

  function load() {
    fetch('/api/questions')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.questions = (d && d.questions) || [];
        renderList();
      });
  }

  function renderList() {
    var box = $('qlist');
    var n = state.questions.length;
    $('count').textContent = n ? '共 ' + n + ' 道' : '';
    box.innerHTML = '';

    if (!n) {
      box.innerHTML = '<div class="empty">还没有题目。左边填一道，点保存。</div>';
      return;
    }

    state.questions.forEach(function (q, idx) {
      var tags = [];
      if (q.media) { tags.push('<span class="media-tag">' + kindLabel(q.media.kind) + '</span>'); }
      if (q.category) { tags.push('<span>' + esc(q.category) + '</span>'); }
      tags.push('<span>' + ((q.options || []).length) + ' 个选项</span>');

      var item = document.createElement('div');
      item.className = 'qitem';
      item.innerHTML =
        '<div class="idx">' + (idx + 1) + '</div>' +
        '<div class="body">' +
        '<div class="text">' + esc(q.question) + '</div>' +
        '<div class="tags">' + tags.join('') + '</div>' +
        '</div>' +
        '<div class="acts">' +
        '<button class="btn sm ghost" data-act="up" data-i="' + idx + '" title="上移">↑</button>' +
        '<button class="btn sm ghost" data-act="down" data-i="' + idx + '" title="下移">↓</button>' +
        '<button class="btn sm" data-act="edit" data-i="' + idx + '">编辑</button>' +
        '<button class="btn sm danger" data-act="del" data-i="' + idx + '">删除</button>' +
        '</div>';
      box.appendChild(item);
    });
  }

  function edit(idx) {
    var q = state.questions[idx];
    if (!q) { return; }
    state.editId = q.id;
    $('form-title').textContent = '编辑第 ' + (idx + 1) + ' 题';
    $('question').value = q.question || '';
    $('explain').value = q.explain || '';
    $('category').value = q.category || '';
    setOptionValues(q.options || []);
    setAnswer(q.answer || 0);

    if (q.media && q.media.src) {
      state.media = {
        path: q.media.src,
        kind: q.media.kind || 'image',
        name: q.media.src.split('/').pop()
      };
      state.start = Number(q.media.start) || 0;
      state.end = Number(q.media.end) || 0;
      state.blur = Number(q.media.blur) || 0;
    } else {
      state.media = null;
      state.start = 0;
      state.end = 0;
      state.blur = 0;
    }
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function del(idx) {
    var q = state.questions[idx];
    if (!q) { return; }
    var preview = (q.question || '').slice(0, 24);
    if (!window.confirm('删除这一题？\n\n' + preview + '\n\n媒体文件不会被删掉，只删题目。')) { return; }
    fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: q.id })
    })
      .then(function () { toast('已删除'); load(); })
      .catch(function () { toast('删除失败', true); });
  }

  function move(idx, delta) {
    var to = idx + delta;
    if (to < 0 || to >= state.questions.length) { return; }
    var arr = state.questions.slice();
    var t = arr[idx]; arr[idx] = arr[to]; arr[to] = t;
    var ids = arr.map(function (q) { return q.id; });
    fetch('/api/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    })
      .then(function () { load(); })
      .catch(function () { toast('顺序保存失败', true); });
  }

  // ------------------------------------------------------------------ 事件

  var drop = $('drop');
  var fileInput = $('file');

  drop.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    upload(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      upload(e.dataTransfer.files[0]);
    }
  });

  // 直接粘外链, 不用先把文件下载下来
  $('mediaurl').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') { return; }
    e.preventDefault();
    var url = this.value.trim();
    if (!url) { return; }
    if (!/^https?:\/\//i.test(url)) {
      return toast('链接要以 http:// 或 https:// 开头', true);
    }
    state.media = { path: url, kind: guessKind(url), name: url.split('/').pop().split('?')[0] };
    state.start = 0;
    state.end = 0;
    state.blur = 0;
    renderPreview();
    this.value = '';
    toast('已设为这道题的媒体');
  });

  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', resetForm);

  $('qlist').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) { return; }
    var idx = Number(btn.dataset.i);
    var act = btn.dataset.act;
    if (act === 'up') { move(idx, -1); }
    else if (act === 'down') { move(idx, 1); }
    else if (act === 'edit') { edit(idx); }
    else if (act === 'del') { del(idx); }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      save();
    }
  });

  // ------------------------------------------------------------------ 启动

  initOptions();
  setAnswer(0);
  load();
})();
