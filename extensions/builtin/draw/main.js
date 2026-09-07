// Gongfang v2.6 — 绘图流程图编辑器（AntV X6 引擎 + 三栏布局）
// 左栏=文件（加载/保存/导出/插图）/ 中栏=画布+顶部快捷条 / 右栏=参数设置+图例
// ★ X6 迁移：由 LogicFlow 整体重写为 AntV X6 2.19.2（滚轮以鼠标位置为中心缩放等原生支持）
window.Gongfang = window.Gongfang || {};

Gongfang._drawState = {
  initDone: false, graph: null, lf: null, currentFile: null, currentName: null, currentCreatedAt: null,
  theme: 'classic', editMode: 'global', nodeStyle: 'round',
  edgeType: 'polyline', arrow: 'arrow', gridVisible: true, snap: true, gridSize: 20,
  borderWidth: 1.4, edgeWidth: 1.6, edgeDash: 0, fontSize: 13, fillOpacity: 0.5, nodeRadius: 8, radiusOverridden: false,
  fontWeight: 'normal', fontStyle: 'normal', underline: false, fontFamily: 'SimSun', textAlign: 'center', dash: 0,
  fillColor: null, strokeColor: null, textColor: null, edgeColor: null, colorTarget: 'fill',
  colors: { active: 0, slots: ['#111827', '#4f46e5', '#10b981', '#f59e0b', '#2563eb', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'] },
};

// ── 主题：单色 + 多色（不同节点类型不同颜色） ──
Gongfang._drawThemes = {
  bw:     { label: '黑白',    single: 1, accent: '#111827', edge: '#111827', anchor: '#111827', fill: '#ffffff', text: '#111827' },
  indigo: { label: '靛蓝',    single: 1, accent: '#4f46e5', edge: '#6366f1', anchor: '#4f46e5', fill: '#eef2ff', text: '#1f2937' },
  emerald:{ label: '翠绿',    single: 1, accent: '#059669', edge: '#10b981', anchor: '#059669', fill: '#ecfdf5', text: '#1f2937' },
  ocean:  { label: '深蓝',    single: 1, accent: '#2563eb', edge: '#3b82f6', anchor: '#2563eb', fill: '#eff6ff', text: '#1f2937' },
  rose:   { label: '玫瑰',    single: 1, accent: '#e11d48', edge: '#f43f5e', anchor: '#e11d48', fill: '#fff1f2', text: '#1f2937' },
  classic:{ label: '经典多色', single: 0, accent: '#4f46e5', edge: '#64748b', anchor: '#4f46e5', text: '#1f2937',
    nodes: {
      start: ['#d1fae5','#059669'], process: ['#dbeafe','#2563eb'], sharp: ['#e0e7ff','#4f46e5'],
      decision: ['#fef9c3','#d97706'], io: ['#fce7f3','#db2777'], circle: ['#fce7f3','#db2777'],
      prep: ['#e0e7ff','#6d28d9'], triangle: ['#e0e7ff','#6d28d9'],
      storage: ['#ffedd5','#ea580c'], note: ['#fef3c7','#ca8a04'], text: ['#ffffff','#94a3b8'],
      document: ['#eff6ff','#3b82f6'], folder: ['#fefce8','#ca8a04'],
      '*': ['#f1f5f9','#64748b'],
    },
  },
  pastel: { label: '粉彩多色', single: 0, accent: '#0ea5e9', edge: '#94a3b8', anchor: '#0ea5e9', text: '#334155',
    nodes: {
      start: ['#d1fae5','#34d399'], process: ['#e0f2fe','#38bdf8'], sharp: ['#e0e7ff','#818cf8'],
      decision: ['#fef9c3','#facc15'], io: ['#fce7f3','#f9a8d4'], circle: ['#fce7f3','#f9a8d4'],
      prep: ['#f3e8ff','#c084fc'], triangle: ['#f3e8ff','#c084fc'],
      storage: ['#ffedd5','#fdba74'], note: ['#fef9c3','#fde047'], text: ['#ffffff','#cbd5e1'],
      document: ['#e0f2fe','#7dd3fc'], folder: ['#fef9c3','#fde047'],
      '*': ['#f1f5f9','#cbd5e1'],
    },
  },
};

// 图例（每种独一无二的形状各一个：圆角/直角矩形合并为「矩形」，圆角可自己调）
Gongfang._drawLegend = [
  ['process', '矩形'], ['circle', '圆形'], ['io', '椭圆'],
  ['decision', '菱形'], ['prep', '平行四边形'], ['triangle', '三角形'],
];

Gongfang._drawShapePreviews = {
  start:    '<rect x="2" y="5" width="20" height="14" rx="7"/>',
  process:  '<rect x="2" y="5" width="20" height="14" rx="2"/>',
  sharp:    '<rect x="2" y="5" width="20" height="14" rx="0"/>',
  decision: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/>',
  io:       '<ellipse cx="12" cy="12" rx="10.5" ry="6.5"/>',
  circle:   '<circle cx="12" cy="12" r="9"/>',
  prep:     '<path d="M3.5 6.5h13l4 11h-13z"/>',
  triangle: '<path d="M12 3 21 19H3Z"/>',
  storage:  '<ellipse cx="12" cy="5.5" rx="9.5" ry="3.5"/><path d="M2.5 5.5v13c0 1.9 4.3 3.5 9.5 3.5s9.5-1.6 9.5-3.5v-13"/><path d="M2.5 12c0 1.9 4.3 3.5 9.5 3.5s9.5-1.6 9.5-3.5"/>',
  note:     '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2" transform="rotate(-6 12 12)"/><path d="M8 15h8M8 18h5"/>',
  text:     '<path d="M8 20 12 4l4 16M9.5 13.5h5"/>',
  document: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  folder:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  image:    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
};

// ── 颜色辅助 ──
Gongfang._drawActiveColor = function() {
  var t = Gongfang._drawThemes[Gongfang._drawState.theme] || Gongfang._drawThemes.classic;
  var f = Gongfang._drawState.fillColor;
  var tf = Gongfang._drawTransparentFill();
  // 透明填充不算有效颜色，避免把边框/线条也带成透明
  return (f && f !== 'none' && f !== tf ? f : null) || Gongfang._drawState.strokeColor || Gongfang._drawState.edgeColor || t.accent || '#4f46e5';
};
Gongfang._drawNodeFill = function() {
  var t = Gongfang._drawThemes[Gongfang._drawState.theme] || Gongfang._drawThemes.classic;
  if (Gongfang._drawState.nodeStyle === 'transparent') return Gongfang._drawTransparentFill();
  var fc = Gongfang._drawState.fillColor;
  var tf = Gongfang._drawTransparentFill();
  if (fc === 'none' || fc === tf) return tf;
  return fc ? Gongfang._drawTint(fc) : (t.fill || Gongfang._drawTint(t.accent || '#4f46e5'));
};
Gongfang._drawNodeDash = function() {
  var d = Gongfang._drawState.dash || 0;
  if (d <= 0) return '';
  // 稀疏 → 密集：数值越大，间隔越小（虚线越密）。d=1 间隙 12px，d=12 间隙 1px
  var gap = Math.max(1, Math.round(12 - d + 1));
  return '3 ' + gap;
};
Gongfang._drawTint = function(hex) {
  try {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * 0.85); g = Math.round(g + (255 - g) * 0.85); b = Math.round(b + (255 - b) * 0.85);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch(e) { return '#eef2ff'; }
};
// 透明填充值：几乎不可见但仍是"实心"（保证节点可点击/拖动/拉锚点）
Gongfang._drawTransparentFill = function() { return 'rgba(255,255,255,0.02)'; };
Gongfang._drawNodeColors = function(type, node) {
  var th = Gongfang._drawThemes[Gongfang._drawState.theme] || Gongfang._drawThemes.classic;
  var ns = Gongfang._drawState.nodeStyle;
  var f = Gongfang._drawState.fillColor;
  var s = Gongfang._drawState.strokeColor;
  var tf = Gongfang._drawTransparentFill();
  // 图例拖出的节点：没有全局颜色时默认中性（透明填充 + 黑边），有全局颜色时用全局
  var isPalette = node && Gongfang._drawProps(node).paletteNode;
  if (isPalette && !f && !s) return [(ns === 'transparent' ? 'none' : tf), '#111827'];
  var fillV = f ? ((f === 'none' || f === tf) ? tf : f) : null;
  // 填充/边框可单独覆盖（未设的用主题默认）
  if (th.nodes) {
    var c = th.nodes[type] || th.nodes['*'];
    return [(fillV || (ns === 'transparent' ? 'none' : c[0])), (s || c[1])];
  }
  return [(fillV || Gongfang._drawNodeFill()), (s || th.accent || '#4f46e5')];
};
Gongfang._drawEdgeColor = function() {
  // ★ 默认线条改为黑色 #111827（用户要求）；设置了自定义线条颜色（edgeColor）时用自定义色
  return Gongfang._drawState.edgeColor || '#111827';
};
Gongfang._drawCurrentPalette = function() { return Gongfang._drawLegend; };

// ── X6 元数据助手：节点/连线的「properties」约定存于 cell.data.properties ──
Gongfang._drawProps = function(cell) {
  if (!cell) return {};
  var d = cell.getData ? cell.getData() : null;
  return (d && d.properties) || {};
};
Gongfang._drawSetProps = function(cell, patch) {
  if (!cell) return;
  var d = (cell.getData ? cell.getData() : null) || {};
  d.properties = Object.assign({}, d.properties, patch);
  if (cell.setData) cell.setData(d);
};
// 模型归一化：X6 事件直接给出 cell，无需转换
Gongfang._drawModelOf = function(node) { return node || null; };

// ── 连线类型 → X6 router/connector ──
// bezier=曲线；其余=折线，用 manhattan 路由（纯直角转弯、绕开节点不重叠、拖动节点自动重排）
Gongfang._drawManhattanRouter = function() {
  return { name: 'manhattan' };
};
Gongfang._drawEdgeRouterConnector = function(t) {
  if (t === 'bezier') return { router: 'normal', connector: 'smooth' };
  return { router: Gongfang._drawManhattanRouter(), connector: 'normal' };
};
// 箭头 marker（isSource=true 生成起点箭头，false 生成终点箭头）
// ★ 自定义箭头（path preset）：箭头尖严格落在节点边框交点（连接点）上，不伸入节点内部；
//   箭头主体向后延伸覆盖线条被 X6 截短的部分，线条与箭头无缝相连（箭头是线条的一部分，不是另贴一个箭头）。
//   经 X6 渲染实测（manhattan + 线宽 1.6）：终点箭头背延伸到 -11.6、尖在 0，正好盖住线条末端。
Gongfang._drawArrowMarker = function(isSource) {
  if (Gongfang._drawState.arrow === 'none') return null;
  var size = 6;   // ★ 箭头改小：只覆盖线条末端「最后一点点」，线条看起来几乎贴到节点边框
  var w = parseFloat(Gongfang._drawState.edgeWidth) || 1.6;
  var halfW = Math.ceil(w / 2);
  var W = size + w;   // 箭头长度 = size + 线宽（覆盖线条截短量，消除缝隙）
  var H = size;       // 箭头高度
  if (isSource) {
    // 起点箭头：背贴起点边框（refX=+halfW），尖沿线条方向延伸（指向目标），不进节点
    var backX = halfW;
    var tipX = backX + W;
    var d = 'M ' + backX + ' 0 L ' + tipX + ' ' + (-H / 2) + ' L ' + (backX + W * 0.75) + ' 0 L ' + tipX + ' ' + (H / 2) + ' Z';
    var offsetX = -(halfW + W / 2);   // 抵消 dm 居中，保持背在 refX
    return { name: 'path', d: d, offsetX: offsetX, size: size, strokeWidth: w, fill: Gongfang._drawEdgeColor() };
  }
  // 终点箭头：marker-end 的路径带 transform="rotate(180)"（X6 对 marker-end 自动加的）。
  // ★ 期望渲染：箭头尖(点)在节点边框、指向节点内部，平底在线条侧。
  //   路径坐标取期望的相反数：路径尖(点)在 +halfW → 旋转后落在 -halfW(=refX=边框)；
  //   路径平底在 +halfW+W → 旋转后落在 -halfW-W（线条侧）。
  var tipX = halfW;       // 尖(点)：旋转后 = refX = 节点边框
  var backX = tipX + W;   // 平底：旋转后 = -halfW-W = 线条侧
  var d = 'M ' + tipX + ' 0 L ' + backX + ' ' + (H / 2) + ' L ' + (backX - W * 0.75) + ' 0 L ' + backX + ' ' + (-H / 2) + ' Z';
  var offsetX = -(halfW + W / 2);   // 抵消 dm 居中，保持路径坐标
  return { name: 'path', d: d, offsetX: offsetX, size: size, strokeWidth: w, fill: Gongfang._drawEdgeColor() };
};
// ★ 按箭头模式返回两端 marker：none→两端都无；arrow→终点箭头；swap→起点箭头；both→两端箭头
Gongfang._drawArrowMarkers = function() {
  var a = Gongfang._drawState.arrow || 'arrow';
  var s = null, t = null;
  if (a === 'arrow' || a === 'both') t = Gongfang._drawArrowMarker(false);
  if (a === 'swap' || a === 'both') s = Gongfang._drawArrowMarker(true);
  return { source: s, target: t };
};
// 箭头所在端：none=无 / arrow=终点 / swap=起点 / both=两端
Gongfang._drawArrowEnd = function() {
  var a = Gongfang._drawState.arrow || 'arrow';
  if (a === 'both') return 'both';
  return a === 'swap' ? 'source' : 'target';
};

// ═══════════════════ 初始化：三栏布局 ═══════════════════
Gongfang._drawInit = function() {
  var host = document.getElementById('writeModeDraw');
  if (!host) return;
  if (Gongfang._drawState.initDone) { Gongfang._drawResize(); return; }
  if (typeof window.X6 === 'undefined' || !window.X6.Graph) {
    // ★ X6 已懒加载：首次进入绘图模式时注入，加载成功后再走完整初始化
    Gongfang._ensureX6().then(function() {
      if (typeof window.X6 !== 'undefined' && window.X6.Graph && !Gongfang._drawState.initDone) {
        Gongfang._drawInit();
      } else {
        host.innerHTML = '<div style="padding:24px;color:#dc2626">X6 引擎加载失败</div>';
      }
    });
    return;
  }
  Gongfang._drawState.initDone = true;
  Gongfang._drawLoadColorState();

  host.innerHTML = [
    '<div class="dw-wb">',
      // 左栏：流程图库（文件标题栏右侧「新建」，下方是保存好的流程图列表）
      '<div class="dw-files-col">',
        '<div class="dw-lfile-section">',
          '<div class="dw-col-head">',
            '<span class="dw-col-title">文件</span>',
            '<button class="dw-new-btn" onclick="Gongfang._drawNewFlow()" title="新建流程图">＋ 新建</button>',
          '</div>',
          '<div class="dw-lfile-body" id="dwFileBody">',
            '<div class="dw-flow-list" id="dwFlowList"><div class="dw-empty">加载中…</div></div>',
          '</div>',
        '</div>',
      '</div>',
      // 中栏：顶部快捷条 + 画布
      '<div class="dw-center-col">',
        '<div class="dw-canvas-bar">',
          '<div class="dw-bar-left">',
            '<button class="dw-btn" onclick="Gongfang._drawUndo()" title="撤销"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>',
            '<button class="dw-btn" onclick="Gongfang._drawRedo()" title="重做"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>',
            '<span class="dw-sep"></span>',
            '<button class="dw-btn" onclick="Gongfang._drawFit()" title="适应画布"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>',
            '<span class="dw-zoom" id="dwZoom">100%</span>',
          '</div>',
          '<div class="dw-bar-right">',
            '<button class="dw-file-btn" onclick="Gongfang._drawSaveJson()" title="保存为流程图 .json">保存文件</button>',
            '<button class="dw-file-btn" onclick="Gongfang._drawExportPng()" title="导出为 SVG 图片">保存图片</button>',
            '<button class="dw-file-btn" onclick="Gongfang._drawInsertImage()" title="插入一张本地图片">插入图片</button>',
          '</div>',
        '</div>',
        '<div class="dw-canvas" id="dwCanvas"></div>',
        '<div class="dw-zoom-badge" id="dwZoomBadge" style="display:none">100%</div>',
        '<div class="dw-file-badge" id="dwFileBadge"></div>',
      '</div>',
      // 右栏：参数设置 + 图例
      '<div class="dw-right-col" id="dwRightCol">',
        '<div class="dw-settings-section">',
          // ★ 标题栏改为「参数设置」
          '<div class="dw-col-head"><span class="dw-col-title">参数设置</span></div>',
          '<div class="dw-settings-body" id="dwSettingsBody">' + Gongfang._drawRenderSettings() + '</div>',
        '</div>',
        '<div class="dw-palette-section">',
          // ★ 图例：左「节点/成图」切换 + 右侧收起
          '<div class="dw-col-head">',
            '<span class="dw-col-title">图例</span>',
            '<div class="dw-palette-mode" id="dwPaletteMode">',
              '<button class="active" data-mode="nodes" onclick="Gongfang._drawTogglePaletteMode(\'nodes\')">节点</button>',
              '<button data-mode="examples" onclick="if(Gongfang._showToast)Gongfang._showToast(\'暂未开放\')">成图</button>',
            '</div>',
          '</div>',
          '<div class="dw-palette-body" id="dwPaletteBody">' + Gongfang._drawRenderPalette() + '</div>',
        '</div>',
      '</div>',
    '</div>',
  ].join('');

  Gongfang._drawInitEngine();
  Gongfang._drawBindPalette();
  Gongfang._drawBindSettings();
  Gongfang._drawResize();
  Gongfang._drawRefreshFlowList();
  // 画布尺寸交给 X6 autoResize；这里只监听窗口 resize 重绘网格（避免 ResizeObserver 循环导致网格抖动/卡顿）
  if (!Gongfang._drawWinResizeBound) {
    Gongfang._drawWinResizeBound = true;
    window.addEventListener('resize', function() {
      Gongfang._drawLastW = 0; Gongfang._drawLastH = 0;
      Gongfang._drawResize();
    });
  }
  // ★ 复制 / 粘贴快捷键：仅在绘图模式、且焦点不在输入框时生效
  if (!Gongfang._drawKeyBound) {
    Gongfang._drawKeyBound = true;
    document.addEventListener('keydown', function(ev) {
      var host = Gongfang._drawE('writeModeDraw');
      if (!host || host.style.display === 'none') return;
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      var k = String(ev.key || '').toLowerCase();
      if (k === 'c') { ev.preventDefault(); Gongfang._drawCopySelection(); }
      else if (k === 'v') { ev.preventDefault(); Gongfang._drawPasteSelection(); }
    });
  }
  // 进入绘图模式后布局可能未完全稳定：延迟校正一次网格，避免偏移/空白/不可交互
  setTimeout(function() {
    Gongfang._drawLastW = 0; Gongfang._drawLastH = 0;   // 强制重新测量
    Gongfang._drawResize();
    Gongfang._drawUpdateZoom();
  }, 150);
};

Gongfang._drawE = function(id) { return document.getElementById(id); };

// ═══════════════════ AntV X6 引擎 ═══════════════════
Gongfang._drawInitEngine = function() {
  var container = Gongfang._drawE('dwCanvas');
  if (!container) return;
  if (container.__dwGraph) { try { container.__dwGraph.dispose(); } catch(e) {} container.__dwGraph = null; container.innerHTML = ''; }
  var st = Gongfang._drawState;
  var gs = st.gridSize || 20;
  var X6 = window.X6;

  // 自定义连接点：连线端点精确落在节点边框（X6 内置 boundary 有 ~11px 偏移，这个用 bbox 精确求交）
  if (!X6.Graph.connectionPoint || !X6.Graph.connectionPoint.presets || !X6.Graph.connectionPoint.presets.boundaryExact) {
    try {
      X6.Graph.registerConnectionPoint('boundaryExact', function(line, view, magnet, options) {
        var node = view && view.cell;
        if (!node || !node.isNode) return line.end;
        try {
          var bbox = node.getBBox();
          var l = new X6.Line(line.start, line.end);
          var ints = bbox.intersectsWithLine(l);
          if (ints && ints.length) {
            var best = ints[0], bestD = Infinity;
            ints.forEach(function(p) { var d = p.squaredDistance(line.end); if (d < bestD) { bestD = d; best = p; } });
            return best;
          }
        } catch(e) {}
        return line.end;
      });
    } catch(e) {}
  }

  var graph = new X6.Graph({
    container: container,
    autoResize: true,
    grid: { size: gs, visible: !!st.gridVisible, type: 'mesh', args: { color: '#cbd5e1', thickness: 1 } },
    // 交互：左键选中/拖节点、左拖空白框选、右键拖平移画布、右键点弹菜单
    panning: { enabled: true, eventTypes: ['rightMouseDown'] },
    mousewheel: { enabled: true, zoomAtMousePosition: true, factor: 1.2, minScale: 0.05, maxScale: 16 },  // ★滚轮以鼠标为中心
    connecting: {
      snap: false,   // 关掉拖线时的吸附命中检测，显著降低拖线卡顿（端口 hover/连线靠近另有高亮提示）
      allowBlank: false, allowNode: true, allowPort: true, allowLoop: false, allowEdge: false, allowMulti: true,   // 同一锚点可拉出多条连线
      // 两端用 boundaryExact：连线端点精确落在节点边框（无 X6 内置 boundary 的 ~11px 偏移）
      sourceConnectionPoint: { name: 'boundaryExact' },
      targetConnectionPoint: { name: 'boundaryExact' },
      // 默认直角折线（router manhattan：纯直角+绕开节点），曲线由 createEdge 按 state.edgeType 设置
      router: Gongfang._drawManhattanRouter(), connector: 'normal',
      createEdge: function() {
        var rc = Gongfang._drawEdgeRouterConnector(st.edgeType);
        var mks = Gongfang._drawArrowMarkers();
        var lineAttrs = { stroke: Gongfang._drawEdgeColor(), strokeWidth: st.edgeWidth || 1.6 };
        if (mks.target) lineAttrs.targetMarker = mks.target;
        if (mks.source) lineAttrs.sourceMarker = mks.source;
        return new X6.Shape.Edge({
          router: rc.router, connector: rc.connector,
          attrs: { line: lineAttrs },
        });
      },
      validateConnection: function(args) {
        // 只能从锚点(port)拖出；可落在另一节点的任意位置（含其锚点）
        return !!(args && args.sourceMagnet && args.targetCell && args.sourceCell !== args.targetCell);
      },
    },
    preventDefaultContextMenu: true,
    preventDefaultBlankAction: true,
  });

  graph.use(new X6PluginHistory.History({ enabled: true, stackSize: 200 }));
  graph.use(new X6PluginSelection.Selection({
    rubberband: true, eventTypes: ['leftMouseDown'],
    // ★ 连线不再显示独立的 edge selection box（与 Transform 边框重叠、像"不跟线条"）；
    //   连线选中交互改为 Transform 贴合边框 + vertices/segments 顶点手柄
    showNodeSelectionBox: true, showEdgeSelectionBox: false, multiple: true, movable: true,
  }));
  graph.use(new X6PluginSnapline.Snapline({ enabled: true, sharp: false, tolerance: 5 }));
  graph.use(new X6PluginTransform.Transform({ resizing: { enabled: true }, rotating: { enabled: true, grid: 1 } }));
  graph.use(new X6PluginExport.Export());

  st.graph = graph;
  st.lf = graph;   // 兼容别名
  container.__dwGraph = graph;

  Gongfang._drawRegisterNodes(X6);
  Gongfang._drawApplyTheme();
  Gongfang._drawBindCanvasInteraction(graph);
};

// ── 端口配置：四向锚点（箭头造型，区分四角缩放柄；默认透明隐藏，鼠标靠近/拖线时通过 CSS 显现）
// 端口贴在节点边框上（offset 0），连线从边框引出；hit 圆是隐形大命中区（magnet 可拖线），arrow 是指向外侧的箭头
Gongfang._drawPorts = function() {
  var mk = function(name, d) {
    return {
      position: { name: name },
      markup: [
        { tagName: 'circle', selector: 'hit' },
        { tagName: 'path', selector: 'arrow' },
      ],
      attrs: {
        // hit 圆隐形但可命中（fill:transparent 是可点击的实心），magnet 拖线；端口贴边 → 连线连节点边框
        // ★ 命中圆加大（r 11→16）：作用区域更灵敏，拖线不易误点到节点本体；半径正好罩住箭头顶点
        hit: { r: 16, fill: 'transparent', stroke: 'none', strokeWidth: 1, magnet: true, pointerEvents: 'all' },
        // 小箭头：路径向外探出节点边框；无白色描边、不像圆
        arrow: { d: d, fill: '#334155', stroke: 'none', pointerEvents: 'none' },
      },
    };
  };
  // 箭头整体探出节点边框外侧（连接锚点坐标仍留在边框上，保证连线端点贴边；锚点≠连线落点）
  // 方向：top 朝上(-y)、bottom 朝下(+y)、right 朝右(+x)、left 朝左(-x)，全部朝节点外部
  // ★ 箭头加大并外移：底边离边 6px、顶点 16px（原来 3px/12px），更容易瞄准
  return {
    groups: {
      top: mk('top', 'M -7 -6 L 0 -16 L 7 -6 Z'),
      right: mk('right', 'M 6 -7 L 16 0 L 6 7 Z'),
      bottom: mk('bottom', 'M -7 6 L 0 16 L 7 6 Z'),
      left: mk('left', 'M -6 -7 L -16 0 L -6 7 Z'),
    },
    items: [
      { id: 'top', group: 'top' },
      { id: 'right', group: 'right' },
      { id: 'bottom', group: 'bottom' },
      { id: 'left', group: 'left' },
    ],
  };
};

// ── 14 种自定义节点注册 ──
Gongfang._drawRegisterNodes = function(X6) {
  var label = function(text) {
    // ★ 文字自动换行：textWrap 宽度 = 节点宽 - 12px（两侧各 6px），超宽自动换行，不再溢出节点
    return { text: text, refX: 0.5, refY: 0.5, textAnchor: 'middle', textVerticalAnchor: 'middle', textWrap: { width: -12, ellipsis: false } };
  };
  var bodyBase = function() {
    return { fill: '#ffffff', stroke: '#111827', strokeWidth: 1.4 };
  };
  var rectDef = function(w, h, rx, text) {
    return {
      inherit: 'rect', width: w, height: h,
      ports: Gongfang._drawPorts(),
      attrs: { body: Object.assign(bodyBase(), { rx: rx }), label: label(text) },
    };
  };
  X6.Graph.registerNode('start', rectDef(150, 56, 28, '开始'));
  X6.Graph.registerNode('process', rectDef(190, 60, 6, '处理步骤'));
  X6.Graph.registerNode('sharp', rectDef(170, 60, 0, '处理'));

  // 椭圆 / 圆形（body 用 ref 属性自适应宽高）
  X6.Graph.registerNode('io', {
    inherit: 'ellipse', width: 170, height: 56,
    ports: Gongfang._drawPorts(),
    attrs: {
      body: Object.assign(bodyBase(), { refCx: '50%', refCy: '50%', refRx: '50%', refRy: '50%' }),
      label: label('输入 / 输出'),
    },
  });
  // 注意：X6 2.x 内置已有 'circle' 形状名，registerNode 的 force 是第三参数（true）才不抛"already registered"
  X6.Graph.registerNode('circle', {
    inherit: 'ellipse', width: 110, height: 110,
    ports: Gongfang._drawPorts(),
    attrs: {
      body: Object.assign(bodyBase(), { refCx: '50%', refCy: '50%', refRx: '50%', refRy: '50%' }),
      label: label('圆形'),
    },
  }, true);

  // 多边形（refPoints 以 0-100 坐标系描述，等比缩放进节点）
  X6.Graph.registerNode('decision', {
    inherit: 'polygon', width: 130, height: 96,
    ports: Gongfang._drawPorts(),
    attrs: { body: Object.assign(bodyBase(), { refPoints: '50,0 100,50 50,100 0,50' }), label: label('判断') },
  });
  X6.Graph.registerNode('prep', {
    inherit: 'polygon', width: 170, height: 60,
    ports: Gongfang._drawPorts(),
    attrs: { body: Object.assign(bodyBase(), { refPoints: '22,0 100,0 78,100 0,100' }), label: label('预处理') },
  });
  X6.Graph.registerNode('triangle', {
    inherit: 'polygon', width: 100, height: 92,
    ports: Gongfang._drawPorts(),
    attrs: { body: Object.assign(bodyBase(), { refPoints: '50,0 100,100 0,100' }), label: label('三角形') },
  });

  // 圆柱 / 存储（圆柱体：侧面 path + 顶部椭圆弧 path，refD 随宽高等比缩放）
  X6.Graph.registerNode('storage', {
    width: 170, height: 70,
    ports: Gongfang._drawPorts(),
    markup: [
      { tagName: 'path', selector: 'body' },
      { tagName: 'path', selector: 'top' },
      { tagName: 'text', selector: 'label' },
    ],
    attrs: {
      body: Object.assign(bodyBase(), { refD: 'M16 12 a69 9 0 0 1 138 0 v46 a69 9 0 0 1 -138 0 z', refWidth: '100%', refHeight: '100%', vectorEffect: 'non-scaling-stroke' }),
      top: Object.assign(bodyBase(), { refD: 'M16 12 a69 9 0 0 0 138 0', refWidth: '100%', refHeight: '100%', vectorEffect: 'non-scaling-stroke' }),
      label: label('存储数据'),
    },
  });
  // 便签 / 注释（虚线圆角矩形 + 折角；折角固定 22px 不随宽高缩放）
  X6.Graph.registerNode('note', {
    width: 170, height: 90,
    ports: Gongfang._drawPorts(),
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'path', selector: 'fold' },
      { tagName: 'text', selector: 'label' },
    ],
    attrs: {
      body: Object.assign(bodyBase(), { refWidth: '100%', refHeight: '100%', rx: 6, strokeWidth: 1.2, strokeDasharray: '4 3', vectorEffect: 'non-scaling-stroke' }),
      fold: { d: 'M0 0 L22 0 L22 22 Z', fill: '#111827', opacity: 0.85 },
      label: label('备注说明'),
    },
  });
  // 文本（透明 body 保证可点击，label 承载文字；不用 text-block 保证 SVG 导出干净）
  X6.Graph.registerNode('text', {
    inherit: 'rect', width: 150, height: 30,
    ports: Gongfang._drawPorts(),
    attrs: {
      body: { fill: 'none', stroke: 'none', pointerEvents: 'all' },
      label: Object.assign(label('双击输入文字'), { fontSize: 13, fill: '#64748b' }),
    },
  });
  // 文档（右下折角路径）
  X6.Graph.registerNode('document', {
    width: 150, height: 100,
    ports: Gongfang._drawPorts(),
    markup: [
      { tagName: 'path', selector: 'body' },
      { tagName: 'text', selector: 'label' },
    ],
    attrs: {
      body: Object.assign(bodyBase(), { refD: 'M0 0 L78 0 L100 22 L100 100 L0 100 Z', refWidth: '100%', refHeight: '100%', vectorEffect: 'non-scaling-stroke' }),
      label: label('文档'),
    },
  });
  // 文件夹（顶部 tab 路径）
  X6.Graph.registerNode('folder', {
    width: 160, height: 100,
    ports: Gongfang._drawPorts(),
    markup: [
      { tagName: 'path', selector: 'body' },
      { tagName: 'text', selector: 'label' },
    ],
    attrs: {
      body: Object.assign(bodyBase(), { refD: 'M0 0 L14 0 L20 12 L100 12 L100 100 L0 100 Z', refWidth: '100%', refHeight: '100%', vectorEffect: 'non-scaling-stroke' }),
      label: label('文件夹'),
    },
  });
  // 图片（body 为占位虚线框，有 src 时隐藏占位、显示图片；force=true 覆盖内置 image 形状名）
  X6.Graph.registerNode('image', {
    width: 200, height: 150,
    ports: Gongfang._drawPorts(),
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'image', selector: 'image' },
      { tagName: 'text', selector: 'label' },
    ],
    attrs: {
      body: { refWidth: '100%', refHeight: '100%', rx: 4, fill: '#f8fafc', stroke: '#94a3b8', strokeWidth: 1.2, strokeDasharray: '4 3' },
      image: { refWidth: '100%', refHeight: '100%', preserveAspectRatio: 'xMidYMid meet', xlinkHref: '' },
      label: { refX: 0.5, refY: 0.5, textAnchor: 'middle', textVerticalAnchor: 'middle', fill: '#94a3b8', fontSize: 12, text: '图片' },
    },
    propHooks: function(meta) {
      var src = (meta && meta.src) || (meta && meta.data && meta.data.properties && meta.data.properties.src) || (meta && meta.properties && meta.properties.src);
      if (src) {
        meta.attrs = meta.attrs || {};
        meta.attrs.body = Object.assign({}, meta.attrs.body, { fill: 'none', stroke: 'none', strokeDasharray: 'none' });
        meta.attrs.image = Object.assign({}, meta.attrs.image, { xlinkHref: src });
        meta.attrs.label = Object.assign({}, meta.attrs.label, { text: '' });
      }
      return meta;
    },
  }, true);
};

