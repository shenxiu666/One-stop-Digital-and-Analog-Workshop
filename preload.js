// 一站式数模工坊 — preload（精简版：文件/环境/写作/代码/协作/扩展/工作目录）
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 文件路径 ──
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return null; }
  },

  // ── 应用版本号（单一来源：package.json）──
  getAppVersion: () => {
    try { return require('./package.json').version || ''; } catch { return ''; }
  },

  // ── 文件对话框 ──
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  openFolderDialog: (options) => ipcRenderer.invoke('open-folder-dialog', options),

  // ── 工作目录（自选文件夹 + 最近历史）──
  workshopOpenDirectory: () => ipcRenderer.invoke('workshop:open-directory'),
  workshopSetWorkdir: (dirPath) => ipcRenderer.invoke('workshop:set-workdir', dirPath),
  workshopGetRecent: () => ipcRenderer.invoke('workshop:get-recent'),
  workshopGetWorkdir: () => ipcRenderer.invoke('workshop:get-workdir'),
  workshopLeaveWorkdir: () => ipcRenderer.invoke('workshop:leave-workdir'),
  workshopRemoveRecent: (dirPath) => ipcRenderer.invoke('workshop:remove-recent', dirPath),
  workshopClearRecent: () => ipcRenderer.invoke('workshop:clear-recent'),
  // 兼容旧名
  setWorkspaceOverride: (wsPath) => ipcRenderer.invoke('set-workspace-override', wsPath),
  clearWorkspaceOverride: () => ipcRenderer.invoke('clear-workspace-override'),

  // ── 目录树 / 文件读写 ──
  readDirectoryTree: (dirPath, maxDepth, options) =>
    ipcRenderer.invoke('read-directory-tree', { dirPath, maxDepth, options }),
  readFileContent: (filePath, options) => ipcRenderer.invoke('read-file-content', filePath, options),
  readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
  writeFileContent: (filePath, content, options) => ipcRenderer.invoke('write-file-content', filePath, content, options),
  writeFileBase64: (filePath, base64, options) => ipcRenderer.invoke('write-file-base64', filePath, base64, options),
  listDirFiles: (dirPath) => ipcRenderer.invoke('list-dir-files', dirPath),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('save-file-dialog', defaultName),
  saveTextDialog: (opts) => ipcRenderer.invoke('save-text-dialog', opts),
  saveBinaryDialog: (opts) => ipcRenderer.invoke('save-binary-dialog', opts),
  copyFileToPath: (src, dest) => ipcRenderer.invoke('copy-file-to-path', src, dest),
  checkPdfValid: (filePath) => ipcRenderer.invoke('check-pdf-valid', filePath),
  scanOutputFiles: (dirPath, sinceMs) => ipcRenderer.invoke('scan-output-files', { dirPath, sinceMs }),
  createFolder: (dirPath) => ipcRenderer.invoke('create-folder', dirPath),
  deletePath: (targetPath) => ipcRenderer.invoke('delete-path', targetPath),
  renamePath: (oldPath, newPath) => ipcRenderer.invoke('rename-path', { oldPath, newPath }),

  // ── LaTeX 编译 ──
  directCompile: (texPath, workDir, singlePass, engine) => ipcRenderer.invoke('direct-compile', { texPath, workDir, singlePass, engine }),
  findTexFile: (projectPath, subdir) => ipcRenderer.invoke('find-tex-file', (subdir ? { projectPath: projectPath, subdir: subdir } : projectPath)),

  // ── 系统操作 ──
  openInFinder: (dirPath) => ipcRenderer.invoke('open-in-finder', dirPath),

  // ── 环境检测 ──
  checkEnvironment: () => ipcRenderer.invoke('check-environment'),

  // ── 数据库设置同步 ──
  dbGetSettings: () => ipcRenderer.invoke('db-get-settings'),
  dbSaveSettings: (settings) => ipcRenderer.invoke('db-save-settings', settings),
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('set-titlebar-overlay', opts),

  // ── LaTeX / Python 环境 ──
  latexDetectSystem: () => ipcRenderer.invoke('latex-detect-system'),
  pythonDetectSystem: () => ipcRenderer.invoke('python-detect-system'),
  codeRun: (opts) => ipcRenderer.invoke('code-run', opts),
  codeStop: (id) => ipcRenderer.invoke('code-stop', { id }),
  onCodeRunOutput: (callback) => {
    if (window._gongfangCodeOutputHandler) {
      ipcRenderer.removeListener('code-run-output', window._gongfangCodeOutputHandler);
    }
    window._gongfangCodeOutputHandler = (event, data) => callback(data);
    ipcRenderer.on('code-run-output', window._gongfangCodeOutputHandler);
  },

  // ── 写作面板（LaTeX Editor）──
  writeGetFileTree: (projectPath) => ipcRenderer.invoke('write-get-file-tree', { projectPath }),
  flowchartsGetDir: () => ipcRenderer.invoke('flowcharts-get-dir'),
  writeOpenPdfWindow: (pdfPath) => ipcRenderer.invoke('write-open-pdf-window', pdfPath),
  writeExportWord: (projectPath) => ipcRenderer.invoke('write-export-word', projectPath),
  onWordExportLog: (callback) => {
    if (window._gongfangWordExportHandler) {
      ipcRenderer.removeListener('word-export-log', window._gongfangWordExportHandler);
    }
    window._gongfangWordExportHandler = (event, data) => callback(data);
    ipcRenderer.on('word-export-log', window._gongfangWordExportHandler);
  },

  // ── 局域网协作 ──
  collabHostStart: (opts) => ipcRenderer.invoke('collab-host-start', opts),
  collabHostStop: () => ipcRenderer.invoke('collab-host-stop'),
  collabJoin: (opts) => ipcRenderer.invoke('collab-join', opts),
  collabLeave: () => ipcRenderer.invoke('collab-leave'),
  collabScan: () => ipcRenderer.invoke('collab-scan'),
  collabState: () => ipcRenderer.invoke('collab-state'),
  collabReadFile: (filePath) => ipcRenderer.invoke('collab-read-file', filePath),
  collabWriteFile: (filePath, content, binary) => ipcRenderer.invoke('collab-write-file', { filePath, content, binary }),
  collabFlush: (filePath, content, binary) => ipcRenderer.invoke('collab-flush', { filePath, content, binary }),
  collabSendEdit: (filePath, content, binary) => ipcRenderer.invoke('collab-send-edit', { filePath, content, binary }),
  collabSendCursor: (filePath, cursor) => ipcRenderer.invoke('collab-send-cursor', { filePath, cursor }),
  collabSendView: (filePath) => ipcRenderer.invoke('collab-send-view', filePath),
  collabGetFileTree: (projectPath) => ipcRenderer.invoke('collab-get-file-tree', projectPath),
  collabRequestLock: (filePath) => ipcRenderer.invoke('collab-request-lock', filePath),
  collabReleaseLock: (filePath) => ipcRenderer.invoke('collab-release-lock', filePath),
  collabCompileRequest: (projectPath) => ipcRenderer.invoke('collab-compile-request', projectPath),
  collabCompileVote: (voteId, agree) => ipcRenderer.invoke('collab-compile-vote', { voteId, agree }),
  collabCompileCancel: (voteId) => ipcRenderer.invoke('collab-compile-cancel', voteId),
  collabCompileAbort: (voteId) => ipcRenderer.invoke('collab-compile-abort', voteId),
  collabUploadShared: (filePath, name) => ipcRenderer.invoke('collab-upload-shared', { filePath, name }),
  collabDeleteShared: (name) => ipcRenderer.invoke('collab-delete-shared', { name }),
  collabDeviceName: () => ipcRenderer.invoke('collab-device-name'),
  collabWifiInfo: () => ipcRenderer.invoke('collab-wifi-info'),
  collabTmpPdf: () => ipcRenderer.invoke('collab-tmp-pdf'),
  collabKickMember: (n) => ipcRenderer.invoke('collab-kick-member', n),
  collabListShared: () => ipcRenderer.invoke('collab-list-shared'),
  onCollabEvent: (callback) => {
    if (window._gongfangCollabHandler) ipcRenderer.removeListener('collab-event', window._gongfangCollabHandler);
    window._gongfangCollabHandler = (event, data) => callback(data);
    ipcRenderer.on('collab-event', window._gongfangCollabHandler);
  },

  // ── 扩展系统 ──
  extensionList: () => ipcRenderer.invoke('extension:list'),
  extensionEnable: (id) => ipcRenderer.invoke('extension:enable', id),
  extensionDisable: (id) => ipcRenderer.invoke('extension:disable', id),
  extensionUninstall: (id) => ipcRenderer.invoke('extension:uninstall', id),
  extensionInstallFromDialog: () => ipcRenderer.invoke('extension:install-from-dialog'),
  extensionOpenUserDir: () => ipcRenderer.invoke('extension:open-user-dir'),
  extensionReload: () => ipcRenderer.invoke('extension:reload'),
});
