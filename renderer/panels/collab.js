// Gongfang v2.6 — 局域网协作（渲染层）
// 单人/协作开关、协作房间弹窗、右上角成员胶囊、文件占用标记、
// 设置二级菜单（含协作模式完整面板）、代码主题卡片、编译投票弹窗。
// 协作态下文件读写/锁/编译走 collab-* IPC，非协作路径保持原有本地行为。
window.Gongfang = window.Gongfang || {};

Gongfang._collabState = {
  active: false, role: '', code: '', project: null,
  memberN: 0, memberId: '', hostInfo: null,
  members: [], locks: {}, latency: 0, startedAt: 0,
  wifi: { ssid: '', networks: [], ip: '' },
  currentVote: null, pendingOpen: null, lastLockedFile: null,
  memberViews: {},  // 成员当前查看的文件（memberN -> { filePath, rel }），用于区分「查看X」与「编辑X」
};
Gongfang._collabRoom = { tab: 'create', hosts: [], selHost: null, pendingCode: '' };

// ── 基础工具 ──
Gongfang._collabEsc = function (s) { return String(s == null ? '' : s); };
Gongfang._collabColors = ['#ef4444', '#3b82f6', '#22c55e', '#f97316'];
Gongfang._collabColor = function (n) { return Gongfang._collabColors[((n - 1) % 4 + 4) % 4]; };
Gongfang._collabBg = function (n) {
  var m = { 1: 'rgba(239,68,68,.10)', 2: 'rgba(59,130,246,.10)', 3: 'rgba(34,197,94,.10)', 4: 'rgba(249,115,22,.10)' };
  return m[n] || '';
};
Gongfang._collabInPath = function (fp) {
  var s = Gongfang._collabState;
  if (!s.active || !s.project || !fp) return false;
  var base = String(s.project.path).replace(/\\/g, '/').toLowerCase();
  var p = String(fp).replace(/\\/g, '/').toLowerCase();
  return p === base || p.indexOf(base + '/') === 0;
};
// 某锁的占用集合里是否包含成员 n
Gongfang._collabLockHas = function (lock, n) {
  return !!(lock && Array.isArray(lock.owners) && lock.owners.some(function (o) { return o.ownerN === n; }));
};
// 统一路径分隔符（锁 key 有的来自 / 有的来自 \，直接比对会失配）
Gongfang._collabNormKey = function (fp) { return String(fp || '').replace(/\\/g, '/'); };
// 规范化查找某文件的锁（兼容不同分隔符存储）
// 若同文件因历史/双 key 残留多个条目，则合并所有 owner，避免叠环丢失
Gongfang._collabFindLock = function (filePath) {
  var st = Gongfang._collabState;
  var k = Gongfang._collabNormKey(filePath);
  if (st.locks[k] !== undefined) return st.locks[k];
  var merged = null;
  for (var f in st.locks) {
    if (Gongfang._collabNormKey(f) === k) {
      var cur = st.locks[f];
      if (!Array.isArray((cur || {}).owners)) continue;
      if (!merged) merged = { owners: [] };
      cur.owners.forEach(function (o) {
        if (!merged.owners.some(function (x) { return x.ownerN === o.ownerN; })) merged.owners.push(o);
      });
    }
  }
  return merged || undefined;
};
Gongfang._collabMemberFile = function (n) {
  var st = Gongfang._collabState;
  for (var f in st.locks) {
    if (Gongfang._collabLockHas(st.locks[f], n)) return String(f).split(/[\\/]/).pop();
  }
  return '';
};
// 某成员当前查看的文件（非持锁）：优先用广播来的 memberViews，自己用 activeFilePath
Gongfang._collabMemberView = function (n) {
  var st = Gongfang._collabState;
  if (n === st.memberN) return Gongfang._writeState.activeFilePath || '';
  var v = (st.memberViews && st.memberViews[n]) ? st.memberViews[n].filePath : '';
  return v || '';
};
// 某文件的所有"只读查看者"（未持锁但打开着该文件的成员），含自己；排除持有该锁的编辑者
Gongfang._collabFileViewers = function (filePath) {
  var st = Gongfang._collabState;
  var k = Gongfang._collabNormKey(filePath);
  var lock = Gongfang._collabFindLock(filePath);
  var out = [];
  st.memberViews = st.memberViews || {};
  for (var n in st.memberViews) {
    var v = st.memberViews[n];
    if (!v || Gongfang._collabNormKey(v.filePath) !== k) continue;
    if (Gongfang._collabLockHas(lock, Number(n))) continue; // 持锁人算编辑，不算查看
    if (out.indexOf(Number(n)) < 0) out.push(Number(n));
  }
  var me = st.memberN;
  if (Gongfang._writeState.activeFilePath && Gongfang._collabNormKey(Gongfang._writeState.activeFilePath) === k
    && !Gongfang._collabLockHas(lock, me) && out.indexOf(me) < 0) out.push(me);
  return out;
};
// 某文件当前对"我"是否只读（供保存拦截/徽标复用，与只读判定同源）
// ★ _readonlyOverride 统一存「归一化路径」（正斜杠）：lock-changed 等事件回传的是归一化 key，
//   否则 Windows 反斜杠路径永远比对不上 → 对方释放锁后预览模式无法自动解除
Gongfang._collabIsReadonly = function (filePath) {
  var st = Gongfang._collabState;
  if (!st || !st.active || !filePath || !Gongfang._collabInPath(filePath)) return false;
  if (st._readonlyOverride === Gongfang._collabNormKey(filePath)) return true;
  var lock = Gongfang._collabFindLock(filePath);
  if (lock && lock.owners && lock.owners.length && !Gongfang._collabLockHas(lock, st.memberN)) return true;
  return false;
};
// ★ 预览模式写入拦截：当前文件是只读（被他人编辑）时，禁止拖图/插文件/上传等旁路写入，
//   否则这些改动不会同步，会破坏共享文件一致性。返回 true 表示已拦截并提示。
Gongfang._collabBlockedByPreview = function () {
  var st = Gongfang._collabState;
  var fp = Gongfang._writeState && Gongfang._writeState.activeFilePath;
  if (st && st.active && fp && Gongfang._collabIsReadonly(fp)) {
    Gongfang._collabShowToast('预览模式为只读，不能插入或上传文件');
    return true;
  }
  return false;
};
// 描述某成员状态：editing（持锁编辑）/ viewing（只读查看）/ idle（空闲）
Gongfang._collabDescribeMember = function (n) {
  var st = Gongfang._collabState;
  // 1) 持锁 = 正在编辑
  var editFile = Gongfang._collabMemberFile(n);
  if (editFile) return { mode: 'editing', file: editFile, editing: true, viewing: false };
  // 2) 有激活文件 = 正在查看（只读）
  var vf = Gongfang._collabMemberView(n);
  if (vf && Gongfang._collabInPath(vf)) {
    return { mode: 'viewing', file: String(vf).split(/[\\/]/).pop(), editing: false, viewing: true };
  }
  // 3) 空闲
  return { mode: 'idle', file: '', editing: false, viewing: false };
};
// ★ 本机释放锁后的乐观清理：立刻把自己从该文件的占用里摘掉，不等服务器回包，
//   否则本机文件树要多等一轮 ws 往返才消失（而对方设备因为广播是实时消失的）。
Gongfang._collabOptimisticReleaseLock = function (filePath) {
  var st = Gongfang._collabState;
  if (!st.locks || !filePath) return;
  var key = Gongfang._collabNormKey(filePath);
  Object.keys(st.locks).forEach(function (k) {
    if (Gongfang._collabNormKey(k) !== key) return;
    var lk = st.locks[k];
    if (lk && Array.isArray(lk.owners)) {
      lk.owners = lk.owners.filter(function (o) { return o.ownerN !== st.memberN; });
      if (!lk.owners.length) delete st.locks[k];
    }
  });
  Gongfang._collabApplyTreeLocks();
};
// 进入某文件：先释放上一个激活文件的锁，再申请新文件锁。
// ★ v2.6.11 单编辑者独占：被他人占用时不再申请锁，改以只读打开（实时看编辑流 + 远端光标）。
Gongfang._collabEnterFile = function (filePath) {
  var st = Gongfang._collabState;
  if (!st.active || !Gongfang._collabInPath(filePath)) return true;
  // ★ 标签切换延迟修复：锁操作一律不 await（发起即返回，交由 lock-granted/lock-denied 事件异步确认）。
  //   之前在此 await 两次 IPC 往返，导致每次点击标签都要等锁交互完成后才真正切文件。
  // ★ 只允许占用一个：进入新文件前，把自己名下所有「其它文件」的锁全部放掉（无论 lastLockedFile 是否跟丢）。
  //   逐个扫 st.locks，从根上避免"已离开的文件仍残留占用圆点、对方那边迟迟不消失"。
  var targetKey = Gongfang._collabNormKey(filePath);
  Object.keys(st.locks).forEach(function (k) {
    var lk = st.locks[k];
    if (!lk || !Array.isArray(lk.owners)) return;
    if (!lk.owners.some(function (o) { return o.ownerN === st.memberN; })) return;
    if (Gongfang._collabNormKey(k) === targetKey) return;
    try { window.electronAPI.collabReleaseLock(k); } catch (_) {}
    // ★ 本地乐观清理：立即摘掉上一个文件的占用标记，实现本机文件树即时消失
    Gongfang._collabOptimisticReleaseLock(k);
  });
  var lock = Gongfang._collabFindLock(filePath);
  var otherOwner = lock && lock.owners && lock.owners.length
    ? lock.owners.some(function (o) { return o.ownerN !== st.memberN; }) : false;
  // 文件被他人独占 → 只读打开；不申请锁，也不把自己标记为 lastLockedFile
  if (otherOwner) {
    st._readonlyOverride = targetKey;
    st.lastLockedFile = null;
  } else {
    delete st._readonlyOverride;
    // 锁里没有我 → 申请独占（若申请中被拒，lock-denied 会再次强制只读）
    if (!Gongfang._collabLockHas(lock, st.memberN)) {
      // ★ 乐观占用：本地立即登记持锁，让本机文件树即时显示占用色块，不等 lock-granted 往返
      var _owners = (lock && Array.isArray(lock.owners)) ? lock.owners.slice() : [];
      if (!_owners.some(function (o) { return o.ownerN === st.memberN; })) _owners.push({ ownerN: st.memberN, owner: '我' });
      st.locks[targetKey] = { owners: _owners };
      window.electronAPI.collabRequestLock(filePath);
    }
    st.lastLockedFile = filePath;
  }
  // ★ 广播我正在查看的文件（对方文件树/胶囊实时显示「查看中」，空表则靠轮询兜底）
  Gongfang._collabNotifyView(filePath);
  return true;
};
// ★ 通知全队我当前打开的文件（区分「编辑X/查看X」）；filePath 为空 = 已关闭所有文件
Gongfang._collabNotifyView = function (filePath) {
  var st = Gongfang._collabState;
  if (!st.active) return;
  try { window.electronAPI.collabSendView(filePath || ''); } catch (_) {}
};
// ═══════════ 实时编辑流（持锁人 → 其他只读客户端）═══════════
Gongfang._collabEditTimer = null;
Gongfang._collabEditLastSent = 0;
Gongfang._collabEditPending = false;
// 持锁人把编辑内容推给其他只读端：首键立即推送，之后 20ms 节流（约一帧，几乎无感知延迟）
Gongfang._collabEmitEdit = function () {
  var st = Gongfang._collabState;
  var fp = Gongfang._writeState.activeFilePath;
  if (!fp || !Gongfang._collabInPath(fp)) return;
  var content = Gongfang._writeGetContent ? Gongfang._writeGetContent() : '';
  Gongfang._collabEditLastSent = Date.now();
  Gongfang._collabEditPending = false;
  try { window.electronAPI.collabSendEdit(fp, content); } catch (_) {}
};
Gongfang._collabOnEditorChange = function () {
  var st = Gongfang._collabState;
  if (!st.active) return;
  var fp = Gongfang._writeState.activeFilePath;
  if (!fp || !Gongfang._collabInPath(fp)) return;
  if (st._readonlyOverride === fp) return;
  var lock = Gongfang._collabFindLock(fp);
  if (!Gongfang._collabLockHas(lock, st.memberN)) return; // 非持锁人不推送实时流（只读端仅接收）
  var now = Date.now();
  var since = now - Gongfang._collabEditLastSent;
  if (Gongfang._collabEditLastSent === 0 || since >= 20) {
    // 首次编辑或距上次发出已超过 20ms → 立即推送
    if (Gongfang._collabEditTimer) { clearTimeout(Gongfang._collabEditTimer); Gongfang._collabEditTimer = null; }
    Gongfang._collabEmitEdit();
  } else if (!Gongfang._collabEditPending) {
    // 距上次不足 20ms → 节流：在剩余时间点上补发一次，不丢失最后一次改动
    Gongfang._collabEditPending = true;
    Gongfang._collabEditTimer = setTimeout(function () { Gongfang._collabEmitEdit(); }, 20 - since);
  }
};
// 持锁人移动光标/选区 → 推送远端光标
Gongfang._collabOnCursorActivity = function (cm) {
  var st = Gongfang._collabState;
  if (!st.active || !cm) return;
  var fp = Gongfang._writeState.activeFilePath;
  if (!fp || !Gongfang._collabInPath(fp)) return;
  if (st._readonlyOverride === Gongfang._collabNormKey(fp)) return;
  var lock = Gongfang._collabFindLock(fp);
  if (!Gongfang._collabLockHas(lock, st.memberN)) return;
  var cur = cm.getCursor();
  if (cur && cur.line != null) {
    try { window.electronAPI.collabSendCursor(fp, { line: cur.line, ch: cur.ch || 0 }); } catch (_) {}
  }
};
// 远端光标渲染：在只读端编辑器上叠加一个带成员名的标签（不点保存也能看到对方改到哪）
Gongfang._collabRemoteCursorMarks = [];
Gongfang._collabRemoteCursorWidgets = [];
Gongfang._collabRemoteCursorTimer = null;
Gongfang._collabRenderRemoteCursor = function (p) {
  var st = Gongfang._collabState;
  var ed = Gongfang._writeState && Gongfang._writeState.editor;
  var fp = Gongfang._writeState.activeFilePath;
  if (!ed || !fp || !p || !p.cursor) return;
  if (Gongfang._collabNormKey(fp) !== Gongfang._collabNormKey(p.filePath)) return;
  // ★ 先清掉上一个光标（mark + 悬浮标签），否则标签会一直堆积不消失
  Gongfang._collabClearRemoteCursor();
  if (p.cursor.line == null) return;
  var color = Gongfang._collabColor(p.byN);
  var label = document.createElement('span');
  label.className = 'collab-remote-cursor';
  label.style.background = color;
  label.textContent = (p.by && String(p.by).slice(0, 8)) || ('成员' + p.byN);
  try {
    var line = Number(p.cursor.line);
    var ch = Number(p.cursor.ch || 0);
    if (line >= 0 && line < ed.lineCount()) {
      var mark = ed.markText({ line: line, ch: ch }, { line: line, ch: Math.min(ch + 1, ed.getLine(line).length) }, {
        className: 'collab-remote-cursor-bg',
        css: 'color:' + color + ';border-left:3px solid ' + color + ';border-bottom:2px solid ' + color + ';background:transparent;',
        attributes: { 'data-owner': String(p.byN) }
      });
      Gongfang._collabRemoteCursorMarks.push(mark);
      // ★ 第 4 参 'above'：把成员标签悬浮在光标上方，而不是压在光标正下方/行末，
      //   否则行末时标签会被水平 clamp 回右边界，正好盖住光标 → 用户看不到光标。
      ed.addWidget({ line: line, ch: ch }, label, false, 'above');
      Gongfang._collabRemoteCursorWidgets.push(label);
    }
  } catch (_) {}
  // ★ 8s 内无后续光标移动（对方停止/离开）→ 自动隐藏；持续移动则保持闪烁
  if (Gongfang._collabRemoteCursorTimer) clearTimeout(Gongfang._collabRemoteCursorTimer);
  Gongfang._collabRemoteCursorTimer = setTimeout(function () { Gongfang._collabClearRemoteCursor(); }, 8000);
};
Gongfang._collabClearRemoteCursor = function () {
  (Gongfang._collabRemoteCursorMarks || []).forEach(function (m) { try { m.clear(); } catch (_) {} });
  Gongfang._collabRemoteCursorMarks = [];
  (Gongfang._collabRemoteCursorWidgets || []).forEach(function (w) { try { w.remove(); } catch (_) {} });
  Gongfang._collabRemoteCursorWidgets = [];
  if (Gongfang._collabRemoteCursorTimer) { clearTimeout(Gongfang._collabRemoteCursorTimer); Gongfang._collabRemoteCursorTimer = null; }
};

