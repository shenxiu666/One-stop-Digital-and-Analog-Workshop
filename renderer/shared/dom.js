// Gongfang v2.6 — DOM 工具（全局唯一）
window.Gongfang = window.Gongfang || {};

Gongfang.escHtml = function(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

Gongfang.escAttr = function(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
};

// ★ 自定义暗色下拉（替代原生 select，统一主题：黑底白字、深色高亮）
// options: 字符串数组 或 {value,label} 数组；cfg: { placeholder, value, onchange }
// 返回元素：暴露 .value（读写）、.setOptions(list)、.options，支持 onchange / change 事件
Gongfang._makeDarkSelect = function(options, cfg) {
  var conf = cfg || {};
  var wrap = document.createElement('div');
  wrap.className = 'gongfang-dd' + (conf.compact ? ' compact' : '') + (conf.noCheck ? ' gongfang-dd-nocheck' : '');
  wrap.dataset.dd = '1';
  wrap.tabIndex = 0;

  function norm(list) {
    return (list || []).map(function(o) {
      if (typeof o === 'string' || typeof o === 'number') return { value: String(o), label: String(o), cls: '', badge: '', deletable: false };
      return { value: String(o.value), label: (o.label == null ? String(o.value) : String(o.label)), cls: o.cls || '', badge: o.badge || '', deletable: !!o.deletable };
    });
  }
  var list = norm(options);
  var _value = conf.value != null ? String(conf.value) : '';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gongfang-dd-btn';
  var txt = document.createElement('span');
  txt.className = 'gongfang-dd-text';
  txt.textContent = conf.placeholder || '请选择';
  txt.classList.add('ph');
  var arrow = document.createElement('span');
  arrow.className = 'gongfang-dd-arrow';
  arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  btn.appendChild(txt);
  btn.appendChild(arrow);
  wrap.appendChild(btn);

  var menu = document.createElement('div');
  menu.className = 'gongfang-dd-menu';
  wrap.appendChild(menu);

  function render() {
    menu.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'gongfang-dd-empty';
      empty.textContent = '暂无选项';
      menu.appendChild(empty);
      return;
    }
    list.forEach(function(o) {
      var it = document.createElement('div');
      it.className = 'gongfang-dd-item' + (o.value === _value ? ' selected' : '') + (o.cls ? ' ' + o.cls : '');
      it.dataset.value = o.value;
      // ★ 状态气泡（系统内置 / 用户创建）：标签文字保持纯名字，气泡在左
      if (o.badge) {
        var b = document.createElement('span');
        b.className = 'gongfang-dd-badge' + (o.badge === '用户创建' ? ' user' : ' builtin');
        b.textContent = o.badge;
        it.appendChild(b);
      }
      var lbl = document.createElement('span');
      lbl.className = 'gongfang-dd-label';
      lbl.textContent = o.label;
      it.appendChild(lbl);
      // ★ 用户创建条目：右侧删除按钮（点击弹出二级确认）
      if (o.deletable && conf.onDelete) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'gongfang-dd-del';
        del.title = '删除';
        del.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        del.onclick = function(e) {
          e.stopPropagation();
          var rr = conf.onDelete(o.value, o);
          if (rr && typeof rr.then === 'function') { rr.then(close, close); }
          else { close(); }
        };
        it.appendChild(del);
      }
      it.onclick = function(e) {
        e.stopPropagation();
        _value = o.value;
        sync();
        close();
        wrap.dispatchEvent(new Event('change', { bubbles: true }));
      };
      menu.appendChild(it);
    });
  }

  function sync() {
    var item = list.find(function(o) { return o.value === _value; });
    txt.textContent = item ? item.label : (conf.placeholder || '请选择');
    txt.classList.toggle('ph', !item);
    render();
  }

  function measureMenu() {
    var s = menu.style;
    var prev = { display: s.display, position: s.position, left: s.left, top: s.top, visibility: s.visibility, maxHeight: s.maxHeight };
    s.display = 'flex'; s.position = 'fixed'; s.left = '-10000px'; s.top = '0'; s.visibility = 'hidden'; s.maxHeight = 'none';
    var h = menu.scrollHeight;
    s.display = prev.display; s.position = prev.position; s.left = prev.left; s.top = prev.top; s.visibility = prev.visibility; s.maxHeight = prev.maxHeight;
    return h;
  }
  function open() {
    document.querySelectorAll('.gongfang-dd.open').forEach(function(w) { if (w !== wrap) w.classList.remove('open'); });
    // ★ fixed 定位：以按钮当前位置为锚点，计算 top/left/width。脱离父容器 overflow 裁剪。
    //   菜单高度按内容自适应，下方空间不够时自动向上展开，避免被压成拥挤的滚动小框。
    var r = wrap.getBoundingClientRect();
    var gap = 4;
    menu.style.position = 'fixed';
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.width = Math.round(r.width) + 'px';
    var capMax = Math.min(600, Math.floor(window.innerHeight * 0.68));
    var spaceBelow = Math.floor(window.innerHeight - r.bottom - gap - 8);
    var spaceAbove = Math.floor(r.top - gap - 8);
    // ★ 方向：优先朝可用空间更充足的一侧展开。原写法用「高度上限需求 need」判断，但下拉列表刷新期间
    //   measureMenu 可能偏小，下方明明很挤却仍向下展开、被压成带滚动条的拥挤小框（模板格式 14 条即如此）。
    //   改为直接比较上下两侧可用空间：上方更宽敞就向上弹，避免被压成滚动小框。
    var useBelow = !menu.querySelector('.gongfang-dd-item') || spaceBelow >= spaceAbove;
    if (useBelow) {
      menu.style.top = Math.round(r.bottom + gap) + 'px';
      menu.style.bottom = '';
      menu.style.maxHeight = Math.max(120, Math.min(capMax, spaceBelow)) + 'px';
    } else {
      menu.style.top = '';
      menu.style.bottom = Math.round(window.innerHeight - r.top + gap) + 'px';
      menu.style.maxHeight = Math.max(120, Math.min(capMax, spaceAbove)) + 'px';
    }
    wrap.classList.add('open');
  }
  function close() { wrap.classList.remove('open'); }

  btn.onclick = function(e) {
    e.stopPropagation();
    if (wrap.classList.contains('open')) { close(); return; }
    // ★ onopen 钩子：打开前触发（可返回 Promise 做异步刷新，如重查磁盘上的最新列表）。
    //   等它完成再展示菜单，保证每次打开都是最新数据；失败/超时用旧列表兜底打开。
    var r = null;
    if (conf.onopen) { try { r = conf.onopen(); } catch (_) { r = null; } }
    if (r && typeof r.then === 'function') {
      var opened = false;
      var timer = null;
      var doOpen = function() { if (!opened) { opened = true; if (timer) clearTimeout(timer); open(); } };
      timer = setTimeout(doOpen, 1500);
      r.then(doOpen, doOpen);
    } else {
      open();
    }
  };
  // ★ 页面滚动 / 窗口缩放时收起，避免 fixed 菜单与按钮错位
  //   菜单内部滚动（用户滚下拉列表）不算页面滚动，不收起
  var onScroll = function(e) {
    if (menu && e.target && menu.contains(e.target)) return;
    close();
  };
  var onResize = function() { close(); };
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('click', function() { close(); });

  Object.defineProperty(wrap, 'value', {
    get: function() { return _value; },
    set: function(v) { _value = v != null ? String(v) : ''; sync(); },
    enumerable: true
  });
  wrap.setOptions = function(newList, keepValue) {
    list = norm(newList);
    if (!keepValue) _value = '';
    else if (!list.some(function(o) { return o.value === _value; })) _value = '';
    sync();
  };

  sync();
  return wrap;
};

