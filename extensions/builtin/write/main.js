// Gongfang v2.6 — 写作面板（双栏 LaTeX 编辑器 + 向上展开的编译日志栏）
window.Gongfang = window.Gongfang || {};

Gongfang._writeState = {
  projects: [], activeProject: null, activeFilePath: null, activeFileName: null,
  editor: null, compileBusy: false,
  _saveTimer: null, _initDone: false,
  mainTexFile: null, // ★ 固定的编译主文件（用户手动设定）
  compileEngine: 'xelatex', // ★ 编译引擎：xelatex / pdflatex / latexmk
  codeTheme: 'color', // ★ 代码配色主题
  openFiles: [], // ★ 已打开的文件标签页
  _dirtyFiles: {}, // ★ 已修改但尚未落盘的文件内容缓存：规范化路径 -> content（编译前一次性刷盘）
  activePaperDir: '论文', // ★ v2.8.1 工坊论文版本：当前查看/编辑的版本目录名（论文/ 或 论文-*/）
  paperVersions: [], // ★ v2.8.1 工坊论文版本清单 [{dirName,isMain,model,status}]
  mainTexByVersion: {}, // ★ v2.8.1 每个版本的编译主文件（绝对路径），切换版本时独立记忆
};

// ═══════════════════════ Init ═══════════════════════
Gongfang._writeInit = async function() {
  if (Gongfang._writeState._initDone) { Gongfang._writeLoadProjects(); return; }
  Gongfang._writeState._initDone = true;
  await Gongfang._writeLoadProjects();
  document.getElementById('writePanel').addEventListener('click', function(e) {
    if (!e.target.closest('.write-dropdown') && !e.target.closest('.write-menu-btn') && !e.target.closest('.write-newtask-btn')) {
      document.getElementById('writeProjectMenu').style.display = 'none';
      document.getElementById('writeOutlineMenu').style.display = 'none';
      var sMenu = document.getElementById('writeCompileSettingsMenu');
      if (sMenu) sMenu.style.display = 'none';
    }
    // ★ 关闭工具栏下拉菜单
    if (!e.target.closest('.write-tb-dropdown')) {
      Gongfang._writeCloseDropdowns();
    }
  });
  // ★ 标签栏点击：切换 / 关闭
  var tabsEl = document.getElementById('writeTabs');
  if (tabsEl) {
    tabsEl.addEventListener('click', function(e) {
      var closeBtn = e.target.closest('.write-tab-close');
      if (closeBtn) {
        var tab = closeBtn.closest('.write-tab');
        if (tab) Gongfang._writeCloseTab(tab.getAttribute('data-path'));
        return;
      }
      var nameEl = e.target.closest('.write-tab-name');
      if (nameEl) {
        var tab2 = nameEl.closest('.write-tab');
        if (tab2) Gongfang._writeSwitchFile(tab2.getAttribute('data-path'));
      }
    });

    // ★ 侧栏文件浏览器：点击文件项打开
    var filesTreeEl = document.getElementById('writeFilesTree');
    if (filesTreeEl) {
      filesTreeEl.addEventListener('click', function(e) {
        var item = e.target.closest('.write-files-item');
        if (!item) return;
        var fp = item.getAttribute('data-path');
        var fn = item.getAttribute('data-name');
        if (fp) Gongfang._writeOpenFile(fp, fn);
      });
    }

    // ★ 分隔拖拽条 + 恢复拖拽尺寸 + 侧栏/预览 开关状态
    Gongfang._writeRestoreSizes();
    Gongfang._writeInitResizers();
    Gongfang._writeRestoreSidebarState();
    Gongfang._writeRestorePreviewState();

    // ★ 恢复已安装插件的按钮
    if (Gongfang._restorePluginBtns) Gongfang._restorePluginBtns();

    // ★ 标签拖拽排序（左右拖动切换位置）
    var writeDragPath = null;
    tabsEl.addEventListener('dragstart', function(e) {
      var tab = e.target.closest('.write-tab');
      if (tab) { writeDragPath = tab.getAttribute('data-path'); e.dataTransfer.effectAllowed = 'move'; }
    });
    tabsEl.addEventListener('dragover', function(e) {
      if (writeDragPath) e.preventDefault();
    });
    tabsEl.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!writeDragPath) return;
      var targetTab = e.target.closest('.write-tab');
      if (!targetTab) return;
      var targetPath = targetTab.getAttribute('data-path');
      if (targetPath === writeDragPath) { writeDragPath = null; return; }
      var st = Gongfang._writeState;
      var fromIdx = st.openFiles.findIndex(function(f) { return f.path === writeDragPath; });
      var toIdx = st.openFiles.findIndex(function(f) { return f.path === targetPath; });
      if (fromIdx < 0 || toIdx < 0) { writeDragPath = null; return; }
      var item = st.openFiles.splice(fromIdx, 1)[0];
      st.openFiles.splice(toIdx, 0, item);
      Gongfang._writeRenderTabs();
      Gongfang._writePersistTabs();
      writeDragPath = null;
    });
    tabsEl.addEventListener('dragend', function() { writeDragPath = null; });
  }

  // ★ 关闭应用/切走前保存当前编辑内容
  window.addEventListener('beforeunload', function() {
    if (Gongfang._writeState.editor && Gongfang._writeState.activeFilePath) {
      try { window.electronAPI.writeFileContent(Gongfang._writeState.activeFilePath, Gongfang._writeGetContent()); } catch(e) {}
    }
  });
  // ★ 切换面板（写→其他）前保存
  window.addEventListener('gongfang-panel-switch', function() {
    if (Gongfang._writeState.editor && Gongfang._writeState.activeFilePath) {
      Gongfang._writeFlushDirtyFiles();
    }
  });

  // ★ 首次进入：渲染初始「编辑器」占位标题
  Gongfang._writeRenderTabs();
};

// ═══════════════════════ 下拉菜单 ═══════════════════════
// ★ 协作模式：隐藏所有「新建/切换任务」按钮（写作/任务/绘图/代码），协作中不能切换任务/项目
Gongfang._writeSetNewTaskCollabDisabled = function(disabled) {
  document.body.classList.toggle('collab-mode', !!disabled);
  var btn = document.getElementById('writeNewTaskBtn');
  if (btn) {
    btn.classList.toggle('collab-disabled', !!disabled);
    // ★ 直接隐藏而非仅变灰：协作中不能点击它弹出任务列表/切换项目
    btn.style.display = disabled ? 'none' : '';
  }
};

Gongfang._writeToggleProjectMenu = async function() {
  // ★ 协作模式守卫：不能打开项目菜单/切换项目
  if (Gongfang._collabState && Gongfang._collabState.active) {
    if (typeof Gongfang._showToast === 'function') Gongfang._showToast('协作模式中不能切换项目，请先退出协作');
    return;
  }
  var menu = document.getElementById('writeProjectMenu');
  var btn = document.getElementById('writeNewTaskBtn');
  document.getElementById('writeOutlineMenu').style.display = 'none';
  var sMenu = document.getElementById('writeCompileSettingsMenu');
  if (sMenu) sMenu.style.display = 'none';
  if (menu.style.display === 'block') { menu.style.display = 'none'; return; }
  var r = btn.getBoundingClientRect(), pr = document.getElementById('writePanel').getBoundingClientRect();
  menu.style.left = (r.left - pr.left) + 'px'; menu.style.top = (r.bottom - pr.top + 8) + 'px';
  menu.style.display = 'block';
  var list = document.getElementById('writeProjectMenuList');
  if (list) list.innerHTML = '<div class="write-dropdown-empty">加载中...</div>';
  // ★ 新工坊：菜单 = 当前目录 + 最近目录 + 选择其他文件夹（不再从固定任务目录同步）
  var data = { recent: [], current: '' };
  try { if (Gongfang._wsGetRecent) data = await Gongfang._wsGetRecent(); } catch (_) {}
  Gongfang._writeRenderProjectMenu(data.recent || [], data.current || '');
};

// ★ 新工坊：渲染工作目录菜单（最近目录 + 选择其他文件夹）
Gongfang._writeRenderProjectMenu = function(recent, current) {
  var list = document.getElementById('writeProjectMenuList');
  if (!list) return;
  var escH = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var escA = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); };
  var html = '';
  if (current) html += '<div class="write-dropdown-head" title="' + escA(current) + '">当前：' + escH(current) + '</div>';
  if (recent && recent.length) {
    html += '<div class="write-dropdown-head">最近目录</div>';
    recent.forEach(function(it) {
      var sel = current && String(it.path) === String(current);
      html += '<div class="write-dropdown-item' + (sel ? ' active' : '') + '" data-wspath="' + escA(it.path) + '" title="' + escA(it.path) + '">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(it.name || it.path) + '</span>' +
        (sel ? '<span style="color:#16a34a;font-weight:700;flex-shrink:0;margin-right:4px;">✓</span>' : '') +
        '<button type="button" class="write-recent-del" data-wsdel="' + escA(it.path) + '" title="从历史中移除" style="flex-shrink:0;width:20px;height:20px;border:none;border-radius:4px;background:transparent;color:#d4d4d8;font-size:12px;line-height:1;cursor:pointer;padding:0;">✕</button>' +
        '</div>';
    });
    html += '<div class="write-dropdown-item" id="writeClearRecentBtn" style="justify-content:center;color:#ef4444;"><span>清空历史</span></div>';
  } else {
    html += '<div class="write-dropdown-empty">暂无历史目录</div>';
  }
  html += '<div class="write-dropdown-item write-dropdown-browse" id="writeBrowseDirBtn"><span>＋ 选择其他文件夹…</span></div>';
  list.innerHTML = html;
  list.querySelectorAll('[data-wspath]').forEach(function(el) {
    el.onclick = function(e) {
      if (e && e.target && e.target.closest && e.target.closest('[data-wsdel]')) return;
      Gongfang._writeOpenWorkdir(el.getAttribute('data-wspath'));
    };
  });
  list.querySelectorAll('[data-wsdel]').forEach(function(del) {
    del.onmouseenter = function() { del.style.background = '#fef2f2'; del.style.color = '#ef4444'; };
    del.onmouseleave = function() { del.style.background = 'transparent'; del.style.color = '#d4d4d8'; };
    del.onclick = async function(e) {
      if (e) { e.stopPropagation(); e.preventDefault(); }
      var p = del.getAttribute('data-wsdel');
      if (!p || !Gongfang._wsRemoveRecent) return;
      var updated = await Gongfang._wsRemoveRecent(p);
      if (updated !== null && updated !== undefined) Gongfang._writeRenderProjectMenu(updated, current);
    };
  });
  var c = document.getElementById('writeClearRecentBtn');
  if (c) c.onclick = async function(e) {
    if (e) { e.stopPropagation(); }
    var ok = true;
    try {
      if (typeof Gongfang._showConfirm === 'function') {
        ok = await Gongfang._showConfirm({ title: '清空历史', desc: '确定要清空全部历史目录吗？当前工作目录不受影响。', type: 'warn', confirmText: '清空' });
      }
    } catch (_) { ok = true; }
    if (!ok) return;
    if (!Gongfang._wsClearRecent) return;
    var done = await Gongfang._wsClearRecent();
    if (done) Gongfang._writeRenderProjectMenu([], current);
  };
  var b = document.getElementById('writeBrowseDirBtn');
  if (b) b.onclick = function() { Gongfang._wsBrowseWorkdir(function(p) { return Gongfang._writeOpenWorkdir(p, true); }); };
};

// ★ 新工坊：打开工作目录（先设为当前工作目录，再按项目激活；skipSet=true 时已由浏览流程设置过）
Gongfang._writeOpenWorkdir = async function(dirPath, skipSet) {
  if (Gongfang._collabState && Gongfang._collabState.active) {
    if (typeof Gongfang._showToast === 'function') Gongfang._showToast('协作模式中不能切换项目，请先退出协作');
    return;
  }
  var opened = skipSet ? { path: dirPath, name: '' } : await Gongfang._wsOpenRecent(dirPath);
  if (!opened || !opened.path) return;
  var name = opened.name || String(opened.path).split(/[\\/]/).pop() || '工作目录';
  var arr = Gongfang._writeState.projects || [];
  var found = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].path === opened.path) { found = arr[i]; break; }
  }
  if (!found) {
    found = { name: name, path: opened.path, texFile: null, createdAt: Date.now() };
    arr.unshift(found);
    // ★ 同名旧项改名，避免 _writeOpenProject 按名查找撞车
    for (var j = 1; j < arr.length; j++) {
      if (arr[j] && arr[j].name === found.name && arr[j].path !== found.path) arr[j].name = arr[j].name + '（旧）';
    }
    Gongfang._writeState.projects = arr;
  }
  var menu = document.getElementById('writeProjectMenu');
  if (menu) menu.style.display = 'none';
  await Gongfang._writeOpenProject(found.name);
};

// ★ 旧任务同步入口保留（不再从任务同步，直接 no-op，避免残留调用报错）
Gongfang._writeSyncProjectsFromTasks = async function() {
  return; // ★ 新工坊：不再从任务同步（保留空壳兼容残留调用）
};

// ★ 大纲：LaTeX 章节结构


// ★ 章节命令级别
Gongfang._writeSectionLevelMap = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };


// ★ 打开文件并定位到指定行
Gongfang._writeNavigateToLine = async function(filePath, line) {
  if (Gongfang._writeState.activeFilePath !== filePath) {
    await Gongfang._writeOpenFile(filePath, filePath.split(/[\\/]/).pop());
  }
  var tries = 0;
  var doIt = function() {
    var ed = Gongfang._writeState.editor;
    if (ed && ed.lineCount() > line && tries < 30) {
      ed.setCursor({ line: line, ch: 0 });
      ed.scrollIntoView({ line: line, ch: 0 }, 100);
      ed.focus();
      return;
    }
    tries++;
    if (tries < 30) setTimeout(doIt, 60);
  };
  setTimeout(doIt, 120);
};

// ★ 扫描单个 tex 文件中的章节命令（不递归 \input，仅本文件）
Gongfang._writeScanFileSections = async function(filePath) {
  var text;
  // ★ 若该文件就是编辑器当前打开的文件，用编辑器的实时内容（未保存的章节也生效，无需先点保存）
  if (Gongfang._writeState.activeFilePath === filePath && Gongfang._writeState.editor) {
    text = Gongfang._writeState.editor.getValue();
  } else {
    var r;
    try { r = await window.electronAPI.readFileContent(filePath); } catch(e) { return []; }
    text = (r && r.text !== undefined) ? r.text : (typeof r === 'string' ? r : '');
  }
  var entries = [];
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*%/.test(line)) continue; // 跳过注释行
    var m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/.exec(line);
    if (m) entries.push({ level: Gongfang._writeSectionLevelMap[m[1]], title: m[2].trim(), file: filePath, line: i });
  }
  return entries;
};

// ★ 大纲：按文件分组列出项目内所有 tex 文件
//   不再依赖主编译文件的 \input 链——即使某个 tex 未被 论文.tex 引入、或文件内没有章节命令，
//   也会以"文件"节点的形式显示并可点击打开；文件节点下内嵌其章节命令，点击章节跳转到对应行。
//   target 可选：不传渲染到下拉菜单，传入渲染到左侧栏大纲区。
// ★ 大纲渲染代数令牌：并发调用时只保留最新一次的结果，避免异步渲染互相追加导致内容重复两遍
Gongfang._writeOutlineGen = 0;

Gongfang._writeRenderOutlineMenu = async function(target) {
  var gen = ++Gongfang._writeOutlineGen;
  var tree = target || document.getElementById('writeOutlineMenuTree');
  var p = Gongfang._writeState.activeProject;
  if (!p) { tree.innerHTML = '<div class="write-dropdown-empty">请先选择项目</div>'; return; }
  tree.innerHTML = '<div class="write-dropdown-empty">加载中...</div>';
  try {
    var fr = await window.electronAPI.writeGetFileTree(p.path);
    var texFiles = [];
    var flatten = function(n) { if (!n) return; if (n.type === 'directory') (n.children || []).forEach(flatten); else if (/\.tex$/i.test(n.name)) texFiles.push(n); };
    if (fr && fr.success && fr.tree) {
      // ★ v2.8.1 大纲只扫活动版本目录下的 tex —— 避免 转word/共享文件区/渲染 等软件生成目录里的
      //   论文转换.tex、流程图N.tex 混进大纲污染结构；也不再写死“论文”，跟随版本切换
      var _activeOutlineDir = (Gongfang._writeState && Gongfang._writeState.activePaperDir) || '论文';
      var paperDir = null;
      for (var pi = 0; pi < (fr.tree.children || []).length; pi++) {
        if (fr.tree.children[pi].type === 'directory' && fr.tree.children[pi].name === _activeOutlineDir) { paperDir = fr.tree.children[pi]; break; }
      }
      if (!paperDir) {
        for (var qi = 0; qi < (fr.tree.children || []).length; qi++) {
          if (fr.tree.children[qi].type === 'directory' && fr.tree.children[qi].name === '论文') { paperDir = fr.tree.children[qi]; break; }
        }
      }
      if (paperDir) (paperDir.children || []).forEach(flatten);
      else flatten(fr.tree); // 兜底：没有版本目录时再扫全项目
    }

    // ★ 排序：数字前缀（0. 1. 5.1.1.…）按层级升序，其余按名称
    var numPrefix = function(name) { var m = /^(\d+(?:\.\d+)*)/.exec(name); return m ? m[1].split('.').map(Number) : null; };
    texFiles.sort(function(a, b) {
      var pa = numPrefix(a.name), pb = numPrefix(b.name);
      if (pa && pb) {
        var len = Math.max(pa.length, pb.length);
        for (var k = 0; k < len; k++) { var d = (pa[k] || 0) - (pb[k] || 0); if (d) return d; }
      } else if (pa) return -1; else if (pb) return 1;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });

    tree.innerHTML = '';
    if (!texFiles.length) { tree.innerHTML = '<div class="write-dropdown-empty">未找到 tex 文件</div>'; return; }

    // ★ 所有文件的章节合并成一份层级大纲（不再每个文件一个顶层节点，避免与上方「文件」列表重复显示两遍）
    var roots = [];
    var stack = [{ level: -1, title: '', file: null, line: null, children: roots }];
    for (var i = 0; i < texFiles.length; i++) {
      var sections = await Gongfang._writeScanFileSections(texFiles[i].path);
      sections.forEach(function(e) {
        var item = { title: e.title, level: e.level, file: e.file, line: e.line, children: [] };
        while (stack.length && stack[stack.length - 1].level >= e.level) stack.pop();
        stack[stack.length - 1].children.push(item);
        stack.push(item);
      });
    }
    // ★ 完全没有章节命令时退回按文件列出（至少能点开文件）
    if (!roots.length) {
      texFiles.forEach(function(t) { roots.push({ title: t.name, level: 0, file: t.path, line: 0, children: [] }); });
    }
    // ★ 计算最小标题层级，用于 一级/二级/三级 配色（一级=红、二级=蓝、三级=橙）
    var minLv = 99;
    (function calc(ns) { ns.forEach(function(n) { if (n.level < minLv) minLv = n.level; calc(n.children); }); })(roots);
    if (minLv === 99) minLv = 0;

    var renderNode = function(nodes, parentEl) {
      nodes.forEach(function(n) {
        var hasKids = n.children.length > 0;
        var row = document.createElement('div');
        var lvCls = n.level <= minLv ? 'lv1' : (n.level === minLv + 1 ? 'lv2' : 'lv3');
        row.className = 'write-tree-row ' + lvCls;
        // ★ 记录该章节所属文件，用于按当前编辑文件高亮
        row.setAttribute('data-file', n.file || '');
        row.style.cssText = 'padding:0 8px;line-height:22px;font-size:12px';
        var kidsWrap = null;
        if (hasKids) {
          var toggle = document.createElement('span');
          toggle.className = 'write-tree-toggle open';
          // ★ 展开/收起用共享图标包的 chevron 箭头（大纲是标题层级不是文件，不用文件夹图标）
          toggle.innerHTML = Gongfang.ICONS.next;
          row.insertBefore(toggle, row.firstChild);
          kidsWrap = document.createElement('div');
          kidsWrap.className = 'write-tree-children';
          renderNode(n.children, kidsWrap);
          toggle.onclick = function(e) { e.stopPropagation(); var cl = kidsWrap.style.display === 'none'; kidsWrap.style.display = cl ? 'block' : 'none'; toggle.classList.toggle('open', cl); };
        } else {
          // ★ 无子级的行补一个同宽占位，保证同一层级标题对齐（尤其全部折叠时）
          var spacer = document.createElement('span');
          spacer.style.cssText = 'width:13px;flex-shrink:0;display:inline-block';
          row.insertBefore(spacer, row.firstChild);
        }
        var nameSpan = document.createElement('span');
        nameSpan.className = 'write-tree-name';
        nameSpan.style.cursor = 'pointer';
        nameSpan.textContent = n.title || '(空标题)';
        row.appendChild(nameSpan);
        nameSpan.onclick = function() {
          var om = document.getElementById('writeOutlineMenu'); if (om) om.style.display = 'none';
          Gongfang._writeNavigateToLine(n.file, n.line);
        };
        parentEl.appendChild(row);
        if (kidsWrap) parentEl.appendChild(kidsWrap);
      });
    };
    // ★ 只渲染最新一次调用的结果（旧调用直接丢弃），渲染前先清空防止内容累积
    if (gen !== Gongfang._writeOutlineGen) return;
    tree.innerHTML = '';
    renderNode(roots, tree);
    // ★ 高亮当前编辑文件对应的章节
    try { Gongfang._writeMarkActiveOutline(); } catch(e) {}
  } catch(e) { if (gen === Gongfang._writeOutlineGen) tree.innerHTML = '<div class="write-dropdown-empty">读取失败</div>'; }
};

// ★ 侧栏大纲：渲染到左侧栏大纲区（复用大纲构建逻辑）
Gongfang._writeRenderOutlineTree = function() {
  var el = document.getElementById('writeOutlineTree');
  if (!el) return;
  return Gongfang._writeRenderOutlineMenu(el);
};

