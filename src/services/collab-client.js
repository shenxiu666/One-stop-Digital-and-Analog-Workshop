// Gongfang v2.6 — 局域网协作：客户端（成员）角色
//
// 设计依据：COLLAB-DESIGN.md + 共享文件区
// - 加入主机房间后，把主机项目【完整复制】到本机工作区临时目录（workspace/_collab/<房间>/<项目>/），
//   内含「共享文件区」文件夹；成员在本机磁盘上编辑，保存时同步上传主机。
// - 主机广播的 file-updated 会写回本机副本；退出协作时先保存最后状态，再删除临时副本。
// - 断线自动指数退避重连；UDP 扫描可发现局域网主机（手动输入 IP 兜底）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const WebSocket = require('ws');

const DISCOVER_PORT = require('../core/config').ports.collabDiscover;
const SHARED_DIR = '共享文件区';

let _emit = null;
let _logger = null;
let _rootDir = '';

function setEmitter(fn) { _emit = fn; }
function setLogger(l) { _logger = l; }
function setRootDir(dir) { _rootDir = dir || ''; }
function emit(type, payload) { try { if (_emit) _emit({ type, payload }); } catch (_) {} }

const client = {
  active: false,
  connecting: false,
  ws: null,
  hostInfo: null,
  code: '',
  name: '',
  memberId: '',
  memberN: 0,
  project: null,       // 主机项目信息（服务器路径）
  workDir: '',         // 本机临时副本目录
  hostSharedDir: '',   // 主机共享目录绝对路径（Workspace-Share/<项目>/），用于映射共享文件
  members: [],
  locks: {},           // 服务器绝对路径 -> { owners: [{ownerN, owner}, ...] } 多占用
  latency: 0,
  reconnectTimer: null,
  reconnectAttempt: 0,
};

