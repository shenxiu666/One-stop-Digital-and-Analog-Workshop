// 一站式数模工坊 — 导航 + 扩展系统
window.Gongfang = window.Gongfang || {};

// ★ 直接切换导航高亮
Gongfang._navTo = function(btn) {
  // 先移除所有按钮的 active
  document.querySelectorAll('.app-nav-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  // 给当前按钮加 active
  btn.classList.add('active');
  // 根据按钮 ID 确定面板名（仅工坊三面板）
  var panelMap = { btnWrite: 'write', btnExt: 'ext', btnSettings: 'settings' };
  var panelName = panelMap[btn.id] || 'write';
  window._openPanel(panelName);
};

// ═══════════ 扩展系统（v2.6 改造）═══════════
// 数据源：window.electronAPI.extensionList() IPC 拉取（基座 services/extension.js 扫描）
// 占位卡片（"开发中"）：本地硬编码 _placeholderRegistry，无 main.js 的功能预告
// 状态机简化：真扩展只有 enabled/disabled；占位卡片恒 disabled
(function() {
var SVG_S = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// ── 占位卡片（仅"开发中"功能预告，无真实扩展实现）──
Gongfang._placeholderRegistry = [
  { id: 'review', name: '评审', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><polyline points="9 14 11 16 15 12"/></svg>', desc: '对论文、代码、方案进行多维度智能评审，输出结构化评审报告，涵盖逻辑性、创新性、规范性等维度。', tags: '评审 审核 review' },
  { id: 'research', name: '研讨', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>', desc: '多人在线研讨模式，支持实时对话、头脑风暴、观点碰撞，AI 充当主持人引导讨论方向。', tags: '研讨 讨论 会议' },
  { id: 'paper', name: '科研写作', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>', desc: '科研论文写作辅助', tags: '论文 学术' },
  { id: 'copyright', name: '软著写作', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>', desc: '软件著作权申请材料', tags: '软著 版权' },
  { id: 'patent', name: '专利写作', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/></svg>', desc: '专利申请文书辅助', tags: '专利 发明' },
  { id: 'literature', name: '文献综述', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', desc: '文献调研与综述生成', tags: '文献 综述' },
  { id: 'polish', name: '摘要润色', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.4l-1.9-5.8L4 10.7l6.1-1.9z"/></svg>', desc: '摘要 / 结论润色改写', tags: '摘要 润色' },
  { id: 'reference', name: '参考文献', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="13" y2="18"/></svg>', desc: 'GB/T 7714 格式化', tags: '引用 参考文献' },
  { id: 'report', name: '数据报告', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><line x1="6" y1="20" x2="6" y2="16"/><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/></svg>', desc: '数据可视化分析报告', tags: '数据 图表' },
  { id: 'experiment', name: '实验设计', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>', desc: '实验方案与步骤设计', tags: '实验 方案' },
  { id: 'closing', name: '结题报告', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>', desc: '项目结题报告生成', tags: '结题 报告' },
  { id: 'business', name: '商业计划书', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>', desc: 'BP 大纲与内容生成', tags: '商业 计划书' },
  { id: 'courseware', name: '教学课件', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>', desc: '课件大纲与内容生成', tags: '课件 教学' },
  { id: 'codecomment', name: '代码注释', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>', desc: '代码注释与文档生成', tags: '代码 注释' }
].map(function(p) { p.type = 'placeholder'; p._placeholder = true; return p; });

// ── 真扩展列表（IPC 拉取）──
Gongfang._extensions = [];
Gongfang._extLoading = false;

Gongfang._loadExtensions = async function() {
  if (Gongfang._extLoading) { console.log('[ext] _loadExtensions 跳过（_extLoading=true）'); return; }
  Gongfang._extLoading = true;
  try {
    console.log('[ext] 开始拉取 extensionList...');
    var r = await window.electronAPI.extensionList();
    console.log('[ext] extensionList 返回:', r && r.success, '数量=', (r && r.extensions) ? r.extensions.length : 0);
    if (r && r.success && Array.isArray(r.extensions)) {
      Gongfang._extensions = r.extensions;
      // 注入已启用扩展的 main.js 脚本（按顺序加载，每个加载完才加载下一个）
      var enabled = r.extensions.filter(function(e) { return e.enabled; });
      console.log('[ext] 已启用:', enabled.map(function(e){return e.id;}).join(','));
      for (var i = 0; i < enabled.length; i++) {
        await Gongfang._injectExtensionScript(enabled[i]);
      }
      // ★ v2.6：write 宿主已静态加载（index.html），无需诊断 _writeSwitchMode 就绪状态
      Gongfang._restorePluginBtns();
    }
  } catch (e) {
    console.error('[ext] 拉取扩展列表失败:', e);
  } finally {
    Gongfang._extLoading = false;
  }
  Gongfang._renderExtensions();
};

// ★ 注入扩展 main.js（通过 IPC readFileContent 读取文本后注入 script.textContent，
//   绕过 file:// src 在 Electron 中可能被安全策略阻止的问题）
Gongfang._injectExtensionScript = function(ext) {
  return new Promise(function(resolve) {
    if (!ext || !ext.mainPath) return resolve();
    // ★ v2.6：host 扩展（write）已在 index.html 静态加载，不走扩展注入
    if (ext.host === true) { resolve(); return; }
    // 已加载过的不重复注入
    if (Gongfang._injectedExt && Gongfang._injectedExt[ext.id]) return resolve();
    Gongfang._injectedExt = Gongfang._injectedExt || {};
    Gongfang._injectedExt[ext.id] = true;
    if (!window.electronAPI || !window.electronAPI.readFileContent) {
      console.error('[ext] readFileContent API 不存在，无法注入', ext.id);
      delete Gongfang._injectedExt[ext.id]; resolve(); return;
    }
    window.electronAPI.readFileContent(ext.mainPath).then(function(r) {
      var code = r && r.success ? r.text : null;
      if (!code) {
        console.error('[ext] 读取失败或内容为空:', ext.id, r && r.error);
        delete Gongfang._injectedExt[ext.id]; resolve(); return;
      }
      var s = document.createElement('script');
      s.textContent = code;
      document.head.appendChild(s);
      console.log('[ext] 加载成功:', ext.id);
      resolve();
    }).catch(function(err) {
      console.error('[ext] 加载失败:', ext.id, err);
      delete Gongfang._injectedExt[ext.id];
      resolve();
    });
  });
};

// ── 合并渲染：真扩展 + 占位卡片 ──
// ★ v2.6：host 扩展（写作）不在扩展中心显示，但仍作为宿主加载
Gongfang._getAllExtCards = function() {
  var real = (Gongfang._extensions || []).filter(function(e) { return e.host !== true; }).map(function(e) {
    // 卡片图标：优先 manifest button.icon（SVG inner HTML），其次 icon 文件，否则方框
    var btnIcon = (e.button && e.button.icon) ? e.button.icon : '<rect x="3" y="3" width="18" height="18" rx="2"/>';
    var iconSvg = e.icon ? '<img src="file://' + e.icon + '" style="width:22px;height:22px;" />'
      : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' + SVG_S + '>' + btnIcon + '</svg>';
    return {
      id: e.id, name: e.name, type: e.type, enabled: e.enabled,
      icon: iconSvg,
      desc: e.description || '',
      tags: (e.name + ' ' + (e.description || '') + ' ' + (e.author || '')),
      version: e.version, author: e.author, _real: true
    };
  });
  var ph = (Gongfang._placeholderRegistry || []).slice();
  return real.concat(ph);
};

Gongfang._renderExtCards = function(mods) {
  var list = document.getElementById('extList'); if (!list) return;
  var html = '';
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    var bc, bt, draggable;
    if (m._real) {
      bc = m.enabled ? 'badge-installed' : 'badge-new';
      bt = m.enabled ? '已启用' : (m.type === 'builtin' ? '内置' : '可启用');
      draggable = !m.enabled ? ' draggable="true" ondragstart="Gongfang._extDragStart(event,\'' + m.id + '\')"' : '';
    } else {
      bc = 'badge-dev'; bt = '开发中'; draggable = '';
    }
    html += '<div class="ext-card"' + draggable + ' onclick="Gongfang._extModalShow(\'' + m.id + '\')">' +
      '<span class="ext-card-icon">' + m.icon + '</span>' +
      '<div class="ext-card-info"><div class="ext-card-name">' + m.name + '</div><div class="ext-card-desc">' + (m.desc || '').substring(0, 20) + '…</div></div>' +
      '<span class="ext-card-badge ' + bc + '">' + bt + '</span></div>';
  }
  list.innerHTML = html || '<div class="ext-empty">未找到匹配的扩展模块</div>';
  Gongfang._renderPreviewBar();
};

Gongfang._renderExtensions = function() { Gongfang._renderExtCards(Gongfang._getAllExtCards()); };

Gongfang._extSearch = function(q) {
  var kw = String(q || '').trim().toLowerCase();
  if (!kw) { Gongfang._renderExtCards(Gongfang._getAllExtCards()); return; }
  Gongfang._renderExtCards(Gongfang._getAllExtCards().filter(function(m) {
    return (m.name + ' ' + (m.desc || '') + ' ' + (m.tags || '')).toLowerCase().indexOf(kw) >= 0;
  }));
};

// ★ 工坊预览条（= 工坊工具栏一模一样：.write-mode-btn 样式，写作固定最前，可拖动排序）
Gongfang._renderPreviewBar = function() {
  var box = document.getElementById('extPreviewItems'); if (!box) return;
  var host = (Gongfang._extensions || []).find(function(e) { return e.host === true; });
  var enabled = (Gongfang._extensions || []).filter(function(e) { return e.enabled && e.host !== true; });
  var order = JSON.parse(localStorage.getItem('gongfang_plugin_order') || '[]');
  if (order.length) {
    enabled.sort(function(a, b) {
      var ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  }
  function svg(icon) {
    var inner = icon || '<rect x="3" y="3" width="18" height="18" rx="2"/>';
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var html = '';
  // 写作固定按钮（宿主，不可拖动/移除）
  if (host) {
    html += '<button class="write-mode-btn ext-preview-btn ext-preview-fixed" data-plugin-id="' + host.id + '" draggable="false">' +
      svg((host.button && host.button.icon) ? host.button.icon : '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>') +
      ' ' + host.name + '</button>';
  }
  // 其他扩展按钮（可拖动排序）
  enabled.forEach(function(p) {
    html += '<button class="write-mode-btn ext-preview-btn" draggable="true" data-plugin-id="' + p.id + '"' +
      ' ondragstart="Gongfang._previewDragStart(event,\'' + p.id + '\')"' +
      ' ondragover="Gongfang._previewDragOver(event)" ondragleave="Gongfang._previewDragLeave(event)"' +
      ' ondrop="Gongfang._previewDrop(event,\'' + p.id + '\')">' +
      svg((p.button && p.button.icon) ? p.button.icon : null) + ' ' + p.name +
      '<span class="ext-preview-remove" onclick="event.stopPropagation();Gongfang._extDisable(\'' + p.id + '\')" title="禁用">✕</span>' +
      '</button>';
  });
  box.innerHTML = html || '<span class="ext-preview-empty">暂无扩展，从下方拖入或点击启用</span>';
  // 容器接收从卡片拖入启用
  box.ondragover = function(e) { e.preventDefault(); box.classList.add('drag-over'); };
  box.ondragleave = function(e) { if (!box.contains(e.relatedTarget)) box.classList.remove('drag-over'); };
  box.ondrop = function(e) {
    e.preventDefault(); box.classList.remove('drag-over');
    var id = e.dataTransfer.getData('text/plugin-id');
    if (id) Gongfang._extEnable(id);
  };
};

// ★ 详情弹窗
Gongfang._extModalShow = function(id) {
  var all = Gongfang._getAllExtCards();
  var m = all.find(function(x) { return x.id === id; });
  if (!m) return;
  document.getElementById('extModalIcon').innerHTML = m.icon;
  document.getElementById('extModalName').textContent = m.name;
  document.getElementById('extModalDesc').textContent = m.desc;
  document.getElementById('extModalMeta').innerHTML =
    (m.version ? '<span>v' + m.version + '</span>' : '') +
    (m.author ? '<span>' + m.author + '</span>' : '') +
    (m.type ? '<span>' + (m.type === 'builtin' ? '内置' : (m.type === 'thirdparty' ? '第三方' : '占位')) + '</span>' : '');
  var a = document.getElementById('extModalActions');
  if (!m._real) {
    a.innerHTML = '<button class="ext-btn-installed" disabled>开发中</button>';
  } else if (m.type === 'builtin') {
    if (m.enabled) {
      a.innerHTML = '<button class="ext-btn-installed" disabled>✓ 已启用</button><button class="ext-btn-remove" onclick="Gongfang._extDisable(\'' + m.id + '\')">禁用</button>';
    } else {
      a.innerHTML = '<button class="ext-btn-download" onclick="Gongfang._extEnable(\'' + m.id + '\')">启用</button>';
    }
  } else {
    // thirdparty
    if (m.enabled) {
      a.innerHTML = '<button class="ext-btn-installed" disabled>✓ 已启用</button><button class="ext-btn-remove" onclick="Gongfang._extDisable(\'' + m.id + '\')">禁用</button><button class="ext-btn-uninstall" onclick="Gongfang._extUninstall(\'' + m.id + '\')">卸载</button>';
    } else {
      a.innerHTML = '<button class="ext-btn-download" onclick="Gongfang._extEnable(\'' + m.id + '\')">启用</button><button class="ext-btn-uninstall" onclick="Gongfang._extUninstall(\'' + m.id + '\')">卸载</button>';
    }
  }
  document.getElementById('extModal').style.display = 'flex';
};
Gongfang._extModalClose = function() { document.getElementById('extModal').style.display = 'none'; };

// ── 启用/禁用/卸载（真实 IPC 调用）──
Gongfang._extEnable = async function(id) {
  try {
    var r = await window.electronAPI.extensionEnable(id);
    if (r && r.success) {
      var e = Gongfang._extensions.find(function(x) { return x.id === id; });
      if (e) {
        e.enabled = true;
        // ★ 先注入扩展 main.js（注册 window.GongfangExtension[mode]），再注入按钮
        //   否则按钮点击时扩展未就绪，_writeSwitchMode 找不到扩展会静默失败
        await Gongfang._injectExtensionScript(e);
        Gongfang._injectPluginBtn(e);
      }
      Gongfang._renderExtensions(); Gongfang._extModalClose();
      Gongfang._showToast('「' + (e ? e.name : id) + '」已启用');
    } else { Gongfang._showToast('启用失败: ' + (r && r.error || '')); }
  } catch (e) { Gongfang._showToast('启用异常: ' + (e && e.message || '')); }
};
Gongfang._extDisable = async function(id) {
  try {
    var r = await window.electronAPI.extensionDisable(id);
    if (r && r.success) {
      var e = Gongfang._extensions.find(function(x) { return x.id === id; });
      if (e) { e.enabled = false; Gongfang._removePluginBtn(id); }
      Gongfang._renderExtensions(); Gongfang._extModalClose();
      Gongfang._showToast('「' + (e ? e.name : id) + '」已禁用');
    } else { Gongfang._showToast('禁用失败: ' + (r && r.error || '')); }
  } catch (e) { Gongfang._showToast('禁用异常: ' + (e && e.message || '')); }
};
Gongfang._extUninstall = async function(id) {
  var ok = await Gongfang._showConfirm({
    title: '卸载扩展', desc: '确认卸载该扩展？相关文件将从磁盘删除。', type: 'warn', confirmText: '卸载'
  });
  if (!ok) return;
  try {
    var r = await window.electronAPI.extensionUninstall(id);
    if (r && r.success) {
      Gongfang._extensions = Gongfang._extensions.filter(function(x) { return x.id !== id; });
      Gongfang._removePluginBtn(id);
      Gongfang._renderExtensions();
      document.getElementById('extModal').style.display = 'none';
      Gongfang._showToast('扩展已卸载');
    } else { Gongfang._showToast('卸载失败: ' + (r && r.error || '')); }
  } catch (e) { Gongfang._showToast('卸载异常: ' + (e && e.message || '')); }
};

// 兼容旧调用（_extInstall/_extUninstall 旧 API 改为新模型）
Gongfang._extInstall = function(id) { return Gongfang._extEnable(id); };

// ★ 拖拽：从卡片拖到预览条启用
Gongfang._extDragStart = function(e, id) { e.dataTransfer.setData('text/plugin-id', id); };
// ★ 拖拽：预览条内排序
Gongfang._previewDragStart = function(e, id) { e.dataTransfer.setData('text/preview-id', id); e.dataTransfer.effectAllowed = 'move'; setTimeout(function(){ e.target.classList.add('dragging'); }, 0); };
// ★ v2.6 拖动插入指示：根据鼠标 X 位置决定插左/右，中间竖线反馈（drop-before/drop-after）
Gongfang._previewDragOver = function(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  var el = e.currentTarget;
  var rect = el.getBoundingClientRect();
  var isLeft = (e.clientX - rect.left) < rect.width / 2;
  el.classList.remove('drop-before', 'drop-after');
  el.classList.add(isLeft ? 'drop-before' : 'drop-after');
};
Gongfang._previewDragLeave = function(e) { e.currentTarget.classList.remove('drop-before', 'drop-after'); };
Gongfang._previewDrop = function(e, targetId) {
  e.preventDefault();
  var el = e.currentTarget;
  var rect = el.getBoundingClientRect();
  var isLeft = (e.clientX - rect.left) < rect.width / 2;
  el.classList.remove('drop-before', 'drop-after');
  var srcId = e.dataTransfer.getData('text/preview-id');
  if (!srcId || srcId === targetId) return;
  var order = JSON.parse(localStorage.getItem('gongfang_plugin_order') || '[]');
  if (!order.length) (Gongfang._extensions || []).forEach(function(p) { if (p.host !== true) order.push(p.id); });
  var si = order.indexOf(srcId), ti = order.indexOf(targetId);
  if (si < 0 || ti < 0) return;
  // 先删 src
  order.splice(si, 1);
  // ti 因删除可能变化，重取
  ti = order.indexOf(targetId);
  // isLeft 插到 target 前，否则插到 target 后
  order.splice(isLeft ? ti : ti + 1, 0, srcId);
  localStorage.setItem('gongfang_plugin_order', JSON.stringify(order));
  Gongfang._extensions.sort(function(a, b) {
    var ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  Gongfang._renderExtensions();
  Gongfang._syncPluginBtnOrder();
};
Gongfang._syncPluginBtnOrder = function() {
  var bar = document.querySelector('.write-topbar-modes'); if (!bar) return;
  var order = JSON.parse(localStorage.getItem('gongfang_plugin_order') || '[]');
  order.forEach(function(id) {
    var btn = bar.querySelector('[data-plugin="' + id + '"]');
    if (btn) bar.appendChild(btn);
  });
};

// ★ 工坊顶栏按钮注入（已启用的扩展；宿主 write 除外，其按钮已在 write.html 硬编码）
Gongfang._injectPluginBtn = function(plugin) {
  if (plugin.host === true) return; // 宿主扩展按钮由 write.html 提供
  var bar = document.querySelector('.write-topbar-modes'); if (!bar) return;
  if (bar.querySelector('[data-plugin="' + plugin.id + '"]')) return;
  var btn = document.createElement('button'); btn.className = 'write-mode-btn';
  btn.setAttribute('data-mode', plugin.id); btn.setAttribute('data-plugin', plugin.id);
  btn.title = plugin.name;
  // ★ v2.6 图标：优先 manifest button.icon（SVG inner HTML），否则方框
  var iconInner = (plugin.button && plugin.button.icon) ? plugin.button.icon
    : '<rect x="3" y="3" width="18" height="18" rx="2"/>';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconInner + '</svg>\n            ' + plugin.name;
  // ★ v2.6：write 宿主已静态加载，_writeSwitchMode 直接就绪，无需诊断重试
  btn.onclick = function() { Gongfang._writeSwitchMode(plugin.id); };
  bar.appendChild(btn);
};
Gongfang._removePluginBtn = function(id) { var btn = document.querySelector('[data-plugin="' + id + '"]'); if (btn) btn.remove(); };
Gongfang._restorePluginBtns = function() {
  (Gongfang._extensions || []).forEach(function(p) { if (p.enabled) Gongfang._injectPluginBtn(p); });
};

// 兼容：旧代码引用 _pluginRegistry
Gongfang._pluginRegistry = [];

// ★ 启动时拉取扩展列表（DOMContentLoaded 或立即执行）
function _bootExt() {
  console.log('[ext] _bootExt 触发 readyState=' + document.readyState +
    ' hasAPI=' + !!(window.electronAPI) +
    ' hasExtList=' + !!(window.electronAPI && window.electronAPI.extensionList));
  if (window.electronAPI && window.electronAPI.extensionList) Gongfang._loadExtensions();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootExt);
} else { _bootExt(); }

})();

// ★ 已删除任务控制整段（运行/心跳/进度/模式/授权/联网/阶段条）：调用方（任务面板）已下线，仅保留扩展系统