// ★ 大纲防抖刷新：编辑停笔 800ms 后重建（章节结构随代码实时更新）
Gongfang._writeOutlineRefreshTimer = null;
Gongfang._writeScheduleOutlineRefresh = function() {
  if (Gongfang._writeOutlineRefreshTimer) clearTimeout(Gongfang._writeOutlineRefreshTimer);
  Gongfang._writeOutlineRefreshTimer = setTimeout(function() {
    Gongfang._writeOutlineRefreshTimer = null;
    try { Gongfang._writeRenderOutlineTree(); } catch(e) {}
  }, 800);
};

// ★ 侧栏文件浏览器：展示当前任务「论文 / 图片」文件夹内的文件，点击打开
// ★ 文件类型图标：统一用共享 vscode-icons 图标集（renderer/shared/file-icons.js，非手绘）
Gongfang._writeFileIcon = function(name) {
  return Gongfang.fileIcon(name);
};

// ★ PDF 仅在编译预览区展示，不出现在文件卡片/侧栏文件列表里
Gongfang._writeIsPdf = function(name) {
  return /\.pdf$/i.test(String(name || ''));
};
// ★ 统一路径分隔符后再比对：同一文件可能因 / 与 \\ 混用导致被当成两个标签重复打开，
//   开关/激活态判定也依赖它，否则会出现重复标签、激活高亮错乱。
Gongfang._writeNormPath = function(fp) { return String(fp || '').replace(/\\/g, '/'); };

// ★ v2.8.1 工坊论文版本：目录名 → 显示标签（主版本/论文·xxx）
Gongfang._writePaperDirLabel = function(dirName) {
  if (!dirName || dirName === '论文') return '论文（主版本）';
  return String(dirName).replace(/^论文-/, '论文·');
};

// ★ v2.8.1 工坊论文版本：从磁盘枚举（含主版本论文/），数据源与执行区一致
Gongfang._writeRefreshPaperVersions = async function() {
  var st = Gongfang._writeState;
  var p = st.activeProject;
  if (!p) { st.paperVersions = []; return []; }
  var items = [];
  try {
    if (window.electronAPI && window.electronAPI.listPaperVersions) {
      var r = await window.electronAPI.listPaperVersions({ workDir: p.path });
      if (r && r.success && Array.isArray(r.versions) && r.versions.length) items = r.versions;
    }
  } catch (_) {}
  if (!items.length) {
    // 兜底：至少保证主版本可选
    try {
      var fr = await window.electronAPI.writeGetFileTree(p.path);
      var hasMain = false, vers = [];
      if (fr && fr.success && fr.tree) {
        (fr.tree.children || []).forEach(function(n) {
          if (n && n.type === 'directory' && (n.name === '论文' || /^论文-/.test(n.name))) {
            vers.push(n.name);
            if (n.name === '论文') hasMain = true;
          }
        });
      }
      if (vers.length) items = vers.map(function(d) { return { dirName: d, isMain: d === '论文', model: '', status: '' }; });
      else items = [{ dirName: '论文', isMain: true, model: '', status: '' }];
    } catch (_) {
      items = [{ dirName: '论文', isMain: true, model: '', status: '' }];
    }
  }
  items.sort(function(a, b) {
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;
    return String(a.dirName).localeCompare(String(b.dirName), undefined, { numeric: true });
  });
  st.paperVersions = items;
  if (!st.activePaperDir || !items.some(function(v) { return v.dirName === st.activePaperDir; })) {
    st.activePaperDir = (items[0] && items[0].dirName) || '论文';
  }
  try { Gongfang._writeRenderPaperVerSel(); } catch (_) {}
  return items;
};

