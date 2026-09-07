// Gongfang v2.6 — LaTeX 环境管理（支持内置 TinyTeX + 本地 TeXLive）
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { toShortPath } = require('../core/safe-path');
const { getAssetCandidates, detectEnvSource } = require('./assets');
const { execSync, exec, spawn } = require('child_process');

// ★ 性能：xelatex --version 结果缓存（一次启动任务会重复 spawn xelatex 数次，实测 ~67ms/次）
let _xelatexVersionCache = null; // raw stdout | ''（失败）
function _getXelatexVersionOutput() {
  if (_xelatexVersionCache !== null) return _xelatexVersionCache;
  try {
    _xelatexVersionCache = execSync(`"${getXelatexPath()}" --version`, { encoding: 'utf-8', timeout: 15000 });
  } catch {
    _xelatexVersionCache = '';
  }
  return _xelatexVersionCache;
}
function _xelatexLiveVersion() {
  const m = _getXelatexVersionOutput().match(/TeX Live (\d+)/);
  return m ? m[1] : null;
}

// ── 检测本地 TeXLive 安装 ──
function getSystemTexLiveDir() {
  const candidates = [];
  // Windows: <盘符>:\texlive\<年份>\bin\windows
  const years = ['2026', '2025', '2024', '2023'];
  const drives = ['C', 'D', 'E', 'F', 'G', 'H'];
  for (const drv of drives) {
    for (const y of years) {
      candidates.push(path.join(drv + ':\\texlive', y, 'bin', 'windows'));
      candidates.push(path.join(drv + ':\\Program Files', 'texlive', y, 'bin', 'win32'));
      candidates.push(path.join(drv + ':\\Program Files', 'texlive', y, 'bin', 'windows'));
    }
  }
  for (const dir of candidates) {
    const exe = path.join(dir, 'xelatex.exe');
    if (fs.existsSync(exe)) return dir;
  }
  return null;
}

const REQUIRED_PACKAGES = [
  'amsfonts', 'amsmath', 'amssymb', 'appendix', 'array', 'bigdelim', 'bigstrut',
  'bm', 'booktabs', 'calc', 'caption', 'cite', 'cleveref', 'cprotect', 'ctex',
  'enumitem', 'etoolbox', 'float', 'fontspec', 'geometry', 'graphicx',
  'hyperref', 'ifxetex', 'indentfirst', 'listings', 'longtable', 'mdframed',
  'multirow', 'multicol', 'subcaption', 'tabularx', 'tikz', 'titlesec', 'titletoc',
  'tocloft', 'ulem', 'url', 'xcolor',
  // 依赖项（自动补全时会安装，但预装更稳）
  'zref', 'etoolbox', 'pgf', 'unicode-math', 'fancyhdr', 'auxhook',
  'infwarerr', 'ltxcmds', 'kvsetkeys', 'kvdefinekeys', 'stringenc',
  'pdftexcmds', 'atveryend', 'rerunfilecheck'
];

function getTinyTexDir() {
  const candidates = getAssetCandidates('TinyTeX', { includeAsar: false });
  // ★ P0-8: 兜底候选 —— userData/TinyTeX（内置缺失/只读时把 TinyTeX 下载装到用户可写目录）
  try {
    const { app } = require('electron');
    candidates.push(path.join(app.getPath('userData'), 'TinyTeX'));
  } catch {}
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const realPath = fs.realpathSync(candidate);
      if (realPath) return realPath;
    } catch {}
    return candidate;
  }
  // 都不存在 → 返回用户可写路径作为安装目标（内置路径可能是 Program Files 只读）
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.dirname(candidate))) return candidate;
    } catch {}
  }
  return candidates[0];
}

function getBinDir() {
  // 始终使用内置 TinyTeX，不回退到系统 TeXLive
  const dir = getTinyTexDir();
  const bundledBin = path.join(dir, 'bin', 'windows');
  return bundledBin;
}

function getXelatexPath() {
  return path.join(getBinDir(), 'xelatex.exe');
}

function getTlmgrPath() {
  return path.join(getBinDir(), 'tlmgr.bat');
}

