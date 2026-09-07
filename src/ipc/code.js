// Gongfang v2.6 — 代码工作台 IPC：运行 Python 代码（复用内置 Python 环境）
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const pythonEnv = require('../env/python');
const procMgr = require('../core/process-manager');

const running = new Map(); // id -> child process

function getPython() {
  const envDir = pythonEnv.getPythonEnvDir ? pythonEnv.getPythonEnvDir() : '';
  const exe = envDir ? path.join(envDir, 'python.exe') : 'python';
  const env = envDir
    ? { ...process.env, PYTHONHOME: envDir, PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', LANG: 'zh_CN.UTF-8', MPLBACKEND: 'Agg', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' }
    : { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MPLBACKEND: 'Agg', PYTHONUNBUFFERED: '1' };
  return { exe, env };
}

function safeCwd(requested, ctx) {
  // ★ 校验 cwd 存在：spawn 的 cwd 不存在会直接 ENOENT（Windows 上报错还指向 exe，误导排查）
  const candidates = [requested, ctx.getWorkDir ? ctx.getWorkDir() : '', process.cwd()];
  for (const c of candidates) {
    if (c && typeof c === 'string') {
      try { if (fs.existsSync(c)) return c; } catch {}
    }
  }
  return process.cwd();
}

function register(ctx) {
  ipcMain.handle('code-run', async (event, payload) => {
    const code = String(payload.code || '');
    if (!code.trim()) return { success: false, error: '代码为空' };
    const cwd = safeCwd(payload.cwd, ctx);
    const timeoutMs = Math.min(parseInt(payload.timeoutMs) || 120000, 600000);
    const id = payload.id || String(Date.now()) + '_' + Math.floor(Math.random() * 1000);
    const { exe, env } = getPython();

    // ★ 脚本位置决定 `__file__` 相对路径能否解析（求解脚本用 __file__ 定位 数据/结果/ 目录）
    //   有 payload.path（正在编辑的文件）→ 写到其所在目录，`__file__` 相对路径正确；
    //   否则回退系统临时目录。
    let scriptDir = path.join(os.tmpdir(), 'gongfang-code');
    try { fs.mkdirSync(scriptDir, { recursive: true }); } catch {}
    if (payload.path && typeof payload.path === 'string') {
      const pDir = path.dirname(payload.path);
      if (pDir && fs.existsSync(pDir)) scriptDir = pDir;
    }
    const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
    const scriptPath = path.join(scriptDir, '.gongfang_run_' + safeId + '.py');
    // ★ v2.6: 不再向用户代码注入任何字体/绘图预处理内容。
    //   原 fontPreamble 通过 _entry.weight=... 手动给 FontEntry.weight 赋值，在新版 matplotlib
    //   会抛 FrozenInstanceError，导致所有代码运行崩溃；且代码不应被运行器强塞的属性覆盖。
    //   字体加载、matplotlib.use('Agg') 等工作由用户代码自行负责，运行器不干预。
    const finalCode = code;
    try { fs.writeFileSync(scriptPath, finalCode, 'utf-8'); } catch (e) { return { success: false, error: '写脚本失败: ' + e.message }; }

    return await new Promise((resolve) => {
      let proc;
      try {
        // ★ -u 强制无缓冲输出：print 立即流式回传，避免小输出被块缓冲到进程结束才显示
      proc = spawn(exe, ['-u', scriptPath], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        try { fs.unlinkSync(scriptPath); } catch {}
        return resolve({ success: false, error: '启动 Python 失败: ' + e.message });
      }
      running.set(id, proc);
      procMgr.track(proc); // ★ 退出时自动清理
      const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs);
      proc.stdout.on('data', d => { event.sender.send('code-run-output', { id, stream: 'out', text: d.toString() }); });
      proc.stderr.on('data', d => { event.sender.send('code-run-output', { id, stream: 'err', text: d.toString() }); });
      proc.on('error', (e) => {
        clearTimeout(timer); running.delete(id);
        try { fs.unlinkSync(scriptPath); } catch {}
        resolve({ success: false, error: e.message, id });
      });
      proc.on('close', (code) => {
        clearTimeout(timer); running.delete(id);
        try { fs.unlinkSync(scriptPath); } catch {}
        resolve({ success: code === 0, code, id });
      });
    });
  });

  ipcMain.handle('code-stop', (event, { id }) => {
    const proc = id ? running.get(id) : null;
    if (proc) { try { proc.kill(); } catch {} return { success: true }; }
    return { success: false };
  });
}

module.exports = { register };
