// Gongfang v2.6 — 文件操作服务
const path = require('path');
const fs = require('fs');
const os = require('os');

let _ctx = null;

function init(ctx) {
  _ctx = ctx;
}

// ★ 已删除任务期函数（prepareWorkspace/copyFileToProject/copyFolderToProject/listProjectFiles/
//   clearProjectDir/removeProjectFile）：调用方（任务上传页/模板编辑器）已下线

// ★ 系统规则文件（求解规范 / 求解计划 / 论文章节规范 等软件生成）不在文件树中展示
function isSystemRuleFile(name) { return /(规范|规则|求解计划)/.test(name || ''); }

// ★ 章节文件自然排序：数字前缀按层级/数值比较
//   "10.附录" 排在 "9.参考文献" 后（字符串排序会把它排到 "2.问题分析" 前）；
//   "5.模型的建立" < "5.1.问题1" < "5.2.问题2" < "5.1.1.分析与准备"（"5.1" 不能跑到 "5" 上面）。
function parseChapterPrefix(name) {
  const m = /^(\d+(?:\.\d+)*)/.exec(String(name));
  return m ? m[1].split('.').map(Number) : null;
}
function chapterCompare(a, b) {
  const pa = parseChapterPrefix(a), pb = parseChapterPrefix(b);
  if (pa && pb) {
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const sa = pa[i], sb = pb[i];
      if (sa === undefined) return -1;  // a 是 b 的数字前缀 → a 在前（5 在 5.1 前）
      if (sb === undefined) return 1;
      if (sa !== sb) return sa - sb;
    }
    // 数字前缀完全相等 → 按完整文件名排（如 5.模型的建立 与 5.模型评价）
    return a.localeCompare(b, 'zh-CN');
  }
  if (pa) return -1;  // 有数字前缀的排在无前缀的前面
  if (pb) return 1;
  return a.localeCompare(b, 'zh-CN');
}

// ★ PDF 完整性校验：编译中断/损坏的 PDF 只渲染空白，避免 iframe 触发 Chromium 自带的
//   引擎报错页（"无法加载 PDF 文档"）吓到用户。校验：%PDF- 头 + 尾部 %%EOF（中断的常缺 trailer）。
function isPdfValid(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size < 20) return false;
      const head = Buffer.alloc(5);
      fs.readSync(fd, head, 0, 5, 0);
      if (head.toString('latin1') !== '%PDF-') return false;
      const tailLen = Math.min(2048, stat.size);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);
      return tail.toString('latin1').includes('%%EOF');
    } finally { fs.closeSync(fd); }
  } catch (e) { return false; }
}

function readDirectoryTree(dirPath, maxDepth = 5, options = {}) {
  // ★ options.showSystemRules=true：右栏赛题模板编辑器需展示并编辑规则源文件
  //   （求解规范.md / 论文章节规范.md 等），默认仍屏蔽系统规则文件以免污染文件树。
  const showSystemRules = !!(options && options.showSystemRules);
  function build(dir, depth) {
    if (depth > maxDepth) return null;
    if (!fs.existsSync(dir)) return null;
    const children = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        const sub = build(path.join(dir, e.name), depth + 1);
        children.push({ name: e.name, type: 'directory', path: path.join(dir, e.name), children: sub?.children || [] });
      } else {
        if (!showSystemRules && isSystemRuleFile(e.name)) continue; // ★ 屏蔽系统规则文件
        children.push({ name: e.name, type: 'file', path: path.join(dir, e.name) });
      }
    }
    children.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : chapterCompare(a.name, b.name));
    return { name: path.basename(dir), type: 'directory', path: dir, children };
  }
  try { return { success: true, tree: build(dirPath, 0) }; }
  catch (err) { return { success: false, error: err.message }; }
}

