// 一站式数模工坊 — 设置面板（仅主题/环境配置）
window.Gongfang = window.Gongfang || {};

// ★ 导航切换 — 公共函数，供 HTML 内联 onclick 调用
Gongfang._navToSection = function(el, section) {
  // 更新导航 active
  var nav = el.parentElement;
  if (nav) {
    nav.querySelectorAll('.set-nav-item').forEach(function(i) { i.classList.remove('active'); });
  }
  el.classList.add('active');
  // 更新内容区 active
  var content = document.getElementById('settingsContent');
  if (content) {
    content.querySelectorAll('.set-section-panel').forEach(function(p) { p.classList.remove('active'); });
    var target = content.querySelector('[data-section="' + section + '"]');
    if (target) target.classList.add('active');
  }
};

// ★ 所有按钮事件均使用 HTML 内联 onclick

// ★ 自动保存：仅读取 DOM 中存在的字段，避免面板关闭时误清空
Gongfang._autoSaveSettings = async function() {
  var st = Gongfang.STATE.settings;
  var el;
  // 环境配置（其余字段的输入框已随对应面板下线）
  el = document.querySelector('#envLatexSelect'); if (el) st.latexEnvMode = el.value || 'builtin';
  el = document.querySelector('#envLatexPath'); if (el) st.latexEnvPath = (el.value.trim() === '内置 TinyTeX') ? '' : el.value.trim();
  el = document.querySelector('#envPythonSelect'); if (el) st.pythonEnvMode = el.value || 'builtin';
  el = document.querySelector('#envPythonPath'); if (el) st.pythonEnvPath = (el.value.trim() === '内置 Python') ? '' : el.value.trim();
  Gongfang.saveSettings();
};

// ★ 环境引擎模式切换（builtin / system）
Gongfang._envLatexMode = function(mode, silent) {
  Gongfang.STATE.settings.latexEnvMode = mode;
  if (Gongfang.saveSettings) Gongfang.saveSettings();
  var list = document.getElementById('envLatexEnvList');
  if (list) list.style.display = 'none';
  if (!silent && Gongfang._renderEnvConfig) Gongfang._renderEnvConfig();
};
Gongfang._envPythonMode = function(mode, silent) {
  Gongfang.STATE.settings.pythonEnvMode = mode;
  if (Gongfang.saveSettings) Gongfang.saveSettings();
  var list = document.getElementById('envPythonEnvList');
  if (list) list.style.display = 'none';
  if (!silent && Gongfang._renderEnvConfig) Gongfang._renderEnvConfig();
};

