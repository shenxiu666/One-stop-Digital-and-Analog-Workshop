// Gongfang v2.6 — 代码工作台（三栏布局，与写作面板一致）
// 布局：左栏=项目文件（选择工作目录后指向该文件夹，支持增删文件/文件夹）
//       中栏=代码/文件编辑器（图片·CSV·文本·代码均可打开）+ 运行终端(可展开收起)
//       右栏=输出记录（每次运行的输出历史）。
// 运行/停止/保存/新建 操作按钮收进中栏编辑器头部。顶栏左右开关控制左右栏。
window.Gongfang = window.Gongfang || {};

Gongfang._codeState = {
  initDone: false, editor: null,
  currentFile: null, currentRoot: '', openTabs: [], activeTab: 0,
  runId: null, running: false, dirty: false,
  terminalOpen: true, runHistory: []
};

Gongfang._codeE = function(id) { return document.getElementById(id); };

Gongfang._codeInit = function() {
  var host = Gongfang._codeE('writeModeCode');
  if (!host) return;
  if (Gongfang._codeState.initDone) { Gongfang._codeRefreshFiles(); if (Gongfang._codeState.editor) setTimeout(function(){ Gongfang._codeState.editor.refresh(); }, 60); return; }
  Gongfang._codeState.initDone = true;
  host.innerHTML = [
    '<div class="cd-wb">',
      // ★ 左栏：项目文件（标题栏「＋ 新建」按钮 = 选择工作目录；右键文件区：选择工作目录 / 新建 / 重命名 / 删除 / 复制路径）
      '<div class="cd-files-col">',
        '<div class="cd-col-head">',
          '<span class="cd-col-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>项目文件</span>',
          '<button class="panel-load-btn" onclick="Gongfang._codeLoadTaskMenu()" title="新建文件">＋ 新建</button>',
        '</div>',
        '<div class="cd-files-body" id="cdFilesBody" oncontextmenu="Gongfang._codeCtxMenu(event, null)"><div class="cd-empty">点「＋ 新建」选择工作目录</div></div>',
      '</div>',
      // ★ 中栏：编辑器 + 运行终端
      '<div class="cd-center-col">',
        '<div class="cd-editor-card" id="cdEditorCard">',
          '<div class="cd-editor-head">',
            '<span class="cd-editor-taskname" id="cdTaskName" style="display:none"></span>',
            '<div class="cd-tabs" id="cdTabs"></div>',
            '<div class="cd-editor-actions">',
              '<button class="write-btn-save" onclick="Gongfang._codeSave()" title="保存 Ctrl+S"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></button>',
              '<button class="write-btn-stop" id="cdStopBtn" onclick="Gongfang._codeStop()" title="停止" disabled><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>',
              '<button class="write-btn-compile" id="cdRunBtn" onclick="Gongfang._codeRun()" title="运行 Ctrl+Enter"><svg class="write-compile-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg><svg class="write-compile-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></button>',
            '</div>',
          '</div>',
          '<div class="cd-editor-pane">',
            '<textarea id="cdEditorArea"></textarea>',
            '<div class="cd-editor-ph" id="cdEditorPh" style="display:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" stroke-width="1"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><p>点击左侧文件打开，或输入 Python 代码后「运行」</p></div>',
            '<div class="cd-preview-pane" id="cdPreviewPane" style="display:none"><div class="cd-preview-body" id="cdPreviewBody"></div></div>',
          '</div>',
        '</div>',
        // ★ 运行终端（照搬写作编译输出结构）
        '<div class="cd-terminal" id="cdTerminal">',
          // 展开区：标题栏 + 输出内容
          '<div class="cd-terminal-expand">',
            '<div class="cd-terminal-head">',
              '<div class="cd-terminal-head-left">',
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
                '<span>运行输出</span>',
              '</div>',
              '<div class="cd-terminal-head-right">',
              '</div>',
            '</div>',
            '<div class="cd-terminal-body">',
              '<textarea class="cd-run-output" id="cdRunOutput" spellcheck="false"></textarea>',
            '</div>',
          '</div>',
          // 底部固定条
          '<div class="cd-terminal-bar" onclick="Gongfang._codeToggleTerminal()" style="cursor:pointer">',
            '<span class="cd-terminal-bar-text"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>运行输出</span>',
            '<span class="cd-terminal-bar-right">',
              '<span class="cd-run-status" id="cdRunStatus"><span class="cd-dot idle"></span>就绪</span>',
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" id="cdTerminalToggle" style="transform:rotate(180deg)"><polyline points="6 9 12 15 18 9"/></svg>',
            '</span>',
          '</div>',
        '</div>',
      '</div>',
      // ★ 右栏：输出记录
      '<div class="cd-output-col">',
        '<div class="cd-col-head"><span class="cd-col-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>输出记录</span></div>',
        '<div class="cd-output-body" id="cdOutputBody"><div class="cd-empty">运行代码后，每次输出会记录在这里</div></div>',
      '</div>',
    '</div>',
  ].join('');

  // ★ 标签栏边缘渐隐：挂滚动监听（只挂一次）
  var tbar = Gongfang._codeE('cdTabs');
  if (tbar && !tbar.__gongfangFadeBound) {
    tbar.__gongfangFadeBound = true;
    tbar.addEventListener('scroll', function() { Gongfang._applyTabBarFade(tbar); });
  }

  var ta = Gongfang._codeE('cdEditorArea');
  function initCm() {
    // ★ CodeMirror 已懒加载：注入成功后再建编辑器（加载失败则保持占位，不阻塞其它面板初始化）
    if (typeof CodeMirror === 'undefined') { Gongfang._ensureCodeMirror().then(initCm); return; }
    Gongfang._codeState.editor = CodeMirror.fromTextArea(ta, {
      mode: 'python', theme: 'default', lineNumbers: true, matchBrackets: true,
      autoCloseBrackets: true, styleActiveLine: true, lineWrapping: false,
      indentUnit: 4, tabSize: 4, autofocus: true,
      extraKeys: {
        'Ctrl-S': function(){ Gongfang._codeSave(); }, 'Cmd-S': function(){ Gongfang._codeSave(); },
        'Ctrl-Enter': function(){ Gongfang._codeRun(); }, 'Cmd-Enter': function(){ Gongfang._codeRun(); }
      }
    });
    Gongfang._codeState.editor.setValue('# Python 代码\nimport matplotlib.pyplot as plt\n\nprint("你好，Gongfang")\n');
    Gongfang._codeState.editor.on('change', function() {
      Gongfang._codeState.dirty = true;
      var ph = Gongfang._codeE('cdEditorPh');
      if (ph) ph.style.display = Gongfang._codeState.editor.getValue() ? 'none' : 'flex';
      Gongfang._codeRenderTabs();
    });
    Gongfang._codeState.editor.on('cursorActivity', function() { Gongfang._codeUpdateStatus(); });
  }
  initCm();
  if (window.electronAPI && window.electronAPI.onCodeRunOutput) window.electronAPI.onCodeRunOutput(function(data){ Gongfang._codeAppendOutput(data); });
  Gongfang._codeSetFileActions('preset.py'); // 初始预设代码可运行：显示运行+停止
  // ★ 终端初始为展开态
  var termInit = Gongfang._codeE('cdTerminal');
  if (termInit) termInit.classList.add('expanded');
  Gongfang._codeRefreshFiles();
  Gongfang._codeAppendOutput({ stream: 'sys', text: '✓ 代码工作台就绪。点「＋ 新建」选择工作目录，，或点「＋ 新建」选择工作目录。\n' });
};