// ★ v2.8.1 渲染文件区标题右侧的版本小下拉（与执行区同数据源）
Gongfang._writeRenderPaperVerSel = function() {
  var sel = document.getElementById('writePaperVerSel');
  var st = Gongfang._writeState;
  if (!sel) return;
  var items = st.paperVersions || [];
  if (!items.length) { sel.style.display = 'none'; return; }
  sel.style.display = '';
  var cur = sel.value;
  sel.innerHTML = items.map(function(v) {
    var label = Gongfang._writePaperDirLabel(v.dirName);
    if (v.model) label += ' · ' + v.model;
    if (v.status === 'draft') label += '（草稿）';
    return '<option value="' + String(v.dirName).replace(/"/g, '&quot;') + '">' + String(label).replace(/</g, '&lt;') + '</option>';
  }).join('');
  if (st.activePaperDir && items.some(function(v) { return v.dirName === st.activePaperDir; })) sel.value = st.activePaperDir;
  else if (cur && items.some(function(v) { return v.dirName === cur; })) sel.value = cur;
  else sel.value = (items[0] && items[0].dirName) || '论文';
  st.activePaperDir = sel.value || st.activePaperDir || '论文';
  if (!sel.onchange) {
    sel.onchange = function() { Gongfang._writeSwitchPaperVersion(sel.value); };
  }
};

// ★ v2.8.1 工坊切换论文版本：记忆各版 mainTex，刷新文件树/大纲/编译设置/预览
Gongfang._writeSwitchPaperVersion = async function(dirName) {
  var st = Gongfang._writeState;
  if (!st.activeProject) return;
  // 记忆当前版本的主文件
  try {
    if (st.activePaperDir && st.mainTexFile) st.mainTexByVersion[st.activePaperDir] = st.mainTexFile;
  } catch (_) {}
  st.activePaperDir = dirName || '论文';
  // 恢复目标版本的主文件（记忆优先，否则自动检测该版本目录）
  var restored = st.mainTexByVersion[st.activePaperDir] || null;
  if (!restored) {
    try {
      var fr = await window.electronAPI.writeGetFileTree(st.activeProject.path);
      var cands = [];
      var findDir = function(n) {
        if (!n) return null;
        if (n.type === 'directory' && n.name === st.activePaperDir) return n;
        if (n.children) { for (var i = 0; i < n.children.length; i++) { var f = findDir(n.children[i]); if (f) return f; } }
        return null;
      };
      var dir = (fr && fr.success && fr.tree) ? findDir(fr.tree) : null;
      var flat = function(n) { if (!n) return; if (n.type === 'directory') (n.children || []).forEach(flat); else if (/\.tex$/i.test(n.name)) cands.push(n); };
      if (dir) flat(dir);
      if (cands.length) {
        var def = cands.filter(function(x) { return x.name === '论文.tex'; })[0] || cands.filter(function(x) { return x.name === 'main.tex'; })[0] || cands[0];
        if (def) restored = def.path;
      }
    } catch (_) {}
  }
  if (restored) {
    st.mainTexFile = restored;
    try { st.mainTexByVersion[st.activePaperDir] = restored; } catch (_) {}
  }
  try { Gongfang._writeRenderPaperVerSel(); } catch (_) {}
  try { await Gongfang._writeRenderFileBrowser(); } catch (_) {}
  try { Gongfang._writeRenderOutlineTree(); } catch (_) {}
  try { Gongfang._writeRenderCompileSettings(); } catch (_) {}
  try { await Gongfang._writeRefreshVersionPdf(); } catch (_) {}
  try { Gongfang._writePersistTabs(); } catch (_) {}
};

// ★ v2.8.1 执行区切版本时同步工坊（同名版本存在才切，不存在忽略）
Gongfang._writeSyncPaperVersion = async function(dirName) {
  try {
    var st = Gongfang._writeState;
    if (!st.activeProject || !dirName) return;
    var items = st.paperVersions || [];
    if (!items.length) { try { items = await Gongfang._writeRefreshPaperVersions(); } catch (_) {} }
    if ((items || []).some(function(v) { return v.dirName === dirName; })) {
      if (st.activePaperDir !== dirName) await Gongfang._writeSwitchPaperVersion(dirName);
    }
  } catch (_) {}
};

// ★ v2.8.1 按活动版本刷新右侧 PDF 预览（无 PDF 则清空，避免残留他版）
Gongfang._writeRefreshVersionPdf = async function() {
  try {
    var st = Gongfang._writeState;
    var p = st.activeProject;
    if (!p) return;
    var dir = st.activePaperDir || '论文';
    var pdfScan = await window.electronAPI.listDirFiles(p.path + '/' + dir);
    var pdfFile = null;
    if (pdfScan && pdfScan.files) {
      pdfFile = pdfScan.files.filter(function(f) { return f.name === '论文.pdf'; })[0] || null;
    }
    if (pdfFile) {
      Gongfang._writePdfState._pdfPath = pdfFile.path;
      Gongfang._writePdfRenderSingle(pdfFile.path);
    } else {
      Gongfang._writePdfState._pdfPath = null;
      var pdfPane = document.getElementById('writePreviewPane');
      if (pdfPane) { pdfPane.innerHTML = ''; Gongfang._writePdfUpdateUI(); }
    }
  } catch (_) {}
};

// ★ 判断文件路径是否属于当前项目目录（路径前缀防误判：projA 不应匹配 projAB）
//   用于恢复 .gongfang-write.json 时过滤掉指向其他任务/项目的绝对路径，避免「任务A 编译任务B」。
Gongfang._writePathInProject = function(filePath, projectPath) {
  var fp = Gongfang._writeNormPath(filePath);
  var pp = Gongfang._writeNormPath(projectPath);
  if (!fp || !pp) return false;
  if (fp === pp) return true;
  var ppSlash = pp.endsWith('/') ? pp : pp + '/';
  return fp.indexOf(ppSlash) === 0;
};

// ★ 绝对路径 → 相对项目根的相对路径（用 / 分隔）。
//   .gongfang-write.json 持久化时一律写相对路径：协作共享区会把项目复制到不同设备/不同路径，
//   绝对路径（盘符、用户名、目录）会随机器不同而失效；相对路径只要项目结构不变就跨设备有效。
//   若文件不在项目内（理不应发生），则原样返回绝对路径（保留旧行为）。
Gongfang._writeToRelPath = function(absPath, projectPath) {
  if (!absPath) return '';
  var ap = Gongfang._writeNormPath(absPath);
  var pp = Gongfang._writeNormPath(projectPath);
  if (!Gongfang._writePathInProject(ap, pp)) return ap;
  var rel = ap.substring(pp.length);
  return rel.replace(/^\/+/, '');
};

// ★ 配置值 → 绝对路径：
//   - 相对路径：拼接项目根得到绝对路径（跨设备可移植）。
//   - 绝对路径（旧格式残留）：仅当属于当前项目才保留，否则返回 null 丢弃（避免「任务A 编译任务B」）。
Gongfang._writeToAbsPath = function(value, projectPath) {
  if (!value) return null;
  var v = Gongfang._writeNormPath(String(value).trim());
  var pp = Gongfang._writeNormPath(projectPath);
  if (!pp) return null;
  var isAbs = (/^[a-zA-Z]:\//.test(v)) || v.indexOf('//') === 0;
  if (isAbs) return Gongfang._writePathInProject(v, pp) ? v : null;
  var joined = (pp.endsWith('/') ? pp : pp + '/') + v.replace(/^\/+/, '');
  return joined;
};

// ★ 判断路径是否为绝对路径（盘符 C:/ 或 UNC //）。
Gongfang._writeIsAbsPath = function(v) {
  var s = Gongfang._writeNormPath(String(v || ''));
  return (/^[a-zA-Z]:\//.test(s)) || s.indexOf('//') === 0;
};

// ★ 计算从「tex 文件所在目录」到目标图片的相对路径（跨设备可移植）。
//   编译时工作目录 = tex 所在目录（见 direct-compile），LaTeX 相对引用均据此解析。
//   论文惯例「../求解/... / 共享文件区/...」都是从 tex 目录出发的相对路径，
//   绝对路径（盘符/用户名/目录）会随设备不同而失效。
Gongfang._writeRelFromTex = function(imageSrc, texDecoAbs) {
  var img = Gongfang._writeNormPath(imageSrc);
  var texBase = Gongfang._writeNormPath(texDecoAbs || '').replace(/\/[^\/]*$/, '');
  if (!texBase) return img.split('/').pop() || img;
  var a = img.split('/');
  var b = texBase.split('/');
  var common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  var ups = [];
  for (var i = common; i < b.length; i++) ups.push('..');
  var rel = ups.concat(a.slice(common)).join('/');
  return rel || a[a.length - 1];
};

// ★ 把任意待插入图片规整为「项目内可被编译解析的相对路径」：
//   - 图片已在项目内 → 直接换算成相对 tex 目录的路径。
//   - 图片在项目外（本地选图）→ 先拷入项目「图片/」再换算，保证项目自包含、跨设备可移植。
Gongfang._writePrepareImageForTex = async function(srcPath, projectPath, texDecoAbs) {
  var src = Gongfang._writeNormPath(srcPath);
  var pp = Gongfang._writeNormPath(projectPath);
  if (src && pp && !Gongfang._writePathInProject(src, pp)) {
    var name = String(srcPath).split(/[\\/]/).pop();
    var dest = (pp.endsWith('/') ? pp : pp + '/') + '图片/' + name;
    try {
      var c = await window.electronAPI.copyFileToPath(src, dest);
      if (c && c.success) src = dest;
    } catch (e) {}
  }
  var texAbs = texDecoAbs || Gongfang._writeState.activeFilePath;
  if (!texAbs && pp) {
    var mt = Gongfang._writeState.mainTexFile;
    texAbs = mt ? (pp + '/' + mt) : '';
  }
  return Gongfang._writeRelFromTex(src, texAbs);
};

Gongfang._writeRenderFileBrowser = async function() {
  var el = document.getElementById('writeFilesTree');
  var title = document.getElementById('writeFilesTitle');
  var p = Gongfang._writeState.activeProject;
  if (!el) return;
  if (title) title.textContent = p ? p.name : '文件';
  if (!p) { el.innerHTML = '<div class="write-sidebar-empty">未选择工作目录，点右上「＋ 新建」选择</div>'; return; }
  el.innerHTML = '<div class="write-sidebar-empty">加载中...</div>';
  try {
    var fr = await window.electronAPI.writeGetFileTree(p.path);
    if (!fr || !fr.success || !fr.tree) { el.innerHTML = '<div class="write-sidebar-empty">读取失败</div>'; return; }
    // ★ v2.8.1 多版本：默认展示活动版本目录内容（不再写死“论文”）；「图片」文件夹若有则跟在后面
    var activeDir = Gongfang._writeState.activePaperDir || '论文';
    var paperDir = null, imgDir = null;
    (fr.tree.children || []).forEach(function(n) {
      if (n.type !== 'directory') return;
      if (n.name === activeDir && !paperDir) paperDir = n;
      else if (n.name === '图片') imgDir = n;
    });
    // 兼容：活动版本目录不存在（如被删除）则回退主版本
    if (!paperDir) {
      (fr.tree.children || []).forEach(function(n) {
        if (n.type === 'directory' && n.name === '论文' && !paperDir) paperDir = n;
      });
      if (paperDir) Gongfang._writeState.activePaperDir = '论文';
    }
    if (!paperDir && !imgDir) { el.innerHTML = '<div class="write-sidebar-empty">该项目暂无「' + activeDir + '/图片」文件夹</div>'; return; }
    var html = '';
    // ★ 版本归属条：当前显示的是哪个版本目录
    if (paperDir) html += '<div class="write-files-dir">' + escHtml(Gongfang._writePaperDirLabel(paperDir.name)) + '</div>';
    var activePath = Gongfang._writeState.activeFilePath;
    var emit = function(dir) {
      (dir.children || []).filter(function(n) { return n.type === 'file' && !Gongfang._writeIsPdf(n.name); }).forEach(function(f) {
        var isTex = /\.tex$/i.test(f.name);
        var isActive = (f.path === activePath);
        // ★ 图标类型类（配色对齐代码工作台 .cd-ficon）
        var icCls = 'file';
        if (isTex) icCls = 'tex';
        else if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(f.name)) icCls = 'img';
        else if (/\.csv$/i.test(f.name)) icCls = 'csv';
        else if (/\.(md|txt)$/i.test(f.name)) icCls = 'md';
        else if (/\.(py|js|ts|json)$/i.test(f.name)) icCls = 'py';
        html += '<div class="write-files-item' + (isTex ? ' tex' : '') + (isActive ? ' active' : '') + '" data-path="' + escAttr(f.path) + '" data-name="' + escAttr(f.name) + '" title="' + escAttr(f.name) + '" oncontextmenu="Gongfang._writeFileCtx(event, this)">' +
          '<span class="write-file-ic ' + icCls + '">' + Gongfang._writeFileIcon(f.name) + '</span>' +
          '<span class="write-file-name">' + escHtml(f.name) + '</span>' +
          '</div>';
      });
    };
    if (paperDir) emit(paperDir);
    if (imgDir) { html += '<div class="write-files-dir">图片</div>'; emit(imgDir); }
    el.innerHTML = html || '<div class="write-sidebar-empty">（空）</div>';
    // ★ 点击打开文件由 writeInit 里 #writeFilesTree 的委托处理负责，这里不再单独绑定，避免重复打开
  } catch(e) { el.innerHTML = '<div class="write-sidebar-empty">读取失败</div>'; }
};

// ★ 当前编辑文件高亮（打开/切换文件后同步，不重读目录树）
Gongfang._writeMarkActiveFile = function() {
  var el = document.getElementById('writeFilesTree');
  if (!el) return;
  var ap = Gongfang._writeState.activeFilePath;
  el.querySelectorAll('.write-files-item').forEach(function(item) {
    item.classList.toggle('active', item.getAttribute('data-path') === ap);
  });
};

// ★ 大纲高亮当前编辑文件对应的章节（按 data-file 匹配）
Gongfang._writeMarkActiveOutline = function() {
  var el = document.getElementById('writeOutlineTree');
  if (!el) return;
  var ap = Gongfang._writeState.activeFilePath;
  el.querySelectorAll('.write-tree-row').forEach(function(row) {
    row.classList.toggle('active', row.getAttribute('data-file') === ap);
  });
};

// ═══════════ 文件右键菜单：新建 tex / 重命名 / 删除 ═══════════
Gongfang._writeFileCtx = function(e, el) {
  e.preventDefault(); e.stopPropagation();
  var old = document.getElementById('writeCtxMenu'); if (old) old.remove();
  var path = el.getAttribute('data-path') || '';
  var name = el.getAttribute('data-name') || '';
  var menu = document.createElement('div');
  menu.id = 'writeCtxMenu';
  menu.className = 'write-ctx-menu';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 170) + 'px';
  var mk = function(label, cls, fn) {
    var it = document.createElement('div');
    it.className = 'write-ctx-item' + (cls ? ' ' + cls : '');
    it.textContent = label;
    it.addEventListener('click', function() { Gongfang._writeCloseCtx(); fn(); });
    return it;
  };
  menu.appendChild(mk('新建文件 (.tex)', '', function() { Gongfang._writeNewTexFile(path); }));
  menu.appendChild(document.createElement('div')).className = 'write-ctx-sep';
  menu.appendChild(mk('重命名', '', function() { Gongfang._writeRenameFile(path); }));
  menu.appendChild(mk('删除', 'danger', function() { Gongfang._writeDeleteFile(path, name); }));
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('mousedown', function h(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', h); } });
  }, 0);
};
Gongfang._writeCloseCtx = function() {
  var m = document.getElementById('writeCtxMenu');
  if (m) m.remove();
};

// ★ 新建 tex 文件（右键文件所在目录 / 默认「论文」目录）
Gongfang._writeNewTexFile = function(refPath) {
  var root = Gongfang._writeState.activeProject && Gongfang._writeState.activeProject.path;
  if (!root) { Gongfang._showToast('请先选择任务'); return; }
  var sep = root.indexOf('\\') !== -1 ? '\\' : '/';
  var dir = root + sep + (Gongfang._writeState.activePaperDir || '论文');
  if (refPath) {
    var rs = refPath.indexOf('\\') !== -1 ? '\\' : '/';
    dir = refPath.substring(0, refPath.lastIndexOf(rs));
  }
  if (typeof Gongfang._showPrompt !== 'function') { Gongfang._showToast('输入弹窗不可用'); return; }
  Gongfang._showPrompt({
    title: '新建文件',
    desc: '在「' + dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() + '」目录创建 .tex 文件',
    value: '新建章节.tex',
    confirmText: '创建'
  }).then(function(name) {
    if (!name) return;
    var nm = String(name).trim();
    if (!nm) return;
    if (!/\.tex$/i.test(nm)) nm += '.tex';
    var safe = nm.replace(/[<>:"/\\|?*]/g, '_');
    var full = dir.replace(/[\\/]+$/, '') + sep + safe;
    if (!window.electronAPI || !window.electronAPI.writeFileContent) return;
    window.electronAPI.writeFileContent(full, '% ' + safe + '\n').then(function(r) {
      Gongfang._showToast(r && r.success ? '已创建 ' + safe : (r && r.error || '创建失败'));
      Gongfang._writeRenderFileBrowser();
      Gongfang._writeRenderOutlineTree();
      // ★ 创建成功后自动打开编辑
      if (r && r.success) Gongfang._writeOpenFile(full, safe);
    });
  });
};

// ★ 重命名文件
Gongfang._writeRenameFile = async function(path) {
  if (!path) return;
  var sep = path.indexOf('\\') !== -1 ? '\\' : '/';
  var oldName = path.substring(path.lastIndexOf(sep) + 1);
  if (typeof Gongfang._showPrompt !== 'function') { Gongfang._showToast('输入弹窗不可用'); return; }
  var newName = await Gongfang._showPrompt({ title: '重命名文件', value: oldName, confirmText: '重命名' });
  if (!newName || newName === oldName) return;
  var safe = String(newName).trim().replace(/[<>:"/\\|?*]/g, '_');
  var newPath = path.substring(0, path.lastIndexOf(sep) + 1) + safe;
  if (!window.electronAPI || !window.electronAPI.renamePath) return;
  var r = await window.electronAPI.renamePath(path, newPath);
  Gongfang._showToast(r && r.success ? '已重命名' : (r && r.error || '重命名失败'));
  // ★ 同步已打开标签 + active 状态（含正在编辑的文件）
  Gongfang._writeState.openFiles.forEach(function(f) { if (f.path === path) { f.path = newPath; f.name = safe; } });
  if (Gongfang._writeState.activeFilePath === path) {
    Gongfang._writeState.activeFilePath = newPath;
    Gongfang._writeState.activeFileName = safe;
  }
  Gongfang._writeRenderTabs();
  Gongfang._writeRenderFileBrowser();
  Gongfang._writeRenderOutlineTree();
};

// ★ 删除文件（样式化二级确认）
Gongfang._writeDeleteFile = function(path, name) {
  if (!path) return;
  if (typeof Gongfang._showConfirm === 'function') {
    Gongfang._showConfirm({
      title: '删除文件',
      desc: '确定要删除「' + name + '」吗？此操作不可恢复。',
      type: 'danger',
      confirmText: '删除',
      confirmClass: 'modal-btn-danger'
    }).then(function(ok) {
      if (ok) Gongfang._writeDoDelete(path, name);
    });
  } else {
    if (window.confirm('确定删除「' + name + '」吗？此操作不可恢复。')) Gongfang._writeDoDelete(path, name);
  }
};

Gongfang._writeDoDelete = async function(path, name) {
  if (!window.electronAPI || !window.electronAPI.deletePath) return;
  var r = await window.electronAPI.deletePath(path);
  Gongfang._showToast(r && r.success ? '已删除' : (r && r.error || '删除失败'));
  // ★ 删除的是当前打开文件 → 关闭标签并清空编辑器（不退出项目）
  if (Gongfang._writeState.activeFilePath === path) {
    Gongfang._writeState.openFiles = Gongfang._writeState.openFiles.filter(function(f) { return f.path !== path; });
    Gongfang._writeState.activeFilePath = null;
    Gongfang._writeState.activeFileName = null;
    Gongfang._writeClearEditor();
    Gongfang._writeRenderTabs();
  }
  // ★ 删除的是预览区正在显示的 PDF → 预览区直接清空
  if (r && r.success && Gongfang._writePdfState && Gongfang._writePdfState._pdfPath === path) {
    Gongfang._writeShowPdfPlaceholder();
  }
  Gongfang._writeRenderFileBrowser();
  Gongfang._writeRenderOutlineTree();
};

// ═══════════════════════ 分隔拖拽 + PDF 开关 ═══════════════════════
// ★ 通用拖拽调整尺寸：dir='h' 竖条拖左右（改列宽），dir='v' 横条拖上下（改区块高度）
//   invert=true：目标在分隔条右侧/下方（拖左变宽 / 拖上变高）
Gongfang._writeMakeResizer = function(handleId, opts) {
  var handle = document.getElementById(handleId);
  if (!handle) return;
  // ★ 用 Pointer Events + setPointerCapture：鼠标拖出窗口也能捕获 pointerup，
  //   彻底修复"松手后还一直跟着鼠标拖、收不回来"的问题
  handle.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    if (e.button !== 0) return; // 仅左键
    var target = document.getElementById(opts.target);
    if (!target) return;
    try { handle.setPointerCapture(e.pointerId); } catch(err) {}
    var startX = e.clientX, startY = e.clientY;
    var rect = target.getBoundingClientRect();
    var startSize = (opts.dir === 'v') ? rect.height : rect.width;
    var isV = (opts.dir === 'v');
    var cEl = opts.container ? document.getElementById(opts.container) : null;
    var cSize = cEl ? cEl.getBoundingClientRect()[isV ? 'height' : 'width'] : 0;
    var handleSize = isV ? handle.offsetHeight : handle.offsetWidth;
    // ★ 动态最小：显式 min，或按容器比例（如 文件区/大纲区 各至少留 1/3）
    var minSize = opts.min;
    if (minSize == null && opts.containerMinPct != null) minSize = cSize * opts.containerMinPct;
    // ★ 动态上限：显式 max 与 容器安全上限 取较小；
    //   另一区域按比例(containerOtherMinPct)或像素(otherMin)保留，防止被拖没
    var maxSize = opts.max;
    if (cEl) {
      var otherMin = (opts.containerOtherMinPct != null) ? cSize * opts.containerOtherMinPct : (opts.otherMin || 0);
      var cMax = cSize - otherMin - handleSize;
      maxSize = (maxSize == null) ? cMax : Math.min(maxSize, cMax);
    }
    var onMove = function(ev) {
      var delta = isV ? (ev.clientY - startY) : (ev.clientX - startX);
      if (opts.invert) delta = -delta;
      var newSize = startSize + delta;
      if (minSize != null) newSize = Math.max(newSize, minSize);
      if (maxSize != null) newSize = Math.min(newSize, maxSize);
      // ★ 存成比例(%)而非固定像素：窗口缩放时各栏等比例变化，
      //   修复"放大窗口时拖宽、缩小后仍是绝对像素把编辑器挤没、拖半天才拉回"
      if (cEl && cSize > 0) {
        target.style.flexBasis = ((newSize / cSize) * 100) + '%';
      } else {
        target.style.flexBasis = newSize + 'px';
      }
    };
    var onUp = function() {
      try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // ★ 持久化拖拽后的尺寸，下次启动恢复
      Gongfang._writePersistSizes();
    };
    document.body.style.cursor = (opts.dir === 'v') ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
};

Gongfang._writeInitResizers = function() {
  // 侧栏宽度：flex-basis 百分比控制（目标在分隔条左侧：拖右变宽）
  Gongfang._writeMakeResizer('wsDividerSidebar', { dir: 'h', target: 'writeSidebar', min: 160, container: 'writeMain', otherMin: 320 });
  // 预览宽度：flex-grow 比例控制（与编辑器共享，最多 1:1、最窄为预览最小宽 160px）
  Gongfang._writeMakePreviewResizer('wsDividerPreview');
  // 文件区高度（目标在分隔条上方）：文件/大纲各至少保留总高度 1/3（大纲拖到顶文件留 1/3，反之亦然）
  Gongfang._writeMakeResizer('wsDividerFilesOutline', { dir: 'v', target: 'writeFilesSection', container: 'writeSidebar', containerMinPct: 1 / 3, containerOtherMinPct: 1 / 3 });
};

// ★ 预览宽度拖拽：用 flex-grow 比例控制「编辑器 : 预览」的共享比例
//   - 预览比例 0.1 ~ 0.5（0.5 = 1:1 平分；更窄由 min-width:160px 兜底）
//   - grow = ratio / (1 - ratio)
//   - 窗口/侧栏变化时比例不变 → 编辑器与预览始终等比例缩放，不再"缩窗后挤没、拖半天才拉回"
Gongfang._writeMakePreviewResizer = function(handleId) {
  var handle = document.getElementById(handleId);
  if (!handle) return;
  handle.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    if (e.button !== 0) return;
    var target = document.getElementById('writePreviewCol');
    var main = document.getElementById('writeMain');
    if (!target || !main) return;
    try { handle.setPointerCapture(e.pointerId); } catch(err) {}
    var startX = e.clientX;
    // 共享宽度 = 主区宽 - 侧栏宽 - 侧栏分隔条 - 预览分隔条
    var sb = document.getElementById('writeSidebar');
    var sbDiv = document.getElementById('wsDividerSidebar');
    var mainW = main.getBoundingClientRect().width;
    var sbW = sb ? sb.getBoundingClientRect().width : 0;
    var fixed = (sbDiv ? sbDiv.offsetWidth : 0) + handle.offsetWidth;
    var shared = Math.max(1, mainW - sbW - fixed);
    var startRatio = Math.min(0.5, Math.max(0.1, target.getBoundingClientRect().width / shared));
    var onMove = function(ev) {
      var delta = ev.clientX - startX;
      var newRatio = startRatio - (delta / shared); // 拖左(负 delta)→ 预览变宽
      newRatio = Math.max(0.1, Math.min(0.5, newRatio));
      target.style.flexGrow = (newRatio / (1 - newRatio));
    };
    var onUp = function() {
      try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      Gongfang._writePersistSizes();
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
};

// ★ 保存侧栏/预览/文件区 的拖拽尺寸（下次启动恢复，不再每次回到最窄默认）
Gongfang._writePersistSizes = function() {
  try {
    var s = {};
    var sb = document.getElementById('writeSidebar');
    var pv = document.getElementById('writePreviewCol');
    var fs = document.getElementById('writeFilesSection');
    if (sb && sb.style.flexBasis) s.sidebar = sb.style.flexBasis;
    if (pv && pv.style.flexGrow) s.preview = pv.style.flexGrow;
    if (fs && fs.style.flexBasis) s.files = fs.style.flexBasis;
    localStorage.setItem('gongfang_write_sizes_v2', JSON.stringify(s));
  } catch(e) {}
};

Gongfang._writeRestoreSizes = function() {
  try {
    var raw = localStorage.getItem('gongfang_write_sizes_v2');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.sidebar) { var el = document.getElementById('writeSidebar'); if (el) el.style.flexBasis = s.sidebar; }
    if (s.preview) { var el2 = document.getElementById('writePreviewCol'); if (el2) el2.style.flexGrow = s.preview; }
    if (s.files) { var el3 = document.getElementById('writeFilesSection'); if (el3) el3.style.flexBasis = s.files; }
  } catch(e) {}
};

// ★ 写作 / 绘图 / 代码 模式下，右栏开关（右侧按钮）：写作=PDF预览，绘图=图形图例，代码=输出记录
Gongfang._writeTogglePreview = function() {
  var mode = (Gongfang._writeState && Gongfang._writeState.currentMode) || 'write';
  var btn = document.getElementById('writeBtnPreviewToggle');
  var hidden;
  if (mode === 'write') {
    var main = document.getElementById('writeMain');
    if (!main) return;
    hidden = main.classList.toggle('write-no-preview');
  } else if (mode === 'draw') {
    var p = document.querySelector('#writeModeDraw .dw-right-col');
    hidden = p ? p.classList.toggle('hidden') : false;
  } else {
    var o = document.querySelector('#writeModeCode .cd-output-col');
    hidden = o ? o.classList.toggle('hidden') : false;
  }
  if (btn) btn.classList.toggle('active', hidden);
  // 布局变化后刷新编辑器与 PDF
  try {
    var ed = Gongfang._writeState && Gongfang._writeState.editor;
    if (ed) setTimeout(function() { ed.refresh(); }, 60);
  } catch(e) {}
  try { localStorage.setItem('gongfang_write_no_preview', hidden ? '1' : '0'); } catch(e) {}
};

// ★ 写作 / 绘图 / 代码 模式下，左栏开关（左侧按钮）：写作=文件/大纲侧栏，绘图/代码=项目文件区
Gongfang._writeToggleSidebar = function() {
  var mode = (Gongfang._writeState && Gongfang._writeState.currentMode) || 'write';
  var btn = document.getElementById('writeSidebarToggle');
  var hidden;
  if (mode === 'write') {
    var main = document.getElementById('writeMain');
    if (!main) return;
    hidden = main.classList.toggle('write-no-sidebar');
  } else if (mode === 'draw') {
    var f = document.querySelector('#writeModeDraw .dw-files-col');
    hidden = f ? f.classList.toggle('hidden') : false;
  } else {
    var f2 = document.querySelector('#writeModeCode .cd-files-col');
    hidden = f2 ? f2.classList.toggle('hidden') : false;
  }
  if (btn) btn.classList.toggle('active', hidden);
  // 布局变化后刷新编辑器
  try {
    var ed = Gongfang._writeState && Gongfang._writeState.editor;
    if (ed) setTimeout(function() { ed.refresh(); }, 60);
  } catch(e) {}
  try { localStorage.setItem('gongfang_write_no_sidebar', hidden ? '1' : '0'); } catch(e) {}
};

// ★ 写作 / 绘图 / 代码 模式切换（照 - ultra 实现 + 诊断写编译栏）
//   v2.6 扩展化改造：_writeSwitchMode 改为扩展 dispatcher，不再硬编码 draw/code
//   - mode === 'write'：显示 writeMain（宿主自身）
//   - 其他 mode：查 window.GongfangExtension[mode]，调用 activate(api, container)
//     容器由 dispatcher 统一创建（id 兼容旧值：draw→writeModeDraw, code→writeModeCode）
//     这样 draw/code 的 _drawInit/_codeInit 内部 getElementById 仍可用，无需改动
Gongfang._writeSwitchMode = function(mode) {
  var log = function(m) { if (console) console.log('[mode]', m); };
  Gongfang._writeState = Gongfang._writeState || {};
  var prevMode = Gongfang._writeState.currentMode;
  Gongfang._writeState.currentMode = mode;

  // 切换按钮高亮
  var btns = document.querySelectorAll('.write-mode-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === mode);
  }

  var wm = document.getElementById('writeMain');
  var extHost = document.getElementById('writeExtHost');

  // deactivate 前一个扩展（切走时清理，如停止 Python 进程）
  function deactivatePrev() {
    if (prevMode && prevMode !== mode && prevMode !== 'write' &&
        window.GongfangExtension && window.GongfangExtension[prevMode] &&
        typeof window.GongfangExtension[prevMode].deactivate === 'function') {
      try { window.GongfangExtension[prevMode].deactivate(); }
      catch (e) { log('deactivate ' + prevMode + ' 失败: ' + (e && e.message || e)); }
    }
  }

  // 1) 回到写作：显示 writeMain，隐藏扩展宿主
  if (mode === 'write') {
    deactivatePrev();
    if (wm) wm.style.display = 'flex';
    if (extHost) extHost.style.display = 'none';
    try {
      var ed = Gongfang._writeState && Gongfang._writeState.editor;
      if (ed) setTimeout(function() { ed.refresh(); }, 60);
    } catch (e) {}
    return;
  }

  // 2) 扩展模式
  deactivatePrev();

  var ext = window.GongfangExtension && window.GongfangExtension[mode];
  if (!ext || typeof ext.activate !== 'function') {
    if (wm) wm.style.display = 'none';
    if (extHost) {
      extHost.style.display = 'flex';
      extHost.innerHTML = '<div style="padding:24px;color:#dc2626">扩展「' + mode + '」未安装或未启用</div>';
    }
    log('扩展未安装: ' + mode);
    return;
  }

  // 隐藏 writeMain，显示扩展宿主
  if (wm) wm.style.display = 'none';
  if (extHost) extHost.style.display = 'flex';

  // 隐藏宿主内所有扩展容器（兼容旧 id writeModeDraw/writeModeCode + 新 .write-ext-container）
  var allContainers = extHost.querySelectorAll('.write-ext-container, #writeModeDraw, #writeModeCode');
  for (var j = 0; j < allContainers.length; j++) {
    allContainers[j].style.display = 'none';
  }

  // 获取/创建该扩展的容器（兼容旧 id：draw→writeModeDraw, code→writeModeCode）
  var compatMap = { draw: 'writeModeDraw', code: 'writeModeCode' };
  var containerId = compatMap[mode] || ('writeMode_' + mode);
  var container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'write-ext-container';
    container.style.cssText = 'flex:1;min-height:0;display:none;flex-direction:column;gap:6px;overflow:hidden';
    extHost.appendChild(container);
  }
  container.style.display = 'flex';

  // 调用扩展 activate（传入基座 API 与容器）
  // ★ v2.6：容器刚 display='flex'，用 requestAnimationFrame 等待浏览器 layout 完成后再 activate，
  //   否则 X6 等引擎初始化时读取容器尺寸为 0（画布 0x0、网格不显示）
  requestAnimationFrame(function() {
    try {
      var api = window.electronAPI || null;
      ext.activate(api, container);
      log('扩展激活: ' + mode + '，容器长度 ' + container.innerHTML.length);
    } catch (e) {
      log('扩展激活失败: ' + mode + ' - ' + (e && e.message || e));
      container.innerHTML = '<div style="padding:24px;color:#dc2626">扩展激活失败：' + (e && e.message || e) + '</div>';
    }
  });
};

// ★ 初始化时恢复 PDF 预览开关状态
Gongfang._writeRestorePreviewState = function() {
  try {
    var hidden = localStorage.getItem('gongfang_write_no_preview') === '1';
    var main = document.getElementById('writeMain');
    var btn = document.getElementById('writeBtnPreviewToggle');
    if (main && hidden) main.classList.add('write-no-preview');
    if (btn && hidden) btn.classList.add('active');
  } catch(e) {}
};

// ★ 初始化时恢复侧栏开关状态（与预览开关对称）
Gongfang._writeRestoreSidebarState = function() {
  try {
    var hidden = localStorage.getItem('gongfang_write_no_sidebar') === '1';
    var main = document.getElementById('writeMain');
    var btn = document.getElementById('writeSidebarToggle');
    if (main && hidden) main.classList.add('write-no-sidebar');
    if (btn && hidden) btn.classList.add('active');
  } catch(e) {}
};

// ═══════════════════════ 编译日志 ═══════════════════════
// ★ 展开前的编辑器滚动位置，收起时还原初始视图
Gongfang._writeCompileScrollState = null;
Gongfang._writeCompileScrollBottom = null;
Gongfang._writeCompilePinRaf = false;

Gongfang._writeToggleCompileLog = function() {
  var bar = document.getElementById('writeCompileBar');
  var tog = document.getElementById('writeCompileBarToggle');
  var on = bar.classList.toggle('expanded');
  tog.style.transform = on ? '' : 'rotate(180deg)';
  Gongfang._writeAnimateEditorPin(on);
};

// ★ 展开：视口缩小时锁定「展开前视口底端那一行内容」始终贴着面板底边，上方内容向上推移、顶部被裁切；
//   收起：向下回滚还原到展开前的视图
Gongfang._writeAnimateEditorPin = function(expanding) {
  var editor = Gongfang._writeState.editor;
  if (!editor) return;
  var scroller = editor.getScrollerElement();
  if (!scroller) return;
  if (expanding) {
    if (Gongfang._writeCompileScrollState == null) {
      Gongfang._writeCompileScrollState = scroller.scrollTop;
      Gongfang._writeCompileScrollBottom = scroller.scrollTop + scroller.clientHeight; // 展开前视口底端对应的内容位置
    }
    Gongfang._writeCompilePinRaf = true;
    var start = Date.now();
    var DUR = 360;
    (function tick() {
      if (!Gongfang._writeCompilePinRaf) return;
      // 底端内容位置不变，视口变小 → 滚动量随视口收缩同步增大，底端那行始终可见
      var t = Gongfang._writeCompileScrollBottom - scroller.clientHeight;
      if (t < 0) t = 0;
      scroller.scrollTop = t;
      if (Date.now() - start < DUR) requestAnimationFrame(tick);
      else editor.refresh();
    })();
  } else {
    Gongfang._writeCompilePinRaf = false;
    var target = (Gongfang._writeCompileScrollState != null ? Gongfang._writeCompileScrollState : 0);
    var from = scroller.scrollTop;
    var start = Date.now();
    var DUR = 360;
    (function tick() {
      var t = Math.min(1, (Date.now() - start) / DUR);
      scroller.scrollTop = from + (target - from) * t;
      if (t < 1) requestAnimationFrame(tick);
      else { editor.refresh(); Gongfang._writeCompileScrollState = null; Gongfang._writeCompileScrollBottom = null; }
    })();
  }
};

// ★ 复制编译输出到剪贴板


// ★ 编译/终止按钮状态（白色按钮+彩色图标）：busy 时编译按钮转圈、终止按钮点亮可点；空闲时终止按钮灰色禁用
Gongfang._writeSetCompileBtn = function(busy) {
  var btn = document.getElementById('writeBtnCompile');
  if (btn) { btn.classList.toggle('compiling', busy); btn.disabled = busy; }
  var stopBtn = document.getElementById('writeBtnStop');
  if (stopBtn) stopBtn.disabled = !busy;
};

Gongfang._writeSetCompileStatus = function(s, cls) {
  var el = document.getElementById('writeCompileBarStatus');
  if (el) {
    el.className = 'write-compile-bar-status ' + (cls || '');
    el.innerHTML = '<span class="cmp-dot"></span>' + escHtml(s || '就绪');
  }
};

Gongfang._writeAppendLog = function(text) {
  var logEl = document.getElementById('writeCompileBarLog');
  if (!logEl) return;
  logEl.textContent = (logEl.textContent || '') + text + '\n';
  logEl.style.userSelect = 'text';
  logEl.scrollTop = logEl.scrollHeight;
};

// ═══════════════════════ 项目菜单 ═══════════════════════
Gongfang._writeRenderProjectMenuLegacy = function() {
  return; // ★ 旧菜单渲染已由新工坊版本替代（保留空壳防残留调用）
};

// ★ 选中状态气泡（绿色对勾圆点），设置菜单与结构菜单共用，保证设计一致、状态同步
Gongfang._writeStatusBubble = function() {
  var span = document.createElement('span');
  span.style.cssText = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#d1fae5;color:#059669;flex-shrink:0';
  span.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  return span;
};


// ═══════════════════════ 项目管理 ═══════════════════════
Gongfang._writeLoadProjects = async function() {
  // ★ 新工坊：写作项目库已下线，项目即工作目录（由 _writeOpenWorkdir 维护 projects 缓存）
  if (!Array.isArray(Gongfang._writeState.projects)) Gongfang._writeState.projects = [];
};

Gongfang._writeOpenProject = async function(projectName) {
  // ★ 协作模式守卫：协作中不能切换项目，需先退出协作
  if (Gongfang._collabState && Gongfang._collabState.active) {
    if (typeof Gongfang._showToast === 'function') Gongfang._showToast('协作模式中不能切换项目，请先退出协作');
    return;
  }
  var p = Gongfang._writeState.projects.find(function(x) { return x.name === projectName; });
  if (!p) return;
  Gongfang._writeState.activeProject = p; Gongfang._writeState.activeFilePath = null; Gongfang._writeState.activeFileName = null;
  Gongfang._writeUpdateTaskBtn();
  Gongfang._writeState.mainTexFile = null; // 重置
  Gongfang._writeState.activePaperDir = '论文'; // ★ v2.8.1 重置版本
  Gongfang._writeState.paperVersions = [];
  Gongfang._writeState.mainTexByVersion = {};
  Gongfang._writeState.compileEngine = 'xelatex'; // 默认引擎
  Gongfang._writeState.codeTheme = 'color'; // 默认彩色
  document.getElementById('writeProjectMenu').style.display = 'none';
  Gongfang._writeClearEditor();
  Gongfang._writeUpdateCardTitle('未打开文件');

  // ★ 加载持久化的编译设置（主编译文件 / 编译引擎 / 各版本主文件）
  try {
    var cfgPath = p.path + '/.gongfang-write.json';
    var cfgR = await window.electronAPI.readFileContent(cfgPath);
    if (cfgR && cfgR.text) {
      var cfg = JSON.parse(cfgR.text);
      // ★ 只采纳属于当前项目的编译主文件：兼容新格式（相对路径）与旧格式（绝对路径残留），
      //   防止 .gongfang-write.json 残留其他任务/项目/其他设备的绝对路径导致「任务A 编译任务B」。
      var cfgMain = Gongfang._writeToAbsPath(cfg.mainTexFile, p.path);
      if (cfgMain) {
        Gongfang._writeState.mainTexFile = cfgMain;
        var relPath = Gongfang._writeNormPath(cfgMain).substring(Gongfang._writeNormPath(p.path).length).replace(/^[\/\\]/, '');
        var label = document.getElementById('writeMainTexLabel');
        if (label) { label.textContent = '入口: ' + relPath; label.style.display = ''; }
      }
      // ★ v2.8.1 各版本主文件记忆
      if (cfg.mainTexByVersion && typeof cfg.mainTexByVersion === 'object') {
        Object.keys(cfg.mainTexByVersion).forEach(function(v) {
          var av = Gongfang._writeToAbsPath(cfg.mainTexByVersion[v], p.path);
          if (av) Gongfang._writeState.mainTexByVersion[v] = av;
        });
      }
      if (cfg.activePaperDir && (cfg.activePaperDir === '论文' || /^论文-/.test(cfg.activePaperDir))) {
        Gongfang._writeState.activePaperDir = cfg.activePaperDir;
      }
      if (cfg.compileEngine === 'pdflatex' || cfg.compileEngine === 'latexmk') {
        Gongfang._writeState.compileEngine = cfg.compileEngine;
      }
      if (cfg.codeTheme) Gongfang._writeState.codeTheme = cfg.codeTheme;
    }
  } catch(e) {}

  // ★ v2.8.1 枚举论文版本；执行区活动版本同名存在则跟随
  try { await Gongfang._writeRefreshPaperVersions(); } catch (_) {}
  try {
    var _execVer = (Gongfang.STATE && Gongfang.STATE.activePaperVersion) || '';
    if (_execVer && (Gongfang._writeState.paperVersions || []).some(function(v) { return v.dirName === _execVer; })) {
      Gongfang._writeState.activePaperDir = _execVer;
    } else if (Gongfang._writeState.mainTexFile) {
      var _mrel = Gongfang._writeNormPath(Gongfang._writeState.mainTexFile);
      var _proot = Gongfang._writeNormPath(p.path);
      if (_mrel.indexOf(_proot + '/') === 0) {
        var _seg = _mrel.substring(_proot.length + 1).split('/')[0] || '';
        if (_seg === '论文' || /^论文-/.test(_seg)) Gongfang._writeState.activePaperDir = _seg;
      }
    }
    // 主文件按活动版本纠偏
    var _mem = Gongfang._writeState.mainTexByVersion[Gongfang._writeState.activePaperDir] || null;
    if (_mem) Gongfang._writeState.mainTexFile = _mem;
    else if (Gongfang._writeState.mainTexFile) {
      Gongfang._writeState.mainTexByVersion[Gongfang._writeState.activePaperDir] = Gongfang._writeState.mainTexFile;
    }
  } catch (_) {}

  // ★ 若无持久化主编译文件，自动检测默认（限定活动版本目录）：论文.tex → main.tex → 第一个 .tex
  if (!Gongfang._writeState.mainTexFile) {
    try {
      var fr = await window.electronAPI.writeGetFileTree(p.path);
      var _adir = Gongfang._writeState.activePaperDir || '论文';
      var _dirNode = null;
      if (fr && fr.success && fr.tree) {
        var _findDir = function(n) {
          if (!n) return null;
          if (n.type === 'directory' && n.name === _adir) return n;
          if (n.children) { for (var _i = 0; _i < n.children.length; _i++) { var _f = _findDir(n.children[_i]); if (_f) return _f; } }
          return null;
        };
        _dirNode = _findDir(fr.tree);
      }
      var texCands = [];
      var flatTex = function(node) {
        if (!node) return;
        if (node.type === 'directory') { (node.children || []).forEach(flatTex); }
        else if (/\.tex$/i.test(node.name)) texCands.push(node);
      };
      if (_dirNode) flatTex(_dirNode);
      else if (fr && fr.success && fr.tree) flatTex(fr.tree);
      if (texCands.length) {
        var defMain = texCands.find(function(x) { return x.name === '论文.tex'; })
          || texCands.find(function(x) { return x.name === 'main.tex'; })
          || texCands[0];
        if (defMain) {
          Gongfang._writeState.mainTexFile = defMain.path;
          try { Gongfang._writeState.mainTexByVersion[_adir] = defMain.path; } catch (_) {}
        }
      }
    } catch(e) {}
  }

  // ★ 记忆恢复：优先恢复上次打开的标签页；否则默认打开主编译文件（论文.tex）
  Gongfang._writeState.openFiles = [];
  // ★ cfg 可能未定义：项目无 .gongfang-write.json 时走默认打开主文件分支，避免 TypeError 中断初始化
  if (cfg && cfg.openFiles && cfg.openFiles.length && cfg.activeFile && !Gongfang._writeIsPdf(cfg.activeFile)) {
    var seen = {};
    cfg.openFiles.forEach(function(fp) {
      if (Gongfang._writeIsPdf(fp)) return;
      // ★ 只恢复属于当前项目的标签页：先转绝对路径（兼容新格式相对路径 + 旧格式绝对路径残留），丢弃跨任务/跨设备路径
      var fpAbs = Gongfang._writeToAbsPath(fp, p.path);
      if (!fpAbs) return;
      var nk = Gongfang._writeNormPath(fpAbs);
      if (seen[nk]) return; seen[nk] = true;
      var nm = (fpAbs.split(/[\\/]/).pop()) || '文件';
      Gongfang._writeState.openFiles.push({ path: fpAbs, name: nm });
    });
    if (Gongfang._writeState.openFiles.length) {
      // ★ v2.6.12 修复启动恢复错位：activeFilePath 必须指向实际打开的标签页（act.path），
      //   不能直接取 cfg.activeFile——若它已被过滤/剔除，会造成「编辑器显示A、编译指向B」。
      var actAbs = Gongfang._writeToAbsPath(cfg.activeFile, p.path);
      var act = Gongfang._writeState.openFiles.find(function(f) { return Gongfang._writeNormPath(f.path) === Gongfang._writeNormPath(actAbs); }) || Gongfang._writeState.openFiles[0];
      if (act) {
        Gongfang._writeState.activeFilePath = act.path;
        Gongfang._writeState.activeFileName = act.name;
        Gongfang._writeRenderTabs();
        Gongfang._writeLoadFileContent(act.path);
      }
    }
  } else {
    var mainTex = Gongfang._writeState.mainTexFile || (p.texFile ? p.path + '/' + p.texFile : null);
    if (mainTex) {
      var mn = mainTex.split(/[\\/]/).pop();
      Gongfang._writeOpenFile(mainTex, mn);
    }
  }

  // ★ 自动加载活动版本已有 PDF（无需先编译；无则清空，避免残留他版）
  try {
    var _pdfDir = Gongfang._writeState.activePaperDir || '论文';
    var pdfScan = await window.electronAPI.listDirFiles(p.path + '/' + _pdfDir);
    var pdfFile = null;
    if (pdfScan && pdfScan.files) {
      pdfFile = pdfScan.files.find(function(f) { return f.name === '论文.pdf' && Gongfang._writePathInProject(f.path, p.path); });
    }
    if (pdfFile) {
      Gongfang._writePdfState._pdfPath = pdfFile.path;
      Gongfang._writePdfRenderSingle(pdfFile.path);
    } else {
      // ★ 当前项目无自己的论文.pdf：清空预览，避免残留其他任务的 PDF
      Gongfang._writePdfState._pdfPath = null;
      var pdfPane = document.getElementById('writePreviewPane');
      if (pdfPane) { pdfPane.innerHTML = ''; Gongfang._writePdfUpdateUI(); }
    }
  } catch(e) {}

  // ★ 侧栏：刷新文件浏览器 + 大纲
  try { await Gongfang._writeRenderFileBrowser(); } catch(e) {}
  try { Gongfang._writeRenderOutlineTree(); } catch(e) {}
};

// ★ 已删除 _writeNewProject/_writeUploadZip：写作项目库已下线，新建=自选工作目录（见 _writeOpenWorkdir）

// ═══════════════════════ 设定编译主文件 ═══════════════════════
Gongfang._writeSetMainTex = async function(texPath) {
  Gongfang._writeState.mainTexFile = texPath || null;
  // ★ v2.8.1 按版本记忆主文件
  try {
    var _v = Gongfang._writeState.activePaperDir || '论文';
    if (texPath) Gongfang._writeState.mainTexByVersion[_v] = texPath;
    else delete Gongfang._writeState.mainTexByVersion[_v];
  } catch (_) {}
  var project = Gongfang._writeState.activeProject;
  var label = document.getElementById('writeMainTexLabel');

  if (texPath) {
    // 提取相对路径用于显示
    var relPath = texPath;
    if (project && texPath.startsWith(project.path)) {
      relPath = texPath.substring(project.path.length).replace(/^[\/\\]/, '');
    }
    if (label) { label.textContent = '入口: ' + relPath; label.style.display = ''; }
    Gongfang._showToast('已设定编译主文件: ' + relPath);
  } else {
    if (label) label.style.display = 'none';
    Gongfang._showToast('已取消编译主文件设定');
  }

  // ★ 持久化到项目目录的 .gongfang-write.json（保留引擎配置 + 各版本主文件 + 活动版本）
  if (project) {
    try {
      var cfgPath = project.path + '/.gongfang-write.json';
      var cfgR = await window.electronAPI.readFileContent(cfgPath);
      var cfg = {};
      if (cfgR && cfgR.text) { try { cfg = JSON.parse(cfgR.text); } catch(e) {} }
      cfg.mainTexFile = Gongfang._writeToRelPath(texPath, project.path);
      cfg.mainTexByVersion = {};
      Object.keys(Gongfang._writeState.mainTexByVersion || {}).forEach(function(v) {
        cfg.mainTexByVersion[v] = Gongfang._writeToRelPath(Gongfang._writeState.mainTexByVersion[v], project.path);
      });
      cfg.activePaperDir = Gongfang._writeState.activePaperDir || '论文';
      cfg.compileEngine = Gongfang._writeState.compileEngine || 'xelatex';
      cfg.updatedAt = Date.now();
      await window.electronAPI.writeFileContent(cfgPath, JSON.stringify(cfg, null, 2));
    } catch(e) {}
  }
};

// ═══════════════════════ 编辑器标题栏 ═══════════════════════
// ★ 标题栏渲染（标签栏）；顶部任务按钮本身保持不变
Gongfang._writeUpdateCardTitle = function() {
  Gongfang._writeRenderTabs();
};

// ═══════════════════════ 编译设置菜单 ═══════════════════════
Gongfang._writeToggleCompileSettings = function() {
  var menu = document.getElementById('writeCompileSettingsMenu');
  var btn = document.getElementById('writeSettingsBtn');
  document.getElementById('writeProjectMenu').style.display = 'none';
  document.getElementById('writeOutlineMenu').style.display = 'none';
  if (!menu || !btn) return;
  if (menu.style.display === 'block') { menu.style.display = 'none'; return; }
  var r = btn.getBoundingClientRect(), pr = document.getElementById('writePanel').getBoundingClientRect();
  // ★ 设置按钮已移到底部编译栏：下方空间不足时下拉向上展开，避免被窗口底部截断
  var menuH = 320;
  var top = (r.bottom - pr.top) + 8;
  if ((window.innerHeight - r.bottom - 8) < menuH && (r.top - pr.top) > menuH) {
    top = (r.top - pr.top) - menuH - 8;
  }
  if (top < 8) top = 8;
  menu.style.left = (r.left - pr.left) + 'px';
  menu.style.top = top + 'px';
  menu.style.display = 'block';
  Gongfang._writeRenderCompileSettings();
};

// ★ 渲染设置菜单：主编译文件列表 + 编译引擎（选中状态放最右，绿色对勾气泡 / 主编徽章）
// ★ 渲染设置菜单：主编译文件 + 编译引擎（选中状态用绿色对勾气泡，与结构菜单一致）
Gongfang._writeRenderCompileSettings = async function() {
  var p = Gongfang._writeState.activeProject;
  var mainList = document.getElementById('writeSettingsMainList');
  var engineList = document.getElementById('writeSettingsEngineList');
  if (!mainList || !engineList) return;

  // ★ 主编译文件（v2.8.1 按论文版本分组，默认只展开活动版本；行内显示相对路径去重）
  if (!p) {
    mainList.innerHTML = '<div class="write-dropdown-empty">请先选择任务</div>';
  } else {
    mainList.innerHTML = '<div class="write-dropdown-empty">加载中...</div>';
    try {
      var r = await window.electronAPI.writeGetFileTree(p.path);
      var texList = [];
      var flatten = function(node) {
        if (!node) return;
        if (node.type === 'directory') { (node.children || []).forEach(flatten); }
        else if (/\.tex$/i.test(node.name)) texList.push(node);
      };
      if (r && r.success && r.tree) flatten(r.tree);
      // 只保留论文版本目录下的 tex（论文/、论文-*/），过滤 转word/共享区 等生成目录
      var _projRoot = Gongfang._writeNormPath(p.path);
      var _verOf = function(absPath) {
        var rel = Gongfang._writeNormPath(absPath);
        if (rel.indexOf(_projRoot + '/') === 0) rel = rel.substring(_projRoot.length + 1);
        var seg = rel.split('/')[0] || '';
        if (seg === '论文' || /^论文-/.test(seg)) return seg;
        return '';
      };
      var _relOf = function(absPath) {
        var rel = Gongfang._writeNormPath(absPath);
        if (rel.indexOf(_projRoot + '/') === 0) rel = rel.substring(_projRoot.length + 1);
        return rel;
      };
      var groups = {};
      texList.forEach(function(n) {
        var v = _verOf(n.path);
        if (!v) return;
        if (!groups[v]) groups[v] = [];
        groups[v].push(n);
      });
      var verNames = Object.keys(groups);
      verNames.sort(function(a, b) {
        if (a === '论文' && b !== '论文') return -1;
        if (a !== '论文' && b === '论文') return 1;
        return String(a).localeCompare(String(b), undefined, { numeric: true });
      });
      mainList.innerHTML = '';
      if (!verNames.length) { mainList.innerHTML = '<div class="write-dropdown-empty">项目内暂无论文版本 .tex 文件</div>'; return; }
      var _activeVer = Gongfang._writeState.activePaperDir || '论文';
      verNames.forEach(function(v) {
        var list = groups[v] || [];
        list.sort(function(a, b) { return naturalCompare(_relOf(a.path), _relOf(b.path)); });
        var isActive = (v === _activeVer);
        var wrap = document.createElement('div');
        wrap.className = 'ws-ver-group';
        var head = document.createElement('div');
        head.className = 'ws-ver-head' + (isActive ? ' active' : '');
        head.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;padding:7px 10px;font-size:11px;font-weight:700;color:#3f3f46;background:' + (isActive ? '#eef2ff' : '#f4f4f5') + ';border-radius:6px;margin:2px 0;';
        var caret = document.createElement('span');
        caret.style.cssText = 'display:inline-block;transition:transform .15s;font-size:10px;color:#71717a;';
        caret.textContent = isActive ? '▼' : '▶';
        head.appendChild(caret);
        var ht = document.createElement('span');
        ht.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        ht.textContent = Gongfang._writePaperDirLabel(v) + '（' + list.length + '）';
        head.appendChild(ht);
        if (isActive) {
          var badge = document.createElement('span');
          badge.style.cssText = 'font-size:10px;font-weight:400;color:#4f46e5;background:#fff;border:1px solid #c7d2fe;border-radius:999px;padding:0 6px;';
          badge.textContent = '当前';
          head.appendChild(badge);
        }
        var body = document.createElement('div');
        body.style.display = isActive ? '' : 'none';
        list.forEach(function(n) {
          var isMain = Gongfang._writeState.mainTexFile === n.path;
          var row = document.createElement('div');
          row.className = 'write-dropdown-file' + (isMain ? ' write-main-tex' : '');
          row.style.cssText = 'cursor:pointer;padding:6px 10px 6px 22px';
          row.title = _relOf(n.path);
          var nameSpan = document.createElement('span');
          nameSpan.style.fontSize = '11px';
          nameSpan.style.cssText = 'font-size:11px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          nameSpan.textContent = _relOf(n.path);
          row.appendChild(nameSpan);
          if (isMain) row.appendChild(Gongfang._writeStatusBubble());
          // ★ 闭包传真实路径，避免 onclick 字符串里反斜杠被吃掉
          row.onclick = function() { Gongfang._writePickMainTex(isMain ? null : n.path); };
          body.appendChild(row);
        });
        head.onclick = function() {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : '';
          caret.textContent = open ? '▶' : '▼';
        };
        wrap.appendChild(head);
        wrap.appendChild(body);
        mainList.appendChild(wrap);
      });
    } catch(e) { mainList.innerHTML = '<div class="write-dropdown-empty">读取失败</div>'; }
  }

  // ★ 编译引擎
  var engines = [
    { key: 'xelatex', label: 'XeLaTeX' },
    { key: 'pdflatex', label: 'pdfLaTeX' },
    { key: 'latexmk', label: 'latexmk' }
  ];
  var cur = Gongfang._writeState.compileEngine || 'xelatex';
  engineList.innerHTML = '';
  engines.forEach(function(en) {
    var sel = cur === en.key;
    var row = document.createElement('div');
    row.className = 'write-dropdown-file' + (sel ? ' write-main-tex' : '');
    row.style.cssText = 'cursor:pointer;padding:6px 10px';
    var labelSpan = document.createElement('span');
    labelSpan.style.fontSize = '11px';
    labelSpan.textContent = en.label;
    row.appendChild(labelSpan);
    if (sel) row.appendChild(Gongfang._writeStatusBubble());
    row.onclick = function() { Gongfang._writeSetCompileEngine(en.key); };
    engineList.appendChild(row);
  });

  // ★ 代码配色主题
  var frameEl = document.getElementById('writeSettingsCodeFrameList');
  if (frameEl) {
    var frames = [
      { key: 'color',   label: '彩色标准' },
      { key: 'mono',    label: '黑白简洁' },
      { key: 'large',   label: '大字号易读' },
      { key: 'serif',   label: '论文衬线体' },
      { key: 'compact', label: '紧凑小字' },
      { key: 'minimal', label: '极简无框' },
      { key: 'shadow',  label: '阴影装饰框' },
      { key: 'dark',    label: '夜间暗色' },
      { key: 'noline',  label: '无行号清爽' }
    ];
    var curF = Gongfang._writeState.codeTheme || 'color';
    frameEl.innerHTML = '';
    frames.forEach(function(fr) {
      var fsel = curF === fr.key;
      var frow = document.createElement('div');
      frow.className = 'write-dropdown-file' + (fsel ? ' write-main-tex' : '');
      frow.style.cssText = 'cursor:pointer;padding:6px 10px';
      var fspan = document.createElement('span');
      fspan.style.fontSize = '11px';
      fspan.textContent = fr.label;
      frow.appendChild(fspan);
      if (fsel) frow.appendChild(Gongfang._writeStatusBubble());
      frow.onclick = function() { Gongfang._writeSetCodeTheme(fr.key); };
      frameEl.appendChild(frow);
    });
  }
};

// ★ 代码主题 → lstinputlisting 展示配置（字体族/字号/边框/行号/背景/配色 全维度区分，不只是颜色）
Gongfang._writeThemeOptsFor = function(theme) {
  var T = {
    color:   { bs: '\\small\\ttfamily',            kw: '\\color{NavyBlue}',       co: '\\color{codegreen}',     st: '\\color{PineGreen}', fr: 'single',    nums: 'left', bg: '' },
    mono:    { bs: '\\small\\ttfamily',            kw: '\\color{black}\\bfseries',co: '\\color{black}\\itshape',st: '\\color{black}',      fr: 'single',    nums: 'left', bg: '' },
    large:   { bs: '\\normalsize\\ttfamily',       kw: '\\color{NavyBlue}',       co: '\\color{codegreen}',     st: '\\color{PineGreen}', fr: 'single',    nums: 'left', bg: '' },
    serif:   { bs: '\\small\\rmfamily',            kw: '\\color{black!80}\\bfseries', co: '\\color{gray!70}\\itshape', st: '\\color{black!70}', fr: 'single', nums: 'left', bg: '' },
    compact: { bs: '\\footnotesize\\ttfamily',     kw: '\\color{NavyBlue}',       co: '\\color{codegreen}',     st: '\\color{PineGreen}', fr: 'single',    nums: 'left', bg: '' },
    minimal: { bs: '\\footnotesize\\sffamily',     kw: '\\color{gray}\\bfseries', co: '\\color{gray}',         st: '\\color{gray}',      fr: 'none',      nums: 'none', bg: '' },
    shadow:  { bs: '\\small\\ttfamily',            kw: '\\color{NavyBlue}',       co: '\\color{codegreen}',     st: '\\color{PineGreen}', fr: 'shadowbox', nums: 'left', bg: '' },
    dark:    { bs: '\\small\\ttfamily',            kw: '\\color{cyan!80!white}',  co: '\\color{gray}',          st: '\\color{orange!80!white}', fr: 'single', nums: 'left', bg: 'black!90' },
    noline:  { bs: '\\small\\ttfamily',            kw: '\\color{NavyBlue}',       co: '\\color{codegreen}',     st: '\\color{PineGreen}', fr: 'single',    nums: 'none', bg: '' }
  };
  var t = T[theme] || T.color;
  var opts = [];
  opts.push('numbers=' + t.nums);
  opts.push('frame=' + t.fr);
  if (t.bg) opts.push('backgroundcolor=\\color{' + t.bg + '}');
  opts.push('basicstyle=' + t.bs);
  opts.push('keywordstyle=' + t.kw);
  opts.push('commentstyle=' + t.co);
  opts.push('stringstyle=' + t.st);
  return opts.join(',');
};

// ★ 重写单个 \lstinputlisting[...]{...}，套用当前代码主题（保留 title / language / 引用路径）
Gongfang._writeBuildListingReplacement = function(full) {
  var mm = /^\\lstinputlisting\[([\s\S]*?)\]\{([^}]*)\}$/.exec(full);
  if (!mm) return full;
  var opts = mm[1], path = mm[2];
  var theme = Gongfang._writeState.codeTheme || 'color';
  var themeOpts = Gongfang._writeThemeOptsFor(theme);
  var tm = /\btitle=\{([^}]*)\}/.exec(opts), title = tm ? tm[1] : '';
  var lm = /\blanguage=([A-Za-z0-9_]+)/.exec(opts), lang = lm ? lm[1] : '';
  var n = 'captionpos=t';
  if (title) n += ',title={' + title + '}';
  if (themeOpts) n += ',' + themeOpts;
  if (lang && theme !== 'mono') n += ',language=' + lang;
  return '\\lstinputlisting[' + n + ']{' + path + '}';
};

// ★ 切换代码引用框风格并持久化；切换后立即把当前文档里已插入的 \lstinputlisting 重刷为新配色
Gongfang._writeSetCodeTheme = async function(style) {
  Gongfang._writeState.codeTheme = style || 'color';
  var ed = Gongfang._writeState.editor;
  if (ed) {
    var cur = ed.getValue() || '';
    var re = /\\lstinputlisting\[([\s\S]*?)\]\{([^}]*)\}/g;
    var edits = [], m;
    while ((m = re.exec(cur)) !== null) {
      var repl = Gongfang._writeBuildListingReplacement(m[0]);
      if (repl !== m[0]) edits.push({ from: m.index, to: m.index + m[0].length, text: repl });
    }
    if (edits.length) {
      ed.operation(function() {
        for (var i = edits.length - 1; i >= 0; i--) {
          var e = edits[i];
          ed.replaceRange(e.text, ed.posFromIndex(e.from), ed.posFromIndex(e.to));
        }
      });
    }
  }
  var project = Gongfang._writeState.activeProject;
  if (project) {
    try {
      var cfgPath = project.path + '/.gongfang-write.json';
      var cfgR = await window.electronAPI.readFileContent(cfgPath);
      var cfg = {};
      if (cfgR && cfgR.text) { try { cfg = JSON.parse(cfgR.text); } catch(e) {} }
      cfg.mainTexFile = Gongfang._writeToRelPath(Gongfang._writeState.mainTexFile, project.path);
      cfg.mainTexByVersion = {};
      Object.keys(Gongfang._writeState.mainTexByVersion || {}).forEach(function(v) {
        cfg.mainTexByVersion[v] = Gongfang._writeToRelPath(Gongfang._writeState.mainTexByVersion[v], project.path);
      });
      cfg.activePaperDir = Gongfang._writeState.activePaperDir || '论文';
      cfg.compileEngine = Gongfang._writeState.compileEngine || 'xelatex';
      cfg.codeTheme = Gongfang._writeState.codeTheme;
      cfg.updatedAt = Date.now();
      await window.electronAPI.writeFileContent(cfgPath, JSON.stringify(cfg, null, 2));
    } catch(e) {}
  }
  Gongfang._writeRenderCompileSettings();
  Gongfang._showToast('代码主题: ' + (Gongfang._writeState.codeTheme || 'color'));
};;

// ★ 在设置菜单里选主编译文件
Gongfang._writePickMainTex = function(texPath) {
  var isMain = Gongfang._writeState.mainTexFile === texPath;
  Gongfang._writeSetMainTex(isMain ? null : texPath);
  Gongfang._writeRenderCompileSettings();
};

// ★ 切换编译引擎并持久化
Gongfang._writeSetCompileEngine = async function(engine) {
  Gongfang._writeState.compileEngine = (engine === 'pdflatex' || engine === 'latexmk') ? engine : 'xelatex';
  var project = Gongfang._writeState.activeProject;
  if (project) {
    try {
      var cfgPath = project.path + '/.gongfang-write.json';
      var cfgR = await window.electronAPI.readFileContent(cfgPath);
      var cfg = {};
      if (cfgR && cfgR.text) { try { cfg = JSON.parse(cfgR.text); } catch(e) {} }
      cfg.mainTexFile = Gongfang._writeToRelPath(Gongfang._writeState.mainTexFile, project.path);
      cfg.mainTexByVersion = {};
      Object.keys(Gongfang._writeState.mainTexByVersion || {}).forEach(function(v) {
        cfg.mainTexByVersion[v] = Gongfang._writeToRelPath(Gongfang._writeState.mainTexByVersion[v], project.path);
      });
      cfg.activePaperDir = Gongfang._writeState.activePaperDir || '论文';
      cfg.compileEngine = Gongfang._writeState.compileEngine;
      cfg.updatedAt = Date.now();
      await window.electronAPI.writeFileContent(cfgPath, JSON.stringify(cfg, null, 2));
    } catch(e) {}
  }
  Gongfang._writeRenderCompileSettings();
  Gongfang._showToast('编译引擎: ' + Gongfang._writeState.compileEngine);
};

// ★ 已删除 _writeSyncFromTask：任务同步已下线（scanWorkspaceProjects/writeSyncFromTask IPC 已删除）

// ═══════════════════════ 编辑器 ═══════════════════════
Gongfang._writeOpenFile = async function(filePath, fileName) {
  if (Gongfang._writeIsPdf(filePath)) return;
  await Gongfang._writeFlushDirtyFiles();
  var st = Gongfang._writeState;
  var name = fileName || (filePath.split(/[\\/]/).pop() || '文件');
  var np = Gongfang._writeNormPath(filePath);
  if (!st.openFiles.some(function(f) { return Gongfang._writeNormPath(f.path) === np; })) {
    st.openFiles.push({ path: filePath, name: name });
  }
  st.activeFilePath = filePath;
  st.activeFileName = name;
  Gongfang._writeRenderTabs();
  Gongfang._writePersistTabs();
  Gongfang._writeLoadFileContent(filePath);
};

// ★ 读取文件内容到编辑器（不改变标签页）
Gongfang._writeLoadFileContent = async function(filePath) {
  try {
    var r = await window.electronAPI.readFileContent(filePath);
    var content = (r && r.text !== undefined) ? r.text : (typeof r === 'string' ? r : '');
    Gongfang._writeState._lastDiskVersion = content;   // 记录已读取的磁盘版本，供协作冲突比对
    Gongfang._writeClearDirty(filePath);                // 刚加载即与磁盘一致，清除脏标记
    Gongfang._writeInitEditor(content);
  } catch(e) { Gongfang._writeInitEditor(''); Gongfang._writeState._lastDiskVersion = ''; }
  // ★ 打开/切换文件 → 广播"我正在查看/编辑此文件"
  try { Gongfang._writeNotifyCollabView(filePath); } catch(e) {}
  // ★ 切换文件后刷新侧栏大纲（章节结构随当前文件变化）
  try { Gongfang._writeRenderOutlineTree(); } catch(e) {}
  // ★ 同步侧栏文件区高亮当前编辑文件
  try { Gongfang._writeMarkActiveFile(); } catch(e) {}
  // ★ 同步大纲高亮当前编辑文件对应的章节
  try { Gongfang._writeMarkActiveOutline(); } catch(e) {}
};

// ★ 切换到指定标签页
Gongfang._writeSwitchFile = async function(filePath) {
  var np = Gongfang._writeNormPath(filePath);
  var f = Gongfang._writeState.openFiles.find(function(x) { return Gongfang._writeNormPath(x.path) === np; });
  if (!f) return;
  await Gongfang._writeFlushDirtyFiles();
  Gongfang._writeState.activeFilePath = f.path;
  Gongfang._writeState.activeFileName = f.name;
  Gongfang._writeRenderTabs();
  Gongfang._writePersistTabs();
  Gongfang._writeLoadFileContent(f.path);
};

// ★ 关闭标签页；全部关闭 → 退出到无文件状态
Gongfang._writeCloseTab = async function(filePath) {
  var st = Gongfang._writeState;
  var np = Gongfang._writeNormPath(filePath);
  var idx = st.openFiles.findIndex(function(f) { return Gongfang._writeNormPath(f.path) === np; });
  if (idx < 0) return;
  var wasActive = Gongfang._writeNormPath(st.activeFilePath) === np;
  st.openFiles.splice(idx, 1);
  if (wasActive) {
    if (st.openFiles.length) {
      var next = st.openFiles[Math.min(idx, st.openFiles.length - 1)];
      await Gongfang._writeSwitchFile(next.path);
    } else {
      // ★ 所有标签关闭 → 任务也退出，回到「编辑器」初始状态，并清空该任务的记忆标签页。
      //   无论单人还是协作模式，关闭最后一个卡片都直接退出写作/编辑模式；协作模式下同时退出房间。
      var wasCollab = Gongfang._collabState && Gongfang._collabState.active;
      var oldProject = st.activeProject;
      st.activeFilePath = null;
      st.activeFileName = null;
      st.activeProject = null;
      Gongfang._writeUpdateTaskBtn();
      var pjBtn = document.getElementById('writeTopProjectName');
      if (pjBtn) pjBtn.textContent = '任务';
      Gongfang._writeClearEditor();
      // ★ 退出任务后清空侧栏文件区与大纲区
      try { Gongfang._writeRenderFileBrowser(); } catch(e) {}
      try { Gongfang._writeRenderOutlineTree(); } catch(e) {}
      // ★ 协作模式下关闭全部卡片 → 同时退出协作房间
      if (wasCollab) {
        try { if (Gongfang._collabLeave) await Gongfang._collabLeave(); } catch(e) {}
      }
      // ★ 单人模式退出时清空记忆标签页；协作模式不落盘（避免成员误写主机配置）
      if (oldProject && !wasCollab) {
        try {
          var cfgPath = oldProject.path + '/.gongfang-write.json';
          var cfgR = await window.electronAPI.readFileContent(cfgPath);
          var cfg = {};
          if (cfgR && cfgR.text) { try { cfg = JSON.parse(cfgR.text); } catch(e) {} }
          cfg.openFiles = [];
          cfg.activeFile = '';
          cfg.updatedAt = Date.now();
          await window.electronAPI.writeFileContent(cfgPath, JSON.stringify(cfg, null, 2));
        } catch(e) {}
      }
    }
  } else {
    Gongfang._writeRenderTabs();
  }
  Gongfang._writePersistTabs();
};

// ★ 渲染标签栏：任务名（纯文字，≤5字静态/＞5字滚动）+ 文件标签页
Gongfang._writeRenderTabs = function() {
  var bar = document.getElementById('writeTabs');
  if (!bar) return;
  var st = Gongfang._writeState;
  var p = st.activeProject;
  // 无任务时隐藏任务名（不再显示「编辑器」占位文字）；有任务时显示任务名
  var tn = document.getElementById('writeHeaderTaskName');
  if (tn) {
    if (!p) { tn.style.display = 'none'; }
    else {
      tn.style.display = '';
      tn.className = 'write-header-taskname' + (p.name.length > 5 ? ' scroll' : '');
      tn.innerHTML = '<span class="write-header-taskname-inner">' + escHtml(p.name) + '</span>';
    }
  }
  // ★ 无任务时隐藏任务卡片栏（此时只有工具栏充当标题栏）；有任务时显示任务卡片
  var taskbar = document.getElementById('writeEditorTaskbar');
  if (taskbar) taskbar.style.display = p ? '' : 'none';
  var ecard = document.getElementById('writeEditorCard');
  if (ecard) ecard.classList.toggle('no-task', !p);
  // 文件标签页
  // ★ v2.6.12 防残留：按规范化路径去重渲染，即使 openFiles 因历史/协作混入重复项，
  //   也保证同一文件只出现一张卡片（首次出现的为准），避免「两个同名卡片」。
  var html = '';
  var seenNk = {};
  st.openFiles.forEach(function(f) {
    if (Gongfang._writeIsPdf(f.name)) return;
    var fk = Gongfang._writeNormPath(f.path);
    if (seenNk[fk]) return;
    seenNk[fk] = true;
    var active = fk === Gongfang._writeNormPath(st.activeFilePath);
    html += '<span class="write-tab' + (active ? ' active' : '') + '" data-path="' + escAttr(f.path) + '" draggable="true" title="拖动可排序">' +
      '<span class="write-tab-ic">' + Gongfang._writeFileIcon(f.name) + '</span>' +
      '<span class="write-tab-name">' + escHtml(f.name) + '</span>' +
      '<button class="write-tab-close" title="关闭">×</button>' +
      '</span>';
  });
  bar.innerHTML = html;
  // ★ 标签栏边缘渐隐（溢出时）：挂滚动监听（只一次）+ 渲染后重算
  if (!bar.__gongfangFadeBound) {
    bar.__gongfangFadeBound = true;
    bar.addEventListener('scroll', function() { Gongfang._applyTabBarFade(bar); });
  }
  if (Gongfang._applyTabBarFade) setTimeout(function() { Gongfang._applyTabBarFade(bar); }, 0);
};

// ★ 研讨 / 评审 模式：图标已就位，面板开发中（点击只提示，不切换）
Gongfang._writeModeTodo = function(name) {
  if (Gongfang._showToast) Gongfang._showToast(name + '功能开发中，敬请期待');
};

// ★ 选中任务后，任务按钮文字/背景变色（无任务恢复默认）
Gongfang._writeUpdateTaskBtn = function() {
  var btn = document.getElementById('writeMenuProjectBtn');
  if (!btn) return;
  var has = !!Gongfang._writeState.activeProject;
  btn.style.color = has ? '#4f46e5' : '#52525b';
  btn.style.borderColor = has ? '#c7d2fe' : '#e5e7eb';
  btn.style.background = has ? '#eef2ff' : '#fff';
};

// ★ 持久化标签页（当前任务 .gongfang-write.json）
Gongfang._writePersistTabs = async function() {
  var project = Gongfang._writeState.activeProject;
  if (!project) return;
  try {
    var cfgPath = project.path + '/.gongfang-write.json';
    var cfgR = await window.electronAPI.readFileContent(cfgPath);
    var cfg = {};
    if (cfgR && cfgR.text) { try { cfg = JSON.parse(cfgR.text); } catch(e) {} }
    cfg.mainTexFile = Gongfang._writeToRelPath(Gongfang._writeState.mainTexFile, project.path);
    cfg.mainTexByVersion = {};
    Object.keys(Gongfang._writeState.mainTexByVersion || {}).forEach(function(v) {
      cfg.mainTexByVersion[v] = Gongfang._writeToRelPath(Gongfang._writeState.mainTexByVersion[v], project.path);
    });
    cfg.activePaperDir = Gongfang._writeState.activePaperDir || '论文';
    cfg.compileEngine = Gongfang._writeState.compileEngine || 'xelatex';
    cfg.codeTheme = Gongfang._writeState.codeTheme || 'color';
    cfg.openFiles = Gongfang._writeState.openFiles.map(function(f) { return Gongfang._writeToRelPath(f.path, project.path); });
    cfg.activeFile = Gongfang._writeToRelPath(Gongfang._writeState.activeFilePath, project.path);
    cfg.updatedAt = Date.now();
    await window.electronAPI.writeFileContent(cfgPath, JSON.stringify(cfg, null, 2));
  } catch(e) {}
};

Gongfang._writeInitEditor = function(content) {
  var ta = document.getElementById('writeCodeMirror'), ph = document.getElementById('writeEditorPlaceholder');
  if (!ta) return;
  if (Gongfang._writeState.editor) { var w = Gongfang._writeState.editor.getWrapperElement(); if (w && w.parentNode) w.parentNode.removeChild(w); Gongfang._writeState.editor = null; }
  // ★ 防止 textarea 因上次初始化被连带移除后脱离 DOM，导致 CodeMirror 空白：先挂回编辑器面板
  if (!ta.parentNode) {
    var ep = document.getElementById('writeEditorPane');
    if (ep) ep.appendChild(ta);
  }
  if (typeof CodeMirror === 'undefined') {
    // ★ CodeMirror 已懒加载：注入成功后再初始化编辑器（加载失败保持占位提示）
    Gongfang._ensureCodeMirror().then(function() { if (!Gongfang._writeState.editor) Gongfang._writeInitEditor(content); });
    return;
  }
  if (ph) ph.style.display = 'none'; ta.style.display = '';
  Gongfang._writeState.editor = CodeMirror.fromTextArea(ta, {
    mode: 'stex', theme: 'default', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true,
    styleActiveLine: true, lineWrapping: true, indentUnit: 2, tabSize: 2,
    extraKeys: { 'Ctrl-S': function() { Gongfang._writeSaveFile(); }, 'Cmd-S': function() { Gongfang._writeSaveFile(); },
                 'Ctrl-B': function() { Gongfang._writeCompile(); }, 'Cmd-B': function() { Gongfang._writeCompile(); },
                 'Ctrl-T': function(cm) { Gongfang._writeToggleComment(cm); }, 'Cmd-T': function(cm) { Gongfang._writeToggleComment(cm); } },
  });
  Gongfang._writeState.editor.setValue(content || '');
  // ★ 打开文件后清空撤销历史：setValue 默认会记一条"回到空文档"的撤销，导致没编辑过时撤销按钮也亮着。
  //   清空后 historySize() = {undo:0, redo:0} → 上一步/下一步正确禁用，只有真正编辑过才可用。
  Gongfang._writeState.editor.clearHistory();
  Gongfang._writeState.editor.on('change', function() {
    // ★ 远端程序化 setValue（edit-stream / 同步重载）触发的 change：
    //   只读端不应把"收到的他人内容"当作自己的编辑 → 不标记脏、不自动保存、不反向实时流，
    //   否则会把陈旧内容回写权威盘、触发"读取异常"、导致 PDF 内容不跟编辑器一致。
    if (Gongfang._writeState._remoteSetValue) {
      Gongfang._writeState._remoteSetValue = false;
      Gongfang._writeUpdateHistoryBtns();
      if (Gongfang._writeScheduleOutlineRefresh) Gongfang._writeScheduleOutlineRefresh();
      return;
    }
    Gongfang._writeAutoSaveDebounce();
    Gongfang._writeUpdateHistoryBtns();
    // ★ 标记当前文件为脏（未落盘），供编译/切换前统一刷盘
    Gongfang._writeMarkDirty(Gongfang._writeState.activeFilePath, Gongfang._writeGetContent());
    // ★ 大纲随编辑内容实时刷新（防抖 800ms）
    Gongfang._writeScheduleOutlineRefresh();
    // ★ 协作实时流：持锁人编辑时推送内容给其他只读客户端（否则对方看不到改动）
    if (Gongfang._collabOnEditorChange) Gongfang._collabOnEditorChange();
  });
  // ★ 协作远端光标：持锁人移动光标/选区时推送坐标（对方只读端叠加标签）
  Gongfang._writeState.editor.on('cursorActivity', function(cm) {
    if (Gongfang._collabOnCursorActivity) Gongfang._collabOnCursorActivity(cm);
  });
  // ★ 初始化后同步撤销/重做按钮可用态
  Gongfang._writeUpdateHistoryBtns();
  setTimeout(function() { if (Gongfang._writeState.editor) Gongfang._writeState.editor.refresh(); }, 150);
};

// ★ 上一步 / 下一步：更新撤销/重做按钮的可用态（依据 CodeMirror 内置历史）
Gongfang._writeUpdateHistoryBtns = function() {
  var ed = Gongfang._writeState && Gongfang._writeState.editor;
  var u = document.getElementById('writeUndoBtn');
  var r = document.getElementById('writeRedoBtn');
  if (!ed) return;
  try {
    var h = ed.historySize();
    if (u) u.disabled = !(h && h.undo);
    if (r) r.disabled = !(h && h.redo);
  } catch(e) {}
};

// ★ 「上一步」：撤销上一步编辑
Gongfang._writeUndo = function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var ed = Gongfang._writeState && Gongfang._writeState.editor;
  if (ed) {
    ed.undo();
    Gongfang._writeUpdateHistoryBtns();
  } else {
    Gongfang._showToast('请先打开 .tex 文件');
  }
};

