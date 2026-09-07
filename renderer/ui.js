// 一站式数模工坊 — 面板切换 + 通用弹窗（精简版：仅工坊/扩展/设置）
window.Gongfang = window.Gongfang || {};

Gongfang._panelSwitching = false;

Gongfang.togglePanel = async function(name) {
  if (Gongfang._panelSwitching) return;
  Gongfang._panelSwitching = true;
  try {
    var S = Gongfang.STATE;
    S.activePanel = name;

    await Gongfang.renderPanel(name);

    if (name === 'write') {
      if (Gongfang._writeInit) Gongfang._writeInit();
      if (typeof Gongfang._restorePluginBtns === 'function') Gongfang._restorePluginBtns();
    }
    if (name === 'ext') { if (typeof Gongfang._renderExtensions === 'function') Gongfang._renderExtensions(); }
    if (name === 'settings') {
      if (Gongfang.renderSettings) Gongfang.renderSettings();
      if (typeof Gongfang._renderEnvConfig === 'function') {
        try { Gongfang._renderEnvConfig(); } catch (_) {}
      }
    }
  } finally {
    Gongfang._panelSwitching = false;
  }
};

// ★ renderPanel 用 display 切换面板
Gongfang.renderPanel = async function(panelName) {
  var name = panelName || Gongfang.STATE.activePanel || 'write';
  var panels = ['writePanel', 'extPanel', 'settingsPanel'];
  var map = { write: 'writePanel', ext: 'extPanel', settings: 'settingsPanel' };
  var targetId = map[name] || 'writePanel';

  var currentEl = null;
  panels.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.style.display !== 'none') currentEl = el;
  });

  var targetEl = document.getElementById(targetId);
  if (currentEl && currentEl === targetEl) return;

  // ★ 切走写作面板前先保存当前编辑内容
  if (currentEl && currentEl.id === 'writePanel') {
    window.dispatchEvent(new Event('gongfang-panel-switch'));
  }

  panels.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (id === targetId) {
      el.style.display = 'flex';
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.transition = 'none';
    } else {
      el.style.display = 'none';
      el.style.opacity = '';
      el.style.transform = '';
      el.style.transition = '';
    }
  });

  // ★ 协同会话提示窗只在「工坊」显示，切到其他页面自动收起/恢复
  if (typeof Gongfang._collabOnPanelSwitch === 'function') Gongfang._collabOnPanelSwitch();
};

// Toast 提示
Gongfang._showToast = function(msg) {
  var old = document.querySelector('.gongfang-toast');
  if (old) old.remove();
  var t = document.createElement('div');
  t.className = 'gongfang-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 1800);
};

// 错误弹窗
Gongfang.showErrorModal = function(msg) {  var old = document.querySelector('.error-overlay'); if (old) old.remove();
  var o = document.createElement('div'); o.className = 'error-overlay';
  o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
  var safeMsg = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  o.innerHTML = '<div style="background:#1e1e2e;border:1px solid #f38ba8;border-radius:12px;padding:24px;max-width:500px;width:90%;color:#cdd6f4;font-family:-apple-system,sans-serif"><div style="font-size:18px;font-weight:700;color:#f38ba8;margin-bottom:8px">❌ 运行出错</div><div style="font-size:13px;color:#a6adc8;margin-bottom:16px;line-height:1.5;word-break:break-all">' + safeMsg + '</div><button id="btnDismissError" style="width:100%;padding:10px;border:none;border-radius:8px;background:#f38ba8;color:#1e1e2e;font-size:13px;cursor:pointer;font-weight:600">关闭</button></div>';
  document.body.appendChild(o);
  document.getElementById('btnDismissError').onclick = function() { o.remove(); };
  o.onclick = function(e) { if (e.target === o) o.remove(); };
};

// ═══════════════════════════════════════════════
// ★ 工作目录（自选文件夹 + 最近历史，写作/代码/绘图三模块共用）
//   后端：src/ipc/workshop.js（workshop:open-directory / set-workdir / get-recent）
// ═══════════════════════════════════════════════
Gongfang._wsWorkdir = ''; // 当前工作目录缓存（启动/切换时刷新）

Gongfang._wsApi = function() { return window.electronAPI || null; };