function toLocal(serverPath) {
  if (!client.project || !client.workDir) return serverPath;
  const s = String(serverPath || '').replace(/\\/g, '/');
  // ★ 共享文件区：主机共享目录（Workspace-Share/<项目>/）不在项目路径下，需单独映射到本机 workDir/共享文件区/
  const hs = client.hostSharedDir ? String(client.hostSharedDir).replace(/\\/g, '/') : '';
  if (hs && (s === hs || s.indexOf(hs + '/') === 0)) {
    const rel = s.slice(hs.length).replace(/^\//, '');
    const name = rel ? rel : path.basename(serverPath);
    return path.join(client.workDir, SHARED_DIR, name.split('/').join(path.sep));
  }
  const base = String(client.project.path).replace(/\\/g, '/');
  const rel = s.slice(base.length).replace(/^\//, '');
  return rel ? path.join(client.workDir, rel.split('/').join(path.sep)) : client.workDir;
}
// 统一锁/删除键的分隔符（服务端路径可能来自 / 或 \）
function normKey(fp) { return String(fp || '').replace(/\\/g, '/'); }
function toServer(localPath) {
  if (!client.project || !client.workDir) return localPath;
  const rel = path.relative(client.workDir, localPath).split(path.sep).join('/');
  return client.project.path + '/' + rel;
}

// 把快照写到本机工作区磁盘
function writeSnapshotToDisk(snap) {
  const proj = snap.project || client.project;
  if (!proj) return;
  client.project = proj;
  client.hostSharedDir = snap.sharedDir || client.hostSharedDir || '';
  const name = String(proj.name || '项目').replace(/[<>:"/\\|?*]/g, '_');
  client.workDir = path.join(_rootDir, 'workspace', '_collab', String(client.code || 'room'), name);
  try { fs.rmSync(client.workDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.mkdirSync(client.workDir, { recursive: true }); } catch (_) {}
  const files = snap.files || {};
  Object.keys(files).forEach(rel => {
    const f = files[rel];
    if (f.skipped) return;
    const target = path.join(client.workDir, rel.split('/').join(path.sep));
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const buf = Buffer.from(String(f.content || ''), 'base64');
      if (f.binary) fs.writeFileSync(target, buf);
      else fs.writeFileSync(target, buf.toString('utf-8'), 'utf-8'); // ★ 文本必须解码，否则乱码
    } catch (_) {}
  });
  // 共享文件区：确保镜像目录存在
  try { fs.mkdirSync(path.join(client.workDir, SHARED_DIR), { recursive: true }); } catch (_) {}
  client.locks = snap.locks || {};
}

// ── 消息分发 ──
function handleServerMessage(msg) {
  const t = msg.type;
  const p = msg.payload || {};
  switch (t) {
    case 'welcome':
      client.memberId = p.memberId;
      client.memberN = p.memberN;
      client.project = p.project;
      client.hostSharedDir = p.sharedDir || client.hostSharedDir || '';
      client.members = p.members || [];
      client.locks = p.locks || {};
      emit('members', client.members.slice());
      // ★ 全员当前查看文件（memberN -> 服务器路径）转成本地路径推给渲染层（文件树/胶囊「查看中」标识）
      if (p.views) {
        const views = {};
        Object.keys(p.views).forEach(n => { const fp = p.views[n]; if (fp) views[n] = { filePath: toLocal(fp) }; });
        emit('views', views);
      }
      break;
    case 'project-snapshot':
      writeSnapshotToDisk(p);
      emit('snapshot', { project: client.project, workDir: client.workDir, locks: client.locks });
      break;
    case 'member-joined':
      if (p.member && !client.members.some(x => x.id === p.member.id)) client.members.push(p.member);
      emit('members', client.members.slice());
      break;
    case 'member-left':
      client.members = client.members.filter(m => m.id !== p.memberId);
      emit('members', client.members.slice());
      emit('member-left', p);
      break;
    case 'lock-granted':
      {
        const cur = client.locks[p.filePath];
        const owners = (cur && Array.isArray(cur.owners) ? cur.owners.slice() : []);
        if (!owners.some(o => o.ownerN === client.memberN)) owners.push({ ownerN: client.memberN, owner: '我' });
        client.locks[p.filePath] = { owners };
        emit('lock-granted', Object.assign({}, p, { filePath: toLocal(p.filePath) }));
      }
      break;
    case 'lock-denied': emit('lock-denied', Object.assign({}, p, { filePath: toLocal(p.filePath) })); break;
    case 'lock-changed':
      if (p.locked) client.locks[p.filePath] = { owners: Array.isArray(p.owners) ? p.owners : [] };
      else delete client.locks[p.filePath];
      emit('lock-changed', Object.assign({}, p, { filePath: toLocal(p.filePath) }));
      break;
    case 'edit-stream':
      {
        const local = toLocal(p.filePath);
        // ★ 异步写盘：编辑流高频到达，用 writeFileSync 会阻塞主进程并排队后续消息，放大延迟
        try {
          fs.mkdirSync(path.dirname(local), { recursive: true });
          if (p.binary) fs.writeFile(local, Buffer.from(String(p.content || ''), 'base64'), () => {});
          else fs.writeFile(local, String(p.content || ''), 'utf-8', () => {});
        } catch (_) {}
        emit('edit-stream', Object.assign({}, p, { filePath: local }));
      }
      break;
    case 'cursor-move':
      emit('cursor-move', Object.assign({}, p, { filePath: toLocal(p.filePath) }));
      break;
    case 'view-field':
      // 空路径 = 对方关闭/清空查看状态，保持空串（toLocal('') 会误映射成 workDir）
      emit('view-field', Object.assign({}, p, { filePath: p.filePath ? toLocal(p.filePath) : '' }));
      break;
    case 'file-updated':
      {
        const local = toLocal(p.filePath);
        try {
          fs.mkdirSync(path.dirname(local), { recursive: true });
          if (p.binary) fs.writeFile(local, Buffer.from(String(p.content || ''), 'base64'), () => {});
          else fs.writeFile(local, String(p.content || ''), 'utf-8', () => {});
        } catch (_) {}
        emit('file-updated', Object.assign({}, p, { filePath: local }));
      }
      break;
    // ★ v2.6.13 文件新建：把新文件落到本机镜像后推给渲染层刷新文件树
    case 'file-created':
      {
        const local = toLocal(p.filePath);
        try {
          fs.mkdirSync(path.dirname(local), { recursive: true });
          if (p.binary) fs.writeFileSync(local, Buffer.from(String(p.content || ''), 'base64'));
          else fs.writeFileSync(local, String(p.content == null ? '' : p.content), 'utf-8');
        } catch (_) {}
        emit('file-created', Object.assign({}, p, { filePath: local }));
      }
      break;
    // ★ v2.6.13 文件删除：删除本机镜像 + 清理本机锁表后推给渲染层刷新树/关标签
    case 'file-deleted':
      {
        const local = toLocal(p.filePath);
        try { fs.rmSync(local, { recursive: true, force: true }); } catch (_) {}
        const dk = normKey(p.filePath);
        Object.keys(client.locks).forEach(sp => {
          const nk = normKey(sp);
          if (nk === dk || nk.indexOf(dk + '/') === 0 || dk.indexOf(nk + '/') === 0) delete client.locks[sp];
        });
        emit('file-deleted', Object.assign({}, p, { filePath: local }));
      }
      break;
    case 'compile-vote-request': emit('compile-vote-request', p); break;
    case 'compile-vote-status': emit('compile-vote-status', p); break;
    case 'compile-cancelled': emit('compile-cancelled', p); break;
    case 'compile-started': emit('compile-started', p); break;
    case 'compile-result': emit('compile-result', p); break;
    case 'compile-terminated': emit('compile-terminated', p); break;
    case 'flush-request': emit('flush-request', p); break;
    case 'pong': if (p && p.t) client.latency = Math.min(999, Math.max(1, Date.now() - p.t)); emit('latency', client.latency); break;
    case 'kicked':
      // 房主踢出：停止自动重连、关闭 ws、清理本机临时副本，并通知渲染层清空会话
      client.active = false;
      client.connecting = false;
      if (latTimer) { clearInterval(latTimer); latTimer = null; }
      if (client.reconnectTimer) { clearTimeout(client.reconnectTimer); client.reconnectTimer = null; }
      try { if (client.ws) client.ws.close(1000, 'kicked'); } catch (_) {}
      client.ws = null;
      if (client.workDir) {
        try { fs.rmSync(client.workDir, { recursive: true, force: true }); } catch (_) {}
        // __ 删除空房间父目录，避免 _collab 堆积目录
        try { const roomDir = path.dirname(client.workDir); if (fs.existsSync(roomDir) && !fs.readdirSync(roomDir).length) fs.rmdirSync(roomDir); } catch (_) {}
      }
      client.workDir = '';
      emit('kicked', p);
      break;
    case 'error': emit('error', p); break;
    default: break;
  }
}

let latTimer = null;
function startLatencyLoop() {
  if (latTimer) clearInterval(latTimer);
  latTimer = setInterval(() => {
    if (client.ws && client.ws.readyState === 1) {
      try { client.ws.send(JSON.stringify({ type: 'ping', payload: { t: Date.now() } })); } catch (_) {}
    }
  }, 5000);
}

function scheduleReconnect() {
  if (client.reconnectTimer || !client.active) return;
  const delay = Math.min(30000, 1000 * Math.pow(2, client.reconnectAttempt));
  client.reconnectAttempt++;
  client.reconnectTimer = setTimeout(() => {
    client.reconnectTimer = null;
    client.connecting = true;
    let ws;
    try { ws = new WebSocket('ws://' + client.hostInfo.ip + ':' + client.hostInfo.port); } catch (_) { client.connecting = false; scheduleReconnect(); return; }
    client.ws = ws;
    ws.on('open', () => {
      client.connecting = false;
      client.reconnectAttempt = 0;
      // ★ 禁用 Nagle：实时接收编辑流/光标时不攒包，降低本机回环延迟
      try { ws._socket.setNoDelay(true); } catch (_) {}
      emit('connection', { state: 'connected' });
      try { ws.send(JSON.stringify({ type: 'hello', payload: { code: client.code, name: client.name } })); } catch (_) {}
    });
    ws.on('message', raw => { let m; try { m = JSON.parse(raw.toString('utf-8')); } catch (_) { return; } handleServerMessage(m); });
    ws.on('error', () => {});
    ws.on('close', () => { client.connecting = false; if (client.active) scheduleReconnect(); });
  }, delay);
}

// ── 加入（等 welcome + 快照都收到才返回） ──
function join(opts) {
  if (client.active || client.connecting) return Promise.resolve({ success: false, error: '已在协作中，请先退出' });
  const hostIp = String((opts && opts.host) || '');
  const port = Number((opts && opts.port)) || require('../core/config').ports.collabWs;
  const code = String((opts && opts.code) || '');
  const name = String((opts && opts.name) || '');
  if (!hostIp || !code) return Promise.resolve({ success: false, error: '缺少主机地址或协作码' });

  return new Promise(resolve => {
    client.connecting = true;
    client.reconnectAttempt = 0;
    client.code = code;
    client.name = name;
    client.hostInfo = { ip: hostIp, port };
    let settled = false;
    let gotWelcome = false;
    let gotSnapshot = false;
    let pending = null;
    const fail = (msg) => { if (settled) return; settled = true; client.connecting = false; try { client.ws && client.ws.close(); } catch (_) {} client.ws = null; resolve({ success: false, error: msg }); };
    const maybeOk = () => {
      if (settled || !gotWelcome || !gotSnapshot) return;
      settled = true;
      client.active = true;
      client.connecting = false;
      startLatencyLoop();
      emit('members', client.members.slice());
      resolve({ success: true, memberN: client.memberN, project: client.project, workDir: client.workDir });
    };

    let ws;
    try { ws = new WebSocket('ws://' + hostIp + ':' + port); } catch (e) { fail(e.message); return; }
    client.ws = ws;
    ws.on('open', () => {
      // ★ 禁用 Nagle：实时接收编辑流/光标时不攒包，降低本机回环延迟
      try { ws._socket.setNoDelay(true); } catch (_) {}
      try { ws.send(JSON.stringify({ type: 'hello', payload: { code, name } })); } catch (_) {}
    });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString('utf-8')); } catch (_) { return; }
      if (msg.type === 'welcome') {
        client.memberId = msg.payload.memberId;
        client.memberN = msg.payload.memberN;
        client.project = msg.payload.project;
        client.hostSharedDir = msg.payload.sharedDir || client.hostSharedDir || '';
        client.members = msg.payload.members || [];
        client.locks = msg.payload.locks || {};
        if (msg.payload.views) {
          const views = {};
          Object.keys(msg.payload.views).forEach(n => { const fp = msg.payload.views[n]; if (fp) views[n] = { filePath: toLocal(fp) }; });
          emit('views', views);
        }
        gotWelcome = true;
        maybeOk();
        return;
      }
      if (msg.type === 'project-snapshot') {
        writeSnapshotToDisk(msg.payload);
        gotSnapshot = true;
        maybeOk();
        return;
      }
      if (msg.type === 'error' && !client.active) { fail(msg.payload.message || '加入失败'); return; }
      handleServerMessage(msg);
    });
    ws.on('error', e => fail('连接失败: ' + (e && e.message ? e.message : e)));
    ws.on('close', () => {
      client.connecting = false;
      if (settled && client.active) {
        emit('connection', { state: 'reconnecting' });
        scheduleReconnect();
      } else if (!settled) {
        fail('连接已断开');
      }
    });
  });
}