let _myNameCache = '';
Gongfang._collabMyName = async function () {
  if (_myNameCache) return _myNameCache;
  // ★ 优先显示账号名；账号名可缓存，设备名仅临时兜底不缓存（登录后自动换成账号名）
  try {
    const p = await window.electronAPI.getUserProfile();
    if (p) { const n = p.name || p.username || p.nickname || p.nickName || p.nick_name || p.email || p.phone; if (n) { _myNameCache = String(n); return _myNameCache; } }
  } catch (_) {}
  try { const d = await window.electronAPI.collabDeviceName(); if (d && d.name) return String(d.name); } catch (_) {}
  return '成员';
};
Gongfang._collabShowToast = function (msg) { try { Gongfang._showToast(msg); } catch (_) {} };
Gongfang._collabSetSwitch = function (mode) {
  var btns = document.querySelectorAll('#writeCollabSwitch .write-mode-switch-btn');
  btns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
};

// ═══════════ 文件读写 / 编译 / 打开 的协作态重定向 ═══════════
(function installFileHooks() {
  var api = window.electronAPI;
  var origRead = api.readFileContent;
  api.readFileContent = async function (filePath) {
    if (Gongfang._collabInPath(filePath)) {
      var r = await api.collabReadFile(filePath);
      if (r) return r;
    }
    return origRead(filePath);
  };
  var origWrite = api.writeFileContent;
  api.writeFileContent = async function (filePath, content) {
    if (Gongfang._collabInPath(filePath)) {
      await api.collabWriteFile(filePath, content, false);
      return { success: true };
    }
    return origWrite(filePath, content);
  };
  var origTree = api.writeGetFileTree;
  api.writeGetFileTree = async function (projectPath) {
    if (Gongfang._collabInPath(projectPath)) {
      var r = await api.collabGetFileTree(projectPath);
      if (r && r.success) return r;
    }
    return origTree(projectPath);
  };
  var origList = api.listDirFiles;
  api.listDirFiles = async function (dirPath) {
    if (Gongfang._collabInPath(dirPath)) {
      var tr = await api.collabGetFileTree(dirPath);
      var files = [];
      (function flat(n) { if (!n) return; if (n.type === 'directory') (n.children || []).forEach(flat); else files.push({ name: n.name, path: n.path }); })(tr && tr.tree);
      return { files: files };
    }
    return origList(dirPath);
  };
})();