// ═══════════════════ 画布交互（X6 原生） ═══════════════════
// 右键拖拽状态：空白=平移画布，节点=移动节点；右键点(不拖)=弹菜单
Gongfang._drawPan = { moved: false };
Gongfang._drawBindCanvasInteraction = function(graph) {
  if (!graph) return;
  var c = Gongfang._drawE('dwCanvas');
  if (c && !c.__dwCtx) { c.__dwCtx = true; c.addEventListener('contextmenu', function(e) { e.preventDefault(); }); }

  graph.on('scale', function() { Gongfang._drawUpdateZoom(); });

  graph.on('node:click', function(args) {
    var node = args && args.node;
    if (node && node.id) Gongfang._drawState.lastNode = node;
    else Gongfang._drawState.lastNode = null;
  });
  graph.on('blank:click', function() { Gongfang._drawState.lastNode = null; });

  // 右键拖 vs 右键点：平移触发 translate 视为拖动；右键点(不拖)才弹菜单
  // 注意：X6 guard 拦截 button-2 的 node:mousedown/blank:mousedown，所以在容器上挂原始监听重置 moved
  if (c && !c.__dwPanReset) {
    c.__dwPanReset = true;
    c.addEventListener('mousedown', function(e) { if (e.button === 2) Gongfang._drawPan.moved = false; });
  }
  graph.on('translate', function() { Gongfang._drawPan.moved = true; });

  // ★ 多选对象集合右键 → 简化菜单（删除/复制/粘贴/图层）
  var drawMulti = function(e, cellId) {
    var graph = Gongfang._drawState.graph;
    return !!(graph && graph.getSelectedCells && graph.getSelectedCells().length > 1);
  };
  graph.on('node:contextmenu', function(args) {
    var node = args && args.node, e = args && args.e;
    if (!node || !node.id || !e || Gongfang._drawPan.moved) return;
    if (drawMulti(e, node.id)) Gongfang._drawShowMultiMenu(e, node.id);
    else Gongfang._drawShowNodeMenu(e, node.id);
  });
  graph.on('edge:contextmenu', function(args) {
    var edge = args && args.edge, e = args && args.e;
    if (!edge || !edge.id || !e || Gongfang._drawPan.moved) return;
    if (drawMulti(e, edge.id)) Gongfang._drawShowMultiMenu(e, edge.id);
    // ★ 单选右击线条直接弹出「连线样式」二级菜单
    else Gongfang._drawShowStylePanel('edge', edge.id, e.clientX, e.clientY);
  });
  // ★ 空白区右键 → 只有「粘贴」的二级菜单
  graph.on('blank:contextmenu', function(args) {
    var e = args && args.e;
    if (e && !Gongfang._drawPan.moved) Gongfang._drawShowBlankMenu(e);
  });

  // 双击节点文字 → 内联编辑（自研覆盖输入框，X6 node-editor 工具依赖的 cell:dblclick 不触发）
  graph.on('node:dblclick', function(args) {
    var node = args && args.node;
    if (!node) return;
    Gongfang._drawEditNodeText(node);
  });

  graph.on('node:added', function() { Gongfang._drawUpdateStats(); });
  graph.on('node:removed', function() { Gongfang._drawUpdateStats(); });
  graph.on('edge:added', function() { Gongfang._drawUpdateStats(); });
  graph.on('edge:removed', function() { Gongfang._drawUpdateStats(); });

  // ★ 节点缩放时重算右对齐锚点（refX 依赖当前宽度）与换行宽度
  graph.on('node:change:size', function(args) {
    var cell = args && args.cell;
    if (cell && cell.isNode && Gongfang._drawApplyNodeCell) {
      try { Gongfang._drawApplyNodeCell(cell); } catch(e) {}
    }
  });

  // ★ 节点拖动吸附：开启时按网格取整位置（画布「吸附」开关）
  graph.on('node:move', function(args) {
    var node = args && args.node;
    if (!node || !Gongfang._drawState.snap) return;
    try {
      var gs = Gongfang._drawState.gridSize || 20;
      var p = node.position();
      var sx = gs * Math.round(p.x / gs);
      var sy = gs * Math.round(p.y / gs);
      if (sx !== p.x || sy !== p.y) node.position(sx, sy);
    } catch(e) {}
  });

  // ★ 选中连线：显示可拖动的顶点/分段手柄，用于人工调整线条走向
  //   （折线每段可垂直拖动、曲线中点可拖；拖动即改线条路径）
  graph.on('edge:selected', function(args) {
    var edge = args && args.edge;
    if (!edge) return;
    try {
      // ★ 1.7 加 source/target-arrowhead 手柄：端点可拖动重连，不再锁死在原锚点
      edge.addTools([
        { name: 'source-arrowhead', args: { attrs: { fill: '#ffffff', stroke: '#4f46e5', strokeWidth: 1.5, r: 6 } } },
        { name: 'target-arrowhead', args: { attrs: { fill: '#ffffff', stroke: '#4f46e5', strokeWidth: 1.5, r: 6 } } },
        { name: 'vertices', args: { attrs: { fill: '#ffffff', stroke: '#4f46e5', strokeWidth: 1.5, r: 5 } } },
        { name: 'segments', args: { attrs: { fill: '#ffffff', stroke: '#f59e0b', strokeWidth: 1.5, r: 4 } } },
      ]);
    } catch(e) {}
  });
  graph.on('edge:unselected', function(args) {
    var edge = args && args.edge;
    if (!edge) return;
    try { edge.removeTools(); } catch(e) {}
  });

  // 创建连线后保持源节点选中，缩放/旋转控件不消失
  graph.on('edge:connected', function(args) {
    try {
      if (args && args.isNew && args.edge) {
        var srcCell = args.edge.getSourceCell();
        if (srcCell && srcCell.isNode && srcCell.isNode()) {
          Gongfang._drawState.lastNode = srcCell;
          graph.cleanSelection();
          graph.select(srcCell);
        }
      }
    } catch(e) {}
  });

  // Delete / Backspace 删除选中的节点/连线（仅绘图模式可见时，避开输入框）
  if (!Gongfang._drawKeyBound) {
    Gongfang._drawKeyBound = true;
    document.addEventListener('keydown', function(e) {
      var host = document.getElementById('writeModeDraw');
      if (!host || getComputedStyle(host).display === 'none') return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      var key = e.key || '';
      if (key === 'Delete' || key === 'Backspace') {
        var sel = graph.getSelectedCells();
        if (sel && sel.length) { e.preventDefault(); graph.removeCells(sel); }
      }
    });
  }
};

// ── 图例绑定（拖拽，动态取当前 graph） ──
Gongfang._drawShapeCard = function(type, label) {
  var inner = (Gongfang._drawShapePreviews && Gongfang._drawShapePreviews[type]) || '<rect x="2" y="5" width="20" height="14" rx="2"/>';
  // 图例固定用黑白线框展示，不随颜色变化
  return '<div class="dw-shape" data-shape="' + type + '" title="' + label + ' — 拖入画布 / 双击改字">' +
    '<svg class="dw-shape-preview" viewBox="0 0 24 24" fill="#ffffff" stroke="#111827" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">' + inner + '</svg></div>';
};
Gongfang._drawPaletteMode = 'nodes';
Gongfang._drawRenderPalette = function() {
  if (Gongfang._drawPaletteMode === 'examples') {
    return Gongfang._drawExamples.map(function(ex, i) {
      return '<div class="dw-example-card" onclick="Gongfang._drawAddExample(' + i + ')" title="点击添加到画布">' +
        '<div class="dw-example-name">' + ex.name + '</div>' +
        Gongfang._drawExamplePreview(ex) +
        '</div>';
    }).join('');
  }
  return Gongfang._drawCurrentPalette().map(function(s) { return Gongfang._drawShapeCard(s[0], s[1]); }).join('');
};
Gongfang._drawTogglePaletteMode = function(mode) {
  if (mode === 'examples') { if (Gongfang._showToast) Gongfang._showToast('暂未开放'); return; }
  Gongfang._drawPaletteMode = mode;
  var seg = Gongfang._drawE('dwPaletteMode');
  if (seg) seg.querySelectorAll('button').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
  Gongfang._drawRefreshPalette();
};
// 成图示例（暂未开放）
Gongfang._drawExamples = [];
Gongfang._drawExamplePreview = function() { return ''; };
Gongfang._drawAddExample = function() { if (Gongfang._showToast) Gongfang._showToast('暂未开放'); };
Gongfang._drawRefreshPalette = function() {
  var body = Gongfang._drawE('dwPaletteBody');
  if (body) { body.innerHTML = Gongfang._drawRenderPalette(); Gongfang._drawBindPalette(); }
};
Gongfang._drawBindPalette = function() {
  var host = document.getElementById('writeModeDraw');
  if (!host) return;
  host.querySelectorAll('.dw-shape[data-shape]').forEach(function(card) {
    if (card.__dwBound) return;
    card.__dwBound = true;
    card.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var type = card.getAttribute('data-shape');
      var text = '';   // ★ 图例拖入不预填文字，默认空白
      var graph = Gongfang._drawState.graph;
      if (!graph) return;
      Gongfang._drawStartPaletteDrag(e, type, text);
    });
  });
};
Gongfang._drawDefaultText = function(type) {
  var map = { start: '开始', process: '处理步骤', sharp: '处理', decision: '判断', io: '输入 / 输出', circle: '圆形', prep: '预处理', triangle: '三角形', storage: '存储数据', note: '备注', text: '文本', document: '文档', folder: '文件夹', image: '' };
  return map[type] || '节点';
};

