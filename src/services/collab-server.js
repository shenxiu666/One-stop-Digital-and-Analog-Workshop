// Gongfang v2.6 — 局域网协作：主机（服务端）角色
//
// 设计依据：COLLAB-DESIGN.md
// - 点「共享协作」的机器即为主机；权威项目副本永远在本机磁盘。
// - 内存维护 成员表 / 锁表 / 投票；ws 只做消息与二进制文件转发，内存占用很低。
// - 业务规则：一文件一编辑者；保存才同步；编译需全体在线成员同意（60s 超时视为拒绝）。
//
// 与 collab-client.js 的关系：本文件管"本机作为主机"时的全部状态；
// 本机也可以同时作为别的房间的客户端（见 collab-client.js）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

let _emit = null;    // 主进程推送回调 → webContents.send('collab-event', data)
let _logger = null;

function setEmitter(fn) { _emit = fn; }
function setLogger(l) { _logger = l; }
// ★ v2.6 协作共享空间改到一级目录 Workspace-Share/<projectName>/（与 workspace/ 同级）
//   ipc/collab.js 初始化时注入 rootDir；startHost 用它建共享目录
let _rootDir = null;
function setRootDir(rd) { _rootDir = rd ? String(rd) : null; }
// ★ 常驻共享目录名：未协作时共享区兜底落在这里，长期存在、不会被写回清理删除
const SHARED_FALLBACK = '_shared';
// ★ 返回当前协作的项目名（host.project）——区别于「常驻兜底目录 _shared」
function _activeProjName() {
  return (host.project && host.project.name) ? host.project.name : '';
}
// 返回当前主机的共享目录路径（Workspace-Share/<projectName>/）
// ★ 规则（共享文件区 = 临时区）：
//   - 活动协作时：Workspace-Share/<项目名>/（临时，结束写回后由 stopHost 删除）
//   - 未协作时：Workspace-Share/_shared/（长期存在，不删除）
//   ★ 不再用 _lastProjectName 兜底：避免已删除的临时项目目录被意外重建
function getSharedDir() {
  if (!_rootDir) return '';
  const projName = _activeProjName() || SHARED_FALLBACK;
  const safeName = projName === SHARED_FALLBACK
    ? SHARED_FALLBACK
    : String(projName).replace(/[<>:"/\\|?*]/g, '_');
  // ★ 共享目录放在 root/Workspace-Share/<projectName>/（root 是 workspace/ 的父目录）
  const dir = path.join(_rootDir, require('../core/config').collabSharedDirName, safeName);
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function log(m) { try { if (_logger && _logger.log) _logger.log('[collab-server] ' + m); } catch (_) {} }

const MAX_MEMBERS = 4;
const VOTE_TIMEOUT_MS = 60 * 1000;
const BASE_WS_PORT = require('../core/config').ports.collabWs;
const DISCOVER_PORT = require('../core/config').ports.collabDiscover;
const FILE_SIZE_CAP = 25 * 1024 * 1024; // 25MB 以上文件不同步内容（只标记）
// ★ 图片共享文件区：成员镜像目录名（与 collab-client.js 的 SHARED_DIR 保持一致），快照用它作为共享文件的相对路径前缀
const SHARED_REL_PREFIX = '共享文件区';

// ── 主机会话状态 ──
const host = {
  active: false,
  code: '',
  wsPort: 0,
  project: null,         // { id, name, path, texFile, compileEngine }
  members: new Map(),    // id -> { id, ws, name, n, isHost, joinedAt }（主机自己 id='host', n=1）
  locks: new Map(),      // filePath -> Set<memberId>  多占用：同一文件可被多人同时打开
  views: new Map(),      // memberId -> filePath（成员当前正在查看的文件，用于「查看中」实时显示）
  votes: new Map(),      // voteId -> { voteId, projId, requesterId, responses, timer, ended }
  nextMemberN: 2,
  wss: null,
  discoverSocket: null,
  heartbeatTimer: null,
  wifi: { ssid: '' },
  hostName: '',
};

function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += Math.floor(Math.random() * 10);
  return c;
}
function localIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const k in ifaces) {
      for (const ifa of (ifaces[k] || [])) {
        if (ifa.family === 'IPv4' && !ifa.internal) return ifa.address;
      }
    }
  } catch (_) {}
  return '127.0.0.1';
}
function isTextFile(fp) {
  return /\.(tex|bib|cls|sty|md|txt|csv|log|json|py|js|m|npy|yml|yaml)$/i.test(fp);
}
function memberOf(id) {
  if (id === 'host') return { id: 'host', name: host.hostName || '主机', n: 1, isHost: true };
  return host.members.get(id) || null;
}
function memberName(id) { const m = memberOf(id); return m ? m.name : ''; }
function memberN(id) { const m = memberOf(id); return m ? m.n : 0; }
function relPath(base, p) { return path.relative(base, p).replace(/\\/g, '/'); }

function emit(type, payload) { try { if (_emit) _emit({ type, payload }); } catch (_) {} }
function sendTo(mid, type, payload) {
  const m = host.members.get(mid);
  if (m && m.ws && m.ws.readyState === 1) { try { m.ws.send(JSON.stringify({ type, payload })); } catch (_) {} }
}
function broadcast(type, payload, exceptId) {
  const msg = JSON.stringify({ type, payload });
  host.members.forEach((m, id) => {
    if (id === exceptId) return;
    if (m.ws && m.ws.readyState === 1) { try { m.ws.send(msg); } catch (_) {} }
  });
}