// ★ 运行输出上下拖拽：最小 = 代码区+输出总高的 1/5，最大 = 平分（1/2）
//   流畅关键：
//     1) 拖动期间给工作区加 cd-dragging 类，CSS 强制 transition:none，避免 .cd-terminal 的 height 过渡把拖动拖慢半拍
//     2) rAF 节流 + 编辑器每帧跟随（用 try/catch，CodeMirror 未就绪时忽略），松手后恢复正常
Gongfang._codeBindRunResizer = function() {
  var rz = Gongfang._codeE('cdRunResizer');
  if (!rz) return;
  rz.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var startY = e.clientY;
    var term = Gongfang._codeE('cdTerminal');
    var editor = Gongfang._codeE('cdEditorCard');
    var wb = rz.closest ? rz.closest('.cd-wb') : null;
    var startH = term ? term.offsetHeight : 150;
    var lastY = startY, raf = null;
    if (wb) wb.classList.add('cd-dragging');
    var apply = function() {
      raf = null;
      // ★ 方案 A：拖拽只改外层面板的 maxHeight；范围 [32px, 60vh]（与 CSS 约束一致）
      //   绝对不改 height、不改 transform（transform 只负责展开/收起切换）
      var col = rz.closest ? rz.closest('.cd-center-col') : null;
      var colH = col ? col.offsetHeight : 800;
      var min = 32;
      var max = Math.round(colH * 0.6);  // 60vh ≈ cd-center-col 高度的 60%
      var panelHeight = Math.max(min, Math.min(max, startH - (lastY - startY)));
      Gongfang._codeState.termH = panelHeight;
      if (term) {
        // ★ 只改 style.maxHeight，这是方案 A 指令的明确要求；同时确保处于展开态（没有 collapsed）
        term.style.maxHeight = panelHeight + 'px';
        term.classList.remove('collapsed');
      }
    };
    var onMove = function(ev) {
      lastY = ev.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    var onUp = function() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (wb) wb.classList.remove('cd-dragging');
      // 松手后编辑器精确刷新一次
      try { if (Gongfang._codeState.editor) setTimeout(function(){ Gongfang._codeState.editor.refresh(); }, 20); } catch(e) {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
};

// ★ 工作目录 = 当前自选工作目录根（新工坊：不再有「求解」子目录概念）
Gongfang._codeProjectRoot = function() {
  var p = Gongfang._codeState && Gongfang._codeState.activeProject;
  if (p && p.path) return String(p.path).replace(/[\\/]+$/, '');
  // 未在代码面板选过 → 跟随全局当前工作目录
  return (Gongfang._wsWorkdir || '').replace(/[\\/]+$/, '');
};
Gongfang._codeWorkDir = function() {
  return Gongfang._codeProjectRoot();
};

/* ═══════════════════ 左栏：文件管理（加载求解文件夹 + 增删文件） ═══════════════════ */
// ★ 标题栏最左显示项目名（照搬 LaTeX 编辑器 _writeRenderTabs 的项目名实现：>5字滚动）
Gongfang._codeUpdateTaskName = function() {
  var el = Gongfang._codeE('cdTaskName');
  if (!el) return;
  var p = Gongfang._codeState && Gongfang._codeState.activeProject;
  if (!p) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.className = 'cd-editor-taskname' + (String(p.name || '').length > 5 ? ' scroll' : '');
  el.innerHTML = '<span class="cd-editor-taskname-inner">' + Gongfang._esc(p.name || '') + '</span>';
};

Gongfang._codeRefreshFiles = function() {
  var body = Gongfang._codeE('cdFilesBody');
  if (!body) return;
  Gongfang._codeUpdateTaskName();
  var solve = Gongfang._codeWorkDir();
  var root = Gongfang._codeProjectRoot();
  if (!solve && !root) { body.innerHTML = '<div class="cd-empty">点「＋ 新建」选择工作目录</div>'; return; }
  if (!window.electronAPI || !window.electronAPI.readDirectoryTree) { body.innerHTML = '<div class="cd-empty">文件服务不可用</div>'; return; }
  var render = function(res, dir) {
    // ★ readDirectoryTree 返回 { success, tree: { children } }，树在 res.tree
    var children = res && res.tree ? res.tree.children : null;
    if (!children || !children.length) { body.innerHTML = '<div class="cd-empty">（空文件夹）</div>'; return; }
    Gongfang._codeState.currentRoot = dir;
    body.innerHTML = Gongfang._codeRenderTree(children);
    body.querySelectorAll('.cd-dir').forEach(function(d) { d.addEventListener('click', function() { d.classList.toggle('open'); }); });
  };
  var tryRead = function(dir) {
    if (!dir) return Promise.resolve(null);
    return window.electronAPI.readDirectoryTree(dir, 5).then(function(res) {
      if (!res || res.success === false) return null;
      return { res: res, dir: dir };
    }).catch(function() { return null; });
  };
  // 直接读工作目录根
  tryRead(root).then(function(ok) {
    if (ok) render(ok.res, ok.dir);
    else body.innerHTML = '<div class="cd-empty">（空文件夹）</div>';
  });
};

Gongfang._codeRenderTree = function(nodes) {
  // ★ 完整渲染（不截断）：递归返回子级 HTML，保证二级/三级目录内容正常显示
  var html = '';
  (nodes || []).forEach(function(n) {
    var title = Gongfang._escAttr2(n.path || (n.name || ''));
    if (n.type === 'directory') {
      // 开/闭双文件夹图标
      html += '<div class="cd-fnode cd-dir" data-path="' + Gongfang._escAttr2(n.path) + '" data-name="' + Gongfang._escAttr2(n.name) + '" title="' + title + '" oncontextmenu="Gongfang._codeCtxMenu(event, this)">' +
        '<span class="cd-folder-ico">' +
          '<span class="cd-folder-closed">' + Gongfang.folderIcon(false) + '</span>' +
          '<span class="cd-folder-open">' + Gongfang.folderIcon(true) + '</span>' +
        '</span>' +
        '<span class="cd-fnode-name">' + Gongfang._esc(n.name) + '</span>' +
        '</div>';
      if (n.children && n.children.length) html += '<div class="cd-fchildren">' + Gongfang._codeRenderTree(n.children) + '</div>';
    } else {
      // ★ 当前编辑文件在树里高亮（data-path 与 currentFile 匹配）
      var fActive = (n.path === Gongfang._codeState.currentFile);
      html += '<div class="cd-fnode cd-file' + (fActive ? ' active' : '') + '" data-path="' + Gongfang._escAttr2(n.path) + '" data-name="' + Gongfang._escAttr2(n.name) + '" title="' + title + '" oncontextmenu="Gongfang._codeCtxMenu(event, this)">' +
        Gongfang._codeIcon(n.name) +
        '<span class="cd-fnode-name">' + Gongfang._esc(n.name) + '</span>' +
        '</div>';
    }
  });
  return html;
};

// ★ 文件类型图标：统一用共享 vscode-icons 图标集（renderer/shared/file-icons.js，非手绘）
Gongfang._codeFileIcons = function(name) {
  return Gongfang.fileIcon(name);
};
Gongfang._codeIcon = function(name) {
  var cls = 'file';
  if (/\.py$/i.test(name)) cls = 'py';
  else if (/\.(png|jpe?g|gif|svg|webp)$/i.test(name)) cls = 'img';
  else if (/\.csv$/i.test(name)) cls = 'csv';
  else if (/\.tex$/i.test(name)) cls = 'tex';
  else if (/\.(json|xml|yaml|yml)$/i.test(name)) cls = 'cfg';
  else if (/\.(md|txt)$/i.test(name)) cls = 'md';
  return '<span class="cd-ficon ' + cls + '">' + Gongfang._codeFileIcons(name) + '</span>';
};

/* ═══════════════════ 工作目录选择：最近目录 + 选择其他文件夹 ═══════════════════ */
Gongfang._codeLoadTaskMenu = async function(anchor) {
  var old = document.getElementById('cdTaskDropdown');
  if (old) { old.remove(); return; }
  // ★ 定位：优先取调用方锚点（右键点击位置），否则挂在文件区标题栏下
  var rect;
  if (anchor && typeof anchor.left === 'number') {
    rect = { bottom: anchor.bottom, left: anchor.left };
  } else {
    var head = document.querySelector('.cd-files-col .cd-col-head');
    var hr = head ? head.getBoundingClientRect() : null;
    rect = hr ? { bottom: hr.bottom, left: hr.left } : { bottom: 40, left: 20 };
  }
  // 右边缘防溢出（下拉宽 280px）
  rect.left = Math.max(8, Math.min(rect.left, window.innerWidth - 288));
  var data = { recent: [], current: '' };
  try { if (Gongfang._wsGetRecent) data = await Gongfang._wsGetRecent(); } catch (_) {}
  var list = data.recent || [], current = data.current || '';
  var open = function() {
    var d = document.createElement('div');
    d.id = 'cdTaskDropdown';
    d.className = 'cd-task-dropdown';
    d.style.top = (rect.bottom + 4) + 'px';
    d.style.left = (rect.left) + 'px';
    var html = '';
    if (current) html += '<div class="cd-task-head" title="' + Gongfang._escAttr2(current) + '">当前：' + Gongfang._esc(current) + '</div>';
    if (!list.length) {
      html += '<div class="cd-task-empty">暂无历史目录</div>';
    } else {
      html += '<div class="cd-task-head">最近目录</div>';
      list.forEach(function(p) {
        var sel = current && String(p.path) === String(current);
        html += '<div class="cd-task-item' + (sel ? ' active' : '') + '" data-name="' + Gongfang._escAttr2(p.name || '') + '" data-path="' + Gongfang._escAttr2(p.path || '') + '">' +
          '<span class="cd-task-name">' + Gongfang._esc(p.name || p.path || '') + '</span>' +
          (sel ? '<span class="cd-task-status done">✓</span>' : '') +
          '</div>';
      });
    }
    html += '<div class="cd-task-item cd-task-browse"><span class="cd-task-name">＋ 选择其他文件夹…</span></div>';
    d.innerHTML = html;
    d.addEventListener('click', function(ev) {
      if (ev.target.closest && ev.target.closest('.cd-task-browse')) {
        if (Gongfang._wsBrowseWorkdir) Gongfang._wsBrowseWorkdir(function(p, n) { Gongfang._codeLoadTask(n, p); });
        return;
      }
      var item = ev.target.closest ? ev.target.closest('.cd-task-item[data-path]') : null;
      if (!item) return;
      Gongfang._codeOpenWorkdir(item.getAttribute('data-path'));
    });
    document.body.appendChild(d);
    setTimeout(function() {
      document.addEventListener('mousedown', function h(e) {
        if (!d.contains(e.target)) { d.remove(); document.removeEventListener('mousedown', h); }
      });
    }, 0);
  };
  open();
};

// ★ 新工坊：打开工作目录（设为全局当前目录 + 代码面板激活）
Gongfang._codeOpenWorkdir = async function(dirPath) {
  var opened = null;
  try { if (Gongfang._wsOpenRecent) opened = await Gongfang._wsOpenRecent(dirPath); } catch (_) {}
  if (!opened || !opened.path) return;
  Gongfang._codeLoadTask(opened.name, opened.path);
};

Gongfang._codeLoadTask = function(name, path) {
  var d = document.getElementById('cdTaskDropdown'); if (d) d.remove();
  // 代码模块不受协作模式限制：协作中仍可切换工作目录
  // ★ 与写作面板解耦：代码工作台用自己的 _codeState.activeProject（不写 _writeState，
  //   也不读取写作面板当前目录）。要在代码模式里打开哪个工作目录，在代码模式里自己选。
  Gongfang._codeState.activeProject = { name: name, path: path };
  // 清空已打开的标签，重新加载工作目录
  Gongfang._codeState.openTabs = []; Gongfang._codeState.activeTab = 0; Gongfang._codeState.currentFile = null;
  Gongfang._codeRenderTabs();
  Gongfang._codeRefreshFiles();
  Gongfang._codeAppendOutput({ stream: 'sys', text: '✓ 已打开工作目录「' + name + '」\n' });
  if (Gongfang._showToast) Gongfang._showToast('已打开：' + name);
};

/* ═══════════════════ 右键菜单（选择工作目录 / 新建文件/新建文件夹/复制路径/在文件夹中显示/重命名/删除） ═══════════════════ */
Gongfang._codeCtxIcons = {
  loadtask: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m15 13-3 3-3-3"/></svg>',
  newfile: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v6M9 14h6"/></svg>',
  newfolder: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 10v6M9 13h6"/></svg>',
  copypath: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  reveal: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  rename: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  del: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

Gongfang._codeCtxMenu = function(e, node) {
  e.preventDefault();
  e.stopPropagation();
  var old = document.getElementById('cdCtxMenu');
  if (old) old.remove();
  var path = node ? node.getAttribute('data-path') : '';
  var name = node ? node.getAttribute('data-name') : '';
  var isDir = node ? node.classList.contains('cd-dir') : false;
  var base = Gongfang._codeState.currentRoot || '';
  // 新建目标目录：文件夹→该文件夹；文件→其父目录；空白→当前根
  var newDir = '';
  if (node) {
    if (isDir) newDir = path;
    else { var sep2 = path.indexOf('\\') !== -1 ? '\\' : '/'; newDir = path.substring(0, path.lastIndexOf(sep2)); }
  } else {
    newDir = base;
  }
  var menu = document.createElement('div');
  menu.id = 'cdCtxMenu';
  menu.className = 'cd-ctx-menu';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 250) + 'px';

  // ★ 只有右键「文件」才显示顶部信息区（显示文件名字，不是路径）；文件夹/空白处不显示
  if (node && !isDir) {
    var head = document.createElement('div');
    head.className = 'cd-ctx-head';
    head.innerHTML = '<span class="cd-ctx-head-label">文件</span><span class="cd-ctx-head-name" title="' + Gongfang._escAttr2(name) + '">' + Gongfang._esc(name) + '</span>';
    menu.appendChild(head);
    menu.appendChild(document.createElement('div')).className = 'cd-ctx-sep';
  }

  var mkItem = function(label, icon, fn, cls) {
    var el = document.createElement('div');
    el.className = 'cd-ctx-item' + (cls ? ' ' + cls : '');
    el.innerHTML = '<span class="cd-ctx-ic">' + (icon || '') + '</span><span>' + label + '</span>';
    el.addEventListener('click', function() { fn(); Gongfang._codeCloseCtx(); });
    return el;
  };
  menu.appendChild(mkItem('选择工作目录', Gongfang._codeCtxIcons.loadtask, function() { Gongfang._codeLoadTaskMenu({ bottom: e.clientY, left: e.clientX }); }));
  menu.appendChild(document.createElement('div')).className = 'cd-ctx-sep';
  menu.appendChild(mkItem('新建文件', Gongfang._codeCtxIcons.newfile, function() { Gongfang._codeNewFileIn(newDir); }));
  menu.appendChild(mkItem('新建文件夹', Gongfang._codeCtxIcons.newfolder, function() { Gongfang._codeNewFolderIn(newDir); }));
  menu.appendChild(document.createElement('div')).className = 'cd-ctx-sep';
  menu.appendChild(mkItem('复制路径', Gongfang._codeCtxIcons.copypath, function() { Gongfang._codeCopyPath(path); }));
  menu.appendChild(mkItem('在文件夹中显示', Gongfang._codeCtxIcons.reveal, function() { Gongfang._codeReveal(path); }));
  menu.appendChild(mkItem('重命名', Gongfang._codeCtxIcons.rename, function() { Gongfang._codeRename(path); }));
  menu.appendChild(mkItem('删除', Gongfang._codeCtxIcons.del, function() { Gongfang._codeDeleteNode(path); }, 'danger'));
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('mousedown', function h2(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', h2); }
    });
  }, 0);
};

