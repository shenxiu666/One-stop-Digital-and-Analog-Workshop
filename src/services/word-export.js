// Gongfang v2.6 — Word 导出服务（LaTeX 论文 → docx）
// 管线：渲染流程图(tikz→png) → 合并tex(合并论文.py) → pandoc(排版.lua + reference.docx)
//       → 后处理(后处理.py)
// 输出写到用户选择路径；「转word」只是临时工作目录，导出保存成功后整目录删除，不留中间文件。
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pythonEnv = require('../env/python');
const latexEnv = require('../env/latex');
const { getAppEnvDir, getAppEnvRoots } = require('../env/assets');

const TOOL_FILES = ['merge_paper.py', 'postprocess.py', 'render_flowcharts.py', 'layout.lua', 'reference.docx'];

// ★ 把合并 tex 里引用的图片（含外部引用、共享文件区）复制到 转word/图片/外引/ 并重写路径，
//   pandoc 才能在导出目录里找到所有图片，否则外部引用图在 Word 里显示不出来。
function copyImagesForPandoc(mergedTex, workDir, paperDir) {
  const crypto = require('crypto');
  try {
    let tex = fs.readFileSync(mergedTex, 'utf-8');
    const imgDir = path.join(workDir, '图片', '外引');
    fs.mkdirSync(imgDir, { recursive: true });
    const re = /\\includegraphics(\[[^\]]*\])?\{([^}]+)\}/g;
    tex = tex.replace(re, function(m, opt, rel) {
      rel = String(rel).trim().replace(/^["']|["']$/g, '');   // ★ 剥掉外围引号
      const src = path.isAbsolute(rel) ? rel : path.resolve(paperDir, rel);
      if (!fs.existsSync(src)) return m;   // 找不到的原样保留，pandoc 会提示
      try {
        const hash = crypto.createHash('md5').update(src + fs.statSync(src).mtimeMs).digest('hex').slice(0, 8);
        const ext = path.extname(src) || '.png';
        const name = 'img_' + hash + ext;
        const dst = path.join(imgDir, name);
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
        return '\\includegraphics' + (opt || '') + '{' + dst.replace(/\\/g, '/') + '}';
      } catch (_) { return m; }
    });
    fs.writeFileSync(mergedTex, tex, 'utf-8');
  } catch (_) {}
}

// ── 工具目录解析（开发/打包两态） ──
function getToolDir() {
  const candidates = [
    process.env.GONGFANG_REAL_RESOURCES ? path.join(process.env.GONGFANG_REAL_RESOURCES, 'assets', 'word-export') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'word-export') : null,
    path.join(process.cwd(), 'assets', 'word-export'),
    path.join(__dirname, '..', '..', 'assets', 'word-export'),
  ];
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return path.join(__dirname, '..', '..', 'assets', 'word-export');
}

// ── 异步执行子进程（不阻塞主进程 UI） ──
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, Object.assign({ encoding: 'utf-8' }, opts || {})); }
    catch (e) { return resolve({ status: -1, stdout: '', stderr: e.message }); }
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ status: code, stdout, stderr }));
    child.on('error', e => resolve({ status: -1, stdout, stderr: e.message }));
  });
}

// ── 复制文件到目标路径：目标被占用（EBUSY/EPERM）时短间隔重试数次 ──
function copyWithRetry(src, dst) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      try {
        fs.copyFileSync(src, dst);
        resolve({ ok: true });
      } catch (e) {
        if (n > 0 && /EBUSY|EPERM|EACCES/.test(e.code || '')) {
          setTimeout(() => attempt(n - 1), 600);
        } else {
          resolve({ ok: false, error: e });
        }
      }
    };
    attempt(3);
  });
}

// ── pandoc：优先从外部集成环境 获取（环境不打包进软件，软件本体更小） ──
//   集成环境约定结构：<集成环境>/pandoc/pandoc.exe（与 python-env/、TinyTeX/ 平级）
function getEnvPandoc() {
  const candidates = [];
  const add = (p) => { if (p && !candidates.includes(p)) candidates.push(p); };
  // 1) 外部集成环境（软件配置 / 自动检测到的环境根目录）
  try { const envDir = getAppEnvDir(); if (envDir) add(path.join(envDir, 'pandoc', 'pandoc.exe')); } catch {}
  try { for (const root of getAppEnvRoots()) add(path.join(root, 'pandoc', 'pandoc.exe')); } catch {}
  // 2) 兼容旧部署：软件 assets 内（历史版本残留，正常已不会再打包）
  add(process.env.GONGFANG_REAL_RESOURCES ? path.join(process.env.GONGFANG_REAL_RESOURCES, 'assets', 'pandoc', 'pandoc.exe') : null);
  add(process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'pandoc', 'pandoc.exe') : null);
  add(path.join(process.cwd(), 'assets', 'pandoc', 'pandoc.exe'));
  add(path.join(__dirname, '..', '..', 'assets', 'pandoc', 'pandoc.exe'));
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return null;
}