function snapshotMembers() {
  return [...host.members.values()]
    .filter(m => m.n >= 1)
    .map(m => ({ id: m.id, n: m.n, name: m.name, role: m.n === 1 ? '主' : '成员', latency: (m.ws && m.ws.latency) || 0 }));
}
// 统一锁 key 的分隔符：成员可能发反斜杠路径、房主发正斜杠路径，归一化后同一文件只有一个锁条目
function normKey(fp) { return String(fp || '').replace(/\\/g, '/'); }
function locksOwners(filePath) {
  const set = host.locks.get(normKey(filePath));
  const owners = [];
  if (set) set.forEach(mid => {
    const m = memberOf(mid);
    if (m) owners.push({ ownerN: m.n, owner: m.name });
  });
  return owners;
}
function serializeLocks() {
  const locks = {};
  const seen = new Set();
  host.locks.forEach((_set, f) => {
    const k = normKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    locks[k] = { owners: locksOwners(k) };
  });
  return locks;
}
// 序列化成员查看表（memberN -> filePath），供 welcome 下发给新加入者
function serializeViews() {
  const views = {};
  host.views.forEach((fp, mid) => {
    const m = memberOf(mid);
    if (m) views[m.n] = fp;
  });
  return views;
}

// ── 快照：文件树 + 全部文件内容（base64）+ 锁表 ──
function buildSnapshot() {
  const proj = host.project;
  const files = {};
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'build' || ent.name === '.gongfang-write.json' || /(规范|规则|求解计划)/.test(ent.name)) continue;
      const fp = path.join(dir, ent.name);
      const rel = relPath(proj.path, fp);
      if (ent.isDirectory()) walk(fp);
      else {
        try {
          const stat = fs.statSync(fp);
          if (stat.size > FILE_SIZE_CAP) { files[rel] = { size: stat.size, skipped: true }; continue; }
          const buf = fs.readFileSync(fp);
          files[rel] = { size: buf.length, binary: !isTextFile(fp), content: buf.toString('base64') };
        } catch (_) {}
      }
    }
  };
  walk(proj.path);
  // ★ 图片共享文件区：把共享图片一并打进快照，新加入成员立刻能看到已有的共享图片
  const sharedDir = getSharedDir();
  if (sharedDir) {
    const walkShared = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const fp = path.join(dir, ent.name);
        const rel = SHARED_REL_PREFIX + '/' + path.relative(sharedDir, fp).replace(/\\/g, '/');
        if (ent.isDirectory()) walkShared(fp);
        else {
          try {
            const stat = fs.statSync(fp);
            if (stat.size > FILE_SIZE_CAP) { files[rel] = { size: stat.size, skipped: true }; continue; }
            const buf = fs.readFileSync(fp);
            files[rel] = { size: buf.length, binary: !isTextFile(fp), content: buf.toString('base64') };
          } catch (_) {}
        }
      }
    };
    walkShared(sharedDir);
  }
  return { project: proj, files, locks: serializeLocks(), sharedDir };
}

// ── 共享编译（见 collab-compile.js）：统一在房主（权威副本）上编译，产物（PDF base64）下发全员 ──
const { compileProject } = require('./collab-compile');

// ── 消息处理 ──
function onConnection(ws, req) {
  const ip = req && req.socket ? req.socket.remoteAddress : '';
  ws.isAlive = true;
  // ★ 禁用 Nagle 算法：实时编辑流的高频小报文不再被攒包等 ACK，消除本机回环上的 ~40ms 延迟
  try { ws._socket.setNoDelay(true); } catch (_) {}
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => handleMessage(ws, raw));
  ws.on('close', () => onClientClose(ws));
  ws.on('error', () => {});
  try { ws.send(JSON.stringify({ type: 'hello-required', payload: { code: host.code } })); } catch (_) {}
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString('utf-8')); } catch (_) { return; }
  const type = msg.type;
  const payload = msg.payload || {};

  if (type === 'hello') {
    if (String(payload.code || '') !== host.code) {
      try { ws.send(JSON.stringify({ type: 'error', payload: { code: 'AUTH_FAIL', message: '协作码不正确' } })); } catch (_) {}
      try { ws.close(); } catch (_) {}
      return;
    }
    if (host.members.size >= MAX_MEMBERS) {
      try { ws.send(JSON.stringify({ type: 'error', payload: { code: 'ROOM_FULL', message: '房间已满（最多 4 人）' } })); } catch (_) {}
      try { ws.close(); } catch (_) {}
      return;
    }
    const name = String(payload.name || '成员').slice(0, 30);
    const n = host.nextMemberN++;
    const id = 'm' + n;
    const member = { id, ws, name, n, isHost: false, joinedAt: Date.now() };
    host.members.set(id, member);
    ws.memberId = id;
    // welcome + 快照
    try {
      ws.send(JSON.stringify({ type: 'welcome', payload: { memberId: id, memberN: n, code: host.code, project: host.project, sharedDir: getSharedDir(), members: snapshotMembers(), locks: serializeLocks(), views: serializeViews() } }));
      ws.send(JSON.stringify({ type: 'project-snapshot', payload: buildSnapshot() }));
    } catch (_) {}
    broadcast('member-joined', { member: { id, n, name, role: '成员' } }, id);
    emit('members', snapshotMembers());
    return;
  }

  const mid = ws.memberId;
  if (!mid) { try { ws.send(JSON.stringify({ type: 'error', payload: { code: 'AUTH', message: '请先发送 hello' } })); } catch (_) {} return; }

  switch (type) {
    case 'request-lock': handleRequestLock(mid, payload); break;
    case 'release-lock': handleReleaseLock(mid, payload); break;
    case 'create-file': handleCreateFile(mid, payload); break;
    case 'delete-file': handleDeleteFile(mid, payload); break;
    case 'save-file': handleSaveFile(mid, payload); break;
    case 'edit-stream': handleEditStream(mid, payload); break;
    case 'cursor-move': handleCursorMove(mid, payload); break;
    case 'flush-editor': handleFlushEditor(mid, payload); break;
    case 'view-field': handleViewField(mid, payload); break;
    case 'compile-request': handleCompileRequest(mid, payload); break;
    case 'compile-vote': handleCompileVote(mid, payload); break;
    case 'compile-cancel': handleCompileCancel(mid, payload); break;
    case 'compile-abort': handleCompileAbort(mid, payload); break;
    case 'ping':
      if (payload && payload.t) ws.latency = Math.min(999, Math.max(1, Date.now() - Number(payload.t)));
      try { ws.send(JSON.stringify({ type: 'pong', payload: { t: Date.now() } })); } catch (_) {}
      break;
    default: break;
  }
}