// ★ 「下一步」：重做（反悔后前进）
Gongfang._writeRedo = function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var ed = Gongfang._writeState && Gongfang._writeState.editor;
  if (ed) {
    ed.redo();
    Gongfang._writeUpdateHistoryBtns();
  } else {
    Gongfang._showToast('请先打开 .tex 文件');
  }
};

// ★ Ctrl+T 注释/取消注释：选中行（或光标所在行）行首加 %；全是注释则去掉
Gongfang._writeToggleComment = function(cm) {
  if (!cm) return;
  var from = cm.getCursor('from'), to = cm.getCursor('to');
  var first = from.line;
  var last = (from.line === to.line && from.ch === to.ch) ? from.line : to.line;
  var lines = [];
  var allCommented = true;
  for (var i = first; i <= last; i++) {
    var l = cm.getLine(i);
    lines.push(l);
    if (l.indexOf('%') !== 0) allCommented = false;
  }
  cm.operation(function() {
    for (var j = 0; j < lines.length; j++) {
      var ln = first + j;
      if (allCommented) {
        if (lines[j].indexOf('%') === 0) cm.replaceRange('', { line: ln, ch: 0 }, { line: ln, ch: 1 });
      } else {
        cm.replaceRange('%', { line: ln, ch: 0 }, { line: ln, ch: 0 });
      }
    }
  });
};