// ── 自定义拖拽：真实尺寸形状预览跟随鼠标，松手在画布生成节点（颜色与图例一致） ──
Gongfang._drawPaletteDrag = { active: false, type: null, text: null, ghost: null };
// 拖拽幽灵：用节点真实几何（refPoints/refD），跟放下的形状一模一样
Gongfang._drawGhostSpec = function(type) {
  var map = {
    start:   { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="18"/>' },
    process: { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="3"/>' },
    sharp:   { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="0"/>' },
    text:    { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="0"/>' },
    image:   { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="2"/>' },
    circle:  { vb: '0 0 100 100', inner: '<circle cx="50" cy="50" r="50"/>' },
    io:      { vb: '0 0 100 100', inner: '<ellipse cx="50" cy="50" rx="50" ry="50"/>' },
    decision:{ vb: '0 0 100 100', inner: '<polygon points="50,0 100,50 50,100 0,50"/>' },
    prep:    { vb: '0 0 100 100', inner: '<polygon points="22,0 100,0 78,100 0,100"/>' },
    triangle:{ vb: '0 0 100 100', inner: '<polygon points="50,0 100,100 0,100"/>' },
    storage: { vb: '0 0 170 70',  inner: '<path d="M16 12 a69 9 0 0 1 138 0 v46 a69 9 0 0 1 -138 0 z"/>' },
    note:    { vb: '0 0 170 90',  inner: '<rect x="0" y="0" width="170" height="90" rx="6" stroke-dasharray="4 3"/><path d="M0 0 L22 0 L22 22 Z" fill="#111827"/>' },
    document:{ vb: '0 0 150 100', inner: '<path d="M0 0 L78 0 L100 22 L100 100 L0 100 Z"/>' },
    folder:  { vb: '0 0 160 100', inner: '<path d="M0 0 L14 0 L20 12 L100 12 L100 100 L0 100 Z"/>' },
  };
  return map[type] || { vb: '0 0 100 100', inner: '<rect x="0" y="0" width="100" height="100" rx="3"/>' };
};
Gongfang._drawStartPaletteDrag = function(e, type, text) {
  var graph = Gongfang._drawState.graph; if (!graph) return;
  Gongfang._drawPaletteDrag = { active: true, type: type, text: text || '', ghost: null };
  var specs = Gongfang._drawNodeSpec(type);
  var w = specs.w, h = specs.h;
  // ★ 拖拽预览用节点真实几何，跟放下的形状一模一样
  var spec = Gongfang._drawGhostSpec(type);
  var g = document.createElement('div');
  g.className = 'dw-drag-ghost dw-drag-shape';
  g.style.width = w + 'px';
  g.style.height = h + 'px';
  g.innerHTML = '<svg viewBox="' + spec.vb + '" preserveAspectRatio="none" width="' + w + '" height="' + h + '" fill="#ffffff" stroke="#111827" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.75">' + spec.inner + '</svg>';
  g.style.left = (e.clientX - w / 2) + 'px';
  g.style.top = (e.clientY - h / 2) + 'px';
  document.body.appendChild(g);
  Gongfang._drawPaletteDrag.ghost = g;
  document.addEventListener('pointermove', Gongfang._drawPaletteDragMove, true);
  document.addEventListener('pointerup', Gongfang._drawPaletteDragUp, true);
  document.addEventListener('pointercancel', Gongfang._drawPaletteDragUp, true);
};
Gongfang._drawPaletteDragMove = function(e) {
  if (!Gongfang._drawPaletteDrag.active) return;
  var d = Gongfang._drawPaletteDrag;
  var g = d.ghost;
  if (g) {
    var specs = Gongfang._drawNodeSpec(d.type);
    g.style.left = (e.clientX - (specs.w / 2 || 0)) + 'px';
    g.style.top = (e.clientY - (specs.h / 2 || 0)) + 'px';
  }
};
Gongfang._drawPaletteDragUp = function(e) {
  if (!Gongfang._drawPaletteDrag.active) return;
  var d = Gongfang._drawPaletteDrag;
  Gongfang._drawPaletteDrag = { active: false, type: null, text: null, ghost: null };
  document.removeEventListener('pointermove', Gongfang._drawPaletteDragMove, true);
  document.removeEventListener('pointerup', Gongfang._drawPaletteDragUp, true);
  document.removeEventListener('pointercancel', Gongfang._drawPaletteDragUp, true);
  if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
  var graph = Gongfang._drawState.graph; if (!graph) return;
  var cvs = Gongfang._drawE('dwCanvas');
  if (!cvs) return;
  var vr = cvs.getBoundingClientRect();
  if (e.clientX < vr.left || e.clientX > vr.right || e.clientY < vr.top || e.clientY > vr.bottom) return;
  var p = graph.clientToLocal(e.clientX, e.clientY);
  try {
    // 从图例拖出的节点：默认中性（透明填充+黑边+直角），但全局颜色能覆盖
    var specs = Gongfang._drawNodeSpec(d.type);
    var labAttr = { text: d.text || '' };
    if (!d.text) labAttr.display = 'none';   // ★ 空文字节点不渲染那条短的横线
    var node = graph.addNode({
      id: 'n_' + Math.random().toString(36).slice(2, 9),
      shape: d.type,
      position: { x: p.x - (specs.w / 2 || 0), y: p.y - (specs.h / 2 || 0) },
      attrs: { label: labAttr },
      data: { properties: { paletteNode: true, radius: 0 } },
    });
    if (node) { Gongfang._drawApplyNodeCell(node); Gongfang._drawUpdateStats(); if (Gongfang._showToast) Gongfang._showToast('已添加 ' + (d.text || d.type)); }
  } catch(err) { if (Gongfang._showToast) Gongfang._showToast('添加节点失败'); }
};
// 节点默认尺寸（图例落点居中用）
Gongfang._drawNodeSpec = function(type) {
  var map = {
    start: [150, 56], process: [190, 60], sharp: [170, 60], decision: [130, 96], io: [170, 56],
    circle: [110, 110], prep: [170, 60], triangle: [100, 92], storage: [170, 70], note: [170, 90],
    text: [150, 30], document: [150, 100], folder: [160, 100], image: [200, 150],
  };
  var s = map[type] || [150, 60];
  return { w: s[0], h: s[1] };
};

// ★ 主题功能已移除（图例不再提供主题切换，拖入节点保持中性颜色）

// ═══════════════════ 参数设置 ═══════════════════
Gongfang._drawSetEditMode = function(mode) {
  Gongfang._drawState.editMode = mode === 'local' ? 'local' : 'global';
  var host = Gongfang._drawE('writeModeDraw');
  if (host) host.querySelectorAll('#dwModeToggle button').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-mode') === Gongfang._drawState.editMode); });
};
Gongfang._drawEditTarget = function() {
  if (Gongfang._drawState.editMode !== 'local') return null;
  var graph = Gongfang._drawState.graph, node = null;
  if (graph) {
    try {
      var sel = graph.getSelectedCells();
      if (sel && sel.length) { for (var i = 0; i < sel.length; i++) { if (sel[i] && sel[i].isNode && sel[i].isNode()) { node = sel[i]; break; } } }
    } catch(e) {}
    if (!node && Gongfang._drawState.lastNode) node = Gongfang._drawModelOf(Gongfang._drawState.lastNode);
  }
  if (!node && Gongfang._showToast) Gongfang._showToast('局部模式：请先点击选中一个节点');
  return node;
};
Gongfang._drawApplyColorLocal = function(color) {
  var node = Gongfang._drawEditTarget();
  if (!node) return false;
  try {
    Gongfang._drawSetProps(node, { fill: Gongfang._drawTint(color), stroke: color });
    Gongfang._drawApplyNodeCell(node);
    return true;
  } catch(e) { return false; }
};
// 选中某个色圈 → 按当前颜色目标应用
Gongfang._drawSelectColorSlot = function(index) {
  var cols = Gongfang._drawState.colors;
  index = Math.max(0, Math.min(cols.slots.length - 1, parseInt(index, 10) || 0));
  cols.active = index;
  Gongfang._drawApplyTargetColor(cols.slots[index]);
  Gongfang._drawRefreshSettings();
  Gongfang._drawSaveColorState();
};
// 把颜色应用到选中的节点（不弹提示）
Gongfang._drawColorApplyLocalValue = function(color) {
  var node = Gongfang._drawState.lastNode ? Gongfang._drawModelOf(Gongfang._drawState.lastNode) : null;
  if (!node && Gongfang._drawState.editMode === 'local') node = Gongfang._drawEditTarget();
  if (!node) { if (Gongfang._showToast) Gongfang._showToast('请先点击选中一个节点'); return; }
  try {
    Gongfang._drawSetProps(node, { fill: Gongfang._drawTint(color), stroke: color });
    Gongfang._drawApplyNodeCell(node);
  } catch(e) {}
};
Gongfang._drawApplyColor = function(index) { Gongfang._drawSelectColorSlot(index); };

// 色圈自定义颜色持久化（下次打开还在）
Gongfang._drawLoadColorState = function() {
  try {
    var raw = localStorage.getItem('gongfangDrawColors');
    if (raw) {
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.slots) && d.slots.length >= 4) {
        var slots = d.slots.map(function(c) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : c; });
        Gongfang._drawState.colors.slots = slots;
        Gongfang._drawState.colors.active = Math.min(Math.max(0, parseInt(d.active, 10) || 0), slots.length - 1);
      }
    }
  } catch(e) {}
};
Gongfang._drawSaveColorState = function() {
  try {
    localStorage.setItem('gongfangDrawColors', JSON.stringify({ slots: Gongfang._drawState.colors.slots, active: Gongfang._drawState.colors.active }));
  } catch(e) {}
};
Gongfang._drawOpenColorWheel = function(trigger) {
  var t = Gongfang._drawState.colorTarget || 'fill';
  var labels = { fill: '填充颜色', border: '边框颜色', text: '文字颜色', line: '线条颜色', all: '全部颜色' };
  Gongfang._drawColorPopup(trigger, {
    title: labels[t] || '颜色',
    initial: Gongfang._drawTargetColor(t) || '#4f46e5',
    onLive: Gongfang._drawColorLiveApply,
    onApply: Gongfang._drawApplyColorValue,
    onDot: function(idx) { Gongfang._drawSelectColorSlot(idx); }
  });
};
Gongfang._drawTextColor = function(trigger) {
  Gongfang._drawState.colorTarget = 'text';
  Gongfang._drawOpenColorWheel(trigger);
};

// 自定义调色盘：上方色块（饱和度/明度）点选 + 下方色相滑条，所见即所得
Gongfang._drawColorPopup = function(trigger, opts) {
  Gongfang._drawCloseColorPopup();
  opts = opts || {};
  var anchor = (trigger && trigger.getBoundingClientRect) ? trigger.getBoundingClientRect() : (opts.position ? { left: opts.position.x, top: opts.position.y, width: 0, height: 0 } : null);
  if (!anchor) return;
  var d = document.createElement('div');
  d.id = 'dwColorPopup'; d.className = 'dw-color-pop';
  var cols = Gongfang._drawState.colors;
  var cur = opts.initial || cols.slots[cols.active] || '#4f46e5';
  var dots = Gongfang._drawState.colors.slots.map(function(c, i) {
    var active = i === cols.active ? ' active' : '';
    return '<button class="dw-color-pop-dot' + active + '" data-color-index="' + i + '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
  }).join('');
  d.innerHTML = '<div class="dw-color-pop-head"><span class="dw-color-pop-title">' + Gongfang._drawEsc(opts.title || '颜色') + '</span>' +
    '<button class="dw-color-pop-close" onclick="Gongfang._drawCloseColorPopup()">✕</button></div>' +
    '<div class="dw-color-pop-sv" id="dwColorPopSV"><div class="dw-color-pop-sv-marker" id="dwColorPopSVDot"></div></div>' +
    '<div class="dw-color-pop-hue" id="dwColorPopHue"><div class="dw-color-pop-hue-marker" id="dwColorPopHueDot"></div></div>' +
    '<div class="dw-color-pop-current"><span class="dw-color-pop-current-label">当前颜色</span>' +
      '<span class="dw-color-pop-swatch" id="dwColorPopSwatch"></span>' +
      '<input class="dw-color-pop-hex" id="dwColorPopupHex" value="' + cur + '" maxlength="7" spellcheck="false"></div>' +
    '<div class="dw-color-pop-grid">' + dots + '</div>' +
    '<div class="dw-color-pop-foot"><button class="dw-btn" onclick="Gongfang._drawCloseColorPopup()">取消</button>' +
      '<button class="dw-btn dw-btn-primary" id="dwColorPopupOk">应用</button></div>';
  d.style.left = Math.max(4, Math.min(anchor.left, window.innerWidth - 250)) + 'px';
  d.style.top = Math.max(4, Math.min(anchor.top + anchor.height + 6, window.innerHeight - 380)) + 'px';
  document.body.appendChild(d);

  var svEl = d.querySelector('#dwColorPopSV');
  var svDot = d.querySelector('#dwColorPopSVDot');
  var hueEl = d.querySelector('#dwColorPopHue');
  var hueDot = d.querySelector('#dwColorPopHueDot');
  var hexInput = d.querySelector('#dwColorPopupHex');
  var swatch = d.querySelector('#dwColorPopSwatch');
  var rgb0 = Gongfang._drawHexToRgb(cur);
  var hsv0 = Gongfang._drawRgbToHsv(rgb0[0], rgb0[1], rgb0[2]);
  var pos = { h: hsv0[0], s: hsv0[1], v: hsv0[2] };

  var update = function() {
    var rgb = Gongfang._drawHsvToRgb(pos.h, pos.s, pos.v);
    var hex = Gongfang._drawRgbToHex(rgb[0], rgb[1], rgb[2]);
    hexInput.value = hex;
    swatch.style.background = hex;
    svEl.style.background = 'linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,hsl(' + Math.round(pos.h) + ',100%,50%))';
    svDot.style.left = (pos.s * 100) + '%';
    svDot.style.top = ((1 - pos.v) * 100) + '%';
    hueDot.style.left = (pos.h / 360 * 100) + '%';
    if (opts.onLive) opts.onLive(hex);   // 拖动时实时应用
  };
  update();

  var pickSV = function(cx, cy) {
    var rr = svEl.getBoundingClientRect();
    var x = (cx - rr.left) / rr.width;
    var y = (cy - rr.top) / rr.height;
    pos.s = Math.max(0, Math.min(1, x));
    pos.v = Math.max(0, Math.min(1, 1 - y));
    update();
  };
  var pickHue = function(cx) {
    var rr = hueEl.getBoundingClientRect();
    var x = (cx - rr.left) / rr.width;
    pos.h = Math.max(0, Math.min(360, x * 360));
    update();
  };

  svEl.addEventListener('pointerdown', function(e) { e.preventDefault(); try { svEl.setPointerCapture(e.pointerId); } catch(err) {} pickSV(e.clientX, e.clientY); });
  svEl.addEventListener('pointermove', function(e) { if (e.buttons & 1) pickSV(e.clientX, e.clientY); });
  hueEl.addEventListener('pointerdown', function(e) { e.preventDefault(); try { hueEl.setPointerCapture(e.pointerId); } catch(err) {} pickHue(e.clientX); });
  hueEl.addEventListener('pointermove', function(e) { if (e.buttons & 1) pickHue(e.clientX); });

  var applyHex = function() {
    var v = (hexInput.value || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) { if (Gongfang._showToast) Gongfang._showToast('请输入 #RRGGBB'); return; }
    if (opts.onApply) opts.onApply(v);
    Gongfang._drawCloseColorPopup();
  };
  hexInput.addEventListener('input', function() {
    var v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      var rr = Gongfang._drawHexToRgb(v);
      var hh = Gongfang._drawRgbToHsv(rr[0], rr[1], rr[2]);
      pos.h = hh[0]; pos.s = hh[1]; pos.v = hh[2];
      update();
    }
  });
  hexInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } });
  d.querySelectorAll('.dw-color-pop-dot').forEach(function(dot) {
    dot.addEventListener('click', function() {
      var idx = parseInt(dot.getAttribute('data-color-index'), 10);
      if (opts.onDot && !isNaN(idx)) opts.onDot(idx);
      else if (opts.onApply) opts.onApply(dot.getAttribute('data-color'));
      Gongfang._drawCloseColorPopup();
    });
  });
  d.querySelector('#dwColorPopupOk').addEventListener('click', applyHex);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawHexToRgb = function(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return [79, 70, 229];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
Gongfang._drawRgbToHex = function(r, g, b) {
  var to = function(n) { n = Math.max(0, Math.min(255, Math.round(n))); var s = n.toString(16); return s.length === 1 ? '0' + s : s; };
  return '#' + to(r) + to(g) + to(b);
};
Gongfang._drawHsvToRgb = function(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};
Gongfang._drawRgbToHsv = function(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), dd = max - min;
  var h = 0;
  if (dd !== 0) {
    if (max === r) h = 60 * (((g - b) / dd) % 6);
    else if (max === g) h = 60 * ((b - r) / dd + 2);
    else h = 60 * ((r - g) / dd + 4);
  }
  if (h < 0) h += 360;
  var s = max === 0 ? 0 : dd / max;
  return [h, s, max];
};
Gongfang._drawCloseColorPopup = function() { var d = Gongfang._drawE('dwColorPopup'); if (d) d.remove(); };
Gongfang._drawApplyColorValue = function(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  var cols = Gongfang._drawState.colors;
  cols.slots[cols.active] = color;   // 写回当前选中的色圈
  Gongfang._drawApplyTargetColor(color);
  Gongfang._drawRefreshSettings();
  Gongfang._drawSaveColorState();
};
// 调色盘拖动时实时应用：只重渲染节点 + 同步当前色圈，不整体刷新设置面板
Gongfang._drawColorLiveApply = function(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  var t = Gongfang._drawState.colorTarget || 'fill';
  var graph = Gongfang._drawState.graph;
  if (t === 'text') { Gongfang._drawState.textColor = hex; }
  else if (t === 'border') { Gongfang._drawState.strokeColor = hex; }
  else if (t === 'line') { Gongfang._drawState.edgeColor = hex; Gongfang._drawApplyEdgeColorAll(hex); }
  else if (t === 'all') { Gongfang._drawState.fillColor = hex; Gongfang._drawState.strokeColor = hex; Gongfang._drawState.textColor = hex; Gongfang._drawState.edgeColor = hex; Gongfang._drawApplyEdgeColorAll(hex); }
  else Gongfang._drawState.fillColor = hex;
  if (graph) { try { Gongfang._drawApplyTheme(); } catch(e) {} }
  var sw = document.querySelectorAll('.dw-color-row .dw-swatch')[Gongfang._drawState.colors.active];
  if (sw) sw.style.background = hex;
};
Gongfang._drawFontStep = function(d) { Gongfang._drawSetFontSize(Math.max(6, Math.min(48, (Gongfang._drawState.fontSize || 13) + d))); };

