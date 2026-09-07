// Gongfang — 扩展（Extension）服务
//
// 职责：
//   1. 扫描内置扩展目录（dev = 项目根/extensions/builtin，打包 = process.resourcesPath/extensions/builtin）
//   2. 扫描用户扩展目录（userData/extensions/）
//   3. 解析每个目录的 manifest.json，校验最小字段
//   4. 提供启用/禁用状态持久化（userData/extensions-state.json）
//   5. 提供安装（zip 包解压）/ 卸载（删除目录）接口
//
// manifest.json 字段：
//   id* / name* / version* / author / description / icon
//   main*       入口脚本（相对 manifest 路径）
//   styles      可选 CSS 列表（相对路径）
//   type*       builtin | thirdparty
//   permissions 申请的基座 API（fs/ai/codemirror/workspace/state/ipc）
//   slot*       注入槽：workshop（工坊顶栏+主区）/ standalone（独立面板）
//   button      { label, order } 顶栏按钮配置
//
// 状态持久化：userData/extensions-state.json
//   { enabled: { <id>: true/false, ... } }
//   builtin 默认 enabled=true（除非 manifest.disabled）；thirdparty 默认 enabled=false（安装后用户手动启用）
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

// 解压 zip 包到目标目录（yauzl），返回解出的文件数（用于安装第三方扩展的 zip 包）
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    try {
      const buffer = fs.readFileSync(zipPath);
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) return reject(err || new Error('zip 解析失败'));
        let count = 0;
        zipfile.on('error', reject);
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          const raw = String(entry.fileName || '').replace(/\\/g, '/');
          const rel = raw.split('/').filter(s => s && s !== '.' && s !== '..').join('/');
          if (!rel || /\/$/.test(raw)) return zipfile.readEntry();
          const target = path.join(destDir, rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          zipfile.openReadStream(entry, (err2, rs) => {
            if (err2 || !rs) return zipfile.readEntry();
            const chunks = [];
            rs.on('data', (c) => chunks.push(c));
            rs.on('end', () => { try { fs.writeFileSync(target, Buffer.concat(chunks)); count++; } catch (_) {} zipfile.readEntry(); });
            rs.on('error', () => zipfile.readEntry());
          });
        });
        zipfile.on('end', () => resolve(count));
      });
    } catch (e) { reject(e); }
  });
}

let _ctx = null;
let _cache = null;          // 扫描结果缓存（list 时如非 null 直接返回）
let _stateCache = null;     // 启用状态字典缓存

// ── 路径 ──
function getBuiltinDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'extensions', 'builtin');
  }
  // dev：项目根 extensions/builtin
  return path.join(__dirname, '..', '..', 'extensions', 'builtin');
}