// ═══════════ write.js 关键函数包裹 ═══════════
(function installWriteHooks() {
  // ★ 防御：write 宿主脚本必须先加载（index.html 里排在本文件之前）。
  //   若原始函数缺失（宿主脚本 404/未执行），跳过安装并明错，避免装上必抛的空壳钩子
  //   把"脚本没加载"掩盖成 "origX is not a function"。
  function hookable(fn, name) {
    if (typeof fn !== 'function') {
      console.error('[collab] write hooks 跳过 ' + name + '：原始函数缺失（write 宿主脚本未加载？）');
      return false;
    }
    return true;
  }
  // 编译 → 协作态发起投票
  var origCompile = Gongfang._writeCompile;
  if (hookable(origCompile, '_writeCompile')) {
  Gongfang._writeCompile = async function () {
    var st = Gongfang._collabState;
    if (st.active && st.project) {
      await Gongfang._writeFlushDirtyFiles();
      window.electronAPI.collabCompileRequest(st.project.path);
      Gongfang._writeSetCompileStatus('已发起编译，等待成员同意…', 'cmp-running');
      Gongfang._writeAppendLog('已发起编译，等待所有在线成员同意…');
      return;
    }
    return origCompile();
  };
  }

  // 打开/切换文件 → 协作态先申请锁（锁只跟随当前激活文件）
  // ★ 打开/切换后立即刷新文件树占用标识 + 胶囊（不等 3s 轮询，占用/查看状态实时更新）
  var origOpen = Gongfang._writeOpenFile;
  if (hookable(origOpen, '_writeOpenFile')) {
  Gongfang._writeOpenFile = async function (filePath, fileName) {
    if (!(await Gongfang._collabEnterFile(filePath))) return;
    await origOpen(filePath, fileName);
    Gongfang._collabApplyEditorReadOnly();
    Gongfang._collabApplyTreeLocks();
    Gongfang._collabRenderCapsules();
  };
  }
  var origSwitch = Gongfang._writeSwitchFile;
  if (hookable(origSwitch, '_writeSwitchFile')) {
  Gongfang._writeSwitchFile = async function (filePath) {
    if (!(await Gongfang._collabEnterFile(filePath))) return;
    await origSwitch(filePath);
    Gongfang._collabApplyEditorReadOnly();
    Gongfang._collabApplyTreeLocks();
    Gongfang._collabRenderCapsules();
  };
  }

  // 标签页渲染后刷新"被占用禁点"状态 + 占用标识（重渲染会清掉动态附加的徽标）
  var origRenderTabs = Gongfang._writeRenderTabs;
  if (hookable(origRenderTabs, '_writeRenderTabs')) {
  Gongfang._writeRenderTabs = function () {
    origRenderTabs();
    Gongfang._collabApplyDisabledState();
    Gongfang._collabApplyTreeLocks();
  };
  }

  // 文件树重渲染后同样补上占用/查看标识
  // ★ 必须 await 渲染完成后再应用标识：_writeRenderFileBrowser 是异步的，
  //   之前不 await 会在树还是「加载中/空」时应用，导致对方占用标志要手动点一下才出现
  if (Gongfang._writeRenderFileBrowser) {
    var origRenderFB = Gongfang._writeRenderFileBrowser;
    Gongfang._writeRenderFileBrowser = async function () {
      await origRenderFB();
      if (Gongfang._collabState.active) Gongfang._collabApplyTreeLocks();
    };
  }

  // 关闭文件 → 协作态释放锁 + 广播新的查看状态 + 立即刷新标识
  var origClose = Gongfang._writeCloseTab;
  if (hookable(origClose, '_writeCloseTab')) {
  Gongfang._writeCloseTab = async function (filePath) {
    var st = Gongfang._collabState;
    if (st.active && Gongfang._collabInPath(filePath)) {
      var lock = Gongfang._collabFindLock(filePath);
      if (Gongfang._collabLockHas(lock, st.memberN)) {
        await window.electronAPI.collabReleaseLock(filePath);
        // ★ 本地乐观清理：关闭标签立即摘掉该文件的占用标记（本机文件树即时消失）
        Gongfang._collabOptimisticReleaseLock(filePath);
      }
      if (st.lastLockedFile === filePath) st.lastLockedFile = null;
      if (st._readonlyOverride === Gongfang._collabNormKey(filePath)) delete st._readonlyOverride;
    }
    await origClose(filePath);
    // 关闭后：广播现在激活的文件（没有打开的文件则广播空 = 清除「查看中」）
    if (st.active) Gongfang._collabNotifyView(Gongfang._writeState.activeFilePath || '');
    Gongfang._collabApplyTreeLocks();
    Gongfang._collabRenderCapsules();
  };
  }

  // 协作态自动保存防抖缩短到 3s（准实时同步）；被他人占用只读时不自动保存
  var origAutoSave = Gongfang._writeAutoSaveDebounce;
  if (hookable(origAutoSave, '_writeAutoSaveDebounce')) {
  Gongfang._writeAutoSaveDebounce = function () {
    if (Gongfang._collabState.active) {
      var _fp = Gongfang._writeState.activeFilePath;
      if (_fp && Gongfang._collabState._readonlyOverride === Gongfang._collabNormKey(_fp)) return;
      if (Gongfang._writeState._saveTimer) clearTimeout(Gongfang._writeState._saveTimer);
      Gongfang._writeState._saveTimer = setTimeout(function () { Gongfang._writeAutoSave(true); }, 3000);
      return;
    }
    origAutoSave();
  };
  }

  // 设置菜单：完全接管打开逻辑（显示用 flex 保证左右分栏，锚定在视口，不受编译条展开影响）
  Gongfang._writeToggleCompileSettings = function () {
    var menu = document.getElementById('writeCompileSettingsMenu');
    var btn = document.getElementById('writeSettingsBtn');
    document.getElementById('writeProjectMenu').style.display = 'none';
    document.getElementById('writeOutlineMenu').style.display = 'none';
    if (!menu || !btn) return;
    var showing = menu.style.display !== 'none';
    if (showing) { menu.style.display = 'none'; return; }
    var r = btn.getBoundingClientRect();
    // ★ position:fixed 锚定视口：打开后不受「编译输出」展开/收起推挤影响，也不再相对 writePanel 计算
    var menuH = 400;
    var gap = 6;
    var top = r.top - menuH - gap;
    if (top < 8) {
      top = r.bottom + 8;
      if (top + menuH > window.innerHeight) top = Math.max(8, window.innerHeight - menuH - 8);
    }
    var left = r.left;
    if (left + 560 > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 560 - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.display = 'flex';
    Gongfang._writeRenderCompileSettings();
    Gongfang._collabRenderStatusPane();
    document.querySelectorAll('.write-settings-nav-item').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-pane') === 'main'); });
    document.querySelectorAll('.ws-detail-section').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-pane') === 'main'); });
  };

  // 主题列表 → 卡片预览
  var origRender = Gongfang._writeRenderCompileSettings;
  Gongfang._writeRenderCompileSettings = function () {
    origRender();
    Gongfang._collabRenderThemeCards();
  };
})();

// ═══════════ 单人 / 协作 模式开关 ═══════════
Gongfang._collabSwitch = async function (mode) {
  Gongfang._collabSetSwitch(mode);
  if (mode === 'solo') {
    // ★ 成员切回单人：先弹「确认是否退出房间」，确认后才真正退出（主机直接退出并保留自己的项目）
    if (Gongfang._collabState.active && Gongfang._collabState.role === 'member' && typeof Gongfang._showConfirm === 'function') {
      var ok = await Gongfang._showConfirm({
        title: '退出房间',
        desc: '确定要退出当前协作房间吗？退出后文件区域、大纲区域将显示空白。',
        type: 'warn',
        confirmText: '退出'
      });
      if (!ok) { Gongfang._collabSetSwitch('collab'); Gongfang._collabRenderStatusPane(); return; }
    }
    if (Gongfang._collabState.active) Gongfang._collabLeave();
    var _d = document.getElementById('collabRoomDialog');
    if (_d) _d.classList.remove('show'); // 切回单人同时关闭可能开着的房间窗
    Gongfang._collabRenderStatusPane();
    return;
  }
  if (mode === 'collab') {
    Gongfang._collabOpenRoom(Gongfang._collabRoom.tab || 'create');
    Gongfang._collabRenderStatusPane();
    return;
  }
};

// ★ 生成待定房间号并显示在创建房间视图（确认建房时原样传给服务端，保证显示即真实码）
Gongfang._collabGenPendingCode = function () {
  var c = '';
  for (var i = 0; i < 6; i++) c += Math.floor(Math.random() * 10);
  Gongfang._collabRoom.pendingCode = c;
  var el = document.getElementById('roomCreateCode');
  if (el) el.textContent = c;
};
// 5.1 自动建房：有打开的项目就直接创建房间生成协作码并进入
Gongfang._collabAutoHost = async function () {
  var proj = Gongfang._writeState.activeProject;
  if (!proj) { Gongfang._collabOpenRoom('create'); return; }
  var name = await Gongfang._collabMyName();
  var r = await window.electronAPI.collabHostStart({
    projectName: proj.name, projectPath: proj.path,
    texFile: Gongfang._writeState.mainTexFile || proj.texFile || '',
    compileEngine: Gongfang._writeState.compileEngine || 'xelatex', name: name,
  });
  if (r && r.success) {
    var st = Gongfang._collabState;
    st.active = true; st.role = 'host'; st.code = r.code; st.project = proj; st.memberN = 1; st.startedAt = Date.now();
    await Gongfang._collabRefresh();
    Gongfang._collabEnterView();
    Gongfang._collabShowRoomCode();   // 弹出房间窗展示协作码，方便发给队友
  } else {
    Gongfang._collabShowToast((r && r.error) || '创建失败');
    Gongfang._collabOpenRoom('create');
  }
};
// 展示协作码（已建房时房间窗的「创建房间」视图显示真实码，确认=关闭）
Gongfang._collabShowRoomCode = function () {
  var d = document.getElementById('collabRoomDialog');
  Gongfang._collabRoomTab('create');
  var codeEl = document.getElementById('roomCreateCode');
  if (codeEl) codeEl.textContent = Gongfang._collabState.code || '······';
  if (d) d.classList.add('show');
};

// ═══════════ 协作房间弹窗 ═══════════
Gongfang._collabOpenRoom = function (tab) {
  Gongfang._collabRoomTab(tab || Gongfang._collabRoom.tab || 'create');
  document.getElementById('collabRoomDialog').classList.add('show');
};
Gongfang._collabRoomTab = function (t) {
  Gongfang._collabRoom.tab = t;
  document.getElementById('roomTabCreate').classList.toggle('active', t === 'create');
  document.getElementById('roomTabJoin').classList.toggle('active', t === 'join');
  document.getElementById('roomCreateView').style.display = t === 'create' ? 'block' : 'none';
  document.getElementById('roomJoinView').style.display = t === 'join' ? 'block' : 'none';
  if (t === 'create') {
    // ★ 进入创建视图即生成并直接显示真实协作码（避免一开始显示点点）
    if (!Gongfang._collabState.active && !Gongfang._collabRoom.pendingCode) {
      Gongfang._collabGenPendingCode();
    }
    var codeEl = document.getElementById('roomCreateCode');
    if (codeEl) {
      // 优先显示待定房间号（进创建视图就生成），已建房显示真实码
      codeEl.textContent = Gongfang._collabRoom.pendingCode
        || ((Gongfang._collabState.active && Gongfang._collabState.role === 'host') ? Gongfang._collabState.code : '······');
    }
  }
  Gongfang._collabRenderRoomMembers();
  if (t === 'join') Gongfang._collabScanHosts();
};
Gongfang._collabRenderRoomMembers = function () {
  var el = document.getElementById('roomMembers');
  var st = Gongfang._collabState;
  if (!el) return;
  if (st.active) {
    el.innerHTML = '<div class="collab-member-row" style="color:#a1a1aa;font-size:11px">当前房间成员</div>'
      + (st.members || []).map(function (m) {
        return '<div class="collab-member-row"><span class="collab-cap-dot" style="background:' + Gongfang._collabColor(m.n) + '">' + m.n + '</span>'
          + '<span>' + Gongfang._collabEsc(m.name) + (m.role === '主' ? ' <span style="color:#f59e0b">主</span>' : '') + '</span></div>';
      }).join('');
    return;
  }
  el.innerHTML = '<div class="collab-member-row" style="color:#a1a1aa">（确认进入后显示成员）</div>';
};
Gongfang._collabJoinInput = function (inp) {
  var v = String((inp && inp.value) || '').trim();
  // ★ 输满 6 位协作码 → 在扫描结果里自动匹配该房间并直接进入
  if (/^\d{6}$/.test(v)) Gongfang._collabJoinByCode(v);
};
Gongfang._collabRegen = function () {
  // 换一个房间号：重新生成并同步到待定码（确认建房时原样使用）
  Gongfang._collabGenPendingCode();
};
Gongfang._collabScanHosts = async function () {
  var list = document.getElementById('roomHostList');
  if (!list) return;
  list.innerHTML = '<div class="collab-host-row" style="color:#a1a1aa">扫描中…</div>';
  try {
    var hosts = await window.electronAPI.collabScan();
    Gongfang._collabRoom.hosts = hosts || [];
    // 重扫后清掉过期选中（旧对象不在新列表里）
    var sel = Gongfang._collabRoom.selHost;
    if (sel && !(hosts || []).some(function (h) { return h.ip === sel.ip && h.port === sel.port; })) {
      Gongfang._collabRoom.selHost = null;
    }
    if (!hosts || !hosts.length) {
      list.innerHTML = '<div class="collab-host-row" style="color:#a1a1aa">未发现主机，请确认房主已创建房间且在同一局域网</div>';
      return;
    }
    list.innerHTML = '';
    hosts.forEach(function (h) {
      var row = document.createElement('div');
      row.className = 'collab-host-row';
      var cnt = (h.members && h.members.length) || 0;
      row.innerHTML = '<span class="collab-host-name">' + Gongfang._collabEsc(h.name || '主机') + '</span>'
        + (h.project ? '<span class="collab-host-proj">（' + Gongfang._collabEsc(h.project) + '）</span>' : '')
        + '<span class="collab-host-meta">' + (h.code ? '房间 ' + Gongfang._collabEsc(h.code) + ' · ' : '') + cnt + '/4 人</span>';
      // ★ 点击 = 选中（高亮），再点底部「进入」按钮加入
      row.onclick = function () {
        document.querySelectorAll('#roomHostList .collab-host-row').forEach(function (x) { x.classList.remove('sel'); });
        row.classList.add('sel');
        Gongfang._collabRoom.selHost = h;
      };
      list.appendChild(row);
    });
  } catch (_) { list.innerHTML = '<div class="collab-host-row" style="color:#a1a1aa">扫描失败，请稍后重试</div>'; }
};
// ★ 按协作码加入：总是先重新扫描（旧缓存可能没含刚建房的主机），新结果优先、旧缓存兜底
Gongfang._collabJoinByCode = async function (code) {
  var fresh = [];
  try { fresh = (await window.electronAPI.collabScan()) || []; } catch (_) {}
  var old = Gongfang._collabRoom.hosts || [];
  if (fresh.length) Gongfang._collabRoom.hosts = fresh;
  var pool = fresh.concat(old);
  var hit = pool.filter(function (h) { return h && h.ip && h.port && String(h.code || '') === String(code); })[0];
  if (!hit) {
    Gongfang._collabShowToast('局域网内未找到房间 ' + code + '，请点击列表中的主机进入');
    Gongfang._collabScanHosts();   // 顺手把列表刷成最新，方便直接点选
    return;
  }
  Gongfang._collabDoJoin(hit, code);
};
// ★ 统一加入入口：host = 扫描结果（含 ip/port/code），防重复点击
Gongfang._collabJoining = false;
Gongfang._collabDoJoin = async function (h, codeOverride) {
  var st = Gongfang._collabState;
  if (Gongfang._collabJoining || st.active) return;
  if (!h || !h.ip || !h.port) { Gongfang._collabShowToast('主机信息不完整'); return; }
  var code = String(codeOverride || h.code || '');
  if (!/^\d{6}$/.test(code)) {
    // ★ 主机未携带协作码（如旧版本主机）→ 用输入框里已输入的码兜底，尽量放行
    var typed = (document.getElementById('roomJoinInput').value || '').trim();
    if (/^\d{6}$/.test(typed)) code = typed;
  }
  if (!/^\d{6}$/.test(code)) { Gongfang._collabShowToast('该主机未提供协作码，请输入 6 位协作码后重试'); return; }
  Gongfang._collabJoining = true;
  Gongfang._collabShowToast('正在加入房间 ' + code + '…');
  var name = await Gongfang._collabMyName();
  var rj;
  try {
    rj = await window.electronAPI.collabJoin({ host: h.ip, port: h.port, code: code, name: name });
  } finally { Gongfang._collabJoining = false; }
  if (!rj || !rj.success) { Gongfang._collabShowToast((rj && rj.error) || '加入失败'); return; }
  st.active = true; st.role = 'member'; st.memberN = rj.memberN; st.hostInfo = { ip: h.ip, port: h.port }; st.code = code; st.startedAt = Date.now();
  document.getElementById('collabRoomDialog').classList.remove('show');
  var ji = document.getElementById('roomJoinInput'); if (ji) ji.value = '';
  Gongfang._collabRoom.selHost = null;
  await Gongfang._collabRefresh();
  Gongfang._collabEnterView();
};
Gongfang._collabCloseRoom = function () {
  document.getElementById('collabRoomDialog').classList.remove('show');
  if (!Gongfang._collabState.active) Gongfang._collabSetSwitch('solo');
};
Gongfang._collabConfirm = async function () {
  var st = Gongfang._collabState;
  // 已建房/已入房：确认=关闭房间窗
  if (st.active) { document.getElementById('collabRoomDialog').classList.remove('show'); return; }
  var name = await Gongfang._collabMyName();
  if (Gongfang._collabRoom.tab === 'create') {
    var proj = Gongfang._writeState.activeProject;
    if (!proj) { Gongfang._collabShowToast('请先打开一个项目再创建协作'); return; }
    Gongfang._collabShowToast('正在创建协作…');
    var r = await window.electronAPI.collabHostStart({
      projectName: proj.name, projectPath: proj.path,
      texFile: Gongfang._writeState.mainTexFile || proj.texFile || '',
      compileEngine: Gongfang._writeState.compileEngine || 'xelatex', name: name,
      code: Gongfang._collabRoom.pendingCode || '', // ★ 用一开始显示的房间号建房
    });
    if (!r || !r.success) { Gongfang._collabShowToast((r && r.error) || '创建失败'); return; }
    st.active = true; st.role = 'host'; st.code = r.code; st.project = proj; st.memberN = 1; st.startedAt = Date.now();
    document.getElementById('collabRoomDialog').classList.remove('show');
    await Gongfang._collabRefresh();
    Gongfang._collabEnterView();
    return;
  }
  // join：优先用点选的主机；没点选但输入了 6 位协作码 → 按码自动匹配加入
  var code = (document.getElementById('roomJoinInput').value || '').trim();
  var sel = Gongfang._collabRoom.selHost;
  if (sel && sel.ip && sel.port) { Gongfang._collabDoJoin(sel); return; }
  if (/^\d{6}$/.test(code)) { Gongfang._collabJoinByCode(code); return; }
  Gongfang._collabShowToast('请点击选择一个主机，或输入 6 位协作码');
};
function parseHost(v) {
  if (!v) return null;
  var p = String(v).split(':');
  return { ip: (p[0] || '').trim(), port: Number(p[1]) || 45231 };
}

Gongfang._collabEnterView = async function () {
  var st = Gongfang._collabState;
  Gongfang._collabSetSwitch('collab');
  // ★ 进入协作：禁用「新建」按钮（协作中不能切换项目）
  if (Gongfang._writeSetNewTaskCollabDisabled) Gongfang._writeSetNewTaskCollabDisabled(true);
  // 成员/房主：确保把协作项目设为当前写作项目，展示其文件树 / 大纲
  if (st.project) {
    var ap = Gongfang._writeState.activeProject;
    if (!ap || ap.path !== st.project.path) {
      Gongfang._writeState.activeProject = { name: st.project.name, path: st.project.path, texFile: st.project.texFile || '' };
      if (Gongfang._writeUpdateTaskBtn) Gongfang._writeUpdateTaskBtn();
    }
    // ★ 等待文件树渲染完成后再应用占用标识（异步渲染，否则对方标志要手动点一下才出现）
    if (Gongfang._writeRenderFileBrowser) await Gongfang._writeRenderFileBrowser();
    if (Gongfang._writeRenderTabs) Gongfang._writeRenderTabs();
    if (Gongfang._writeRenderOutlineTree) Gongfang._writeRenderOutlineTree();
  }
  Gongfang._collabRenderCapsules();
  Gongfang._collabApplyTreeLocks();
  Gongfang._collabApplyEditorReadOnly();
  Gongfang._collabRenderStatusPane();
  // ★ 进入协作：当前打开（或默认打开）的文件直接由本机占用，不再"先预览后接管"的多余双状态
  var cur = Gongfang._writeState.activeFilePath;
  if (st.active) {
    if (cur && Gongfang._collabInPath(cur)) {
      Gongfang._collabOccupyOnEnter(cur);
    } else {
      // 无激活文件 → 第一次进入默认打开主编译文件，并直接占用
      var defaultTex = Gongfang._writeState.mainTexFile || (st.project && st.project.texFile) || '';
      if (defaultTex && Gongfang._collabInPath(defaultTex)) {
        var mn = String(defaultTex).split(/[\\/]/).pop();
        // ★ v2.6.12 修复启动残留：不再整体覆盖 openFiles（避免丢掉已恢复的标签页），
        //   只在「不存在」时追加，杜绝「两个同名卡片」；同时保证 activeFilePath 指向真实存在项。
        var exists = Gongfang._writeState.openFiles.some(function (f) { return Gongfang._collabNormKey(f.path) === Gongfang._collabNormKey(defaultTex); });
        if (!exists) Gongfang._writeState.openFiles.push({ path: defaultTex, name: mn });
        Gongfang._writeState.activeFilePath = defaultTex;
        Gongfang._writeState.activeFileName = mn;
        if (Gongfang._writeRenderTabs) Gongfang._writeRenderTabs();
        Gongfang._writeLoadFileContent(defaultTex);
        Gongfang._collabOccupyOnEnter(defaultTex);
      }
    }
  }
  Gongfang._collabShowToast('已进入协作 · 房间 ' + st.code + (st.role === 'host' ? ' · 你是 1 号主' : ' · 你是 ' + st.memberN + ' 号'));
};

// ★ 进入协作：把当前文件直接变成自己的编辑占用（锁空闲即申请锁；被他人占用则只读预览）
Gongfang._collabOccupyOnEnter = function (filePath) {
  var st = Gongfang._collabState;
  if (!st.active || !filePath) return;
  var targetKey = Gongfang._collabNormKey(filePath);
  // 释放自己占用但已切走的其它文件锁（保持"只占一个编辑位"）
  Object.keys(st.locks).forEach(function (k) {
    if (Gongfang._collabNormKey(k) === targetKey) return;
    var lk = st.locks[k];
    if (lk && Array.isArray(lk.owners)) {
      lk.owners = lk.owners.filter(function (o) { return o.ownerN !== st.memberN; });
      if (!lk.owners.length) delete st.locks[k];
    }
  });
  var lock = Gongfang._collabFindLock(filePath);
  var otherOwner = lock && lock.owners && lock.owners.length
    ? lock.owners.some(function (o) { return o.ownerN !== st.memberN; }) : false;
  if (otherOwner) {
    st._readonlyOverride = targetKey;
    st.lastLockedFile = null;
  } else {
    delete st._readonlyOverride;
    if (!Gongfang._collabLockHas(lock, st.memberN)) {
      // ★ 乐观占用：本地立即登记持锁，避免等服务器往返（lock-granted）才显示占用色块，
      //   造成"我已是 1 号主但当前文件却无占用色块"的观感。服务器授予/快照到达后幂等校正。
      var curOwners = (lock && Array.isArray(lock.owners)) ? lock.owners.slice() : [];
      if (!curOwners.some(function (o) { return o.ownerN === st.memberN; })) curOwners.push({ ownerN: st.memberN, owner: '我' });
      st.locks[targetKey] = { owners: curOwners };
      try { window.electronAPI.collabRequestLock(filePath); } catch (_) {}
    }
    st.lastLockedFile = filePath;
  }
  Gongfang._collabNotifyView(filePath);
  Gongfang._collabApplyEditorReadOnly();
  Gongfang._collabApplyTreeLocks();
};

Gongfang._collabRefresh = async function () {
  try {
    var s = await window.electronAPI.collabState();
    var st = Gongfang._collabState;
    if (!st.active) return;
    if (st.role === 'member' && s.client && s.client.active) {
      st.project = s.client.project; st.members = s.client.members || []; st.locks = s.client.locks || {};
      st.memberN = s.client.memberN; st.memberId = s.client.memberId; st.latency = s.client.latency || 0;
    } else if (st.role === 'host' && s.host && s.host.active) {
      st.project = s.host.project; st.members = s.host.members || []; st.locks = s.host.locks || {}; st.code = s.host.code;
    } else {
      // 会话已不存在
      Gongfang._collabClearSession('协作会话已结束');
    }
  } catch (_) {}
};

// ═══════════ 退出 / 清空 ═══════════
Gongfang._collabLeave = async function () {
  await window.electronAPI.collabLeave();
  Gongfang._collabClearSession('已退出协作');
};
Gongfang._collabClearSession = function (msg) {
  var st = Gongfang._collabState;
  var wasMember = st.role === 'member';
  var oldProj = st.project;
  st.active = false; st.role = ''; st.code = ''; st.project = null; st.memberN = 0; st.memberId = '';
  st.hostInfo = null; st.members = []; st.locks = {}; st.latency = 0; st.startedAt = 0;
  st.currentVote = null; st.pendingOpen = null; st.lastLockedFile = null;
  st.memberViews = {};
  delete st._readonlyOverride;
  Gongfang._collabClearRemoteCursor();
  Gongfang._collabEditLastSent = 0; Gongfang._collabEditPending = false;
  if (Gongfang._collabEditTimer) { clearTimeout(Gongfang._collabEditTimer); Gongfang._collabEditTimer = null; }
  // 成员离开：若当前项目正是协作项目，回到无项目状态（主机保留自己的项目）
  if (wasMember && oldProj && Gongfang._writeState.activeProject && Gongfang._writeState.activeProject.path === oldProj.path) {
    Gongfang._writeState.activeProject = null;
    if (Gongfang._writeClearEditor) Gongfang._writeClearEditor();
    if (Gongfang._writeRenderFileBrowser) Gongfang._writeRenderFileBrowser();
    // ★ 成员退出后同步清空大纲区，避免仍残留旧章节内容
    if (Gongfang._writeRenderOutlineTree) Gongfang._writeRenderOutlineTree();
  }
  Gongfang._collabSetSwitch('solo');
  // ★ 退出协作：恢复「新建」按钮（重新允许切换项目）
  if (Gongfang._writeSetNewTaskCollabDisabled) Gongfang._writeSetNewTaskCollabDisabled(false);
  Gongfang._collabRenderCapsules();
  Gongfang._collabApplyTreeLocks();
  Gongfang._collabApplyEditorReadOnly();
  // ★ 无论编辑器是否存在，退出都必须收起「协作按钮 + 预览状态气泡 + 分隔线」
  if (Gongfang._collabUpdateToolbar) Gongfang._collabUpdateToolbar();
  Gongfang._collabRenderStatusPane();
  if (msg) Gongfang._collabShowToast(msg);
};

// ═══════════ 右上角成员胶囊 ═══════════
Gongfang._collabRenderCapsules = function () {
  var box = document.getElementById('collabCapsules');
  var st = Gongfang._collabState;
  if (!box) return;
  // ★ 幂等：成员/状态未变化则跳过重建，避免每 3 秒清空重绘导致界面闪烁
  var sig = (st.active && st.members.length)
    ? st.members.map(function (m) {
        var _d = Gongfang._collabDescribeMember(m.n);
        return m.n + '|' + m.name + '|' + m.role + '|' + _d.mode + '|' + _d.file
          + '|' + (m.n === st.memberN ? (st.latency || '') : (m.latency || ''));
      }).join('§')
    : '';
  if (box._collabSig === sig) return;
  box._collabSig = sig;
  box.innerHTML = '';
  if (!st.active || !st.members.length) { box.style.display = 'none'; return; }
  st.members.forEach(function (m) {
    var d = Gongfang._collabDescribeMember(m.n);
    var editing = d.mode === 'editing';
    var viewing = d.mode === 'viewing';
    var file = d.file;
    var lat = m.n === st.memberN
      ? (st.latency ? st.latency + 'ms' : '—')
      : (m.n === 1 && st.role === 'host' ? '—' : (m.latency ? m.latency + 'ms' : '—'));
    var cap = document.createElement('div');
    // ★ 三态：编辑(呼吸动画)/查看(普通)/空闲(置灰)，用文字前缀「编辑/查看/空闲」区分
    cap.className = 'collab-cap' + (editing ? ' breath' : (viewing ? '' : ' idle')) + (m.n === st.memberN ? ' me' : '');
    cap.title = (m.role === '主' ? '[主] ' : '') + m.name + ' · '
      + (editing ? ('正在编辑 ' + file) : (viewing ? ('正在查看 ' + file) : '当前空闲'));
    var fileLine = editing ? ('编辑 ' + Gongfang._collabEsc(file))
      : (viewing ? ('查看 ' + Gongfang._collabEsc(file)) : '空闲');
    cap.innerHTML =
      '<span class="collab-cap-dot" style="background:' + Gongfang._collabColor(m.n) + '">' + m.n + '</span>'
      + '<span class="collab-cap-info">'
      + '<span class="collab-cap-top"><span class="collab-cap-name">' + Gongfang._collabEsc(m.name) + (m.role === '主' ? ' <span class="role">主</span>' : '') + '</span>'
      + (lat !== '—' ? '<span class="collab-cap-lat">' + Gongfang._collabEsc(lat) + '</span>' : '')
      + '</span>'
      + '<span class="collab-cap-file">' + fileLine + '</span>'
      + '</span>';
    box.appendChild(cap);
  });
  box.style.display = 'flex';
};

// ═══════════ 文件树占用标记 ═══════════
// ★ 三态：实心圆环=编辑者(占锁)，空心圆环+细字=只读查看者，两者可叠加
Gongfang._collabApplyTreeLocks = function () {
  var st = Gongfang._collabState;
  var items = document.querySelectorAll('#writeFilesTree .write-files-item');
  items.forEach(function (it) {
    var path = it.getAttribute('data-path');
    var lock = path && st.active ? Gongfang._collabFindLock(path) : undefined;
    var owners = (lock && Array.isArray(lock.owners)) ? lock.owners : [];
    var viewers = (path && st.active) ? Gongfang._collabFileViewers(path) : [];
    var ownerN = owners.length ? owners[0].ownerN : 0;
    // ★ 幂等：该文件锁集合未变化则跳过，避免每 3 秒 remove+append 标记导致闪烁
    var sig = owners.map(function (o) { return 'o' + o.ownerN; }).join(',')
      + '|' + viewers.join(',');
    if (it._collabLockSig === sig) return;
    it._collabLockSig = sig;
    it.classList.toggle('collab-locked', owners.length > 0);
    it.style.background = ownerN ? Gongfang._collabBg(ownerN) : '';
    var wrap = it.querySelector('.collab-file-owners');
    var circle = it.querySelector('.collab-file-owner');
    if (wrap) wrap.remove();
    if (circle) circle.remove();
    if (owners.length || viewers.length) {
      wrap = document.createElement('span');
      wrap.className = 'collab-file-owners';
      owners.forEach(function (o) {
        circle = document.createElement('span');
        circle.className = 'collab-file-owner';
        circle.style.background = Gongfang._collabColor(o.ownerN);
        circle.textContent = String(o.ownerN);
        circle.title = '成员' + o.ownerN + ' 正在编辑';
        wrap.appendChild(circle);
      });
      viewers.forEach(function (n) {
        circle = document.createElement('span');
        circle.className = 'collab-file-viewer';
        circle.style.borderColor = Gongfang._collabColor(n);
        circle.style.color = Gongfang._collabColor(n);
        circle.textContent = String(n);
        circle.title = '成员' + n + ' 正在查看';
        wrap.appendChild(circle);
      });
      it.appendChild(wrap);
    }
  });
  Gongfang._collabApplyDisabledState();
};
// ★ 协同编辑：不再因他人占用而禁点，文件树/标签卡始终可点开编辑
Gongfang._collabApplyDisabledState = function () {
  document.querySelectorAll('#writeFilesTree .write-files-item, #writeTabs .write-tab').forEach(function (it) {
    it.classList.remove('collab-disabled');
  });
};

// ═══════════ 编辑器只读状态 ═══════════
// ★ v2.6.11 单编辑者 + 他人只读：只有当前持锁人可编辑；他人打开即只读（可实时看编辑流与远端光标）
// ★ 顶栏状态徽标：绿色="编辑模式"，橙色="预览模式"；进入只读瞬间 toast 提示一次
Gongfang._collabApplyEditorReadOnly = function () {
  var st = Gongfang._collabState;
  // ★ 协作按钮 + 状态气泡的显示/隐藏不依赖编辑器是否存在：
  //   用户把文件全删、标签全关后编辑器为 null，若提前 return，退出时按钮/气泡会残留。
  if (Gongfang._collabUpdateToolbar) Gongfang._collabUpdateToolbar();
  var ed = Gongfang._writeState && Gongfang._writeState.editor;
  if (!ed) return;
  var fp = Gongfang._writeState.activeFilePath;
  var readonly = Gongfang._collabIsReadonly(fp);
  try { ed.setOption('readOnly', readonly ? 'nocursor' : false); } catch (_) {}
  // ★ 预览模式下敲键盘 → 自动尝试接管编辑权（锁空闲即接管成功；被占用则提示并保持预览）
  Gongfang._collabBindTakeoverKeys(ed, readonly && st.active);
  // 进入只读的瞬间提示一次（避免每次刷新都弹）
  if (st.active && readonly) {
    if (st._lastEditorReadonly !== true) {
      st._lastEditorReadonly = true;
      Gongfang._collabShowToast('该文件正被其他成员编辑，你已切换为【预览模式】（敲键盘可尝试接管）');
    }
  } else {
    st._lastEditorReadonly = false;
  }
};
// ★ 预览模式键盘接管：readOnly='nocursor' 时 CodeMirror 不响应按键，
//   在编辑器 DOM 上监听 keydown：锁空闲 → 申请锁自动转编辑；被占用 → toast 说明
Gongfang._collabBindTakeoverKeys = function (ed, readonly) {
  var wrap = ed && ed.getWrapperElement ? ed.getWrapperElement() : null;
  if (!wrap) return;
  if (readonly && !wrap._collabTakeoverBound) {
    wrap._collabTakeoverBound = true;
    wrap.addEventListener('keydown', function (e) {
      // 忽略纯功能键，其余任意输入键都视为"想编辑"
      if (e.ctrlKey || e.metaKey || e.altKey || ['F5', 'F12', 'Escape', 'Tab'].indexOf(e.key) >= 0) return;
      Gongfang._collabTryTakeover();
    });
  }
  if (!readonly && wrap._collabTakeoverBound) {
    // 转为可编辑后移除标记，避免多余触发（监听器内会再判只读状态）
    wrap._collabTakeoverBound = false;
  }
};
Gongfang._collabTryTakeover = function () {
  var st = Gongfang._collabState;
  var fp = Gongfang._writeState.activeFilePath;
  if (!st.active || !fp || !Gongfang._collabInPath(fp)) return;
  if (!Gongfang._collabIsReadonly(fp)) return;   // 已是编辑态 → 无需接管（keydown 常驻监听的兜底）
  var lock = Gongfang._collabFindLock(fp);
  // 我已持锁（override 是陈旧状态）→ 直接解除只读
  if (Gongfang._collabLockHas(lock, st.memberN)) {
    delete st._readonlyOverride;
    st.lastLockedFile = fp;
    Gongfang._collabApplyEditorReadOnly();
    Gongfang._collabApplyTreeLocks();
    return;
  }
  var other = lock && lock.owners && lock.owners.some(function (o) { return o.ownerN !== st.memberN; });
  if (other) {
    var nm = lock.owners[0].owner || ('成员' + lock.owners[0].ownerN);
    Gongfang._collabShowToast('正在被 ' + nm + ' 编辑，保持预览模式；对方释放后自动转为编辑');
    return;
  }
  // 锁空闲 → 申请接管（lock-granted 事件会解除只读并聚焦编辑器）
  Gongfang._collabShowToast('正在切换为编辑模式…');
  try { window.electronAPI.collabRequestLock(fp); } catch (_) {}
};

// ═══════════ 工具栏「协作菜单」按钮 + 状态气泡 + 下拉菜单 ═══════════
// 仅协作模式开启时显示；状态气泡反映当前激活文件：编辑模式 / 预览模式。
Gongfang._collabUpdateToolbar = function () {
  var st = Gongfang._collabState;
  var wrap = document.getElementById('writeCollabMenuWrap');
  if (!wrap) return;
  wrap.style.display = st.active ? '' : 'none';
  // ★ 协作区与「保存/终止/编译」按钮组之间的分隔竖线：仅协作模式显示
  var sep = document.getElementById('writeCollabSep');
  if (sep) sep.style.display = st.active ? '' : 'none';
  if (!st.active) return;
  // 状态气泡（位于协作菜单按钮左侧）
  var fp = Gongfang._writeState.activeFilePath;
  var bubble = document.getElementById('writeCollabStatusBubble');
  if (bubble) {
    var readonly = Gongfang._collabIsReadonly(fp);
    bubble.textContent = readonly ? '预览模式' : '编辑模式';
    bubble.classList.toggle('edit', !readonly);
    bubble.classList.toggle('ro', readonly);
  }
  // 下拉内容：绑定拖放区（一次）+ 渲染「我的信息」+ 共享文件列表
  Gongfang._collabBindDropZone();
  Gongfang._collabRenderDropdownInfo();
  if (Gongfang._collabRenderDropdownFiles) Gongfang._collabRenderDropdownFiles();
};
// 打开编译设置菜单并切到「协作模式」面板（工具栏「协作设置」下拉项调用）
Gongfang._collabOpenSettingsPane = function () {
  var menu = document.getElementById('writeCompileSettingsMenu');
  if (!menu) return;
  if (!menu.style.display || menu.style.display === 'none') Gongfang._writeToggleCompileSettings();
  document.querySelectorAll('.write-settings-nav-item').forEach(function (x) {
    x.classList.toggle('active', x.getAttribute('data-pane') === 'collab');
  });
  document.querySelectorAll('.ws-detail-section').forEach(function (s) {
    s.classList.toggle('active', s.getAttribute('data-pane') === 'collab');
  });
  Gongfang._collabRenderStatusPane();
  if (Gongfang._collabRefreshWifi) Gongfang._collabRefreshWifi();
};

// ═══════════ 设置：左侧导航 + 右侧内容 ═══════════
Gongfang._collabSettingsNav = function (el, pane) {
  if (pane === 'collab') {
    Gongfang._collabRenderStatusPane();
    document.querySelectorAll('.write-settings-nav-item').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-pane') === pane); });
    document.querySelectorAll('.ws-detail-section').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-pane') === pane); });
    return;
  }
  document.querySelectorAll('.write-settings-nav-item').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-pane') === pane); });
  document.querySelectorAll('.ws-detail-section').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-pane') === pane); });
  if (pane === 'theme') Gongfang._collabRenderThemeCards();
};

// ═══════════ 协作模式完整面板 ═══════════
Gongfang._collabRefreshWifi = async function () {
  try {
    var w = await window.electronAPI.collabWifiInfo();
    if (w && w.success) Gongfang._collabState.wifi = { ssid: w.ssid, networks: w.networks || [], ip: w.ip };
  } catch (_) {}
  Gongfang._collabRenderStatusPane();
};
Gongfang._collabRenderStatusPane = function () {
  var el = document.getElementById('writeSettingsCollabPane');
  if (!el) return;
  var st = Gongfang._collabState;
  var wifi = st.wifi || {};
  // ★ 网络连接：WiFi 名 + IP 气泡 + 复制气泡按钮 + 刷新气泡按钮（自动连电脑当前局域网）
  var netBlock =
    '<div class="ws-collab-block">'
    + '<div class="ws-collab-block-title">' + Gongfang._collabIcon('wifi') + '网络连接</div>'
    + '<div class="ws-net-row">'
    + '<span class="ws-net-chip"><span class="dot"></span>' + Gongfang._collabEsc(wifi.ssid || '未连接 WiFi') + '</span>'
    + '<span class="ws-ip-bubble" title="本机局域网 IP">' + Gongfang._collabEsc(wifi.ip || '···') + '</span>'
    + '<button class="ws-bubble-btn" title="复制 IP" onclick="Gongfang._collabCopyIp()">' + Gongfang._collabIcon('copy') + '</button>'
    + '<button class="ws-bubble-btn" title="刷新 IP" onclick="Gongfang._collabRefreshWifi()">' + Gongfang._collabIcon('refresh') + '</button>'
    + '</div>'
    + '</div>';

  if (!st.active) {
    // ★ 单人模式：仅显示「网络连接」，不提供建房/加入入口
    el.innerHTML = netBlock;
    return;
  }

  // ★ 房间成员：每人一行（彩色编号 + 名字 + 身份标记 + 状态 + 延迟 + 房主踢人按钮）
  var isHost = st.role === 'host';
  var memberLines = (st.members || []).map(function (m) {
    var d = Gongfang._collabDescribeMember(m.n);
    var lat = m.n === st.memberN
      ? (st.latency ? st.latency + 'ms' : '—')
      : (m.n === 1 && isHost ? '—' : (m.latency ? m.latency + 'ms' : '—'));
    var state = d.mode === 'editing' ? '编辑中 ' + Gongfang._collabEsc(d.file)
      : (d.mode === 'viewing' ? '查看 ' + Gongfang._collabEsc(d.file) : '空闲');
    var roleTag = m.role === '主' ? '<span class="tag tag-host">主</span>' : '';
    var meTag = m.n === st.memberN ? '<span class="tag">我</span>' : '';
    var kick = (isHost && m.n !== 1 && m.n !== st.memberN)
      ? '<button class="ws-kick-btn" title="踢出房间" onclick="Gongfang._collabKickMember(' + m.n + ')">' + Gongfang._collabIcon('x') + '</button>'
      : '';
    return '<div class="ws-member-row">'
      + '<span class="collab-cap-dot" style="background:' + Gongfang._collabColor(m.n) + '">' + m.n + '</span>'
      + '<span class="ws-member-name">' + Gongfang._collabEsc(m.name) + roleTag + meTag + '</span>'
      + '<span class="ws-member-file">' + Gongfang._collabEsc(state) + '</span>'
      + '<span class="ws-member-lat' + (lat === '—' ? ' off' : '') + '">' + Gongfang._collabEsc(lat) + '</span>'
      + kick
      + '</div>';
  }).join('');
  if (!memberLines) memberLines = '<div class="ws-info-row"><span class="ws-status-pill on">1 号主</span><span style="color:#a1a1aa">房间已就绪，等待成员加入…</span></div>';
  var memberBlock =
    '<div class="ws-collab-block">'
    + '<div class="ws-collab-block-title">' + Gongfang._collabIcon('users') + '房间成员</div>'
    + memberLines
    + '</div>';

  // ★ 操作：退出房间气泡按钮 + 房间号气泡 + 复制协作码（镜像「网络连接」行的气泡样式）
  //   退出房间放在协作码前面；已按用户要求移除「换码/刷新」按钮
  var actionBlock =
    '<div class="ws-collab-block">'
    + '<div class="ws-collab-block-title">' + Gongfang._collabIcon('ops') + '操作</div>'
    + '<div class="ws-net-row">'
    + '<button class="ws-bubble-btn" title="退出协作房间" onclick="Gongfang._collabLeave()">' + Gongfang._collabIcon('exit') + '</button>'
    + '<span class="ws-ip-bubble" title="当前房间号" style="font-size:14px;letter-spacing:3px;">' + Gongfang._collabEsc(st.code || '······') + '</span>'
    + '<button class="ws-bubble-btn" title="复制协作码" onclick="Gongfang._collabCopyCode()">' + Gongfang._collabIcon('copy') + '</button>'
    + '</div>'
    + '</div>';

  el.innerHTML = netBlock + memberBlock + actionBlock;
};
Gongfang._collabIcon = function (name) {
  var icons = {
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    ops: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  };
  return icons[name] || '';
};
Gongfang._collabPaneCreate = async function () {
  var st = Gongfang._collabState;
  if (st.active) { Gongfang._collabShowToast('已在协作中'); return; }
  var proj = Gongfang._writeState.activeProject;
  if (!proj) { Gongfang._collabShowToast('请先打开一个项目'); return; }
  var name = await Gongfang._collabMyName();
  var r = await window.electronAPI.collabHostStart({
    projectName: proj.name, projectPath: proj.path,
    texFile: Gongfang._writeState.mainTexFile || proj.texFile || '',
    compileEngine: Gongfang._writeState.compileEngine || 'xelatex', name: name,
  });
  if (!r || !r.success) { Gongfang._collabShowToast((r && r.error) || '创建失败'); return; }
  st.active = true; st.role = 'host'; st.code = r.code; st.project = proj; st.memberN = 1; st.startedAt = Date.now();
  Gongfang._collabSetSwitch('collab');
  if (Gongfang._writeSetNewTaskCollabDisabled) Gongfang._writeSetNewTaskCollabDisabled(true);
  await Gongfang._collabRefresh();
  // ★ 统一走 _collabEnterView：渲染文件树/标签、占用当前打开的文件、展示状态胶囊
  Gongfang._collabEnterView();
};
Gongfang._collabPaneJoin = async function () {
  var st = Gongfang._collabState;
  if (st.active) { Gongfang._collabShowToast('已在协作中'); return; }
  var hp = parseHost((document.getElementById('paneHostInput') && document.getElementById('paneHostInput').value || '').trim());
  if (!hp) { Gongfang._collabShowToast('请输入主机 IP:端口'); return; }
  var code = (document.getElementById('paneJoinInput') && document.getElementById('paneJoinInput').value || '').trim();
  if (code.length !== 6) { Gongfang._collabShowToast('请输入 6 位协作码'); return; }
  var name = await Gongfang._collabMyName();
  var r = await window.electronAPI.collabJoin({ host: hp.ip, port: hp.port, code: code, name: name });
  if (!r || !r.success) { Gongfang._collabShowToast((r && r.error) || '加入失败'); return; }
  st.active = true; st.role = 'member'; st.memberN = r.memberN; st.hostInfo = hp; st.code = code; st.startedAt = Date.now();
  Gongfang._collabSetSwitch('collab');
  if (Gongfang._writeSetNewTaskCollabDisabled) Gongfang._writeSetNewTaskCollabDisabled(true);
  await Gongfang._collabRefresh();
  // ★ 与建房一致：统一走 _collabEnterView，占用当前打开的文件、渲染文件树/标签/状态胶囊
  Gongfang._collabEnterView();
};
// 上传本地文件到「共享文件区」：写入本机副本 + 同步主机 + 广播全队（保证编译能引用到）
// 点击「拖放区」触发：弹系统文件选择框
// ★ 图片共享文件区：常见图片扩展名（与后端 src/ipc/collab.js 的 SHARED_IMAGE_EXTS 保持一致）
Gongfang._collabImageRe = /\.(png|jpg|jpeg|gif|bmp|webp|svg|tif|tiff)$/i;
// 判断某文件是否为允许上传/展示的图片
Gongfang._collabIsImage = function (name) { return Gongfang._collabImageRe.test(String(name || '')); };
// 上传本地图片到「图片共享文件区」：写入本机副本 + 同步主机 + 广播全队（保证编译能引用到）
// 点击「拖放区」触发：弹系统文件选择框
Gongfang._collabUploadShared = async function () {
  try {
    if (Gongfang._collabBlockedByPreview()) return;
    // ★ v2.6.12 修复上传按钮无效：open-file-dialog 返回的是裸数组 result.filePaths（[] 为空），
    //   此前按 {canceled,filePaths} 读导致永远提前 return。改成按数组读取。
    var paths = await window.electronAPI.openFileDialog({
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (!paths || !paths.length) return;
    var fp = paths[0];
    await Gongfang._collabUploadPath(fp, String(fp).split(/[\\/]/).pop());
  } catch (e) { Gongfang._collabShowToast('上传失败'); }
};
// 按实际文件路径上传（拖入或选择共用），成功后刷新下拉文件列表
Gongfang._collabUploadPath = async function (fp, name) {
  try {
    if (Gongfang._collabBlockedByPreview()) return;
    if (!Gongfang._collabIsImage(fp)) { Gongfang._collabShowToast('仅支持图片文件（png/jpg/jpeg/gif/bmp/webp/svg/tif/tiff）'); return; }
    Gongfang._collabShowToast('正在上传到图片共享文件区…');
    var up = await window.electronAPI.collabUploadShared(fp, name);
    if (up && up.success) {
      Gongfang._collabShowToast('已上传到图片共享文件区：' + up.name);
      Gongfang._collabRefresh();
      Gongfang._collabRenderDropdownFiles();
    } else {
      Gongfang._collabShowToast((up && up.error) || '上传失败');
    }
  } catch (e) { Gongfang._collabShowToast('上传失败'); }
};

// ═══════════ 协作下拉：拖放区 / 共享文件列表 / 我的信息 ═══════════
// 绑定拖放区拖动事件（仅一次）：拖入本地文件即上传到共享文件区
Gongfang._collabBindDropZone = function () {
  var zone = document.getElementById('collabDropZone');
  if (!zone || zone._bound) return;
  zone._bound = true;
  zone.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragenter', function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('over');
    if (Gongfang._collabBlockedByPreview()) return;
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    Array.prototype.forEach.call(files, function (f) {
      // ★ v2.6.12 修复拖拽无效：Electron 33 已移除 File.path，需用 webUtils.getPathForFile
      //   获取真实路径（preload 已暴露 window.electronAPI.getFilePath）。
      var p = window.electronAPI.getFilePath(f);
      if (!p) return;
      var nm = String(p).split(/[\\/]/).pop();
      // ★ 图片共享文件区：仅接受图片文件，非图片提示并忽略
      if (!Gongfang._collabIsImage(nm)) { Gongfang._collabShowToast('仅支持图片文件（png/jpg/jpeg/gif/bmp/webp/svg/tif/tiff）'); return; }
      Gongfang._collabUploadPath(p, nm);
    });
  });
};
// 图片共享文件区的相对路径（跨设备统一）：以项目内「共享文件区/<文件名>」作为插入路径
Gongfang._collabSharedRel = function (name) {
  return '共享文件区/' + String(name || '').split(/[\\/]/).pop();
};
// 渲染下拉「共享文件」卡片：卡片式（一行两个，最多同时显示 6 个，可上下滚动）
// ★ 图片共享文件区：缩略图 + 名称 + 大小 + 删除按钮；点击放大；拖拽以「相对路径」插入编辑器
Gongfang._collabSharedCard = function (f, dir) {
  var full = (dir ? String(dir).replace(/[\\/]+$/, '') + '/' : '') + f.name;
  var rel = Gongfang._collabSharedRel(f.name);
  var size = f.isDir ? '' : Gongfang._collabFmtSize(f.size);
  var thumb = f.isDir
    ? '<span class="collab-shared-card-folder">' + Gongfang._collabIcon('folder') + '</span>'
    : '<img src="' + Gongfang._collabFileUrl(full) + '" alt="">';
  var enabled = f.isDir ? '' : ' draggable="true"';
  var onEvt = f.isDir ? '' : (' onclick="Gongfang._collabPreviewShared(this.dataset.src)"'
    + ' ondragstart="Gongfang._collabDragShared(event,this.dataset.path)"'
    + ' ondragend="Gongfang._collabDragEnd(event)"');
  var del = f.isDir ? '' : '<button class="collab-shared-del" title="删除" data-name="' + Gongfang._collabEsc(f.name) + '" onclick="event.stopPropagation();Gongfang._collabDeleteShared(this.dataset.name)">'
    + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>'
    + '</button>';
  return '<div class="collab-shared-card"' + enabled + ' data-src="' + Gongfang._collabEsc(full) + '" data-path="' + Gongfang._collabEsc(rel) + '" data-name="' + Gongfang._collabEsc(f.name) + '"' + onEvt + '>'
    + '<div class="collab-shared-card-thumb">' + thumb + '</div>'
    + '<div class="collab-shared-card-meta">'
    + '<span class="collab-shared-card-name" title="' + Gongfang._collabEsc(f.name) + '">' + Gongfang._collabEsc(f.name) + '</span>'
    + (size ? '<span class="collab-shared-card-size">' + size + '</span>' : '')
    + '</div>'
    + del
    + '</div>';
};
Gongfang._collabRenderDropdownFiles = async function () {
  var el = document.getElementById('writeCollabDropdownFiles');
  if (!el) return;
  // ★ 记录当前滚动位置，重建后恢复，避免被拉回顶部
  var _oldGrid = el.querySelector('.collab-shared-grid');
  if (_oldGrid) Gongfang._collabDropdownScroll = _oldGrid.scrollTop;
  el.innerHTML = '<div class="collab-dropdown-empty">读取中…</div>';
  try {
    var r = await window.electronAPI.collabListShared();
    if (r && r.success) {
      var dir = r.dir || '';
      var files = (r.files || []).filter(function (f) { return f.isDir || Gongfang._collabIsImage(f.name); });
      if (!files.length) { el.innerHTML = '<div class="collab-dropdown-empty">暂无共享图片</div>'; return; }
      el.innerHTML = '<div class="collab-shared-grid">' + files.map(function (f) { return Gongfang._collabSharedCard(f, dir); }).join('') + '</div>';
      var _newGrid = el.querySelector('.collab-shared-grid');
      if (_newGrid && Gongfang._collabDropdownScroll) _newGrid.scrollTop = Gongfang._collabDropdownScroll;
      Gongfang._collabBindEditorImageDrop();
    } else {
      el.innerHTML = '<div class="collab-dropdown-empty">' + Gongfang._collabEsc((r && r.error) || '读取失败') + '</div>';
    }
  } catch (e) { el.innerHTML = '<div class="collab-dropdown-empty">读取失败</div>'; }
};
// 渲染下拉「我的信息」：名字 / 身份 / 延迟 / 协作码
Gongfang._collabRenderDropdownInfo = function () {
  var el = document.getElementById('writeCollabDropdownInfo');
  if (!el) return;
  var st = Gongfang._collabState;
  var me = null;
  (st.members || []).forEach(function (m) { if (m.n === st.memberN) me = m; });
  var name = (me && me.name) || st.memberName || '我';
  var lat = st.role === 'host' ? (st.latency ? st.latency + 'ms' : '—')
    : (st.latency ? st.latency + 'ms' : ((me && me.latency) ? me.latency + 'ms' : '—'));
  var role = st.role === 'host' ? '房主' : '成员';
  el.innerHTML =
    '<div class="collab-info-row"><span class="collab-info-label">名字</span><span class="collab-info-val">' + Gongfang._collabEsc(name) + '</span></div>'
    + '<div class="collab-info-row"><span class="collab-info-label">身份</span><span class="collab-info-val">' + role + '</span></div>'
    + '<div class="collab-info-row"><span class="collab-info-label">延迟</span><span class="collab-info-val">' + Gongfang._collabEsc(lat) + '</span></div>'
    + '<div class="collab-info-row"><span class="collab-info-label">协作码</span><span class="collab-info-val">' + Gongfang._collabEsc(st.code || '······') + '</span></div>';
};
Gongfang._collabPaneRegen = async function () {
  var proj = Gongfang._writeState.activeProject;
  if (!proj) { Gongfang._collabShowToast('无项目'); return; }
  var name = await Gongfang._collabMyName();
  await window.electronAPI.collabHostStop();
  var r = await window.electronAPI.collabHostStart({
    projectName: proj.name, projectPath: proj.path,
    texFile: Gongfang._writeState.mainTexFile || proj.texFile || '',
    compileEngine: Gongfang._writeState.compileEngine || 'xelatex', name: name,
  });
  if (r && r.success) { Gongfang._collabState.code = r.code; Gongfang._collabRenderStatusPane(); Gongfang._collabShowToast('协作码已更换：' + r.code); }
  else Gongfang._collabShowToast((r && r.error) || '换码失败');
};

// ═══════════ 设置面板 · 网络/成员/操作 交互 ═══════════
// 复制当前 IP 到剪贴板
Gongfang._collabCopyIp = function () {
  var ip = Gongfang._collabState.wifi && Gongfang._collabState.wifi.ip;
  if (!ip) { Gongfang._collabShowToast('暂无 IP 可复制'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ip).then(function () { Gongfang._collabShowToast('已复制 IP：' + ip); })
        .catch(function () { Gongfang._collabShowToast('复制失败'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = ip; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      Gongfang._collabShowToast('已复制 IP：' + ip);
    }
  } catch (e) { Gongfang._collabShowToast('复制失败'); }
};
// 复制当前协作码到剪贴板
Gongfang._collabCopyCode = function () {
  var code = Gongfang._collabState.code;
  if (!code) { Gongfang._collabShowToast('暂无协作码'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { Gongfang._collabShowToast('已复制协作码：' + code); })
        .catch(function () { Gongfang._collabShowToast('复制失败'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      Gongfang._collabShowToast('已复制协作码：' + code);
    }
  } catch (e) { Gongfang._collabShowToast('复制失败'); }
};
// 房主踢出成员（按序号 n）
Gongfang._collabKickMember = async function (n) {
  var r = await window.electronAPI.collabKickMember(n);
  if (r && r.success) {
    Gongfang._collabShowToast('已踢出成员 ' + n + ' 号');
    await Gongfang._collabRefresh();
    Gongfang._collabRenderCapsules();
    Gongfang._collabApplyTreeLocks();
    Gongfang._collabRenderStatusPane();
  } else {
    Gongfang._collabShowToast((r && r.error) || '踢出失败');
  }
};
// 字节数格式化
Gongfang._collabFmtSize = function (b) {
  b = Number(b || 0);
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
};
// 展开 / 收起「查看协作文件夹」：点开调用 IPC 列出共享目录内容
Gongfang._collabToggleShared = async function () {
  var body = document.getElementById('wsSharedBody');
  if (!body) return;
  if (body.style.display === 'none' || !body.style.display) {
    body.style.display = 'block';
    body.innerHTML = '<div class="ws-shared-empty">读取中…</div>';
    try {
      var r = await window.electronAPI.collabListShared();
      if (r && r.success) {
        var dir = r.dir || '';
        var files = (r.files || []).filter(function (f) { return f.isDir || Gongfang._collabIsImage(f.name); });
        if (!files.length) body.innerHTML = '<div class="ws-shared-empty">图片共享文件区为空</div>';
        else {
          body.innerHTML = '<div class="collab-shared-grid">' + files.map(function (f) { return Gongfang._collabSharedCard(f, dir); }).join('') + '</div>';
          Gongfang._collabBindEditorImageDrop();
        }
      } else {
        body.innerHTML = '<div class="ws-shared-empty">' + Gongfang._collabEsc((r && r.error) || '读取失败') + '</div>';
      }
    } catch (e) { body.innerHTML = '<div class="ws-shared-empty">读取失败</div>'; }
  } else {
    body.style.display = 'none';
  }
};

// ═══════════ 图片共享文件区 · 预览/删除/拖拽插入 ═══════════
// 本地路径 → file:// URL（缩略图/预览用）
Gongfang._collabFileUrl = function (p) { return 'file:///' + String(p).replace(/\\/g, '/'); };
// 双击预览：弹出近似方形窗口（比编辑区界面稍小），显示原图
Gongfang._collabPreviewShared = function (path) {
  if (!path) return;
  var name = String(path).split(/[\\/]/).pop();
  var ov = document.createElement('div');
  ov.className = 'collab-img-overlay';
  ov.innerHTML =
    '<div class="collab-img-box">'
    + '<div class="collab-img-title">' + Gongfang._collabEsc(name) + '</div>'
    + '<div class="collab-img-frame"><img src="' + Gongfang._collabFileUrl(path) + '" alt=""></div>'
    + '<button class="collab-img-close" title="关闭">×</button>'
    + '</div>';
  var close = function () { ov.remove(); document.removeEventListener('keydown', esc); };
  var esc = function (e) { if (e.key === 'Escape') close(); };
  ov.querySelector('.collab-img-close').onclick = function () { close(); };
  ov.onclick = function (e) { if (e.target === ov) close(); };
  document.addEventListener('keydown', esc);
  document.body.appendChild(ov);
};
// 删除共享图片：调用 IPC（成员删除 → 主机权威盘删 + 全队广播 file-deleted，各端刷新镜像）
Gongfang._collabDeleteShared = async function (name) {
  if (!name) return;
  if (Gongfang._collabBlockedByPreview()) return;
  if (typeof Gongfang._showConfirm !== 'function') return;
  // ★ 复用项目已有样式化二级确认弹窗（不用系统 window.confirm）
  var ok = await Gongfang._showConfirm({
    title: '删除图片',
    desc: '确定要删除图片「' + name + '」吗？此操作所有成员可见。',
    type: 'danger',
    confirmText: '删除',
    confirmClass: 'modal-btn-danger'
  });
  if (!ok) return;
  try {
    var r = await window.electronAPI.collabDeleteShared(name);
    if (r && r.success) {
      Gongfang._collabShowToast('已删除图片：' + name);
      Gongfang._collabRefresh();
      Gongfang._collabRenderDropdownFiles();
      Gongfang._collabRefreshSharedBody();
    } else {
      Gongfang._collabShowToast((r && r.error) || '删除失败');
    }
  } catch (e) { Gongfang._collabShowToast('删除失败'); }
};
// 重新渲染「查看协作文件夹」内容（若当前展开则刷新，收起则不动）
Gongfang._collabRefreshSharedBody = async function () {
  var body = document.getElementById('wsSharedBody');
  if (!body || body.style.display === 'none' || !body.style.display) return;
  // ★ 记录当前滚动位置，重建后恢复，避免被拉回顶部
  var _oldGrid = body.querySelector('.collab-shared-grid');
  if (_oldGrid) Gongfang._collabSharedScroll = _oldGrid.scrollTop;
  try {
    var r = await window.electronAPI.collabListShared();
    if (r && r.success) {
      var dir = r.dir || '';
      var files = (r.files || []).filter(function (f) { return f.isDir || Gongfang._collabIsImage(f.name); });
      if (!files.length) body.innerHTML = '<div class="ws-shared-empty">图片共享文件区为空</div>';
      else {
        body.innerHTML = '<div class="collab-shared-grid">' + files.map(function (f) { return Gongfang._collabSharedCard(f, dir); }).join('') + '</div>';
        var _newGrid = body.querySelector('.collab-shared-grid');
        if (_newGrid && Gongfang._collabSharedScroll) _newGrid.scrollTop = Gongfang._collabSharedScroll;
        Gongfang._collabBindEditorImageDrop();
      }
    } else {
      body.innerHTML = '<div class="ws-shared-empty">' + Gongfang._collabEsc((r && r.error) || '读取失败') + '</div>';
    }
  } catch (e) { body.innerHTML = '<div class="ws-shared-empty">读取失败</div>'; }
};
// 拖拽共享图片：仅写入自定义 MIME，避免被编辑器当作纯文本插入
Gongfang._collabDragShared = function (ev, path) {
  try { ev.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
  try { ev.dataTransfer.setData('application/x-gongfang-image', String(path || '')); } catch (_) {}
  if (ev.target && ev.target.classList) ev.target.classList.add('dragging');
};
Gongfang._collabDragEnd = function (ev) {
  if (ev.target && ev.target.classList) ev.target.classList.remove('dragging');
};
// 绑定编辑器可接收图片拖入：命中自定义 MIME 时插入完整 figure 环境
Gongfang._collabBindEditorImageDrop = function () {
  try {
    var ed = Gongfang._writeState && Gongfang._writeState.editor;
    if (!ed || !ed.getWrapperElement) return;
    var wrap = ed.getWrapperElement();
    if (!wrap || wrap._gongfangImgDropBound) return;
    wrap._gongfangImgDropBound = true;
    wrap.addEventListener('dragover', function (e) {
      var isImg = false;
      try { var t = e.dataTransfer && e.dataTransfer.types; if (t && Array.prototype.indexOf.call(t, 'application/x-gongfang-image') >= 0) isImg = true; } catch (_) {}
      if (isImg) { e.preventDefault(); e.stopPropagation(); try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {} }
    });
    wrap.addEventListener('drop', function (e) {
      var isImg = false;
      try { var t = e.dataTransfer && e.dataTransfer.types; if (t && Array.prototype.indexOf.call(t, 'application/x-gongfang-image') >= 0) isImg = true; } catch (_) {}
      if (!isImg) return;
      e.preventDefault(); e.stopPropagation();
      if (Gongfang._collabBlockedByPreview()) return;
      var p = '';
      try { p = e.dataTransfer.getData('application/x-gongfang-image'); } catch (_) {}
      if (p && Gongfang._collabIsImage(p) && Gongfang._writeInsertImageFromPath) Gongfang._writeInsertImageFromPath(p);
    });
  } catch (_) {}
};

// ═══════════ 代码主题卡片 ═══════════
Gongfang._collabThemes = [
  { key: 'color', label: '彩色标准' }, { key: 'mono', label: '黑白简洁' },
  { key: 'large', label: '大字号易读' }, { key: 'serif', label: '论文衬线体' },
  { key: 'compact', label: '紧凑小字' }, { key: 'minimal', label: '极简无框' },
  { key: 'shadow', label: '阴影装饰框' }, { key: 'dark', label: '夜间暗色' },
  { key: 'noline', label: '无行号清爽' },
];
Gongfang._collabThemeStyle = function (key) {
  var s = { font: "'Consolas',monospace", size: '11px', bg: '#ffffff', fg: '#1f2937', kw: '#1d4ed8', cm: '#16a34a', frame: '1px solid #d1d5db', ln: true };
  switch (key) {
    case 'mono': s = { font: "'Consolas',monospace", size: '11px', bg: '#ffffff', fg: '#111827', kw: '#111827', cm: '#6b7280', frame: '1px solid #d1d5db', ln: true }; break;
    case 'large': s = { font: "'Consolas',monospace", size: '14px', bg: '#ffffff', fg: '#1f2937', kw: '#1d4ed8', cm: '#16a34a', frame: '1px solid #d1d5db', ln: true }; break;
    case 'serif': s = { font: 'Georgia,"Songti SC",serif', size: '11px', bg: '#ffffff', fg: '#111827', kw: '#111827', cm: '#6b7280', frame: '1px solid #d1d5db', ln: true }; break;
    case 'compact': s = { font: "'Consolas',monospace", size: '9px', bg: '#ffffff', fg: '#1f2937', kw: '#1d4ed8', cm: '#16a34a', frame: '1px solid #d1d5db', ln: true }; break;
    case 'minimal': s = { font: 'sans-serif', size: '11px', bg: '#ffffff', fg: '#111827', kw: '#111827', cm: '#9ca3af', frame: 'none', ln: false }; break;
    case 'shadow': s = { font: "'Consolas',monospace", size: '11px', bg: '#ffffff', fg: '#1f2937', kw: '#1d4ed8', cm: '#16a34a', frame: 'none', shadow: '0 3px 10px rgba(0,0,0,.18)', ln: true }; break;
    case 'dark': s = { font: "'Consolas',monospace", size: '11px', bg: '#1f2937', fg: '#e5e7eb', kw: '#67e8f9', cm: '#9ca3af', frame: '1px solid #374151', ln: true }; break;
    case 'noline': s = { font: "'Consolas',monospace", size: '11px', bg: '#ffffff', fg: '#1f2937', kw: '#1d4ed8', cm: '#16a34a', frame: '1px solid #d1d5db', ln: false }; break;
  }
  return s;
};
Gongfang._collabRenderThemeCards = function () {
  var grid = document.getElementById('writeSettingsCodeFrameList');
  if (!grid) return;
  var cur = (Gongfang._writeState && Gongfang._writeState.codeTheme) || 'color';
  grid.innerHTML = '';
  grid.className = 'ws-theme-grid';
  Gongfang._collabThemes.forEach(function (t) {
    var st = Gongfang._collabThemeStyle(t.key);
    var card = document.createElement('div');
    card.className = 'ws-theme-card' + (cur === t.key ? ' active' : '');
    card.title = '点击切换为「' + t.label + '」';
    card.onclick = function () {
      Gongfang._writeSetCodeTheme(t.key);
      Gongfang._collabRenderThemeCards();
    };
    var ln = function (n) { return st.ln ? '<span class="ws-theme-ln">' + n + '</span>' : ''; };
    var shadow = st.shadow ? ';box-shadow:' + st.shadow : '';
    card.innerHTML =
      '<div class="ws-theme-preview" style="background:' + st.bg + ';border:' + (st.frame === 'none' ? 'none' : st.frame) + shadow + '">'
      + '<div class="ws-theme-code" style="font-family:' + st.font + ';font-size:' + st.size + ';color:' + st.fg + '">'
      + ln(1) + '<span style="color:' + st.kw + '">def</span> <span>solve(</span><span style="color:' + st.cm + '">#</span><span>):</span>'
      + '<br>' + ln(2) + '<span>&nbsp;&nbsp;</span><span style="color:' + st.cm + '"># 注释</span>'
      + '<br>' + ln(3) + '<span>&nbsp;&nbsp;</span><span style="color:' + st.kw + '">return</span> <span>0</span>'
      + '</div></div>'
      + '<div class="ws-theme-name">' + t.label + (cur === t.key ? '<span class="ws-theme-check">✓</span>' : '') + '</div>';
    grid.appendChild(card);
  });
};

// ═══════════ 编译投票 ═══════════
Gongfang._collabShowVote = function (p) {
  var st = Gongfang._collabState;
  if (!st.active) return;
  st.currentVote = { voteId: p.voteId, isRequester: !!p.isRequester, members: (st.members || []).slice(), responses: {}, start: Date.now(), timer: null };
  document.getElementById('voteTitle').textContent = (p.requester || '成员') + ' 请求编译整个 LaTeX 项目';
  var sub = document.getElementById('voteSub');
  if (sub) sub.textContent = p.isRequester ? '正在请求所有在线成员同意…' : '是否同意编译？未响应 60s 自动视为拒绝。';
  var bar = document.getElementById('voteBar');
  bar.style.width = '100%';
  if (st.currentVote.timer) clearInterval(st.currentVote.timer);
  st.currentVote.timer = setInterval(function () {
    var left = Math.max(0, 60 - Math.floor((Date.now() - st.currentVote.start) / 1000));
    bar.style.width = (left / 60 * 100) + '%';
    if (left <= 0) { clearInterval(st.currentVote.timer); Gongfang._collabVote(false, true); }
  }, 500);
  // 发起者：只显示「取消」；其余：同意 / 拒绝
  document.getElementById('voteAgreeBtn').style.display = p.isRequester ? 'none' : '';
  document.getElementById('voteRejectBtn').style.display = p.isRequester ? 'none' : '';
  document.getElementById('voteCancelBtn').style.display = p.isRequester ? '' : 'none';
  Gongfang._collabRenderVote();
  document.getElementById('collabVoteDialog').classList.add('show');
};
// 投票成员头像实时状态：谁已同意（✓ 变灰） / 拒绝（✗） / 等待中（…）
Gongfang._collabRenderVote = function () {
  var el = document.getElementById('voteMembers');
  var v = Gongfang._collabState.currentVote;
  if (!el || !v) return;
  var mark = { pending: '<span class="st pending">…</span>', agree: '<span class="st agree">✓</span>', reject: '<span class="st reject">✗</span>' };
  el.innerHTML = (v.members || []).map(function (m) {
    var st = v.responses[m.n] || 'pending';
    var name = Gongfang._collabEsc(m.name)
      + (m.role === '主' ? ' <span style="color:#f59e0b;font-size:10px">主</span>' : '')
      + (m.n === Gongfang._collabState.memberN ? ' <span style="color:#6366f1;font-size:10px">我</span>' : '');
    return '<div class="collab-vote-member">'
      + '<span class="collab-cap-dot" style="background:' + Gongfang._collabColor(m.n) + '">' + m.n + '</span>'
      + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</span>'
      + mark[st] + '</div>';
  }).join('');
  var allAgree = v.members.length && v.members.every(function (m) { return v.responses[m.n] === 'agree'; });
  var sub = document.getElementById('voteSub');
  if (allAgree && sub) sub.textContent = '全部同意，开始编译…';
};
Gongfang._collabCancelCompile = function () {
  var st = Gongfang._collabState;
  if (st.currentVote) window.electronAPI.collabCompileCancel(st.currentVote.voteId);
  Gongfang._collabCloseVote();
  Gongfang._writeSetCompileStatus('已取消编译', '');
};
Gongfang._collabVote = function (agree, timeout) {
  var st = Gongfang._collabState;
  if (st.currentVote) {
    if (st.currentVote.timer) clearInterval(st.currentVote.timer);
    window.electronAPI.collabCompileVote(st.currentVote.voteId, !!agree);
    st.currentVote = null;
  }
  document.getElementById('collabVoteDialog').classList.remove('show');
  if (!agree) Gongfang._collabShowToast(timeout ? '投票超时未响应，编译已取消' : '你拒绝了编译');
};
Gongfang._collabCloseVote = function () {
  var st = Gongfang._collabState;
  if (st.currentVote && st.currentVote.timer) clearInterval(st.currentVote.timer);
  st.currentVote = null;
  var d = document.getElementById('collabVoteDialog');
  if (d) d.classList.remove('show');
};
// ★ 4.2 编译提示窗：改成居中浮动小卡片（不再全屏遮罩），只提示"正在编译"，不挡其他界面
//   样式由 collab.css 的 #collabCompileMask(position:fixed;left:50%;top:50%;translate(-50%,-50%)) 决定，这里只负责显隐。
Gongfang._collabShowCompileMask = function () {
  var m = document.getElementById('collabCompileMask');
  if (!m) return;
  // ★ 协同编译提示窗只在「写作」模块显示，切到其他页面一律不弹
  if (Gongfang.STATE.activePanel !== 'write') return;
  m.style.display = 'flex';
};
Gongfang._collabHideCompileMask = function () {
  var m = document.getElementById('collabCompileMask');
  if (m) m.style.display = 'none';
};
// ★ 面板切换钩子：进入写作模块且仍在编译 → 恢复提示窗；切到其他模块 → 收起提示窗（不中断编译）
Gongfang._collabOnPanelSwitch = function () {
  var st = Gongfang._collabState;
  var isWrite = Gongfang.STATE.activePanel === 'write';
  if (isWrite && st && st.currentCompileVoteId) Gongfang._collabShowCompileMask();
  else Gongfang._collabHideCompileMask();
};
// ★ 终止协同编译：本机调用 abort，广播由服务端统一发给全员（收起各端遮罩/提示）
Gongfang._collabAbortCompile = function () {
  var st = Gongfang._collabState;
  window.electronAPI.collabCompileAbort(st.currentCompileVoteId || '');
  Gongfang._collabHideCompileMask();
  Gongfang._collabCloseVote();
  Gongfang._writeSetCompileStatus('已请求终止编译', 'cmp-err');
  Gongfang._writeAppendLog('已请求终止协同编译…');
};

Gongfang._collabFlush = async function () {
  var st = Gongfang._writeState;
  if (!st._dirtyFiles) st._dirtyFiles = {};
  var dirty = st._dirtyFiles;
  // 活动文件仅在确有“未落盘改动”时才以实时内容为准冲刷，
  // 避免只读端把「收到的他人内容」当作本地改动回写权威盘（覆盖他人新写入 → PDF 陈旧）
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
    var realPath = np;
    var openItem = st.openFiles.find(function(f) { return Gongfang._writeNormPath(f.path) === np; });
    if (openItem) realPath = openItem.path;
    if (!Gongfang._collabInPath(realPath)) continue;
    // 活动文件若与已读磁盘版本一致（本地无改动），跳过冲刷，避免用陈旧内容覆盖他端刚写入的新内容
    if (Gongfang._writeNormPath(realPath) === Gongfang._writeNormPath(st.activeFilePath) && st._lastDiskVersion != null) {
      var norm = Gongfang._writeNormText || function(x) { return x; };
      if (norm(content) === norm(st._lastDiskVersion)) continue;
    }
    await window.electronAPI.collabFlush(realPath, content, false);
  }
};
Gongfang._collabHandleCompileResult = async function (p) {
  var st = Gongfang._collabState;
  delete st.currentCompileVoteId;
  Gongfang._collabHideCompileMask();
  Gongfang._collabCloseVote();
  if (p.ok) {
    Gongfang._writeSetCompileStatus('编译成功', 'cmp-ok');
    Gongfang._writeAppendLog('编译成功！PDF 已下发');
    try {
      // ★ 修复：无论房主/成员，只要有 pdfPath 直接就本地渲染；只有 base64 则写临时文件渲染。
      //   之前限定 st.role==='host' 且仅凭 pdfPath，导致成员编译时房主拿不到路径/房主编译时
      //   自己 emit 没有数据，两端都可能一片白。
      if (p.pdfPath) {
        Gongfang._writePdfRenderSingle(p.pdfPath);
        Gongfang._writePdfState._pdfPath = p.pdfPath;
      } else if (p.pdfBase64) {
        var r = await window.electronAPI.collabTmpPdf();
        if (r && r.path) {
          await window.electronAPI.writeFileBase64(r.path, p.pdfBase64);
          Gongfang._writePdfRenderSingle(r.path);
          Gongfang._writePdfState._pdfPath = r.path;
        }
      }
    } catch (_) {}
    // ★ 4.3 编译完成后刷新到最新：同步文件 + 刷新当前打开的只读文件
    await Gongfang._collabRefresh();
    Gongfang._collabRefreshOpenFiles();
    Gongfang._collabShowToast('编译成功');
  } else {
    Gongfang._writeSetCompileStatus('编译失败', 'cmp-err');
    Gongfang._writeAppendLog(p.log || '编译失败');
    Gongfang._collabShowToast('编译失败');
  }
};
// 编译/同步后刷新已打开文件到最新（本地有未保存改动时不覆盖，避免丢内容）
Gongfang._collabRefreshOpenFiles = async function () {
  var fp = Gongfang._writeState.activeFilePath;
  if (fp && Gongfang._collabInPath(fp)) Gongfang._collabReloadFile(fp);
};
// 重新加载文件到编辑器。remote=true 表示是他端更新：若本地有未保存改动则保留并提示冲突。
Gongfang._collabReloadFile = async function (filePath, opts) {
  if (!Gongfang._collabInPath(filePath)) return;
  // ★ 统一路径分隔符：服务端事件用 '/', Windows 本地路径可能是 '\'，直接 === 会匹配失败导致不同步
  var _norm = function (x) { return String(x || '').replace(/\\/g, '/'); };
  var active = _norm(Gongfang._writeState.activeFilePath) === _norm(filePath);
  var ed = Gongfang._writeState.editor;
  // 本地正打开该文件且有未保存改动：不覆盖，提示手动合并
  if (active && ed) {
    var norm = Gongfang._writeNormText || function (x) { return x; };
    var editorContent = norm(ed.getValue());
    var baseline = Gongfang._writeState._lastDiskVersion != null ? norm(Gongfang._writeState._lastDiskVersion) : null;
    if (baseline !== null && editorContent !== baseline) {
      if (opts && opts.remote) Gongfang._collabShowToast('检测到冲突：' + String(filePath).split(/[\\/]/).pop() + ' 已被他端修改，已保留你的未保存内容，请手动合并或覆盖保存');
      return;
    }
  }
  var r = await window.electronAPI.collabReadFile(filePath);
  if (r && r.text !== undefined && active && ed) {
    var _norm = Gongfang._writeNormText || function (x) { return x; };
    var _nextT = _norm(r.text);
    var _curT = _norm(ed.getValue());
    // ★ 内容一致时不再 setValue：避免每次同步都整页重绘造成的"两边闪一下"
    if (_curT === _nextT) {
      Gongfang._writeState._lastDiskVersion = r.text;
      return;
    }
    // ★ 远端同步却读到空串、而当前编辑器还有内容 → 大概率是读取异常/瞬时状态，跳过以防误清空
    if (opts && opts.remote && _nextT === '' && /\S/.test(_curT)) {
      Gongfang._collabShowToast('检测到 ' + String(filePath).split(/[\\/]/).pop() + ' 读取异常，已保留当前内容');
      return;
    }
    // ★ 远端程序化更新：标记变更来源，change 处理器据此不标记脏/不自动保存/不同步（避免回写陈旧内容）
    Gongfang._writeState._remoteSetValue = true;
    ed.setValue(r.text);
    Gongfang._writeState._lastDiskVersion = r.text;
  }
};

// ═══════════ 主进程事件 ═══════════
function bindCollabEvents() {
  window.electronAPI.onCollabEvent(function (ev) {
    var st = Gongfang._collabState;
    var t = ev && ev.type;
    var p = ev.payload || {};
    switch (t) {
      case 'members':
        st.members = p || [];
        // ★ 清理已离开成员的查看记录，避免胶囊/状态面板残留
        var _ids = {};
        (st.members || []).forEach(function (m) { _ids[m.n] = true; });
        Object.keys(st.memberViews || {}).forEach(function (n) {
          if (!_ids[Number(n)]) delete st.memberViews[n];
        });
        Gongfang._collabRenderCapsules();
        Gongfang._collabRenderStatusPane();
        break;
      case 'locks':
        {
          // ★ v2.6.13 全量锁快照：服务器是权威源，直接以其为准重建本地锁表。
          //   绝不能再从本地残留值回填——否则文件已释放/被他人接管后，本机仍会残留幻影锁（ownerN=1）。
          var snapshot = p || {};
          var next = {};
          Object.keys(snapshot).forEach(function (f) {
            var key = Gongfang._collabNormKey(f);
            var owners = Array.isArray(snapshot[f].owners) ? snapshot[f].owners : [];
            next[key] = { owners: owners.slice() };
          });
          st.locks = next;
        }
        Gongfang._collabApplyTreeLocks();
        Gongfang._collabApplyEditorReadOnly();
        break;
      case 'lock-granted':
        {
          var key = Gongfang._collabNormKey(p.filePath);
          // ★ 防残留：若申请锁后我又切到了别的文件，这个迟到的授予立即作废（放掉锁、不写本地标记），
          //   否则本地树会残留一个"已离开文件"的占用圆点——这正是"只允许显示一个/切走仍残留"的根因。
          if (Gongfang._collabNormKey(Gongfang._writeState.activeFilePath) !== key) {
            try { window.electronAPI.collabReleaseLock(p.filePath); } catch (_) {}
            break;
          }
          var cur = Gongfang._collabFindLock(p.filePath);
          var owners = (cur && Array.isArray(cur.owners)) ? cur.owners.slice() : [];
          if (!owners.some(function (o) { return o.ownerN === st.memberN; })) owners.push({ ownerN: st.memberN, owner: '我' });
          st.locks[key] = { owners: owners };
          // ★ 接管成功：清掉只读 override、记住持锁文件，并聚焦编辑器继续输入
          if (st._readonlyOverride === key) {
            delete st._readonlyOverride;
            Gongfang._collabShowToast('已接管为编辑模式');
          }
          st.lastLockedFile = Gongfang._writeState.activeFilePath;
          if (Gongfang._writeState.editor) { try { Gongfang._writeState.editor.focus(); } catch (_) {} }
        }
        Gongfang._collabApplyTreeLocks();
        Gongfang._collabApplyEditorReadOnly();
        Gongfang._collabRenderCapsules();
        break;
      case 'lock-denied':
        // ★ 只对当前仍在编辑的文件生效；若已切走则忽略，避免误弹提示/误设只读波及其它标签
        if (Gongfang._collabNormKey(Gongfang._writeState.activeFilePath) === Gongfang._collabNormKey(p.filePath)) {
          Gongfang._collabShowToast('该文件正被 ' + ((p.owners && p.owners.length) ? (p.owners[0].owner || ('成员' + p.owners[0].ownerN)) : '成员') + ' 编辑，仅只读预览');
          Gongfang._collabApplyEditorReadOnly();
        }
        break;
      case 'lock-changed':
        {
          var key2 = Gongfang._collabNormKey(p.filePath);
          if (p.locked) st.locks[key2] = { owners: Array.isArray(p.owners) ? p.owners : [] };
          else {
            delete st.locks[key2];
            // ★ 作者释放后：若我正在只读预览该文件，解除只读并可接管为新的唯一编辑者
            if (st._readonlyOverride === key2) {
              delete st._readonlyOverride;
              if (Gongfang._collabNormKey(Gongfang._writeState.activeFilePath) === key2) {
                st.lastLockedFile = p.filePath;
                window.electronAPI.collabRequestLock(p.filePath);
              }
            }
          }
        }
        Gongfang._collabApplyTreeLocks();
        Gongfang._collabApplyEditorReadOnly();
        Gongfang._collabRenderCapsules();
        break;
      case 'file-updated':
        if (p.byN !== st.memberN) {
          Gongfang._collabReloadFile(p.filePath, { remote: true });
          Gongfang._collabShowToast((p.by || '成员') + ' 已更新 ' + (p.rel ? String(p.rel).split('/').pop() : '文件'));
        }
        break;
      // ★ v2.6.13 文件新建/删除同步：本机镜像已由主进程落地，刷新文件树/目录树即可。
      //   发起端由 write.js 本地流程自己刷新，这里只处理「他端」发起的操作。
      case 'file-created':
        if (p.byN !== st.memberN) {
          if (Gongfang._writeRenderFileBrowser) Gongfang._writeRenderFileBrowser();
          if (Gongfang._writeRenderOutlineTree) Gongfang._writeRenderOutlineTree();
          Gongfang._collabShowToast((p.by || '成员') + ' 新建了 ' + (p.rel ? String(p.rel).split('/').pop() : '文件'));
        }
        break;
      case 'file-deleted':
        if (p.byN !== st.memberN) {
          var _dk = Gongfang._collabNormKey(p.filePath);
          // 被删文件/目录下已打开的标签 → 全部关闭（含当前激活文件则清空编辑器）
          Gongfang._writeState.openFiles = Gongfang._writeState.openFiles.filter(function (f) {
            var _fk = Gongfang._collabNormKey(f.path);
            return !(_fk === _dk || _fk.indexOf(_dk + '/') === 0 || _dk.indexOf(_fk + '/') === 0);
          });
          var _dActive = Gongfang._collabNormKey(Gongfang._writeState.activeFilePath);
          if (_dActive === _dk || _dActive.indexOf(_dk + '/') === 0) {
            Gongfang._writeState.activeFilePath = null;
            Gongfang._writeState.activeFileName = null;
            if (Gongfang._writeClearEditor) Gongfang._writeClearEditor();
          }
          // 预览区正显示被删文件 → 清空
          if (Gongfang._writePdfState && Gongfang._writePdfState._pdfPath) {
            var _pk = Gongfang._collabNormKey(Gongfang._writePdfState._pdfPath);
            if (_pk === _dk || _pk.indexOf(_dk + '/') === 0) Gongfang._writeShowPdfPlaceholder();
          }
          // 清理被删文件的占用锁与只读 override
          Object.keys(st.locks || {}).forEach(function (fk) {
            if (fk === _dk || fk.indexOf(_dk + '/') === 0 || _dk.indexOf(fk + '/') === 0) delete st.locks[fk];
          });
          if (st._readonlyOverride && (st._readonlyOverride === _dk || st._readonlyOverride.indexOf(_dk + '/') === 0)) delete st._readonlyOverride;
          if (Gongfang._writeRenderTabs) Gongfang._writeRenderTabs();
          if (Gongfang._writeRenderFileBrowser) Gongfang._writeRenderFileBrowser();
          if (Gongfang._writeRenderOutlineTree) Gongfang._writeRenderOutlineTree();
          // ★ 图片共享文件区：他端删除共享图片，刷新共享列表
          if (Gongfang._collabIsImage(p.filePath)) { Gongfang._collabRenderDropdownFiles(); Gongfang._collabRefreshSharedBody(); }
          Gongfang._collabShowToast((p.by || '成员') + ' 删除了 ' + (p.rel ? String(p.rel).split('/').pop() : '文件'));
        }
        break;
      // ★ 实时编辑流：只读端直接刷新编辑器内容（不用点保存），不覆盖本地磁盘
      case 'edit-stream':
        if (p.byN !== st.memberN) {
          var _en = Gongfang._collabNormKey(p.filePath);
          var _an = Gongfang._collabNormKey(Gongfang._writeState.activeFilePath);
          if (_en === _an && Gongfang._writeState.editor) {
            // ★ 去重：内容与编辑器当前一致时不重渲染，避免高频编辑流反复 setValue 造成卡顿
            var _c = String(p.content == null ? '' : p.content);
            if (Gongfang._writeState.editor.getValue() !== _c) {
              // ★ 远端实时更新：标记变更来源，change 处理器据此不标记脏/不自动保存/不同步
              Gongfang._writeState._remoteSetValue = true;
              Gongfang._writeState.editor.setValue(_c);
              Gongfang._writeState._lastDiskVersion = _c;
            }
            // 对方仍在编辑 → 远端光标标签保持显示（重置 4s 自动隐藏计时）
            if (Gongfang._collabRemoteCursorTimer) {
              clearTimeout(Gongfang._collabRemoteCursorTimer);
              Gongfang._collabRemoteCursorTimer = setTimeout(function () { Gongfang._collabClearRemoteCursor(); }, 4000);
            }
          }
        }
        break;
      // ★ 当前查看文件同步：记录其他成员正在查看的文件（用于「查看X / 编辑X」区分）
      case 'view-field':
        if (p.byN && p.byN !== st.memberN) {
          st.memberViews = st.memberViews || {};
          if (p.filePath) st.memberViews[p.byN] = { filePath: p.filePath, rel: p.rel || '' };
          else delete st.memberViews[p.byN];   // 空路径 = 对方关闭了文件
          Gongfang._collabRenderCapsules();
          Gongfang._collabApplyTreeLocks();
          Gongfang._collabRenderStatusPane();
        }
        break;
      // ★ 加入房间时一次性拿到全员查看状态（memberN -> { filePath }）
      case 'views':
        {
          st.memberViews = {};
          Object.keys(p || {}).forEach(function (n) {
            if (Number(n) !== st.memberN && p[n] && p[n].filePath) st.memberViews[Number(n)] = p[n];
          });
          Gongfang._collabRenderCapsules();
          Gongfang._collabApplyTreeLocks();
        }
        break;
      // ★ 远端光标：只读端叠加对方光标标签
      case 'cursor-move':
        if (p.byN !== st.memberN) Gongfang._collabRenderRemoteCursor(p);
        break;
      case 'compile-vote-request': Gongfang._collabShowVote(p); break;
      case 'compile-vote-status':
        if (st.currentVote && st.currentVote.voteId === p.voteId) {
          st.currentVote.responses = p.responses || {};
          if (p.members) st.currentVote.members = p.members;
          Gongfang._collabRenderVote();
        }
        break;
      case 'compile-cancelled':
        Gongfang._collabHideCompileMask();
        Gongfang._collabCloseVote();
        Gongfang._writeSetCompileStatus('编译已取消' + (p.reason ? '：' + p.reason : ''), 'cmp-err');
        Gongfang._writeAppendLog('编译已取消' + (p.reason ? '：' + p.reason : ''));
        break;
      case 'compile-started':
        st.currentCompileVoteId = p.voteId;   // ★ 记住当前编译投票，供「终止编译」使用
        Gongfang._collabCloseVote();   // ★ 发起者确认后立即关掉投票窗，跳到编译提示窗
        Gongfang._collabShowCompileMask();
        Gongfang._writeSetCompileStatus('编译中（房主设备统一编译）…', 'cmp-running');
        Gongfang._writeAppendLog('全员同意，开始协同编译…');
        break;
      // ★ 任一成员/房主终止编译：全员收起编译提示窗
      case 'compile-terminated':
        delete st.currentCompileVoteId;
        Gongfang._collabHideCompileMask();
        Gongfang._collabCloseVote();
        Gongfang._writeSetCompileStatus('编译已终止' + (p.reason ? '：' + p.reason : ''), 'cmp-err');
        Gongfang._writeAppendLog('协同编译已被终止' + (p.reason ? '：' + p.reason : ''));
        if (p.byN && p.byN !== st.memberN) Gongfang._collabShowToast('成员 ' + (p.by || '') + ' 终止了编译');
        break;
      case 'compile-result': Gongfang._collabHandleCompileResult(p); break;
      case 'flush-request': Gongfang._collabFlush(); break;
      case 'connection':
        if (p.state === 'reconnecting') Gongfang._collabShowToast('连接中断，正在自动重连…');
        if (p.state === 'connected') Gongfang._collabShowToast('已重新连接');
        break;
      case 'latency': st.latency = p; Gongfang._collabRenderCapsules(); break;
      case 'left':
      case 'host-stopped':
        Gongfang._collabClearSession('协作会话已结束');
        break;
      case 'kicked':
        Gongfang._collabClearSession('你已被房主移出房间');
        break;
      case 'error':
        if (p && p.code === 'LOCK_DENIED') Gongfang._collabShowToast(p.message || '无法保存：该文件正被他人编辑');
        break;
      default: break;
    }
  });
}

// ═══════════ 初始化 ═══════════
function collabInit() {
  bindCollabEvents();
  // ★ 点房间窗外部遮罩 = 不操作 → 关闭并退回单人模式
  var _ov = document.getElementById('collabRoomDialog');
  if (_ov) _ov.addEventListener('click', function (e) { if (e.target === _ov) Gongfang._collabCloseRoom(); });
  Gongfang._collabRefreshWifi();
  // 周期刷新：成员/锁/延迟（事件为主，轮询兜底）。仅协作中刷新，
  // 避免重渲染未加入视图清掉用户正在输入的 IP/协作码。
  setInterval(function () {
    if (Gongfang._collabState.active) {
      Gongfang._collabRefresh();
      Gongfang._collabRenderCapsules();
      Gongfang._collabApplyTreeLocks();
      Gongfang._collabApplyEditorReadOnly();
      Gongfang._collabRenderStatusPane();
    }
  }, 3000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', collabInit);
else collabInit();
