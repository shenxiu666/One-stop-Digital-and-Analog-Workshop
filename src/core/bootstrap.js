// 一站式数模工坊 — 启动引导
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const STARTUP_LOG = path.join(os.tmpdir(), 'gongfang-startup.log');
function startupLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(STARTUP_LOG, line + '\n', 'utf-8'); } catch {}
  try { require('./logger').log(msg); } catch {}
}
function startupErr(msg, err) {
  startupLog(`ERROR: ${msg}` + (err ? ': ' + (err.stack || err.message || err) : ''));
  try { dialog.showErrorBox('一站式数模工坊启动失败', msg + (err ? '\n\n' + (err.message || err) : '')); } catch {}
}

function getRootDir() {
  if (app.isPackaged) return app.getPath('userData');
  return path.join(__dirname, '..', '..');
}

function getIconPath() {
  const icoPath = path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.ico');
  if (fs.existsSync(icoPath)) return icoPath;
  return undefined; // 留空：无图标文件时用 Electron 默认图标
}

// ═══════════════════════════════════════
// PATH 清理（移除外部 TeX 路径，避免与集成环境冲突）
// ═══════════════════════════════════════
function cleanTexFromPath() {
  const sep = path.delimiter;
  const isExternalTex = (dir) => {
    if (!dir || typeof dir !== 'string') return false;
    const n = dir.replace(/\\/g, '/').toLowerCase();
    if (n.includes('/assets/tinytex/')) return false;
    return n.includes('/texlive/') || n.endsWith('/texbin')
      || n.includes('/tinytex/bin/') || n.includes('/miktex/') || n.includes('/texmf/');
  };
  const cleaned = (process.env.PATH || '').split(sep).filter(d => !isExternalTex(d)).join(sep);
  process.env.PATH = cleaned;
  process.env.Path = cleaned;
}