function leave() {
  if (latTimer) { clearInterval(latTimer); latTimer = null; }
  if (client.reconnectTimer) { clearTimeout(client.reconnectTimer); client.reconnectTimer = null; }
  client.active = false;
  client.connecting = false;
  try { if (client.ws) client.ws.close(1000, 'leave'); } catch (_) {}
  client.ws = null;
  // 退出：成员不写回、全丢。临时副本 workDir 内含「共享文件区」镜像（收到的共享图片），随 workDir 一并删除。
  if (client.workDir) {
    try { fs.rmSync(client.workDir, { recursive: true, force: true }); } catch (_) {}
    // __ 删除空房间父目录（workspace/_collab/<房间码>/），避免 _collab 堆积目录
    try { const roomDir = path.dirname(client.workDir); if (fs.existsSync(roomDir) && !fs.readdirSync(roomDir).length) fs.rmdirSync(roomDir); } catch (_) {}
  }
  client.hostInfo = null;
  client.code = '';
  client.name = '';
  client.memberId = '';
  client.memberN = 0;
  client.project = null;
  client.workDir = '';
  client.hostSharedDir = '';
  client.members = [];
  client.locks = {};
  client.latency = 0;
  client.reconnectAttempt = 0;
  emit('left', {});
}

function send(type, payload) {
  if (!client.ws || client.ws.readyState !== 1) return false;
  try { client.ws.send(JSON.stringify({ type, payload })); return true; } catch (_) { return false; }
}

