# 一站式数模工坊

> 本地 LaTeX 写作 / Python 代码 / 流程图绘图工作台 —— 为数学建模量身打造的 Electron 桌面应用。

离线可用、开箱即写：写作（LaTeX 编译 + 预览 + 导出 Word）、代码（Python 运行 + 文件编辑）、绘图（流程图建模 + PNG/SVG 导出），并支持局域网多人协作与可插拔扩展系统。

- 版本：`1.0.0`
- 技术栈：`Electron 33` + 原生前端（无框架）+ `better-sqlite3` + `ws`
- 许可证：`MIT`（见 [LICENSE](./LICENSE)）
- 平台：Windows（`nsis` 安装包），源码可运行于 macOS / Linux（需自行打包配置）

## 功能一览

| 模块 | 说明 |
| ---- | ---- |
| ✍️ 写作 | LaTeX 编辑器：文件树、多文件工程、XeLaTeX 编译、PDF 预览、公式渲染（KaTeX）、导出 Word（`python-docx`） |
| 💻 代码 | 代码工作台：Python 运行、实时终端输出、可终止进程、文件编辑、数模常用库一键环境检测 |
| 📊 绘图 | 流程图编辑器（AntV X6）：拖拽建模、主题切换、PNG / SVG 导出 |
| 🤝 协作 | 局域网协作：主机广播发现、一键加入、文件实时同步、光标/浏览状态共享、文件锁、编译投票、共享文件区 |
| 🧩 扩展 | 可插拔扩展系统：内置 `write / draw / code`，支持第三方目录 / zip 包安装、启用/禁用、卸载、热重载 |
| 📁 工作区 | 自选工作目录 + 最近历史，SQLite 本地持久化设置与状态 |
| 🛠️ 环境 | LaTeX / Python 分层自动检测 + 用户手动指定目录，PATH 隔离避免与外部 TeX 冲突 |

## 快速开始

### 环境要求

- Node.js ≥ 18（建议 20 LTS）
- npm ≥ 9
- Python ≥ 3.9（仅「代码运行 / 导出 Word」功能需要）
- LaTeX 发行版（二选一）：
  - 自动检测本机已安装的 TeX Live / MiKTeX / TinyTeX，或
  - 在「设置」中手动指定集成环境目录（推荐随软件分发的 `assets/tinytex`）

### 本地运行

```bash
npm ci
npm start
```

> 也可以用 `npm install` 代替 `npm ci`，但推荐 `npm ci` 以保证与 `package-lock.json` 完全一致。

调试多开联调协作（跳过单实例锁）：

```bash
npx electron . --multi-instance
# 或
npx electron . --dev --multi-instance
```

### 打包

```bash
# 仅打包目录（免安装调试）
npm run pack

# 生成 Windows 安装包（nsis）
npm run dist
```

## 目录结构

```
.
├── main.js                 # 入口：加载 src/core/bootstrap
├── preload.js              # 预加载桥：文件/写作/代码/协作/扩展 API
├── src/
│   ├── core/               # 启动流程：bootstrap / window / workspace / database / config
│   ├── env/                # 环境检测：latex.js / python.js / assets.js
│   ├── ipc/                # 主进程 IPC：write / code / file / collab / extension / settings…
│   └── services/           # 业务服务：collab-server / collab-client / write / word-export…
├── renderer/               # 渲染进程（无框架原生前端）
│   ├── index.html / index.js / ui.js / state.js / storage.js
│   ├── panels/             # 设置 / 协作面板
│   ├── shared/             # dom / dialog / icons / 运行检测等公共模块
│   ├── ui/                 # write / ext / settings 面板 HTML
│   └── vendor/             # KaTeX 等本地化第三方库
├── extensions/builtin/     # 内置扩展
│   ├── write/              # 写作（宿主扩展，slot=workshop）
│   ├── draw/               # 绘图（AntV X6）
│   └── code/               # 代码（Python 运行）
├── assets/                 # 图标 / Word 导出模板 / python-requirements-base.txt
```

## 扩展开发

每个扩展为一个目录，至少包含 `manifest.json` + `main.js`：

```json
{
  "id": "my-ext",
  "name": "我的扩展",
  "version": "1.0.0",
  "main": "main.js",
  "slot": "workshop",
  "button": { "label": "示例", "order": 10 }
}
```

- 内置扩展位于 `extensions/builtin/<id>/`
- 第三方扩展安装到用户数据目录 `extensions/<id>/`（可通过「扩展 → 打开扩展目录」查看）
- 支持从目录或 `.zip` 包安装（zip 内须含 `manifest.json`），同 `id` 时第三方覆盖内置
- 内置扩展不可卸载、仅可禁用；第三方可卸载
- 安装后可在「扩展」面板启用 / 禁用 / 重载，无需重启（`extension:reload`）

## Python 依赖

数模常用库清单见 [`assets/python-requirements-base.txt`](./assets/python-requirements-base.txt)，包括 `numpy / pandas / scipy / scikit-learn / matplotlib / seaborn / python-docx / pymupdf` 等。

```bash
pip install -r assets/python-requirements-base.txt
```

## 常见问题

- **启动白屏 / 报错原生组件不匹配**：多为杀软隔离或安装损坏导致 `better-sqlite3` 加载失败，重装即可；也可在「设置」中重新检查环境。
- **找不到 LaTeX**：先确认本机 TeX 可用，或在设置中手动指定集成环境目录。
- **协作连不上**：确保同一局域网 / 同一 Wi-Fi，且防火墙放行应用；主机可在协作面板查看成员与共享文件。

## 贡献

欢迎提 Issue / PR：

1. Fork 本仓库
2. 新建分支 `feat/xxx` 或 `fix/xxx`
3. 提交并推送后发起 Pull Request

## License

[MIT](./LICENSE) © 2026 shenxiu666