// ★ P0-8: texmf-var / texmf-config 的可写副本。
//   打包到 Program Files 后 app.asar.unpacked 只读，xelatex 写 .fmt/.aux/.cache 会失败。
//   首次启动把 texmf-var / texmf-config 复制到 userData（用户可写），之后 TEXMF* 全部指向副本。
function getWritableTexmf(sub) {
  let userData;
  try { userData = app.getPath('userData'); } catch { userData = path.join(os.homedir(), '.gongfang'); }
  const target = path.join(userData, 'latex-runtime', sub);
  const src = path.join(getTinyTexDir(), sub);
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(src)) fs.cpSync(src, target, { recursive: true });
      else fs.mkdirSync(target, { recursive: true });
    }
  } catch {}
  return target;
}
function getWritableTexmfVar() { return toShortPath(getWritableTexmf('texmf-var')); }
function getWritableTexmfConfig() { return toShortPath(getWritableTexmf('texmf-config')); }
// ★ P3-1: TEXMFHOME 不再写用户主目录（避免污染用户环境 + 中文主目录乱码），改到 userData/texmf
function getWritableTexmfHome() {
  let userData;
  try { userData = app.getPath('userData'); } catch { userData = path.join(os.homedir(), '.gongfang'); }
  const target = path.join(userData, 'texmf');
  try { if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true }); } catch {}
  return toShortPath(target);
}

function isInstalled() {
  const xelatex = getXelatexPath();
  return fs.existsSync(xelatex);
}

function isSystemTexLive() {
  return getSystemTexLiveDir() !== null;
}

// ★ P0-8: 内置 TinyTeX 宏包"已安装"判定。
//   打包版不随发行 .gongfang-packages-installed 标记文件 → 首启误判未装 → 联网装 40+ 宏包（离线就挂）。
//   修复：不依赖标记文件，改为直接检查 texmf-dist 里必需宏包目录是否存在；存在即视为已装（并补写标记）。
// ★ P0-8: 标记文件写到 userData（Program Files 只读时 tinyTexDir 写不进）
function getPackagesFlagPath() {
  try { return path.join(app.getPath('userData'), 'latex-runtime', '.gongfang-packages-installed'); }
  catch { return path.join(getTinyTexDir(), '.gongfang-packages-installed'); }
}

function isPackagesInstalled() {
  if (!isInstalled()) return false;
  const tinyTexDir = getTinyTexDir();
  if (fs.existsSync(getPackagesFlagPath())) return true;
  const flagFile = path.join(tinyTexDir, '.gongfang-packages-installed');
  if (fs.existsSync(flagFile)) return true;
  // 兜底：检查核心宏包目录（ctex/amsmath/geometry/hyperref 等）是否已随包分发
  const checkNames = ['ctex', 'amsmath', 'geometry', 'hyperref', 'booktabs', 'tikz', 'listings', 'fontspec'];
  const latexRoot = path.join(tinyTexDir, 'texmf-dist', 'tex', 'latex');
  let found = 0;
  try {
    if (fs.existsSync(latexRoot)) {
      const dirs = new Set(fs.readdirSync(latexRoot, { withFileTypes: true })
        .filter(e => e.isDirectory()).map(e => e.name));
      for (const n of checkNames) if (dirs.has(n)) found++;
    }
  } catch {}
  if (found >= 5) {
    // 已包含大部分必需宏包 → 补写标记，避免下次再联网
    try {
      fs.writeFileSync(flagFile, JSON.stringify({ installedAt: new Date().toISOString(), packages: REQUIRED_PACKAGES }, null, 2), 'utf-8');
    } catch {}
    return true;
  }
  return false;
}

// ── 检查 xelatex.fmt 是否存在且与当前 xetex 版本匹配 ──
function isFmtValid() {
  // ★ P0-8: 优先查 userData 可写副本（Program Files 只读时原目录 fmt 无法更新）
  const varDir = getWritableTexmfVar();
  const fmtPath = path.join(varDir, 'web2c', 'xetex', 'xelatex.fmt');
  if (!fs.existsSync(fmtPath)) return false;
  // 检查 fmt 文件是否由当前版本的 xetex 生成
  try {
    const versionMatch = _getXelatexVersionOutput().match(/TeX Live (\d+)/);
    if (!versionMatch) return true; // 无法判断，假设有效
    const currentVersion = versionMatch[1];
    // 检查 fmt 文件的生成日志
    const logPath = path.join(varDir, 'web2c', 'xetex', 'xelatex.log');
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, 'utf-8');
      const fmtVersionMatch = logContent.match(/TeX Live (\d+)/);
      if (fmtVersionMatch && fmtVersionMatch[1] !== currentVersion) return false;
    }
  } catch {}
  return true;
}