// ── 本机副本上的文件操作（写本地 + 同步上传主机） ──
function requestLock(localPath) { return send('request-lock', { filePath: toServer(localPath) }); }
function releaseLock(localPath) { return send('release-lock', { filePath: toServer(localPath) }); }
function saveFile(localPath, content, binary) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (binary) fs.writeFileSync(localPath, Buffer.from(String(content || ''), 'base64'));
    else fs.writeFileSync(localPath, String(content == null ? '' : content), 'utf-8');
  } catch (_) {}
  return send('save-file', { filePath: toServer(localPath), content: content || '', binary: !!binary });
}
// ★ v2.6.13 文件新建：写本机镜像 + 上报主机全员广播（新文件在权威盘落地后各端刷新出树）
function createFile(localPath, content, binary) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (binary) fs.writeFileSync(localPath, Buffer.from(String(content || ''), 'base64'));
    else fs.writeFileSync(localPath, String(content == null ? '' : content), 'utf-8');
  } catch (_) {}
  return send('create-file', { filePath: toServer(localPath), content: content || '', binary: !!binary });
}
// ★ v2.6.13 文件删除：删本机镜像 + 上报主机全员广播（各端删除镜像并刷新树/关标签）
function deleteFile(localPath) {
  try { fs.rmSync(localPath, { recursive: true, force: true }); } catch (_) {}
  return send('delete-file', { filePath: toServer(localPath) });
}
// 实时编辑流：持锁人推送编辑器全量内容给其他只读客户端（同时写本地镜像以防切走丢内容）
function sendEdit(localPath, content, binary) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (binary) fs.writeFileSync(localPath, Buffer.from(String(content || ''), 'base64'));
    else fs.writeFileSync(localPath, String(content == null ? '' : content), 'utf-8');
  } catch (_) {}
  return send('edit-stream', { filePath: toServer(localPath), content: content || '', binary: !!binary });
}
// 远端光标：持锁人推送光标/选区坐标
function sendCursor(localPath, cursor) {
  return send('cursor-move', { filePath: toServer(localPath), cursor: cursor || null });
}
// ★ 当前查看文件同步：成员打开/切换文件时告知主机，转发给其他成员（区分 编辑/查看）
function sendViewField(localPath) {
  return send('view-field', { filePath: toServer(localPath) });
}
function flush(localPath, content, binary) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (binary) fs.writeFileSync(localPath, Buffer.from(String(content || ''), 'base64'));
    else fs.writeFileSync(localPath, String(content == null ? '' : content), 'utf-8');
  } catch (_) {}
  return send('flush-editor', { filePath: toServer(localPath), content: content || '', binary: !!binary });
}
function readFile(localPath) {
  try {
    const buf = fs.readFileSync(localPath);
    const bin = /\.(png|jpg|jpeg|gif|bmp|pdf|ttf|otf|woff2?|xlsx|docx|zip|ico)$/i.test(localPath);
    if (bin) return { base64: buf.toString('base64') };
    return { text: buf.toString('utf-8') };
  } catch (_) { return null; }
}
function sharedDir() { return path.join(client.workDir || '', SHARED_DIR); }