function handleRequestLock(mid, payload) {
  const filePath = normKey(payload.filePath || '');
  if (!filePath) return;
  // ★ v2.6.11 协同编辑改为「单编辑者独占」：同一文件同一时刻只有一人持有锁，
  //   他人申请时拒绝，只能只读预览；锁是唯一编辑权的凭据。
  let set = host.locks.get(filePath);
  if (set && set.size > 0 && !set.has(mid)) {
    const owners = locksOwners(filePath);
    sendTo(mid, 'lock-denied', { filePath, owners });
    emit('locks', serializeLocks());
    return;
  }
  // ★ v2.6.12 同一成员同一时刻只能占一个文件：申请新文件锁前，先把该成员名下
  //   其它文件的锁全部释放并广播。不管客户端是否及时释放，服务端都保证任何设备上
  //   同一成员只可能出现一个占用标志——切到新文件时旧标志立刻消失、不残留。
  host.locks.forEach((otherSet, otherFile) => {
    if (otherFile === filePath) return;
    if (otherSet && otherSet.has(mid)) {
      otherSet.delete(mid);
      const stillLocked = otherSet.size > 0;
      if (!stillLocked) host.locks.delete(otherFile);
      broadcast('lock-changed', { filePath: otherFile, locked: stillLocked, owners: locksOwners(otherFile) });
    }
  });
  if (!set) { set = new Set(); host.locks.set(filePath, set); }
  const isNew = !set.has(mid);
  set.add(mid);
  sendTo(mid, 'lock-granted', { filePath });
  if (isNew) {
    broadcast('lock-changed', { filePath, locked: true, owners: locksOwners(filePath) }, mid);
  }
  // ★ v2.6.13 全量锁快照广播给所有成员端：增量 lock-changed 可能因快速连续切换而丢失，
  //   成员端一致依赖它就不够可靠；每次都再推一份全量快照，保证任何设备无论有没有收到
  //   增量事件，都能在同一轮迭代里收敛到最新锁状态，消除房主切文件时其余端占用标志的延迟。
  broadcast('locks', serializeLocks(), mid);
  emit('locks', serializeLocks());
}
function handleReleaseLock(mid, payload) {
  const filePath = normKey(payload.filePath || '');
  const set = host.locks.get(filePath);
  if (!set || !set.has(mid)) return;
  set.delete(mid);
  const stillLocked = set.size > 0;
  if (!stillLocked) host.locks.delete(filePath);
  broadcast('lock-changed', { filePath, locked: stillLocked, owners: locksOwners(filePath) });
  // ★ v2.6.13 同上：释放后也广播全量锁快照，让其余端即时刷新占用标志
  broadcast('locks', serializeLocks(), mid);
  emit('locks', serializeLocks());
}
function handleSaveFile(mid, payload) {
  const filePath = String(payload.filePath || '');
  if (!filePath) return;
  // ★ v2.6.11 协同编辑：保存一律生效（以最后保存为准），不因锁而拦截。
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (payload.binary) fs.writeFileSync(filePath, Buffer.from(String(payload.content || ''), 'base64'));
    else fs.writeFileSync(filePath, String(payload.content == null ? '' : payload.content), 'utf-8');
  } catch (e) {
    sendTo(mid, 'error', { code: 'SAVE_FAIL', message: '保存失败: ' + e.message });
    return;
  }
  let rel = host.project ? relPath(host.project.path, filePath) : filePath;
  // ★ 共享文件区：共享文件不在项目路径下，rel 用「共享文件区/<相对名>」保证各端一致映射
  const sharedDir = getSharedDir();
  const nk = normKey(filePath);
  if (sharedDir) { const nsd = normKey(sharedDir); if (nk === nsd || nk.indexOf(nsd + '/') === 0) rel = SHARED_REL_PREFIX + '/' + path.relative(sharedDir, filePath).replace(/\\/g, '/'); }
  broadcast('file-updated', { filePath, rel, content: payload.content || '', binary: !!payload.binary, by: memberName(mid), byN: memberN(mid) }, mid);
  emit('file-updated', { filePath, rel, by: memberName(mid), byN: memberN(mid) });
}
// ★ v2.6.13 文件新建同步：任何一端新建项目文件，写权威盘 + 广播全员「file-created」，
//   各端落地镜像并刷新文件树，避免「一个客户端新建、其它端看不到/无法上传后续文件」。
function handleCreateFile(mid, payload) {
  const filePath = String(payload.filePath || '');
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (payload.binary) fs.writeFileSync(filePath, Buffer.from(String(payload.content || ''), 'base64'));
    else fs.writeFileSync(filePath, String(payload.content == null ? '' : payload.content), 'utf-8');
  } catch (e) {
    sendTo(mid, 'error', { code: 'CREATE_FAIL', message: '新建失败: ' + e.message });
    return;
  }
  const rel = host.project ? relPath(host.project.path, filePath) : filePath;
  broadcast('file-created', { filePath, rel, content: payload.content || '', binary: !!payload.binary, by: memberName(mid), byN: memberN(mid) }, mid);
  emit('file-created', { filePath, rel, by: memberName(mid), byN: memberN(mid) });
}
// ★ v2.6.13 文件删除同步：任何一端删除项目文件/目录，删权威盘 + 清理锁与查看状态 + 广播「file-deleted」。
function handleDeleteFile(mid, payload) {
  const filePath = String(payload.filePath || '');
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch (e) {
    sendTo(mid, 'error', { code: 'DELETE_FAIL', message: '删除失败: ' + e.message });
    return;
  }
  // 清理锁表与查看表（删除的文件/目录及其子项）
  const key = normKey(filePath);
  let locksChanged = false;
  host.locks.forEach((set, f) => {
    const nk = normKey(f);
    if (nk === key || nk.indexOf(key + '/') === 0 || key.indexOf(nk + '/') === 0) {
      host.locks.delete(f);
      locksChanged = true;
    }
  });
  host.views.forEach((fp, mId) => {
    const nk = normKey(fp);
    if (nk === key || nk.indexOf(key + '/') === 0 || key.indexOf(nk + '/') === 0) host.views.delete(mId);
  });
  if (locksChanged) emit('locks', serializeLocks());
  let rel = host.project ? relPath(host.project.path, filePath) : filePath;
  // ★ 共享文件区：删除广播同样用「共享文件区/<相对名>」标记，便于各端命中本地镜像
  const shd = getSharedDir();
  const ndk = normKey(filePath);
  if (shd) { const nsd = normKey(shd); if (ndk === nsd || ndk.indexOf(nsd + '/') === 0) rel = SHARED_REL_PREFIX + '/' + path.relative(shd, filePath).replace(/\\/g, '/'); }
  broadcast('file-deleted', { filePath, rel, by: memberName(mid), byN: memberN(mid) }, mid);
  emit('file-deleted', { filePath, rel, by: memberName(mid), byN: memberN(mid) });
}
// ★ 实时编辑流：编辑者（持锁人）把编辑器内容增量/全量推给其他只读客户端，无需点保存。
//   服务端只做广播，不落权威盘（权威盘仍以 save-file/auto-save 为准）。
function handleEditStream(mid, payload) {
  const filePath = normKey(payload.filePath || '');
  if (!filePath) return;
  const rel = host.project ? relPath(host.project.path, filePath) : filePath;
  broadcast('edit-stream', { filePath, rel, content: payload.content || '', binary: !!payload.binary, by: memberName(mid), byN: memberN(mid) }, mid);
  // ★ content 必须一并 emit 给房主渲染层：漏掉会让房主编辑器被 setValue('') 清空
  emit('edit-stream', { filePath, rel, content: payload.content || '', binary: !!payload.binary, by: memberName(mid), byN: memberN(mid) });
}
// ★ 远端光标：编辑者（持锁人）移动光标/选区时，把坐标推给其他只读客户端绘制光标标记。
function handleCursorMove(mid, payload) {
  const filePath = normKey(payload.filePath || '');
  if (!filePath) return;
  const cursor = payload.cursor || null;
  broadcast('cursor-move', { filePath, by: memberName(mid), byN: memberN(mid), cursor }, mid);
  emit('cursor-move', { filePath, by: memberName(mid), byN: memberN(mid), cursor });
}
// ★ 当前查看文件同步：成员打开/切换文件时广播给其他成员（区分 编辑/查看）
function handleViewField(mid, payload) {
  const filePath = String(payload.filePath || '');
  if (!filePath) return;
  const rel = host.project ? relPath(host.project.path, filePath) : filePath;
  const data = { filePath, rel, viewFile: filePath, by: memberName(mid), byN: memberN(mid) };
  broadcast('view-field', data, mid);
  emit('view-field', data);
}
function handleFlushEditor(mid, payload) {
  // 投票期间"强制快照保存"：只写权威磁盘，不广播 file-updated；协同编辑不再按锁拦截
  const filePath = String(payload.filePath || '');
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (payload.binary) fs.writeFileSync(filePath, Buffer.from(String(payload.content || ''), 'base64'));
    else fs.writeFileSync(filePath, String(payload.content == null ? '' : payload.content), 'utf-8');
  } catch (_) {}
}