Gongfang._codeCloseCtx = function() {
  var m = document.getElementById('cdCtxMenu');
  if (m) m.remove();
};

/* ── 自定义输入框（Electron 不支持 window.prompt，用模态框替代） ── */
Gongfang._codePrompt = function(title, placeholder, cb, initial) {
  Gongfang._codeClosePrompt();
  var d = document.createElement('div');
  d.id = 'cdNamePrompt'; d.className = 'dw-modal'; d.style.display = 'flex';
  d.innerHTML = '<div class="dw-modal-box dw-prompt-box">' +
    '<div class="dw-modal-head"><span class="dw-modal-title">' + Gongfang._esc(title) + '</span>' +
      '<button class="dw-btn" onclick="Gongfang._codeClosePrompt()">✕</button></div>' +
    '<div class="dw-modal-body"><input id="cdNamePromptInput" class="dw-prompt-input" type="text" placeholder="' + Gongfang._esc(placeholder || '') + '" autocomplete="off" maxlength="60"></div>' +
    '<div class="dw-modal-foot">' +
      '<button class="dw-btn" onclick="Gongfang._codeClosePrompt()">取消</button>' +
      '<button class="dw-btn dw-btn-primary" id="cdNamePromptOk">确定</button>' +
    '</div></div>';
  document.body.appendChild(d);
  var done = false;
  var finish = function(ok) {
    if (done) return; done = true;
    var val = ok ? (d.querySelector('#cdNamePromptInput').value || '').trim() : '';
    d.remove(); Gongfang._codePromptFinish = null;
    cb(val || null);
  };
  Gongfang._codePromptFinish = finish;
  var input = d.querySelector('#cdNamePromptInput');
  if (initial) input.value = initial;
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { finish(false); } });
  d.querySelector('#cdNamePromptOk').addEventListener('click', function() { finish(true); });
  d.addEventListener('mousedown', function(e) { if (e.target === d) finish(false); });
  input.focus();
  if (initial) { try { input.select(); } catch(e) {} }
};
Gongfang._codeClosePrompt = function() { if (Gongfang._codePromptFinish) Gongfang._codePromptFinish(false); };

