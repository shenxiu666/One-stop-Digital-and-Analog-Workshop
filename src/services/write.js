// Gongfang v2.6 — 写作项目管理服务
const fs = require('fs');
const path = require('path');
const fileService = require('./file');  // 复用章节文件自然排序 chapterCompare

// ★ 已删除写作项目库函数（getWriteDir/ensureWriteDir/listProjects/createProject/unzipProject）：调用方已下线，仅保留文件树读取

function getFileTree(projectPath) {
  if (!fs.existsSync(projectPath)) return null;
  return readTree(projectPath, projectPath, 4);
}

function readTree(fullPath, basePath, maxDepth) {
  const name = path.basename(fullPath);
  const stat = fs.statSync(fullPath);
  if (!stat.isDirectory()) {
    return { name, type: 'file', path: fullPath, size: stat.size };
  }
  const node = { name, type: 'directory', path: fullPath, children: [] };
  if (maxDepth <= 0) return node;
  try {
    const entries = fs.readdirSync(fullPath).filter(n => !n.startsWith('.') && n !== 'build' && n !== '转word' && !/(规范|规则|求解计划)/.test(n));
    entries.sort((a, b) => {
      const aIsDir = fs.statSync(path.join(fullPath, a)).isDirectory();
      const bIsDir = fs.statSync(path.join(fullPath, b)).isDirectory();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return fileService.chapterCompare(a, b);  // ★ 章节数字前缀自然排序（10 在 9 后、5.1 在 5 后）
    });
    node.children = entries.map(e => readTree(path.join(fullPath, e), basePath, maxDepth - 1));
  } catch (_) {}
  return node;
}

// ★ 已删除 findMainTex/findMainPdf：调用方已下线

module.exports = {
  getFileTree,
};