// ★ 扩展中心：写作界面右上角「扩展」按钮 → 扩展插件面板（各模块均开发中）
Gongfang._WRITE_EXTENSIONS = [
  { icon: '🔬', name: '科研写作', desc: '科研论文写作辅助' },
  { icon: '💾', name: '软著写作', desc: '软件著作权申请材料' },
  { icon: '📜', name: '专利写作', desc: '专利申请文书辅助' },
  { icon: '📚', name: '文献综述', desc: '文献调研与综述生成' },
  { icon: '💬', name: '摘要润色', desc: '摘要 / 结论润色改写' },
  { icon: '📖', name: '参考文献', desc: 'GB/T 7714 格式化' },
  { icon: '📊', name: '数据报告', desc: '数据可视化分析报告' },
  { icon: '🧪', name: '实验设计', desc: '实验方案与步骤设计' },
  { icon: '📄', name: '结题报告', desc: '项目结题报告生成' },
  { icon: '📋', name: '商业计划书', desc: 'BP 大纲与内容生成' },
  { icon: '🎓', name: '教学课件', desc: '课件大纲与内容生成' },
  { icon: '🔤', name: '代码注释', desc: '代码注释与文档生成' }
];


Gongfang._writeClearEditor = function() {
  if (Gongfang._writeState.editor) { var w = Gongfang._writeState.editor.getWrapperElement(); if (w && w.parentNode) w.parentNode.removeChild(w); Gongfang._writeState.editor = null; }
  var ta = document.getElementById('writeCodeMirror'); if (ta) ta.style.display = 'none';
  var ph = document.getElementById('writeEditorPlaceholder'); if (ph) ph.style.display = '';
  Gongfang._writeShowPdfPlaceholder();
  document.getElementById('writeCompileBarLog').textContent = '暂无编译记录';
  document.getElementById('writeCompileBarTime').textContent = '';
  Gongfang._writeSetCompileStatus('就绪', '');
  Gongfang._writeState.openFiles = [];
  Gongfang._writeState.activeFilePath = null;
  Gongfang._writeState.activeFileName = null;
  Gongfang._writeRenderTabs();
};