/* ── 文件操作实现 ── */
Gongfang._codeNewFileIn = function(dir) {
  var root = dir || Gongfang._codeState.currentRoot || Gongfang._codeWorkDir();
  if (!root) { if (Gongfang._showToast) Gongfang._showToast('请先选择工作目录'); return; }
  Gongfang._codePrompt('新建文件', '请输入文件名（含扩展名，如 new.py）', function(name) {
    if (!name) return;
    var safe = name.replace(/[<>:"/\\|?*]/g, '_');
    if (!window.electronAPI || !window.electronAPI.writeFileContent) return;
    window.electronAPI.writeFileContent(root.replace(/[\\/]+$/, '') + '/' + safe, '').then(function(r) {
      if (Gongfang._showToast) Gongfang._showToast(r && r.success ? '已创建文件' : (r && r.error || '创建失败'));
      Gongfang._codeRefreshFiles();
    });
  }, 'new.py');
};
Gongfang._codeNewFolderIn = function(dir) {
  var root = dir || Gongfang._codeState.currentRoot || Gongfang._codeWorkDir();
  if (!root) { if (Gongfang._showToast) Gongfang._showToast('请先选择工作目录'); return; }
  Gongfang._codePrompt('新建文件夹', '请输入文件夹名称', function(name) {
    if (!name) return;
    var safe = name.replace(/[<>:"/\\|?*]/g, '_');
    if (!window.electronAPI || !window.electronAPI.createFolder) return;
    window.electronAPI.createFolder(root.replace(/[\\/]+$/, '') + '/' + safe).then(function(r) {
      if (Gongfang._showToast) Gongfang._showToast(r && r.success ? '已创建文件夹' : (r && r.error || '创建失败'));
      Gongfang._codeRefreshFiles();
    });
  }, '新文件夹');
};
Gongfang._codeRename = function(path) {
  var sep = path.indexOf('\\') !== -1 ? '\\' : '/';
  var oldName = path.substring(path.lastIndexOf(sep) + 1);
  Gongfang._codePrompt('重命名', '请输入新名称', function(name) {
    if (!name || name === oldName) return;
    var safe = name.replace(/[<>:"/\\|?*]/g, '_');
    var newPath = path.substring(0, path.lastIndexOf(sep) + 1) + safe;
    if (!window.electronAPI || !window.electronAPI.renamePath) return;
    window.electronAPI.renamePath(path, newPath).then(function(r) {
      if (Gongfang._showToast) Gongfang._showToast(r && r.success ? '已重命名' : (r && r.error || '重命名失败'));
      Gongfang._codeRefreshFiles();
    });
  }, oldName);
};
// ★ 复制路径 = 复制相对当前求解目录的相对路径
Gongfang._codeCopyPath = function(path) {
  var base = Gongfang._codeState.currentRoot || Gongfang._codeWorkDir() || '';
  var rel = path;
  if (base) {
    var nb = base.replace(/[\\/]+$/, '');
    if (path.indexOf(nb) === 0) rel = path.substring(nb.length + 1);
  }
  navigator.clipboard.writeText(rel).then(function() { if (Gongfang._showToast) Gongfang._showToast('已复制路径：' + rel); });
};
Gongfang._codeReveal = function(path) {
  var sep = path.indexOf('\\') !== -1 ? '\\' : '/';
  var dir = path;
  // 若路径以扩展名结尾（是文件）→ 打开其所在目录；文件夹 → 打开自身
  if (/\.\w{1,8}$/.test(path)) dir = path.substring(0, path.lastIndexOf(sep));
  if (window.electronAPI && window.electronAPI.openInFinder) window.electronAPI.openInFinder(dir);
};
Gongfang._codeDeleteNode = function(path) {
  var d = document.getElementById('cdCtxMenu'); if (d) d.remove();
  if (!window.confirm('确定删除该文件/文件夹吗？此操作不可恢复。')) return;
  if (!window.electronAPI || !window.electronAPI.deletePath) return;
  window.electronAPI.deletePath(path).then(function(r) {
    if (Gongfang._showToast) Gongfang._showToast(r && r.success ? '已删除' : (r && r.error || '删除失败'));
    Gongfang._codeRefreshFiles();
  });
};

/* 单击文件 → 打开（自动识别类型） */
document.addEventListener('click', function(e) {
  var f = e.target.closest ? e.target.closest('.cd-file') : null;
  if (!f) return;
  Gongfang._codeOpenFile(f.getAttribute('data-path'), f.getAttribute('data-name'));
}, true);

/* ═══════════════════ 打开文件（代码 / 图片 / CSV / 文本） ═══════════════════ */
Gongfang._codeOpenFile = function(path, name) {
  var s = Gongfang._codeState;
  var ext = (name || '').split('.').pop().toLowerCase();
  var isImage = /^(png|jpe?g|gif|svg|webp|bmp)$/.test(ext);
  var isCsv = ext === 'csv' || ext === 'tsv';
  // ★ 所有打开的文件都进标签栏（文件卡片），图片/表格也在标题栏显示
  var existing = s.openTabs.findIndex(function(t){ return t.path === path; });
  if (existing !== -1) { s.activeTab = existing; Gongfang._codeSwitchTab(existing); return; }
  if (!window.electronAPI || !window.electronAPI.readFileContent) return;
  window.electronAPI.readFileContent(path).then(function(r) {
    if (!r || !r.success) { if (Gongfang._showToast) Gongfang._showToast('读取失败'); return; }
    var tab = { path: path, name: name || 'untitled', text: r.text || '', type: isImage ? 'image' : (isCsv ? 'csv' : 'code') };
    if (isImage) tab.dataUrl = (r.binary && r.binary.dataUrl) || r.dataUrl || '';
    s.openTabs.push(tab); s.activeTab = s.openTabs.length - 1; s.currentFile = path;
    Gongfang._codeRenderTabs();
    Gongfang._codeSwitchTab(s.activeTab);
  }).catch(function(){});
};

// 中间编辑器 vs 预览 切换
Gongfang._codeShowEditor = function() {
  var pre = Gongfang._codeE('cdPreviewPane');
  var ta = Gongfang._codeE('cdEditorArea');
  if (pre) pre.style.display = 'none';
  var cm = Gongfang._codeState.editor;
  if (cm) { cm.getWrapperElement().style.display = ''; setTimeout(function(){ cm.refresh(); }, 40); }
  if (ta) ta.style.display = 'none';
};
Gongfang._codeShowPreview = function(html, name) {
  var pre = Gongfang._codeE('cdPreviewPane');
  var body = Gongfang._codeE('cdPreviewBody');
  var cm = Gongfang._codeState.editor;
  if (pre) pre.style.display = 'flex';
  if (cm) cm.getWrapperElement().style.display = 'none';
  if (body) body.innerHTML = html || '';
  // ★ Ctrl+滚轮缩放 + 鼠标拖动
  if (body && !body._zoomBound) {
    body._zoomBound = true;
    body._zoomScale = 1;
    body._panX = 0; body._panY = 0; body._dragging = false;
    body.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var img = body.querySelector('img');
      if (!img) return;
      body._zoomScale = Math.max(0.1, Math.min(10, body._zoomScale * (e.deltaY < 0 ? 1.1 : 0.9)));
      img.style.transform = 'translate(' + body._panX + 'px,' + body._panY + 'px) scale(' + body._zoomScale + ')';
      img.style.transformOrigin = 'center center';
      var caption = body.querySelector('.cd-preview-caption');
      if (caption) caption.textContent = (name || '') + ' (' + Math.round(body._zoomScale * 100) + '%)';
    }, { passive: false });
    body.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      var img = body.querySelector('img');
      if (!img || body._zoomScale <= 1) return;
      body._dragging = true;
      body._dragStartX = e.clientX - body._panX;
      body._dragStartY = e.clientY - body._panY;
      body.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!body._dragging) return;
      var img = body.querySelector('img');
      if (!img) return;
      body._panX = e.clientX - body._dragStartX;
      body._panY = e.clientY - body._dragStartY;
      img.style.transform = 'translate(' + body._panX + 'px,' + body._panY + 'px) scale(' + body._zoomScale + ')';
    });
    document.addEventListener('mouseup', function() {
      if (body._dragging) { body._dragging = false; body.style.cursor = ''; }
    });
    body.addEventListener('dblclick', function() {
      var img = body.querySelector('img');
      if (!img) return;
      body._zoomScale = 1; body._panX = 0; body._panY = 0;
      img.style.transform = '';
      var caption = body.querySelector('.cd-preview-caption');
      if (caption) caption.textContent = name || '';
    });
  }
};

/* ═══════════════════ Markdown 渲染模式（打开 .md 时运行按钮变渲染） ═══════════════════ */
Gongfang._codeRunIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
Gongfang._codeRenderIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-4-5H9z"/><circle cx="13" cy="11.5" r="2.5"/><path d="m15.5 14 2.5 2.5"/></svg>';
Gongfang._codeEditIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';

// 切换运行按钮 ⇄ 渲染按钮
Gongfang._codeSetMdMode = function(on) {
  var btn = Gongfang._codeE('cdRunBtn');
  if (!btn) return;
  Gongfang._codeState.mdRender = false;
  if (on) {
    btn.onclick = function() { Gongfang._codeToggleMdRender(); };
    btn.title = '渲染 Markdown（点击切换预览/编辑）';
    btn.innerHTML = Gongfang._codeRenderIcon;
    btn.classList.add('render-mode');
  } else {
    btn.onclick = function() { Gongfang._codeRun(); };
    btn.title = '运行 Ctrl+Enter';
    btn.innerHTML = Gongfang._codeRunIcon;
    btn.classList.remove('render-mode');
  }
};

// ★ 根据当前文件类型设置「运行/停止」按钮可用性：
//   .py 代码文件 → 运行 + 停止都可用；.md → 运行（渲染）可用、停止置灰；其余（图片/表格/数据等）→ 都置灰
//   ★ 三个按钮始终都在（保存/运行/停止），宽度恒定；不适用时置灰不可点（.na），而不是隐藏。
Gongfang._codeSetFileActions = function(name) {
  var runBtn = Gongfang._codeE('cdRunBtn'), stopBtn = Gongfang._codeE('cdStopBtn');
  var ext = (name || '').split('.').pop().toLowerCase();
  var isCode = ext === 'py' || ext === 'pyw';
  var isMd = ext === 'md';
  if (runBtn) {
    runBtn.style.visibility = 'visible';
    var runUsable = isCode || isMd;
    runBtn.disabled = !runUsable;
    runBtn.classList.toggle('na', !runUsable);
  }
  if (stopBtn) {
    stopBtn.style.visibility = 'visible';
    var stopUsable = isCode;
    stopBtn.disabled = !stopUsable;
    stopBtn.classList.toggle('na', !stopUsable);
  }
};

// 渲染 Markdown 为可读文本 / 回到编辑
Gongfang._codeToggleMdRender = function() {
  var s = Gongfang._codeState;
  var btn = Gongfang._codeE('cdRunBtn');
  if (!s.mdRender) {
    var text = s.editor ? s.editor.getValue() : '';
    var html = (typeof Gongfang._renderMarkdown === 'function') ? Gongfang._renderMarkdown(text) : '<pre>' + Gongfang._esc(text) + '</pre>';
    Gongfang._codeShowPreview('<article class="cd-md-render">' + html + '</article>', 'markdown 预览');
    s.mdRender = true;
    if (btn) { btn.innerHTML = Gongfang._codeEditIcon; btn.title = '回到编辑'; }
  } else {
    Gongfang._codeShowEditor();
    s.mdRender = false;
    if (btn) { btn.innerHTML = Gongfang._codeRenderIcon; btn.title = '渲染 Markdown'; }
  }
};

/* ═══════════════════ CSV 表格编辑区 ═══════════════════ */
Gongfang._codeShowCsvEditor = function(path, name, text) {
  var sep = /\.tsv$/i.test(name) ? '\t' : ',';
  var rows = Gongfang._codeParseCsv(text, sep);
  Gongfang._codeState.csv = { path: path, name: name, rows: rows, sep: sep, dirty: false };
  var pre = Gongfang._codeE('cdPreviewPane');
  var body = Gongfang._codeE('cdPreviewBody');
  var cm = Gongfang._codeState.editor;
  if (pre) pre.style.display = 'flex';
  if (cm) cm.getWrapperElement().style.display = 'none';
  if (!body) return;
  // ★ 类似任务卡片：不单独加标题栏/保存按钮，直接渲染表格（保存走 Ctrl+S）
  var html = '<div class="cd-csv-editor"><div class="cd-csv-scroll"><table class="cd-csv-table">';
  // 表头
  if (rows.length) {
    html += '<thead><tr>';
    rows[0].forEach(function(c, ci) {
      html += '<th><input data-r="0" data-c="' + ci + '" value="' + Gongfang._escAttr2(c) + '"></th>';
    });
    html += '</tr></thead>';
  }
  // 数据行
  html += '<tbody>';
  for (var i = 1; i < rows.length; i++) {
    html += '<tr>';
    for (var j = 0; j < rows[i].length; j++) {
      html += '<td><input data-r="' + i + '" data-c="' + j + '" value="' + Gongfang._escAttr2(rows[i][j]) + '"></td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  body.innerHTML = html;
  // 编辑标记 dirty
  body.querySelectorAll('.cd-csv-table input').forEach(function(inp) {
    inp.addEventListener('input', function() { Gongfang._codeState.csv.dirty = true; });
  });
};

// 简单 CSV/TSV 解析（支持引号字段）
Gongfang._codeParseCsv = function(text, sep) {
  sep = sep || ',';
  var rows = [];
  var row = [], field = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length) { rows.push(row); row = []; }
      } else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
};

// 保存 CSV 表格
Gongfang._codeCsvSave = function() {
  var csv = Gongfang._codeState.csv;
  if (!csv) return;
  var body = Gongfang._codeE('cdPreviewBody');
  if (!body) return;
  var rows = [];
  var thead = body.querySelectorAll('.cd-csv-table thead tr');
  if (thead.length) {
    var hdr = [];
    thead[0].querySelectorAll('input').forEach(function(inp) { hdr.push(inp.value); });
    rows.push(hdr);
  }
  body.querySelectorAll('.cd-csv-table tbody tr').forEach(function(tr) {
    var r = [];
    tr.querySelectorAll('input').forEach(function(inp) { r.push(inp.value); });
    rows.push(r);
  });
  var text = Gongfang._codeToCsv(rows, csv.sep);
  if (!window.electronAPI || !window.electronAPI.writeFileContent) return;
  window.electronAPI.writeFileContent(csv.path, text).then(function(r) {
    if (Gongfang._showToast) Gongfang._showToast(r && r.success ? '已保存表格' : (r && r.error || '保存失败'));
    if (r && r.success) Gongfang._codeState.csv.dirty = false;
  });
};
Gongfang._codeToCsv = function(rows, sep) {
  sep = sep || ',';
  return rows.map(function(row) {
    return row.map(function(c) {
      var s = String(c == null ? '' : c);
      if (/[",\n\r\t]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(sep);
  }).join('\n');
};

// ★ 当前编辑文件在左侧文件树里高亮（打开/切换标签后同步，不重读目录树）
Gongfang._codeMarkActiveFile = function() {
  var body = Gongfang._codeE('cdFilesBody');
  if (!body) return;
  var cur = Gongfang._codeState.currentFile;
  body.querySelectorAll('.cd-file').forEach(function(item) {
    item.classList.toggle('active', item.getAttribute('data-path') === cur);
  });
};

Gongfang._codeSwitchTab = function(i) {
  var s = Gongfang._codeState;
  if (!s.openTabs[i]) return;
  var t = s.openTabs[i];
  s.activeTab = i; s.currentFile = t.path;
  Gongfang._codeRenderTabs();
  // ★ 左侧文件树同步高亮当前文件（与标签高亮对应）
  if (Gongfang._codeMarkActiveFile) Gongfang._codeMarkActiveFile();
  if (t.type === 'image') {
    // 图片 → 中间预览
    Gongfang._codeShowPreview('<div class="cd-preview-img"><img src="' + t.dataUrl + '" alt=""><div class="cd-preview-caption">' + Gongfang._esc(t.name) + '</div></div>', t.name);
  } else if (t.type === 'csv') {
    // 表格 → 可编辑表格
    Gongfang._codeShowCsvEditor(t.path, t.name, t.text);
  } else {
    // 代码 → 编辑器
    var ext = (t.name || '').split('.').pop().toLowerCase();
    var mode = 'python';
    if (ext === 'tex') mode = 'stex';
    else if (!/^(py)$/.test(ext)) mode = ext === 'json' ? { name: 'javascript', json: true } : 'text';
    Gongfang._codeShowEditor();
    if (Gongfang._codeState.editor) {
      try { Gongfang._codeState.editor.setOption('mode', mode); } catch(e) {}
      Gongfang._codeState.editor.setValue(t.text); Gongfang._codeState.editor.clearHistory(); Gongfang._codeState.dirty = false;
    }
    var ph = Gongfang._codeE('cdEditorPh'); if (ph) ph.style.display = 'none';
    Gongfang._codeSetMdMode(/\.md$/i.test(t.name || ''));
  }
  // ★ 按当前文件类型显隐运行/停止按钮（非代码/非 md 只留保存）
  Gongfang._codeSetFileActions(t.name || '');
};
Gongfang._codeCloseTab = function(i) {
  var s = Gongfang._codeState;
  if (i < 0 || i >= s.openTabs.length) return;
  s.openTabs.splice(i, 1);
  if (s.openTabs.length === 0) {
    s.currentFile = null; s.activeTab = 0;
    Gongfang._codeShowEditor();
    if (Gongfang._codeState.editor) { Gongfang._codeState.editor.setValue(''); Gongfang._codeState.editor.clearHistory(); }
    var ph = Gongfang._codeE('cdEditorPh'); if (ph) ph.style.display = 'flex';
    Gongfang._codeSetFileActions(''); // 无文件：只保留保存
    // ★ 所有文件标签关闭 → 项目自然退出（与写作面板一致）
    Gongfang._codeUnloadProject();
  } else {
    if (s.activeTab >= s.openTabs.length) s.activeTab = s.openTabs.length - 1;
    Gongfang._codeSwitchTab(s.activeTab);
  }
  Gongfang._codeRenderTabs();
};

// ★ 退出当前项目：清空工作目录与活动项目，文件栏回到「点击加载」
Gongfang._codeUnloadProject = function() {
  var s = Gongfang._codeState;
  s.currentRoot = '';
  s.csv = null;
  s.activeProject = null;   // 只清代码工作台自己的项目，不影响写作面板
  Gongfang._codeSetMdMode(false);
  Gongfang._codeRefreshFiles();
  Gongfang._codeAppendOutput({ stream: 'sys', text: '\n已退出项目（点「＋ 新建」选择工作目录可载入其它任务）\n' });
};
Gongfang._codeRenderTabs = function() {
  var s = Gongfang._codeState;
  var bar = Gongfang._codeE('cdTabs');
  if (!bar) return;
  if (!s.openTabs.length) { bar.innerHTML = '<span class="cd-tabs-empty">未打开文件</span>'; return; }
  var html = '';
  s.openTabs.forEach(function(t, i) {
    var active = i === s.activeTab;
    // ★ 标签 = 文件卡片：带文件类型图标 + 名称 + 关闭
    //   ★ 脏点（未保存标记）只在确实 dirty 时占位，平时不渲染，避免把「图标-文件名」间距撑大
    html += '<div class="cd-tab' + (active ? ' active' : '') + '" onclick="Gongfang._codeSwitchTab(' + i + ')" title="' + Gongfang._escAttr2(t.name || '') + '">' +
      '<span class="cd-tab-ic">' + Gongfang._codeIcon(t.name || '') + '</span>' +
      '<span class="cd-tab-name">' + Gongfang._esc(t.name) + '</span>' +
      '<span class="cd-tab-close" onclick="event.stopPropagation();Gongfang._codeCloseTab(' + i + ')">×</span>' +
      '</div>';
  });
  bar.innerHTML = html;
  // ★ 标签栏边缘渐隐（溢出时，等布局稳定再算）
  if (Gongfang._applyTabBarFade) setTimeout(function() { Gongfang._applyTabBarFade(bar); }, 0);
  // ★ 左侧文件树同步高亮当前文件（打开/切换/关闭后保持一致）
  if (Gongfang._codeMarkActiveFile) Gongfang._codeMarkActiveFile();
};
Gongfang._codeNew = function() {
  var s = Gongfang._codeState;
  s.openTabs.push({ path: null, name: 'untitled.py', text: '' });
  s.activeTab = s.openTabs.length - 1; s.currentFile = null;
  Gongfang._codeRenderTabs();
  Gongfang._codeShowEditor();
  if (Gongfang._codeState.editor) { try { Gongfang._codeState.editor.setOption('mode', 'python'); } catch(e) {} Gongfang._codeState.editor.setValue(''); Gongfang._codeState.editor.clearHistory(); Gongfang._codeState.dirty = false; Gongfang._codeState.editor.focus(); }
  Gongfang._codeSetMdMode(false);
};
Gongfang._codeSave = function() {
  var s = Gongfang._codeState;
  // CSV 表格正在编辑 → 保存表格
  if (s.csv && s.csv.dirty) { Gongfang._codeCsvSave(); return; }
  if (!Gongfang._codeState.editor) return;
  var tab = s.openTabs[s.activeTab];
  var content = Gongfang._codeState.editor.getValue();
  if (tab && tab.path && window.electronAPI) {
    window.electronAPI.writeFileContent(tab.path, content).then(function(r){
      Gongfang._codeState.dirty = false; Gongfang._codeRenderTabs();
      Gongfang._showToast ? Gongfang._showToast(r && r.success ? '已保存' : '保存失败') : null;
    });
  } else {
    var wd = Gongfang._codeState.currentRoot || Gongfang._codeWorkDir() || Gongfang._codeProjectRoot();
    if (!wd) { if (Gongfang._showToast) Gongfang._showToast('请先加载一个任务'); return; }
    if (window.electronAPI && window.electronAPI.saveFileDialog) window.electronAPI.saveFileDialog('code.py').then(function(p){
      // ★ saveFileDialog 返回 { canceled, filePath }；用户已确认的另存为路径视为可信，跳过白名单拦截
      if (p && !p.canceled && p.filePath) window.electronAPI.writeFileContent(p.filePath, content, { trusted: true }).then(function(r) {
        if (r && r.success && tab) { tab.path = p.filePath; s.dirty = false; s.currentFile = p.filePath; Gongfang._codeRenderTabs(); }
        Gongfang._showToast ? Gongfang._showToast(r && r.success ? (r.path ? ('已保存：' + r.path) : '已保存') : ('保存失败' + (r && r.error ? '：' + r.error : ''))) : null;
      });
    });
  }
};

/* ═══════════════════ 运行 ═══════════════════ */
Gongfang._codeRun = function() {
  if (!Gongfang._codeState.editor || Gongfang._codeState.running) return;
  var code = Gongfang._codeState.editor.getValue();
  if (!code.trim()) { Gongfang._codeAppendOutput({ stream: 'err', text: '请输入代码\n' }); return; }
  Gongfang._codeAppendOutput({ stream: 'sys', text: '\n▶ 运行中…\n' });
  Gongfang._codeSetRunning(true);
  var wd = Gongfang._codeState.currentRoot || Gongfang._codeWorkDir() || Gongfang._codeProjectRoot() || undefined;
  // ★ 传入当前编辑文件路径：让主进程把临时脚本写到同目录，`__file__` 相对路径（数据/结果）能正确解析
  var curPath = Gongfang._codeState.currentFile || undefined;
  if (!window.electronAPI || !window.electronAPI.codeRun) { Gongfang._codeAppendOutput({ stream: 'err', text: '[运行失败] 代码运行服务不可用\n' }); Gongfang._codeSetRunning(false); Gongfang._codeSetStatusError(); return; }
  window.electronAPI.codeRun({ code: code, cwd: wd || undefined, path: curPath, timeoutMs: 120000 }).then(function(r) {
    Gongfang._codeSetRunning(false);
    if (r && !r.success && r.error) {
      Gongfang._codeAppendOutput({ stream: 'err', text: '\n[错误] ' + r.error + '\n' });
      Gongfang._codeSetStatusError();
    } else {
      Gongfang._codeAppendOutput({ stream: 'sys', text: '\n✓ 运行结束（退出码 ' + (r ? r.code : '?') + '）\n' });
    }
    Gongfang._codeSnapshotRun(r);
    if (Gongfang._codeState.editor) Gongfang._codeState.editor.focus();
  }).catch(function(e) {
    Gongfang._codeSetRunning(false);
    Gongfang._codeSetStatusError();
    Gongfang._codeAppendOutput({ stream: 'err', text: '\n[运行失败] ' + (e && e.message || e) + '\n' });
  });
};
Gongfang._codeStop = function() {
  if (Gongfang._codeState.runId && window.electronAPI) window.electronAPI.codeStop(Gongfang._codeState.runId);
  Gongfang._codeAppendOutput({ stream: 'sys', text: '\n■ 已停止\n' });
  Gongfang._codeSetRunning(false);
};
Gongfang._codeSetRunning = function(run) {
  Gongfang._codeState.running = run;
  var runBtn = Gongfang._codeE('cdRunBtn'), stopBtn = Gongfang._codeE('cdStopBtn');
  var status = Gongfang._codeE('cdRunStatus');
  if (runBtn) {
    runBtn.disabled = run;
    runBtn.classList.toggle('compiling', run);
    // ★ 替换按钮内容：运行中显示转圈SVG，结束恢复播放三角
    if (run) {
      runBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:cdRunSpin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    } else {
      runBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    }
  }
  if (stopBtn) stopBtn.disabled = !run;
  if (status) status.innerHTML = run ? '<span class="cd-dot run"></span>运行中' : '<span class="cd-dot idle"></span>就绪';
};
Gongfang._codeSetStatusError = function() {
  var status = Gongfang._codeE('cdRunStatus');
  if (status) status.innerHTML = '<span class="cd-dot err"></span>失败';
};
Gongfang._codeUpdateStatus = function() {
  var status = Gongfang._codeE('cdRunStatus');
  if (!status || Gongfang._codeState.running) return;
  status.innerHTML = '';
};
Gongfang._codeAppendOutput = function(data) {
  var out = Gongfang._codeE('cdRunOutput');
  if (!out) return;
  if (data && data.id) Gongfang._codeState.runId = data.id;
  var text = data ? data.text : '';
  // textarea 模式：直接追加到 value
  out.value = (out.value || '') + text;
  // ★ 输出上限（2MB）：截断最旧内容
  if (out.value.length > 2000000) out.value = out.value.slice(-2000000);
  out.scrollTop = out.scrollHeight;
};
Gongfang._codeClearOutput = function() {
  var out = Gongfang._codeE('cdRunOutput');
  if (out) out.value = '';
};

// ★ 终端展开 / 收起（照搬写作编译输出逻辑）
Gongfang._codeToggleTerminal = function() {
  var bar = Gongfang._codeE('cdTerminal');
  var btn = Gongfang._codeE('cdTerminalToggle');
  if (!bar) return;
  var on = bar.classList.toggle('expanded');
  Gongfang._codeState.terminalOpen = on;
  if (btn) btn.style.transform = on ? '' : 'rotate(180deg)';
  if (Gongfang._codeState.editor) setTimeout(function(){ Gongfang._codeState.editor.refresh(); }, 50);
};


// ★ 运行结束后快照到右栏「输出记录」，并扫描本次运行产生的图片/表格产物
Gongfang._codeSnapshotRun = function(r) {
  var out = Gongfang._codeE('cdRunOutput');
  var text = out ? (out.value || out.textContent || '') : '';
  var time = new Date();
  var hh = String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0') + ':' + String(time.getSeconds()).padStart(2, '0');
  var ok = !r || r.success;
  var entry = { time: hh, ok: ok, code: r ? r.code : '?', text: text.slice(-2000), artifacts: [] };
  Gongfang._codeState.runHistory.push(entry);
  if (Gongfang._codeState.runHistory.length > 50) Gongfang._codeState.runHistory.shift();
  Gongfang._codeRenderHistory();
  // ★ 异步扫描本次运行的输出产物（运行期间修改的 图片/CSV/Excel）
  var root = Gongfang._codeState.currentRoot || (typeof Gongfang._codeWorkDir === 'function' ? Gongfang._codeWorkDir() : null);
  if (root && window.electronAPI && window.electronAPI.scanOutputFiles) {
    var since = Date.now() - 120000; // 最近 2 分钟内
    window.electronAPI.scanOutputFiles(root, since).then(function(res) {
      if (res && res.success && res.files && res.files.length) {
        entry.artifacts = res.files.slice(0, 20);
        Gongfang._codeRenderHistory();
      }
    }).catch(function() {});
  }
};
Gongfang._codeRenderHistory = function() {
  var body = Gongfang._codeE('cdOutputBody');
  if (!body) return;
  var list = Gongfang._codeState.runHistory;
  if (!list.length) { body.innerHTML = '<div class="cd-empty">运行代码后，每次输出会记录在这里</div>'; return; }
  var html = '';
  for (var i = list.length - 1; i >= 0; i--) {
    var h = list[i];
    var firstLine = (h.text.split('\n').filter(function(l){ return l.trim(); })[0] || '(空输出)').slice(0, 40);
    html += '<div class="cd-his-item ' + (h.ok ? 'ok' : 'fail') + '" onclick="this.classList.toggle(\'open\')">' +
      '<div class="cd-his-head"><span class="cd-his-time">' + h.time + '</span><span class="cd-his-status">' + (h.ok ? '✓ 完成' : '✗ 异常') + '（退出码 ' + h.code + '）</span></div>' +
      '<div class="cd-his-summary">' + Gongfang._esc(firstLine) + '</div>';
    if (h.artifacts && h.artifacts.length) {
      html += '<div class="cd-his-art-label">本次输出产物（' + h.artifacts.length + '）</div>';
      html += '<div class="cd-his-artifacts">';
      h.artifacts.forEach(function(a) {
        var isImg = /\.(png|jpe?g|gif|svg|webp)$/i.test(a.name);
        var isTbl = /\.(csv|xlsx?)$/i.test(a.name);
        html += '<div class="cd-art-card" data-path="' + Gongfang._escAttr2(a.path) + '" data-name="' + Gongfang._escAttr2(a.name) + '" title="点击在中间打开">' +
          (isImg ? '<span class="cd-art-ic img">' + Gongfang._codeFileIcons(a.name) + '</span>' : (isTbl ? '<span class="cd-art-ic tbl">' + Gongfang._codeFileIcons(a.name) + '</span>' : '<span class="cd-art-ic">' + Gongfang._codeFileIcons(a.name) + '</span>')) +
          '<span class="cd-art-name">' + Gongfang._esc(a.name) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '<pre class="cd-his-detail">' + Gongfang._esc(h.text) + '</pre>' +
      '</div>';
  }
  body.innerHTML = html;
  body.querySelectorAll('.cd-art-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      e.stopPropagation();
      Gongfang._codeOpenFile(card.getAttribute('data-path'), card.getAttribute('data-name'));
    });
  });
};

Gongfang._esc = function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); };
Gongfang._escAttr = function(s) { return String(s || '').replace(/'/g, "\\'").replace(/\\/g, '/'); };
// ★ HTML 属性安全转义（保留路径原样，供 getAttribute 读回真实值）
Gongfang._escAttr2 = function(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
};

// ── 扩展注册（v2.6 改造追加）──
// 原 code.js 内容保持不变；以下把自身注册为基座扩展。
// 基座通过 file:// 协议注入本 main.js 后，window.Gongfang._codeInit 即可被 write.js 的 _writeSwitchMode 调用。
(function() {
  window.GongfangExtension = window.GongfangExtension || {};
  window.GongfangExtension.code = {
    id: 'code',
    activate: function(api, hostEl) {
      if (typeof Gongfang._codeInit === 'function') Gongfang._codeInit();
    },
    deactivate: function() {
      // 切走时停止运行中的 Python 进程（如有）
      try {
        if (Gongfang._codeState && Gongfang._codeState.running && Gongfang._codeState.runId) {
          if (window.electronAPI && window.electronAPI.codeStop) {
            window.electronAPI.codeStop(Gongfang._codeState.runId);
          }
        }
      } catch (e) {}
    }
  };
  try { console.log('[ext] code 已注册'); } catch (e) {}
})();