function handleCompileRequest(mid, payload) {
  if (!host.project) return;
  const voteId = 'v' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const vote = { voteId, projId: host.project.id, requesterId: mid, responses: {}, timer: null, ended: false };
  host.votes.set(voteId, vote);
  // 发起者自动同意
  registerVote(vote, mid, true);
  // 所有成员（含主机自己）先强制快照保存（flush 未保存的编辑）
  host.members.forEach((m, id) => {
    if (m.ws && m.ws.readyState === 1) {
      try { m.ws.send(JSON.stringify({ type: 'flush-request', payload: { voteId, projId: host.project.id } })); } catch (_) {}
    }
  });
  emit('flush-request', { voteId, projId: host.project.id, role: 'host' });
  // 向所有成员推送投票请求（发起者 isRequester=true：只显示取消；其余显示同意/拒绝）
  const voteReq = { voteId, projId: host.project.id, requester: memberName(mid), requesterN: memberN(mid) };
  host.members.forEach((m, id) => {
    const req = Object.assign({}, voteReq, { isRequester: id === mid });
    if (m.ws && m.ws.readyState === 1) sendTo(id, 'compile-vote-request', req);
  });
  emit('compile-vote-request', Object.assign({ role: 'host', isRequester: mid === 'host' }, voteReq));
  // 60s 超时兜底
  vote.timer = setTimeout(() => {
    if (vote.ended) return;
    finishVote(vote, false, '投票超时，未全员同意');
  }, VOTE_TIMEOUT_MS);
}
function handleCompileVote(mid, payload) {
  const vote = host.votes.get(String(payload.voteId || ''));
  if (!vote) return;
  registerVote(vote, mid, !!payload.agree);
}
function broadcastVoteStatus(vote) {
  const responses = {};
  host.members.forEach((m, id) => {
    if (vote.responses[id] === undefined) responses[m.n] = 'pending';
    else responses[m.n] = vote.responses[id] ? 'agree' : 'reject';
  });
  const status = { voteId: vote.voteId, responses, members: snapshotMembers() };
  broadcast('compile-vote-status', status);
  emit('compile-vote-status', status);
}
function registerVote(vote, memberId, agree) {
  if (vote.ended) return;
  if (vote.responses[memberId] !== undefined) return;
  vote.responses[memberId] = agree;
  // 广播实时投票状态：谁已同意/拒绝（用于各端头像打勾 / 变灰）
  broadcastVoteStatus(vote);
  // 是否有人拒绝
  let anyReject = false;
  Object.keys(vote.responses).forEach(id => { if (vote.responses[id] === false) anyReject = true; });
  if (anyReject) { finishVote(vote, false, '有成员拒绝编译'); return; }
  // 是否全体在线成员都已表态
  let allVoted = true;
  host.members.forEach((m, id) => { if (vote.responses[id] === undefined) allVoted = false; });
  if (allVoted) finishVote(vote, true);
}
function handleCompileCancel(mid, payload) {
  const vote = host.votes.get(String(payload.voteId || ''));
  if (!vote || vote.requesterId !== mid) return;
  finishVote(vote, false, '发起者已取消编译');
}
function finishVote(vote, ok, reason) {
  if (vote.ended) return;
  vote.ended = true;
  if (vote.timer) clearTimeout(vote.timer);
  if (!ok) {
    // ★ 拒绝/取消：不会编译，可安全删除投票记录
    host.votes.delete(vote.voteId);
    broadcast('compile-cancelled', { voteId: vote.voteId, reason: reason || '未全员同意' });
    emit('compile-cancelled', { voteId: vote.voteId, reason: reason || '未全员同意' });
    return;
  }
  // ★ 修复卡死：不再立刻删除 vote。编译完成回调还要按 voteId 查找 vote；
  //   提前删除会导致结果被丢弃、遮罩永久卡住。
  broadcast('compile-started', { voteId: vote.voteId });
  emit('compile-started', { voteId: vote.voteId });
  runCompile(vote);
}
// 编译统一由房主（权威副本）执行：成员端只有本地副本，.tex 引用房主绝对路径会踩空，故不再下发到成员端
function runCompile(vote) {
  const proj = host.project;
  const engine = (proj && proj.compileEngine) || 'xelatex';
  // ★ 统一在房主（权威副本）上编译：成员端只有本地副本，.tex 内若引用房主绝对路径会踩空，
  //   且成员编译失败无自动回退。改为主机统一编译，产物（PDF base64）再下发全员。
  compileProject(proj.path, proj.texFile, engine, result => {
    // ★ 主机端编译结束：清理投票记录（结束遮罩）
    if (vote.timer) clearTimeout(vote.timer);
    host.votes.delete(vote.voteId);
    if (result.ok) {
      // ★ 修复：emit 也必须携带 pdfData，否则房主渲染层 _collabHandleCompileResult 拿不到 pdfPath/pdfBase64，
      //   房主端永远不渲染 PDF。广播与 emit 同时下发。
      let pdfBase64 = '', pdfPath = '';
      try {
        const pdf = fs.readFileSync(result.pdfPath);
        pdfBase64 = pdf.toString('base64');
        pdfPath = result.pdfPath;
      } catch (_) {
        broadcast('compile-result', { voteId: vote.voteId, ok: false, log: '读取 PDF 失败' });
        emit('compile-result', { voteId: vote.voteId, ok: false, log: '读取 PDF 失败' });
        return;
      }
      broadcast('compile-result', { voteId: vote.voteId, ok: true, pdfBase64, pdfPath });
      emit('compile-result', { voteId: vote.voteId, ok: true, pdfBase64, pdfPath });
    } else {
      broadcast('compile-result', { voteId: vote.voteId, ok: false, log: result.log || '' });
      emit('compile-result', { voteId: vote.voteId, ok: false, log: result.log || '' });
    }
  });
}
// ★ 终止编译：任何成员/房主都可触发；宿主统一转发，全员收到 compile-terminated 后收起遮罩
function handleCompileAbort(mid, payload) {
  const voteId = String((payload && payload.voteId) || '');
  // 1) 若本机正在编译（房主是编译器），杀掉编译进程
  try { const cp = require('./collab-compile'); if (cp.abortAll) cp.abortAll(); } catch (_) {}
  // 2) 定位投票记录，清超时
  for (const v of host.votes.values()) {
    if (!voteId || v.voteId === voteId) {
      if (v.timer) clearTimeout(v.timer);
      host.votes.delete(v.voteId);
      break;
    }
  }
  // 3) 广播「已被终止」给所有成员 + 主机渲染层
  broadcast('compile-terminated', { voteId, reason: '已终止编译' });
  emit('compile-terminated', { voteId, reason: '已终止编译' });
}