// ── 重建 xelatex.fmt（直接用内置 xetex -ini 生成，不依赖 fmtutil） ──
function rebuildFmt() {
  const tinyTexDir = getTinyTexDir();
  // ★ 使用短路径避免中文路径导致 Lua 脚本乱码
  const safeTinyTexDir = toShortPath(tinyTexDir);
  const xetexPath = path.join(safeTinyTexDir, 'bin', 'windows', 'xetex.exe');
  if (!fs.existsSync(xetexPath)) return false;
  // ★ P0-8: .fmt 写入 userData 可写副本（Program Files 只读时原 texmf-var 写不进去）
  const fmtDir = path.join(getWritableTexmfVar(), 'web2c', 'xetex');
  try { fs.mkdirSync(fmtDir, { recursive: true }); } catch {}
  try {
    execSync(`"${xetexPath}" -ini -jobname=xelatex -progname=xelatex -etex xelatex.ini`, {
      encoding: 'utf-8',
      timeout: 180000,
      cwd: fmtDir,
      env: {
        ...process.env,
        TEXMFSYSCONFIG: getWritableTexmfConfig(),
        TEXMFVAR: getWritableTexmfVar(),
        TEXMFDIST: path.join(safeTinyTexDir, 'texmf-dist'),
        TEXMFLOCAL: path.join(safeTinyTexDir, 'texmf-local'),
        TEXMFROOT: safeTinyTexDir,
        TEXMFHOME: getWritableTexmfHome(),
        PATH: path.join(safeTinyTexDir, 'bin', 'windows') + path.delimiter + process.env.PATH,
      },
      stdio: 'pipe',
    });
    return fs.existsSync(path.join(fmtDir, 'xelatex.fmt'));
  } catch {
    return false;
  }
}

function getVersion() {
  if (!isInstalled()) return null;
  try {
    const m = _getXelatexVersionOutput().match(/TeX Live (\d+)/);
    return m ? m[1] : 'unknown';
  } catch {
    return null;
  }
}

function getLatexEnv() {
  // ★ 先将 TinyTeX 根目录转为短路径，避免中文路径导致 TeX Live Lua 脚本乱码
  const tinyTexDir = getTinyTexDir();
  const safeTinyTexDir = toShortPath(tinyTexDir);
  const safeBinDir = path.join(safeTinyTexDir, 'bin', 'windows');

  // 过滤 PATH 中的外部 TeX 路径，避免版本冲突
  const systemPath = process.env.PATH || process.env.Path || '';
  const filteredPath = systemPath.split(path.delimiter).filter(Boolean).filter(dir => {
    const normalized = dir.replace(/\\/g, '/').toLowerCase();
    // 保留内置 TinyTeX（也匹配短路径中的大写形式）
    if (normalized.includes('/assets/tinytex/')) return true;
    if (normalized.includes('~1')) return true; // 短路径形式
    // 过滤外部 TeX 安装
    if (normalized.includes('/texlive/')) return false;
    if (normalized.endsWith('/texbin')) return false;
    if (normalized.includes('/tinytex/bin/')) return false;
    if (normalized.includes('/miktex/')) return false;
    if (normalized.includes('/texmf/')) return false;
    return true;
  }).join(path.delimiter);
  const env = {
    PATH: safeBinDir + path.delimiter + filteredPath,
    // ★ P3-5: 不再注入 HOME/USERPROFILE，避免覆盖 runner 里设置的 .claude-home 隔离主目录
  };
  // 仅当实际使用内置 TinyTeX 时才设置 TEXMF 变量（全部使用短路径）
  const binDir = getBinDir();
  const isUsingBundled = binDir.startsWith(tinyTexDir);
  // ★ 防御「明明装了库却报缺失」：kpathsea 一旦读到**无效**的 TEXMFROOT/TEXMFDIST，就不回退到
  //   自带自包含路径，立即全部宏包 not found。因此只有 texmf-dist 真实存在时才注入这些变量；
  //   否则放空让 xelatex 按 SELFAUTOPARENT 自包含定位（实测：不设 TEXMF 反而能正常找到宏包）。
  const texmfDist = path.join(safeTinyTexDir, 'texmf-dist');
  if (isUsingBundled && fs.existsSync(texmfDist)) {
    // ★ 所有 TEXMF 路径必须使用短路径（8.3 格式），避免中文路径导致 Lua 脚本乱码
    // TEXMFROOT 是 kpathsea 的根变量，覆盖 texmf.cnf 中的 $SELFAUTOPARENT
    env.TEXMFROOT = safeTinyTexDir;
    env.TEXMFDIST = texmfDist;
    env.TEXMFLOCAL = path.join(safeTinyTexDir, 'texmf-local');
    // ★ P0-8: TEXMFVAR/SYSCONFIG 指向 userData 可写副本（Program Files 只读不崩）
    env.TEXMFSYSCONFIG = getWritableTexmfConfig();
    env.TEXMFVAR = getWritableTexmfVar();
    // ★ P3-1: TEXMFHOME 不再写用户主目录
    env.TEXMFHOME = getWritableTexmfHome();
    // fontconfig 字体配置（xelatex 需要）
    const fontConfDir = path.join(getWritableTexmfVar(), 'fonts', 'conf');
    if (fs.existsSync(fontConfDir)) {
      env.FONTCONFIG_PATH = fontConfDir;
    }
  }
  return env;
}