// ── 主题/样式应用到 X6 cells ──
Gongfang._drawApplyNodeCell = function(cell) {
  if (!cell || !cell.isNode) return;
  var st = Gongfang._drawState;
  var props = Gongfang._drawProps(cell);
  var type = cell.shape || 'process';
  var nc = Gongfang._drawNodeColors(type, cell);   // [themeFill, themeStroke]
  var tf = Gongfang._drawTransparentFill();
  // 优先级：节点自带 properties.fill > 全局 > 主题
  var fill;
  if (props.fill !== undefined) fill = (props.fill === 'none' || props.fill === tf) ? tf : props.fill;
  else fill = nc[0];
  var stroke = props.stroke || nc[1];
  var strokeWidth = (props.strokeWidth !== undefined) ? props.strokeWidth : st.borderWidth;
  var isGeom = ['decision', 'prep', 'triangle', 'io', 'circle'].indexOf(type) !== -1;
  var rx;
  if (type === 'sharp') rx = 0;   // 直角形状固定直角
  else if (!st.radiusOverridden && props.radius !== undefined) rx = props.radius;   // 未被滑条接管时尊重节点自带圆角（右键菜单/图例直角）
  else if (isGeom || st.nodeStyle === 'sharp') rx = 0;
  else rx = st.nodeRadius !== undefined ? st.nodeRadius : 8;
  var dash = (props.strokeDasharray !== undefined) ? props.strokeDasharray : Gongfang._drawNodeDash();
  var th = Gongfang._drawThemes[st.theme] || Gongfang._drawThemes.classic;
  var textColor = props.textColor || st.textColor || th.text || '#1f2937';
  // ★ 修正居左/居右反向：原实现锚点固定在节点水平中心（refX 0.5），'start'/'end' 会让文字往相反方向偏。
  //   正确做法：左 → 锚点贴左缘(start, refX=6px)；右 → 锚点贴右缘(end, refX=宽-6px)；中 → 中心(middle, refX 0.5)
  var _dsize; try { _dsize = cell.getSize(); } catch(e) {}
  var _dbw = (_dsize && _dsize.width) || 150;
  var _dpad = 6;
  var textAnchor, refX;
  if (st.textAlign === 'left') { textAnchor = 'start'; refX = _dpad; }
  else if (st.textAlign === 'right') { textAnchor = 'end'; refX = _dbw - _dpad; }
  else { textAnchor = 'middle'; refX = 0.5; }

  if (type === 'image') {
    // 图片：body 是占位/由 propHooks 决定，不随主题着色；只同步文字样式
  } else {
    cell.attr('body/fill', fill);
    cell.attr('body/stroke', stroke);
    cell.attr('body/strokeWidth', strokeWidth);
    cell.attr('body/fillOpacity', st.fillOpacity === undefined ? 1 : st.fillOpacity);
    cell.attr('body/strokeDasharray', dash || 'none');
    try { cell.attr('body/rx', rx); } catch(e) {}   // 椭圆/圆/多边形无 rx，忽略
    if (type === 'text') {
      // 文本形状：body 永远透明（可点击），只由 label 承载文字
      cell.attr('body/fill', 'none');
      cell.attr('body/stroke', 'none');
      cell.attr('body/strokeDasharray', 'none');
    }
    if (type === 'note') { try { cell.attr('fold/fill', stroke); } catch(e) {} }
    if (type === 'storage') { try { cell.attr('top/fill', fill); cell.attr('top/stroke', stroke); } catch(e) {} }
  }
  // label 样式
  cell.attr('label/fill', textColor);
  cell.attr('label/fontSize', st.fontSize || 13);
  cell.attr('label/fontWeight', st.fontWeight || 'normal');
  cell.attr('label/fontStyle', st.fontStyle || 'normal');
  cell.attr('label/textDecoration', st.underline ? 'underline' : 'none');
  cell.attr('label/fontFamily', st.fontFamily || 'SimSun');
  cell.attr('label/textAnchor', textAnchor);
  cell.attr('label/refX', refX);
  // ★ 换行宽度同步应用：节点宽 -12px，超宽自动换行；缩放时随 node:change:size 重算
  cell.attr('label/textWrap', { width: -12, ellipsis: false });
  cell.attr('label/style', { cursor: 'text' });
  // 端口命中圆保持隐形（stroke:none 不被覆盖，避免出现蓝色圆形外框）
};
Gongfang._drawApplyEdgeCell = function(cell) {
  if (!cell || !cell.isEdge) return;
  var st = Gongfang._drawState;
  var props = Gongfang._drawProps(cell);
  var ec = props.stroke || props.strokeColor || Gongfang._drawEdgeColor();
  cell.attr('line/stroke', ec);
  cell.attr('line/strokeWidth', (props.strokeWidth !== undefined) ? props.strokeWidth : (st.edgeWidth || 1.6));
  // ★ 连线虚线：edgeDash>0 时使用虚线样式
  var ed = (props.strokeDasharray !== undefined) ? props.strokeDasharray : (parseFloat(st.edgeDash) || 0);
  cell.attr('line/strokeDasharray', ed > 0 ? (ed + ' ' + ed) : 'none');
  var mks = Gongfang._drawArrowMarkers();
  if (mks.target) mks.target = Object.assign({}, mks.target, { fill: ec });
  if (mks.source) mks.source = Object.assign({}, mks.source, { fill: ec });
  cell.attr('line/targetMarker', mks.target);
  cell.attr('line/sourceMarker', mks.source);
};
Gongfang._drawApplyTheme = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    // ★ 性能优化：每个节点/连线的多次 attr 修改合并成一次渲染（消除参数面板「慢半拍/首开卡顿」）
    graph.getNodes().forEach(function(c) {
      if (c.startBatch) {
        c.startBatch('draw-theme');
        try { Gongfang._drawApplyNodeCell(c); } finally { c.stopBatch('draw-theme'); }
      } else Gongfang._drawApplyNodeCell(c);
    });
    graph.getEdges().forEach(function(c) {
      if (c.startBatch) {
        c.startBatch('draw-theme');
        try { Gongfang._drawApplyEdgeCell(c); } finally { c.stopBatch('draw-theme'); }
      } else Gongfang._drawApplyEdgeCell(c);
    });
  } catch(e) {}
  if (!Gongfang._drawSuppressSettings) Gongfang._drawRefreshSettings();
};
Gongfang._drawRerenderNodes = function() { Gongfang._drawApplyTheme(); };
// 每次重渲染后把连线刷成指定颜色（全局 edgeColor 或每条线自己的颜色）
Gongfang._drawApplyEdgeVisual = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try { graph.getEdges().forEach(function(c) { Gongfang._drawApplyEdgeCell(c); }); } catch(e) {}
};
Gongfang._drawOptRow = function(label, group, opts, defVal) {
  var btns = opts.map(function(o) {
    return '<button class="dw-opt' + (o[0] === defVal ? ' active' : '') + '" data-group="' + group + '" data-val="' + o[0] + '" onclick="Gongfang._drawSetOpt(this)">' + o[1] + '</button>';
  }).join('');
  return '<div class="dw-setting-row"><span class="dw-setting-label">' + label + '</span><div class="dw-opt-group">' + btns + '</div></div>';
};
Gongfang._drawSliderRow = function(label, group, min, max, step, val, unit) {
  return '<div class="dw-setting-row"><span class="dw-setting-label">' + label + '</span>' +
    '<div class="dw-slider-wrap"><input type="range" class="dw-slider" data-group="' + group + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="dw-slider-val">' + val + (unit || '') + '</span></div></div>';
};
Gongfang._drawColorRow = function() {
  var s = Gongfang._drawState, cols = s.colors, t = s.colorTarget || 'fill';
  var targetBtns = [['fill', '填充'], ['border', '边框'], ['text', '文字'], ['line', '线条'], ['all', '全部']].map(function(o) {
    return '<button class="dw-ctarget' + (t === o[0] ? ' active' : '') + '" data-ctarget="' + o[0] + '" onclick="Gongfang._drawSetColorTarget(\'' + o[0] + '\')">' + o[1] + '</button>';
  }).join('');
  var list = cols.slots;
  var sw = '';
  if (t === 'fill') {
    // 填充目标：最前面加「透明」选项，最后一个颜色让位
    var tf = Gongfang._drawTransparentFill();
    var noneActive = Gongfang._drawState.fillColor === 'none' || Gongfang._drawState.fillColor === tf;
    sw += '<button class="dw-swatch dw-swatch-none' + (noneActive ? ' active' : '') + '" onclick="Gongfang._drawSetFillNone()" title="透明（无填充）"></button>';
    list = cols.slots.slice(0, cols.slots.length - 1);
  }
  sw += list.map(function(c, i) {
    var active = i === cols.active ? ' active' : '';
    return '<button class="dw-swatch' + active + '" data-color-index="' + i + '" style="background:' + c + '" title="点击使用 ' + c + '；再用右侧调色盘修改这个色" onclick="Gongfang._drawSelectColorSlot(' + i + ')"></button>';
  }).join('');
  return '<div class="dw-color-target">' + targetBtns + '</div>' +
    '<div class="dw-color-row">' + sw +
    '<button class="dw-color-add" title="调色盘：修改当前颜色" onclick="Gongfang._drawOpenColorWheel(this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg></button>' +
    '</div>';
};
// 填充 → 透明（无填充）
Gongfang._drawSetFillNone = function() {
  Gongfang._drawState.fillColor = Gongfang._drawTransparentFill();
  Gongfang._drawApplyTheme();
  Gongfang._drawRefreshSettings();
  Gongfang._drawSaveColorState();
};
Gongfang._drawSetColorTarget = function(mode) {
  if (['fill', 'border', 'text', 'line', 'all'].indexOf(mode) < 0) mode = 'fill';
  Gongfang._drawState.colorTarget = mode;
  Gongfang._drawRefreshSettings();
};
// 把某个颜色应用到当前颜色目标（填充/边框/文字/线条/全部）
Gongfang._drawApplyTargetColor = function(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  var t = Gongfang._drawState.colorTarget || 'fill';
  if (t === 'text') { Gongfang._drawState.textColor = color; Gongfang._drawApplyTheme(); return; }
  if (t === 'border') { Gongfang._drawState.strokeColor = color; Gongfang._drawApplyTheme(); return; }
  if (t === 'line') { Gongfang._drawState.edgeColor = color; Gongfang._drawApplyEdgeColorAll(color); return; }
  if (t === 'all') { Gongfang._drawState.fillColor = color; Gongfang._drawState.strokeColor = color; Gongfang._drawState.textColor = color; Gongfang._drawState.edgeColor = color; Gongfang._drawApplyEdgeColorAll(color); Gongfang._drawApplyTheme(); return; }
  Gongfang._drawState.fillColor = color; Gongfang._drawApplyTheme();
};
// 把所有连线颜色设成指定颜色（定向修改连线）
Gongfang._drawApplyEdgeColorAll = function(color) {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    graph.getEdges().forEach(function(edge) {
      Gongfang._drawSetProps(edge, { stroke: color, strokeColor: color });
      Gongfang._drawApplyEdgeCell(edge);
    });
  } catch(e) {}
};
// 当前颜色目标显示的颜色
Gongfang._drawTargetColor = function(t) {
  t = t || Gongfang._drawState.colorTarget || 'fill';
  if (t === 'text') return Gongfang._drawState.textColor || '#1f2937';
  if (t === 'border') return Gongfang._drawState.strokeColor || null;
  if (t === 'line') return Gongfang._drawState.edgeColor || '#111827';
  var fc = Gongfang._drawState.fillColor;
  var tf = Gongfang._drawTransparentFill();
  return (fc && fc !== 'none' && fc !== tf) ? fc : null;
};
Gongfang._drawSectionTitle = function(t) { return '<div class="dw-sec-title">' + t + '</div>'; };
// 字体选择（宋体/黑体/楷体/仿宋/新罗马/Arial）
Gongfang._drawFontSelect = function() {
  var cur = Gongfang._drawState.fontFamily || 'SimSun';
  var opts = [['SimSun', '宋体'], ['SimHei', '黑体'], ['KaiTi', '楷体'], ['FangSong', '仿宋'], ['Times New Roman', '新罗马（Times）'], ['Arial', 'Arial']];
  var options = opts.map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  return '<div class="dw-setting-row"><span class="dw-setting-label">字体</span>' +
    '<select class="dw-font-select" onchange="Gongfang._drawSetFontFamily(this.value)">' + options + '</select></div>';
};
Gongfang._drawSetFontFamily = function(family) {
  Gongfang._drawState.fontFamily = family || 'SimSun';
  Gongfang._drawApplyTheme();
};
// 字号：前 A− 后 A＋（数字在中间）
Gongfang._drawFontSizeRow = function() {
  var v = Gongfang._drawState.fontSize || 13;
  return '<div class="dw-setting-row"><span class="dw-setting-label">字号</span>' +
    '<div class="dw-font-size-row">' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawFontStep(-1)" title="减小字号">A−</button>' +
      '<span class="dw-font-size-val">' + v + '</span>' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawFontStep(1)" title="增大字号">A＋</button>' +
    '</div></div>';
};
// 格式：加粗 / 斜体 / 下划线 图标按钮（独立开关）
Gongfang._drawTextTools = function() {
  var s = Gongfang._drawState;
  var b = s.fontWeight === 'bold', i = s.fontStyle === 'italic', u = !!s.underline;
  var mk = function(label, active, title, fn) {
    return '<button class="dw-text-tool' + (active ? ' active' : '') + '" onclick="' + fn + '" title="' + title + '">' + label + '</button>';
  };
  return '<div class="dw-setting-row"><span class="dw-setting-label">格式</span>' +
    '<div class="dw-text-tools">' +
      mk('B', b, '加粗', 'Gongfang._drawToggleTextStyle(\'bold\')') +
      mk('I', i, '斜体', 'Gongfang._drawToggleTextStyle(\'italic\')') +
      mk('U', u, '下划线', 'Gongfang._drawToggleTextStyle(\'underline\')') +
    '</div></div>';
};
Gongfang._drawToggleTextStyle = function(which) {
  var s = Gongfang._drawState;
  if (which === 'bold') s.fontWeight = s.fontWeight === 'bold' ? 'normal' : 'bold';
  else if (which === 'italic') s.fontStyle = s.fontStyle === 'italic' ? 'normal' : 'italic';
  else if (which === 'underline') s.underline = !s.underline;
  Gongfang._drawApplyTheme();
};
Gongfang._drawRenderSettings = function() {
  var s = Gongfang._drawState;
  var gs = typeof s.gridSize === 'number' ? s.gridSize : 20;
  var html = '';
  // ★ 颜色 + 文本(字体+字号同一行) + 格式 + 对齐（无「基础属性」大标题）
  html += Gongfang._drawSectionTitle('颜色');
  html += Gongfang._drawColorRow();
  html += Gongfang._drawSectionTitle('文本');
  html += Gongfang._drawFontRow();          // 字体选择在前 + 字号调整在后，同一行
  html += Gongfang._drawTextTools();        // 加粗 / 斜体 / 下划线
  html += Gongfang._drawOptRow('对齐', 'textalign', [['left', '左'], ['center', '居中'], ['right', '右']], s.textAlign || 'center');
  // ★ 节点
  html += Gongfang._drawSectionTitle('节点');
  html += Gongfang._drawSliderRow('边框粗细', 'borderwidth', 0.6, 3, 0.2, s.borderWidth || 1.4);
  html += Gongfang._drawSliderRow('边框圆角', 'noderadius', 0, 40, 1, s.nodeRadius || 8);
  html += Gongfang._drawSliderRow('边框虚线', 'dash', 0, 12, 1, s.dash || 0);
  html += Gongfang._drawSliderRow('填充浓度', 'fillopacity', 0, 1, 0.1, s.fillOpacity === undefined ? 0.5 : s.fillOpacity);
  // ★ 连线
  html += Gongfang._drawSectionTitle('连线');
  html += Gongfang._drawOptRow('连线类型', 'edge', [['polyline', '折线'], ['bezier', '曲线']], s.edgeType || 'polyline');
  html += Gongfang._drawSliderRow('连线粗细', 'edgewidth', 0.8, 3, 0.2, s.edgeWidth || 1.6);
  html += Gongfang._drawSliderRow('连线虚线', 'edgedash', 0, 12, 1, s.edgeDash || 0);
  html += Gongfang._drawOptRow('连线箭头', 'arrow', [['none', '无箭头'], ['arrow', '单向箭头'], ['both', '双向箭头']], s.arrow || 'arrow');
  // ★ 画布（吸附始终开启，不再提供开关）
  html += Gongfang._drawSectionTitle('画布');
  html += Gongfang._drawOptRow('网格', 'grid', [['show', '显示'], ['hide', '隐藏']], s.gridVisible ? 'show' : 'hide');
  html += Gongfang._drawSliderRow('网格大小', 'gridsize', 8, 40, 2, gs);
  return html;
};
// ★ 字体 + 字号：同一行展示（字体下拉 + 字号减/显示/加）
Gongfang._drawFontRow = function() {
  var s = Gongfang._drawState;
  var cur = s.fontFamily || 'SimSun';
  var v = s.fontSize || 13;
  var opts = [['SimSun', '宋体'], ['SimHei', '黑体'], ['KaiTi', '楷体'], ['FangSong', '仿宋'], ['Times New Roman', 'Times New Roman'], ['Arial', 'Arial']];
  var options = opts.map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  // ★ 文本：字体选择在前、字号调整在后，同一行（小标题「文本」由 _drawRenderSettings 输出）
  return '<div class="dw-setting-row dw-font-row-wrap">' +
      '<select class="dw-font-select" onchange="Gongfang._drawSetFontFamily(this.value)">' + options + '</select>' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawFontStep(-1)" title="减小字号">A−</button>' +
      '<span class="dw-font-size-val">' + v + '</span>' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawFontStep(1)" title="增大字号">A＋</button>' +
    '</div>';
};
Gongfang._drawBindSettings = function() {
  var body = Gongfang._drawE('dwSettingsBody');
  if (!body) return;
  body.querySelectorAll('.dw-slider').forEach(function(sl) {
    if (sl.__dwBound) return;
    sl.__dwBound = true;
    sl.addEventListener('input', function() {
      // 拖动过程中不重建设置面板，保证滑条顺滑
      Gongfang._drawSuppressSettings = true;
      try {
        var g = sl.getAttribute('data-group'), v = parseFloat(sl.value);
        var wrap = sl.closest ? sl.closest('.dw-slider-wrap') : null;
        if (wrap) { var vv = wrap.querySelector('.dw-slider-val'); if (vv) vv.textContent = sl.value; }
        if (g === 'edgewidth') Gongfang._drawSetEdgeWidth(v);
        else if (g === 'edgedash') Gongfang._drawSetEdgeDash(v);
        else if (g === 'borderwidth') Gongfang._drawSetBorderWidth(v);
        else if (g === 'fontsize') Gongfang._drawSetFontSize(v);
        else if (g === 'noderadius') Gongfang._drawSetNodeRadius(v);
        else if (g === 'fillopacity') Gongfang._drawSetFillOpacity(v);
        else if (g === 'gridsize') Gongfang._drawSetGridSize(v);
        else if (g === 'dash') Gongfang._drawSetDash(v);
      } finally { Gongfang._drawSuppressSettings = false; }
    });
  });
};
Gongfang._drawSetOpt = function(btn) {
  var group = btn.getAttribute('data-group'), val = btn.getAttribute('data-val');
  var host = Gongfang._drawE('writeModeDraw');
  if (host) host.querySelectorAll('.dw-opt[data-group="' + group + '"]').forEach(function(b) { b.classList.toggle('active', b === btn); });
  if (group === 'edge') Gongfang._drawSetEdgeType(val);
  else if (group === 'arrow') Gongfang._drawSetArrow(val);
  else if (group === 'nodestyle') {
    if (Gongfang._drawState.editMode === 'local') {
      var node = Gongfang._drawEditTarget();
      if (node) { Gongfang._drawApplyNodeStyleLocal(node, val); return; }
      if (host) host.querySelectorAll('.dw-opt[data-group="nodestyle"]').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-val') === Gongfang._drawState.nodeStyle); });
      return;
    }
    Gongfang._drawState.nodeStyle = val; Gongfang._drawApplyTheme();
  }
  else if (group === 'fontweight') { Gongfang._drawState.fontWeight = val; Gongfang._drawApplyTheme(); }
  else if (group === 'fontstyle') { Gongfang._drawState.fontStyle = val; Gongfang._drawApplyTheme(); }
  else if (group === 'underline') { Gongfang._drawState.underline = val === 'on'; Gongfang._drawApplyTheme(); }
  else if (group === 'textalign') { Gongfang._drawState.textAlign = val; Gongfang._drawApplyTheme(); }
  else if (group === 'grid') Gongfang._drawSetGrid(val === 'show');
  else if (group === 'snap') Gongfang._drawSetSnap(val === 'on');
};
Gongfang._drawApplyNodeStyleLocal = function(node, style) {
  var graph = Gongfang._drawState.graph;
  try {
    var isGeom = ['decision', 'prep', 'triangle', 'io', 'circle'].indexOf(node.shape) !== -1;
    Gongfang._drawSetProps(node, {
      fill: style === 'transparent' ? 'none' : Gongfang._drawNodeFill(),
      strokeDasharray: style === 'dashed' ? '6 4' : '',
      radius: style === 'sharp' ? 0 : (isGeom ? 0 : (Gongfang._drawState.nodeRadius || 8)),
    });
    Gongfang._drawApplyNodeCell(node);
    if (graph) graph.trigger('selection:changed', { added: [], removed: [] });
    if (Gongfang._showToast) Gongfang._showToast('已应用到选中节点');
  } catch(e) {}
};
Gongfang._drawSetEdgeType = function(t) {
  Gongfang._drawState.edgeType = t;
  // 全局线型应用到所有连线（含右键菜单单条改过的），切完立刻看得见
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    var rc = Gongfang._drawEdgeRouterConnector(t);
    graph.getEdges().forEach(function(edge) {
      edge.setRouter(rc.router, {});
      edge.setConnector(rc.connector, {});
    });
  } catch(e) {}
};
Gongfang._drawSetEdgeWidth = function(v) { Gongfang._drawState.edgeWidth = v; Gongfang._drawApplyTheme(); };
Gongfang._drawSetBorderWidth = function(v) { Gongfang._drawState.borderWidth = v; Gongfang._drawApplyTheme(); };
Gongfang._drawSetDash = function(v) { Gongfang._drawState.dash = parseFloat(v) || 0; Gongfang._drawApplyTheme(); };
Gongfang._drawSetEdgeDash = function(v) { Gongfang._drawState.edgeDash = parseFloat(v) || 0; Gongfang._drawApplyTheme(); };
Gongfang._drawSetFontSize = function(v) { Gongfang._drawState.fontSize = v; Gongfang._drawApplyTheme(); };
Gongfang._drawSetNodeRadius = function(v) {
  Gongfang._drawState.nodeRadius = v;
  Gongfang._drawState.radiusOverridden = true;   // 用户动过圆角滑条 → 接管所有节点的圆角（含图例直角节点）
  Gongfang._drawApplyTheme();
};
Gongfang._drawSetFillOpacity = function(v) { Gongfang._drawState.fillOpacity = v; Gongfang._drawApplyTheme(); };
Gongfang._drawSetGridSize = function(v) {
  Gongfang._drawState.gridSize = parseFloat(v);
  var graph = Gongfang._drawState.graph; if (!graph) return;
  try {
    graph.setGridSize(Gongfang._drawState.gridSize);
    graph.drawGrid({ size: Gongfang._drawState.gridSize, type: 'mesh', args: { color: '#cbd5e1', thickness: 1 } });
  } catch(e) {}
};
Gongfang._drawSetArrow = function(style) {
  Gongfang._drawState.arrow = style;
  Gongfang._drawApplyTheme();
};
Gongfang._drawSetGrid = function(show) {
  Gongfang._drawState.gridVisible = show;
  var graph = Gongfang._drawState.graph; if (!graph) return;
  try { if (show) graph.showGrid(); else graph.hideGrid(); } catch(e) {}
};
Gongfang._drawSetSnap = function(show) {
  // ★ 吸附开关：开启时节点拖动按网格取整
  Gongfang._drawState.snap = show !== false;
  var graph = Gongfang._drawState.graph; if (!graph) return;
  try { graph.setGridSize(Gongfang._drawState.gridSize || 20); } catch(e) {}
};
Gongfang._drawRefreshSettings = function() {
  var body = Gongfang._drawE('dwSettingsBody');
  if (body) { body.innerHTML = Gongfang._drawRenderSettings(); Gongfang._drawBindSettings(); }
};

