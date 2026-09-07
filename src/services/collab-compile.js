// Gongfang v2.6 — 局域网协作：共享编译函数
// 主机端 / 成员端都用它编译"本机上的项目副本"（复用内置 TinyTeX）。
// 谁发起编译谁编译：文件全局统一修改，任一本机副本完整，故任何机器都能编译，
// 编译产物再下发到其他所有人。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const toShort = require('../core/safe-path').toShortPath;

function findMainTex(projectPath) {
  const found = [];
  (function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'build' || /(规范|规则|求解计划)/.test(e.name)) continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.tex$/i.test(e.name)) found.push(fp);
    }
  })(projectPath);
  return found.find(f => path.basename(f) === '论文.tex')
    || found.find(f => path.basename(f) === 'main.tex')
    || found[0] || null;
}

// ★ 编译解析「共享文件区/<文件>」相对路径：若编译目录所在的项目里存在「共享文件区」目录，
//   则在该编译目录下建一个 junction/符号链接指向它，使子目录（如「论文/」）里的 \includegraphics
//   也能正确解析到共享图片。跨设备统一使用相对路径，因此主机和成员都依赖此链接。
const SHARED_NAME = '共享文件区';
function ensureSharedLink(compileDirRaw) {
  try {
    let cur = compileDirRaw;
    let found = null;
    while (true) {
      const cand = path.join(cur, SHARED_NAME);
      try { if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) { found = cand; break; } } catch (_) {}
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    if (!found) return;
    const link = path.join(compileDirRaw, SHARED_NAME);
    try { if (!fs.existsSync(link)) fs.symlinkSync(found, link, 'junction'); } catch (_) {}
  } catch (_) {}
}

// ★ 终止当前编译：杀掉所有在跑的编译进程（协同编译"终止"按钮用）
const _runningProcs = new Set();
function abortAll() {
  _runningProcs.forEach(p => { try { p.kill(); } catch (_) {} });
  _runningProcs.clear();
}

// projectPath: 本机上的项目目录（主机=权威目录 / 成员=工作区临时副本）
// texFile: 可选（绝对或相对主编译文件）；缺省时递归查找
function compileProject(projectPath, texFile, engine, cb) {
  let latexEnv;
  try { latexEnv = require('../env/latex'); } catch (_) {}
  if (!latexEnv) return cb({ ok: false, log: 'LaTeX 环境不可用' });
  if (!projectPath || !fs.existsSync(projectPath)) return cb({ ok: false, log: '项目目录不存在' });

  let texPath = null;
  if (texFile) texPath = path.isAbsolute(texFile) ? texFile : path.join(projectPath, texFile);
  if (!texPath || !fs.existsSync(texPath)) texPath = findMainTex(projectPath);
  if (!texPath || !fs.existsSync(texPath)) return cb({ ok: false, log: '未找到主编译文件' });

  const engineKey = (engine === 'pdflatex' || engine === 'latexmk') ? engine : 'xelatex';
  const binDir = latexEnv.getBinDir();
  const binary = path.join(binDir, engineKey === 'pdflatex' ? 'pdflatex.exe' : engineKey === 'latexmk' ? 'latexmk.exe' : 'xelatex.exe');
  if (!fs.existsSync(binary)) return cb({ ok: false, log: '编译引擎 ' + engineKey + ' 未安装，请先在设置中修复 LaTeX 环境' });

  const compileDirRaw = path.dirname(texPath);
  // ★ 让「共享文件区/<文件>」相对路径在此编译目录内可解析（论文/ 等子目录也能引用共享图片）
  ensureSharedLink(compileDirRaw);
  const compileDir = toShort(compileDirRaw) || compileDirRaw;
  const texFileBase = path.basename(texPath);
  const base = texFileBase.replace(/\.tex$/i, '');
  ['.log', '.aux', '.out', '.toc', '.synctex.gz', '.nav', '.snm', '.vrb', '.xdv', '.fls', '.fdb_latexmk'].forEach(ext => {
    try { const f = path.join(compileDirRaw, base + ext); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  });

  const envVars = latexEnv.getLatexEnv();
  const env = { ...process.env, ...envVars, PATH: envVars.PATH, Path: envVars.PATH };
  const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
  const pdfMtime = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0;
  const args = engineKey === 'latexmk'
    ? ['-xelatex', '-interaction=nonstopmode', texFileBase]
    : ['-interaction=nonstopmode', '-halt-on-error', texFileBase];
  let log = '';
  const runOnce = () => new Promise(res => {
    const proc = spawn(binary, args, { cwd: compileDir, env, timeout: 120000 });
    // ★ 登记到 _runningProcs，供 abortAll() 终止协同编译
    _runningProcs.add(proc);
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    proc.on('error', e => { log += '\n[spawn] ' + e.message; _runningProcs.delete(proc); res(false); });
    proc.on('close', code => { _runningProcs.delete(proc); res(code === 0); });
  });
  (async () => {
    const passes = engineKey === 'latexmk' ? 1 : 2;
    for (let i = 0; i < passes; i++) { const okRun = await runOnce(); if (!okRun) break; }
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).mtimeMs > pdfMtime) {
      cb({ ok: true, pdfPath });
    } else {
      const tail = log.split('\n').filter(l => /error|Error|!/i.test(l)).slice(0, 12).join('\n');
      cb({ ok: false, log: tail || '编译未生成 PDF' });
    }
  })();
}

module.exports = { compileProject, findMainTex, abortAll };