// ── 清理「_collab」遗留房间目录 ──
// ★ 每次加入/退出协作后，workspace/_collab/ 都可能残留上次会话的房间副本目录。
//   本函数删除全部遗留房间目录（保留当前活动协作所在房间），防止 _collab 无限堆积。
function cleanupStaleCollabDirs() {
  if (!_rootDir) return 0;
  const collabRoot = path.join(_rootDir, 'workspace', '_collab');
  if (!fs.existsSync(collabRoot)) return 0;
  const activeRoom = client.workDir ? path.dirname(path.resolve(client.workDir)) : '';
  let removed = 0;
  let rooms = [];
  try { rooms = fs.readdirSync(collabRoot, { withFileTypes: true }); } catch (_) { return 0; }
  for (const room of rooms) {
    const roomDir = path.join(collabRoot, room.name);
    if (!room.isDirectory()) continue;
    if (activeRoom && path.resolve(roomDir).toLowerCase() === activeRoom.toLowerCase()) continue;
    try { fs.rmSync(roomDir, { recursive: true, force: true }); removed++; } catch (_) {}
  }
  return removed;
}
// ★ 共享文件区上传（成员端）：写本机镜像 workDir/共享文件区/，并让主机落盘到其真实共享目录 Workspace-Share/<项目>/
function saveSharedFile(name, content, binary) {
  const safe = String(name || '').replace(/[<>:"/\\|?*]/g, '_');
  const local = path.join(sharedDir(), safe);
  try { fs.mkdirSync(path.dirname(local), { recursive: true }); if (binary) fs.writeFileSync(local, Buffer.from(String(content || ''), 'base64')); else fs.writeFileSync(local, String(content == null ? '' : content), 'utf-8'); } catch (_) {}
  // 直接上报主机共享目录绝对路径，确保落在权威 Workspace-Share/<项目>/ 下
  const dest = client.hostSharedDir ? path.join(client.hostSharedDir, safe) : toServer(local);
  return send('save-file', { filePath: dest, content: content || '', binary: !!binary });
}
// ★ 共享文件区删除（成员端）：删本机镜像 + 让主机从真实共享目录删除并广播
function deleteSharedFile(name) {
  const safe = String(name || '').replace(/[<>:"/\\|?*]/g, '_');
  const local = path.join(sharedDir(), safe);
  try { fs.rmSync(local, { recursive: true, force: true }); } catch (_) {}
  const dest = client.hostSharedDir ? path.join(client.hostSharedDir, safe) : toServer(local);
  return send('delete-file', { filePath: dest });
}

function bcastOf(ip, mask) {
  const a = ip.split('.').map(Number);
  const m = mask.split('.').map(Number);
  return a.map((x, i) => (x & m[i]) | (255 ^ m[i])).join('.');
}

function scanHosts() {
  return new Promise(resolve => {
    const results = [];
    let socket;
    try { socket = dgram.createSocket('udp4'); } catch (_) { return resolve(results); }
    const timer = setTimeout(() => { try { socket.close(); } catch (_) {} resolve(results); }, 1500);
    socket.on('message', msg => {
      try {
        const obj = JSON.parse(msg.toString('utf-8'));
        if (obj && obj.type === 'gongfang-found') {
          if (!results.some(x => x.ip === obj.ip && x.port === obj.port)) results.push(obj);
        }
      } catch (_) {}
    });
    socket.on('error', () => { clearTimeout(timer); try { socket.close(); } catch (_) {} resolve(results); });
    socket.on('listening', () => {
      try { socket.setBroadcast(true); } catch (_) {}
      const payload = Buffer.from('GONGFANG_DISCOVER');
      const addrs = [];
      try {
        const ifaces = os.networkInterfaces();
        for (const k in ifaces) {
          for (const ifa of (ifaces[k] || [])) {
            if (ifa.family === 'IPv4' && !ifa.internal && !ifa.address.startsWith('169.254')) addrs.push(bcastOf(ifa.address, ifa.netmask));
          }
        }
      } catch (_) {}
      (addrs.length ? addrs : ['255.255.255.255']).forEach(addr => {
        try { socket.send(payload, DISCOVER_PORT, addr); } catch (_) {}
      });
    });
    try { socket.bind(0); } catch (_) { clearTimeout(timer); resolve(results); }
  });
}

function getClientState() {
  if (!client.active) return { active: false };
  // 锁表映射成本机路径（供渲染层按本地树匹配）
  const locks = {};
  Object.keys(client.locks).forEach(sp => {
    locks[toLocal(sp)] = client.locks[sp];
  });
  return {
    active: true, role: 'member', memberN: client.memberN, memberId: client.memberId,
    host: client.hostInfo, code: client.code,
    project: client.project ? { name: client.project.name, path: client.workDir, serverPath: client.project.path, texFile: client.project.texFile || '' } : null,
    members: client.members, locks, latency: client.latency,
  };
}

module.exports = {
  join, leave, send, readFile, saveFile, createFile, deleteFile, sendEdit, sendCursor, sendViewField, flush, requestLock, releaseLock, sharedDir,
  saveSharedFile, deleteSharedFile,
  scanHosts, getClientState, getWorkDir: () => client.workDir, setEmitter, setLogger, setRootDir,
  cleanupStaleCollabDirs,
  clientStatus: () => ({ active: client.active, host: client.hostInfo, memberN: client.memberN }),
};