function getUserExtDir() {
  const dir = path.join(app.getPath('userData'), 'extensions');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function getStateFile() {
  return path.join(app.getPath('userData'), 'extensions-state.json');
}

// ── 启用状态读写 ──
function loadState() {
  if (_stateCache !== null) return _stateCache;
  try {
    const raw = fs.readFileSync(getStateFile(), 'utf-8');
    const obj = JSON.parse(raw);
    _stateCache = (obj && typeof obj.enabled === 'object' && !Array.isArray(obj.enabled)) ? obj.enabled : {};
  } catch {
    _stateCache = {};
  }
  return _stateCache;
}

function saveState(state) {
  _stateCache = state || {};
  try {
    fs.writeFileSync(getStateFile(), JSON.stringify({ enabled: _stateCache }, null, 2), 'utf-8');
  } catch (e) {
    console.error('[extension] saveState 失败:', e && e.message);
  }
}

function isEnabled(id, type) {
  const s = loadState();
  if (id in s) return s[id] === true;
  // 默认值：builtin 默认启用，thirdparty 默认禁用
  return type === 'builtin';
}

function setEnabled(id, enabled) {
  const s = loadState();
  s[id] = !!enabled;
  saveState(s);
}

// ── manifest 校验 ──
function parseManifest(manifestRaw, dir, type) {
  if (!manifestRaw || typeof manifestRaw !== 'object') return null;
  // 必填字段
  const required = ['id', 'name', 'version', 'main', 'type', 'slot'];
  for (const k of required) {
    if (!manifestRaw[k]) { console.warn(`[extension] ${dir} 缺少必填字段 ${k}`); return null; }
  }
  // type 必须是合法值
  if (!['builtin', 'thirdparty'].includes(manifestRaw.type)) {
    console.warn(`[extension] ${dir} type 非法: ${manifestRaw.type}`);
    return null;
  }
  // 约定：内置目录强制 type=builtin，用户目录强制 type=thirdparty
  if (type === 'builtin' && manifestRaw.type !== 'builtin') {
    console.warn(`[extension] ${dir} 内置目录但 type=${manifestRaw.type}，强制改为 builtin`);
    manifestRaw.type = 'builtin';
  }
  if (type === 'thirdparty' && manifestRaw.type !== 'thirdparty') {
    manifestRaw.type = 'thirdparty';
  }
  // main 脚本必须存在
  const mainPath = path.join(dir, manifestRaw.main);
  if (!fs.existsSync(mainPath)) {
    console.warn(`[extension] ${dir} main 脚本不存在: ${manifestRaw.main}`);
    return null;
  }
  // 解析 icon 路径为绝对路径（相对 manifest 目录）
  const isHost = manifestRaw.host === true;
  const resolved = {
    ...manifestRaw,
    _dir: dir,                                    // 扩展根目录绝对路径
    _mainPath: mainPath,
    _type: type,                                  // builtin | thirdparty
    // ★ host 扩展（写作宿主）强制启用，不受状态文件控制
    enabled: isHost ? true : isEnabled(manifestRaw.id, type),
  };
  // icon / styles 路径解析
  if (manifestRaw.icon) {
    const iconPath = path.join(dir, manifestRaw.icon);
    if (fs.existsSync(iconPath)) resolved._iconPath = iconPath;
  }
  if (Array.isArray(manifestRaw.styles)) {
    resolved._stylePaths = manifestRaw.styles
      .map(s => path.join(dir, s))
      .filter(p => fs.existsSync(p));
  }
  return resolved;
}

function scanDir(dir, type) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
    const subDir = path.join(dir, ent.name);
    const manifestPath = path.join(subDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
    catch (e) { console.warn(`[extension] ${manifestPath} 解析失败:`, e && e.message); continue; }
    const m = parseManifest(raw, subDir, type);
    if (m) out.push(m);
  }
  return out;
}

function scanExtensions() {
  const builtin = scanDir(getBuiltinDir(), 'builtin');
  const thirdparty = scanDir(getUserExtDir(), 'thirdparty');
  // 同 id 冲突：thirdparty 覆盖 builtin（用户可"重装"内置扩展）
  const byId = new Map();
  for (const m of builtin) byId.set(m.id, m);
  for (const m of thirdparty) byId.set(m.id, m);
  _cache = Array.from(byId.values());
  // 按 button.order 排序（无 order 的放后面）
  _cache.sort((a, b) => {
    const ao = (a.button && typeof a.button.order === 'number') ? a.button.order : 999;
    const bo = (b.button && typeof b.button.order === 'number') ? b.button.order : 999;
    return ao - bo;
  });
  return _cache;
}

// ── 序列化扩展（返回给 renderer 时脱敏，去掉内部字段）──
function serializeExtension(m) {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author || '',
    description: m.description || '',
    icon: m.icon || '',
    type: m.type,
    permissions: m.permissions || [],
    slot: m.slot,
    host: m.host === true, // ★ v2.6：宿主扩展标识（写作），不在扩展中心显示
    button: m.button || null,
    enabled: m.enabled,
    installed: m.type === 'builtin' ? true : true, // 用户目录里存在的都算"已安装"
    mainPath: m._mainPath,
    stylePaths: m._stylePaths || [],
    dir: m._dir,
  };
}