// ── 环境配置：内置环境（第一条固定）+ 系统检测/手动路径 + 查看安装库 ──
Gongfang._renderEnvConfig = function() {
  var st = Gongfang.STATE && Gongfang.STATE.settings;
  // 回填保存的模式
  if (st) {
    Gongfang._envLatexMode(st.latexEnvMode === 'system' ? 'system' : 'builtin', true);
    Gongfang._envPythonMode(st.pythonEnvMode === 'system' ? 'system' : 'builtin', true);
    var lp = document.getElementById('envLatexPath'); if (lp && st.latexEnvPath) lp.value = st.latexEnvPath;
    var pp = document.getElementById('envPythonPath'); if (pp && st.pythonEnvPath) pp.value = st.pythonEnvPath;
  }
  // ★ 卡片状态：绿字=就绪/已检索到路径，黄字=未安装/未指定
  var escS = function(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; };
  var shortPath = function(p) { p = String(p||''); return p.length > 38 ? p.slice(0,35)+'…' : p; };
  function updateLatexStatus() {
    var el = document.getElementById('envLatexCardStatus');
    if (!el) return;
    // ★ 单独配置卡片只显示「系统路径」状态：集成环境/内置已由上面那张「集成环境」卡片托管，
    //   不再在此重复查询 latexGetStatus（避免与集成环境卡片重复显示状态）。
    var pathEl = document.getElementById('envLatexPath');
    var path = (pathEl && pathEl.value) || (Gongfang.STATE.settings.latexEnvPath) || '';
    el.innerHTML = path
      ? '<span class="env-status-ok">已检索到系统路径</span> · <span style="color:var(--color-zinc-600)">' + escS(shortPath(path)) + '</span>'
      : '<span class="env-status-warn">未指定系统路径</span> · 集成环境已托管，可点「检测」查找系统 LaTeX';
  }
  function updatePythonStatus() {
    var el = document.getElementById('envPythonCardStatus');
    if (!el) return;
    // ★ 单独配置卡片只显示「系统路径」状态：集成环境/内置已由上面那张「集成环境」卡片托管，
    //   不再在此重复查询 pythonGetStatus（避免与集成环境卡片重复显示状态）。
    var pathEl = document.getElementById('envPythonPath');
    var path = (pathEl && pathEl.value) || (Gongfang.STATE.settings.pythonEnvPath) || '';
    el.innerHTML = path
      ? '<span class="env-status-ok">已检索到系统路径</span> · <span style="color:var(--color-zinc-600)">' + escS(shortPath(path)) + '</span>'
      : '<span class="env-status-warn">未指定系统路径</span> · 集成环境已托管，可点「检测」查找系统 Python';
  }
  updateLatexStatus();
  updatePythonStatus();
  // 集成环境卡片：对接状态 + 指定目录
  if (typeof Gongfang._renderIntegrationEnv === 'function') Gongfang._renderIntegrationEnv();
};
// ★ 环境引擎下拉：内置=金色，系统=绿色序号；点击选中后调 pickFn/pickIdxFn
var _envScanAndRender = function(listId, detectFn, kind, pickFn, pickIdxFn) {
  var list = document.getElementById(listId);
  if (!list) return;
  var short = function(p) { p = String(p || ''); return p.length > 38 ? p.slice(0, 35) + '…' : p; };
  Gongfang._envDetectedPaths = Gongfang._envDetectedPaths || {};
  list.style.display = '';
  var render = function(paths, empty) {
    var html = '';
    // ★ 单独配置卡片不再列出「内置」选项——内置环境已迁移到「集成环境」卡片托管，
    //   此处只检测系统 LaTeX/Python，避免与集成环境卡片重复。
    if (empty || !paths || !paths.length) {
      html += '<div class="env-detect-empty">未检测到系统' + (kind === 'latex' ? ' LaTeX' : ' Python') + ' 环境，可手动粘贴路径到上方输入框</div>';
    } else {
      // 系统环境（绿色序号圆点），按检测顺序存到 _envDetectedPaths 供 pickIdx 取用
      Gongfang._envDetectedPaths[kind] = paths;
      html += paths.map(function(p, i) {
        return '<div class="env-env-opt" onclick="' + pickIdxFn + '(' + i + ')">' +
          '<span class="env-ic-num">' + (i + 1) + '</span>' +
          '<span class="env-env-name">' + Gongfang.escHtml(short(p)) + '</span>' +
          '<span class="env-env-tag tag-system">系统</span>' +
        '</div>';
      }).join('');
    }
    list.innerHTML = html;
  };
  if (window.electronAPI && detectFn) {
    detectFn().then(function(r) { render(r && r.success ? (r.paths || [r.path]) : [], !r || !r.success); }).catch(function() { render([], true); });
  } else { render([], false); }
}
Gongfang._envLatexScan = function() {
  _envScanAndRender('envLatexEnvList', window.electronAPI && window.electronAPI.latexDetectSystem ? function(){ return window.electronAPI.latexDetectSystem(); } : null, 'latex', 'Gongfang._envLatexPick', 'Gongfang._envLatexPickIdx');
};
Gongfang._envPythonScan = function() {
  _envScanAndRender('envPythonEnvList', window.electronAPI && window.electronAPI.pythonDetectSystem ? function(){ return window.electronAPI.pythonDetectSystem(); } : null, 'python', 'Gongfang._envPythonPick', 'Gongfang._envPythonPickIdx');
};
Gongfang._envLatexPickIdx = function(idx) {
  var p = Gongfang._envDetectedPaths.latex[idx];
  if (p != null) Gongfang._envLatexPick(p);
};
Gongfang._envPythonPickIdx = function(idx) {
  var p = Gongfang._envDetectedPaths.python[idx];
  if (p != null) Gongfang._envPythonPick(p);
};
Gongfang._envLatexPick = function(value) {
  if (value !== 'builtin') {
    var el = document.getElementById('envLatexPath');
    if (el) el.value = value;
    Gongfang.STATE.settings.latexEnvPath = value;
    Gongfang._envLatexMode('system');
  } else { Gongfang._envLatexMode('builtin'); }
  var list = document.getElementById('envLatexEnvList');
  if (list) list.style.display = 'none';
  if (Gongfang._renderEnvConfig) Gongfang._renderEnvConfig();
};
Gongfang._envPythonPick = function(value) {
  if (value !== 'builtin') {
    var el = document.getElementById('envPythonPath');
    if (el) el.value = value;
    Gongfang.STATE.settings.pythonEnvPath = value;
    Gongfang._envPythonMode('system');
  } else { Gongfang._envPythonMode('builtin'); }
  var list = document.getElementById('envPythonEnvList');
  if (list) list.style.display = 'none';
  if (Gongfang._renderEnvConfig) Gongfang._renderEnvConfig();
};
// ★ 环境卡片（写作/求解）大标题栏展开/收起
Gongfang._envToggleCard = function(headEl) {
  var card = headEl && headEl.closest ? headEl.closest('.env-card') : null;
  if (!card) return;
  card.classList.toggle('collapsed');
  var chev = card.querySelector('.env-card-chevron');
  if (chev) chev.classList.toggle('collapsed', card.classList.contains('collapsed'));
};