function onClientClose(ws) {
  const id = ws.memberId;
  if (!id) return;
  host.members.delete(id);
  host.views.delete(id);   // ★ 断线即清查看状态，避免胶囊/文件树残留「查看中」
  const released = [];
  host.locks.forEach((set, f) => {
    if (set.has(id)) {
      set.delete(id);
      if (set.size === 0) host.locks.delete(f);
      else released.push({ f, owners: locksOwners(f) });
    }
  });
  released.forEach(({ f, owners }) => broadcast('lock-changed', { filePath: f, locked: owners.length > 0, owners }));
  broadcast('member-left', { memberId: id, reason: 'disconnected' });
  emit('members', snapshotMembers());
}

function heartbeatTick() {
  host.members.forEach((m) => {
    if (!m.ws) return;
    if (!m.ws.isAlive) { try { m.ws.terminate(); } catch (_) {} return; }
    m.ws.isAlive = false;
    try { m.ws.ping(); } catch (_) {}
  });
}

// ── UDP 发现（广播应答，不传明文协作码） ──
function startDiscover() {
  try {
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('utf-8');
      if (text.indexOf('GONGFANG_DISCOVER') === 0) {
        const resp = Buffer.from(JSON.stringify({
          // ★ name 优先显示房主账号名（hostName 为建房地传入的账号名），设备名仅兜底
          type: 'gongfang-found', name: host.hostName || os.hostname(), ip: localIp(), port: host.wsPort,
          code: host.code,   // ★ 局域网内点选主机即可入房，无需再手输协作码
          project: host.project ? host.project.name : '', ts: Date.now(),
          members: snapshotMembers(),   // ★ 5.2 让加入方能先看到房间成员数/名单
        }));
        try { socket.send(resp, rinfo.port, rinfo.address); } catch (_) {}
      }
    });
    socket.on('error', () => {});
    socket.bind(DISCOVER_PORT, () => {});
    host.discoverSocket = socket;
  } catch (_) {}
}
function refreshWifi() {
  try {
    const { execFile } = require('child_process');
    execFile('netsh', ['wlan', 'show', 'interfaces'], { encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) return;
      const m = /SSID\s*:\s*([^\r\n]+)/.exec(stdout);
      if (m) host.wifi.ssid = m[1].trim();
    });
  } catch (_) {}
}

