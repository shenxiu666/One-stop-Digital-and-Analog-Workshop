// 一站式数模工坊 — 全局状态（仅主题/环境配置 + 当前面板）
window.Gongfang = window.Gongfang || {};

Gongfang.STATE = {
  activePanel: null,
  settings: {
    theme: 'default',
    latexEnvMode: 'builtin',
    latexEnvPath: '',
    pythonEnvMode: 'builtin',
    pythonEnvPath: ''
  },
};