async function install(onProgress) {
  const tinyTexDir = getTinyTexDir();
  const report = (msg) => { if (onProgress) onProgress(msg); };

  if (isInstalled()) {
    report('TinyTeX 已安装');
    if (!isPackagesInstalled()) {
      await installPackages(onProgress);
    }
    // 确保 xelatex.fmt 存在且版本匹配
    if (!isFmtValid()) {
      report('正在重建 xelatex.fmt...');
      if (!rebuildFmt()) {
        report('警告：xelatex.fmt 重建失败，可能需要手动修复');
      }
    }
    return { success: true, path: getXelatexPath() };
  }

  const url = 'https://yihui.org/tinytex/install-bin-windows.bat';
  const archiveName = 'install-windows.bat';

  report('正在下载 TinyTeX...');

  const fsExtra = require('fs');
  const tmpDir = path.join(os.tmpdir(), 'gongfang-tinytex-install');
  if (!fsExtra.existsSync(tmpDir)) fsExtra.mkdirSync(tmpDir, { recursive: true });

  const scriptPath = path.join(tmpDir, archiveName);

  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');

    function download(url, dest, cb) {
      const client = url.startsWith('https') ? https : http;
      const file = fsExtra.createWriteStream(dest);
      client.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          download(response.headers.location, dest, cb);
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(cb); });
      }).on('error', (err) => {
        fsExtra.unlinkSync(dest);
        cb(err);
      });
    }

    download(url, scriptPath, async (err) => {
      if (err) {
        report('下载失败: ' + err.message);
        reject(err);
        return;
      }

      report('正在安装 TinyTeX...');

      const env = {
        ...process.env,
        TMPDIR: tmpDir,
        TEXLIVE_INSTALL_PREFIX: tinyTexDir,
        TINYTEX_INSTALL_DIR: tinyTexDir,
      };

      let cmd;
      cmd = exec(`cmd /c "${scriptPath}"`, { env, cwd: tmpDir, timeout: 600000 });

      cmd.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) report(line);
      });
      cmd.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) report('[stderr] ' + line);
      });

      cmd.on('close', async (code) => {
        if (code !== 0) {
          report('TinyTeX 安装退出码: ' + code);
          // 尝试备用方案
          const altDir = path.join(os.homedir(), '.TinyTeX');
          if (fs.existsSync(altDir)) {
            report('检测到备用安装路径，尝试迁移...');
            try {
              if (!fs.existsSync(tinyTexDir)) {
                fs.mkdirSync(path.dirname(tinyTexDir), { recursive: true });
                fs.renameSync(altDir, tinyTexDir);
              }
            } catch (e) {
              report('迁移失败: ' + e.message);
            }
          }
        }

        if (!isInstalled()) {
          report('TinyTeX 安装失败');
          reject(new Error('TinyTeX 安装失败'));
          return;
        }

        report('TinyTeX 安装完成');
        try {
          await installPackages(onProgress);
        } catch (e) {
          report('宏包安装失败: ' + e.message);
          reject(e);
          return;
        }
        resolve({ success: true, path: getXelatexPath() });
      });
    });
  });
}