// ═══════════════════ 编辑条 / 图层 ═══════════════════
Gongfang._drawShowEditBar = function(node) {
  node = Gongfang._drawModelOf(node);
  Gongfang._drawEditBarNode = node;
  var old = Gongfang._drawE('dwEditBar'); if (old) old.remove();
  if (!node) return;
  var props = Gongfang._drawProps(node);
  var fill = props.fill || node.attr('body/fill') || '#eef2ff';
  var stroke = props.stroke || node.attr('body/stroke') || '#4f46e5';
  var d = document.createElement('div');
  d.id = 'dwEditBar'; d.className = 'dw-edit-bar';
  d.innerHTML = '<span class="dw-edit-bar-title">定向编辑</span>' +
    '<label>填充<input type="color" value="' + fill + '" oninput="Gongfang._drawEditNodeColor(this.value, \'fill\')"></label>' +
    '<label>文字<input type="color" value="#1f2937" oninput="Gongfang._drawEditNodeColor(this.value, \'text\')"></label>' +
    '<label>边框<input type="color" value="' + stroke + '" oninput="Gongfang._drawEditNodeColor(this.value, \'stroke\')"></label>' +
    '<span class="dw-edit-bar-sep"></span><span class="dw-edit-bar-layer">' +
    '<button onclick="Gongfang._drawEditBarLayer(\'front\')" title="置于顶层">⤒</button>' +
    '<button onclick="Gongfang._drawEditBarLayer(\'forward\')" title="上移一层">↑</button>' +
    '<button onclick="Gongfang._drawEditBarLayer(\'backward\')" title="下移一层">↓</button>' +
    '<button onclick="Gongfang._drawEditBarLayer(\'back\')" title="置于底层">⤓</button></span>' +
    '<button class="dw-edit-bar-close" onclick="Gongfang._drawHideEditBar()">✕</button>';
  var canvas = Gongfang._drawE('dwCanvas'); if (canvas) canvas.appendChild(d);
};
Gongfang._drawHideEditBar = function() { Gongfang._drawEditBarNode = null; var d = Gongfang._drawE('dwEditBar'); if (d) d.remove(); };
Gongfang._drawEditNodeColor = function(color, kind) {
  var node = Gongfang._drawModelOf(Gongfang._drawEditBarNode);
  if (!node) return;
  try {
    if (kind === 'fill') Gongfang._drawSetProps(node, { fill: color });
    else if (kind === 'stroke') Gongfang._drawSetProps(node, { stroke: color });
    else if (kind === 'text') Gongfang._drawSetProps(node, { textColor: color });
    Gongfang._drawApplyNodeCell(node);
  } catch(e) { console.warn('[draw] edit-node:', e); }
};
Gongfang._drawEditBarLayer = function(op) { var node = Gongfang._drawModelOf(Gongfang._drawEditBarNode); if (node && node.id) Gongfang._drawLayerOp(node.id, op); };
Gongfang._drawLayerOp = function(nodeId, op) {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    var cell = graph.getCellById(nodeId);
    if (!cell) return;
    if (op === 'front') cell.toFront();
    else if (op === 'back') cell.toBack();
    else if (op === 'forward') cell.setZIndex((cell.getZIndex() || 0) + 1);
    else if (op === 'backward') cell.setZIndex(Math.max(0, (cell.getZIndex() || 0) - 1));
  } catch(err) {}
};
Gongfang._drawShowLayerMenu = function(e, nodeId) {
  Gongfang._drawCloseLayerMenu();
  var d = document.createElement('div');
  d.id = 'dwLayerMenu'; d.className = 'dw-layer-menu'; d.setAttribute('data-node', nodeId);
  d.innerHTML = '<div class="dw-layer-title">图层</div><button data-op="front">置于顶层</button><button data-op="forward">上移一层</button><button data-op="backward">下移一层</button><button data-op="back">置于底层</button>';
  d.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  d.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
  d.addEventListener('click', function(ev) { var b = ev.target.closest ? ev.target.closest('button[data-op]') : null; if (b) { Gongfang._drawLayerOp(d.getAttribute('data-node'), b.getAttribute('data-op')); Gongfang._drawCloseLayerMenu(); } });
  document.body.appendChild(d);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawCloseLayerMenu = function() { var d = Gongfang._drawE('dwLayerMenu'); if (d) d.remove(); };
// 删除指定 cell（右键菜单用）
Gongfang._drawDeleteCell = function(cellId) {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try { var cell = graph.getCellById(cellId); if (cell) cell.remove(); Gongfang._drawUpdateStats(); } catch(e) {}
};
// 复制指定 cell（右键菜单用）：先选中它再复制
Gongfang._drawCopyCell = function(cellId) {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try { graph.resetSelection([cellId]); } catch(e) {}
  Gongfang._drawCopySelection();
  if (Gongfang._showToast) Gongfang._showToast('已复制');
};
// 空白区右键菜单：只有「粘贴」
// 多选对象右键菜单：只有 删除 / 复制 / 粘贴 / 图层
Gongfang._drawShowMultiMenu = function(e, cellId) {
  Gongfang._drawCloseLayerMenu();
  var d = document.createElement('div');
  d.id = 'dwLayerMenu'; d.className = 'dw-layer-menu'; d.style.minWidth = '130px';
  d.innerHTML = '<div class="dw-layer-title">多选操作</div>' +
    '<button data-op="copy">复制</button>' +
    '<button data-op="paste">粘贴</button>' +
    '<button data-op="delete" class="dw-layer-danger">删除</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<div class="dw-layer-title">图层</div>' +
    '<button data-op="front">置于顶层</button>' +
    '<button data-op="forward">上移一层</button>' +
    '<button data-op="backward">下移一层</button>' +
    '<button data-op="back">置于底层</button>';
  d.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-op]') : null;
    if (!b) return;
    var op = b.getAttribute('data-op');
    d.remove();
    if (op === 'delete') {
      var graph = Gongfang._drawState.graph;
      if (graph) { try { graph.getSelectedCells().forEach(function(c) { c.remove(); }); Gongfang._drawUpdateStats(); } catch (err) {} }
    }
    else if (op === 'copy') Gongfang._drawCopySelection();
    else if (op === 'paste') Gongfang._drawPasteSelection();
    else if (['front', 'forward', 'backward', 'back'].indexOf(op) >= 0 && cellId) Gongfang._drawLayerOp(cellId, op);
  });
  document.body.appendChild(d);
  Gongfang._drawPositionLayerMenu(d, e.clientX, e.clientY);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawShowBlankMenu = function(e) {
  Gongfang._drawCloseLayerMenu();
  var d = document.createElement('div');
  d.id = 'dwLayerMenu'; d.className = 'dw-layer-menu'; d.style.minWidth = '120px';
  d.innerHTML = '<button data-op="paste">粘贴</button>';
  d.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-op]') : null;
    if (!b) return;
    d.remove();
    if (b.getAttribute('data-op') === 'paste') Gongfang._drawPasteSelection();
  });
  document.body.appendChild(d);
  Gongfang._drawPositionLayerMenu(d, e.clientX, e.clientY);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};

// ── 节点右键菜单：定向修改颜色 / 样式 / 图层 ──
// ★ 定位右键菜单：始终在软件窗口内显示；底部放不下则向上显示
Gongfang._drawPositionLayerMenu = function(el, x, y) {
  if (!el) return;
  try {
    var w = el.offsetWidth || 170;
    var h = el.offsetHeight || 220;
    var pad = 8;
    var left = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
    var top = y;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  } catch(e) {}
};

Gongfang._drawShowNodeMenu = function(e, nodeId) {
  Gongfang._drawCloseLayerMenu();
  var d = document.createElement('div');
  d.id = 'dwNodeMenu'; d.className = 'dw-layer-menu'; d.style.minWidth = '150px';
  d.innerHTML = '<div class="dw-layer-title">节点设置</div>' +
    '<button data-op="copy">复制</button>' +
    '<button data-op="paste">粘贴</button>' +
    '<button data-op="delete" class="dw-layer-danger">删除</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<button data-op="fill">填充颜色</button>' +
    '<button data-op="stroke">边框颜色</button>' +
    '<button data-op="textcolor">文字颜色</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<div class="dw-layer-title">样式</div>' +
    '<button data-op="style-node">节点样式</button>' +
    '<button data-op="style-edge">连线样式</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<div class="dw-layer-title">图层</div>' +
    '<button data-op="front">置于顶层</button>' +
    '<button data-op="forward">上移一层</button>' +
    '<button data-op="backward">下移一层</button>' +
    '<button data-op="back">置于底层</button>';
  d.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-op]') : null;
    if (!b) return;
    var op = b.getAttribute('data-op');
    d.remove();
    if (op === 'delete') Gongfang._drawDeleteCell(nodeId);
    else if (op === 'copy') Gongfang._drawCopyCell(nodeId);
    else if (op === 'paste') Gongfang._drawPasteSelection();
    else if (op === 'fill' || op === 'stroke' || op === 'textcolor') Gongfang._drawOpenNodeColor(e, nodeId, op === 'fill' ? 'fill' : (op === 'stroke' ? 'stroke' : 'text'));
    else if (op === 'style-node') Gongfang._drawShowStylePanel('node', nodeId, e.clientX, e.clientY);
    else if (op === 'style-edge') Gongfang._drawShowStylePanel('edge', nodeId, e.clientX, e.clientY);
    else Gongfang._drawLayerOp(nodeId, op);
  });
  document.body.appendChild(d);
  // ★ 菜单始终在软件窗口内显示（底部放不下向上显示）
  Gongfang._drawPositionLayerMenu(d, e.clientX, e.clientY);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawOpenNodeColor = function(e, nodeId, field) {
  var graph = Gongfang._drawState.graph;
  var node = graph.getCellById(nodeId);
  if (!node) return;
  var props = Gongfang._drawProps(node);
  var title = field === 'fill' ? '填充颜色' : (field === 'stroke' ? '边框颜色' : '文字颜色');
  var initial;
  if (field === 'fill') initial = props.fill || node.attr('body/fill') || '#4f46e5';
  else if (field === 'stroke') initial = props.stroke || node.attr('body/stroke') || '#4f46e5';
  else initial = props.textColor || Gongfang._drawState.textColor || '#111827';
  var apply = function(hex) {
    if (field === 'fill') Gongfang._drawSetProps(node, { fill: hex });
    else if (field === 'stroke') Gongfang._drawSetProps(node, { stroke: hex });
    else if (field === 'text') Gongfang._drawSetProps(node, { textColor: hex });
    Gongfang._drawApplyNodeCell(node);
  };
  Gongfang._drawColorPopup(null, { title: title, initial: initial, position: { x: e.clientX, y: e.clientY }, onApply: apply, onLive: apply });
};
Gongfang._drawApplyNodeStyleLocalById = function(nodeId, style) {
  var graph = Gongfang._drawState.graph;
  var node = graph.getCellById(nodeId);
  if (!node) return;
  try {
    var isGeom = ['decision', 'prep', 'triangle', 'io', 'circle'].indexOf(node.shape) !== -1;
    Gongfang._drawSetProps(node, {
      fill: style === 'transparent' ? 'none' : Gongfang._drawNodeFill(),
      strokeDasharray: style === 'dashed' ? '6 4' : '',
      radius: style === 'sharp' ? 0 : (isGeom ? 0 : (Gongfang._drawState.nodeRadius || 8)),
    });
    Gongfang._drawApplyNodeCell(node);
  } catch(e) {}
};
// ── 连线右键菜单：线条颜色 / 类型 ──
Gongfang._drawShowEdgeMenu = function(e, edgeId) {
  Gongfang._drawCloseLayerMenu();
  var d = document.createElement('div');
  d.id = 'dwEdgeMenu'; d.className = 'dw-layer-menu'; d.style.minWidth = '140px';
  d.innerHTML = '<div class="dw-layer-title">连线设置</div>' +
    '<button data-op="copy">复制</button>' +
    '<button data-op="paste">粘贴</button>' +
    '<button data-op="delete" class="dw-layer-danger">删除</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<button data-op="color">线条颜色</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<div class="dw-layer-title">类型</div>' +
    '<button data-op="line">直线</button>' +
    '<button data-op="polyline">折线</button>' +
    '<button data-op="bezier">曲线</button>' +
    '<div class="dw-layer-sep"></div>' +
    '<div class="dw-layer-title">样式</div>' +
    '<button data-op="style-edge">连线样式</button>' +
    '<button data-op="style-node">节点样式</button>';
  d.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-op]') : null;
    if (!b) return;
    var op = b.getAttribute('data-op');
    d.remove();
    if (op === 'delete') Gongfang._drawDeleteCell(edgeId);
    else if (op === 'copy') Gongfang._drawCopyCell(edgeId);
    else if (op === 'paste') Gongfang._drawPasteSelection();
    else if (op === 'color') Gongfang._drawOpenEdgeColor(e, edgeId);
    else if (op === 'style-edge') Gongfang._drawShowStylePanel('edge', edgeId, e.clientX, e.clientY);
    else if (op === 'style-node') Gongfang._drawShowStylePanel('node', edgeId, e.clientX, e.clientY);
    else Gongfang._drawSetEdgeTypeById(edgeId, op);
  });
  document.body.appendChild(d);
  // ★ 菜单始终在软件窗口内显示
  Gongfang._drawPositionLayerMenu(d, e.clientX, e.clientY);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawOpenEdgeColor = function(e, edgeId) {
  var graph = Gongfang._drawState.graph;
  var edge = graph.getCellById(edgeId);
  if (!edge) return;
  var props = Gongfang._drawProps(edge);
  var initial = props.strokeColor || props.stroke || Gongfang._drawEdgeColor();
  var apply = function(hex) {
    Gongfang._drawSetProps(edge, { stroke: hex, strokeColor: hex });
    Gongfang._drawApplyEdgeCell(edge);
  };
  Gongfang._drawColorPopup(null, { title: '线条颜色', initial: initial, position: { x: e.clientX, y: e.clientY }, onApply: apply, onLive: apply });
};
Gongfang._drawSetEdgeTypeById = function(edgeId, type) {
  var graph = Gongfang._drawState.graph;
  var edge = graph.getCellById(edgeId);
  if (!edge) return;
  try {
    Gongfang._drawSetProps(edge, { type: type });
    var rc = Gongfang._drawEdgeRouterConnector(type);
    edge.setRouter(rc.router, {});
    edge.setConnector(rc.connector, {});
  } catch(err) {}
};

