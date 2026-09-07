// Gongfang v2.6 — 内置 / 外部资源路径查找（TinyTeX / Python / Gongfang_env 统一入口）
// ★ 原 latex.js / python.js 各有一份相同实现（改路径必须两处同步的坑），
//   现抽成共享模块：改资源查找路径只需改这一处。
// ★ v2.5.1: 外部"集成环境" Gongfang_env —— Python/TinyTeX 从 assets 移出到外部目录，
//   软件启动时**分层自动检测**（见 getAppEnvRoots），也支持用户手动「指定目录」兜底。
//   软件更新只替换主体，环境（Gongfang_env）长期留存；手动指定路径存数据库，重装/换位置后仍生效。
const path = require('path');
const fs = require('fs');

let _appEnvRootsCache = null;
let _configuredAppEnvPath = '';

// ── 手动指定（优先级最高）──
// 由 bootstrap 启动时读数据库 appEnvPath 设置调用；check-environment 每次检测时同步。
// 设置后重置缓存，使 getAppEnvDir()/getAssetCandidates() 立即按新路径重算。
function setConfiguredAppEnvPath(p) {
  _configuredAppEnvPath = (p && typeof p === 'string') ? p.trim() : '';
  _appEnvRootsCache = null;
}

// 从 base 起逐级往父目录找 <dirName>（共 levels 级；配合 existsSync 即可覆盖"软件与 Gongfang_env 同放一个文件夹"）
function _walkUp(base, dirName, levels) {
  const out = [];
  let cur = base;
  for (let i = 0; i < levels && cur; i++) {
    out.push(path.join(cur, dirName));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

// 软件所在目录集合（开发态项目根 / 打包后的 app 目录 / 进程 cwd），用于向外定位 Gongfang_env
function _getEnvBaseDirs() {
  const bases = [];
  const add = (p) => { if (p && !bases.includes(p)) bases.push(p); };
  try { add(process.execPath ? path.dirname(process.execPath) : null); } catch {}   // 打包后 exe 所在目录（软件同目录最可靠）
  try { add(path.join(__dirname, '..', '..')); } catch {}                 // 开发态项目根
  try { if (process.resourcesPath) add(path.dirname(process.resourcesPath)); } catch {} // 打包后 resources 上级 app 目录
  try { add(process.cwd()); } catch {}                                   // 进程 cwd 兜底
  return bases;
}

// 扫 base 的一级子目录：把「Gongfang_env」（优先）/「Mrite_env」（兼容旧名）/
// 「含 python-env 或 TinyTeX 的目录」也纳入候选，以便环境被改名、或包在一层容器里仍能识别。
function _scanChildrenForEnv(base, add) {
  try {
    if (!base || !fs.existsSync(base)) return;
    for (const name of fs.readdirSync(base)) {
      const child = path.join(base, name);
      try { if (!fs.statSync(child).isDirectory()) continue; } catch { continue; }
      const lower = name.toLowerCase();
      if (lower === 'gongfang_env') { add(child); continue; }
      if (lower === 'mrite_env') { add(child); continue; } // 兼容旧名目录
      if (fs.existsSync(path.join(child, 'python-env')) ||
          fs.existsSync(path.join(child, 'TinyTeX')) ||
          fs.existsSync(path.join(child, 'pandoc'))) add(child);
    }
  } catch {}
}

// ── 外部集成环境根目录候选（按优先级；不要求存在）──
//   目录名优先级：Gongfang_env（新工坊 canonical）优先，Mrite_env（兼容旧名）兜底。
function getAppEnvRoots() {
  if (_appEnvRootsCache) return _appEnvRootsCache;
  const roots = [];
  const add = (p) => { if (p && !roots.includes(p)) roots.push(p); };

  // 0) 用户手动指定（集成环境设置里「指定目录」，存数据库，最优先）
  if (_configuredAppEnvPath) add(_configuredAppEnvPath);

  for (const envName of ['Gongfang_env', 'Mrite_env']) {
    // 1) 从软件所在目录向外（上+下）找
    for (const base of _getEnvBaseDirs()) {
      for (const p of _walkUp(base, envName, 8)) add(p);
    }

    // 2) 各磁盘根目录（C:\Gongfang_env、D:\Mrite_env…）：逐字母探测存在的盘符再拼
    try {
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const drive = letter + ':\\';
        try { if (fs.existsSync(drive)) add(path.join(drive, envName)); } catch {}
      }
    } catch {}

    // 3) 常见用户目录（桌面 / 文档 / 下载 / 用户主目录）+ userData 兜底
    try {
      const { app } = require('electron');
      for (const name of ['desktop', 'documents', 'downloads', 'home']) {
        try { const dir = app.getPath(name); if (dir) add(path.join(dir, envName)); } catch {}
      }
      try { add(path.join(app.getPath('userData'), envName)); } catch {}
    } catch {}

    // 4) 兼容原约定：开发态项目同级 / 打包态软件同级或软件内
    try { add(path.join(__dirname, '..', '..', '..', envName)); } catch {}
    try {
      if (process.resourcesPath) {
        add(path.join(process.resourcesPath, '..', '..', envName));
        add(path.join(process.resourcesPath, '..', envName));
      }
    } catch {}
  }

  // 5) 扫软件目录一级子目录（改名/包一层容器兜底，见 _scanChildrenForEnv）
  for (const base of _getEnvBaseDirs()) _scanChildrenForEnv(base, add);

  _appEnvRootsCache = roots;
  return roots;
}

// 目录是否为"有效" Gongfang_env：内含 Python / TinyTeX / pandoc 任一组件即算数（避免撞上同名空文件夹误判，
//   也避免只剩单个组件残缺时被误判为无效）。python-env 兼容 win-x64 / win64 / x64 等不同子目录名。
function _appEnvLooksValid(root) {
  if (!root) return false;
  try {
    const pyBase = path.join(root, 'python-env');
    if (fs.existsSync(pyBase)) {
      if (fs.existsSync(path.join(pyBase, 'win-x64', 'python.exe'))) return true;
      // 兼容 python-env 下其它子目录（win64 / x64 / 直接放 python.exe）
      if (fs.existsSync(path.join(pyBase, 'python.exe'))) return true;
      try {
        for (const sub of fs.readdirSync(pyBase)) {
          if (fs.existsSync(path.join(pyBase, sub, 'python.exe'))) return true;
        }
      } catch {}
    }
    if (fs.existsSync(path.join(root, 'TinyTeX', 'bin', 'windows', 'xelatex.exe'))) return true;
    if (fs.existsSync(path.join(root, 'pandoc', 'pandoc.exe'))) return true;
  } catch {}
  return false;
}

// 第一个有效的 Gongfang_env 根目录（未找到返回 null）
function getAppEnvDir() {
  for (const root of getAppEnvRoots()) {
    if (_appEnvLooksValid(root)) return root;
  }
  return null;
}

// 路径是否位于 Gongfang_env 内
function isPathInsideAppEnv(p) {
  if (!p) return false;
  const n = path.resolve(p).replace(/\\/g, '/').toLowerCase();
  for (const root of getAppEnvRoots()) {
    const r = path.resolve(root).replace(/\\/g, '/').toLowerCase();
    if (n === r || n.startsWith(r + '/')) return true;
  }
  return false;
}

// 环境来源标记：appenv（外部集成环境）/ bundled（内置 assets）/ userdata（旧部署兜底）/ custom
function detectEnvSource(p) {
  if (!p) return 'none';
  if (isPathInsideAppEnv(p)) return 'appenv';
  const n = path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (n.indexOf('/assets/') !== -1) return 'bundled';
  if (n.indexOf('/appdata/') !== -1 || n.indexOf('/userdata/') !== -1 || n.indexOf('/runtime/') !== -1) return 'userdata';
  return 'custom';
}

function getAssetCandidates(relativeAssetPath, options = {}) {
  const includeAsar = options.includeAsar === true;
  const candidates = [];
  const add = (p) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  // ★ 外部集成环境（Gongfang_env）优先：环境移出 assets 后，运行时自动检测 Gongfang_env 并优先加载
  for (const root of getAppEnvRoots()) {
    add(path.join(root, relativeAssetPath));
  }

  try {
    if (process.resourcesPath) {
      // extraResources 或未打进 asar 时常见位置
      add(path.join(process.resourcesPath, 'assets', relativeAssetPath));
      // 仅文本/配置类资源允许直接从 app.asar 内读取
      if (includeAsar) {
        add(path.join(process.resourcesPath, 'app.asar', 'assets', relativeAssetPath));
      }
      // asarUnpack 后的真实可执行资源位置
      add(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', relativeAssetPath));
      // 某些打包配置会把 app 目录完整放在 resources/app
      add(path.join(process.resourcesPath, 'app', 'assets', relativeAssetPath));
    }
    // ★ 跨设备（P0-1）：loader 重定向 resourcesPath 到临时目录，TinyTeX/Python 仍在真实
    //   resources/app.asar.unpacked。GONGFANG_REAL_RESOURCES 由 loader 注入为真实 resources 目录。
    const realResources = process.env.GONGFANG_REAL_RESOURCES || '';
    if (realResources) {
      add(path.join(realResources, 'app.asar.unpacked', 'assets', relativeAssetPath));
      add(path.join(realResources, 'assets', relativeAssetPath));
    }
  } catch {}

  // 开发环境：src/env/assets.js -> 项目根/assets
  add(path.join(__dirname, '..', '..', 'assets', relativeAssetPath));

  return candidates;
}

module.exports = {
  getAssetCandidates, getAppEnvRoots, getAppEnvDir, isPathInsideAppEnv, detectEnvSource,
  setConfiguredAppEnvPath,
};