async function installPackages(onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  const tlmgr = getTlmgrPath();

  if (!fs.existsSync(tlmgr)) {
    report('tlmgr 未找到，跳过宏包安装');
    return;
  }

  // ★ 使用短路径环境，避免中文路径导致 tlmgr 脚本乱码
  const safeEnv = getLatexEnv();

  report('正在更新 tlmgr...');
  try {
    execSync(`"${tlmgr}" update --self`, { encoding: 'utf-8', timeout: 120000, env: safeEnv });
  } catch (e) {
    report('tlmgr 更新失败（可继续）: ' + e.message);
  }

  report('正在安装所需宏包（共 ' + REQUIRED_PACKAGES.length + ' 个）...');

  for (let i = 0; i < REQUIRED_PACKAGES.length; i++) {
    const pkg = REQUIRED_PACKAGES[i];
    report(`[${i + 1}/${REQUIRED_PACKAGES.length}] 安装 ${pkg}...`);
    // 复用稳定安装逻辑（镜像轮询 + 重试）
    const r = await installPackage(pkg, report);
    if (!r.success) report(`  ${pkg} 安装失败（可能已包含在其他包中）: ${r.error}`);
  }

  // 安装中文字体支持
  report('安装中文支持包...');
  const cjkPackages = ['cjk', 'cjkpunct', 'zhnumber', 'ctex'];
  for (const pkg of cjkPackages) {
    const r = await installPackage(pkg, report);
    if (!r.success) report(`  ${pkg} 安装失败: ${r.error}`);
  }

  // 标记安装完成（★ P0-8: 写到 userData，Program Files 只读也能写）
  const flagFile = getPackagesFlagPath();
  try {
    fs.mkdirSync(path.dirname(flagFile), { recursive: true });
    fs.writeFileSync(flagFile, JSON.stringify({
      installedAt: new Date().toISOString(),
      packages: REQUIRED_PACKAGES,
      version: getVersion()
    }, null, 2), 'utf-8');
  } catch {}

  report('宏包安装完成');
}

async function uninstall() {
  const tinyTexDir = getTinyTexDir();
  if (fs.existsSync(tinyTexDir)) {
    try { fs.rmSync(tinyTexDir, { recursive: true, force: true }); } catch {}
    return { success: true };
  }
  return { success: false, error: 'TinyTeX 未安装' };
}

function getStatus() {
  const installed = isInstalled();
  const tinyTexDir = getTinyTexDir();
  let cachedVersion = null;
  try {
    if (installed) cachedVersion = _xelatexLiveVersion() || 'unknown';
  } catch {}
  return {
    installed,
    source: detectEnvSource(tinyTexDir),   // appenv / bundled / userdata / custom
    path: installed ? getXelatexPath() : null,
    version: installed ? cachedVersion : null,
    packagesReady: installed && isPackagesInstalled(),
    fmtValid: installed && isFmtValid(),
    dir: tinyTexDir,
    binDir: installed ? getBinDir() : null,
  };
}

// ── 列出已安装的 TeX 宏包（按目录名，来自 texmf-dist/tex/latex 与 macros） ──
function listPackages() {
  try {
    const tinyTexDir = getTinyTexDir();
    const roots = [
      path.join(tinyTexDir, 'texmf-dist', 'tex', 'latex'),
      path.join(tinyTexDir, 'texmf-dist', 'tex', 'generic'),
      path.join(tinyTexDir, 'texmf-dist', 'tex', 'plain'),
    ];
    const set = new Set();
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) set.add(e.name);
      }
    }
    return { success: true, packages: Array.from(set).sort() };
  } catch (e) { return { success: false, error: e.message || '列出失败' }; }
}