// ═══════════════════════════════════════════════
// ★ 懒加载重型库（CodeMirror / AntV X6）
// 开源版已移除 gongfang-renderer 协议，直接用相对路径加载（浏览器按文档 URL 解析）。
// 返回 Promise：全部加载成功 resolve()；脚本加载失败 / 全局未如期出现（10s）reject()。
// 调用方用 .then() 继续，失败时保持降级（现有 typeof xxx === 'undefined' 兜底分支）。
// ═══════════════════════════════════════════════
var _gongfangLoadedScripts = {};
var _gongfangLoadedStyles = {};

function _gongfangVendorUrl(rel) {
  return rel;
}

Gongfang._loadVendor = function(cfg) {
  var scripts = cfg.scripts || [];
  var styles = cfg.styles || [];
  var probe = cfg.loaded || null;   // 全局探测函数；已就绪则立即 resolve
  return new Promise(function(resolve, reject) {
    if (probe && probe()) { resolve(); return; }
    var pending = scripts.length + styles.length;
    if (pending === 0) { finish(); return; }
    var failed = false;
    function done() { if (--pending <= 0) finish(); }
    function fail() { if (!failed) { failed = true; reject(new Error('vendor script load failed')); } }
    function finish() {
      if (failed) return;
      if (!probe) { resolve(); return; }
      // 资源加载完并不代表全局已挂上（可能有依赖顺序/报错），轮询探测兜底
      var tries = 0;
      (function poll() {
        if (probe()) return resolve();
        if (failed || ++tries > 100) return reject(new Error('vendor global not found'));
        setTimeout(poll, 100);
      })();
    }
    styles.forEach(function(href) {
      if (_gongfangLoadedStyles[href]) { done(); return; }
      _gongfangLoadedStyles[href] = true;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = _gongfangVendorUrl(href);
      link.onload = done;
      link.onerror = done;   // CSS 加载失败不致命，继续
      document.head.appendChild(link);
    });
    var idx = 0;
    function next() {
      if (failed) return;
      if (idx >= scripts.length) return;
      var src = scripts[idx++];
      if (_gongfangLoadedScripts[src]) { done(); next(); return; }
      _gongfangLoadedScripts[src] = true;
      var s = document.createElement('script');
      s.src = _gongfangVendorUrl(src);
      s.onload = function() { done(); next(); };
      s.onerror = function() { fail(); };
      document.head.appendChild(s);
    }
    next();
  });
};