// ═══════════════ 集成环境：环境配置里的一张卡片（对接状态 + 指定目录） ═══════════════
Gongfang._renderIntegrationEnv = function() {
  var statusEl = document.getElementById('envIntegCardStatus');
  var infoEl = document.getElementById('envIntegInfo');
  var escS = function(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; };
  var short = function(p) { p = String(p||''); return p.length > 56 ? p.slice(0,53)+'…' : p; };
  var fmtTime = function(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('zh-CN'); } catch(e) { return String(iso||''); }
  };
  if (statusEl) statusEl.innerHTML = '<span class="env-status-warn">检测中...</span>';
  if (infoEl) infoEl.innerHTML = '检测中...';

  if (!window.electronAPI || !window.electronAPI.checkEnvironment) {
    if (statusEl) statusEl.innerHTML = '<span class="env-status-warn">检测不可用</span>';
    return;
  }
  window.electronAPI.checkEnvironment().then(function(r) {
    var ae = (r && r.appEnv) || {};
    var root = ae.root || '';
    var found = !!ae.found;
    var cfg = ae.configured || '';   // 用户手动指定的目录（''=未指定，走自动检测）
    var srcLabel = cfg ? '（手动指定）' : '（自动检测）';
    var py = ae.python || {};
    var lx = ae.latex || {};

    var cfgInput = document.getElementById('integAppEnvPath');
    if (cfgInput) cfgInput.value = cfg || '';

    if (statusEl) {
      statusEl.innerHTML = !found
        ? '<span class="env-status-warn">未找到集成环境目录</span>'
        : ((py.ready || lx.installed)
            ? '<span class="env-status-ok">已连接 · ' + srcLabel + '</span>'
            : '<span class="env-status-warn">已检测到目录，环境未就绪</span>');
    }
    if (infoEl) {
      if (!found) {
        // ★ 未找到：橙色警示卡（图标 + 标题 + 说明）
        infoEl.innerHTML =
          '<div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px">' +
            '<div style="width:34px;height:34px;border-radius:50%;background:#fbbf24;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 10px rgba(251,191,36,.3)">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
            '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:700;color:#9a3412;line-height:1.4">未找到集成环境目录</div>' +
              '<div style="font-size:11px;color:#7c2d12;line-height:1.7;margin-top:4px">软件会在软件同级/上级、各磁盘根、桌面/文档/下载等位置自动查找；也可在下方「指定目录」手动选择一次。</div>' +
            '</div>' +
          '</div>';
      } else {
        // ★ 已找到：绿色 hero 卡 + Python/LaTeX 状态网格 + 启动对接时间
        var allReady = !!(py.ready || lx.installed);
        var heroBg = allReady ? 'linear-gradient(135deg,#f0fdf4 0%,#ecfeff 100%)' : 'linear-gradient(135deg,#fffbeb 0%,#fff7ed 100%)';
        var heroBorder = allReady ? '#bbf7d0' : '#fed7aa';
        var heroIconBg = allReady ? '#10b981' : '#f59e0b';
        var heroIconShadow = allReady ? 'rgba(16,185,129,.3)' : 'rgba(245,158,11,.3)';
        var heroTitleColor = allReady ? '#065f46' : '#9a3412';
        var heroSubColor = allReady ? '#047857' : '#7c2d12';
        var heroTitle = allReady ? '集成环境已连接' : '已检测到目录，环境未就绪';
        var heroIcon = allReady
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

        // Python 单元格
        var pyCell = (function() {
          var ok = !!py.ready;
          var dot = '#3776AB';
          var statusBg = ok ? '#f0fdf4' : '#fef2f2';
          var statusBorder = ok ? '#bbf7d0' : '#fecaca';
          var statusColor = ok ? '#065f46' : '#991b1b';
          var statusText = ok ? ('已就绪' + (py.version ? ' · Python ' + escS(py.version) : '')) : '未就绪';
          var pathLine = py.pythonPath
            ? '<div style="font-size:10px;color:#6b7280;font-family:Consolas,monospace;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escS(py.pythonPath) + '">' + escS(py.pythonPath) + '</div>'
            : '';
          return '<div style="padding:10px 12px;background:' + statusBg + ';border:1px solid ' + statusBorder + ';border-radius:8px;min-width:0;overflow:hidden">' +
                   '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#374151;margin-bottom:4px">' +
                     '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + '"></span>Python' +
                   '</div>' +
                   '<div style="font-size:12px;color:' + statusColor + ';font-weight:600">' + statusText + '</div>' +
                   pathLine +
                 '</div>';
        })();
        // LaTeX 单元格
        var lxCell = (function() {
          var ok = !!lx.installed;
          var dot = '#0080ff';
          var statusBg = ok ? '#f0fdf4' : '#fef2f2';
          var statusBorder = ok ? '#bbf7d0' : '#fecaca';
          var statusColor = ok ? '#065f46' : '#991b1b';
          var statusText = ok ? ('已就绪' + (lx.version ? ' · TeX Live ' + escS(lx.version) : '')) : '未就绪';
          var pathLine = lx.xelatexPath
            ? '<div style="font-size:10px;color:#6b7280;font-family:Consolas,monospace;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escS(lx.xelatexPath) + '">' + escS(lx.xelatexPath) + '</div>'
            : '';
          return '<div style="padding:10px 12px;background:' + statusBg + ';border:1px solid ' + statusBorder + ';border-radius:8px;min-width:0;overflow:hidden">' +
                   '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#374151;margin-bottom:4px">' +
                     '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + '"></span>LaTeX' +
                   '</div>' +
                   '<div style="font-size:12px;color:' + statusColor + ';font-weight:600">' + statusText + '</div>' +
                   pathLine +
                 '</div>';
        })();
        // 启动对接时间
        var timeLine = ae.detectedAt
          ? '<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:8px 12px;background:#f9fafb;border-radius:8px;font-size:11px;color:#6b7280">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
              '<span>启动对接：' + escS(fmtTime(ae.detectedAt)) + '</span>' +
            '</div>'
          : '';

        infoEl.innerHTML =
          '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:' + heroBg + ';border:1px solid ' + heroBorder + ';border-radius:10px">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:' + heroIconBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 10px ' + heroIconShadow + '">' + heroIcon + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:700;color:' + heroTitleColor + ';line-height:1.4">' + heroTitle + ' · ' + escS(srcLabel) + '</div>' +
              '<div style="font-size:11px;color:' + heroSubColor + ';font-family:Consolas,monospace;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escS(root) + '">' + escS(short(root)) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;min-width:0">' + pyCell + lxCell + '</div>' +
          timeLine;
      }
    }
  }).catch(function() {
    if (statusEl) statusEl.innerHTML = '<span class="env-status-warn">检测失败</span>';
    if (infoEl) infoEl.innerHTML = '检测失败，请稍后重试';
  });
};