// ── pandoc 解析：优先外部集成环境（Gongfang_env），其次系统 PATH，最后常见安装位置 ──
function resolvePandoc() {
  const isWin = process.platform === 'win32';
  // ★ 优先外部集成环境 内的 pandoc：不依赖用户机器安装 pandoc，也不占用软件体积
  const envPandoc = getEnvPandoc();
  if (envPandoc) return envPandoc;
  const whichCmd = isWin ? 'where' : 'which';
  try {
    const r = require('child_process').spawnSync(whichCmd, ['pandoc'], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      if (first) return first;
    }
  } catch {}
  const candidates = [
    'C:/ProgramData/anaconda3/Library/bin/pandoc.exe',
    path.join(process.env.USERPROFILE || '', 'anaconda3/Library/bin/pandoc.exe'),
    'C:/Program Files/Pandoc/pandoc.exe',
    '/usr/bin/pandoc', '/usr/local/bin/pandoc',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return isWin ? 'pandoc' : 'pandoc';
}

// ── pandoc 状态（必备工具，与 Python 必备库同级）：是否可用 + 版本 + 路径 + 来源 ──
function getPandocStatus() {
  const pandoc = resolvePandoc();
  // 仅当解析到真实存在的可执行文件才算可用（避免返回裸命令名 'pandoc'）
  const ok = !!(pandoc && fs.existsSync(pandoc));
  let version = '';
  if (ok) {
    try {
      const out = require('child_process').spawnSync(pandoc, ['--version'], { encoding: 'utf-8', timeout: 15000 });
      const m = (out.stdout || '').match(/pandoc\s+([\d.]+)/i);
      version = m ? m[1] : 'unknown';
    } catch {}
  }
  const source = ok ? (getEnvPandoc() ? 'appenv' : 'system') : 'none';
  return { ok, version, path: ok ? pandoc : null, source };
}

// ── 确保 Python 依赖：lxml + PyMuPDF(fitz) ──
async function ensurePythonDeps(log) {
  const py = pythonEnv.getPythonPath();
  const check = await run(py, ['-c', 'import lxml, fitz']);
  if (check.status === 0) return true;
  log('正在安装 Word 导出所需依赖（pymupdf / lxml）...');
  try { await pythonEnv.installPackage('pymupdf', (m) => log(m)); }
  catch (e) { log('pymupdf 安装失败: ' + e.message); }
  const check2 = await run(py, ['-c', 'import lxml, fitz']);
  return check2.status === 0;
}

// ── 把工具链拷到 项目根/转word/工具/ ──
// 转word 是项目根下的临时工作文件夹（与 论文/ 求解/ 平级），中间产物统一放这里。
function setupToolDir(projectPath) {
  const src = getToolDir();
  const workDir = path.join(projectPath, '转word');
  const toolDir = path.join(workDir, '工具');
  fs.mkdirSync(toolDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, '图片'), { recursive: true });
  fs.mkdirSync(path.join(workDir, '渲染'), { recursive: true });
  for (const f of TOOL_FILES) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(toolDir, f));
  }
  return { workDir, toolDir };
}

/**
 * 导出 Word
 * @param {string} projectPath 工作区路径（含 论文/）
 * @param {string} outputPath  用户选择的 .docx 保存路径
 * @param {function} log       进度回调
 */