// ★ PDF 预览空状态
Gongfang._writeShowPdfPlaceholder = function() {
  var pane = document.getElementById('writePreviewPane');
  if (!pane) return;
  Gongfang._writePdfState._pdfPath = null;
  pane.innerHTML = '<div class="write-preview-placeholder" id="writePreviewPlaceholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>编译后 PDF 将在此显示</p></div>';
};

// ★ 终止编译
Gongfang._writeStopCompile = async function() {
  Gongfang._writeState.compileBusy = false;
  Gongfang._writeSetCompileBtn(false);
  Gongfang._writeSetCompileStatus('已终止', 'cmp-stop');
  Gongfang._writeAppendLog('编译已被用户终止');
};

Gongfang._writeGetContent = function() { return Gongfang._writeState.editor ? Gongfang._writeState.editor.getValue() : ''; };
// ★ 脏文件追踪：记录"已修改但尚未落盘"的文件内容，编译/切换前统一刷盘，避免只激活文件被保存、其余改动丢失
Gongfang._writeMarkDirty = function(filePath, content) {
  if (!filePath) return;
  if (!Gongfang._writeState._dirtyFiles) Gongfang._writeState._dirtyFiles = {};
  Gongfang._writeState._dirtyFiles[Gongfang._writeNormPath(filePath)] = content;
};
Gongfang._writeClearDirty = function(filePath) {
  if (!filePath) return;
  if (!Gongfang._writeState._dirtyFiles) Gongfang._writeState._dirtyFiles = {};
  delete Gongfang._writeState._dirtyFiles[Gongfang._writeNormPath(filePath)];
};
Gongfang._writeIsDirty = function(filePath) {
  if (!filePath || !Gongfang._writeState._dirtyFiles) return false;
  return Object.prototype.hasOwnProperty.call(Gongfang._writeState._dirtyFiles, Gongfang._writeNormPath(filePath));
};
// ★ 把所有脏文件写入磁盘（活动文件以编辑器实时内容为准，其余用缓存内容），供编译/切换前调用
Gongfang._writeFlushDirtyFiles = async function() {
  var st = Gongfang._writeState;
  if (!st._dirtyFiles) st._dirtyFiles = {};
  var dirty = st._dirtyFiles;
  // 活动文件仅在确有“未落盘改动”（编辑器内容 ≠ 已读磁盘版本）时才以实时内容为准刷盘，
  // 避免只读端把“收到的他人内容”当作本地改动回写权威盘（否则会覆盖他在端新写入的内容 → PDF 陈旧）。
  if (st.activeFilePath) {
    var anp = Gongfang._writeNormPath(st.activeFilePath);
    var nf = Gongfang._writeNormText || function (x) { return x; };
    var cur = (Gongfang._writeGetContent ? Gongfang._writeGetContent() : '') || '';
    if (st._lastDiskVersion == null || nf(cur) !== nf(st._lastDiskVersion)) {
      dirty[anp] = cur;
    }
  }
  var keys = Object.keys(dirty);
  for (var i = 0; i < keys.length; i++) {
    var np = keys[i];
    var content = dirty[np];
    if (content == null) continue;
    // 规范化路径 → 真实路径（openFiles 存的是真实路径）
    var realPath = np;
    var openItem = st.openFiles.find(function(f) { return Gongfang._writeNormPath(f.path) === np; });
    if (openItem) realPath = openItem.path;
    try {
      var r = await Gongfang._writePersistContent(realPath, content);
      if (r && r.success !== false) {
        delete dirty[np];
        if (Gongfang._writeNormPath(st.activeFilePath) === np) st._lastDiskVersion = content;
      } else if (r && r.success === false) {
        console.warn('[Gongfang] 编译前保存失败:', realPath, r.error);
      }
    } catch(e) { console.warn('[Gongfang] 编译前保存异常:', realPath, e); }
  }
};
// ★ 协作感知持久化：协作激活且属于协作项目 → 走 collabWriteFile(主/被端) 以广播 file-updated；否则本地写
Gongfang._writePersistContent = function(filePath, content) {
  var cs = Gongfang._collabState;
  if (cs && cs.active && Gongfang._writeState.activeProject && Gongfang._collabInPath(filePath)) {
    // ★ 只读预览方禁止写入（与顶部徽标同源判定），防止覆盖他人正在编辑的内容
    if (Gongfang._collabIsReadonly && Gongfang._collabIsReadonly(filePath)) {
      return Promise.resolve({ success: false, error: '该文件处于只读预览，不可保存' });
    }
    // 协作中：通过 collab-* IPC 写权威盘并广播 file-updated，对方收到后自动重载
    return window.electronAPI.collabWriteFile(filePath, content, false);
  }
  return window.electronAPI.writeFileContent(filePath, content);
};
// ★ 打开/切换文件时，把"我当前正在查看/编辑的文件"广播给其他成员（区分 编辑/查看 的实时同步）
Gongfang._writeNotifyCollabView = function(filePath) {
  var cs = Gongfang._collabState;
  if (!cs || !cs.active || !filePath || !Gongfang._collabInPath(filePath)) return;
  try { window.electronAPI.collabSendView(filePath); } catch (_) {}
};
// ★ 自动保存：编辑后 20 秒未点编译则自动保存一次
Gongfang._writeAutoSaveDebounce = function() {
  if (Gongfang._writeState._saveTimer) clearTimeout(Gongfang._writeState._saveTimer);
  Gongfang._writeState._saveTimer = setTimeout(function() { Gongfang._writeAutoSave(true); }, 20000);
};
// ★ 保存到磁盘：检查写结果，失败时提示（方便发现路径/权限问题）
Gongfang._writeAutoSave = async function(immediate) {
  if (immediate && Gongfang._writeState._saveTimer) { clearTimeout(Gongfang._writeState._saveTimer); Gongfang._writeState._saveTimer = null; }
  if (!immediate) return;
  var fp = Gongfang._writeState.activeFilePath;
  if (!fp) return;
  var content = Gongfang._writeGetContent();
  try {
    var r = await Gongfang._writePersistContent(fp, content);
    // 记下已落盘版本，供协作冲突比对
    if (r && r.success !== false) { Gongfang._writeState._lastDiskVersion = content; Gongfang._writeClearDirty(fp); }
    if (r && r.success === false) { console.warn('[Gongfang] 自动保存失败:', r.error); }
  } catch(e) { console.warn('[Gongfang] 自动保存异常:', e); }
};
// ★ 手动保存：图标短暂变成绿色对勾（动画反馈），随后恢复
Gongfang._writeSaveFile = async function() {
  if (!Gongfang._writeState.activeFilePath) { Gongfang._showToast('请先打开文件'); return; }
  // 协作中该文件对"我"只读 → 不可保存（与编辑器只读徽标同源判定）
  if (Gongfang._collabIsReadonly && Gongfang._collabIsReadonly(Gongfang._writeState.activeFilePath)) {
    Gongfang._showToast('该文件正被他人编辑，只读不可保存');
    return;
  }
  var btn = document.querySelector('.write-btn-save');
  var orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.style.color = '#16a34a';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  var fp = Gongfang._writeState.activeFilePath;
  var content = Gongfang._writeGetContent();
  try {
    var r = await Gongfang._writePersistContent(fp, content);
    // 记下已落盘版本，供协作冲突比对
    if (r && r.success !== false) { Gongfang._writeState._lastDiskVersion = content; Gongfang._writeClearDirty(fp); }
    if (r && r.success === false) { Gongfang._showToast('保存失败: ' + (r.error || '未知')); }
    else Gongfang._showToast('已保存');
  } catch(e) { Gongfang._showToast('保存失败'); }
  if (btn) {
    setTimeout(function() {
      btn.style.color = '';
      btn.innerHTML = orig;
    }, 900);
  }
};

// ═══════════════════════ 编译（参照 agent-events.js _liveCompile）═══════════════════════
Gongfang._writeCompile = async function() {
  var project = Gongfang._writeState.activeProject;
  if (!project) { Gongfang._showToast('请先选择项目'); return; }
  if (Gongfang._writeState.compileBusy) return;
  await Gongfang._writeFlushDirtyFiles();

  Gongfang._writeState.compileBusy = true;
  var startTime = Date.now();
  document.getElementById('writeCompileBarLog').textContent = '';
  Gongfang._writeSetCompileStatus('编译中', 'cmp-running');
  document.getElementById('writeCompileBarTime').textContent = '0s';
  Gongfang._writeSetCompileBtn(true);

  // ★ 不自动展开，保持用户设定

  Gongfang._writeAppendLog('开始编译...');
  var timer = setInterval(function() { document.getElementById('writeCompileBarTime').textContent = Math.floor((Date.now() - startTime) / 1000) + 's'; }, 500);

  // ★ 优先使用用户设定的编译主文件 → 项目默认 tex → 当前打开的 .tex 文件
  //   主文件必须属于当前项目（path-in-project），防止状态残留导致「任务A 编译任务B」
  var mainTex = Gongfang._writeState.mainTexFile;
  if (mainTex && !Gongfang._writePathInProject(mainTex, project.path)) mainTex = null;
  var texPath = mainTex
    || (project.texFile ? (project.path + '/' + project.texFile) : null)
    || ((Gongfang._writeState.activeFilePath && Gongfang._writePathInProject(Gongfang._writeState.activeFilePath, project.path) && /\.tex$/i.test(Gongfang._writeState.activeFilePath)) ? Gongfang._writeState.activeFilePath : null);

  var doCompile = function(tp) {
    Gongfang._writeAppendLog('编译: ' + tp.replace(/\\/g, '/'));
    return window.electronAPI.directCompile(tp, null, false, Gongfang._writeState.compileEngine || 'xelatex').then(function(result) {
      clearInterval(timer); document.getElementById('writeCompileBarTime').textContent = Math.floor((Date.now() - startTime) / 1000) + 's';
      Gongfang._writeState.compileBusy = false;
      Gongfang._writeSetCompileBtn(false);
      if (result && result.success) {
        Gongfang._writeSetCompileStatus('编译成功', 'cmp-ok');
        Gongfang._writeAppendLog('编译成功！PDF 已生成');
        // ★ 预览只认当前项目编译出的「论文.pdf」，其他 PDF 不预览
        if (Gongfang._isPaperPdf(result.pdfPath)) { Gongfang._writePdfRenderSingle(result.pdfPath); Gongfang._writePdfState._pdfPath = result.pdfPath; }
        else { Gongfang._writeShowPdfPlaceholder(); }
        Gongfang._showToast('编译成功');
      }
      else {
        Gongfang._writeSetCompileStatus('编译失败', 'cmp-err');
        Gongfang._writeAppendLog(result && (result.stderr || result.error) ? (result.stderr || result.error) : '编译失败');
        Gongfang._showToast('编译失败');
      }
    });
  };

  if (texPath) {
    doCompile(texPath).catch(function(err) {
      clearInterval(timer);
      Gongfang._writeState.compileBusy = false;
      Gongfang._writeSetCompileBtn(false);
      Gongfang._writeSetCompileStatus('编译失败', 'cmp-err');
      Gongfang._writeAppendLog('异常: ' + (err.message || err));
      Gongfang._showToast('编译失败');
    });
  } else {
    window.electronAPI.findTexFile(project.path).then(function(r) {
      if (!r || !r.success || !r.texPath) {
        clearInterval(timer);
        Gongfang._writeState.compileBusy = false;
        Gongfang._writeSetCompileBtn(false);
        Gongfang._writeSetCompileStatus('编译失败', 'cmp-err');
        Gongfang._writeAppendLog('未找到 .tex 文件');
        Gongfang._showToast('编译失败');
        return;
      }
      return doCompile(r.texPath);
    }).catch(function(err) {
      clearInterval(timer);
      Gongfang._writeState.compileBusy = false;
      Gongfang._writeSetCompileBtn(false);
      Gongfang._writeSetCompileStatus('编译失败', 'cmp-err');
      Gongfang._writeAppendLog('失败: ' + (err.message || '未找到 tex 文件'));
      Gongfang._showToast('编译失败');
    });
  }
};


// ═══════════════════════ LaTeX 快捷插入 ═══════════════════════
Gongfang._writeInsertLatex = function(type) {
  if (Gongfang._collabBlockedByPreview()) return;
  var editor = Gongfang._writeState.editor;
  if (!editor) { Gongfang._showToast('请先打开 .tex 文件'); return; }

  // ★ 内联命令（可用 {} 包裹选中文字）
  var inlineWraps = {
    'bold':      ['\\textbf{', '}'],
    'italic':    ['\\textit{', '}'],
    'underline': ['\\underline{', '}'],
    'large':     ['{\\large ', '}'],
    'small':     ['{\\small ', '}'],
  };

  // ★ 块级环境（包裹选中行）
  var blockWraps = {
    'center':    ['\\begin{center}\n', '\n\\end{center}'],
    'left':      ['\\begin{flushleft}\n', '\n\\end{flushleft}'],
    'right':     ['\\begin{flushright}\n', '\n\\end{flushright}'],
    'enumerate': ['\\begin{enumerate}\n\t\\item ', '\n\\end{enumerate}'],
    'itemize':   ['\\begin{itemize}\n\t\\item ', '\n\\end{itemize}'],
    'math-display': ['\\[\n', '\n\\]'],
    'multicols':    ['\\begin{multicols}{2}\n', '\n\\end{multicols}'],
  };

  // ★ 纯模板（无选中包裹逻辑，始终插入完整模板）
  var templates = {
    'section':       '\\section{}',
    'subsection':    '\\subsection{}',
    'table':         '\\begin{table}[ht]\n\t\\centering\n\t\\caption{}\n\t\\label{tab:}\n\t\\begin{tabular}{|c|c|c|}\n\t\t\\hline\n\t\t & & \\\\\n\t\t\\hline\n\t\t & & \\\\\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}',
    'math-inline':   '$ $',
    'figure':        '\\begin{figure}[ht]\n\t\\centering\n\t\\includegraphics[width=0.7\\textwidth]{}\n\t\\caption{}\n\t\\label{fig:}\n\\end{figure}',
    'subsubsection': '\\subsubsection{}',
    'equation':      '\\begin{equation}\n\t\n\\end{equation}',
    'newpage':       '\\newpage',
  };

  var doc = editor.getDoc();
  var sel = doc.getSelection();

  // ★ 引用类：表格/图表/文献，插入后光标置于填写处
  if (type === 'ref-table' || type === 'ref-figure' || type === 'ref-cite') {
    var refText = type === 'ref-table' ? '\\ref{tab:}' : type === 'ref-figure' ? '\\ref{fig:}' : '\\cite{}';
    doc.replaceSelection(refText);
    var rpos = doc.getCursor();
    doc.setCursor({ line: rpos.line, ch: Math.max(0, rpos.ch - 1) });
    editor.focus();
    return;
  }

  // ── 内联包裹：选中文字 → 裹在命令里 ──
  if (inlineWraps[type] && sel) {
    var w = inlineWraps[type];
    doc.replaceSelection(w[0] + sel + w[1]);
    editor.focus();
    return;
  }

  // ── 块级包裹：选中行 → 裹在环境里 ──
  if (blockWraps[type] && sel) {
    var bw = blockWraps[type];
    doc.replaceSelection(bw[0] + sel + bw[1]);
    editor.focus();
    return;
  }

  // ── 无选中 / 纯模板 → 插入模板，定位光标 ──
  var text = templates[type] || (inlineWraps[type] ? inlineWraps[type][0] + inlineWraps[type][1] : null) || (blockWraps[type] ? blockWraps[type][0] + blockWraps[type][1] : null) || '';
  if (!text) return;

  var cursorPos = text.indexOf('{}');
  if (cursorPos >= 0) cursorPos += 1;
  else if (text.indexOf('$ $') >= 0) cursorPos = text.indexOf('$ $') + 1;
  else cursorPos = text.length;

  var cursor = doc.getCursor();
  doc.replaceRange(text, cursor);

  if (cursorPos >= 0 && cursorPos < text.length) {
    doc.setCursor({ line: cursor.line, ch: cursor.ch + cursorPos });
  } else {
    var lines = text.split('\n');
    if (lines.length > 2) {
      doc.setCursor({ line: cursor.line + Math.floor(lines.length / 2), ch: cursor.ch + 4 });
    }
  }
  editor.focus();
};

// ★ 已删除 _writeAiFix/_writeUpdateAiFixBtnState：AI 改错入口按钮在上游即不存在，整链下线

// ═══════════════════════ 图片插入（选文件 + 配置弹窗）═══════════════════════
// ★ 从指定路径插入图片（工作区选图用）：统一转成相对于 tex 目录的相对路径（跨设备可移植）
//   绝对路径随设备/盘符变化而失效；相对路径只要项目结构不变就跨设备有效。
Gongfang._writeInsertImageFromPath = async function(srcPath) {
  var editor = Gongfang._writeState.editor;
  if (!editor) { Gongfang._showToast('请先打开项目'); return; }
  var project = Gongfang._writeState.activeProject;

  var srcName = srcPath.split(/[\\/]/).pop();
  var baseName = srcName.replace(/\.[^.]+$/, '');
  var config = await Gongfang._writeShowImageConfig(baseName);
  if (!config) return;

  // ★ 绝对路径 → 换成相对 tex 目录的路径（项目外图片先拷入项目）；已是相对路径（如 共享文件区/<名>）则保持
  var relPath = Gongfang._writeIsAbsPath(srcPath)
    ? await Gongfang._writePrepareImageForTex(srcPath, project && project.path, Gongfang._writeState.activeFilePath)
    : Gongfang._writeNormPath(srcPath);
  var code = '\\begin{figure}[' + config.float + ']\n\t\\centering\n\t\\includegraphics[width=' + config.width + '\\textwidth]{"' + relPath + '"}\n\t\\caption{' + config.caption + '}\n\t\\label{fig:' + config.label + '}\n\\end{figure}';
  var doc = editor.getDoc();
  doc.replaceRange(code, doc.getCursor());
  editor.focus();
};

Gongfang._writeInsertImage = async function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var editor = Gongfang._writeState.editor;
  if (!editor) { Gongfang._showToast('请先打开项目'); return; }

  // 1. 打开图片文件选择器
  var result;
  try {
    result = await window.electronAPI.openFileDialog({
      title: '选择图片文件',
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
  } catch(e) { return; }
  if (!result || !result.length) return;

  var srcPath = result[0];
  var srcName = srcPath.split(/[\\/]/).pop();
  var baseName = srcName.replace(/\.[^.]+$/, '');

  // 2. 弹出配置弹窗
  var config = await Gongfang._writeShowImageConfig(baseName);
  if (!config) return; // 用户取消

  // 3. 生成 LaTeX 代码并插入（★ 换成相对 tex 目录的路径；项目外图片先拷入项目，保证跨设备可移植）
  var relPath = await Gongfang._writePrepareImageForTex(srcPath, Gongfang._writeState.activeProject && Gongfang._writeState.activeProject.path, Gongfang._writeState.activeFilePath);
  var code = '\\begin{figure}[' + config.float + ']\n' +
    '\t\\centering\n' +
    '\t\\includegraphics[width=' + config.width + '\\textwidth]{"' + relPath + '"}\n' +
    '\t\\caption{' + config.caption + '}\n' +
    '\t\\label{fig:' + config.label + '}\n' +
    '\\end{figure}';

  var doc = editor.getDoc();
  var cursor = doc.getCursor();
  doc.replaceRange(code, cursor);
  // 光标放到 caption 旁边方便编辑
  var capLine = code.indexOf('\\caption{');
  if (capLine >= 0) {
    var lineOffset = code.substring(0, capLine).split('\n').length - 1;
    doc.setCursor({ line: cursor.line + lineOffset, ch: cursor.ch + 10 });
  }
  editor.focus();
};

// ★ 图片配置弹窗
Gongfang._writeShowImageConfig = function(baseName) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box" style="width:380px">' +
        '<div class="modal-title" style="margin-bottom:12px">图片设置</div>' +
        '<div class="write-img-config">' +
          '<label>图片宽度 <span style="font-weight:400;color:#a1a1aa">（填 0 ~ 1 的数字，按高宽比选档：方0.60/中0.65/宽0.70）</span></label>' +
          '<input id="imgCfgWidth" class="set-input" value="0.70" placeholder="如 0.65" style="width:100%;margin-bottom:10px">' +
          '<label>标签 <span style="font-weight:400;color:#a1a1aa">（引用时用 \\ref{fig:xxx}）</span></label>' +
          '<input id="imgCfgLabel" class="set-input" value="' + escAttr(baseName.replace(/[\{}%#$&\s]/g, '-')) + '" style="width:100%;margin-bottom:10px">' +
          '<label>标题 <span style="font-weight:400;color:#a1a1aa">（图片下方显示的文字）</span></label>' +
          '<input id="imgCfgCaption" class="set-input" value="' + escAttr(latexEscape(baseName)) + '" style="width:100%;margin-bottom:10px">' +
          '<label>浮动方式 <span style="color:#a1a1aa;font-weight:400">（禁止 H 强制定位）</span></label>' +
          '<div style="display:flex;gap:6px;margin-bottom:4px">' +
            '<button class="img-float-btn active" data-float="ht" onclick="Gongfang._writeImgFloatClick(this)">ht 推荐</button>' +
            '<button class="img-float-btn" data-float="htbp" onclick="Gongfang._writeImgFloatClick(this)">htbp 自动</button>' +
            '<button class="img-float-btn" data-float="t" onclick="Gongfang._writeImgFloatClick(this)">t 顶部</button>' +
            '<button class="img-float-btn" data-float="b" onclick="Gongfang._writeImgFloatClick(this)">b 底部</button>' +
          '</div>' +
        '</div>' +
        '<div class="modal-btns" style="margin-top:14px">' +
          '<button class="modal-btn modal-btn-cancel" id="imgCfgCancel">取消</button>' +
          '<button class="modal-btn modal-btn-primary" id="imgCfgOk">插入</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var floatVal = 'ht';
    overlay.querySelector('#imgCfgOk').onclick = function() {
      var w = parseFloat(overlay.querySelector('#imgCfgWidth').value.trim());
      if (isNaN(w) || w <= 0 || w > 1) w = 0.8;
      var l = overlay.querySelector('#imgCfgLabel').value.trim() || baseName.replace(/[\{}%#$&\s]/g, '-');
      var c = overlay.querySelector('#imgCfgCaption').value.trim() || latexEscape(baseName);
      overlay.remove();
      resolve({ width: w, label: l, caption: c, float: floatVal });
    };
    overlay.querySelector('#imgCfgCancel').onclick = function() { overlay.remove(); resolve(null); };
    overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); resolve(null); } };

    // 浮动方式按钮切换
    Gongfang._writeImgFloatClick = function(btn) {
      overlay.querySelectorAll('.img-float-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      floatVal = btn.dataset.float;
    };
  });
};
Gongfang._writePdfState = { fitMode: 'width', _pdfPath: null, _page: 1, _zoom: 100, spread: false };

// ★ 工具栏下拉菜单
// ★ 下拉菜单 fixed 定位：按触发按钮的视口坐标摆放，避免被横向滚动的工具栏裁剪
Gongfang._writePositionDropdown = function(menu) {
  try {
    var wrap = menu.closest('.write-tb-dropdown');
    var btn = wrap ? wrap.querySelector('button') : null;
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = (r.left + r.width / 2) + 'px';
    menu.style.transform = 'translateX(-50%)';
    // 夹紧：菜单右边缘不超出视口
    var mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth - 4) {
      menu.style.left = (window.innerWidth - 4) + 'px';
      menu.style.transform = 'translateX(-100%)';
    }
    if (mr.left < 4) {
      menu.style.left = '4px';
      menu.style.transform = 'translateX(0)';
    }
  } catch(e) {}
};

