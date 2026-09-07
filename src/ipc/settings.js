// Gongfang v2.6 — 设置 IPC 路由
const { ipcMain } = require('electron');
const dbModule = require('../core/database');
const latexEnv = require('../env/latex');

function register(ctx) {
  ipcMain.handle('db-get-settings', async () => {
    try { return { success: true, settings: dbModule.getAllSettings() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('db-save-settings', async (event, settings) => {
    try {
      const protectedKeys = []; // 激活状态需要保存到数据库
      for (const [key, value] of Object.entries(settings)) {
        if (protectedKeys.includes(key)) continue;
        dbModule.setSetting(key, value);
      }
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  
  // ★ 已删除用量统计 handler（record-usage / get-usage-stats / get-hourly-stats）：用量面板已下线

  // ── LaTeX 环境 ──
  
  
  
  // 环境配置：检测系统 LaTeX（宏包安装已迁移到集成环境面板）
  ipcMain.handle('latex-detect-system', async () => {
    return latexEnv.detectSystemLatex();
  });
}

module.exports = { register };
