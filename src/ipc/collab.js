// Gongfang v2.6 — 局域网协作 IPC 处理器
// 渲染层通过 collab-* 通道访问 collab-server（主机）与 collab-client（成员）；
// 主进程 → 渲染层推送统一走 'collab-event'。
const { ipcMain } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const collabServer = require('../services/collab-server');
const collabClient = require('../services/collab-client');

// ★ 图片共享文件区：仅允许的常见图片扩展名（前后端统一此白名单，拖入/选择/后端兜底都用它）
const SHARED_IMAGE_EXTS = /\.(png|jpg|jpeg|gif|bmp|webp|svg|tif|tiff)$/i;

let _ctx = null;

function register(ctx) {
  _ctx = ctx;

  const sendEvent = (data) => {
    try {
      const win = _ctx && _ctx.getMainWindow ? _ctx.getMainWindow() : null;
      if (win && !win.isDestroyed()) win.webContents.send('collab-event', data);
    } catch (_) {}
  };
  collabServer.setEmitter(sendEvent);
  collabClient.setEmitter(sendEvent);
  // ★ v2.6 共享空间提到一级目录 Workspace-Share/：主机和客户端都注入 rootDir，建共享目录用
  try {
    const rd = _ctx.getRootDir ? _ctx.getRootDir() : process.cwd();
    collabClient.setRootDir(rd);
    if (typeof collabServer.setRootDir === 'function') collabServer.setRootDir(rd);
    // __ 启动即清理「_collab」遗留房间目录，避免历史会话副本无限堆积
    if (typeof collabClient.cleanupStaleCollabDirs === 'function') collabClient.cleanupStaleCollabDirs();
  } catch (_) {}

  const _norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const isHosted = (filePath) => {
    const hs = collabServer.hostStatus();
    return hs && hs.active && hs.project && filePath && _norm(filePath).indexOf(_norm(hs.project.path)) === 0;
  };
  const isJoined = (filePath) => {
    const cs = collabClient.getClientState();
    if (!cs || !cs.active || !filePath) return false;
    const p = _norm(filePath);
    const work = cs.project ? _norm(cs.project.path) : '';
    const server = cs.project ? _norm(cs.project.serverPath) : '';
    return (work && p.indexOf(work) === 0) || (server && p.indexOf(server) === 0);
  };

  // ── 主机 ──
  ipcMain.handle('collab-host-start', async (e, opts) => collabServer.startHost(opts || {}));
  ipcMain.handle('collab-host-stop', async () => { collabServer.stopHost(); return { success: true }; });
  
  // ── 客户端（成员） ──
  ipcMain.handle('collab-join', async (e, opts) => collabClient.join(opts || {}));
  ipcMain.handle('collab-leave', async () => {
    collabClient.leave();
    collabServer.stopHost();
    return { success: true };
  });
  ipcMain.handle('collab-scan', async () => collabClient.scanHosts());
  ipcMain.handle('collab-state', async () => ({
    host: collabServer.getHostState(),
    client: collabClient.getClientState(),
  }));

  // ── 文件读写（协作态） ──
  ipcMain.handle('collab-read-file', async (e, filePath) => {
    if (isJoined(filePath)) return collabClient.readFile(filePath);
    if (isHosted(filePath)) return collabServer.hostReadFile(filePath);
    return null;
  });
  ipcMain.handle('collab-write-file', async (e, { filePath, content, binary }) => {
    if (isJoined(filePath)) { collabClient.saveFile(filePath, content, !!binary); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostSaveFile(filePath, content, !!binary); return { success: true }; }
    return { success: false, error: '该文件不在协作项目中' };
  });
  ipcMain.handle('collab-flush', async (e, { filePath, content, binary }) => {
    if (isJoined(filePath)) { collabClient.flush(filePath, content, !!binary); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostFlush(filePath, content, !!binary); return { success: true }; }
    return { success: true };
  });
  // ★ 实时编辑流：持锁人推送内容 / 光标给其他只读客户端
  ipcMain.handle('collab-send-edit', async (e, { filePath, content, binary }) => {
    if (isJoined(filePath)) { collabClient.sendEdit(filePath, content, !!binary); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostEditStream(filePath, content, !!binary); return { success: true }; }
    return { success: true };
  });
  ipcMain.handle('collab-send-cursor', async (e, { filePath, cursor }) => {
    if (isJoined(filePath)) { collabClient.sendCursor(filePath, cursor); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostCursorMove(filePath, cursor); return { success: true }; }
    return { success: true };
  });
  // ★ 当前查看文件同步：成员打开/切换文件时广播给其他成员（区分 编辑/查看）
  ipcMain.handle('collab-send-view', async (e, filePath) => {
    if (isJoined(filePath)) { collabClient.sendViewField(filePath); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostViewField(filePath); return { success: true }; }
    return { success: true };
  });
  ipcMain.handle('collab-get-file-tree', async (e, projectPath) => {
    const writeService = require('../services/write');
    if (isJoined(projectPath)) {
      const cs = collabClient.getClientState();
      if (cs && cs.project) return { success: true, tree: writeService.getFileTree(cs.project.path) };
      return { success: false, error: '项目不在协作中' };
    }
    if (isHosted(projectPath)) return { success: true, tree: writeService.getFileTree(projectPath) };
    return { success: false, error: '项目不在协作中' };
  });

  // ── 文件锁 ──
  ipcMain.handle('collab-request-lock', async (e, filePath) => {
    if (isJoined(filePath)) { collabClient.requestLock(filePath); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostRequestLock(filePath); return { success: true }; }
    return { success: false, error: '文件不在协作项目中' };
  });
  ipcMain.handle('collab-release-lock', async (e, filePath) => {
    if (isJoined(filePath)) { collabClient.releaseLock(filePath); return { success: true }; }
    if (isHosted(filePath)) { collabServer.hostReleaseLock(filePath); return { success: true }; }
    return { success: true };
  });

  // ── 编译投票 ──
  ipcMain.handle('collab-compile-request', async (e, projectPath) => {
    if (isJoined(projectPath)) { collabClient.send('compile-request', {}); return { success: true }; }
    if (isHosted(projectPath)) { collabServer.hostCompileRequest(); return { success: true }; }
    return { success: false, error: '项目不在协作中' };
  });
  ipcMain.handle('collab-compile-vote', async (e, { voteId, agree }) => {
    if (collabClient.getClientState().active) collabClient.send('compile-vote', { voteId, agree: !!agree });
    else collabServer.hostVote(String(voteId || ''), !!agree);
    return { success: true };
  });
  ipcMain.handle('collab-compile-cancel', async (e, voteId) => {
    if (collabClient.getClientState().active) collabClient.send('compile-cancel', { voteId });
    else collabServer.hostCompileCancel(String(voteId || ''));
    return { success: true };
  });
  // ★ 终止协同编译：改为协议类型名 compile-abort（与编译投票取消 compile-cancel 区分）
  ipcMain.handle('collab-compile-abort', async (e, voteId) => {
    const vid = String(voteId || '');
    if (collabClient.getClientState().active) collabClient.send('compile-abort', { voteId: vid });
    else collabServer.hostCompileAbort(vid);
    return { success: true };
  });

  // ── 图片共享文件区上传（仅图片 → 全队共享目录，保证主机编译能找到） ──
  ipcMain.handle('collab-upload-shared', async (e, { filePath, name }) => {
    if (!filePath) return { success: false, error: '无文件' };
    // ★ 图片共享文件区：仅允许图片，非图片拒绝上传
    if (!SHARED_IMAGE_EXTS.test(filePath)) return { success: false, error: '仅支持图片文件（png/jpg/jpeg/gif/bmp/webp/svg/tif/tiff）' };
    try {
      const buf = fs.readFileSync(filePath);
      const content = buf.toString('base64');
      const safe = String(name || path.basename(filePath)).replace(/[<>:"/\\|?*]/g, '_');
      const hs = collabServer.hostStatus();
      if (hs && hs.active && hs.project) {
        // ★ v2.6 共享文件区改到一级目录 Workspace-Share/<projectName>/，不再嵌在项目目录里
        const sharedDir = typeof collabServer.getSharedDir === 'function' ? collabServer.getSharedDir() : '';
        const sharedPath = sharedDir ? path.join(sharedDir, safe) : path.join(hs.project.path, '共享文件区', safe);
        collabServer.hostSaveFile(sharedPath, content, true);
      } else if (collabClient.getClientState().active) {
        // 客户端：写本机镜像 workDir/共享文件区/，并让主机落盘到其真实共享目录 Workspace-Share/<项目>/
        collabClient.saveSharedFile(safe, content, true);
      } else {
        return { success: false, error: '未处于协作中' };
      }
      return { success: true, name: safe };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── 图片共享文件区删除（方案三：任何成员都可删除，等同房主权限） ──
  ipcMain.handle('collab-delete-shared', async (e, { name }) => {
    const safe = String(name || '').replace(/[<>:"/\\|?*]/g, '_');
    if (!safe) return { success: false, error: '无文件名' };
    const hs = collabServer.hostStatus();
    const csState = collabClient.getClientState();
    try {
      if (hs && hs.active && hs.project) {
        const sharedDir = typeof collabServer.getSharedDir === 'function' ? collabServer.getSharedDir() : '';
        if (!sharedDir) return { success: false, error: '共享目录不存在' };
        const sharedPath = path.join(sharedDir, safe);
        collabServer.hostDeleteFile(sharedPath);
        return { success: true };
      } else if (csState && csState.active) {
        const sharedDir = typeof collabClient.sharedDir === 'function' ? collabClient.sharedDir() : '';
        if (!sharedDir) return { success: false, error: '共享目录不存在' };
        collabClient.deleteSharedFile(safe);
        return { success: true };
      }
      // ★ 常驻：未协作时也允许删除，按最近项目名定位共享目录（与 collab-list-shared 兜底一致）
      const sharedDir = typeof collabServer.getSharedDir === 'function' ? collabServer.getSharedDir() : '';
      if (sharedDir) {
        collabServer.hostDeleteFile(path.join(sharedDir, safe));
        return { success: true };
      }
      return { success: false, error: '未处于协作中' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ── WiFi 信息（netsh 读取；连接为尽力而为） ──
  const execFileP = (cmd, args) => new Promise(res => {
    try {
      const { execFile } = require('child_process');
      execFile(cmd, args, { encoding: 'utf8' }, (err, stdout) => res(err ? '' : String(stdout || '')));
    } catch (_) { res(''); }
  });
  ipcMain.handle('collab-wifi-info', async () => {
    const cur = await execFileP('netsh', ['wlan', 'show', 'interfaces']);
    let ssid = '';
    const m = /SSID\s*:\s*([^\r\n]+)/.exec(cur);
    if (m) ssid = m[1].trim();
    const listRaw = await execFileP('netsh', ['wlan', 'show', 'networks']);
    const nets = [];
    const re = /SSID\s*\d+\s*:\s*(.+)/g;
    let mm;
    while ((mm = re.exec(listRaw))) { const s = mm[1].trim(); if (s && !nets.includes(s)) nets.push(s); }
    return { success: true, ssid, networks: nets, ip: collabServer.localIp() };
  });
    ipcMain.handle('collab-tmp-pdf', async () => {
    const osMod = require('os');
    const pMod = require('path');
    return { success: true, path: pMod.join(osMod.tmpdir(), 'gongfang-collab-' + Date.now() + '.pdf') };
  });
  ipcMain.handle('collab-device-name', async () => ({ success: true, name: os.hostname() }));

  // ── 房主踢人（按成员序号 n） ──
  ipcMain.handle('collab-kick-member', async (e, n) => {
    const hs = collabServer.hostStatus();
    if (!hs.active) return { success: false, error: '非房主' };
    return collabServer.hostKickMember(n);
  });

  // ── 共享文件夹内容列表（主机=Workspace-Share/<项目>；成员=本机临时副本/共享文件区） ──
  // ★ 常驻：即使退出协作（主机 stopHost 清空项目、成员 leave 清空镜像）也返回共享目录，
  //   保证设置面板「图片共享文件区」始终能显示已上传图片。
  ipcMain.handle('collab-list-shared', async () => {
    const hs = collabServer.hostStatus();
    const csState = collabClient.getClientState();
    let dir = '';
    // 主机正协作：用其真实共享目录；成员正协作：用本机镜像
    if (hs && hs.active && hs.project) {
      dir = typeof collabServer.getSharedDir === 'function' ? collabServer.getSharedDir() : '';
    } else if (csState && csState.active) {
      dir = typeof collabClient.sharedDir === 'function' ? collabClient.sharedDir() : (collabClient.getWorkDir ? path.join(collabClient.getWorkDir() || '', '共享文件区') : '');
    }
    // ★ 兜底：未协作时读取常驻共享目录（主机端按最近项目名定位）
    if (!dir && typeof collabServer.getSharedDir === 'function') dir = collabServer.getSharedDir();
    if (!dir) return { success: false, error: '未在协作中' };
    const files = [];
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      items.forEach((it) => {
        const full = path.join(dir, it.name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch (_) {}
        files.push({ name: it.name, isDir: it.isDirectory(), size });
      });
    } catch (e) { return { success: false, error: e.message }; }
    return { success: true, dir, files };
  });
}

module.exports = { register };
