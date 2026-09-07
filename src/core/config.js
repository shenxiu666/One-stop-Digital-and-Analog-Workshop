// 一站式数模工坊 — 全局配置
module.exports = {
  // ★ 窗口尺寸（与原工坊一致，保证写作三栏完整显示）
  windowWidth: 1200,
  windowHeightCollapsed: 820,
  windowMinWidth: 1140,
  windowMinHeight: 780,

  // ── 用户数据目录名（独立于老项目，升级改版本号即换目录）──
  dataDirName: 'YZS-Gongfang-1.0.0',

  // ── 协作共享空间目录名（与工作目录同级概念保持一致，改名避免与老项目冲突）──
  collabSharedDirName: 'Gongfang-Share',

  // ── 绘图流程图保存目录（userData 下，避免污染用户自选工作目录）──
  flowchartsDirName: 'flowcharts',

  // ── 单条 Python 运行工具时限 ──
  bashToolTimeoutMs: 30 * 60 * 1000,

  // ── 端口（各服务动态顺延的起始值）──
  ports: {
    collabWs: 45231,         // 局域网协作 WS 主端口（services/collab-server.js）
    collabDiscover: 45232,   // 局域网协作 UDP 发现端口
  },
};