Gongfang._writeToggleDropdown = function(name) {
  var menu = document.querySelector('.write-tb-dropdown-menu[data-dropdown="' + name + '"]');
  if (!menu) return;
  var isOpen = menu.classList.contains('show');
  Gongfang._writeCloseDropdowns();
  if (!isOpen) { menu.classList.add('show'); Gongfang._writePositionDropdown(menu); }
};

Gongfang._writeCloseDropdowns = function() {
  document.querySelectorAll('.write-tb-dropdown-menu').forEach(function(m) { m.classList.remove('show'); });
};

// ★ 表格配置菜单


// ★ 图片菜单
Gongfang._writeToggleImageMenu = function() {
  var menu = document.querySelector('.write-tb-dropdown-menu[data-dropdown="image"]');
  if (!menu) return;
  var isOpen = menu.classList.contains('show');
  Gongfang._writeCloseDropdowns();
  if (!isOpen) { menu.classList.add('show'); Gongfang._writePositionDropdown(menu); }
};

// ★ 表格：打开完整配置弹窗（行列 / 风格 / 浮动 / 名称 / 引用 / 上传 CSV）
Gongfang._writeOpenTableDialog = async function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var editor = Gongfang._writeState.editor;
  if (!editor) { Gongfang._showToast('请先打开文件'); return; }
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box" style="width:460px;max-width:92vw;max-height:80vh;overflow-y:auto;">' +
      '<div class="modal-title" style="margin-bottom:12px">插入表格</div>' +
      '<div class="write-img-config">' +
        '<div style="display:flex;gap:10px;margin-bottom:10px">' +
          '<div style="flex:1"><label>行数</label><input id="tblDlgRows" type="text" inputmode="numeric" class="set-input" value="" placeholder="如 5" style="width:100%"></div>' +
          '<div style="flex:1"><label>列数</label><input id="tblDlgCols" type="text" inputmode="numeric" class="set-input" value="" placeholder="如 2" style="width:100%"></div>' +
        '</div>' +
        '<label>表格风格</label>' +
        '<div id="tblStyleRow" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
          '<button class="img-float-btn active" data-style="symbol">符号说明</button>' +
          '<button class="img-float-btn" data-style="equal">等宽居中</button>' +
          '<button class="img-float-btn" data-style="label">左窄右宽</button>' +
        '</div>' +
        '<label>浮动形式</label>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px">' +
          '<button class="img-float-btn active" data-float="H">H 固定</button>' +
          '<button class="img-float-btn" data-float="htbp">htbp 自动</button>' +
          '<button class="img-float-btn" data-float="t">t 顶部</button>' +
          '<button class="img-float-btn" data-float="b">b 底部</button>' +
        '</div>' +
        '<label>表格名字</label><input id="tblCaption" class="set-input" value="表标题" style="width:100%;margin-bottom:10px">' +
        '<label>表格引用</label><input id="tblLabel" class="set-input" value="表标题" style="width:100%;margin-bottom:10px">' +
        '<label>上传 CSV 创建表格</label>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<button class="modal-btn modal-btn-primary" id="tblUploadCsv" style="padding:5px 12px;font-size:11px;">上传 CSV</button>' +
          '<span id="tblCsvChip" style="display:none;align-items:center;gap:6px;padding:3px 8px;border:1px solid #e5e7eb;border-radius:5px;background:#f4f4f5;font-size:11px;color:#3f3f46;"></span>' +
        '</div>' +
      '</div>' +
      '<div class="modal-btns" style="margin-top:14px">' +
        '<button class="modal-btn modal-btn-cancel" id="tblDialogCancel">取消</button>' +
        '<button class="modal-btn modal-btn-primary" id="tblDialogOk">插入表格</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var styleVal = 'symbol';
  var floatVal = 'H';
  overlay.querySelector('#tblDialogCancel').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  overlay.querySelectorAll('#tblStyleRow .img-float-btn').forEach(function(b) {
    b.onclick = function() {
      overlay.querySelectorAll('#tblStyleRow .img-float-btn').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active'); styleVal = b.dataset.style;
    };
  });
  overlay.querySelectorAll('[data-float]').forEach(function(b) {
    b.onclick = function() {
      overlay.querySelectorAll('[data-float]').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active'); floatVal = b.dataset.float;
    };
  });

  var csvRows = null;
  overlay.querySelector('#tblUploadCsv').onclick = async function() {
    var r;
    try {
      r = await window.electronAPI.openFileDialog({
        title: '选择 CSV 文件', properties: ['openFile'],
        filters: [{ name: 'CSV 表格', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }]
      });
    } catch(e) { return; }
    if (!r || !r.length) return;
    if (!/\.csv$/i.test(r[0])) { Gongfang._showToast('仅支持 CSV 表'); return; }
    try {
      var c = await window.electronAPI.readFileContent(r[0]);
      var text = (c && c.text !== undefined) ? c.text : (typeof c === 'string' ? c : '');
      csvRows = Gongfang._parseCsvTable(text);
      if (!csvRows || !csvRows.length) { Gongfang._showToast('CSV 内容为空'); return; }
      document.getElementById('tblDlgRows').value = Math.max(1, csvRows.length - 1);
      document.getElementById('tblDlgCols').value = (csvRows[0] || []).length;
      var csvBase = r[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      var capEl = document.getElementById('tblCaption');
      if (capEl) capEl.value = csvBase;
      var labEl = document.getElementById('tblLabel');
      if (labEl) labEl.value = csvBase;
      var chip = document.getElementById('tblCsvChip');
      if (chip) {
        chip.style.display = 'inline-flex';
        chip.innerHTML = '';
        var nspan = document.createElement('span');
        nspan.textContent = r[0].split(/[\\/]/).pop() + '（' + csvRows.length + '×' + (csvRows[0] || []).length + '）';
        chip.appendChild(nspan);
        var del = document.createElement('button');
        del.textContent = '×';
        del.title = '删除已上传的 CSV';
        del.style.cssText = 'border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;';
        del.onclick = function() { csvRows = null; chip.style.display = 'none'; document.getElementById('tblDlgRows').value = ''; document.getElementById('tblDlgCols').value = ''; };
        chip.appendChild(del);
      }
      Gongfang._showToast('CSV 已载入');
    } catch(e) { Gongfang._showToast('读取 CSV 失败'); }
  };

  overlay.querySelector('#tblDialogOk').onclick = function() {
    var rows = parseInt(document.getElementById('tblDlgRows').value);
    var cols = parseInt(document.getElementById('tblDlgCols').value);
    if (!rows || !cols || rows < 1 || cols < 1) { Gongfang._showToast('请填写正确的行数和列数'); return; }
    var caption = document.getElementById('tblCaption').value.trim() || '表标题';
    var label = document.getElementById('tblLabel').value.trim() || caption;
    overlay.remove();
    Gongfang._writeInsertTableFromDialog({ rows: rows, cols: cols, style: styleVal, float: floatVal, caption: caption, label: label, csv: csvRows });
  };
};

// ★ 解析 CSV 文本（支持引号包裹）
Gongfang._parseCsvTable = function(text) {
  var lines = String(text || '').split(/\r?\n/).filter(function(l) { return l.trim() !== ''; });
  var rows = [];
  for (var i = 0; i < lines.length; i++) rows.push(Gongfang._splitCsvLine(lines[i]));
  var maxCols = 0;
  rows.forEach(function(r) { if (r.length > maxCols) maxCols = r.length; });
  rows.forEach(function(r) { while (r.length < maxCols) r.push(''); });
  return rows;
};
Gongfang._splitCsvLine = function(line) {
  var out = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
};

// ★ 生成 longtable（CSV 第一行做表头、数据从第二行起；支持风格 / 浮动 / 名称 / 引用 / 合并检测）
Gongfang._writeInsertTableFromDialog = function(cfg) {
  var editor = Gongfang._writeState.editor;
  if (!editor) return;
  // ★ 标题/引用清洗：caption 转义 LaTeX 特殊字符，label 剔除空格与特殊符号
  var escTex = function(s) { return String(s || '').replace(/([%#&_{}])/g, '\\$1'); };
  cfg.caption = escTex(cfg.caption || '表标题');
  cfg.label = String(cfg.label || cfg.caption || 'tab').replace(/[\s%#&${}~^\\]/g, '') || 'tab';
  var rows = cfg.rows, cols = cfg.cols;
  var csvData = null, csvHeader = null;
  if (cfg.csv && cfg.csv.length) {
    csvHeader = cfg.csv[0] || [];
    csvData = cfg.csv.slice(1);
    cols = csvHeader.length;
    rows = csvData.length;
  }

  // ★ 列规格 + 表头：CSV 用第一行作表头；否则按风格生成
  var colSpec = '', headers = [];
  if (csvHeader) {
    headers = csvHeader.map(function(h) { return escTex(h); });
    var w0 = Math.floor(96 / cols);
    var arrH = [];
    for (var h2 = 0; h2 < cols; h2++) arrH.push('>{\\centering\\arraybackslash}p{' + (w0 / 100) + '\\textwidth}');
    colSpec = arrH.join('');
  } else if (cfg.style === 'symbol' && cols === 2) {
    colSpec = '>{\\centering\\arraybackslash}p{0.18\\textwidth}>{\\centering\\arraybackslash}p{0.78\\textwidth}';
    headers = ['符号', '说明'];
  } else if (cfg.style === 'label') {
    var arr = ['>{\\centering\\arraybackslash}p{0.16\\textwidth}'];
    var rest = Math.round((0.80 / Math.max(1, cols - 1)) * 100) / 100;
    for (var i = 1; i < cols; i++) arr.push('>{\\centering\\arraybackslash}p{' + rest + '\\textwidth}');
    colSpec = arr.join('');
    for (var j = 0; j < cols; j++) headers.push('列' + (j + 1));
  } else {
    var w = Math.floor(96 / cols);
    var arr2 = [];
    for (var k = 0; k < cols; k++) arr2.push('>{\\centering\\arraybackslash}p{' + (w / 100) + '\\textwidth}');
    colSpec = arr2.join('');
    for (var h = 0; h < cols; h++) headers.push('列' + (h + 1));
  }

  var code = '% longtable：可跨页，居中，比例按内容调整\n';
  code += '\\begin{longtable}{' + colSpec + '}\n';
  code += '  \\caption{' + cfg.caption + '}\n';
  code += '  \\label{tab:' + cfg.label + '} \\\\\n';
  code += '  \\toprule\n';
  code += '  ' + headers.join(' & ') + ' \\\\\n';
  code += '  \\midrule\n';
  code += '  \\endfirsthead\n';
  code += '  \\caption{' + cfg.caption + '（续）} \\\\\n';
  code += '  \\toprule\n';
  code += '  ' + headers.join(' & ') + ' \\\\\n';
  code += '  \\midrule\n';
  code += '  \\endhead\n';
  code += '  \\bottomrule\n';
  code += '  \\endfoot\n';

  if (csvData && csvData.length) {
    // ★ CSV 合并检测（非空单元格 + 右侧/下方连续空单元格 → 合并）
    var grid = [];
    for (var r = 0; r < rows; r++) {
      grid[r] = [];
      for (var c = 0; c < cols; c++) grid[r][c] = { text: (csvData[r] && csvData[r][c]) || '', rowspan: 1, colspan: 1 };
    }
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        if (!grid[r2][c2]) continue;
        if (grid[r2][c2].text === '') continue;
        var span = 1;
        while (c2 + span < cols && grid[r2][c2 + span] && grid[r2][c2 + span].text === '') { grid[r2][c2 + span] = null; span++; }
        grid[r2][c2].colspan = span;
      }
    }
    for (var r3 = 0; r3 < rows; r3++) {
      for (var c3 = 0; c3 < cols; c3++) {
        if (!grid[r3][c3]) continue;
        if (grid[r3][c3].text === '') continue;
        var span2 = 1;
        while (r3 + span2 < rows && grid[r3 + span2][c3] && grid[r3 + span2][c3].text === '') { grid[r3 + span2][c3] = null; span2++; }
        grid[r3][c3].rowspan = span2;
      }
    }
    var escCell = function(t) { return String(t || '').replace(/([_%#$&{}])/g, '\\$1'); };
    for (var rr = 0; rr < rows; rr++) {
      var cells = [];
      for (var cc = 0; cc < cols; cc++) {
        var g = grid[rr][cc];
        if (!g) continue;
        var t = escCell(g.text);
        if (g.colspan > 1 && g.rowspan > 1) cells.push('\\multicolumn{' + g.colspan + '}{c}{\\multirow{' + g.rowspan + '}{*}{' + t + '}}');
        else if (g.colspan > 1) cells.push('\\multicolumn{' + g.colspan + '}{c}{' + t + '}');
        else if (g.rowspan > 1) cells.push('\\multirow{' + g.rowspan + '}{*}{' + t + '}');
        else cells.push(t);
      }
      code += '  ' + cells.join(' & ') + ' \\\\\n';
    }
  } else {
    for (var rd = 0; rd < rows; rd++) {
      var cds = [];
      for (var cd2 = 0; cd2 < cols; cd2++) cds.push('...');
      code += '  ' + cds.join(' & ') + ' \\\\\n';
    }
  }
  code += '\\end{longtable}';

  var doc = editor.getDoc();
  doc.replaceRange(code, doc.getCursor());
  editor.focus();
};;;

;;

// ★ 从工作区选图片（直接用当前任务，区分已引用/未引用；每条 = 图片名 + 放大预览 + 添加）
Gongfang._writeInsertImageWs = async function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var project = Gongfang._writeState.activeProject;
  if (!project) { Gongfang._showToast('请先选择项目'); return; }
  var imgs;
  try { imgs = await Gongfang._writeScanWsImages(project.path); }
  catch(e) { imgs = []; }
  if (!imgs.length) { Gongfang._showToast('当前任务下没有图片'); return; }

  // ★ 已引用图片集合（按文件名小写）
  var referenced = {};
  try { referenced = await Gongfang._writeScanReferencedImages(project.path); } catch(e) {}

  // ★ 图片选择弹窗
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box" style="width:720px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;">' +
      '<div class="modal-title" style="margin-bottom:10px">选择图片（当前任务）</div>' +
      '<div style="flex:1;overflow-y:auto;padding:4px 2px;" id="wsImgList"></div>' +
      '<div class="modal-btns" style="margin-top:12px">' +
        '<button class="modal-btn modal-btn-cancel" id="wsImgClose">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#wsImgClose').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var list = overlay.querySelector('#wsImgList');
  imgs.forEach(function(img) {
    var fileName = img.split(/[\\/]/).pop();
    var base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
    var isRef = !!referenced[base];
    var encSrc = 'file:///' + img.replace(/\\/g, '/');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid #f0f0f0;border-radius:6px;margin-bottom:6px;';

    var thumb = document.createElement('img');
    thumb.src = encSrc;
    thumb.style.cssText = 'width:44px;height:34px;object-fit:cover;border-radius:4px;background:#f4f4f5;flex-shrink:0;';
    thumb.onerror = function() { thumb.style.visibility = 'hidden'; };
    row.appendChild(thumb);

    var name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (isRef ? 'color:#a1a1aa;' : 'color:#3f3f46;font-weight:600;');
    name.textContent = fileName;
    name.title = fileName;
    row.appendChild(name);

    // ★ 已引用标识
    if (isRef) {
      var chip = document.createElement('span');
      chip.style.cssText = 'flex:0 0 auto;font-size:9px;color:#059669;background:#d1fae5;border-radius:4px;padding:1px 6px;font-weight:600;flex-shrink:0;';
      chip.textContent = '已引用';
      row.appendChild(chip);
    }

    // ★ 放大预览按钮
    var prevBtn = document.createElement('button');
    prevBtn.title = '放大预览';
    prevBtn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #e5e7eb;border-radius:5px;background:#fff;color:#52525b;cursor:pointer;';
    prevBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>';
    prevBtn.onclick = function(e) { e.stopPropagation(); Gongfang._writeShowImagePreview(img); };
    row.appendChild(prevBtn);

    // ★ 添加按钮（已引用=灰色，未引用=绿色）
    var addBtn = document.createElement('button');
    addBtn.title = isRef ? '再次插入该图片' : '添加图片';
    addBtn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:5px;font-size:16px;line-height:1;cursor:pointer;font-weight:600;' + (isRef ? 'background:#e5e7eb;color:#71717a;' : 'background:#16a34a;color:#fff;');
    addBtn.textContent = '+';
    addBtn.onclick = function(e) {
      e.stopPropagation();
      Gongfang._writeInsertImageFromPath(img);
      overlay.remove();
    };
    row.appendChild(addBtn);

    list.appendChild(row);
  });
};;

// ★ 从图片共享文件区选图片（与「从任务」同款弹窗；插入用统一相对路径 共享文件区/<名>，跨设备一致）
//   无论共享区是否有图片都弹出选择窗，空/不可用时在窗内提示，避免"点击无反应"
Gongfang._writeInsertImageShare = async function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var r;
  try { r = await window.electronAPI.collabListShared(); }
  catch (e) { r = null; }
  var dir = (r && r.dir) || '';
  var files = [];
  if (r && r.success) {
    files = (r.files || []).filter(function (f) { return !f.isDir && Gongfang._collabIsImage(f.name); });
  }

  // ★ 共享区图片选择弹窗（与「从任务」一致）
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box" style="width:720px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;">' +
      '<div class="modal-title" style="margin-bottom:10px">选择图片（共享文件区）</div>' +
      '<div style="flex:1;overflow-y:auto;padding:4px 2px;" id="wsShareImgList"></div>' +
      '<div class="modal-btns" style="margin-top:12px">' +
        '<button class="modal-btn modal-btn-cancel" id="wsShareImgClose">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#wsShareImgClose').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var list = overlay.querySelector('#wsShareImgList');
  if (!r || !r.success) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">共享文件区暂不可用</div>';
    return;
  }
  if (!files.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">共享文件区暂无图片</div>';
    return;
  }
  files.forEach(function (f) {
    var fileName = f.name;
    var full = (dir ? String(dir).replace(/[\\/]+$/, '') + '/' : '') + fileName;
    var encSrc = Gongfang._collabFileUrl(full);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid #f0f0f0;border-radius:6px;margin-bottom:6px;';

    var thumb = document.createElement('img');
    thumb.src = encSrc;
    thumb.style.cssText = 'width:44px;height:34px;object-fit:cover;border-radius:4px;background:#f4f4f5;flex-shrink:0;';
    thumb.onerror = function() { thumb.style.visibility = 'hidden'; };
    row.appendChild(thumb);

    var name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3f3f46;font-weight:600;';
    name.textContent = fileName;
    name.title = fileName;
    row.appendChild(name);

    // ★ 放大预览按钮
    var prevBtn = document.createElement('button');
    prevBtn.title = '放大预览';
    prevBtn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #e5e7eb;border-radius:5px;background:#fff;color:#52525b;cursor:pointer;';
    prevBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>';
    prevBtn.onclick = function(e) { e.stopPropagation(); Gongfang._writeShowImagePreview(full); };
    row.appendChild(prevBtn);

    // ★ 添加按钮
    var addBtn = document.createElement('button');
    addBtn.title = '添加图片';
    addBtn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:5px;font-size:16px;line-height:1;cursor:pointer;font-weight:600;background:#16a34a;color:#fff;';
    addBtn.textContent = '+';
    addBtn.onclick = function(e) {
      e.stopPropagation();
      Gongfang._writeInsertImageFromPath(Gongfang._collabSharedRel(fileName));
      overlay.remove();
    };
    row.appendChild(addBtn);

    list.appendChild(row);
  });
};;

// ★ 放大预览：全屏遮罩显示原图，点击关闭
Gongfang._writeShowImagePreview = function(imgPath) {
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  var img = document.createElement('img');
  img.src = 'file:///' + imgPath.replace(/\\/g, '/');
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.5);';
  ov.appendChild(img);
  ov.onclick = function() { ov.remove(); };
  document.body.appendChild(ov);
};;;

Gongfang._writeScanWsImages = async function(wsPath) {
  var imgs = [];
  try {
    // ★ 用 listDirFiles（对应主进程 list-dir-files，递归扫描全部子目录，含「求解」等）
    var r = await window.electronAPI.listDirFiles(wsPath);
    if (r && r.files) {
      r.files.forEach(function(f) {
        if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.name)) imgs.push(f.path);
      });
    }
  } catch(e) {}
  return imgs;
};