// ── 安装 / 卸载 ──
// 安装：源目录或 zip 包路径 → 解压/复制到 userData/extensions/<id>/
async function installExtension(sourcePath) {
  const userDir = getUserExtDir();
  // 支持目录复制与 zip 包解压（本地 extractZip）
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: '源路径不存在' };
  }
  const stat = fs.statSync(sourcePath);
  let srcDir = sourcePath;
  let tmpDir = null;
  if (stat.isFile() && sourcePath.toLowerCase().endsWith('.zip')) {
    // zip 包：本地解压到临时目录
    try {
      tmpDir = path.join(require('os').tmpdir(), 'gongfang-ext-install-' + Date.now());
      await extractZip(sourcePath, tmpDir);
      // 解压后可能是单层目录，也可能直接是 manifest
      if (fs.existsSync(path.join(tmpDir, 'manifest.json'))) {
        srcDir = tmpDir;
      } else {
        const subs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter(d => d.isDirectory());
        if (subs.length === 1 && fs.existsSync(path.join(tmpDir, subs[0].name, 'manifest.json'))) {
          srcDir = path.join(tmpDir, subs[0].name);
        } else {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          return { success: false, error: 'zip 内未找到 manifest.json' };
        }
      }
    } catch (e) {
      return { success: false, error: '解压失败: ' + (e && e.message || String(e)) };
    }
  } else if (stat.isDirectory()) {
    if (!fs.existsSync(path.join(sourcePath, 'manifest.json'))) {
      return { success: false, error: '源目录缺少 manifest.json' };
    }
  } else {
    return { success: false, error: '不支持的源（仅支持目录或 zip 包）' };
  }

  // 读 manifest 拿 id
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf-8'));
  } catch (e) {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    return { success: false, error: 'manifest.json 解析失败' };
  }
  if (!manifest.id) {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    return { success: false, error: 'manifest 缺少 id' };
  }

  const destDir = path.join(userDir, manifest.id);
  // 已存在则覆盖
  try {
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  } catch (e) {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    return { success: false, error: '清理旧版本失败: ' + (e && e.message) };
  }

  // 复制
  try {
    copyDir(srcDir, destDir);
  } catch (e) {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    return { success: false, error: '复制失败: ' + (e && e.message) };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  }

  // 默认安装后启用（thirdparty 默认禁用，安装后明确启用）
  setEnabled(manifest.id, true);
  _cache = null; // 失效缓存
  const list = scanExtensions();
  const installed = list.find(x => x.id === manifest.id);
  return { success: true, extension: installed ? serializeExtension(installed) : null };
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name);
    const d = path.join(dest, item.name);
    if (item.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function uninstallExtension(id) {
  const list = _cache || scanExtensions();
  const ext = list.find(m => m.id === id);
  if (!ext) return { success: false, error: '扩展不存在' };
  if (ext.type === 'builtin') return { success: false, error: '内置扩展不可卸载，仅可禁用' };
  try {
    if (fs.existsSync(ext._dir)) fs.rmSync(ext._dir, { recursive: true, force: true });
  } catch (e) {
    return { success: false, error: '删除目录失败: ' + (e && e.message) };
  }
  // 清启用状态
  const s = loadState();
  delete s[id];
  saveState(s);
  _cache = null;
  return { success: true };
}

function enableExtension(id) {
  setEnabled(id, true);
  if (_cache) {
    const m = _cache.find(x => x.id === id);
    if (m) m.enabled = true;
  }
  return { success: true };
}

function disableExtension(id) {
  setEnabled(id, false);
  if (_cache) {
    const m = _cache.find(x => x.id === id);
    if (m) m.enabled = false;
  }
  return { success: true };
}

function getExtensionById(id) {
  const list = _cache || scanExtensions();
  return list.find(m => m.id === id) || null;
}

function listExtensions() {
  const list = scanExtensions();
  return list.map(serializeExtension);
}

// ── 初始化（由 ipc/extension.js register 时调用）──
function init(ctx) {
  _ctx = ctx;
  // 启动时预扫一次，预热缓存
  try { scanExtensions(); } catch (e) {
    console.error('[extension] 启动扫描失败:', e && e.message);
  }
}

// ── 供基座其他模块调用：取扩展文件路径（用于 window.js 注入 preload）──
function getActiveExtensionsForPreload() {
  // 返回启用的扩展（按 button.order 排序），含 mainPath/stylePaths
  const list = _cache || scanExtensions();
  return list.filter(m => m.enabled).map(m => ({
    id: m.id, name: m.name,
    mainPath: m._mainPath,
    stylePaths: m._stylePaths || [],
    slot: m.slot,
    type: m.type,
    button: m.button || null,
    permissions: m.permissions || [],
  }));
}

module.exports = {
  init,
  scanExtensions,
  listExtensions,
  getExtensionById,
  installExtension,
  uninstallExtension,
  enableExtension,
  disableExtension,
  getBuiltinDir,
  getUserExtDir,
  getActiveExtensionsForPreload,
};