// ── 生命周期 ──
function startHost(opts) {
  const projectName = String((opts && opts.projectName) || '');
  const projectPath = String((opts && opts.projectPath) || '');
  const texFile = String((opts && opts.texFile) || '');
  const engine = String((opts && opts.compileEngine) || 'xelatex');
  const name = String((opts && opts.name) || '');

  if (host.active) return Promise.resolve({ success: false, error: '本机已有协作在运行，请先退出' });
  if (!projectPath || !fs.existsSync(projectPath)) return Promise.resolve({ success: false, error: '项目路径不存在' });

  // ★ 支持客户端指定的 6 位房间号（弹窗一开始就显示真实码）；否则随机生成
  const reqCode = String((opts && opts.code) || '').trim();
  host.code = /^\d{6}$/.test(reqCode) ? reqCode : genCode();
  host.project = { id: projectPath, name: projectName || path.basename(projectPath), path: projectPath, texFile, compileEngine: engine };
  host.hostName = name || '主机';
  host.members.clear();
  host.locks.clear();
  host.views.clear();
  host.votes.clear();
  host.nextMemberN = 2;
  // 主机自己是 1 号成员
  host.members.set('host', { id: 'host', ws: null, name: host.hostName, n: 1, isHost: true, joinedAt: Date.now() });
  // ★ 共享文件区：v2.6 改到一级目录 Workspace-Share/<projectName>/（与 workspace/ 同级）
  //   不再嵌在项目目录里，避免项目重命名/迁移时共享文件丢失。
  //   兼容老逻辑：老共享目录（项目下/共享文件区/）存在但新位置是空时，自动迁移过去。
  try {
    const sharedDir = getSharedDir();
    if (sharedDir) {
      fs.mkdirSync(sharedDir, { recursive: true });
      const oldShared = path.join(projectPath, '共享文件区');
      if (fs.existsSync(oldShared)) {
        // 把老共享区里的文件搬到新位置（不覆盖已有文件）
        for (const name of fs.readdirSync(oldShared)) {
          const src = path.join(oldShared, name);
          const dst = path.join(sharedDir, name);
          if (!fs.existsSync(dst)) {
            try { fs.renameSync(src, dst); } catch {}
          }
        }
        // 老目录清空了就删掉，避免下次启动还看到
        try { fs.rmSync(oldShared, { recursive: true, force: true }); } catch {}
      }
      // ★ 跨设备相对路径：在项目目录内建一个「共享文件区」junction，指向真实的 Workspace-Share/<项目>/，
      //   使拖拽插入的相对路径「共享文件区/<图名>」在主机和成员端都能被编译解析（成员镜像本就在项目目录内）。
      const projSharedLink = path.join(projectPath, SHARED_REL_PREFIX);
      try { if (!fs.existsSync(projSharedLink)) fs.symlinkSync(sharedDir, projSharedLink, 'junction'); } catch (_) {}
    }
  } catch (_) {}
  refreshWifi();

  return new Promise(resolve => {
    const tryListen = (port) => {
      let wss;
      try {
        wss = new WebSocketServer({ port, host: '0.0.0.0' });
      } catch (e) {
        resolve({ success: false, error: e.message });
        return;
      }
      wss.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && port < BASE_WS_PORT + 10) {
          log('端口 ' + port + ' 被占用，尝试 ' + (port + 1));
          try { wss.close(); } catch (_) {}
          tryListen(port + 1);
        } else {
          resolve({ success: false, error: (err && err.message) || '启动失败' });
        }
      });
      wss.on('listening', () => {
        host.wss = wss;
        host.wsPort = wss.address().port;
        host.active = true;
        wss.on('connection', onConnection);
        host.heartbeatTimer = setInterval(heartbeatTick, 15000);
        startDiscover();
        log('已启动，协作码 ' + host.code + '，端口 ' + host.wsPort);
        emit('host-started', { code: host.code, port: host.wsPort, project: host.project });
        resolve({ success: true, code: host.code, port: host.wsPort });
      });
    };
    tryListen(BASE_WS_PORT);
  });
}

