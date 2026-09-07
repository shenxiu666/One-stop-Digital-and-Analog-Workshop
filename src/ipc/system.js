// 一站式数模工坊 — 系统 IPC 路由
const { ipcMain } = require('electron');
const latexEnv = require('../env/latex');
const pythonEnv = require('../env/python');
const wordExport = require('../services/word-export');

function register(ctx) {
  // ★ 主题切换时动态更新原生标题栏覆盖按钮（最小化/最大化/关闭）配色
  ipcMain.handle('set-titlebar-overlay', async (event, { color, symbolColor, height }) => {
    const win = ctx.getMainWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.setTitleBarOverlay({
        color: color || '#ffffff',
        symbolColor: symbolColor || '#18181b',
        height: height || 30
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ★ 已删除 export-diagnostics-log：应用相关面板已下线

  // ── 环境检测 ──
  ipcMain.handle('check-environment', async () => {
    const { getAppEnvDir, setConfiguredAppEnvPath } = require('../env/assets');
    const dbModule = require('../core/database'); // ★ ctx.db 是 better-sqlite3 实例（无 getSetting 方法），改用 dbModule.getSetting
    // ★ 每次检测都同步用户手动指定的集成环境目录（存数据库；重装/换位置后仍生效）
    let cfgPath = '';
    try {
      cfgPath = String(dbModule.getSetting('appEnvPath', '') || '');
      setConfiguredAppEnvPath(cfgPath);
    } catch {}
    const appEnvRoot = getAppEnvDir() || '';
    const results = {
      python: { ok: false, version: '' },
      latex: { ok: false, version: '', source: 'none' },
      pandoc: { ok: false, version: '', path: '', source: 'none' }
    };

    // 检测 Python（内置 / 外部集成环境）
    const pythonStatus = pythonEnv.getStatus();
    if (pythonStatus.ready) {
      const srcLabel = pythonStatus.source === 'appenv' ? '集成环境 Python' : '内置 Python';
      results.python = { ok: true, version: srcLabel + ' ' + (pythonStatus.version || 'unknown') };
    } else {
      results.python = { ok: false, version: 'Python 环境未就绪' };
    }

    // 检测 LaTeX（内置 / 外部集成环境）
    const latexStatus = latexEnv.getStatus();
    if (latexStatus.installed) {
      const srcLabel = latexStatus.source === 'appenv' ? '集成环境 TinyTeX' : '内置 TinyTeX';
      results.latex = {
        ok: true,
        version: latexStatus.version ? (srcLabel + ' ' + latexStatus.version) : (srcLabel + ' 已就绪'),
        path: latexStatus.binDir || latexStatus.dir || '',
        packagesReady: latexStatus.packagesReady
      };
    } else {
      results.latex = { ok: false, version: '未安装' };
    }

    // 检测 pandoc（Word 导出必备工具，与 Python 必备库同级，依赖外部集成环境）
    const pandocStatus = wordExport.getPandocStatus();
    results.pandoc = {
      ok: pandocStatus.ok,
      version: pandocStatus.version || '',
      path: pandocStatus.path || '',
      source: pandocStatus.source
    };

    return {
      success: true,
      results,
      latexStatus,
      pythonStatus,
      pandocStatus,
      appEnv: {
        root: appEnvRoot,
        found: !!appEnvRoot,
        configured: cfgPath,   // 用户手动指定的目录（''=未指定，走自动检测）
        python: {
          dir: pythonStatus.envDir,
          pythonPath: pythonStatus.pythonPath,
          ready: pythonStatus.ready,
          version: pythonStatus.version,
          source: pythonStatus.source
        },
        latex: {
          dir: latexStatus.dir,
          binDir: latexStatus.binDir,
          xelatexPath: latexStatus.path,
          installed: latexStatus.installed,
          version: latexStatus.version,
          source: latexStatus.source
        },
        pandoc: {
          path: pandocStatus.path,
          ok: pandocStatus.ok,
          version: pandocStatus.version,
          source: pandocStatus.source
        },
        detectedAt: new Date().toISOString()
      }
    };
  });

  // ── Python 环境管理 ──
  
  
  
  // 环境配置：检测系统 Python（库安装已迁移到集成环境面板）
  ipcMain.handle('python-detect-system', async () => {
    return pythonEnv.detectSystemPython();
  });

  // ★ 已删除 test-api：模型配置面板已下线
}

module.exports = { register };
