// 一站式数模工坊 — 工作区管理（极简版）
// 职责只有一项：记住用户自选的工作目录（workspaceOverride）。
// 不再有"模板名→workspace/<模板>_<时间戳>"派生逻辑；未选择时 getWorkDir() 返回空字符串。
const path = require('path');
const fs = require('fs');

function create(rootDir) {
  let workspaceOverride = '';

  return {
    // 兼容旧调用：当前 projectsDir 概念保留为 userData 下的内部目录（绘图/协作内部文件用）
    workspaceDir: path.join(rootDir, 'internal'),
    projectsDir: path.join(rootDir, 'internal'),

    resetWorkspacePointer() {
      workspaceOverride = '';
    },

    // ★ 兼容旧代码：模式概念保留但无实际多状态文件，恒为 solve
    setCurrentMode() {},
    getCurrentMode() { return 'solve'; },

    getProjectName(projectPath) {
      try { return path.basename(projectPath); } catch { return ''; }
    },

    // ★ 核心：有 override 返回用户自选目录，否则返回空
    getWorkDir() {
      if (workspaceOverride && typeof workspaceOverride === 'string') {
        return workspaceOverride;
      }
      return '';
    },

    setWorkspaceOverride(p) {
      workspaceOverride = p || '';
    },
    getWorkspaceOverride() {
      return workspaceOverride;
    },

    getWorkspaceTimestamp() {
      return null;
    },

    // ★ 兼容旧调用：wsState 读写改为以工作目录下的 .gongfang-ws.json 为载体（轻量，不强制）
    readWsState() {
      try {
        if (!workspaceOverride) return null;
        const sf = path.join(workspaceOverride, '.gongfang-ws.json');
        if (fs.existsSync(sf)) return JSON.parse(fs.readFileSync(sf, 'utf-8'));
      } catch {}
      return null;
    },

    writeWsState(updates) {
      try {
        if (!workspaceOverride || !fs.existsSync(workspaceOverride)) return;
        const sf = path.join(workspaceOverride, '.gongfang-ws.json');
        let state = {};
        try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf-8')); } catch {}
        Object.assign(state, updates || {}, { _updated: new Date().toISOString() });
        fs.writeFileSync(sf, JSON.stringify(state, null, 2), 'utf-8');
      } catch {}
    },
  };
}

module.exports = { create };
