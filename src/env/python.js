// Gongfang v2.6 — 内置 Python 运行环境
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { toShortPath } = require('../core/safe-path');
const { getAssetCandidates, getAppEnvRoots, detectEnvSource } = require('./assets');
const { execSync, spawn } = require('child_process');

// ── 基础依赖清单 ──
// ★ 基础依赖清单：与 assets/python-requirements-base.txt 保持一致（离线 wheel 安装以该文件为准）。
//   pypdf / PyPDF2 是「py-pdf」提示的根源，缺一不可；lxml / pymupdf(fitz) 是 Word 导出必备；
//   cv2(opencv) / yaml / bs4 / requests / tqdm / joblib / xlsxwriter / pptx / reportlab 是常见工作流增强库。
const BASE_REQUIREMENTS = [
  'numpy', 'pandas', 'scipy', 'scikit-learn', 'matplotlib',
  'seaborn', 'statsmodels', 'sympy', 'openpyxl', 'xlrd',
  'networkx', 'pillow', 'python-docx', 'pdfplumber',
  'PyPDF2', 'pypdf', 'pymupdf', 'lxml',
  'opencv-python', 'pyyaml', 'beautifulsoup4', 'requests', 'tqdm',
  'joblib', 'xlsxwriter', 'python-pptx', 'reportlab', 'pypandoc',
];

// ── 自动安装白名单 ──
const AUTO_INSTALL_WHITELIST = [
  'numpy', 'pandas', 'scipy', 'scikit-learn', 'matplotlib',
  'seaborn', 'statsmodels', 'sympy', 'openpyxl', 'xlrd',
  'networkx', 'pillow', 'opencv-python', 'pyyaml',
  'beautifulsoup4', 'lxml', 'requests', 'tqdm', 'joblib',
  'python-docx', 'pdfplumber', 'pymupdf', 'pypdf', 'PyPDF2',
  'xlsxwriter', 'python-pptx', 'reportlab', 'pypandoc',
];

// ── 模块名 → 包名映射 ──
const MODULE_TO_PACKAGE = {
  sklearn: 'scikit-learn',
  cv2: 'opencv-python',
  PIL: 'pillow',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  lxml: 'lxml',
  np: 'numpy',
  pd: 'pandas',
  plt: 'matplotlib',
  sns: 'seaborn',
  sp: 'sympy',
  scipy: 'scipy',
  stats: 'statsmodels',
  docx: 'python-docx',
  fitz: 'pymupdf',
  pypdf: 'pypdf',
  PyPDF2: 'PyPDF2',
  lxml: 'lxml',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  requests: 'requests',
  tqdm: 'tqdm',
  joblib: 'joblib',
  xlsxwriter: 'xlsxwriter',
  pptx: 'python-pptx',
  reportlab: 'reportlab',
  pypandoc: 'pypandoc',
};

// ── 平台检测 ──
function getRuntimePlatform() {
  return 'win-x64';
}