// ★ 引用：表格/图片/文献 —— 扫描整个 LaTeX 项目，列出可引用的标签（可选引用风格）
Gongfang._writeInsertRef = async function(kind) {
  if (Gongfang._collabBlockedByPreview()) return;
  var project = Gongfang._writeState.activeProject;
  if (!project) { Gongfang._showToast('请先选择项目'); return; }
  var kindName = kind === 'cite' ? '文献' : kind === 'fig' ? '图片' : '表格';
  var items = [];
  try {
    var r = await window.electronAPI.listDirFiles(project.path);
    var texFiles = (r && r.files) ? r.files.filter(function(f) { return /\.tex$/i.test(f.name); }) : [];
    for (var i = 0; i < texFiles.length && i < 25; i++) {
      var c = await window.electronAPI.readFileContent(texFiles[i].path);
      var text = (c && c.text !== undefined) ? c.text : (typeof c === 'string' ? c : '');
      if (kind === 'cite') {
        var re = /\\bibitem\{([^}]+)\}([\s\S]*?)(?=\\bibitem\{|\\(?:end\{thebibliography\}|bibliography))/g;
        var m;
        while ((m = re.exec(text)) !== null) {
          var desc = (m[2] || '').replace(/\\(?:[a-zA-Z]+|\{|\}|\[|\])/g, ' ').replace(/\s+/g, ' ').trim();
          items.push({ label: m[1], name: desc ? desc.substring(0, 50) : m[1] });
        }
      } else {
        var capRe = new RegExp('\\\\caption\\{([^}]*)\\}\\s*\\\\label\\{' + kind + ':([^}]+)\\}', 'g');
        var m2;
        while ((m2 = capRe.exec(text)) !== null) items.push({ label: m2[2], name: m2[1] || m2[2] });
        var labelRe = new RegExp('\\\\label\\{' + kind + ':([^}]+)\\}', 'g');
        var m3;
        while ((m3 = labelRe.exec(text)) !== null) {
          var lb = m3[1];
          if (!items.some(function(it) { return it.label === lb; })) items.push({ label: lb, name: lb });
        }
      }
    }
  } catch(e) {}
  if (!items.length) { Gongfang._showToast('项目中未找到可引用的' + kindName); return; }

  // ★ 引用风格：表格/图片可选 \\ref（纯编号）或 \\cref（自动"表X/图X"，需 cleveref）；文献用 \\cite
  var styles = kind === 'cite'
    ? [{ key: 'cite', label: '\\cite{...} 编号引用' }]
    : [{ key: 'ref',  label: '\\ref{...} 纯编号' }, { key: 'cref', label: '\\cref{...} 自动表/图' }];
  var curStyle = styles[0].key;

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box" style="width:720px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;">' +
      '<div class="modal-title" style="margin-bottom:8px">引用' + kindName + '（点击选择）</div>' +
      '<div id="refStyleRow" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;"></div>' +
      '<div style="flex:1;overflow-y:auto;padding:4px 2px;" id="refItemList"></div>' +
      '<div class="modal-btns" style="margin-top:12px"><button class="modal-btn modal-btn-cancel" id="refClose">关闭</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#refClose').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  // ★ 渲染风格选择按钮
  var styleRow = overlay.querySelector('#refStyleRow');
  var paintStyles = function() {
    styleRow.querySelectorAll('button').forEach(function(x) {
      var active = x.dataset.key === curStyle;
      x.style.borderColor = active ? '#6366f1' : '#e5e7eb';
      x.style.color = active ? '#4f46e5' : '#52525b';
      x.style.background = active ? '#eef2ff' : '#fff';
    });
  };
  styles.forEach(function(st) {
    var b = document.createElement('button');
    b.dataset.key = st.key;
    b.textContent = st.label;
    b.style.cssText = 'height:24px;padding:0 10px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;color:#52525b;font-size:11px;cursor:pointer;';
    b.onclick = function() { curStyle = st.key; paintStyles(); };
    styleRow.appendChild(b);
  });
  paintStyles();

  var list = overlay.querySelector('#refItemList');
  items.forEach(function(it) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #f0f0f0;border-radius:6px;margin-bottom:6px;cursor:pointer;';
    var ic = document.createElement('span');
    ic.style.cssText = 'display:inline-flex;color:#71717a;flex-shrink:0;';
    ic.innerHTML = kind === 'cite'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    row.appendChild(ic);
    var name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:12px;color:#3f3f46;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = it.name;
    row.appendChild(name);
    var lbl = document.createElement('span');
    lbl.style.cssText = 'flex:0 0 auto;font-size:10px;color:#a1a1aa;flex-shrink:0;';
    lbl.textContent = it.label;
    row.appendChild(lbl);
    row.onclick = function() {
      var editor = Gongfang._writeState.editor;
      if (editor) {
        var cmd;
        if (kind === 'cite') cmd = '\\cite{' + it.label + '}';
        else if (curStyle === 'cref') cmd = '\\cref{' + kind + ':' + it.label + '}';
        else cmd = '\\ref{' + kind + ':' + it.label + '}';
        editor.getDoc().replaceSelection(cmd);
        editor.focus();
      }
      overlay.remove();
    };
    list.appendChild(row);
  });
};

// ★ 代码引用：列出当前任务所有可引用代码，区分已引用/未引用，无预览，点击以 \\lstinputlisting 调用形式插入
// ★ 代码引用：按类型分组列出当前任务所有代码，区分已引用/未引用；点击以 \lstinputlisting 调用形式插入（附录展示）
Gongfang._writeInsertCodeRef = async function() {
  if (Gongfang._collabBlockedByPreview()) return;
  var project = Gongfang._writeState.activeProject;
  if (!project) { Gongfang._showToast('请先选择项目'); return; }
  // ★ 只显示真实代码类型（不显示 md/txt 等"其他代码"）
  var types = [
    { key: 'py',   name: 'Python（开放代码）',    re: /\.py$/i },
    { key: 'm',    name: 'MATLAB',               re: /\.m$/i },
    { key: 'cpp',  name: 'C / C++',              re: /\.(c|cpp|h|hpp)$/i },
    { key: 'js',   name: 'JavaScript / TS',      re: /\.(js|ts)$/i },
    { key: 'java', name: 'Java',                 re: /\.java$/i },
    { key: 'r',    name: 'R',                    re: /\.r$/i },
    { key: 'sql',  name: 'SQL',                  re: /\.sql$/i }
  ];
  var grouped = {};
  var total = 0;
  try {
    var r = await window.electronAPI.listDirFiles(project.path);
    if (r && r.files) {
      r.files.forEach(function(f) {
        for (var t = 0; t < types.length; t++) {
          if (types[t].re.test(f.name)) {
            if (!grouped[types[t].key]) grouped[types[t].key] = [];
            grouped[types[t].key].push(f);
            total++;
            break;
          }
        }
      });
    }
  } catch(e) {}
  if (!total) { Gongfang._showToast('当前任务下没有可引用的代码文件'); return; }

  // ★ 已引用代码集合（\lstinputlisting{...} 引用的文件名小写）
  var referenced = {};
  try {
    var rr = await window.electronAPI.listDirFiles(project.path);
    var texFiles = (rr && rr.files) ? rr.files.filter(function(f) { return /\.tex$/i.test(f.name); }) : [];
    for (var i = 0; i < texFiles.length && i < 25; i++) {
      var c = await window.electronAPI.readFileContent(texFiles[i].path);
      var text = (c && c.text !== undefined) ? c.text : (typeof c === 'string' ? c : '');
      var re = /\\lstinputlisting\{([^}]+)\}/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var base = m[1].split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
        if (base) referenced[base] = true;
      }
    }
  } catch(e) {}

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box" style="width:720px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;">' +
      '<div class="modal-title" style="margin-bottom:10px">选择要引用的代码（附录展示）</div>' +
      '<div style="flex:1;overflow-y:auto;padding:4px 2px;" id="codeRefList"></div>' +
      '<div class="modal-btns" style="margin-top:12px"><button class="modal-btn modal-btn-cancel" id="codeRefClose">关闭</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#codeRefClose').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var list = overlay.querySelector('#codeRefList');
  // ★ 按类型分组展示
  types.forEach(function(tp) {
    var arr = grouped[tp.key];
    if (!arr || !arr.length) return;
    var head = document.createElement('div');
    head.style.cssText = 'font-size:10px;font-weight:600;color:#a1a1aa;padding:8px 4px 4px;text-transform:uppercase;';
    head.textContent = tp.name;
    list.appendChild(head);
    arr.forEach(function(f) {
      var fileName = f.name;
      var base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
      var isRef = !!referenced[base];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid #f0f0f0;border-radius:6px;margin-bottom:6px;cursor:pointer;';
      var ic = document.createElement('span');
      ic.style.cssText = 'display:inline-flex;color:#71717a;flex-shrink:0;';
      ic.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
      row.appendChild(ic);
      var name = document.createElement('span');
      name.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (isRef ? 'color:#a1a1aa;' : 'color:#3f3f46;font-weight:600;');
      name.textContent = fileName;
      row.appendChild(name);
      if (isRef) {
        var chip = document.createElement('span');
        chip.style.cssText = 'flex:0 0 auto;font-size:9px;color:#059669;background:#d1fae5;border-radius:4px;padding:1px 6px;font-weight:600;flex-shrink:0;';
        chip.textContent = '已引用';
        row.appendChild(chip);
      }
      row.onclick = function() {
        var editor = Gongfang._writeState.editor;
        if (editor) {
          // ★ 用相对路径（相对论文目录，与图片 ../求解/... 一致），避免绝对路径含空格导致 lstinputlisting 找不到文件
          var paperDir = project.path + '/论文';
          var rel = f.path;
          if (rel.indexOf(paperDir) === 0) {
            rel = rel.substring(paperDir.length).replace(/^[\/\\]/, '');
          } else {
            rel = '../' + rel.substring(project.path.length).replace(/^[\/\\]/, '');
          }
          rel = rel.replace(/\\/g, '/');
          // ★ 顶部显示文件名（下划线等特殊字符转义）
          var titleEsc = fileName.replace(/([_%#$&{}])/g, '\\$1');
          // ★ 配色主题：黑白 / 彩色 / 暖色（共享主题表，见 _writeThemeOptsFor）
          var theme = Gongfang._writeState.codeTheme || 'color';
          var themeOpts = Gongfang._writeThemeOptsFor(theme);
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          var lang = { py: 'Python', m: 'Matlab', cpp: 'C++', c: 'C', java: 'Java', r: 'R' }[ext] || '';
          var opts = 'captionpos=t,title={' + titleEsc + '}';
          if (themeOpts) opts += ',' + themeOpts;
          if (lang && theme !== 'mono') opts += ',language=' + lang;
          editor.getDoc().replaceSelection('\\lstinputlisting[' + opts + ']{' + rel + '}');
          editor.focus();
        }
        overlay.remove();
      };
      list.appendChild(row);
    });
  });
};

// ★ 扫描已引用图片：读任务下所有 .tex，收集 \\includegraphics 引用的文件名
Gongfang._writeScanReferencedImages = async function(projectPath) {
  var referenced = {};
  try {
    var r = await window.electronAPI.listDirFiles(projectPath);
    var texFiles = [];
    if (r && r.files) {
      r.files.forEach(function(f) { if (/\.tex$/i.test(f.name)) texFiles.push(f.path); });
    }
    for (var i = 0; i < texFiles.length && i < 25; i++) {
      try {
        var c = await window.electronAPI.readFileContent(texFiles[i]);
        var text = (c && c.text !== undefined) ? c.text : (typeof c === 'string' ? c : '');
        var re = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
        var m;
        while ((m = re.exec(text)) !== null) {
          var base = m[1].split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
          if (base) referenced[base] = true;
        }
      } catch(e) {}
    }
  } catch(e) {}
  return referenced;
};

Gongfang._writePdfDownload = async function() {
  var pdfPath = Gongfang._writePdfState._pdfPath;
  if (!pdfPath) {
    var project = Gongfang._writeState.activeProject;
    if (!project) { Gongfang._showToast('请先编译生成 PDF'); return; }
    pdfPath = project.path + '/论文.pdf';
  }
  try {
    var r = await window.electronAPI.saveFileDialog('论文.pdf');
    if (r && !r.canceled && r.filePath) {
      var res = await window.electronAPI.copyFileToPath(pdfPath, r.filePath);
      if (res && res.success) Gongfang._showToast(res.path ? ('已保存：' + res.path) : 'PDF 已保存');
      else Gongfang._showToast('保存失败' + (res && res.error ? '：' + res.error : ''));
    }
  } catch(e) { Gongfang._showToast('保存失败'); }
};

Gongfang._writePdfRefresh = function() {
  var frame = document.getElementById('writePdfFrame');
  if (frame) {
    frame.src = frame.src; // 强制刷新
    var shell = frame.parentElement;
    if (shell) { shell.classList.add('fv-pdf-loading'); setTimeout(function() { shell.classList.remove('fv-pdf-loading'); }, 500); }
    Gongfang._showToast('已刷新');
  } else {
    Gongfang._showToast('请先编译生成 PDF');
  }
};


// ★ 宽度撑满 ⇔ 高度撑满：点击切换，图标在左右箭头 ↔ 与上下箭头 ↕ 间切换


// ★ 更新撑满模式按钮图标：宽度=左右箭头，高度=上下箭头（按钮已换为全屏展示，此函数保留兜底）
Gongfang._writePdfUpdateFitIcon = function() {
  var ic = document.getElementById('writePdfFitIcon');
  if (!ic) return;
  var isWidth = Gongfang._writePdfState.fitMode === 'width';
  ic.innerHTML = isWidth
    ? '<line x1="3" y1="12" x2="21" y2="12"/><polyline points="14 6 20 12 14 18"/><polyline points="10 6 4 12 10 18"/>'
    : '<line x1="12" y1="3" x2="12" y2="21"/><polyline points="6 14 12 20 18 14"/><polyline points="6 10 12 4 18 10"/>';
  var btn = document.getElementById('writePdfFitBtn');
  if (btn) btn.title = isWidth ? '宽度撑满（点击切换高度撑满）' : '高度撑满（点击切换宽度撑满）';
};

// ★ 全屏展示：弹出独立窗口显示当前 PDF
Gongfang._writePdfFullscreen = function() {
  var pdfPath = Gongfang._writePdfState && Gongfang._writePdfState._pdfPath;
  if (!pdfPath) { Gongfang._showToast('暂无可展示的 PDF'); return; }
  window.electronAPI.writeOpenPdfWindow(pdfPath).then(function(r) {
    if (r && r.success === false) Gongfang._showToast((r.error) || '打开 PDF 失败');
  });
};

// ★ 导出 Word：选保存路径 → 运行 LaTeX→docx 管线，输出到所选路径（不污染工作区）
//   导出进度与报错都会写进「编译输出」卡片，方便定位失败原因
Gongfang._writeExportWord = function() {
  var p = Gongfang._writeState && Gongfang._writeState.activeProject;
  if (!p || !p.path) { Gongfang._showToast('请先选择任务'); return; }

  // ★ 展开编译输出卡片，日志写进去
  var bar = document.getElementById('writeCompileBar');
  if (bar) {
    bar.classList.add('expanded');
    var tog = document.getElementById('writeCompileBarToggle');
    if (tog) tog.style.transform = '';
  }
  var logEl = document.getElementById('writeCompileBarLog');
  if (logEl) logEl.textContent = '';
  Gongfang._writeSetCompileStatus('导出中', 'cmp-running');
  Gongfang._writeAppendLog('开始导出 Word...');

  // ★ 订阅主进程流式导出日志，实时追加到输出区
  if (window.electronAPI && window.electronAPI.onWordExportLog) {
    window.electronAPI.onWordExportLog(function(m) {
      try { Gongfang._writeAppendLog(String(m || '')); } catch(e) {}
    });
  }

  Gongfang._showToast('正在准备导出 Word...');
  window.electronAPI.writeExportWord(p.path).then(function(r) {
    if (r && r.success) {
      Gongfang._writeAppendLog('Word 已导出：' + r.outputPath);
      Gongfang._writeSetCompileStatus('导出完成', 'cmp-ok');
      Gongfang._showToast('Word 已导出：' + r.outputPath);
    } else {
      var err = (r && r.error) || '导出失败';
      Gongfang._writeAppendLog('导出失败：' + err);
      Gongfang._writeSetCompileStatus('导出失败', 'cmp-err');
      Gongfang._showToast('导出失败');
    }
  }).catch(function(e) {
    Gongfang._writeAppendLog('导出异常：' + (e && e.message || e));
    Gongfang._writeSetCompileStatus('导出失败', 'cmp-err');
    Gongfang._showToast('导出失败');
  });
};

// ★ 判断是否为当前论文 PDF（预览只认「论文.pdf」）
Gongfang._isPaperPdf = function(path) {
  var nm = String(path || '').split(/[\\/]/).pop() || '';
  return nm === '论文.pdf';
};

// ★ 渲染单页
Gongfang._writePdfRenderSingle = function(pdfPath) {
  var pane = document.getElementById('writePreviewPane');
  if (!pane) return;
  var render = function() {
    var encPath = encodeURI('file:///' + pdfPath.replace(/\\/g, '/'));
    // ★ FitH=撑满宽度，FitV=撑满高度（高度模式不再用 Fit 整页）
    var viewMode = Gongfang._writePdfState.fitMode === 'width' ? 'FitH' : 'FitV';
    var p = Gongfang._writePdfState._page || 1;
    var z = Gongfang._writePdfState._zoom || 100;
    pane.innerHTML =
      '<div class="fv-pdf-wrap">' +
        '<div class="fv-pdf-shell">' +
          '<iframe id="writePdfFrame" src="' + encPath + '#page=' + p + '&toolbar=0&navpanes=0&view=' + viewMode + '&zoom=' + z + '" class="fv-pdf"></iframe>' +
        '</div>' +
      '</div>';
    Gongfang._writePdfUpdateUI();
  };
  // ★ PDF 完整性校验：损坏/编译中断的 PDF 不渲染 iframe（避免 Chromium 引擎报错页），显示空白
  if (window.electronAPI && window.electronAPI.checkPdfValid) {
    window.electronAPI.checkPdfValid(pdfPath).then(function(ok) {
      if (ok) { render(); return; }
      pane.innerHTML = '<div class="fv-pdf-wrap"><div class="fv-pdf-shell fv-pdf-blank"></div></div>';
    }).catch(function() { render(); });  // 校验异常时保守渲染（能开就开）
  } else {
    render();
  }
};

// ★ 翻页


// ★ 缩放


// ★ 更新控制栏 UI
Gongfang._writePdfUpdateUI = function() {
  var st = Gongfang._writePdfState;
  var prevBtn = document.getElementById('pdfPrevBtn');
  var nextBtn = document.getElementById('pdfNextBtn');
  var pageInfo = document.getElementById('pdfPageInfo');
  var zoomOutBtn = document.getElementById('pdfZoomOutBtn');
  var zoomInBtn = document.getElementById('pdfZoomInBtn');
  var zoomInfo = document.getElementById('pdfZoomInfo');
  var hasPdf = !!st._pdfPath;
  if (prevBtn) prevBtn.disabled = !hasPdf || st._page <= 1;
  if (nextBtn) nextBtn.disabled = !hasPdf;
  if (pageInfo) pageInfo.textContent = hasPdf ? st._page : '—';
  if (zoomOutBtn) zoomOutBtn.disabled = !hasPdf || st._zoom <= 25;
  if (zoomInBtn) zoomInBtn.disabled = !hasPdf || st._zoom >= 400;
  if (zoomInfo) zoomInfo.textContent = (st._zoom || 100) + '%';
  Gongfang._writePdfUpdateFitIcon();
};

// ★ 渲染双栏瀑布流（左1右2、左3右4…从上到下连续滚动）


// ═══════════════════════ 辅助 ═══════════════════════
function escHtml(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
// ★ 自然排序：数字按数值比较（1,2,...9,10），避免 10 插到 2 前面
function naturalCompare(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

// ★ LaTeX 文本转义：文件名含 _ % # & $ 等特殊字符时，图片默认标题不会导致 Missing $ inserted
function latexEscape(s) {
  return String(s).replace(/([_%#$&{}])/g, '\\$1');
}

// ── 扩展注册（v2.6 改造追加）──
// 原 write.js 内容保持不变；以下把自身注册为基座扩展。
// 本扩展同时承担"写作编辑器"和"工坊宿主"（_writeSwitchMode 等）双重职责。
// 基座通过 file:// 协议注入本 main.js 后：
//   - window.Gongfang._writeInit / _writeSwitchMode / _writeToggleSidebar 等照常可用
//   - 写作扩展的 activate 钩子调用 _writeInit 初始化编辑器
(function() {
  window.GongfangExtension = window.GongfangExtension || {};
  window.GongfangExtension.write = {
    id: 'write',
    activate: function(api, hostEl) {
      if (typeof Gongfang._writeInit === 'function') Gongfang._writeInit();
    },
    deactivate: function() {
      // 工坊宿主逻辑不在此停用；写作编辑器自身无运行态需清理
    }
  };
  try { console.log('[ext] write 已注册'); } catch (e) {}
})();