// ★ 集成环境：浏览选择手动指定目录（存数据库；之后每次启动优先使用，重装/换位置后仍生效）
Gongfang._integBrowseAppEnv = function() {
  if (!window.electronAPI || !window.electronAPI.openFolderDialog) return;
  window.electronAPI.openFolderDialog({}).then(function(paths) {
    var p = (paths && paths.length) ? paths[0] : '';
    if (!p) return;
    if (window.electronAPI.dbSaveSettings) {
      window.electronAPI.dbSaveSettings({ appEnvPath: p }).then(function() {
        Gongfang._showToast('已指定集成环境目录');
        if (Gongfang._renderIntegrationEnv) Gongfang._renderIntegrationEnv();
      });
    }
  });
};

// ★ 集成环境：清除手动指定，恢复自动检测
Gongfang._integClearAppEnv = function() {
  if (!window.electronAPI || !window.electronAPI.dbSaveSettings) return;
  window.electronAPI.dbSaveSettings({ appEnvPath: '' }).then(function() {
    Gongfang._showToast('已清除指定目录，恢复自动检测');
    if (Gongfang._renderIntegrationEnv) Gongfang._renderIntegrationEnv();
  });
};

// ═══════════ 主题配置 ═══════════
Gongfang._THEMES = [
  { id: 'classic', name: '经典黑白', desc: '经典的黑白灰配色（原版）', colors: ['#18181b', '#52525b', '#d4d4d8'] },
  { id: 'default', name: '经典蓝', desc: '清爽经典的蓝色主题', colors: ['#3b82f6', '#2563eb', '#1d4ed8'] },
  { id: 'emerald', name: '翡翠绿', desc: '沉稳自然的绿色主题', colors: ['#10b981', '#059669', '#047857'] },
  { id: 'violet', name: '紫罗兰', desc: '优雅神秘的紫色主题', colors: ['#8b5cf6', '#7c3aed', '#6d28d9'] },
  { id: 'amber', name: '落日橙', desc: '温暖活力的橙色主题', colors: ['#f59e0b', '#d97706', '#b45309'] },
  { id: 'rose', name: '樱花粉', desc: '柔和甜美的粉色主题', colors: ['#f43f5e', '#e11d48', '#be123c'] },
  { id: 'teal', name: '深海青', desc: '冷静通透的青蓝主题', colors: ['#06b6d4', '#0891b2', '#0e7490'] },
  { id: 'sky', name: '天青蓝', desc: '明亮清爽的天蓝主题', colors: ['#0ea5e9', '#0284c7', '#0369a1'] },
  { id: 'lime', name: '青柠绿', desc: '活力清新的黄绿主题', colors: ['#84cc16', '#65a30d', '#4d7c0f'] },
  { id: 'cyan', name: '湖蓝青', desc: '通透的湖蓝主题', colors: ['#06b6d4', '#0891b2', '#0e7490'] },
  { id: 'fuchsia', name: '桃紫粉', desc: '明艳的桃紫主题', colors: ['#d946ef', '#c026d3', '#a21caf'] },
  { id: 'slate', name: '石板灰', desc: '冷静沉稳的灰蓝主题', colors: ['#64748b', '#475569', '#334155'] }
];