// ── 样式子面板（右键菜单「样式」→ 节点 / 连线，弹出旁侧小面板，仅作用于选中对象） ──
Gongfang._drawStyleTargets = { nodes: [], edges: [] };
Gongfang._drawCloseStylePanel = function() {
  var d = Gongfang._drawE('dwStylePanel');
  if (d && d.parentNode) d.parentNode.removeChild(d);
  Gongfang._drawStyleTargets = { nodes: [], edges: [], colorMode: 'fill' };
};
Gongfang._drawPositionStylePanel = function(el, x, y) {
  try {
    var w = el.offsetWidth || 240, h = el.offsetHeight || 320, pad = 6;
    // ★ 按画布区域钳制，不覆盖右侧参数面板/图例
    var cvs = Gongfang._drawE('dwCanvas');
    var cr = cvs ? cvs.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    var left = x + 22;
    if (left + w > cr.left + cr.width - pad) left = Math.max(cr.left + pad, x - w - 22);
    var top = Math.max(cr.top + pad, Math.min(y, cr.top + cr.height - h - pad));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  } catch(e) {}
};
// 样式面板可拖动：按住标题栏拖动，限制在画布区域内
Gongfang._drawMakeStyleDraggable = function(panel) {
  if (!panel || panel.__dwDragBound) return;
  panel.__dwDragBound = true;
  var head = panel.querySelector('.dw-style-head');
  if (!head) return;
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    var startX = e.clientX, startY = e.clientY;
    var r = panel.getBoundingClientRect();
    var startLeft = r.left, startTop = r.top;
    var onMove = function(ev) {
      var left = startLeft + (ev.clientX - startX);
      var top = startTop + (ev.clientY - startY);
      try {
        var cvs = Gongfang._drawE('dwCanvas');
        var cr = cvs ? cvs.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        var pw = panel.offsetWidth, ph = panel.offsetHeight;
        left = Math.max(cr.left, Math.min(left, cr.left + cr.width - pw));
        top = Math.max(cr.top, Math.min(top, cr.top + cr.height - ph));
      } catch(err) {}
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    };
    var onUp = function() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
};
Gongfang._drawShowStylePanel = function(kind, cellId, x, y) {
  Gongfang._drawCloseStylePanel();
  var graph = Gongfang._drawState.graph;
  var cell = graph ? graph.getCellById(cellId) : null;
  if (!cell) return;
  // 解析目标：节点 → 该节点 + 其相连连线；连线 → 该连线 + 两端节点
  var nodes = [], edges = [];
  if (cell.isNode && cell.isNode()) {   // ★ isNode 是方法，不是属性；否则线条会被误判成节点
    nodes = [cell];
    edges = graph.getEdges().filter(function(e) {
      return e.getSourceNode && (e.getSourceNode().id === cell.id || (e.getTargetNode && e.getTargetNode().id === cell.id));
    });
  } else {
    edges = [cell];
    var s = cell.getSourceNode ? cell.getSourceNode() : null, tt = cell.getTargetNode ? cell.getTargetNode() : null;
    if (s) nodes.push(s); if (tt && tt !== s) nodes.push(tt);
  }
  Gongfang._drawStyleTargets = { nodes: nodes, edges: edges, colorMode: (Gongfang._drawStyleTargets && Gongfang._drawStyleTargets.colorMode) || 'fill' };
  // 无连线时给提示，避免出现点不动的控件
  if (kind === 'edge' && !edges.length) {
    var dEmpty = document.createElement('div');
    dEmpty.id = 'dwStylePanel'; dEmpty.className = 'dw-style-panel';
    dEmpty.innerHTML = '<div class="dw-style-head"><span>连线样式</span><button class="dw-style-close" onclick="Gongfang._drawCloseStylePanel()" title="关闭">✕</button></div><div class="dw-style-body"><div style="color:#a1a1aa;font-size:12px;padding:6px 0">该对象没有连线</div></div>';
    document.body.appendChild(dEmpty);
    Gongfang._drawPositionStylePanel(dEmpty, x, y);
    Gongfang._drawMakeStyleDraggable(dEmpty);
    return;
  }
  var d = document.createElement('div');
  d.id = 'dwStylePanel'; d.className = 'dw-style-panel';
  d.innerHTML = '<div class="dw-style-head"><span>' + (kind === 'node' ? '节点样式' : '连线样式') + '</span>' +
    '<button class="dw-style-close" onclick="Gongfang._drawCloseStylePanel()" title="关闭">✕</button></div>' +
    '<div class="dw-style-body">' + (kind === 'node' ? Gongfang._drawStyleNodeHtml() : Gongfang._drawStyleEdgeHtml()) + '</div>';
  document.body.appendChild(d);
  Gongfang._drawPositionStylePanel(d, x, y);
  Gongfang._drawMakeStyleDraggable(d);
  Gongfang._drawBindStylePanel();
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { Gongfang._drawCloseStylePanel(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawStyleNodeHtml = function() {
  var node = Gongfang._drawStyleTargets.nodes[0];
  var bw = node ? (Gongfang._drawProps(node).strokeWidth !== undefined ? Gongfang._drawProps(node).strokeWidth : (Gongfang._drawState.borderWidth || 1.4)) : 1.4;
  var rad = node ? (Gongfang._drawProps(node).radius !== undefined ? Gongfang._drawProps(node).radius : (Gongfang._drawState.nodeRadius || 8)) : 8;
  var dash = node ? (Gongfang._drawProps(node).strokeDasharray !== undefined && Gongfang._drawProps(node).strokeDasharray !== 'none' ? parseFloat(Gongfang._drawProps(node).strokeDasharray) || 0 : (Gongfang._drawState.dash || 0)) : 0;
  var fontFam = node ? (node.attr('label/fontFamily') || 'SimSun') : 'SimSun';
  var fontSize = node ? (parseFloat(node.attr('label/fontSize')) || 13) : 13;
  var bold = node ? node.attr('label/fontWeight') === 'bold' : false;
  var italic = node ? node.attr('label/fontStyle') === 'italic' : false;
  var uline = node ? node.attr('label/textDecoration') === 'underline' : false;
  var align = node ? (node.attr('label/textAnchor') === 'start' ? 'left' : node.attr('label/textAnchor') === 'end' ? 'right' : 'center') : 'center';
  var fillOp = node ? (Gongfang._drawProps(node).fillOpacity !== undefined ? Gongfang._drawProps(node).fillOpacity : (Gongfang._drawState.fillOpacity === undefined ? 0.5 : Gongfang._drawState.fillOpacity)) : 0.5;
  var fillHex = node ? (Gongfang._drawProps(node).fill && Gongfang._drawProps(node).fill !== 'none' ? Gongfang._drawProps(node).fill : (node.attr('body/fill') || '#4f46e5')) : '#4f46e5';
  var fontOpts = [['SimSun', '宋体'], ['SimHei', '黑体'], ['KaiTi', '楷体'], ['FangSong', '仿宋'], ['Times New Roman', 'Times New Roman'], ['Arial', 'Arial']];
  var options = fontOpts.map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === fontFam ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  var mkOpt = function(label, fn, active) {
    return '<button class="dw-opt' + (active ? ' active' : '') + '" onclick="' + fn + '">' + label + '</button>';
  };
  // 节点样式只有三种颜色：填充 / 边框 / 文字，切换按钮决定色块/调色改哪种
  var colorMode = Gongfang._drawStyleTargets.colorMode || 'fill';
  var colorHex = colorMode === 'stroke' ? ((node && (Gongfang._drawProps(node).stroke || node.attr('body/stroke'))) || '#111827')
    : colorMode === 'text' ? ((node && (Gongfang._drawProps(node).textColor || node.attr('label/fill'))) || '#111827')
    : fillHex;
  var mkMode = function(label, mode) { return '<button class="dw-opt' + (colorMode === mode ? ' active' : '') + '" onclick="Gongfang._drawStyleNodeColorMode(\'' + mode + '\')">' + label + '</button>'; };
  return '<div class="dw-sec-title">颜色</div>' +
    '<div class="dw-style-row">' + mkMode('填充', 'fill') + mkMode('边框', 'stroke') + mkMode('文字', 'text') + '</div>' +
    '<div class="dw-style-swatch-row">' + Gongfang._drawStyleSwatches('node', 'mode', colorHex) + '</div>' +
    '<div class="dw-sec-title">文本</div>' +
    '<div class="dw-setting-row dw-font-row-wrap">' +
      '<select class="dw-font-select" onchange="Gongfang._drawStyleNodeFont(this.value)">' + options + '</select>' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawStyleNodeFontStep(-1)" title="减小字号">A−</button>' +
      '<span class="dw-font-size-val">' + fontSize + '</span>' +
      '<button class="dw-btn dw-font-step" onclick="Gongfang._drawStyleNodeFontStep(1)" title="增大字号">A＋</button>' +
    '</div>' +
    '<div class="dw-setting-row"><span class="dw-setting-label">格式</span><div class="dw-text-tools">' +
      '<button class="dw-text-tool' + (bold ? ' active' : '') + '" onclick="Gongfang._drawStyleNodeTextStyle(\'bold\')" title="加粗">B</button>' +
      '<button class="dw-text-tool' + (italic ? ' active' : '') + '" onclick="Gongfang._drawStyleNodeTextStyle(\'italic\')" title="斜体">I</button>' +
      '<button class="dw-text-tool' + (uline ? ' active' : '') + '" onclick="Gongfang._drawStyleNodeTextStyle(\'underline\')" title="下划线">U</button>' +
    '</div></div>' +
    '<div class="dw-setting-row"><span class="dw-setting-label">对齐</span><div class="dw-opt-group">' +
      mkOpt('左', 'Gongfang._drawStyleNodeAlign(\'left\')', align === 'left') +
      mkOpt('居中', 'Gongfang._drawStyleNodeAlign(\'center\')', align === 'center') +
      mkOpt('右', 'Gongfang._drawStyleNodeAlign(\'right\')', align === 'right') +
    '</div></div>' +
    '<div class="dw-style-row">' +
      '<button class="dw-btn" onclick="Gongfang._drawStyleNodeStyle(\'round\')">圆角</button>' +
      '<button class="dw-btn" onclick="Gongfang._drawStyleNodeStyle(\'sharp\')">直角</button>' +
      '<button class="dw-btn" onclick="Gongfang._drawStyleNodeStyle(\'dashed\')">虚线</button>' +
      '<button class="dw-btn" onclick="Gongfang._drawStyleNodeStyle(\'transparent\')">透明</button></div>' +
    Gongfang._drawStyleSlider('node', 'strokeWidth', '边框粗细', 0.6, 3, 0.2, bw) +
    Gongfang._drawStyleSlider('node', 'radius', '边框圆角', 0, 40, 1, rad) +
    Gongfang._drawStyleSlider('node', 'dash', '边框虚线', 0, 12, 1, dash) +
    Gongfang._drawStyleSlider('node', 'fillOpacity', '填充浓度', 0, 1, 0.1, fillOp);
};
Gongfang._drawStyleNodeColorMode = function(mode) {
  if (['fill', 'stroke', 'text'].indexOf(mode) < 0) mode = 'fill';
  Gongfang._drawStyleTargets.colorMode = mode;
  var d = Gongfang._drawE('dwStylePanel');
  if (d) {
    var body = d.querySelector('.dw-style-body');
    if (body) { body.innerHTML = Gongfang._drawStyleNodeHtml(); Gongfang._drawBindStylePanel(); }
  }
};
Gongfang._drawStyleNodeFont = function(family) {
  Gongfang._drawStyleTargets.nodes.forEach(function(n) { try { n.attr('label/fontFamily', family); } catch (e) {} });
};
Gongfang._drawStyleNodeFontStep = function(d) {
  Gongfang._drawStyleTargets.nodes.forEach(function(n) {
    try { var cur = parseFloat(n.attr('label/fontSize')) || 13; n.attr('label/fontSize', Math.max(8, Math.min(48, cur + d))); } catch (e) {}
  });
};
Gongfang._drawStyleNodeTextStyle = function(which) {
  Gongfang._drawStyleTargets.nodes.forEach(function(n) {
    try {
      if (which === 'bold') n.attr('label/fontWeight', (n.attr('label/fontWeight') === 'bold' ? 'normal' : 'bold'));
      else if (which === 'italic') n.attr('label/fontStyle', (n.attr('label/fontStyle') === 'italic' ? 'normal' : 'italic'));
      else if (which === 'underline') n.attr('label/textDecoration', (n.attr('label/textDecoration') === 'underline' ? 'none' : 'underline'));
    } catch (e) {}
  });
};
Gongfang._drawStyleNodeAlign = function(align) {
  Gongfang._drawStyleTargets.nodes.forEach(function(n) {
    try {
      var w = (n.getSize && n.getSize().width) || 150;
      if (align === 'left') { n.attr('label/textAnchor', 'start'); n.attr('label/refX', 6); }
      else if (align === 'right') { n.attr('label/textAnchor', 'end'); n.attr('label/refX', w - 6); }
      else { n.attr('label/textAnchor', 'middle'); n.attr('label/refX', 0.5); }
    } catch (e) {}
  });
};
Gongfang._drawStyleEdgeHtml = function() {
  var edge = Gongfang._drawStyleTargets.edges[0];
  var ew = edge ? (Gongfang._drawProps(edge).strokeWidth !== undefined ? Gongfang._drawProps(edge).strokeWidth : (Gongfang._drawState.edgeWidth || 1.6)) : 1.6;
  var ed = edge ? (Gongfang._drawProps(edge).strokeDasharray !== undefined && Gongfang._drawProps(edge).strokeDasharray !== 'none' ? parseFloat(Gongfang._drawProps(edge).strokeDasharray) || 0 : (parseFloat(Gongfang._drawState.edgeDash) || 0)) : 0;
  var arrow = edge ? (Gongfang._drawProps(edge).arrow || Gongfang._drawState.arrow || 'arrow') : 'arrow';
  var lineHex = edge ? (Gongfang._drawProps(edge).stroke || Gongfang._drawProps(edge).strokeColor || Gongfang._drawEdgeColor()) : '#111827';
  var mkOpt = function(label, fn, active) { return '<button class="dw-opt' + (active ? ' active' : '') + '" onclick="' + fn + '">' + label + '</button>'; };
  return '<div class="dw-style-swatch-row">' + Gongfang._drawStyleSwatches('edge', 'line', lineHex) + '</div>' +
    '<div class="dw-setting-row"><span class="dw-setting-label">箭头</span><div class="dw-opt-group">' +
      mkOpt('无箭头', 'Gongfang._drawStyleEdgeArrow(\'none\')', arrow === 'none') +
      mkOpt('单向', 'Gongfang._drawStyleEdgeArrow(\'arrow\')', arrow === 'arrow') +
      mkOpt('双向', 'Gongfang._drawStyleEdgeArrow(\'both\')', arrow === 'both') +
    '</div></div>' +
    Gongfang._drawStyleSlider('edge', 'strokeWidth', '连线粗细', 0.8, 3, 0.2, ew) +
    Gongfang._drawStyleSlider('edge', 'dash', '连线虚线', 0, 12, 1, ed);
};
Gongfang._drawStyleEdgeArrow = function(val) {
  Gongfang._drawStyleTargets.edges.forEach(function(e) {
    try {
      Gongfang._drawSetProps(e, { arrow: val });
      var saved = Gongfang._drawState.arrow;
      Gongfang._drawState.arrow = val;
      var mks = Gongfang._drawArrowMarkers();
      Gongfang._drawState.arrow = saved;
      var ec = Gongfang._drawProps(e).stroke || Gongfang._drawEdgeColor();
      if (mks.target) mks.target = Object.assign({}, mks.target, { fill: ec });
      if (mks.source) mks.source = Object.assign({}, mks.source, { fill: ec });
      e.attr('line/targetMarker', mks.target);
      e.attr('line/sourceMarker', mks.source);
    } catch (err) {}
  });
};
// 样式面板颜色：预设色块 + 调色盘（复刻参数面板配色控件，但只作用于选中对象）
Gongfang._drawStyleSwatches = function(kind, field, curHex) {
  var slots = (Gongfang._drawState && Gongfang._drawState.colors && Gongfang._drawState.colors.slots) ||
    ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#ffffff'];
  // ★ 样式面板色块不做"选中圈"标识：点谁用谁，与参数面板的选中态无关
  var sw = slots.slice(0, 9).map(function(c) {
    return '<button class="dw-swatch" style="background:' + c + '" title="使用 ' + c + '" onclick="Gongfang._drawStylePickColor(\'' + kind + '\',\'' + field + '\',\'' + c + '\')"></button>';
  }).join('');
  return sw +
    '<button class="dw-color-add" title="调色盘" onclick="Gongfang._drawStyleOpenWheel(\'' + kind + '\',\'' + field + '\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg></button>';
};
Gongfang._drawStylePickColor = function(kind, field, color) {
  if (kind === 'edge') {
    Gongfang._drawStyleTargets.edges.forEach(function(e) { try { Gongfang._drawSetProps(e, { stroke: color, strokeColor: color }); Gongfang._drawApplyEdgeCell(e); } catch (err) {} });
  } else {
    var mode = field === 'mode' ? (Gongfang._drawStyleTargets.colorMode || 'fill') : field;
    Gongfang._drawStyleTargets.nodes.forEach(function(n) {
      try {
        if (mode === 'fill') Gongfang._drawSetProps(n, { fill: color });
        else if (mode === 'stroke') Gongfang._drawSetProps(n, { stroke: color });
        else Gongfang._drawSetProps(n, { textColor: color });
        Gongfang._drawApplyNodeCell(n);
      } catch (err) {}
    });
  }
};
Gongfang._drawStyleOpenWheel = function(kind, field) {
  var mode = (kind === 'edge') ? 'line' : (field === 'mode' ? (Gongfang._drawStyleTargets.colorMode || 'fill') : field);
  var hex = '#4f46e5';
  if (kind === 'edge') {
    var e = Gongfang._drawStyleTargets.edges[0];
    if (e) hex = Gongfang._drawProps(e).stroke || e.attr('line/stroke') || '#111827';
  } else {
    var n = Gongfang._drawStyleTargets.nodes[0];
    if (n) hex = mode === 'fill' ? (Gongfang._drawProps(n).fill || n.attr('body/fill') || '#4f46e5')
      : mode === 'stroke' ? (Gongfang._drawProps(n).stroke || n.attr('body/stroke') || '#4f46e5')
      : (Gongfang._drawProps(n).textColor || n.attr('label/fill') || '#111827');
  }
  var pos = Gongfang._drawStylePanelPos();
  var apply = function(c) { Gongfang._drawStylePickColor(kind, field, c); };
  Gongfang._drawColorPopup(null, { title: mode === 'line' ? '线条颜色' : (mode === 'fill' ? '填充颜色' : mode === 'stroke' ? '边框颜色' : '文字颜色'), initial: hex, position: pos, onApply: apply, onLive: apply });
};
Gongfang._drawStyleSlider = function(kind, key, label, min, max, step, val) {
  return '<div class="dw-style-row"><span class="dw-style-label">' + label + '</span>' +
    '<input type="range" class="dw-style-slider" data-kind="' + kind + '" data-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' +
    '<b class="dw-style-val">' + val + '</b></div>';
};
Gongfang._drawBindStylePanel = function() {
  var d = Gongfang._drawE('dwStylePanel');
  if (!d) return;
  var sliders = d.querySelectorAll('.dw-style-slider');
  var vals = d.querySelectorAll('.dw-style-val');
  sliders.forEach(function(sl, i) {
    if (sl.__dwStyleBound) return; sl.__dwStyleBound = true;
    sl.addEventListener('input', function() {
      if (vals[i]) vals[i].textContent = sl.value;
      Gongfang._drawStyleApply(sl.getAttribute('data-kind'), sl.getAttribute('data-key'), parseFloat(sl.value));
    });
  });
};
Gongfang._drawStyleApply = function(kind, key, v) {
  var t = Gongfang._drawStyleTargets;
  var cells = kind === 'node' ? t.nodes : t.edges;
  cells.forEach(function(c) {
    try {
      if (key === 'strokeWidth') { Gongfang._drawSetProps(c, { strokeWidth: v }); c.attr(kind === 'node' ? 'body/strokeWidth' : 'line/strokeWidth', v); }
      else if (key === 'radius') { Gongfang._drawSetProps(c, { radius: v }); try { c.attr('body/rx', v); } catch(e) {} }
      else if (key === 'fillOpacity') { Gongfang._drawSetProps(c, { fillOpacity: v }); c.attr('body/fillOpacity', v); }
      else if (key === 'dash') { var dd = v > 0 ? (v + ' ' + v) : 'none'; Gongfang._drawSetProps(c, { strokeDasharray: v > 0 ? String(v) : 'none' }); c.attr(kind === 'node' ? 'body/strokeDasharray' : 'line/strokeDasharray', dd); }
    } catch(e) {}
  });
  if (kind === 'node') t.nodes.forEach(function(n) { try { Gongfang._drawApplyNodeCell(n); } catch(e) {} });
  else t.edges.forEach(function(ed) { try { Gongfang._drawApplyEdgeCell(ed); } catch(e) {} });
};
Gongfang._drawStyleNodeColor = function(field) {
  var node = Gongfang._drawStyleTargets.nodes[0]; if (!node) return;
  var props = Gongfang._drawProps(node);
  var title = field === 'fill' ? '填充颜色' : (field === 'stroke' ? '边框颜色' : '文字颜色');
  var initial = field === 'fill' ? (props.fill || node.attr('body/fill') || '#4f46e5')
    : (field === 'stroke' ? (props.stroke || node.attr('body/stroke') || '#4f46e5') : (props.textColor || node.attr('label/fill') || '#111827'));
  var pos = Gongfang._drawStylePanelPos();
  var apply = function(hex) {
    Gongfang._drawStyleTargets.nodes.forEach(function(n) {
      if (field === 'fill') Gongfang._drawSetProps(n, { fill: hex });
      else if (field === 'stroke') Gongfang._drawSetProps(n, { stroke: hex });
      else Gongfang._drawSetProps(n, { textColor: hex });
      Gongfang._drawApplyNodeCell(n);
    });
  };
  Gongfang._drawColorPopup(null, { title: title, initial: initial, position: pos, onApply: apply, onLive: apply });
};
Gongfang._drawStyleEdgeColor = function() {
  var edge = Gongfang._drawStyleTargets.edges[0]; if (!edge) return;
  var props = Gongfang._drawProps(edge);
  var initial = props.strokeColor || props.stroke || Gongfang._drawEdgeColor();
  var pos = Gongfang._drawStylePanelPos();
  var apply = function(hex) {
    Gongfang._drawStyleTargets.edges.forEach(function(e) { Gongfang._drawSetProps(e, { stroke: hex, strokeColor: hex }); Gongfang._drawApplyEdgeCell(e); });
  };
  Gongfang._drawColorPopup(null, { title: '线条颜色', initial: initial, position: pos, onApply: apply, onLive: apply });
};
Gongfang._drawStylePanelPos = function() {
  try {
    var d = Gongfang._drawE('dwStylePanel');
    var r = d ? d.getBoundingClientRect() : null;
    if (r) return { x: r.left + 12, y: r.top + 40 };
  } catch(e) {}
  return { x: 100, y: 100 };
};
Gongfang._drawStyleNodeStyle = function(style) {
  Gongfang._drawStyleTargets.nodes.forEach(function(node) {
    try {
      var isGeom = ['decision', 'prep', 'triangle', 'io', 'circle'].indexOf(node.shape) !== -1;
      Gongfang._drawSetProps(node, {
        fill: style === 'transparent' ? 'none' : Gongfang._drawNodeFill(),
        strokeDasharray: style === 'dashed' ? '6 4' : '',
        radius: style === 'sharp' ? 0 : (isGeom ? 0 : (Gongfang._drawState.nodeRadius || 8)),
      });
      Gongfang._drawApplyNodeCell(node);
    } catch(e) {}
  });
};
Gongfang._drawStyleEdgeType = function(t) {
  Gongfang._drawStyleTargets.edges.forEach(function(edge) {
    try { Gongfang._drawSetProps(edge, { type: t }); var rc = Gongfang._drawEdgeRouterConnector(t); edge.setRouter(rc.router, {}); edge.setConnector(rc.connector, {}); } catch(e) {}
  });
};
Gongfang._drawStyleCopy = function() {
  var graph = Gongfang._drawState.graph; if (!graph) return;
  var ids = Gongfang._drawStyleTargets.nodes.concat(Gongfang._drawStyleTargets.edges).map(function(c) { return c.id; });
  try { graph.resetSelection(ids); } catch(e) {}
  Gongfang._drawCopySelection();
  if (Gongfang._showToast) Gongfang._showToast('已复制');
};
Gongfang._drawStylePaste = function() {
  Gongfang._drawPasteSelection();
  if (Gongfang._showToast) Gongfang._showToast('已粘贴');
};

// ═══════════════════ 撤销/重做/缩放 ═══════════════════
Gongfang._drawUndo = function() { var graph = Gongfang._drawState.graph; if (graph) { try { graph.undo(); } catch(e) {} } };
Gongfang._drawRedo = function() { var graph = Gongfang._drawState.graph; if (graph) { try { graph.redo(); } catch(e) {} } };
Gongfang._drawZoomBy = function(up) { var graph = Gongfang._drawState.graph; if (graph) { try { graph.zoom(up ? 1.2 : 1 / 1.2); Gongfang._drawUpdateZoom(); } catch(e) {} } };
Gongfang._drawFit = function() { var graph = Gongfang._drawState.graph; if (graph) { try { graph.zoomToFit({ padding: 20 }); Gongfang._drawUpdateZoom(); } catch(e) {} } };

// ═══════════════════ 复制 / 粘贴（Ctrl+C / Ctrl+V） ═══════════════════
Gongfang._drawClipboard = null;
Gongfang._drawCopySelection = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    var cells = graph.getSelectedCells();
    if (!cells || !cells.length) return;
    var nodeIds = {}, nodes = [], edges = [];
    cells.forEach(function(c) {
      if (c.isNode && c.isNode()) { nodes.push(c.toJSON()); nodeIds[c.id] = true; }
      else if (c.isEdge) edges.push(c.toJSON());
    });
    // ★ 框选只选中节点、不选中连线：把两端都在选中节点集合里的连线也一并复制，保持线条布局
    if (Object.keys(nodeIds).length) {
      graph.getEdges().forEach(function(e) {
        var s = e.getSourceNode ? e.getSourceNode() : null, t = e.getTargetNode ? e.getTargetNode() : null;
        if (s && t && nodeIds[s.id] && nodeIds[t.id]) edges.push(e.toJSON());
      });
    }
    // 去重（可能同时被选中过） + 只保留两端都在本次复制内的连线
    var seen = {};
    edges = edges.filter(function(j) { var k = j.id; if (seen[k]) return false; seen[k] = true; return true; });
    edges = edges.filter(function(j) {
      var s = j.source && j.source.cell, t = j.target && j.target.cell;
      return !!(s && t && nodeIds[s] && nodeIds[t]);
    });
    if (!nodes.length && !edges.length) return;
    Gongfang._drawClipboard = { nodes: nodes, edges: edges };
    if (Gongfang._showToast) Gongfang._showToast('已复制 ' + (nodes.length || edges.length) + ' 个对象');
  } catch(e) {}
};
Gongfang._drawPasteSelection = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph || !Gongfang._drawClipboard) return;
  try {
    // ★ 逐次粘贴阶梯偏移：X6 JSON 的位置在 position、尺寸在 size，读错字段会导致全部贴到原点堆叠
    if (!Gongfang._drawPasteStep) Gongfang._drawPasteStep = 0;
    Gongfang._drawPasteStep = (Gongfang._drawPasteStep % 6) + 1;
    var OFFSET = 24;
    var idMap = {}, newNodes = [];
    Gongfang._drawClipboard.nodes.forEach(function(j) {
      var id = 'n_' + Math.random().toString(36).slice(2, 9);
      var jx = (j.position && j.position.x) || 0;
      var jy = (j.position && j.position.y) || 0;
      var jw = (j.size && j.size.width) || 150;
      var jh = (j.size && j.size.height) || 60;
      var node = graph.addNode({
        id: id, shape: j.shape,
        x: jx + OFFSET * Gongfang._drawPasteStep, y: jy + OFFSET * Gongfang._drawPasteStep,
        width: jw, height: jh,
        attrs: j.attrs, data: j.data,
      });
      idMap[j.id] = id;
      if (node) { newNodes.push(node); Gongfang._drawApplyNodeCell(node); }
    });
    Gongfang._drawClipboard.edges.forEach(function(j) {
      var s = j.source && j.source.cell, t = j.target && j.target.cell;
      if (!idMap[s] || !idMap[t]) return;
      try {
        graph.addEdge({
          source: { cell: idMap[s], port: j.source.port },
          target: { cell: idMap[t], port: j.target.port },
          router: j.router, connector: j.connector,
          attrs: j.attrs, data: j.data,
        });
      } catch(e2) {}
    });
    Gongfang._drawApplyTheme();
    // 选中新粘贴的节点
    if (newNodes.length) {
      try {
        graph.getSelectedCells().forEach(function(c) { graph.unselect(c.id); });
        newNodes.forEach(function(n) { graph.select(n.id); });
      } catch(e3) {}
    }
    if (Gongfang._showToast) Gongfang._showToast('已粘贴');
  } catch(e) {}
};
Gongfang._drawUpdateZoom = function() {
  var graph = Gongfang._drawState.graph, zh = Gongfang._drawE('dwZoom'), zb = Gongfang._drawE('dwZoomBadge');
  if (!graph) return;
  try {
    var z = graph.zoom();
    if (!z || isNaN(z)) z = 1;
    if (zh) zh.textContent = Math.round(z * 100) + '%';
    if (zb) { zb.textContent = Math.round(z * 100) + '%'; zb.style.display = Math.abs(z - 1) > 0.01 ? 'block' : 'none'; }
  } catch(e) {}
};
Gongfang._drawLastW = 0;
Gongfang._drawLastH = 0;
Gongfang._drawResize = function() {
  var graph = Gongfang._drawState.graph;
  var c = Gongfang._drawE('dwCanvas');
  if (!graph || !c) return;
  var w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;   // 画布不可见/0 尺寸时跳过
  // 尺寸没变就不动作（X6 autoResize 已管画布尺寸，这里只管网格重绘，避免 ResizeObserver 循环）
  if (w === Gongfang._drawLastW && h === Gongfang._drawLastH) return;
  Gongfang._drawLastW = w; Gongfang._drawLastH = h;
  try {
    var st = Gongfang._drawState;
    var gs = st.gridSize || 20;
    graph.drawGrid({ size: gs, visible: !!st.gridVisible, type: 'mesh', args: { color: '#cbd5e1', thickness: 1 } });
  } catch(e) {}
};
Gongfang._drawClear = function() { var graph = Gongfang._drawState.graph; if (graph) { try { graph.clearCells(); Gongfang._drawUpdateStats(); } catch(e) {} } };