// ── 安装包内 Python runtime 源目录 ──
function getPythonRuntimeSourceDir() {
  const platform = getRuntimePlatform();
  const candidates = getAssetCandidates(path.join('python-runtime', platform), { includeAsar: false });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

// ── 安装包内预构建 Python 环境源目录 ──
function getPrebuiltPythonEnvSourceDir() {
  const platform = getRuntimePlatform();
  const candidates = getAssetCandidates(path.join('python-env', platform), { includeAsar: false });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

// ── 安装包内 wheelhouse 源目录 ──
function getWheelhouseSourceDir() {
  const platform = getRuntimePlatform();
  const candidates = getAssetCandidates(path.join('python-wheels', platform), { includeAsar: false });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

// ── requirements 文件路径 ──
function getRequirementsPath() {
  const candidates = getAssetCandidates('python-requirements-base.txt', { includeAsar: true });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

// 在 Gongfang_env 根目录下找一个「python.exe 所在目录」（兼容 win-x64 / win64 / x64 / 直接放 python.exe）
function _findPythonDir(root) {
  if (!root) return null;
  const pyBase = path.join(root, 'python-env');
  if (!fs.existsSync(pyBase)) return null;
  const hasExe = (d) => (d && fs.existsSync(path.join(d, 'python.exe'))) ? d : null;
  for (const sub of ['win-x64', 'win64', 'x64']) {
    const p = hasExe(path.join(pyBase, sub));
    if (p) return p;
  }
  const direct = hasExe(pyBase);
  if (direct) return pyBase;
  try {
    for (const sub of fs.readdirSync(pyBase)) {
      const p = hasExe(path.join(pyBase, sub));
      if (p) return p;
    }
  } catch {}
  return null;
}

// ── Python 环境目录（直接使用 assets 内的独立 Python，无需复制） ──
function getPythonEnvDir() {
  // 优先：检测到的任一 Gongfang_env 内的可用 python（含多种子目录名，见 _findPythonDir）
  for (const root of getAppEnvRoots()) {
    const dir = _findPythonDir(root);
    if (dir) return dir;
  }
  // 其次：assets 内（历史版本直接放 assets/python-env/win-x64）
  const candidates = getAssetCandidates(path.join('python-env', getRuntimePlatform()), { includeAsar: false });
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'python.exe'))) return candidate;
  }
  // 回退到 userData 目录（兼容旧部署）
  let userDataDir;
  if (app && app.getPath) {
    userDataDir = toShortPath(app.getPath('userData'));
  } else {
    userDataDir = toShortPath(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Gongfang'));
  }
  return path.join(userDataDir, 'runtime', 'python-env');
}

// ── Python 可执行文件路径（独立发行版，python.exe 在根目录） ──
function getPythonPath() {
  const envDir = getPythonEnvDir();
  return path.join(envDir, 'python.exe');
}

// ── pip 路径 ──
function getPipPath() {
  const envDir = getPythonEnvDir();
  return path.join(envDir, 'Scripts', 'pip.exe');
}

// ── bin 目录路径 ──
function getBinDir() {
  const envDir = getPythonEnvDir();
  return envDir;  // python.exe 在根目录
}

// ── 标记文件路径 ──
function getReadyFlagPath() {
  return path.join(getPythonEnvDir(), '.gongfang-python-ready');
}

// ── 修正 pyvenv.cfg 中的硬编码路径 ──
function fixPyvenvCfg(envDir) {
  try {
    const cfgPath = path.join(envDir, 'pyvenv.cfg');
    if (!fs.existsSync(cfgPath)) return false;
    let cfg = fs.readFileSync(cfgPath, 'utf-8');
    // 检测是否包含不属于当前用户的路径（如 C:\Users\其他用户名\ 或明显的开发者路径）
    const needsFix = /^[a-z]\s*=\s*[A-Z]:\\Users\\(?!Public)/.test(cfg) &&
                     !cfg.includes(envDir.replace(/\//g, '\\'));
    if (!needsFix) return false;
    const pythonExe = path.join(envDir, 'python.exe');
    cfg = cfg.replace(/^(home\s*=\s*).+$/m, '$1' + envDir);
    cfg = cfg.replace(/^(executable\s*=\s*).+$/m, '$1' + pythonExe);
    cfg = cfg.replace(/^(command\s*=\s*).+$/m, '$1' + pythonExe + ' -m venv ' + envDir);
    fs.writeFileSync(cfgPath, cfg, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ── 检查是否就绪 ──
function isReady() {
  const pythonPath = getPythonPath();
  if (!fs.existsSync(pythonPath)) return false;
  try {
    execSync(`"${pythonPath}" --version`, {
      encoding: 'utf-8',
      timeout: 15000,
      env: _getInternalPythonEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

// ── 获取 Python 版本 ──
function getVersion() {
  const pythonPath = getPythonPath();
  if (!fs.existsSync(pythonPath)) return null;
  try {
    const out = execSync(`"${pythonPath}" --version`, {
      encoding: 'utf-8',
      timeout: 15000,
      env: _getInternalPythonEnv(),
    }).trim();
    const m = out.match(/Python\s+([\d.]+)/);
    return m ? m[1] : out;
  } catch {
    return null;
  }
}

// ── 获取状态 ──
function getStatus() {
  const ready = isReady();
  const version = getVersion();
  return {
    ready,
    version,
    pythonPath: ready ? getPythonPath() : null,
    binDir: ready ? getBinDir() : null,
    envDir: getPythonEnvDir(),
    platform: getRuntimePlatform(),
    source: detectEnvSource(getPythonEnvDir()),   // appenv / bundled / userdata / custom
  };
}

// ── 获取注入的环境变量（给 agent 用，不设 PYTHONHOME 避免与系统 Python 冲突） ──
function getPythonEnv() {
  const envDir = getPythonEnvDir();
  const scriptsDir = path.join(envDir, 'Scripts');
  // 确保内置 Python 在 PATH 最前面，优先于系统 Python
  const systemPath = process.env.PATH || '';
  const systemPathWin = process.env.Path || '';
  // 过滤掉系统 PATH 中的 Python 路径，避免冲突
  const filteredSystemPath = systemPath.split(path.delimiter)
    .filter(d => !isSystemPythonPath(d))
    .join(path.delimiter);
  return {
    PATH: envDir + path.delimiter + scriptsDir + path.delimiter + filteredSystemPath,
    Path: envDir + path.delimiter + scriptsDir + path.delimiter + filteredSystemPath,
    PYTHONNOUSERSITE: '1',
    MPLBACKEND: 'Agg',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };
}

// 检测系统 Python 路径（排除我们的内置 Python）
function isSystemPythonPath(dir) {
  if (!dir || typeof dir !== 'string') return false;
  const n = dir.replace(/\\/g, '/').toLowerCase();
  if (n.includes('gongfang') || n.includes('python-env')) return false;
  return n.includes('/python3') || n.includes('/python/python')
    || n.includes('/python310/') || n.includes('/python311/')
    || n.includes('/python312/') || n.includes('/python313/')
    || n.includes('/windowsapps/') || n.includes('/appdata/local/programs/python');
}

// ── 内部调用用的环境（带 PYTHONHOME，确保找到标准库） ──
function _getInternalPythonEnv() {
  const envDir = getPythonEnvDir();
  // 过滤掉系统 PATH 中的 Python 路径（含 Windows Store 重定向）
  const filteredPath = (process.env.PATH || '').split(path.delimiter)
    .filter(d => !isSystemPythonPath(d))
    .join(path.delimiter);
  return {
    ...process.env,
    PATH: envDir + path.delimiter + path.join(envDir, 'Scripts') + path.delimiter + filteredPath,
    Path: envDir + path.delimiter + path.join(envDir, 'Scripts') + path.delimiter + filteredPath,
    PYTHONHOME: envDir,
    PYTHONNOUSERSITE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };
}

// ── 执行 Python 命令（同步） ──
function execPython(args, opts = {}) {
  const pythonPath = getPythonPath();
  const env = {
    ..._getInternalPythonEnv(),
    ...(opts.env || {}),
  };
  return execSync(`"${pythonPath}" ${args}`, {
    encoding: 'utf-8',
    timeout: opts.timeout || 60000,
    env,
    cwd: opts.cwd || undefined,
    stdio: opts.stdio || 'pipe',
  });
}

// ── 执行 pip 命令（同步） ──
function execPip(args, opts = {}) {
  const pythonPath = getPythonPath();
  const env = {
    ..._getInternalPythonEnv(),
    ...(opts.env || {}),
  };
  // 用 python -m pip 比直接调用 pip 更稳定
  return execSync(`"${pythonPath}" -m pip ${args}`, {
    encoding: 'utf-8',
    timeout: opts.timeout || 300000,
    env,
    cwd: opts.cwd || undefined,
    stdio: opts.stdio || 'pipe',
  });
}

// ── 基础依赖校验缓存：多库 import 实测耗时较长，不能每次启动都同步跑（主线程被堵 → 界面无响应） ──
//   方案：①异步 spawn（不阻塞主进程事件循环）②环境签名缓存（python.exe + site-packages 的 mtime
//   没变 → 直接复用上次结果，0 阻塞）。缓存放系统临时目录（env 目录在打包态可能只读）。
const PYCHECK_IMPORT_NAMES = {
  numpy: 'numpy', pandas: 'pandas', scipy: 'scipy', sklearn: 'scikit-learn',
  matplotlib: 'matplotlib', seaborn: 'seaborn', statsmodels: 'statsmodels',
  sympy: 'sympy', openpyxl: 'openpyxl', xlrd: 'xlrd', networkx: 'networkx',
  PIL: 'pillow', docx: 'python-docx', pdfplumber: 'pdfplumber',
  fitz: 'pymupdf', pypdf: 'pypdf', PyPDF2: 'PyPDF2', lxml: 'lxml',
  cv2: 'opencv-python', yaml: 'pyyaml', bs4: 'beautifulsoup4',
  requests: 'requests', tqdm: 'tqdm', joblib: 'joblib',
  xlsxwriter: 'xlsxwriter', pptx: 'python-pptx', reportlab: 'reportlab',
  pypandoc: 'pypandoc',
};

function _pycheckCachePath() {
  const envDir = getPythonEnvDir();
  let h = 5381;
  for (let i = 0; i < envDir.length; i++) h = ((h << 5) + h + envDir.charCodeAt(i)) | 0;
  return path.join(os.tmpdir(), 'gongfang-pycheck-' + (h >>> 0).toString(36) + '.json');
}

// 环境签名：python.exe + site-packages 顶层目录的 mtime。任一变化 → 签名变 → 重验。
function _envStateSignature() {
  const envDir = getPythonEnvDir();
  const pythonPath = path.join(envDir, 'python.exe');
  const spDir = path.join(envDir, 'Lib', 'site-packages');
  let sig = '';
  try { sig += 'py=' + Math.floor(fs.statSync(pythonPath).mtimeMs) + ';'; } catch { sig += 'py=?;'; }
  try {
    const entries = fs.readdirSync(spDir, { withFileTypes: true }).filter(e => e.isDirectory());
    sig += 'n=' + entries.length + ';';
    for (const e of entries) {
      try { sig += e.name.slice(0, 3) + ':' + Math.floor(fs.statSync(path.join(spDir, e.name)).mtimeMs) + ';'; } catch {}
    }
  } catch { sig += 'sp=?;'; }
  return sig;
}

// 异步跑基础库 import 检查（spawn 不阻塞主进程；超时 60s 同原行为）
function _runPycheck(pythonPath) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), 'gongfang_pycheck_' + process.pid + '_' + Date.now().toString(36) + '.py');
    try {
      const code = Object.keys(PYCHECK_IMPORT_NAMES)
        .map(m => `try:\n  __import__('${m}')\nexcept Exception:\n  print('MISS:'+'${m}')`)
        .join('\n');
      fs.writeFileSync(tmpFile, code, 'utf-8');
    } catch { return resolve(BASE_REQUIREMENTS.slice()); }
    const proc = spawn(pythonPath, [tmpFile], { env: _getInternalPythonEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 60000);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', () => {});
    proc.on('error', () => { clearTimeout(timer); try { fs.unlinkSync(tmpFile); } catch {} resolve(BASE_REQUIREMENTS.slice()); });
    proc.on('close', () => {
      clearTimeout(timer);
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      const missing = (out || '').split(/\r?\n/).filter(l => l.startsWith('MISS:')).map(l => l.slice(5));
      resolve(missing.map(m => PYCHECK_IMPORT_NAMES[m] || m));
    });
  });
}

// ── 校验基础依赖能否 import（★ P2-9: 不只验 --version，避免缺包时静默联网卡死） ──
async function verifyBaseRequirements() {
  const pythonPath = getPythonPath();
  if (!fs.existsSync(pythonPath)) return BASE_REQUIREMENTS.slice();
  const cachePath = _pycheckCachePath();
  const sig = _envStateSignature();
  // 缓存命中：环境没变，直接复用上次结果（0 阻塞）
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (cached && cached.sig === sig && Array.isArray(cached.missing)) return cached.missing;
  } catch {}
  // 未命中：异步重跑并写回缓存
  const missing = await _runPycheck(pythonPath);
  try { fs.writeFileSync(cachePath, JSON.stringify({ sig, missing, t: Date.now() }), 'utf-8'); } catch {}
  return missing;
}

// ── 确保环境存在（直接使用 assets 内的 Python，无需部署） ──
async function ensure(onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };

  if (isReady()) {
    // ★ P2-9: 基础依赖校验：缺包时先走离线 wheel 兜底，再走在线，都失败给明确提示（不静默卡死）
    // ★ 性能：verifyBaseRequirements 已异步化 + 缓存（spawn 不阻塞主进程；环境未变时 0 阻塞）
    const missing = await verifyBaseRequirements();
    if (missing.length) {
      report('检测到缺少基础库：' + missing.join(', ') + '，尝试补齐...');
      try {
        await installBasePackages(onProgress);
        const stillMissing = await verifyBaseRequirements();
        if (stillMissing.length) {
          report('警告：以下库仍未安装：' + stillMissing.join(', ') + '（离线环境请手动安装）');
        } else {
          report('基础库已补齐');
        }
      } catch (e) {
        report('基础库安装失败: ' + (e.message || e));
      }
    } else {
      report('Python 环境已就绪');
    }
    return { success: true };
  }

  // Python 不可用（assets 目录没有 python.exe）
  const searched = [
    ...getAssetCandidates(path.join('python-env', getRuntimePlatform()), { includeAsar: false }),
  ];
  report('错误：未找到内置 Python 环境');
  return {
    success: false,
    error: '未找到内置 Python 环境。已查找: ' + searched.join(' | '),
    searched,
  };
}

// ── 确保目录中有可用的 pip ──
function ensurePipInDir(dir) {
  const pipExe = path.join(dir, 'Scripts', 'pip.exe');
  if (fs.existsSync(pipExe)) return;
  const pythonExe = path.join(dir, 'python.exe');
  if (!fs.existsSync(pythonExe)) return;
  try {
    execSync(`"${pythonExe}" -m ensurepip --upgrade`, {
      encoding: 'utf-8',
      timeout: 60000,
      env: { ...process.env, PYTHONHOME: dir, PYTHONNOUSERSITE: '1' },
      stdio: 'pipe',
    });
  } catch {}
}

// ── 从 runtime 目录获取 Python 可执行文件路径 ──
function getRuntimePythonPath(runtimeDir) {
  // Windows: python.exe 在根目录或 Scripts
  const candidates = [
    path.join(runtimeDir, 'python.exe'),
    path.join(runtimeDir, 'Scripts', 'python.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── 从指定目录获取 Python 路径（独立发行版，python.exe 在根目录） ──
function getPythonPathFromDir(envDir) {
  return path.join(envDir, 'python.exe');
}

// ── 从指定目录获取版本 ──
function getVersionFromDir(envDir) {
  const pythonPath = getPythonPathFromDir(envDir);
  if (!fs.existsSync(pythonPath)) return null;
  try {
    const out = execSync(`"${pythonPath}" --version`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, PYTHONHOME: envDir, PYTHONNOUSERSITE: '1' },
    }).trim();
    const m = out.match(/Python\s+([\d.]+)/);
    return m ? m[1] : out;
  } catch {
    return null;
  }
}

// ── requirements hash（用于判断是否需要重新安装） ──
function getRequirementsHash() {
  try {
    const content = BASE_REQUIREMENTS.join('\n');
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
  } catch {
    return '00000000';
  }
}

// ── 在指定目录安装基础库（独立发行版，直接装到 Lib/site-packages） ──
async function installBasePackagesInDir(envDir, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  const pythonPath = getPythonPathFromDir(envDir);
  const wheelhouseDir = getWheelhouseSourceDir();
  const reqFile = getRequirementsPath();

  const env = {
    ...process.env,
    PATH: envDir + path.delimiter + path.join(envDir, 'Scripts') + path.delimiter + process.env.PATH,
    PYTHONHOME: envDir,
    PYTHONNOUSERSITE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  // 优先离线安装
  if (fs.existsSync(wheelhouseDir) && fs.existsSync(reqFile)) {
    report('正在离线安装基础库（使用内置 wheelhouse）...');
    try {
      execSync(`"${pythonPath}" -m pip install --no-index --find-links "${wheelhouseDir}" -r "${reqFile}"`, {
        encoding: 'utf-8',
        timeout: 600000,
        env,
        stdio: 'pipe',
      });
      report('基础库安装完成');
      return;
    } catch (e) {
      report('离线安装失败，尝试在线安装: ' + e.message);
    }
  }

  // 在线安装
  report('正在在线安装基础库...');
  for (let i = 0; i < BASE_REQUIREMENTS.length; i++) {
    const pkg = BASE_REQUIREMENTS[i];
    report(`[${i + 1}/${BASE_REQUIREMENTS.length}] 安装 ${pkg}...`);
    try {
      execSync(`"${pythonPath}" -m pip install ${pkg}`, {
        encoding: 'utf-8',
        timeout: 120000,
        env,
        stdio: 'pipe',
      });
    } catch (e) {
      report(`  ${pkg} 安装失败: ${e.message}`);
    }
  }
  report('基础库安装完成');
}

// ── 安装基础库（在已初始化的环境中） ──
async function installBasePackages(onProgress) {
  return installBasePackagesInDir(getPythonEnvDir(), onProgress);
}

// ── pip 镜像源列表（按优先级排列，中国大陆用户用清华/阿里更快） ──
const PIP_MIRRORS = [
  { name: 'PyPI', url: 'https://pypi.org/simple' },
  { name: '清华', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple' },
  { name: '中科大', url: 'https://pypi.mirrors.ustc.edu.cn/simple' },
  { name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple' },
];

// ── 测速：用 https.get 测试每个镜像的响应时间，选最快的 ──
async function _pickFastestMirror(timeoutMs = 3000) {
  const https = require('https');
  const testPackage = '/simple/pip/';  // 小页面，用于测速

  const tests = PIP_MIRRORS.map(mirror => {
    return new Promise(resolve => {
      const start = Date.now();
      const url = new URL(mirror.url + testPackage);
      const req = https.get({
        hostname: url.hostname,
        path: url.pathname,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'pip' },
      }, res => {
        // 只需要首字节到就行，不读 body
        const elapsed = Date.now() - start;
        res.destroy();
        resolve({ mirror, elapsed });
      });
      req.on('error', () => resolve({ mirror, elapsed: Infinity }));
      req.on('timeout', () => { req.destroy(); resolve({ mirror, elapsed: Infinity }); });
    });
  });

  const results = await Promise.all(tests);
  // 按响应时间排序，选最快的
  results.sort((a, b) => a.elapsed - b.elapsed);
  const best = results[0];
  if (best.elapsed === Infinity) return null; // 全部不可达
  console.log('[python-env] 最快镜像:', best.mirror.name, best.elapsed + 'ms');
  return best.mirror;
}

// 缓存测速结果（5 分钟内不重复测）
let _cachedFastMirror = null;
let _cachedFastMirrorTime = 0;

async function _getFastMirror() {
  if (_cachedFastMirror && (Date.now() - _cachedFastMirrorTime < 300000)) {
    return _cachedFastMirror;
  }
  _cachedFastMirror = await _pickFastestMirror();
  _cachedFastMirrorTime = Date.now();
  return _cachedFastMirror;
}

// ── 安装单个包（联网，镜像轮询 + 重试，保证稳定安装） ──
async function installPackage(packageName, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  const pythonPath = getPythonPath();
  if (!fs.existsSync(pythonPath)) {
    return { success: false, error: 'Python 环境未初始化' };
  }

  report('正在安装 ' + packageName + '...');

  // 构造镜像轮询顺序：优先用测速最快的镜像，其余按 PIP_MIRRORS 顺序补充
  const speedMirror = await _getFastMirror();
  const orderedMirrors = [];
  if (speedMirror) {
    orderedMirrors.push(speedMirror);
    PIP_MIRRORS.forEach(m => { if (m.url !== speedMirror.url) orderedMirrors.push(m); });
  } else {
    orderedMirrors.push(...PIP_MIRRORS);
  }

  const installOpts = {
    encoding: 'utf-8',
    timeout: 180000,
    env: _getInternalPythonEnv(),
    stdio: 'pipe',
  };
  const maxAttemptsPerMirror = 2;
  const results = [];

  for (const mirror of orderedMirrors) {
    const indexUrl = mirror.url;
    const host = new URL(indexUrl).hostname;
    for (let attempt = 1; attempt <= maxAttemptsPerMirror; attempt++) {
      report(`使用镜像源: ${mirror.name}（第 ${attempt}/${maxAttemptsPerMirror} 次尝试）`);
      try {
        execSync(`"${pythonPath}" -m pip install ${packageName} -i ${indexUrl} --trusted-host ${host} --timeout 60 --disable-pip-version-check`, installOpts);
        report(packageName + ' 安装成功');
        return { success: true };
      } catch (e) {
        results.push(e.message);
        report(`${mirror.name}: 安装 ${packageName} 失败（${e.message}）`);
        if (attempt < maxAttemptsPerMirror) await new Promise(r => setTimeout(r, 1500)); // 简单退避
      }
    }
  }

  report(packageName + ' 安装失败: ' + (results[results.length - 1] || '未知错误'));
  return { success: false, error: results[results.length - 1] || '安装失败' };
}

// ── 从 stderr 解析缺失的模块名（兼容 ModuleNotFoundError / ImportError: No module named） ──
function parseMissingModule(stderr) {
  if (!stderr) return null;
  // "ModuleNotFoundError: No module named 'xxx'" 或 "ImportError: No module named 'xxx'"
  const m = stderr.match(/(?:ModuleNotFoundError|ImportError):\s*No module named\s+['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// ── 模块名 → 包名映射 ──
function mapModuleToPackage(moduleName) {
  if (!moduleName) return null;
  // 已知映射
  if (MODULE_TO_PACKAGE[moduleName]) return MODULE_TO_PACKAGE[moduleName];
  // 如果模块名本身就是包名（如 numpy, pandas），直接返回
  if (BASE_REQUIREMENTS.includes(moduleName)) return moduleName;
  if (AUTO_INSTALL_WHITELIST.includes(moduleName)) return moduleName;
  return moduleName; // 返回原始名，由白名单判断
}

// ── 重置环境 ──
async function resetEnv(onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  const envDir = getPythonEnvDir();

  report('正在删除 Python 环境...');
  if (fs.existsSync(envDir)) {
    fs.rmSync(envDir, { recursive: true, force: true });
  }
  // 也清理临时目录
  const tmpDir = envDir + '.tmp';
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  report('Python 环境已删除，正在重新初始化...');
  return ensure(onProgress);
}

// ── 搜索 PyPI 库：先用国内镜像确认包是否存在并列出可用版本（安装前先搜索） ──
async function searchPackages(query) {
  const name = String(query || '').trim();
  if (!name) return { success: false, error: '请输入库名' };
  const py = getPythonPath();
  if (!py || !fs.existsSync(py)) return { success: false, error: 'Python 环境不可用' };
  try {
    const mirror = await _getFastMirror();
    const indexUrl = mirror ? mirror.url : PIP_MIRRORS[0].url;
    const out = execSync(`"${py}" -m pip index versions ${name} --index-url ${indexUrl}`, { encoding: 'utf-8', timeout: 30000, env: _getInternalPythonEnv() });
    const m = out.match(/Available versions:\s*([\s\S]+)/i);
    const versions = m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
    const size = await getPackageFileSize(name);
    return { success: true, name, versions, mirror: mirror ? mirror.name : 'PyPI', size, sizeText: fmtSize(size) };
  } catch (e) {
    return { success: false, error: '镜像源中未找到该库（可能名称不对，可试试 AI 推荐）' };
  }
}

// ── 获取某个库在镜像上的安装包大小（HEAD 第一个 .whl 文件） ──
function getPackageFileSize(name) {
  return new Promise((resolve) => {
    try {
      (async () => {
        const mirror = await _getFastMirror();
        const indexUrl = mirror ? mirror.url : PIP_MIRRORS[0].url;
        const https = require('https');
        const idx = indexUrl.replace(/\/$/, '') + '/' + encodeURIComponent(name) + '/';
        const fileUrl = await new Promise((resolve2) => {
          const req = https.get(idx, { timeout: 10000 }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve2(null); }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              // href 形如 "../../packages/xx/.../numpy-xxx.whl#sha256=..."
              const m = data.match(/href="([^"]+?\.whl)/);
              resolve2(m ? m[1] : null);
            });
          });
          req.on('error', () => resolve2(null));
          req.on('timeout', () => { req.destroy(); resolve2(null); });
        });
        if (!fileUrl) return resolve(null);
        const full = fileUrl.indexOf('http') === 0 ? fileUrl : new URL(fileUrl, idx).toString();
        const r2 = https.get(full, { method: 'HEAD', timeout: 10000 }, (res) => {
          const len = parseInt(res.headers['content-length'] || '0', 10);
          res.resume();
          resolve(len || null);
        });
        r2.on('error', () => resolve(null));
        r2.on('timeout', () => { r2.destroy(); resolve(null); });
      })();
    } catch { resolve(null); }
  });
}
function fmtSize(n) {
  if (!n) return '';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

// ── 列出已安装的 Python 库（默认内置环境；可传系统 python 路径） ──
function listPackages(pythonPath) {
  try {
    const py = pythonPath || getPythonPath();
    if (!py || !fs.existsSync(py)) return { success: false, error: 'Python 环境不可用' };
    const out = execSync(`"${py}" -m pip list --format=freeze`, { encoding: 'utf-8', timeout: 25000 });
    const packages = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return { success: true, packages };
  } catch (e) { return { success: false, error: e.message || '列出失败' }; }
}

// ── 检测系统 Python（where 优先，常见路径兜底；验证真能运行，跳过 WindowsApps 占位） ──
function detectSystemPython() {
  const _tryRun = (p) => {
    try {
      if (!p || !fs.existsSync(p)) return false;
      const out = execSync(`"${p}" --version`, { encoding: 'utf-8', timeout: 8000 }).toString();
      return /Python\s+\d+\.\d+/i.test(out);
    } catch { return false; }
  };
  const paths = [];
  const _add = (p) => { if (p && _tryRun(p) && !paths.includes(p)) paths.push(p); };
  try {
    const out = execSync('where python', { encoding: 'utf-8', timeout: 5000 });
    const lines = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (/WindowsApps/i.test(line)) continue; // 跳过微软商店占位 stub
      _add(line);
    }
  } catch {}
  // ★ P2-4: 用 Python launcher 列出所有已装版本（`py -0p` 输出 "  -V:3.12 *  C:\Python312\python.exe"）
  try {
    const out = execSync('py -0p', { encoding: 'utf-8', timeout: 8000, shell: 'cmd.exe' });
    const lines = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/([A-Za-z]:\\[^\s]+(?:python|python.exe))/i);
      if (m && m[1]) _add(m[1]);
      const m2 = line.match(/([A-Za-z]:\/[^\s]+(?:python|python\.exe))/i);
      if (m2 && m2[1]) _add(m2[1].replace(/\//g, '\\'));
    }
  } catch {}
  const candidates = [
    'C:/Python312/python.exe', 'C:/Python311/python.exe', 'C:/Python310/python.exe',
    'C:/Program Files/Python312/python.exe', 'C:/Program Files/Python311/python.exe',
    'C:/Program Files/Python310/python.exe',
    'C:/ProgramData/anaconda3/python.exe', 'C:/Users/' + (process.env.USERNAME || '') + '/anaconda3/python.exe',
  ];
  for (const c of candidates) _add(c);
  if (paths.length) return { success: true, path: paths[0], paths };
  return { success: false, error: '未检测到系统 Python' };
}

module.exports = {
  getRuntimePlatform,
  getPythonRuntimeSourceDir,
  getWheelhouseSourceDir,
  getPythonEnvDir,
  getPythonPath,
  getPipPath,
  getBinDir,
  isReady,
  getVersion,
  getStatus,
  getPythonEnv,
  ensure,
  installBasePackages,
  installPackage,
  parseMissingModule,
  listPackages,
  detectSystemPython,
  searchPackages,
  getPackageFileSize,
  mapModuleToPackage,
  resetEnv,
  execPython,
  execPip,
  BASE_REQUIREMENTS,
  AUTO_INSTALL_WHITELIST,
  MODULE_TO_PACKAGE,
};
