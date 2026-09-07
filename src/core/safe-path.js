// Gongfang v2.6 — 路径安全工具（处理中文路径问题）
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let _shortPathCache = {};
let _shortPathCacheSize = 0;
// ★ 缓存容量上限：长会话中不断有新中文路径进来，避免缓存无上限增长占用内存
const SHORT_PATH_CACHE_MAX = 2000;
function _cacheSet(p, v) {
  _shortPathCache[p] = v;
  if (++_shortPathCacheSize > SHORT_PATH_CACHE_MAX) { _shortPathCache = {}; _shortPathCacheSize = 0; }
}

// ★ P1-7: 8.3 短路径禁用时的兜底 —— 在 ProgramData（ASCII、用户可写）下为中文路径建 junction 别名。
//   中文用户名/中文目录下，LaTeX/Python 通过该别名访问真实目录，避免 Lua/pip 乱码或路径超长。
function _junctionAliasDir() {
  return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Gongfang', 'short');
}

function _toJunctionAlias(p) {
  try {
    const dir = _junctionAliasDir();
    fs.mkdirSync(dir, { recursive: true });
    const hash = crypto.createHash('sha256').update(p).digest('hex').slice(0, 12);
    const alias = path.join(dir, hash);
    if (!fs.existsSync(alias)) {
      // junction 无需管理员、跨卷可用；建好后指向真实目录
      fs.symlinkSync(p, alias, 'junction');
    }
    if (fs.existsSync(alias)) {
      _cacheSet(p, alias);
      return alias;
    }
  } catch {}
  return null;
}

/**
 * 将路径转为 Windows 短路径名（8.3 格式），避免中文字符导致的问题。
 * 如果转换失败或不是 Windows，返回原路径。
 * ★ P1-7: 8.3 被系统/企业策略禁用时（常见于新 SSD/托管机器），不再静默失效，
 *   改用 ProgramData 下的 junction 别名兜底（同样可被 TeX/Python 访问）。
 */
function toShortPath(p) {
  if (!p || typeof p !== 'string') return p;
  // 已经是 ASCII 的不需要转换
  if (/^[\x20-\x7E]+$/.test(p)) return p;
  if (_shortPathCache[p]) return _shortPathCache[p];
  try {
    // Windows: 用 cmd 的 %~sI 获取短路径
    const short = execSync(`cmd /c "for %I in ("${p}") do @echo %~sI"`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // 验证转换结果：必须存在、不含中文、不含 %（转换失败标记）
    if (short && short !== p && !short.includes('%') && !/[^\x20-\x7E]/.test(short) && fs.existsSync(short)) {
      _cacheSet(p, short);
      return short;
    }
  } catch {}
  // 转换失败（8.3 被禁用等）：尝试 junction 别名兜底
  const alias = _toJunctionAlias(p);
  if (alias) return alias;
  // 最终回退到原路径
  return p;
}

/**
 * 获取安全的 userData 路径（短路径格式，避免中文）
 */
function getSafeUserData() {
  try {
    const { app } = require('electron');
    return toShortPath(app.getPath('userData'));
  } catch {
    return null;
  }
}

module.exports = { toShortPath, getSafeUserData };