async function exportWord(projectPath, outputPath, log) {
  log = log || (() => {});
  try { log('准备 Word 导出环境...'); } catch {}

  // ★ 兼容两种项目结构：任务同步(论文/论文.tex) 与 写作面板直接创建(论文.tex 在项目根)
  const paperDir = fs.existsSync(path.join(projectPath, '论文', '论文.tex'))
    ? path.join(projectPath, '论文')
    : projectPath;
  if (!fs.existsSync(path.join(paperDir, '论文.tex'))) {
    return { success: false, error: '未找到 论文.tex（请先选择已完成的写作任务）' };
  }

  // 1) 环境
  const py = pythonEnv.getPythonPath();
  const latexStatus = latexEnv.getStatus();
  const texBin = latexStatus.installed ? latexStatus.binDir : null;
  if (!texBin) return { success: false, error: '内置 LaTeX 环境不可用，无法导出' };
  const pandoc = resolvePandoc();
  try { log('使用 pandoc: ' + pandoc); } catch {}
  // ★ pandoc 属于 Word 导出的必备工具（与 Python 必备库同级）：必须真实可执行，否则提前明确报错，
  //   避免落到 "pandoc 转换失败" 这种模糊错误。
  if (!pandoc || !fs.existsSync(pandoc)) {
    return { success: false, error: '未找到可用的 pandoc：请确认集成环境已包含 pandoc/pandoc.exe，或系统 PATH 已安装 pandoc' };
  }

  // 2) Python 依赖
  try { log('检查 Python 依赖...'); } catch {}
  if (!await ensurePythonDeps(log)) {
    return { success: false, error: 'Python 依赖（lxml / pymupdf）不可用，请检查网络后重试' };
  }

  // 3) 搭工作目录（项目根/转word）
  const { workDir, toolDir } = setupToolDir(projectPath);
  const mergedTex = path.join(workDir, 'merged.tex');
  const docxOut = path.join(workDir, 'paper.docx');
  // ★ 修复「明明装了库却报缺失」：必须合并 LaTeX 的短路径 TEXMF 环境，而不是只拼 PATH。
  //   Word 导出 / 流程图渲染(xelatex) 在中文路径或 8.3 短路径被禁用时，只有 PATH 而缺少
  //   正确的 TEXMFROOT/TEXMFDIST -> kpathsea 定位不到 texmf-dist -> 宏包 not found。
  const latexEnvVars = latexStatus.installed ? latexEnv.getLatexEnv() : {};
  const env = Object.assign({}, process.env, latexEnvVars);
  env.PATH = [path.dirname(py), env.PATH || '', texBin].join(path.delimiter);
  // 强制 Python 标准流/路径用 UTF-8，脚本内无需再对 sys.stdout 做任何重定向。
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'utf-8';

  let saved = false;  // 导出成功（docx 已写入用户路径）后才允许清理「转word」
  try {
    // 4) 渲染流程图（tikz → png）
    try { log('渲染流程图...'); } catch {}
    let r = await run(py, [path.join(toolDir, 'render_flowcharts.py')], { env, cwd: workDir });
    if (r.status !== 0) { try { log('流程图渲染警告: ' + (r.stderr || r.stdout || '').slice(-600)); } catch {} }

    // 5) 合并 tex
    try { log('合并论文章节...'); } catch {}
    r = await run(py, [path.join(toolDir, 'merge_paper.py')], { env, cwd: workDir });
    if (r.status !== 0 || !fs.existsSync(mergedTex)) {
      return { success: false, error: '合并论文失败: ' + (r.stderr || r.stdout || '').slice(-800) };
    }

    // 5.5) 整理引用图片（含外部引用）→ pandoc 才能在 Word 里显示
    try { log('整理引用图片...'); } catch {}
    copyImagesForPandoc(mergedTex, workDir, paperDir);

    // 6) pandoc 转 docx
    try { log('pandoc 转换 docx...'); } catch {}
    r = await run(pandoc, [
      mergedTex, '-o', docxOut,
      '--reference-doc', path.join(toolDir, 'reference.docx'),
      '--lua-filter', path.join(toolDir, 'layout.lua'),
    ], { env, cwd: workDir });
    if (r.status !== 0 || !fs.existsSync(docxOut)) {
      return { success: false, error: 'pandoc 转换失败: ' + (r.stderr || r.stdout || '').slice(-1000) };
    }

    // 7) 后处理排版
    try { log('后处理排版...'); } catch {}
    r = await run(py, [path.join(toolDir, 'postprocess.py'), docxOut], { env, cwd: workDir });
    if (r.status !== 0) { try { log('后处理警告: ' + (r.stderr || r.stdout || '').slice(-600)); } catch {} }

    // 8) 输出到用户路径（目标被占用时重试；仍占用则自动另存新名字）
    const cp = await copyWithRetry(docxOut, outputPath);
    if (!cp.ok) {
      // 目标被占用（常见：同名 docx 正开在 Word）→ 自动另存为「_导出」后缀，保证导出成功
      const ext = path.extname(outputPath) || '.docx';
      const alt = outputPath.slice(0, outputPath.length - ext.length) + '_导出' + ext;
      const cp2 = await copyWithRetry(docxOut, alt);
      if (cp2.ok) {
        try { log('目标文件被占用，已另存为：' + alt); } catch {}
        saved = true;
        return { success: true, outputPath: alt };
      }
      const code = (cp.error && cp.error.code) || '';
      return { success: false, error: '无法写入目标文件' + (code ? '（' + code + '）' : '') + '：目标文件可能正被 Word 或其它程序打开，请先关闭后重新导出' };
    }
    try { log('已导出: ' + outputPath); } catch {}
    saved = true;
    return { success: true, outputPath };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    // 9) 导出保存成功后，整目录删掉「转word」（merged.tex/docx/图片/渲染 等中间产物）不留痕迹；
    //    失败时保留中间产物便于排查，只清 xelatex 编译杂项（aux/log/out）。
    try {
      if (saved) {
        fs.rmSync(workDir, { recursive: true, force: true });
        try { log('已清理中间文件（转word）'); } catch {}
      } else {
        const renderDir = path.join(workDir, '渲染');
        if (fs.existsSync(renderDir)) {
          for (const f of fs.readdirSync(renderDir)) {
            if (/\.(aux|log|out|toc|synctex.*)$/i.test(f)) {
              try { fs.unlinkSync(path.join(renderDir, f)); } catch {}
            }
          }
        }
      }
    } catch {}
  }
}

module.exports = { exportWord, getToolDir, resolvePandoc, getPandocStatus };