// ★ 等待文件写入完成：轮询文件大小，连续两次一致则认为写完
function waitForFileStable(filePath, maxWaitMs = 3000) {
  return new Promise(resolve => {
    const start = Date.now();
    let lastSize = -1;
    let stableCount = 0;
    const check = () => {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > 0 && stat.size === lastSize) {
          stableCount++;
          if (stableCount >= 2) { resolve(stat.size); return; }
        } else {
          stableCount = 0;
        }
        lastSize = stat.size;
      } catch {}
      if (Date.now() - start < maxWaitMs) {
        setTimeout(check, 150);
      } else {
        resolve(lastSize);
      }
    };
    check();
  });
}

async function readFileContent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
    const ext = path.extname(filePath).toLowerCase();
    const imageMime = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    if (imageMime[ext]) {
      // ★ 等待文件写入完成（大小稳定）
      const fileSize = await waitForFileStable(filePath);
      const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
      if (fileSize > MAX_IMAGE_SIZE) {
        return { success: false, error: '图片文件过大（' + Math.round(fileSize / 1024 / 1024) + 'MB），超过 20MB 限制' };
      }
      if (fileSize <= 0) {
        return { success: false, error: '图片文件为空或写入超时' };
      }
      const buf = fs.readFileSync(filePath);
      return {
        success: true,
        binary: true,
        image: true,
        ext,
        path: filePath,
        dataUrl: 'data:' + imageMime[ext] + ';base64,' + buf.toString('base64'),
      };
    }
    // Excel 文件解析（8MB 以上跳过，避免同步 readFile 阻塞主进程）
    if (['.xlsx', '.xls'].includes(ext)) {
      try {
        const fileSize = fs.statSync(filePath).size;
        if (fileSize > 8 * 1024 * 1024) {
          return { success: true, binary: true, excel: true, ext, path: filePath, sheets: {}, _tooLarge: true };
        }
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheets = {};
        workbook.SheetNames.forEach(name => {
          const sheet = workbook.Sheets[name];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          sheets[name] = csv;
        });
        return { success: true, binary: true, excel: true, ext, path: filePath, sheets };
      } catch (e) {
        return { success: true, binary: true, ext, path: filePath };
      }
    }
    if (ext === '.pdf') {
      const buf = fs.readFileSync(filePath);
      return { success: true, binary: true, ext, path: filePath, dataUrl: 'data:application/pdf;base64,' + buf.toString('base64') };
    }
    const raw = readTextSmart(filePath);
    return { success: true, text: raw, ext, path: filePath };
  } catch (err) { return { success: false, error: err.message }; }
}

// ★ 编码自适应读文本：先按 UTF-8 严格解码，失败（GBK/ANSI 文件，如 Excel 导出的中文 CSV）
//   则按 GBK 解码 —— 修复按 utf-8 直读 GBK 文件时中文全乱码（表格表头变问号方块）的问题
function readTextSmart(filePath) {
  const buf = fs.readFileSync(filePath);
  try {
    return new (require('util').TextDecoder)('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    try {
      return new (require('util').TextDecoder)('gbk').decode(buf);
    } catch (e2) {
      return buf.toString('utf-8');
    }
  }
}


// ★ 已删除 renderPdfPage：调用方已下线（PDF 预览走文件直读）

