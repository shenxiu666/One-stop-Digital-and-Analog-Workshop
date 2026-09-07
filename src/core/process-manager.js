// Gongfang v2.6 — 进程管理器（跟踪并清理子进程）
const { execSync } = require('child_process');

// 跟踪所有子进程
const tracked = new Set();

// 注册子进程
function track(proc) {
  if (!proc || !proc.pid) return;
  tracked.add(proc);
  const cleanup = () => { tracked.delete(proc); };
  proc.on('close', cleanup);
  proc.on('error', cleanup);
  proc.on('exit', cleanup);
}

// 终止所有跟踪的进程（同步，用于退出时清理）
function killAll() {
  for (const proc of tracked) {
    try {
      if (proc.pid && !proc.killed) {
        // Windows: 用 taskkill 杀掉整个进程树
        try {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore', timeout: 3000 });
        } catch {
          // 回退：直接 kill
          try { proc.kill('SIGKILL'); } catch {}
        }
      }
    } catch {}
  }
  tracked.clear();
}

// 清理系统中残留的 Gongfang 相关进程
function killOrphans() {
  const patterns = ['claude.exe', 'python.exe', 'xelatex.exe', 'xdvipdfmx.exe'];
  for (const name of patterns) {
    try {
      execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore', timeout: 3000 });
    } catch {}
  }
}

// ★ 精确终止某条可执行文件路径对应的整棵进程树（Windows）。
//   用于 abort 时真正杀死 SDK 派生的 claude.exe（连带其 bash/python/xelatex 子进程），
//   否则 abort 信号只是让 SDK 停止迭代，claude 子进程仍会在后台继续跑（用户退出后再进任务还在跑）。
function killExeProcessTree(exePath) {
  if (!exePath || typeof exePath !== 'string' || process.platform !== 'win32') return;
  const normalized = exePath.trim();
  if (!normalized) return;
  try {
    // 用 PowerShell 精确匹配 ExecutablePath（单引号内反斜杠是字面量，不参与转义），拿到进程PID
    const esc = normalized.replace(/'/g, "''");
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${esc}' } | Select-Object -ExpandProperty ProcessId"`,
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }
    ).toString();
    const pids = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d+$/.test(s) && Number(s) > 0);
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
      } catch {
        // 进程可能已退出，忽略
      }
    }
  } catch {}
}

// 获取当前跟踪的进程信息
function getInfo() {
  return {
    count: tracked.size,
    pids: [...tracked].map(p => p.pid).filter(Boolean),
  };
}

module.exports = { track, killAll, killOrphans, killExeProcessTree, getInfo };