// CTAN 镜像源列表（清华优先，其余国内源兜底，保证稳定安装）
const CTAN_MIRRORS = [
  { name: '清华', url: 'https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet' },
  { name: '中科大', url: 'https://mirrors.ustc.edu.cn/CTAN/systems/texlive/tlnet' },
  { name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/CTAN/systems/texlive/tlnet' },
  { name: '官方', url: 'https://mirror.ctan.org/systems/texlive/tlnet' },
];
const CTAN_MIRROR = CTAN_MIRRORS[0].url; // 默认：清华
function ensureCtanMirror() {
  try {
    const tlmgr = getTlmgrPath();
    if (!fs.existsSync(tlmgr)) return;
    execSync(`"${tlmgr}" option repository ${CTAN_MIRROR}`, { encoding: 'utf-8', timeout: 30000, env: getLatexEnv() });
  } catch {}
}

// ── 手动安装指定 TeX 宏包（tlmgr install <pkg>，镜像轮询 + 重试，保证稳定安装） ──
async function installPackage(packageName, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  let name = String(packageName || '').trim();
  if (!name) return { success: false, error: '请输入宏包名' };
  // 若传入的是文件名（如 cite.sty），去掉扩展名得到包名
  const extMatch = name.match(/^(.+)\.(sty|cls)$/i);
  if (extMatch) name = extMatch[1];
  const tlmgr = getTlmgrPath();
  if (!fs.existsSync(tlmgr)) return { success: false, error: 'tlmgr 未找到，无法安装宏包' };
  ensureCtanMirror();

  const installOpts = { encoding: 'utf-8', timeout: 180000, stdio: 'pipe', env: getLatexEnv() };
  const maxAttemptsPerMirror = 2;
  const results = [];

  for (const mirror of CTAN_MIRRORS) {
    for (let attempt = 1; attempt <= maxAttemptsPerMirror; attempt++) {
      report(`正在安装宏包 ${name}（${mirror.name}，第 ${attempt}/${maxAttemptsPerMirror} 次）...`);
      try {
        execSync(`"${tlmgr}" --repository ${mirror.url} install ${name}`, installOpts);
        report(`宏包 ${name} 安装成功`);
        return { success: true, package: name };
      } catch (e) {
        results.push(e.message || ('安装 ' + name + ' 失败'));
        report(`${mirror.name}: 安装 ${name} 失败（${e.message}）`);
        if (attempt < maxAttemptsPerMirror) await new Promise(r => setTimeout(r, 1500)); // 简单退避
      }
    }
  }

  report(`宏包 ${name} 安装失败: ` + (results[results.length - 1] || '未知错误'));
  return { success: false, error: results[results.length - 1] || ('安装 ' + name + ' 失败') };
}

// ── 搜索 TeX 宏包（tlmgr search --global，先确保用国内镜像） ──
function searchPackages(query) {
  const name = String(query || '').trim();
  if (!name) return { success: false, error: '请输入宏包名' };
  ensureCtanMirror();
  const tlmgr = getTlmgrPath();
  if (!fs.existsSync(tlmgr)) return { success: false, error: 'tlmgr 未找到' };
  try {
    const out = execSync(`"${tlmgr}" search --global --all "${name}"`, { encoding: 'utf-8', timeout: 40000, env: getLatexEnv() });
    const lines = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const pkgs = [];
    lines.forEach(l => {
      const m = l.match(/^([a-zA-Z0-9_\-]+)/);
      if (m && m[1].toLowerCase().indexOf(name.toLowerCase()) >= 0 && !pkgs.includes(m[1])) pkgs.push(m[1]);
    });
    return { success: pkgs.length > 0, packages: pkgs.slice(0, 40), query: name };
  } catch (e) { return { success: false, error: e.message || '搜索失败' }; }
}

// ── 检测系统 TeX Live（常见安装路径 / where latexmk / where xelatex，收集全部可用） ──
function detectSystemLatex() {
  const paths = [];
  const _add = (p) => { p = String(p || '').trim(); if (p && fs.existsSync(p) && !paths.includes(p)) paths.push(p); };
  try {
    const out = execSync('where latexmk 2>nul', { encoding: 'utf-8', timeout: 15000, shell: 'cmd.exe' });
    (out || '').split(/\r?\n/).forEach(_add);
  } catch {}
  try {
    const out = execSync('where xelatex 2>nul', { encoding: 'utf-8', timeout: 15000, shell: 'cmd.exe' });
    (out || '').split(/\r?\n/).forEach(_add);
  } catch {}
  const dir = getSystemTexLiveDir();
  if (dir) {
    _add(path.join(dir, 'latexmk.exe'));
    _add(path.join(dir, 'xelatex.exe'));
  }
  if (paths.length) return { success: true, path: paths[0], paths };
  return { success: false, error: '未检测到系统 LaTeX' };
}

module.exports = {
  install,
  uninstall,
  installPackages,
  isInstalled,
  isSystemTexLive,
  isFmtValid,
  rebuildFmt,
  getStatus,
  getVersion,
  getXelatexPath,
  getTlmgrPath,
  getBinDir,
  getLatexEnv,
  REQUIRED_PACKAGES,
  listPackages,
  detectSystemLatex,
  installPackage,
  searchPackages,
};