// ═══════════════════ 统计 ═══════════════════
Gongfang._drawUpdateStats = function() {
  var graph = Gongfang._drawState.graph, nodes = 0, edges = 0;
  try {
    var cells = graph.getCells();
    cells.forEach(function(c) { if (c.isNode && c.isNode()) nodes++; else if (c.isEdge && c.isEdge()) edges++; });
  } catch(e) {}
  var n = Gongfang._drawE('dwStatNodes'), ed = Gongfang._drawE('dwStatEdges');
  if (n) n.textContent = nodes;
  if (ed) ed.textContent = edges;
};
Gongfang._drawRefreshFiles = function() { Gongfang._drawUpdateStats(); };

// ── 画布左下角：当前文件名 + 创建日期 ──
Gongfang._drawUpdateFileBadge = function() {
  var b = Gongfang._drawE('dwFileBadge');
  if (!b) return;
  var name = Gongfang._drawState.currentName;
  var created = Gongfang._drawState.currentCreatedAt;
  var text = '';
  if (name) text += name;
  if (created) {
    var d = new Date(created);
    if (!isNaN(d.getTime())) {
      var pad = function(n) { return String(n).padStart(2, '0'); };
      text += (text ? ' · ' : '') + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }
  b.textContent = text || '';
  b.title = text ? ('当前文件：' + text) : '';
};

// ── 双击节点内联编辑文字（自研覆盖输入框；X6 node-editor 工具的 cell:dblclick 事件不触发，故自研） ──
Gongfang._drawEditNodeText = function(node) {
  var graph = Gongfang._drawState.graph;
  var cvs = Gongfang._drawE('dwCanvas');
  if (!graph || !cvs || !node) return;
  var old = Gongfang._drawE('dwNodeTextEditor');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var view = null;
  try { view = graph.findViewByCell(node); } catch(e) {}
  var nodeEl = view && view.container;
  if (!nodeEl) return;
  var text = '';
  try { text = node.attr('label/text') || ''; } catch(e) {}
  var st = Gongfang._drawState;
  var align = st.textAlign === 'left' ? 'left' : (st.textAlign === 'right' ? 'right' : 'center');
  // 用 localToClient 精确取节点 bbox（含平移/缩放），保证编辑框嵌在节点框内部
  var bbox = null;
  try { bbox = graph.localToClient(node.getBBox()); } catch(e) {}
  if (!bbox) { try { bbox = nodeEl.getBoundingClientRect(); } catch(e2) {} }
  if (!bbox) return;
  var cRect = cvs.getBoundingClientRect();
  var input = document.createElement('textarea');
  input.id = 'dwNodeTextEditor';
  input.className = 'dw-node-text-editor';
  input.value = text;
  // ★ 编辑框宽度与 label 换行宽度一致（节点宽 - 12px），所见即所得
  var w = Math.max(40, Math.min(420, bbox.width - 12));
  var h = Math.max(22, Math.min(bbox.height - 6, 140));
  var maxH = Math.max(h, 400);   // ★ 超高封顶：超过后编辑框内部滚动兜底
  input.style.left = (bbox.x - cRect.left + (bbox.width - w) / 2) + 'px';
  input.style.top = (bbox.y - cRect.top + (bbox.height - h) / 2) + 'px';   // 固定顶边，向下增高
  input.style.width = w + 'px';
  input.style.height = h + 'px';
  input.style.textAlign = align;
  cvs.appendChild(input);
  // ★ 自动增高：文字超出节点高度时编辑框随之增高，所有文字始终可见，光标键可自由进入全部内容（不再被裁掉）；
  //   删除内容后编辑框同步收缩，原先"超出"的部分自然回到视野。
  var grow = function() {
    input.style.height = 'auto';
    input.style.overflowY = 'hidden';
    var contentH = input.offsetHeight;   // auto 高度下的完整内容高度（含边框），避免 border-box 差几像素裁掉末行
    var nh = Math.max(h, Math.min(maxH, contentH));
    input.style.height = nh + 'px';
    input.style.overflowY = (contentH > maxH) ? 'auto' : 'hidden';
  };
  grow();
  input.addEventListener('input', grow);
  input.focus(); input.select();
  var finish = function() {
    var v = input.value;
    if (input.parentNode) input.parentNode.removeChild(input);
    if (v !== text) {
      try { node.attr('label/text', v); } catch(e) {}
      // ★ 空文字隐藏标签（避免短横线），有字恢复显示
      try { node.attr('label/display', v ? '' : 'none'); } catch(e) {}
    }
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { input.blur(); }
  });
  input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
};

// ═══════════════════ 流程图库：左侧文件夹栏（专用目录 Workspace-Extend/flowcharts） ═══════════════════
Gongfang._drawFlowDir = function() {
  if (!window.electronAPI || !window.electronAPI.flowchartsGetDir) return Promise.resolve(null);
  return window.electronAPI.flowchartsGetDir().then(function(r) {
    return (r && r.success && r.path) ? r.path : null;
  }).catch(function() { return null; });
};
Gongfang._drawFlowBaseName = function(path) {
  return String(path || '').replace(/\\/g, '/').split('/').pop().replace(/\.json$/i, '');
};
Gongfang._drawRefreshFlowList = function() {
  var list = Gongfang._drawE('dwFlowList');
  if (!list) return;
  list.innerHTML = '<div class="dw-empty">加载中…</div>';
  Gongfang._drawFlowDir().then(function(dir) {
    if (!dir) { list.innerHTML = '<div class="dw-empty">文件目录暂不可用</div>'; return; }
    if (!window.electronAPI || !window.electronAPI.readDirectoryTree) { list.innerHTML = '<div class="dw-empty">无法读取目录</div>'; return; }
    return window.electronAPI.readDirectoryTree(dir, 4).then(function(res) {
      Gongfang._drawFlowRoot = dir;
      // 列表空白处：可把文件/文件夹拖回根目录
      list.ondragover = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
      list.ondrop = function(e) {
        e.preventDefault();
        var src = Gongfang._drawFileDragPath || (e.dataTransfer && e.dataTransfer.getData('application/x-gongfang-flow')) || '';
        if (src) Gongfang._drawMoveFile(src, dir);
      };
      list.ondragleave = function() {};
      var tree = res && res.success ? res.tree : null;
      var children = (tree && tree.children) || [];
      if (!children.length) { list.innerHTML = '<div class="dw-empty">暂无文件<br>点「新建」创建流程图</div>'; return; }
      var html = children.map(function(c) { return Gongfang._drawFlowTreeNode(c, 0); }).join('');
      list.innerHTML = html;
      list.querySelectorAll('.dw-flow-item, .dw-flow-folder').forEach(function(row) {
        if (row.__dwBound) return;
        row.__dwBound = true;
        var type = row.getAttribute('data-type');
        var rowPath = row.getAttribute('data-path');
        row.addEventListener('click', function(e) {
          e.stopPropagation();
          if (type === 'file') Gongfang._drawOpenFlow(rowPath);
        });
        row.addEventListener('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (type === 'file') Gongfang._drawOpenFlow(rowPath);
        });
        row.addEventListener('contextmenu', function(e) {
          e.preventDefault(); e.stopPropagation();
          Gongfang._drawShowFileMenu(e, row.getAttribute('data-dir') || dir, rowPath, type);
        });
      });
      list.oncontextmenu = function(e) {
        if (e.target === list || (e.target.classList && e.target.classList.contains('dw-empty'))) {
          e.preventDefault();
          Gongfang._drawShowFileMenu(e, dir, null, null);
        }
      };
    });
  }).catch(function() {});
};
Gongfang._drawFlowTreeNode = function(node, depth) {
  if (!node || !node.path) return '';
  var pad = depth * 14;
  var esc = Gongfang._drawEsc;
  if (node.type === 'directory') {
    var sub = (node.children || []).map(function(c) { return Gongfang._drawFlowTreeNode(c, depth + 1); }).join('');
    return '<div class="dw-flow-folder" draggable="true" data-type="folder" data-path="' + esc(node.path) + '" data-dir="' + esc(node.path) + '" style="padding-left:' + pad + 'px" title="右键：新建/重命名/删除；可拖入文件" ' +
      'ondragstart="Gongfang._drawFileDragStart(event,this)" ondragover="Gongfang._drawFileDragOver(event,this)" ondragleave="Gongfang._drawFileDragLeave(this)" ondrop="Gongfang._drawFileDrop(event,this)">' +
      '<span class="dw-flow-ico">' + Gongfang.folderIcon(false) + '</span>' +
      '<span class="dw-flow-name">' + esc(node.name) + '</span></div>' + sub;
  }
  if (node.type === 'file' && /\.json$/i.test(node.name)) {
    var name = node.name.replace(/\.json$/i, '');
    var curNorm = Gongfang._drawState.currentFile ? String(Gongfang._drawState.currentFile).replace(/\\/g, '/').toLowerCase() : '';
    var norm = String(node.path).replace(/\\/g, '/').toLowerCase();
    var active = curNorm && norm === curNorm ? ' active' : '';
    var parentDir = String(node.path).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    return '<div class="dw-flow-item' + active + '" draggable="true" data-type="file" data-path="' + esc(node.path) + '" data-dir="' + esc(parentDir) + '" style="padding-left:' + (pad + 4) + 'px" title="点击打开：' + esc(name) + '；可拖到文件夹" ' +
      'ondragstart="Gongfang._drawFileDragStart(event,this)">' +
      '<span class="dw-flow-ico">' + Gongfang.FILE_ICONS.image + '</span>' +
      '<span class="dw-flow-name">' + esc(name) + '</span>' +
      '<button class="dw-flow-del" onclick="event.stopPropagation();Gongfang._drawDeleteFlow(this)" title="删除流程图">✕</button>' +
    '</div>';
  }
  return '';
};
// ── 文件拖拽：拖文件/文件夹到文件夹或根目录 ──
Gongfang._drawFileDragPath = null;
Gongfang._drawFileDragStart = function(e, row) {
  var path = row.getAttribute('data-path');
  if (!path) { e.preventDefault(); return; }
  try {
    e.dataTransfer.setData('application/x-gongfang-flow', path);
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'move';
  } catch(err) {}
  Gongfang._drawFileDragPath = path;
};
Gongfang._drawFileDragOver = function(e, row) {
  e.preventDefault();
  e.stopPropagation();
  try { e.dataTransfer.dropEffect = 'move'; } catch(err) {}
  row.classList.add('dw-drop-target');
};
Gongfang._drawFileDragLeave = function(row) {
  if (row) row.classList.remove('dw-drop-target');
};
Gongfang._drawFileDrop = function(e, row) {
  e.preventDefault();
  e.stopPropagation();
  if (row) row.classList.remove('dw-drop-target');
  var src = Gongfang._drawFileDragPath || (e.dataTransfer && e.dataTransfer.getData('application/x-gongfang-flow')) || '';
  var targetDir = row ? row.getAttribute('data-path') : '';
  if (!src || !targetDir) return;
  Gongfang._drawMoveFile(src, targetDir);
};
Gongfang._drawMoveFile = function(src, targetDir) {
  if (!src || !targetDir) return;
  if (!window.electronAPI || !window.electronAPI.renamePath) return;
  var srcNorm = String(src).replace(/\\/g, '/');
  var targetNorm = String(targetDir).replace(/\\/g, '/');
  var name = srcNorm.split('/').pop();
  if (!name) return;
  var dest = targetNorm.replace(/[\\/]+$/, '') + '/' + name;
  if (dest === srcNorm) return;
  // 不能把文件夹移进自己的子目录
  if (targetNorm.indexOf(srcNorm + '/') === 0) { if (Gongfang._showToast) Gongfang._showToast('不能移动到自身内部'); return; }
  window.electronAPI.renamePath(src, dest).then(function(r) {
    if (r && r.success) {
      if (Gongfang._drawState.currentFile && String(Gongfang._drawState.currentFile).replace(/\\/g, '/') === srcNorm) {
        Gongfang._drawState.currentFile = dest;
      }
      Gongfang._drawRefreshFlowList();
      if (Gongfang._showToast) Gongfang._showToast('已移动');
    } else if (Gongfang._showToast) { Gongfang._showToast((r && r.error) || '移动失败'); }
  }).catch(function() {});
};
Gongfang._drawNewFlow = function() {
  // 绘图模块不受协作模式限制：协作中仍可新建/切换流程图
  Gongfang._drawFlowDir().then(function(dir) {
    if (!dir) { if (Gongfang._showToast) Gongfang._showToast('文件目录不可用'); return; }
    Gongfang._drawCreateFileIn(dir);
  });
};
// 切换文件前自动保存当前画布（避免切走再切回内容丢失）
Gongfang._drawAutoSaveCurrent = function() {
  if (!Gongfang._drawState.currentFile) return Promise.resolve();
  if (!window.electronAPI || !window.electronAPI.writeFileContent) return Promise.resolve();
  var data = Gongfang._drawBuildSaveData();
  var cells = (data && data.cells) || [];
  if (!cells.length) return Promise.resolve();
  return window.electronAPI.writeFileContent(Gongfang._drawState.currentFile, JSON.stringify(data, null, 2))
    .then(function(r) { return r && r.success; })
    .catch(function() { return false; });
};
Gongfang._drawOpenFlow = function(path) {
  if (!path) return;
  Gongfang._drawAutoSaveCurrent().then(function() {
    if (!window.electronAPI || !window.electronAPI.readFileContent) { if (Gongfang._showToast) Gongfang._showToast('文件服务不可用'); return; }
    window.electronAPI.readFileContent(path).then(function(res) {
      if (!res || !res.success) { if (Gongfang._showToast) Gongfang._showToast('读取失败'); return; }
      Gongfang._drawState.currentFile = path;
      Gongfang._drawState.currentName = Gongfang._drawFlowBaseName(path) || null;
      Gongfang._drawImportJson(res.text);
      Gongfang._drawRefreshFlowList();
    }).catch(function() {});
  });
};
Gongfang._drawDeleteFlow = function(btn) {
  var item = btn && btn.closest ? btn.closest('.dw-flow-item') : null;
  if (!item) return;
  var path = item.getAttribute('data-path');
  if (!window.electronAPI || !window.electronAPI.deletePath) return;
  var name = Gongfang._drawFlowBaseName(path);
  if (!window.confirm('确定删除流程图「' + name + '」？此操作不可恢复。')) return;
  window.electronAPI.deletePath(path).then(function(r) {
    if (r && r.success) {
      if (Gongfang._drawState.currentFile && String(Gongfang._drawState.currentFile).replace(/\\/g, '/') === String(path).replace(/\\/g, '/')) {
        Gongfang._drawState.currentFile = null;
        Gongfang._drawState.currentName = null;
        Gongfang._drawState.currentCreatedAt = null;
        try { var graph = Gongfang._drawState.graph; if (graph) graph.clearCells(); } catch(e) {}
      }
      Gongfang._drawUpdateFileBadge();
      Gongfang._drawRefreshFlowList();
      if (Gongfang._showToast) Gongfang._showToast('已删除');
    } else if (Gongfang._showToast) { Gongfang._showToast('删除失败'); }
  }).catch(function() {});
};

