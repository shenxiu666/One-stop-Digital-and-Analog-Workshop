// 一站式数模工坊 — 写作面板 IPC 处理器
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const writeService = require('../services/write');
const latexEnv = require('../env/latex');
const procMgr = require('../core/process-manager');
const { toShortPath } = require('../core/safe-path');

function register(ctx) {
  // ★ 已删除任务期 handler（write-list-projects / write-create-project / write-unzip-project / write-sync-from-task）：调用方已下线

  // ★ 查找项目中的主 tex 文件（优先 论文.tex）
  // 搜索顺序：限定子目录（如 论文/）→ 论文/ → 项目根目录 → 递归子目录
  ipcMain.handle('find-tex-file', async (event, projectPathOrOpts) => {
    try {
      let projectPath = projectPathOrOpts;
      let subdir = '';
      if (projectPathOrOpts && typeof projectPathOrOpts === 'object') {
        projectPath = projectPathOrOpts.projectPath || '';
        subdir = String(projectPathOrOpts.subdir || '');
      }
      // 辅助函数：在目录中找主 tex
      const findInDir = (dir) => {
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.tex'));
        if (!files.length) return null;
        return files.find(f => f === '论文.tex') || files.find(f => f === 'main.tex') || files[0];
      };
      // 0. 限定子目录优先（如 论文/ 或 论文-xxx/）：直接在该目录找主 tex
      if (subdir) {
        const sd = path.join(String(projectPath || ''), subdir.replace(/[\\/:*?"<>|]+/g, '_'));
        const inSub = findInDir(sd);
        if (inSub) return { success: true, texPath: path.join(sd, inSub) };
      }

      // 1. 优先在 论文/ 子目录找
      const paperDir = path.join(projectPath, '论文');
      let mainFile = findInDir(paperDir);
      if (mainFile) return { success: true, texPath: path.join(paperDir, mainFile) };

      // 2. 在项目根目录找（手动新建的项目结构）
      mainFile = findInDir(projectPath);
      if (mainFile) return { success: true, texPath: path.join(projectPath, mainFile) };

      // 3. 递归搜索子目录（兼容其他结构）
      const searchRecursive = (dir, depth) => {
        if (depth > 3) return null;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'build' || entry.name === '求解') continue;
          const full = path.join(dir, entry.name);
          if (entry.isFile() && entry.name.endsWith('.tex')) return full;
          if (entry.isDirectory()) {
            const found = searchRecursive(full, depth + 1);
            if (found) return found;
          }
        }
        return null;
      };
      const found = searchRecursive(projectPath, 0);
      if (found) return { success: true, texPath: found };

      return { success: false, error: '未找到 tex 文件' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ★ 获取项目文件树（写面板文件浏览器 / 协作文件树在用）
  ipcMain.handle('write-get-file-tree', async (event, { projectPath }) => {
    try {
      const tree = writeService.getFileTree(projectPath);
      return { success: true, tree };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ★ 直接编译（绕过 AI，直接运行集成环境 xelatex；从任务版迁移）
  // ★ 清理编译中间产物
  const cleanAuxFiles = (compileDir, texFile) => {
    const base = texFile.replace(/\.tex$/i, '');
    const exts = ['.log', '.aux', '.out', '.toc', '.synctex.gz', '.nav', '.snm', '.vrb', '.xdv', '.fls', '.fdb_latexmk'];
    exts.forEach(ext => {
      const fp = path.join(compileDir, base + ext);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    });
  };

  // ★ 并发编译锁（同一目录同一时刻只允许一个编译进程）
  const activeCompileDirs = new Set();

  ipcMain.handle('direct-compile', async (event, { texPath, workDir, singlePass, engine }) => {
    return new Promise((resolve) => {
      if (!texPath || !fs.existsSync(texPath)) {
        resolve({ success: false, error: 'tex 文件不存在' });
        return;
      }

      const texFile = path.basename(texPath);
      const compileDirRaw = workDir && fs.existsSync(path.join(workDir, texFile))
        ? workDir
        : path.dirname(texPath);

      let lockKey = compileDirRaw;
      try { lockKey = fs.realpathSync(compileDirRaw) || compileDirRaw; } catch {}
      if (activeCompileDirs.has(lockKey)) {
        resolve({ success: false, error: '已有编译任务正在运行，请稍候再试' });
        return;
      }
      activeCompileDirs.add(lockKey);
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        activeCompileDirs.delete(lockKey);
        resolve(v);
      };

      // ★ 中文路径转短路径，避免 xelatex 乱码
      const compileDir = toShortPath(compileDirRaw) || compileDirRaw;

      const { spawn } = require('child_process');

      // ★ 编译引擎：xelatex（默认）/ pdflatex / latexmk
      const engineKey = (engine === 'pdflatex' || engine === 'latexmk') ? engine : 'xelatex';
      const binaryPath = path.join(latexEnv.getBinDir(),
        engineKey === 'pdflatex' ? 'pdflatex.exe' : engineKey === 'latexmk' ? 'latexmk.exe' : 'xelatex.exe');

      if (!fs.existsSync(binaryPath)) {
        finish({ success: false, error: '编译引擎 ' + engineKey + ' 未找到，请先在设置中检查 LaTeX 环境' });
        return;
      }

      // ★ 编译前确保 xelatex.fmt 有效（仅 xelatex 需要）
      if (engineKey === 'xelatex' && !latexEnv.isFmtValid()) {
        try {
          if (!latexEnv.rebuildFmt()) console.log('[gongfang] fmt 重建失败，将尝试继续编译');
        } catch (_) {}
      }

      const latexEnvVars = latexEnv.getLatexEnv();
      const env = {
        ...process.env,
        ...latexEnvVars,
        PATH: latexEnvVars.PATH,
        Path: latexEnvVars.PATH,
      };

      // ★ 首次编译清理中间文件；后续编译保留 .aux/.toc 等交叉引用数据
      const auxPath = path.join(compileDirRaw, texFile.replace(/\.tex$/i, '.aux'));
      if (!fs.existsSync(auxPath)) {
        cleanAuxFiles(compileDirRaw, texFile);
      }

      // ★ 记录编译前 PDF 的修改时间，用于判断编译是否真的生成了新 PDF
      const pdfPath = texPath.replace(/\.tex$/, '.pdf');
      const pdfMtimeBefore = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0;

      // ★ latexmk 自带多轮编译；xelatex/pdflatex 需要手动跑两遍
      const useLatexmk = engineKey === 'latexmk';
      const args = useLatexmk
        ? ['-xelatex', '-interaction=nonstopmode', texFile]
        : ['-interaction=nonstopmode', '-halt-on-error', texFile];

      const checkPdf = (label) => {
        if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).mtimeMs > pdfMtimeBefore) {
          finish({ success: true, pdfPath });
        } else if (fs.existsSync(pdfPath)) {
          finish({ success: false, error: label + '未生成新 PDF（源文件可能有 LaTeX 错误）' });
        } else {
          finish({ success: false, error: label + '未生成 PDF' });
        }
      };

      const runOne = (cb) => {
        const proc = spawn(binaryPath, args, {
          timeout: 120000,
          env: env,
          cwd: compileDirRaw,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        procMgr.track(proc);
        let stdout = '';
        let stderr = '';
        let done = false;
        const over = (code, out) => { if (!done) { done = true; cb(code, out); } };
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('error', (err) => over(1, err.message));
        proc.on('close', (code) => over(code, stderr || stdout));
      };

      runOne((code1, out1) => {
        // ★ xelatex 有警告时也可能返回非零退出码，但 PDF 已生成 → 先检查 PDF
        if (code1 !== 0) {
          const hasFatalError = (out1 || '').includes('! ') || (out1 || '').includes('Fatal error');
          if (hasFatalError || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).mtimeMs <= pdfMtimeBefore) {
            finish({ success: false, error: (out1 || engineKey + ' 编译失败').trim().slice(-1200) });
            return;
          }
        }
        // 快速编译 / latexmk：只跑一轮
        if (singlePass || useLatexmk) {
          checkPdf(engineKey + ' ');
          return;
        }
        // 完整编译跑第二次（用于最终输出）
        runOne((code2, out2) => {
          if (code2 !== 0) {
            const hasFatalError2 = (out2 || '').includes('! ') || (out2 || '').includes('Fatal error');
            if (hasFatalError2 || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).mtimeMs <= pdfMtimeBefore) {
              finish({ success: false, error: (out2 || engineKey + ' 第二次编译失败').trim().slice(-1200) });
              return;
            }
          }
          checkPdf(engineKey + ' 第二次');
        });
      });
    });
  });

  // ★ 绘图流程图目录（userData/flowcharts，避免污染用户自选工作目录）
  ipcMain.handle('flowcharts-get-dir', async () => {
    const fs = require('fs');
    const path = require('path');
    try {
      const { app } = require('electron');
      const dir = path.join(app.getPath('userData'), 'flowcharts');
      fs.mkdirSync(dir, { recursive: true });
      return { success: true, path: dir };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('write-open-pdf-window', async (event, pdfPath) => {
    try {
      if (!pdfPath || typeof pdfPath !== 'string') return { success: false, error: '无 PDF 路径' };
      const { BrowserWindow } = require('electron');
      const url = 'file:///' + pdfPath.replace(/\\/g, '/');
      const win = new BrowserWindow({
        width: 900,
        height: 1200,
        title: 'PDF 预览',
        autoHideMenuBar: true,
        backgroundColor: '#525659',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      await win.loadURL(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ★ 导出 Word：选保存路径 → LaTeX→docx 管线 → 输出到所选路径（不污染工作区）
  ipcMain.handle('write-export-word', async (event, projectPath) => {
    try {
      if (!projectPath || typeof projectPath !== 'string') return { success: false, error: '缺少项目路径' };
      const { dialog, BrowserWindow } = require('electron');
      const win = event.sender ? event.sender.getOwnerBrowserWindow() : BrowserWindow.getAllWindows()[0];
      const r = await dialog.showSaveDialog(win, {
        title: '导出 Word',
        defaultPath: '论文.docx',
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (r.canceled || !r.filePath) return { success: false, error: '已取消' };
      const wordExport = require('../services/word-export');
      const sendLog = (m) => { try { if (win && !win.isDestroyed()) win.webContents.send('word-export-log', m); } catch {} };
      sendLog('开始导出...');
      const result = await wordExport.exportWord(projectPath, r.filePath, sendLog);
      if (result && result.success) sendLog('导出完成');
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