// 刷新缓存并返回当前工作目录（'' = 未选择）
Gongfang._wsRefreshCache = async function() {
  try {
    var api = Gongfang._wsApi();
    if (api && api.workshopGetWorkdir) {
      var r = await api.workshopGetWorkdir();
      Gongfang._wsWorkdir = (r && r.success && r.path) ? String(r.path) : '';
    }
  } catch (_) {}
  return Gongfang._wsWorkdir;
};

// 要求必须有工作目录：没有则提示并返回 null
Gongfang._wsRequireWorkdir = function() {
  if (Gongfang._wsWorkdir) return Gongfang._wsWorkdir;
  Gongfang._showToast('请先点右上「＋ 新建」选择工作目录');
  return null;
};

// 取最近目录列表（含当前），并同步缓存
Gongfang._wsGetRecent = async function() {
  try {
    var api = Gongfang._wsApi();
    if (!api || !api.workshopGetRecent) return { recent: [], current: Gongfang._wsWorkdir || '' };
    var r = await api.workshopGetRecent();
    if (r && r.success) {
      if (r.current) Gongfang._wsWorkdir = String(r.current);
      return { recent: r.recent || [], current: r.current || '' };
    }
  } catch (_) {}
  return { recent: [], current: Gongfang._wsWorkdir || '' };
};

// 打开最近目录中的一个 → 返回 {path,name} 或 null；onPicked(path, name) 回调刷新各模块
Gongfang._wsOpenRecent = async function(dirPath, onPicked) {
  var api = Gongfang._wsApi();
  if (!api || !api.workshopSetWorkdir) { Gongfang._showToast('工作目录服务不可用'); return null; }
  try {
    var set = await api.workshopSetWorkdir(dirPath);
    if (!set || !set.success) { Gongfang._showToast('打开失败：' + ((set && set.error) || '')); return null; }
    Gongfang._wsWorkdir = String(set.path || dirPath);
    var out = { path: Gongfang._wsWorkdir, name: (set && set.name) || '' };
    if (onPicked) { try { await onPicked(out.path, out.name); } catch (_) {} }
    return out;
  } catch (e) { Gongfang._showToast('打开失败：' + (e && e.message || '')); return null; }
};

// 删除单条历史（只动历史列表，不动当前工作目录）→ 返回更新后的 recent 或 null
Gongfang._wsRemoveRecent = async function(dirPath) {
  var api = Gongfang._wsApi();
  if (!api || !api.workshopRemoveRecent) { Gongfang._showToast('工作目录服务不可用'); return null; }
  try {
    var r = await api.workshopRemoveRecent(dirPath);
    if (!r || !r.success) { Gongfang._showToast('删除失败：' + ((r && r.error) || '')); return null; }
    return r.recent || [];
  } catch (e) { Gongfang._showToast('删除失败：' + (e && e.message || '')); return null; }
};

// 清空全部历史 → 成功返回 true
Gongfang._wsClearRecent = async function() {
  var api = Gongfang._wsApi();
  if (!api || !api.workshopClearRecent) { Gongfang._showToast('工作目录服务不可用'); return false; }
  try {
    var r = await api.workshopClearRecent();
    if (!r || !r.success) { Gongfang._showToast('清空失败：' + ((r && r.error) || '')); return false; }
    return true;
  } catch (e) { Gongfang._showToast('清空失败：' + (e && e.message || '')); return false; }
};

// 选择其他文件夹并设为工作目录 → 返回 {path,name} 或 null（含取消）
Gongfang._wsBrowseWorkdir = async function(onPicked) {
  var api = Gongfang._wsApi();
  if (!api || !api.workshopOpenDirectory) { Gongfang._showToast('工作目录服务不可用'); return null; }
  try {
    var sel = await api.workshopOpenDirectory();
    if (!sel || !sel.success || !sel.path) return null; // 用户取消
    var opened = await Gongfang._wsOpenRecent(sel.path, onPicked);
    if (opened) Gongfang._showToast('已切换工作目录：' + (opened.name || opened.path));
    return opened;
  } catch (e) { Gongfang._showToast('选择失败：' + (e && e.message || '')); return null; }
};