// ── 名字输入弹窗（新建 / 重命名 共用）──
Gongfang._drawPromptName = function(title, placeholder, cb, initial) {
  Gongfang._drawCloseNamePrompt();
  var d = document.createElement('div');
  d.id = 'dwNamePrompt'; d.className = 'dw-modal'; d.style.display = 'flex';
  d.innerHTML = '<div class="dw-modal-box dw-prompt-box">' +
    '<div class="dw-modal-head"><span class="dw-modal-title">' + Gongfang._drawEsc(title) + '</span>' +
      '<button class="dw-btn" onclick="Gongfang._drawCloseNamePrompt()">✕</button></div>' +
    '<div class="dw-modal-body"><input id="dwNamePromptInput" class="dw-prompt-input" type="text" placeholder="' + Gongfang._drawEsc(placeholder || '') + '" autocomplete="off" maxlength="60"></div>' +
    '<div class="dw-modal-foot">' +
      '<button class="dw-btn" onclick="Gongfang._drawCloseNamePrompt()">取消</button>' +
      '<button class="dw-btn dw-btn-primary" id="dwNamePromptOk">确定</button>' +
    '</div></div>';
  document.body.appendChild(d);
  var done = false;
  var finish = function(ok) {
    if (done) return; done = true;
    var val = ok ? (d.querySelector('#dwNamePromptInput').value || '').trim() : '';
    d.remove(); Gongfang._drawNamePromptFinish = null;
    cb(val || null);
  };
  Gongfang._drawNamePromptFinish = finish;
  var input = d.querySelector('#dwNamePromptInput');
  if (initial) input.value = initial;
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { finish(false); } });
  d.querySelector('#dwNamePromptOk').addEventListener('click', function() { finish(true); });
  d.addEventListener('mousedown', function(e) { if (e.target === d) finish(false); });
  input.focus();
  if (initial) { try { input.select(); } catch(e) {} }
};
Gongfang._drawCloseNamePrompt = function() { if (Gongfang._drawNamePromptFinish) Gongfang._drawNamePromptFinish(false); };

// ── 文件区右键菜单：新建文件 / 重命名 / 删除 ──
Gongfang._drawShowFileMenu = function(e, dirPath, targetPath, targetType) {
  Gongfang._drawCloseFileMenu();
  var d = document.createElement('div');
  d.id = 'dwFileMenu'; d.className = 'dw-file-menu';
  d.setAttribute('data-dir', dirPath || '');
  if (targetPath) d.setAttribute('data-target', targetPath);
  if (targetType) d.setAttribute('data-tt', targetType);
  d.innerHTML = '<div class="dw-file-menu-item" data-act="newfile">新建文件</div>' +
    '<div class="dw-file-menu-sep"></div>' +
    '<div class="dw-file-menu-item" data-act="rename">重命名</div>' +
    '<div class="dw-file-menu-item danger" data-act="delete">删除</div>';
  d.addEventListener('click', function(ev) {
    var it = ev.target.closest ? ev.target.closest('.dw-file-menu-item') : null;
    if (!it) return;
    var act = it.getAttribute('data-act');
    var dir = d.getAttribute('data-dir');
    var target = d.getAttribute('data-target');
    var tt = d.getAttribute('data-tt');
    Gongfang._drawCloseFileMenu();
    Gongfang._drawHandleFileAction(act, dir, target, tt);
  });
  document.body.appendChild(d);
  // ★ 菜单始终在软件窗口内显示
  Gongfang._drawPositionLayerMenu(d, e.clientX, e.clientY);
  setTimeout(function() { document.addEventListener('mousedown', function h(ev2) { if (!d.contains(ev2.target)) { d.remove(); document.removeEventListener('mousedown', h); } }); }, 0);
};
Gongfang._drawCloseFileMenu = function() { var d = Gongfang._drawE('dwFileMenu'); if (d) d.remove(); };
Gongfang._drawHandleFileAction = function(act, dir, target, tt) {
  if (!dir) { if (Gongfang._showToast) Gongfang._showToast('目录不可用'); return; }
  if ((act === 'rename' || act === 'delete') && !target) { if (Gongfang._showToast) Gongfang._showToast('请先选中一个文件/文件夹'); return; }
  if (act === 'newfile') {
    Gongfang._drawCreateFileIn(dir);
  } else if (act === 'rename') {
    var isJson = /\.json$/i.test(target || '');
    var base = Gongfang._drawFlowBaseName(target) || String(target || '').replace(/\\/g, '/').split('/').pop();
    Gongfang._drawPromptName('重命名', '请输入新名字', function(name) {
      if (!name) return;
      var safe = name.replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safe) { if (Gongfang._showToast) Gongfang._showToast('名字无效'); return; }
      var parts = String(target).replace(/\\/g, '/').split('/');
      parts.pop();
      var newPath = parts.join('/') + '/' + safe + (isJson ? '.json' : '');
      window.electronAPI.renamePath(target, newPath).then(function(r) {
        if (r && r.success) {
          if (Gongfang._drawState.currentFile && String(Gongfang._drawState.currentFile).replace(/\\/g, '/') === String(target).replace(/\\/g, '/')) {
            Gongfang._drawState.currentFile = newPath;
            Gongfang._drawState.currentName = safe;
          }
        }
        if (Gongfang._showToast) Gongfang._showToast((r && r.success) ? '已重命名' : ((r && r.error) || '重命名失败'));
        Gongfang._drawRefreshFlowList();
      });
    });
  } else if (act === 'delete') {
    var nm = String(target || '').replace(/\\/g, '/').split('/').pop();
    if (!window.confirm('确定删除「' + nm + '」？此操作不可恢复。')) return;
    window.electronAPI.deletePath(target).then(function(r) {
      if (r && r.success) {
        if (Gongfang._drawState.currentFile && String(Gongfang._drawState.currentFile).replace(/\\/g, '/') === String(target).replace(/\\/g, '/')) {
          Gongfang._drawState.currentFile = null;
          Gongfang._drawState.currentName = null;
          Gongfang._drawState.currentCreatedAt = null;
          try { var graph = Gongfang._drawState.graph; if (graph) graph.clearCells(); } catch(e) {}
        }
        Gongfang._drawUpdateFileBadge();
        Gongfang._drawRefreshFlowList();
        if (Gongfang._showToast) Gongfang._showToast('已删除');
      } else if (Gongfang._showToast) { Gongfang._showToast('删除失败'); }
    });
  }
};
Gongfang._drawCreateFileIn = function(dir) {
  Gongfang._drawPromptName('新建文件', '请输入新建流程图的名字', function(name) {
    if (!name) return;
    Gongfang._drawAutoSaveCurrent().then(function() {
      var safe = name.replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名流程图';
      var filePath = String(dir).replace(/[\\/]+$/, '') + '/' + safe + '.json';
      var createdAt = new Date().toISOString();
      window.electronAPI.writeFileContent(filePath, JSON.stringify({ cells: [], meta: { createdAt: createdAt } })).then(function(r) {
        if (r && r.success) {
          Gongfang._drawState.currentFile = filePath;
          Gongfang._drawState.currentName = safe;
          Gongfang._drawState.currentCreatedAt = createdAt;
          try { var graph = Gongfang._drawState.graph; if (graph) graph.clearCells(); } catch(e) {}
          Gongfang._drawUpdateFileBadge();
          Gongfang._drawRefreshFlowList();
          if (Gongfang._showToast) Gongfang._showToast('已新建文件：' + safe);
        } else if (Gongfang._showToast) { Gongfang._showToast((r && r.error) || '创建失败'); }
      });
    });
  });
};

// ═══════════════════ 文件：打开/保存/导出/插图 ═══════════════════
Gongfang._drawWorkDir = function() {
  var f = Gongfang._drawState.currentFile;
  return f ? String(f).replace(/[\\/][^\\/]*$/, '') : '';
};
Gongfang._drawResolveWorkDir = function() { return Promise.resolve(Gongfang._drawWorkDir()); };
Gongfang._drawOpenFile = function() {
  if (!window.electronAPI || !window.electronAPI.openFileDialog || !window.electronAPI.readFileContent) { if (Gongfang._showToast) Gongfang._showToast('文件服务不可用'); return; }
  window.electronAPI.openFileDialog({ title: '打开流程图', filters: [{ name: '流程图', extensions: ['json'] }], properties: ['openFile'] })
    .then(function(paths) { if (!paths || !paths[0]) return null; return window.electronAPI.readFileContent(paths[0]); })
    .then(function(res) { if (!res || !res.success) { if (Gongfang._showToast) Gongfang._showToast('读取失败'); return; } Gongfang._drawState.currentFile = res.path || null; Gongfang._drawImportJson(res.text); })
    .catch(function() {});
};
Gongfang._drawSaveJson = function() {
  var data = Gongfang._drawBuildSaveData();
  if (!data || !data.cells || !data.cells.length) { if (Gongfang._showToast) Gongfang._showToast('画布为空'); return; }
  var json = JSON.stringify(data, null, 2);
  if (!window.electronAPI || !window.electronAPI.writeFileContent) { var a = document.createElement('a'); a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json); a.download = '流程图.json'; a.click(); return; }
  // 保存到当前文件所在目录（或流程图根目录），弹出命名框，默认填当前文件名
  var curFile = Gongfang._drawState.currentFile;
  var dirP = curFile ? String(curFile).replace(/\\/g, '/').split('/').slice(0, -1).join('/') : null;
  var dirPromise = dirP ? Promise.resolve(dirP) : Gongfang._drawFlowDir();
  dirPromise.then(function(dir) {
    if (!dir) { if (Gongfang._showToast) Gongfang._showToast('保存目录不可用'); return; }
    var base = Gongfang._drawState.currentName || '流程图';
    Gongfang._drawPromptName('保存文件', '请输入保存的文件名', function(name) {
      if (!name) return;
      var safe = name.replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名流程图';
      var filePath = String(dir).replace(/[\\/]+$/, '') + '/' + safe + '.json';
      window.electronAPI.writeFileContent(filePath, json).then(function(r) {
        if (r && r.success) {
          Gongfang._drawState.currentFile = filePath;
          Gongfang._drawState.currentName = safe;
          if (!Gongfang._drawState.currentCreatedAt) Gongfang._drawState.currentCreatedAt = new Date().toISOString();
          Gongfang._drawUpdateFileBadge();
          Gongfang._drawRefreshFlowList();
          if (Gongfang._showToast) Gongfang._showToast('已保存流程图：' + safe);
        } else if (Gongfang._showToast) { Gongfang._showToast('保存失败'); }
      });
    }, base);
  });
};
Gongfang._drawGraphData = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph) return null;
  try { return graph.toJSON(); } catch(e) { return null; }
};
// 保存用的完整数据：graph cells + meta（创建日期等）
Gongfang._drawBuildSaveData = function() {
  var data = Gongfang._drawGraphData();
  if (!data) return data;
  if (!data.meta) data.meta = {};
  if (!data.meta.createdAt && Gongfang._drawState.currentCreatedAt) data.meta.createdAt = Gongfang._drawState.currentCreatedAt;
  return data;
};

// ── 旧 LogicFlow 格式 → X6 cells 转换（打开旧 .json 时自动识别） ──
Gongfang._drawLfToX6 = function(lfData) {
  var cells = [];
  var nodes = (lfData && lfData.nodes) || [];
  var edges = (lfData && lfData.edges) || [];
  var nodeById = {};
  nodes.forEach(function(n) {
    if (!n || !n.type) return;
    var p = n.properties || {};
    var w = n.width || p.width || (Gongfang._drawNodeSpec(n.type).w);
    var h = n.height || p.height || (Gongfang._drawNodeSpec(n.type).h);
    var text = (n.text && (n.text.value !== undefined ? n.text.value : n.text)) || '';
    var textColor = (n.text && n.text.color) || undefined;
    var cell = {
      id: n.id || ('n_' + Math.random().toString(36).slice(2, 9)),
      shape: n.type,
      position: { x: n.x, y: n.y },
      size: { width: w, height: h },
      attrs: { label: { text: text } },
      data: { properties: Object.assign({}, p) },
    };
    if (textColor) cell.attrs.label.fill = textColor;
    if (p.rotate) cell.angle = p.rotate;
    nodeById[cell.id] = cell;
    cells.push(cell);
  });
  edges.forEach(function(e) {
    if (!e || !e.sourceNodeId || !e.targetNodeId) return;
    var p = e.properties || {};
    var type = p.type || e.type || 'polyline';
    var rc = Gongfang._drawEdgeRouterConnector(type);
    var cell = {
      id: e.id || ('e_' + Math.random().toString(36).slice(2, 9)),
      shape: 'edge',
      source: { cell: e.sourceNodeId },
      target: { cell: e.targetNodeId },
      router: rc.router, connector: rc.connector,
      data: { properties: Object.assign({}, p, { type: type }) },
    };
    if (e.sourceAnchorId) cell.source.port = e.sourceAnchorId;
    if (e.targetAnchorId) cell.target.port = e.targetAnchorId;
    cells.push(cell);
  });
  return { cells: cells };
};
Gongfang._drawImportJson = function(text) {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  try {
    var data = JSON.parse(text);
    var payload = null;
    if (data && Array.isArray(data.cells)) payload = data;
    else if (data && Array.isArray(data.nodes)) payload = Gongfang._drawLfToX6(data);
    if (!payload) throw new Error('格式错误');
    graph.fromJSON(payload);
    Gongfang._drawApplyTheme();
    try { graph.centerContent(); } catch(e) {}   // 内容居中，避免网格/内容偏移到不可见区域
    Gongfang._drawUpdateZoom();
    Gongfang._drawUpdateStats();
    Gongfang._drawState.currentCreatedAt = (data && data.meta && data.meta.createdAt) || null;
    Gongfang._drawUpdateFileBadge();
    if (Gongfang._showToast) Gongfang._showToast('绘图已载入');
  } catch(e) { if (Gongfang._showToast) Gongfang._showToast('载入失败：' + (e && e.message || '格式错误')); }
};

// ── 导出 SVG（X6 toSVG：内容包围盒尺寸、白底、按当前主题/选中颜色着色、带箭头） ──
// 导出前移除节点端口锚点（连接点小三角），图片里不显示锚点
Gongfang._drawStripPorts = function(svgEl) {
  try {
    if (svgEl && svgEl.querySelectorAll) {
      svgEl.querySelectorAll('[data-port-id], [data-port], .x6-port, .x6-port-group').forEach(function(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    }
  } catch(e) {}
  return svgEl;
};
Gongfang._drawExportPng = function() {
  var graph = Gongfang._drawState.graph;
  if (!graph) return;
  if (!graph.getCellCount()) { if (Gongfang._showToast) Gongfang._showToast('画布为空'); return; }
  var base = (Gongfang._drawState.currentName || '流程图').replace(/[<>:"/\\|?*]/g, '_').trim() || '流程图';
  // X6 节点视图是异步渲染的：刚 addNode/fromJSON 后立即导出会得到空图，等一帧再导出
  setTimeout(function() {
    try {
      // ★ 优先导出 PNG（"保存图片"），X6 渲染插件提供 toPNG
      if (typeof graph.toPNG === 'function') {
        graph.toPNG(function(dataUri) {
          if (!dataUri) { if (Gongfang._showToast) Gongfang._showToast('导出失败'); return; }
          if (!window.electronAPI || !window.electronAPI.saveBinaryDialog) {
            var a = document.createElement('a'); a.href = dataUri; a.download = base + '.png'; a.click(); return;
          }
          window.electronAPI.saveBinaryDialog({ defaultName: base + '.png', base64: dataUri, extensions: ['png'] })
            .then(function(r) {
              if (Gongfang._showToast) {
                if (r && r.success) Gongfang._showToast(r.path ? ('图片已保存：' + r.path) : '图片已保存');
                else if (r && r.error !== '已取消') Gongfang._showToast('保存失败' + (r && r.error ? '：' + r.error : ''));
              }
            }).catch(function() {});
        }, {
          backgroundColor: '#ffffff', padding: 10, copyStyles: false,
          beforeSerialize: function(svgEl) { return Gongfang._drawStripPorts(svgEl); },
        });
        return;
      }
      // 兜底：SVG 导出（toPNG 不可用时）
      graph.toSVG(function(svg) {
        if (!svg) { if (Gongfang._showToast) Gongfang._showToast('导出失败'); return; }
        if (!window.electronAPI || !window.electronAPI.saveTextDialog) {
          var a = document.createElement('a');
          a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          a.download = base + '.svg'; a.click(); return;
        }
        window.electronAPI.saveTextDialog({ defaultName: base + '.svg', content: svg, extensions: ['svg'] })
          .then(function(r) {
            if (Gongfang._showToast) {
              if (r && r.success) Gongfang._showToast(r.path ? ('SVG 已保存：' + r.path) : 'SVG 已保存');
              else if (r && r.error !== '已取消') Gongfang._showToast('保存失败' + (r && r.error ? '：' + r.error : ''));
            }
          }).catch(function() {});
      }, {
        preserveDimensions: true, copyStyles: false, serializeImages: true,
        beforeSerialize: function(svgEl) { return Gongfang._drawStripPorts(svgEl); },
      });
    } catch(e) { if (Gongfang._showToast) Gongfang._showToast('导出失败'); }
  }, 60);
};
Gongfang._drawCompressImage = function(dataUrl, cb) {
  var img = new Image();
  img.onload = function() {
    try {
      var maxDim = 900, w = img.width || 1, h = img.height || 1;
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas'); canvas.width = nw; canvas.height = nh;
      var ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, nw, nh);
      cb(canvas.toDataURL('image/jpeg', 0.82), nw, nh);
    } catch(e) {}
  };
  img.onerror = function() { if (Gongfang._showToast) Gongfang._showToast('图片加载失败'); };
  img.src = dataUrl;
};
Gongfang._drawInsertImage = function() {
  if (!window.electronAPI || !window.electronAPI.openFileDialog || !window.electronAPI.readFileBase64) { if (Gongfang._showToast) Gongfang._showToast('文件服务不可用'); return; }
  window.electronAPI.openFileDialog({ title: '插入图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }], properties: ['openFile'] })
    .then(function(paths) { if (!paths || !paths[0]) return null; return window.electronAPI.readFileBase64(paths[0]); })
    .then(function(res) {
      if (!res || !res.success || !res.dataUrl) { if (Gongfang._showToast) Gongfang._showToast('读取图片失败'); return; }
      Gongfang._drawCompressImage(res.dataUrl, function(dataUrl, iw, ih) {
        var graph = Gongfang._drawState.graph; if (!graph) return;
        var cvs = Gongfang._drawE('dwCanvas');
        var vr = cvs ? cvs.getBoundingClientRect() : null;
        var cx = vr ? vr.left + vr.width / 2 : 400, cy = vr ? vr.top + vr.height / 2 : 300;
        var p = graph.clientToLocal(cx, cy);
        var bw = Math.min(300, iw), bh = Math.round(bw * (ih / (iw || 1)));
        try {
          var node = graph.addNode({
            id: 'img_' + Math.random().toString(36).slice(2, 10),
            shape: 'image',
            position: { x: p.x - bw / 2, y: p.y - bh / 2 },
            size: { width: bw, height: bh },
            data: { properties: { src: dataUrl, iw: iw, ih: ih, width: bw, height: bh } },
          });
          if (node) { if (Gongfang._showToast) Gongfang._showToast('图片已插入，可拖动四角缩放'); }
        } catch(e) {}
        Gongfang._drawUpdateStats();
      });
    }).catch(function() {});
};
Gongfang._drawEsc = function(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ── 扩展注册（v2.6 改造追加）──
// 原 draw.js 内容保持不变；以下把自身注册为基座扩展。
// 基座通过 file:// 协议注入本 main.js 后，window.Gongfang._drawInit 即可被 write.js 的 _writeSwitchMode 调用。
(function() {
  window.GongfangExtension = window.GongfangExtension || {};
  window.GongfangExtension.draw = {
    id: 'draw',
    activate: function(api, hostEl) {
      // hostEl 可选：如基座提供独立容器，则用之；否则继续使用原 #writeModeDraw 容器
      if (typeof Gongfang._drawInit === 'function') Gongfang._drawInit();
    },
    deactivate: function() {
      // 当前绘图模式不保留运行态；切走即停。如需保存可在此持久化 _drawState
    }
  };
  try { console.log('[ext] draw 已注册'); } catch (e) {}
})();
