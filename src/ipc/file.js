// Gongfang v2.6 — 文件操作 IPC 路由
const { ipcMain, dialog, shell } = require('electron');
const fileService = require('../services/file');

function register(ctx) {
  fileService.init(ctx);

  // ★ 协作态路径判定：与 ipc/collab.js 一致，用于把编辑器的保存/读取路由到协同同步链路
  const collabServerRef = require('../services/collab-server');
  const collabClientRef = require('../services/collab-client');
  const _collabNorm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const _collabIsHosted = (filePath) => {
    try {
      const hs = collabServerRef.hostStatus && collabServerRef.hostStatus();
      return !!(hs && hs.active && hs.project && filePath && _collabNorm(filePath).indexOf(_collabNorm(hs.project.path)) === 0);
    } catch (_) { return false; }
  };
  const _collabIsJoined = (filePath) => {
    try {
      const cs = collabClientRef.getClientState && collabClientRef.getClientState();
      if (!cs || !cs.active || !filePath) return false;
      const p = _collabNorm(filePath);
      const work = cs.project ? _collabNorm(cs.project.path) : '';
      const server = cs.project ? _collabNorm(cs.project.serverPath) : '';
      return (work && p.indexOf(work) === 0) || (server && p.indexOf(server) === 0);
    } catch (_) { return false; }
  };

  // ★ 路径安全校验（防止任意文件访问）— 在 register 内部定义以访问 ctx
  const pathModule = require('path');
  const osModule = require('os');
  function isPathAllowed(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const resolved = pathModule.resolve(filePath);
    // 允许的目录：工作区、项目目录、自定义输出、workspace 目录、应用目录、桌面/文档
    const appDir = pathModule.resolve(__dirname, '../..');
    // ★ P1-6: 桌面/文档用 Electron 的系统重定向路径（OneDrive/换盘后不再指向错误的固定路径），
    //   取不到时再回退 os.homedir() 拼接。
    let desktop = '', documents = '', userData = '';
    try {
      const { app } = require('electron');
      desktop = app.getPath('desktop') || '';
      documents = app.getPath('documents') || '';
      userData = app.getPath('userData') || '';
    } catch {}
    if (!desktop) desktop = pathModule.join(osModule.homedir(), 'Desktop');
    if (!documents) documents = pathModule.join(osModule.homedir(), 'Documents');
    const allowedPrefixes = [
      ctx?.getWorkDir?.(),
      appDir, // 应用根目录（包含 workspace）
      pathModule.join(appDir, 'workspace'),
      desktop,
      documents,
      userData,
      // ★ 协同编译成员端需要把下发的 PDF(base64) 写入系统临时目录再渲染；
      //   若不放行临时目录，write-file-base64 会直接命中 isPathAllowed 拒绝，成员永远看不到 PDF。
      osModule.tmpdir(),
    ].filter(Boolean);
    // ★ 扩展目录放行（打包态下 getBuiltinDir 在 process.resourcesPath，不在 appDir 内）
    try {
      const extService = require('../services/extension');
      allowedPrefixes.push(extService.getBuiltinDir());
      allowedPrefixes.push(extService.getUserExtDir());
    } catch {}
    // ★ P2-8: 工作区根目录（所有历史任务的父目录）始终放行。
    //   getWorkDir() 只覆盖"当前模板+当前时间戳"派生的单个路径，历史任务目录
    //   workspace/<模板>_<时间戳> 的绝对路径不在其前缀内 → 点击任务卡片时
    //   read-directory-tree / list-dir-files / read-file-content 全被 isPathAllowed
    //   拒绝，文件界面显示"暂无文件"。把 workspace 根目录纳入前缀即可覆盖全部历史任务。
    try {
      const wsRoot =
        (ctx?.workspace && ctx.workspace.workspaceDir) ||
        (ctx?.projectsDir ? pathModule.join(pathModule.dirname(ctx.projectsDir), 'workspace') : '');
      if (wsRoot) allowedPrefixes.push(wsRoot);
    } catch {}
    // ★ 规则库（rules-library）路径放行：右栏编辑器需读/写/删求解规则与模板格式源文件。
    //   与 services/file.js 的 isPathSafe 白名单保持一致。
    try {
      const rlBase = ctx?.rulesLib && typeof ctx.rulesLib.getBaseDir === 'function' ? ctx.rulesLib.getBaseDir() : '';
      if (rlBase) allowedPrefixes.push(rlBase);
    } catch {}
    try {
      allowedPrefixes.push(pathModule.join(pathModule.resolve(__dirname, '..', '..'), 'rules-library'));
    } catch {}
    return allowedPrefixes.some(prefix => resolved.startsWith(pathModule.resolve(prefix)));
  }

  ipcMain.handle('open-file-dialog', async (event, options) => {
    const dialogOptions = {
      title: options.title || '选择文件',
      properties: options.properties || ['openFile', 'multiSelections'],
    };
    if (options.filters && options.filters.length > 0) {
      dialogOptions.filters = options.filters;
    }
    const result = await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('open-folder-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      filters: options?.filters || [],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // ★ 已删除任务期 handler（prepare-workspace / copy-file-to-project / copy-folder-to-project /
  //   copy-folder-to-dir / remove-project-file）：调用方（任务上传页/模板编辑器）已下线

  ipcMain.handle('read-directory-tree', async (event, { dirPath, maxDepth = 5, options }) => {
    // ★ 安全校验：限制只能访问允许的目录
    if (!isPathAllowed(dirPath)) return { success: false, error: '路径不在允许范围内', files: [] };
    return fileService.readDirectoryTree(dirPath, maxDepth, options);
  });

  ipcMain.handle('list-dir-files', async (event, dirPath) => {
    // ★ 安全校验：限制只能访问允许的目录
    if (!isPathAllowed(dirPath)) return { files: [], error: '路径不在允许范围内' };
    try {
      const fs = require('fs');
      const path = require('path');
      if (!fs.existsSync(dirPath)) return { files: [] };
      const files = [];
      let fileCount = 0;
      const MAX_FILES = 1000; // 限制最大文件数
      function scanDir(dir) {
        if (fileCount >= MAX_FILES) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (fileCount >= MAX_FILES) break;
          const full = path.join(dir, entry.name);
          if (entry.isFile()) {
            let size = 0;
            try { size = fs.statSync(full).size; } catch {}
            files.push({ name: entry.name, path: full, size });
            fileCount++;
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            scanDir(full);
          }
        }
      }
      scanDir(dirPath);
      return { files };
    } catch (err) {
      return { files: [], error: err.message };
    }
  });

  
  // ★ 用 sharp 渲染 PDF 的多个页面为 base64 PNG
  
  ipcMain.handle('read-file-content', async (event, filePath, options) => {
    // ★ 安全校验：限制只能访问允许的目录
    // trusted=true 时跳过检查（用于系统文件对话框选择的文件）
    if (!options?.trusted && !isPathAllowed(filePath)) return { success: false, error: '路径不在允许范围内' };
    // ★ 读取仍走本地磁盘：主机读到权威副本、成员读到 workDir 同步镜像，且保留图片/Excel/PDF/编码自适应处理
    return fileService.readFileContent(filePath);
  });

  // ★ 按 base64 读任意用户选择的文件（绘图插入图片用；路径由系统对话框选择，视为可信）
  ipcMain.handle('read-file-base64', async (event, filePath) => {
    try {
      const fs = require('fs');
      const pathM = require('path');
      if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
      const buf = fs.readFileSync(filePath);
      const ext = pathM.extname(filePath).slice(1).toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext] || 'image/png';
      return { success: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('write-file-content', async (event, filePath, content, options) => {
    // ★ 安全校验：仅校验"非用户确认"的路径。
    //   options.trusted=true 表示该路径来自系统"另存为"对话框（用户已确认），视为可信，不再拦截。
    //   （否则用户把新文件存到"下载"等不在白名单的目录时会被拒，导致"另存为"看似成功实际没落盘。）
    if (!options?.trusted && !isPathAllowed(filePath)) return { success: false, error: '路径不在允许范围内' };
    // ★ 协作态下写入必须走协同同步链路（否则成员只写本地、主机收不到 save-file，数据永远不同步）
    //   v2.6.13：若文件尚未存在（新建），走 create-file 广播；已存在（编辑保存）走 save-file。
    //   （用户另存为的可信路径，不参与协作路由。）
    if (!options?.trusted) {
      try {
        const fs = require('fs');
        if (_collabIsJoined(filePath)) {
          if (!fs.existsSync(filePath)) collabClientRef.createFile(filePath, content, false);
          else collabClientRef.saveFile(filePath, content, false);
          return { success: true };
        }
        if (_collabIsHosted(filePath)) {
          if (!fs.existsSync(filePath)) collabServerRef.hostCreateFile(filePath, content, false);
          else collabServerRef.hostSaveFile(filePath, content, false);
          return { success: true };
        }
      } catch (_) {}
    }
    return fileService.writeFileContent(filePath, content, options);
  });

  ipcMain.handle('write-file-base64', async (event, filePath, base64, options) => {
    if (!options?.trusted && !isPathAllowed(filePath)) return { success: false, error: '路径不在允许范围内' };
    // ★ 协作态二进制写入同样走同步链路（新建走 create-file，已存在走 save-file）
    if (!options?.trusted) {
      try {
        const fs = require('fs');
        if (_collabIsJoined(filePath)) {
          if (!fs.existsSync(filePath)) collabClientRef.createFile(filePath, base64, true);
          else collabClientRef.saveFile(filePath, base64, true);
          return { success: true };
        }
        if (_collabIsHosted(filePath)) {
          if (!fs.existsSync(filePath)) collabServerRef.hostCreateFile(filePath, base64, true);
          else collabServerRef.hostSaveFile(filePath, base64, true);
          return { success: true };
        }
      } catch (_) {}
    }
    return fileService.writeFileBase64(filePath, base64, options);
  });

  
  ipcMain.handle('open-in-finder', async (event, dirPath) => {
    if (!fileService.isPathSafe(dirPath)) return { success: false, error: '路径不在允许范围内' };
    try { await shell.openPath(dirPath); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  
  // 保存文件对话框
  ipcMain.handle('save-file-dialog', async (event, defaultName) => {
    const win = ctx.getMainWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    return result;
  });

  // ★ 保存二进制文件（对话框选路径 + 直接写入 base64/dataUrl）：绘图导出 PNG 用
  ipcMain.handle('save-binary-dialog', async (event, opts) => {
    try {
      const fs = require('fs');
      const win = ctx.getMainWindow();
      const ext = (opts && opts.extensions && opts.extensions[0]) || 'png';
      const result = await dialog.showSaveDialog(win, {
        defaultPath: (opts && opts.defaultName) || ('file.' + ext),
        filters: [{ name: '保存文件', extensions: [ext] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: '已取消' };
      let filePath = result.filePath;
      if (ext && !new RegExp('\\.' + ext + '$', 'i').test(filePath)) filePath += '.' + ext;
      const raw = String((opts && opts.base64) || '');
      const b64 = raw.indexOf('data:') === 0 ? (raw.split(',')[1] || '') : raw;
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return { success: false, error: '导出内容为空' };
      fs.writeFileSync(filePath, buf);
      // ★ 校验写入结果：防止"已保存"但文件实际未落盘/被写为空文件
      try {
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size <= 0) return { success: false, error: '保存内容为空或未写入' };
      } catch (e) { return { success: false, error: '保存写入失败：' + e.message }; }
      // ★ 已通过系统"另存为"对话框选择路径，用户知道文件在哪，不再自动弹资源管理器
      return { success: true, path: filePath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ★ 保存文本文件（对话框选路径 + 直接写入）：路径由用户通过系统对话框选择，视为可信
  ipcMain.handle('save-text-dialog', async (event, opts) => {
    try {
      const fs = require('fs');
      const win = ctx.getMainWindow();
      const ext = (opts && opts.extensions && opts.extensions[0]) || 'svg';
      const result = await dialog.showSaveDialog(win, {
        defaultPath: (opts && opts.defaultName) || ('file.' + ext),
        filters: [{ name: '保存文件', extensions: [ext] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: '已取消' };
      let filePath = result.filePath;
      if (ext && !new RegExp('\\.' + ext + '$', 'i').test(filePath)) filePath += '.' + ext;
      const text = String((opts && opts.content) || '');
      if (!text.length) return { success: false, error: '导出内容为空' };
      fs.writeFileSync(filePath, text, 'utf-8');
      // ★ 校验写入结果：防止"已保存"但文件实际未落盘/被写为空文件
      try {
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size <= 0) return { success: false, error: '保存内容为空或未写入' };
      } catch (e) { return { success: false, error: '保存写入失败：' + e.message }; }
      // ★ 已通过系统"另存为"对话框选择路径，用户知道文件在哪，不再自动弹资源管理器
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 复制文件到指定路径
  // ★ 代码工作台：扫描输出文件（图片/表格）含修改时间，用于输出记录里展示产物卡片
  ipcMain.handle('scan-output-files', async (event, { dirPath, sinceMs }) => {
    if (!isPathAllowed(dirPath)) return { success: false, error: '路径不在允许范围内', files: [] };
    try {
      const fsM = require('fs');
      const pathM = require('path');
      const exts = /\.(png|jpe?g|gif|svg|webp|csv|xlsx?)$/i;
      const out = [];
      function scan(dir, depth) {
        if (depth > 4) return;
        let entries;
        try { entries = fsM.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const full = pathM.join(dir, e.name);
          if (e.isDirectory()) scan(full, depth + 1);
          else if (exts.test(e.name)) {
            try {
              const st = fsM.statSync(full);
              if (!sinceMs || st.mtimeMs >= sinceMs) out.push({ path: full, name: e.name, mtime: st.mtimeMs, size: st.size });
            } catch {}
          }
        }
      }
      scan(dirPath, 0);
      out.sort((a, b) => b.mtime - a.mtime);
      return { success: true, files: out.slice(0, 100) };
    } catch (e) { return { success: false, error: e.message, files: [] }; }
  });

  // ★ 已删除 list-workspace-tasks：任务工作区扫描，调用方（代码面板任务菜单）已改为工作目录模式

  // ★ 代码工作台文件管理：创建文件夹 / 删除文件或文件夹
  ipcMain.handle('create-folder', async (event, dirPath) => {
    if (!isPathAllowed(dirPath)) return { success: false, error: '路径不在允许范围内' };
    try {
      const fs = require('fs');
      if (fs.existsSync(dirPath)) return { success: false, error: '已存在同名文件夹' };
      fs.mkdirSync(dirPath, { recursive: false });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ★ 重命名文件/文件夹
  ipcMain.handle('rename-path', async (event, { oldPath, newPath }) => {
    if (!isPathAllowed(oldPath) || !isPathAllowed(newPath)) return { success: false, error: '路径不在允许范围内' };
    try {
      const fs = require('fs');
      if (fs.existsSync(newPath)) return { success: false, error: '目标已存在' };
      fs.renameSync(oldPath, newPath);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('delete-path', async (event, targetPath) => {
    if (!isPathAllowed(targetPath)) return { success: false, error: '路径不在允许范围内' };
    try {
      const fs = require('fs');
      // ★ 保护：不允许删除工作区/求解等根目录本身
      const base = require('path').resolve(targetPath);
      const wk = ctx.getWorkDir ? require('path').resolve(ctx.getWorkDir()) : '';
      if (wk && (base === wk || base.startsWith(wk + require('path').sep))) {
        // 允许删除工作区内部，但禁止删工作区根
        if (base === wk) return { success: false, error: '不能删除工作区根目录' };
      }
      // ★ 协作态删除必须走协同同步链路：成员侧在 collab-client.deleteFile 里落地镜像后上报
      //   delete-file，主机在 collab-server.handleDeleteFile 里删权威盘并广播 file-deleted
      if (_collabIsJoined(targetPath)) {
        collabClientRef.deleteFile(targetPath);
        return { success: true };
      }
      if (_collabIsHosted(targetPath)) {
        collabServerRef.hostDeleteFile(targetPath);
        return { success: true };
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('check-pdf-valid', async (event, filePath) => {
    // ★ PDF 完整性校验：损坏/编译中断的 PDF 预览前返回 false，渲染层改显示空白
    if (!isPathAllowed(filePath)) return false;
    return fileService.isPdfValid(filePath);
  });

  ipcMain.handle('copy-file-to-path', async (event, src, dest) => {
    // ★ 安全校验：仅校验源文件必须在允许范围内。
    //   dest 为用户通过系统"另存为"对话框明确选择的目标路径（已由用户确认），视为可信，不再拦截。
    //   （若用 isPathAllowed(dest) 拦截，用户把文件存到"下载"等不在白名单目录时会被拒，导致"已保存"却找不到文件。）
    if (!isPathAllowed(src)) return { success: false, error: '源路径不在允许范围内' };
    try {
      const fs = require('fs');
      const path = require('path');
      if (!dest || typeof dest !== 'string') return { success: false, error: '目标路径无效' };
      // 确保目标目录存在
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      // ★ 校验复制结果：防止"已保存"但文件实际未落盘/被写为空文件
      let st;
      try {
        st = fs.statSync(dest);
        if (!st.isFile() || st.size <= 0) return { success: false, error: '保存内容为空或未写入' };
      } catch (e) { return { success: false, error: '保存写入失败：' + e.message }; }
      // ★ 复制到目标路径是后台数据同步（扫描产物拷贝/规则落盘等），不再自动弹资源管理器
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ★ 已删除 download-file / download-project / download-rule-folder：调用方已下线

}

module.exports = { register };