// CodeMirror（写作编辑器 / 代码工作台 / 聊天代码块 / 实时论文查看器）
Gongfang._ensureCodeMirror = function() {
  return Gongfang._loadVendor({
    scripts: [
      'vendor/codemirror/codemirror.min.js',
      'vendor/codemirror/mode/stex/stex.min.js',
      'vendor/codemirror/mode/python/python.min.js',
      'vendor/codemirror/addon/edit/matchbrackets.min.js',
      'vendor/codemirror/addon/edit/closebrackets.min.js',
      'vendor/codemirror/addon/selection/active-line.min.js'
    ],
    styles: ['vendor/codemirror/codemirror.min.css', 'vendor/codemirror/monokai.min.css'],
    loaded: function() { return typeof window.CodeMirror !== 'undefined'; }
  });
};

// AntV X6（绘图模式，UMD 全局 window.X6）
Gongfang._ensureX6 = function() {
  return Gongfang._loadVendor({
    scripts: [
      'vendor/x6/x6.min.js',
      'vendor/x6/x6-plugin-history.min.js',
      'vendor/x6/x6-plugin-selection.min.js',
      'vendor/x6/x6-plugin-snapline.min.js',
      'vendor/x6/x6-plugin-transform.min.js',
      'vendor/x6/x6-plugin-export.min.js'
    ],
    styles: [
      'vendor/x6/x6.css',
      'vendor/x6/x6-plugin-selection.css',
      'vendor/x6/x6-plugin-snapline.css',
      'vendor/x6/x6-plugin-transform.css'
    ],
    loaded: function() { return typeof window.X6 !== 'undefined' && !!window.X6.Graph; }
  });
};

// ═══════════════════════════════════════════════
// ★ 标签栏边缘渐隐：标签到达可视区边缘前一点点虚化消失，而不是被直接截断。
// 按滚动位置给标签栏加 mask-left/right/both 类（CSS 用 mask-image 渐变）。
// 在标签渲染后 + scroll 事件里调用（代码工作台 .cd-tabs、LaTeX 编辑器 .write-tabbar 都用）。
// ═══════════════════════════════════════════════
Gongfang._applyTabBarFade = function(el) {
  if (!el || !el.classList) return;
  var canL = el.scrollLeft > 2;
  var canR = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
  el.classList.toggle('mask-left', canL && !canR);
  el.classList.toggle('mask-right', canR && !canL);
  el.classList.toggle('mask-both', canL && canR);
  el.classList.toggle('mask-none', !canL && !canR);
};
