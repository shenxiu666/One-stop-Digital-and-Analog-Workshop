// 一站式数模工坊 — 工作目录 IPC（自选文件夹 + 最近历史）
// 替代老项目的"固定 workspace/ 目录选任务"模式：
//   +新建 = 系统对话框自选文件夹 → setWorkspaceOverride → 即为当前工作目录。
// 历史记录存 settings 表 workshopRecentDirs（JSON 数组，最多 10 条）。
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const dbModule = require('../core/database');

const MAX_RECENT = 10;

function loadRecent() {
  try {
    const raw = dbModule.getSetting('workshopRecentDirs', '');
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => x && x.path) : [];
  } catch { return []; }
}

function saveRecent(list) {
  try { dbModule.setSetting('workshopRecentDirs', JSON.stringify(list.slice(0, MAX_RECENT))); } catch {}
}

function touchRecent(dirPath) {
  const abs = path.resolve(dirPath);
  let list = loadRecent().filter(x => path.resolve(x.path) !== abs);
  list.unshift({ path: abs, name: path.basename(abs), lastOpened: new Date().toISOString() });
  list = list.slice(0, MAX_RECENT);
  saveRecent(list);
  return list;
}

function register(ctx) {
  // ── 弹出系统对话框选择工作目录（不直接切换，只返回路径）──
  ipcMain.handle('workshop:open-directory', async () => {
    try {
      const win = ctx.getMainWindow();
      const result = await dialog.showOpenDialog(win, {
        title: '选择工作目录',
        buttonLabel: '设为工作目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) {
        return { success: false, canceled: true };
      }
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 设为当前工作目录（不存在则创建）──
  ipcMain.handle('workshop:set-workdir', async (event, dirPath) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') return { success: false, error: '路径无效' };
      const abs = path.resolve(dirPath);
      try {
        if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
        if (!fs.statSync(abs).isDirectory()) return { success: false, error: '目标不是文件夹' };
      } catch (e) {
        return { success: false, error: '无法访问该目录：' + e.message };
      }
      ctx.setWorkspaceOverride(abs);
      const recent = touchRecent(abs);
      return { success: true, path: abs, name: path.basename(abs), recent };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 取最近目录（过滤已不存在的）──
  ipcMain.handle('workshop:get-recent', async () => {
    try {
      const list = loadRecent().filter(x => { try { return fs.existsSync(x.path); } catch { return false; } });
      const current = ctx.getWorkDir ? (ctx.getWorkDir() || '') : '';
      return { success: true, recent: list, current };
    } catch (err) {
      return { success: false, error: err.message, recent: [] };
    }
  });

  // ── 当前工作目录 ──
  ipcMain.handle('workshop:get-workdir', async () => {
    try {
      const dir = ctx.getWorkDir ? (ctx.getWorkDir() || '') : '';
      return { success: true, path: dir };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 退出当前目录（回到未选择态）──
  ipcMain.handle('workshop:leave-workdir', async () => {
    try {
      ctx.setWorkspaceOverride('');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 删除单条历史（只动历史列表，不动当前工作目录）──
  ipcMain.handle('workshop:remove-recent', async (event, dirPath) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') return { success: false, error: '路径无效' };
      const abs = path.resolve(dirPath);
      const list = loadRecent().filter(x => { try { return path.resolve(x.path) !== abs; } catch { return true; } });
      saveRecent(list);
      return { success: true, recent: list };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 清除历史 ──
  ipcMain.handle('workshop:clear-recent', async () => {
    try {
      saveRecent([]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 兼容旧调用：set-workspace-override / clear-workspace-override ──
  ipcMain.handle('set-workspace-override', async (event, wsPath) => {
    try {
      if (!wsPath) { ctx.setWorkspaceOverride(''); return { success: true }; }
      const abs = path.resolve(wsPath);
      if (!fs.existsSync(abs)) return { success: false, error: '路径不存在' };
      ctx.setWorkspaceOverride(abs);
      touchRecent(abs);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('clear-workspace-override', async () => {
    try { ctx.setWorkspaceOverride(''); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
}

module.exports = { register };
