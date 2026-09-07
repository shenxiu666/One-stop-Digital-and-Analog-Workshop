// Gongfang v2.6 — 扩展（Extension）IPC 路由
const { ipcMain, dialog } = require('electron');
const extensionService = require('../services/extension');

function register(ctx) {
  extensionService.init(ctx);

  // 列出所有扩展（含 builtin + thirdparty，含 enabled 状态）
  ipcMain.handle('extension:list', async () => {
    try { return { success: true, extensions: extensionService.listExtensions() }; }
    catch (e) { return { success: false, error: e && e.message || String(e) }; }
  });

  // 启用
  ipcMain.handle('extension:enable', (e, id) => {
    try { return extensionService.enableExtension(id); }
    catch (err) { return { success: false, error: err && err.message || String(err) }; }
  });

  // 禁用
  ipcMain.handle('extension:disable', (e, id) => {
    try { return extensionService.disableExtension(id); }
    catch (err) { return { success: false, error: err && err.message || String(err) }; }
  });

  // 卸载（仅 thirdparty）
  ipcMain.handle('extension:uninstall', (e, id) => {
    try { return extensionService.uninstallExtension(id); }
    catch (err) { return { success: false, error: err && err.message || String(err) }; }
  });

  // 从 zip 包或目录安装
  
  // 选择本地 zip 包并安装
  ipcMain.handle('extension:install-from-dialog', async () => {
    try {
      const r = await dialog.showOpenDialog({
        title: '选择扩展包',
        filters: [{ name: '扩展包', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths.length) return { success: false, canceled: true };
      return await extensionService.installExtension(r.filePaths[0]);
    } catch (err) { return { success: false, error: err && err.message || String(err) }; }
  });

  // 打开用户扩展目录（资源管理器）
  ipcMain.handle('extension:open-user-dir', () => {
    try {
      const { shell } = require('electron');
      shell.openPath(extensionService.getUserExtDir());
      return { success: true };
    } catch (err) { return { success: false, error: err && err.message || String(err) }; }
  });

  // 获取内置扩展目录路径（dev 时供调试）
  
  // 重新扫描（开发期热刷新用）
  ipcMain.handle('extension:reload', async () => {
    try {
      const list = extensionService.scanExtensions();
      return { success: true, extensions: list.map(m => ({
        id: m.id, name: m.name, version: m.version, type: m.type, enabled: m.enabled
      })) };
    } catch (e) { return { success: false, error: e && e.message || String(e) }; }
  });
}

module.exports = { register };