// ═══════════════════════════════════════
// 主启动流程
// ═══════════════════════════════════════
async function bootstrap() {
  let mainWindow = null;
  const isDev = process.argv.includes('--dev');

  const multiInstance = process.argv.includes('--multi-instance');
  const appDataDir = app.getPath('appData');
  const config = require('./config');
  const dataDirName = multiInstance
    ? 'YZS-Gongfang-collab'
    : (config.dataDirName || 'YZS-Gongfang-1.0.0');
  try { app.setPath('userData', path.join(appDataDir, dataDirName)); } catch (e) {}

  startupLog('一站式数模工坊 v' + (require('../../package.json').version || 'unknown') + ' 启动中...');
  startupLog(`Node: ${process.version} | Platform: ${os.platform()} | CWD: ${process.cwd()}`);

  process.on('uncaughtException', (err) => {
    startupErr('未捕获的异常', err);
    const msg = String(err?.message || err?.stack || err || '');
    const fatalPattern = /better-sqlite3|NODE_MODULE_VERSION|was compiled against|module version mismatch|sharp|\.node:|libvips|invalid ELF/i;
    if (fatalPattern.test(msg)) {
      startupLog('FATAL: 原生组件错误，3 秒后退出（提示用户修复）');
      setTimeout(() => {
        try {
          dialog.showErrorBox('运行环境异常', '检测到原生组件与当前运行环境不匹配（可能因杀软隔离/安装损坏）。\n请卸载后重新安装软件，或在「设置」中重新检查环境。');
        } catch {}
        process.exit(1);
      }, 3000);
    } else {
      startupLog('NON-FATAL: 已捕获可恢复异常，应用继续运行');
    }
  });
  process.on('unhandledRejection', (reason) => {
    startupLog('ERROR: 未处理的 Promise 拒绝: ' + (reason?.stack || reason?.message || reason));
  });

  // 单实例锁（--multi-instance 时跳过，用于单机双开联调协作）
  if (!multiInstance) {
    startupLog('获取单实例锁...');
    if (!app.requestSingleInstanceLock()) {
      startupLog('已有实例在运行，退出');
      app.quit();
      process.exit(0);
    }
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  cleanTexFromPath();
  startupLog('PATH 清理完成');

  startupLog('加载核心模块...');
  const { createWindow } = require('./window');
  const { create: createWorkspace } = require('./workspace');
  const dbModule = require('./database');
  const { registerAll } = require('../ipc/index');
  const procMgr = require('./process-manager');
  const collabServer = require('../services/collab-server');
  const collabClient = require('../services/collab-client');
  startupLog('所有核心模块加载完成');

  const rootDir = getRootDir();
  startupLog('Root directory: ' + rootDir);
  const { db, dataDir } = dbModule.init(rootDir);

  // ★ 外部集成环境：启动时读取用户手动指定目录 + 分层自动检测
  try {
    const { getAppEnvDir, setConfiguredAppEnvPath } = require('../env/assets');
    try { setConfiguredAppEnvPath(String(dbModule.getSetting('appEnvPath', '') || '')); } catch {}
    const appEnvDir = getAppEnvDir();
    startupLog(appEnvDir ? '检测到集成环境: ' + appEnvDir : '未检测到集成环境（回退内置资源）');
  } catch (e) {}

  const workspace = createWorkspace(rootDir);
  startupLog('工作区创建完成');

  // 构建上下文（无任务/模板概念：只有自选工作目录）
  const ctx = {
    config, db, dataDir,
    getMainWindow: () => mainWindow,
    getWorkDir: () => workspace.getWorkDir(),
    setWorkspaceOverride: (p) => { workspace.setWorkspaceOverride(p); },
    getWorkspaceTimestamp: () => workspace.getWorkspaceTimestamp(),
    workspace,
    projectsDir: workspace.projectsDir,
  };

  startupLog('注册 IPC 模块...');
  registerAll(ctx);

  function cleanupOnExit() {
    try { procMgr.killAll(); } catch {}
    try { procMgr.killOrphans(); } catch {}
    try { collabServer.stopHost && collabServer.stopHost(); } catch {}
    try { collabClient.leave && collabClient.leave(); } catch {}
    try { if (collabClient.cleanupStaleCollabDirs) collabClient.cleanupStaleCollabDirs(); } catch {}
    try { dbModule.close(); } catch {}
  }
  app.on('before-quit', () => { cleanupOnExit(); });
  app.on('window-all-closed', () => {
    cleanupOnExit();
    app.quit();
  });
  process.on('SIGTERM', () => { cleanupOnExit(); process.exit(0); });
  process.on('SIGINT', () => { cleanupOnExit(); process.exit(0); });
  if (process.platform === 'win32') {
    try {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.on('SIGINT', () => { cleanupOnExit(); process.exit(0); });
    } catch {}
  }

  startupLog('等待 app.whenReady()...');

  app.whenReady().then(() => {
    startupLog('app.whenReady() 触发，创建窗口...');
    try { require('./logger').rotate(); } catch {}
    mainWindow = createWindow(config, getIconPath);

    try {
      mainWindow.webContents.on('console-message', (event, ...args) => {
        let lvl = 1, message = '';
        if (args.length >= 2 && args[1] && typeof args[1] === 'object') {
          const d = args[1];
          lvl = d.level !== undefined ? d.level : 1;
          message = String(d.message || '');
        } else {
          lvl = args[0] !== undefined ? args[0] : 1;
          message = String(args[1] !== undefined ? args[1] : '');
        }
        if (!message) return;
        const tag = lvl >= 3 ? 'renderer-ERR' : (lvl === 2 ? 'renderer-WARN' : 'renderer');
        require('./logger').log('[' + tag + '] ' + message.slice(0, 400));
      });
    } catch (e) {}

    mainWindow.on('page-title-updated', (event) => { event.preventDefault(); });
    mainWindow.on('closed', () => { mainWindow = null; });
    startupLog('启动完成');
  }).catch((err) => {
    startupErr('app.whenReady() 失败', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(config, getIconPath);
    }
  });
}

module.exports = { bootstrap };