// ★ 应用主题：设置 html[data-theme]，整体切换 accent 与底色；自动保存
Gongfang._applyTheme = function(themeId) {
  var id = 'default';
  for (var i = 0; i < Gongfang._THEMES.length; i++) {
    if (Gongfang._THEMES[i].id === themeId) { id = themeId; break; }
  }
  var prev = document.documentElement.getAttribute('data-theme');
  if (prev !== id) {
    document.documentElement.setAttribute('data-theme', id);
    try {
      if (Gongfang.STATE && Gongfang.STATE.settings) {
        Gongfang.STATE.settings.theme = id;
        if (Gongfang.saveSettings) Gongfang.saveSettings();
      }
    } catch(_) {}
  }
  // ★ 让右上角原生窗口按钮底色跟随主题变色
  if (typeof Gongfang._syncTitleBarOverlay === 'function') Gongfang._syncTitleBarOverlay();
  // 重新渲染主题列表：勾选/高亮移到当前主题
  if (typeof Gongfang._renderThemeConfig === 'function') Gongfang._renderThemeConfig();
};

// ★ 渲染主题选择面板
Gongfang._renderThemeConfig = function() {
  var list = document.getElementById('themeList');
  if (list) {
    var current = (Gongfang.STATE.settings && Gongfang.STATE.settings.theme) || 'default';
    var html = '';
    for (var i = 0; i < Gongfang._THEMES.length; i++) {
      var t = Gongfang._THEMES[i];
      var swatches = '';
      for (var j = 0; j < t.colors.length; j++) swatches += '<span class="theme-swatch" style="background:' + t.colors[j] + '"></span>';
      html += '<div class="theme-card' + (t.id === current ? ' active' : '') + '" data-theme="' + t.id + '" onclick="Gongfang._applyTheme(\'' + t.id + '\')">' +
        '<div class="theme-swatches">' + swatches + '</div>' +
        '<div class="theme-info">' +
          '<div class="theme-name">' + t.name + '</div>' +
          '<div class="theme-desc">' + t.desc + '</div>' +
        '</div>' +
        (t.id === current ? '<span class="theme-check">✓</span>' : '') +
      '</div>';
    }
    list.innerHTML = html;
  }
};

// ★ 已删除应用相关/扩展管理/更新函数：对应面板已下线