// ── v2.6.14 房主收尾 ──
// 共享区是「临时文件区」：会话期间大家在此共享/修改。结束后房主把共享内容【全部】写回自己的工作区（任务），
// 然后直接删除整个项目名临时目录（Workspace-Share/任务1、任务2 等）。图片随写回一并保存到任务，不丢失。
// 常驻兜底目录 _shared 长期存在，不参与清理删除。
function isJunction(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return true;
    if (st.isDirectory()) {
      // Windows junction 被当作目录，但 readlink 可读 → 是链接
      try { fs.readlinkSync(p); return true; } catch (_) {}
    }
  } catch (_) {}
  return false;
}

function writeBackAndCleanupShared(projectPath, sharedDir) {
  if (!sharedDir || !fs.existsSync(sharedDir)) return;
  const isFallback = path.basename(sharedDir) === SHARED_FALLBACK;

  // ★ 常驻兜底目录（长期存在，不清理）：退出协作也把共享图片/文件合并到这一份，保证非协作态仍可见
  const persistDir = path.join(_rootDir, require('../core/config').collabSharedDirName, SHARED_FALLBACK);

  // 1) 确定写回目标：优先房主任务目录下的「共享文件区」，任务不存在则兜底到 _shared（图片不丢）
  let targetBase = '';
  if (projectPath && fs.existsSync(projectPath)) {
    const link = path.join(projectPath, SHARED_REL_PREFIX);
    // __ 断开 junction：先断开，写回时不能让复制目标仍指向临时区自身（否则循环/同文件跳过）。
    //   Windows junction 是目录型链接，用 rmdirSync；symlink 用 unlinkSync。
    if (isJunction(link)) {
      try {
        const st = fs.lstatSync(link);
        if (st.isSymbolicLink()) fs.unlinkSync(link);
        else fs.rmdirSync(link);
      } catch (_) {}
    }
    targetBase = link;
  }
  if (!targetBase && !isFallback) {
    targetBase = persistDir;
  }
  try { if (targetBase && !fs.existsSync(targetBase)) fs.mkdirSync(targetBase, { recursive: true }); } catch (_) {}
  try { if (!fs.existsSync(persistDir)) fs.mkdirSync(persistDir, { recursive: true }); } catch (_) {}

  // 2) 写回全部文件（含图片）：既写回任务「共享文件区」，也同步合并到长期 _shared
  const copyInto = (dstDir) => {
    if (!dstDir) return;
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const fp = path.join(dir, ent.name);
        const rel = path.relative(sharedDir, fp).replace(/\\/g, '/');
        const dst = path.join(dstDir, rel.split('/').join(path.sep));
        if (ent.isDirectory()) {
          try { fs.mkdirSync(dst, { recursive: true }); } catch (_) {}
          walk(fp);
        } else {
          try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(fp, dst); } catch (_) {}
        }
      }
    };
    walk(sharedDir);
  };
  if (targetBase) copyInto(targetBase);
  // ★ 常驻 _shared 也同步一份：退出协作后用户仍能看到上一轮共享的图片/文件
  if (!isFallback && persistDir !== targetBase) copyInto(persistDir);

  // 3) 删除整个临时项目目录（_shared 常驻保留）；若任务存在还要确保任务内没有失效的 junction
  if (!isFallback) {
    try { fs.rmSync(sharedDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function stopHost() {
  const proj = host.project; // 保留项目引用，供收尾写回/清理使用（后面会清空 host.project）
  if (host.wss) {
    try {
      host.wss.clients.forEach(c => { try { c.close(1000, 'host stopped'); } catch (_) {} });
      host.wss.close();
    } catch (_) {}
  }
  if (host.discoverSocket) { try { host.discoverSocket.close(); } catch (_) {} }
  if (host.heartbeatTimer) clearInterval(host.heartbeatTimer);
  host.votes.forEach(v => { if (v.timer) clearTimeout(v.timer); });
  // 房主收尾：全部写回任务 + 删除临时项目共享目录（保留 _shared）
  if (proj && proj.path) {
    const sharedDir = getSharedDir();
    if (sharedDir) writeBackAndCleanupShared(proj.path, sharedDir);
  }
  const wasActive = host.active;
  host.active = false; host.code = ''; host.project = null; host.hostName = '';
  host.members.clear(); host.locks.clear(); host.views.clear(); host.votes.clear();
  host.nextMemberN = 2;
  host.wss = null; host.discoverSocket = null; host.heartbeatTimer = null;
  if (wasActive) emit('host-stopped', {});
}

// 主机自己（1 号成员）的操作：渲染层经 IPC 直接调用，等同 ws 消息
function readDiskFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (isTextFile(filePath)) return { text: buf.toString('utf-8') };
    return { base64: buf.toString('base64') };
  } catch (_) { return null; }
}
function hostRequestLock(filePath) { handleRequestLock('host', { filePath }); }
function hostReleaseLock(filePath) { handleReleaseLock('host', { filePath }); }
function hostCreateFile(filePath, content, binary) { handleCreateFile('host', { filePath, content, binary }); }
function hostDeleteFile(filePath) { handleDeleteFile('host', { filePath }); }
function hostSaveFile(filePath, content, binary) { handleSaveFile('host', { filePath, content, binary }); }
function hostEditStream(filePath, content, binary) { handleEditStream('host', { filePath, content, binary }); }
function hostCursorMove(filePath, cursor) { handleCursorMove('host', { filePath, cursor }); }
function hostViewField(filePath) { handleViewField('host', { filePath }); }
function hostFlush(filePath, content, binary) { handleFlushEditor('host', { filePath, content, binary }); }
function hostCompileRequest() { handleCompileRequest('host', {}); }
function hostVote(voteId, agree) { handleCompileVote('host', { voteId, agree }); }
function hostCompileCancel(voteId) { handleCompileCancel('host', { voteId }); }
function hostCompileAbort(voteId) { handleCompileAbort('host', { voteId: voteId || '' }); }

// ★ 房主踢人：按成员序号 n 关闭其连接；onClientClose 会广播 member-left 并 emit members
function hostKickMember(n) {
  const num = Number(n);
  if (!host.active) return { success: false, error: '未在协作中' };
  if (!num || num <= 1) return { success: false, error: '不能踢出房主' };
  let target = null;
  host.members.forEach((m) => {
    if (m.n === num && !m.isHost) target = m;
  });
  if (!target || !target.ws) return { success: false, error: '成员不存在' };
  try { target.ws.send(JSON.stringify({ type: 'kicked', payload: { reason: 'host' } })); } catch (_) {}
  try { target.ws.close(1000, 'kicked'); } catch (_) {}
  return { success: true };
}

// 渲染层/设置面板 获取主机会话当前状态
function getHostState() {
  if (!host.active) return { active: false };
  return {
    active: true, role: 'host', code: host.code, port: host.wsPort, project: host.project,
    members: snapshotMembers(), locks: serializeLocks(), wifi: { ssid: host.wifi.ssid, ip: localIp() },
  };
}

module.exports = {
  startHost, stopHost, getHostState, setEmitter, setLogger, setRootDir, getSharedDir, localIp,
  hostRequestLock, hostReleaseLock, hostCreateFile, hostDeleteFile, hostSaveFile, hostEditStream, hostCursorMove, hostViewField, hostFlush,
  hostCompileRequest, hostVote, hostCompileCancel, hostCompileAbort, hostReadFile: readDiskFile,
  hostKickMember,
  hostStatus: () => ({ active: host.active, code: host.code, port: host.wsPort, project: host.project }),
};