function isPathSafe(p) {
  if (!p) return false;
  var abs;
  try { abs = path.resolve(p); } catch (_) { return false; }
  var allowed = [];
  // ★ 每个前缀独立求值：某个 getter 抛异常（如 getWorkDir 暂未初始化）只丢弃该前缀，不整段 false
  function push(fn) {
    try {
      var v = fn();
      if (v && typeof v === 'string') allowed.push(path.resolve(v));
    } catch (_) {}
  }
  push(function() { return _ctx && _ctx.getWorkDir ? _ctx.getWorkDir() : null; });
  push(function() { return _ctx && _ctx.getProjectPath ? _ctx.getProjectPath() : null; });
  // ★ 允许 projects 目录下的所有子目录（含 projects/write/ 写作项目）
  push(function() { return _ctx && _ctx.projectsDir ? _ctx.projectsDir : null; });
  // ★ workspace 根目录：写作面板可在任意任务工作区下保存文件（不限于当前任务）
  push(function() { return _ctx && _ctx.projectsDir ? path.join(path.dirname(_ctx.projectsDir), 'workspace') : null; });
  // ★ 系统/用户模板（rules-library）与应用数据目录：写作面板可直接打开系统模板编辑保存；
  //   打包态模板在 userData/rules-library，dev 态在 <项目根>/rules-library
  push(function() { return _ctx && _ctx.rulesLib && typeof _ctx.rulesLib.getBaseDir === 'function' ? _ctx.rulesLib.getBaseDir() : null; });
  push(function() { return path.join(path.resolve(__dirname, '..', '..'), 'rules-library'); });
  push(function() { try { return require('electron').app.getPath('userData'); } catch (_) { return null; } });
  if (allowed.some(function(a) { return abs.startsWith(a); })) return true;
  // ★ 协同编译成员端：把下发的 PDF(base64) 写入系统临时目录再渲染，需放行临时目录（限定 gongfang-collab- 前缀）。
  //   之前不放行临时目录 → writeFileBase64 静默拒写 → 临时 PDF 不存在 → checkPdfValid 失败 → 成员端永远空白。
  try {
    const tmpAbs = path.resolve(os.tmpdir());
    if (abs.startsWith(tmpAbs + path.sep) && path.basename(abs).indexOf('gongfang-collab-') === 0) return true;
  } catch (_) {}
  return false;
}

async function writeFileContent(filePath, content, options) {
  try {
    // ★ options.trusted=true：路径来自系统"另存为"对话框（用户已确认），跳过 isPathSafe 白名单
    if (!options?.trusted && !isPathSafe(filePath)) return { success: false, error: '路径不在允许范围内' };
    if (!filePath || typeof filePath !== 'string') return { success: false, error: '目标路径无效' };
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    // ★ 校验写入结果：防止"已保存"但文件实际未落盘/被写为空文件
    let st;
    try {
      st = fs.statSync(filePath);
      if (!st.isFile() || st.size <= 0) return { success: false, error: '保存内容为空或未写入' };
    } catch (e) { return { success: false, error: '保存写入失败：' + e.message }; }
    // ★ 默认不弹出资源管理器；仅当调用方显式传入 options.reveal=true（如「下载」）时才定位文件。
    //   之前默认自动 reveal，导致新建文件/自动保存/协同写临时文件等场景都会意外弹出资源管理器。
    if (options?.reveal) { try { require('electron').shell.showItemInFolder(filePath); } catch {} }
    return { success: true, path: filePath };
  } catch(e) { return { success: false, error: e.message }; }
}

// 写 base64 二进制文件（导出 PNG 等）
async function writeFileBase64(filePath, base64, options) {
  try {
    // ★ options.trusted=true：路径来自系统"另存为"对话框（用户已确认），跳过 isPathSafe 白名单
    if (!options?.trusted && !isPathSafe(filePath)) return { success: false, error: '路径不在允许范围内' };
    if (!filePath || typeof filePath !== 'string') return { success: false, error: '目标路径无效' };
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(String(base64 || '').replace(/^data:.*;base64,/, ''), 'base64');
    fs.writeFileSync(filePath, buf);
    // ★ 校验写入结果：防止"已保存"但文件实际未落盘/被写为空文件
    let st;
    try {
      st = fs.statSync(filePath);
      if (!st.isFile() || st.size <= 0) return { success: false, error: '保存内容为空或未写入' };
    } catch (e) { return { success: false, error: '保存写入失败：' + e.message }; }
    // ★ 默认不弹出资源管理器；仅当调用方显式传入 options.reveal=true 时才定位文件。
    if (options?.reveal) { try { require('electron').shell.showItemInFolder(filePath); } catch {} }
    return { success: true, path: filePath, bytes: buf.length };
  } catch(e) { return { success: false, error: e.message }; }
}

module.exports = {
  init, readDirectoryTree,
  readFileContent, writeFileContent, writeFileBase64, isPathSafe,
  chapterCompare,  // ★ 章节文件自然排序（write.js 复用）
  isPdfValid,      // ★ PDF 完整性校验（预览前判断，损坏则渲染空白）
};
