# YYClaw 开发文档

本文介绍现有的构建、测试、打包与诊断工具。开发需求和待实现的设计方案另行维护。

本文档是 README「开发指南」一节的详细说明。

### 前置要求

- **Node.js**：对应主版本范围内的 22.22.3+、24.15.0+ 或 25.9.0+（推荐 Node 24 LTS）
- **包管理器**：仅支持 pnpm，版本由 `package.json` 的 `packageManager` 字段锁定。运行 `corepack enable` 启用。**不支持 npm 与 yarn。**
- **Linux（Ubuntu/Debian）**：运行 Electron 前，请先安装所需系统库：
  ```bash
  sudo apt-get install -y libnss3 libgtk-3-0 libxss1 libxtst6 libatspi2.0-0 libnotify4 xdg-utils
  ```
  在 Ubuntu 24.04+ 上，部分软件包使用 `t64` 后缀，运行上述命令后 `apt` 会自动选择正确版本。

### 项目结构

```YYClaw/
├── electron/                 # Electron 主进程
│   ├── services/            # 类型化 Host API、Provider、Secrets 与运行时服务
│   │   ├── providers/       # Provider/account 模型同步逻辑
│   │   └── secrets/         # 系统钥匙串与密钥存储
│   ├── shared/              # 共享 Provider schema/常量
│   │   └── providers/
│   ├── main/                # 应用入口、窗口、IPC 注册
│   ├── gateway/             # OpenClaw 网关进程管理
│   ├── preload/             # 安全 IPC 桥接
│   └── utils/               # 工具模块（存储、认证、路径）
├── src/                      # React 渲染进程
│   ├── lib/                 # 前端统一 API 与错误模型
│   ├── stores/              # Zustand 状态仓库（settings/chat/gateway）
│   ├── components/          # 可复用 UI 组件
│   ├── pages/               # Chat、Agents、Channels、Cron、Workflows、Skills、
│   │                        # Models、Settings、Setup、Dreams、
│   │                        # ImageGeneration、Login
│   ├── styles/              # 设计 token 与全局 CSS
│   └── types/               # TypeScript 类型定义
├── tests/
│   ├── e2e/                 # Playwright Electron 端到端冒烟测试
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```

> 注意：国际化资源位于 `shared/i18n/locales/<lang>/<ns>.json`，而不是 `src/i18n/`。
> Token 用量分析位于 Models 页面，没有独立的 `/dashboard` 路由。

### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载捆绑二进制（uv、agent-browser）
pnpm dev                  # 以热重载模式启动（若缺失会自动准备预装技能包）

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run test:e2e         # 运行 Electron E2E 冒烟测试
pnpm run test:e2e:headed  # 以可见窗口运行 Electron E2E 测试
pnpm run perf:chat        # 采集合成 Chat 场景的 Renderer/Main CPU Profile
pnpm run profile:main     # 启动构建产物并在 9229 端口调试 Main
pnpm run comms:replay     # 计算通信回放指标
pnpm run comms:baseline   # 刷新通信基线快照
pnpm run comms:compare    # 将回放指标与基线阈值对比

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm build                # 完整生产构建（含打包资源）
pnpm package              # 为当前平台打包（包含预装技能资源）
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 为 Windows 打包
pnpm package:linux        # 为 Linux 打包
```

在无头 Linux 环境下，Electron 测试需要显示服务；可使用 `xvfb-run -a pnpm run test:e2e`。

Electron E2E 功能测试在本地和 CI 中默认使用两个 Playwright worker；可通过 `CLAWX_E2E_WORKERS=<正整数>` 按机器能力调整普通并行通道。访问操作系统全局状态的测试进入单 worker 的 `exclusive` project，主机性能采样则在功能测试结束后独占运行。新增 E2E 测试默认并行；若测试使用真实剪贴板或其他机器级共享资源，请应用 `tests/e2e/parallel-policy.ts` 中的 `E2E_EXCLUSIVE_TAG`。

如果只需运行一个不依赖独占前置阶段的普通 spec，可使用 `pnpm exec playwright test <spec> --project=parallel --no-deps`。

### Electron 性能诊断

`pnpm run perf:chat` 会运行隔离的合成 ACP 负载，分别覆盖流式响应，以及富 Markdown 静态会话中的侧栏和滚动交互，并在 Playwright 的 `test-results/` 目录输出版本化指标与 Renderer/Main CPU Profile。Renderer Profile 覆盖生产 store/render 路径和帧节奏；流式 Main Profile 测量 Main 到 Renderer 的 IPC fanout，交互 Main Profile 用于确认 Renderer 交互期间 Main 是否保持空闲。两者都不包含上游 OpenClaw/ACP 子进程或 GPU 进程路径。CPU Profile 可直接用 Chrome DevTools 打开；其中只包含生成的测试文本，不会上报为产品遥测。性能数据依赖硬件，应在同一机器上多次运行后对比，不应使用统一的跨平台绝对阈值。

录制真实 Renderer 时，使用 `CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev` 启动开发环境，再让 Playwright 或 Chrome DevTools 连接 `localhost:9223`。录制真实 Electron Main 时，运行 `pnpm run profile:main`，在 `chrome://inspect` 中配置 `localhost:9229` 并选择 Electron Main target。除非正在测量 WebSocket trace 本身，否则不要设置 `CLAWX_GATEWAY_WS_TRACE`。

YYClaw 默认保留 Chromium 硬件加速，使长文档、滚动和布局动画能够使用 GPU 合成与光栅化。若某台机器的显卡驱动存在问题，仍可使用 Chromium 原生的 `--disable-gpu` 命令行参数作为排障回退。

### 通信回归检查

当 PR 涉及通信链路（Gateway 事件、ACP Chat bridge 收发流程、Channel 投递、传输回退）时，建议执行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI 中的 `comms-regression` 会校验必选场景与阈值。

### Electron E2E 测试

Playwright 的 Electron 套件会从 `dist/` 与 `dist-electron/` 启动打包后的渲染进程与主进程，因此无需先手动运行 `pnpm dev`。

`pnpm run test:e2e` 会自动：

- 使用 `pnpm run build:vite` 构建渲染进程与 Electron 产物
- 以隔离的 E2E 模式启动 Electron，并使用临时 `HOME`
- 使用临时的 YYClaw `userData` 目录
- 并发运行普通用例，同时隔离依赖操作系统全局状态与性能相关的测试
- 跳过较重的启动副作用，例如 Gateway 自动启动、内置技能安装、托盘创建与 CLI 自动安装

最初的基线用例覆盖：

- 全新用户配置下首次启动配置向导的可见性
- 跳过配置流程并在 Electron 应用内导航到「模型」页

后续的 Electron 流程请放在 `tests/e2e/` 下，并复用 `tests/e2e/fixtures/electron.ts` 中的共享 fixture。请避免固定的可写路径、端口、系统钥匙串等外部共享状态，以保证用例可并行；确实无法隔离时使用 `E2E_EXCLUSIVE_TAG`。

### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 40 |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |
### 打包注意事项

在 macOS 上构建 Linux `.deb` 目标需要 GNU tar 与 GNU ar（`brew install gnu-tar binutils`）。macOS 只自带 BSD 的 `ar`/`tar`，这会让内置的 `fpm` 静默产出一个 96 字节的空 `.deb`（只有一个 `__.SYMDEF` ar 符号表，并非有效的 Debian 包），而构建仍以 0 退出。`scripts/electron-builder-env.mjs` 现在会在 `darwin` + `--linux` 组合下预检此项，缺少任一工具时会带上 `brew install` 提示快速失败。AppImage 不受影响。

在 Windows 的打包构建中，内置的 `openclaw` CLI/TUI 通过随包发布的 `node.exe` 入口运行，以保持终端输入行为稳定。

### 自动开发工具

基线夹具隔离个人配置并声明独立 pnpm 工作区根目录，TMPDIR 位于 worktree 内也不会接管外层锁文件。资源锁原子写入完整所有权并幂等释放；未知归属的锁保留待核查。修复需审核、提交并推送后重新生成计划，不改写冻结的输入 SHA。

项目 harness 提供有界任务拆解、隔离 Codex 编码、独立测试验收、逐任务 Draft PR 和提交后立即清理工作区。CI 修复会重新创建临时工作区；合并和发布仍由人工控制。先运行 `pnpm harness autopilot plan --feature <id> --goal "<goal>"`，再运行 `pnpm harness autopilot run --plan <plan-file>`。需要干净且已提交的仓库、已登录的 Codex 与 GitHub CLI，以及测试依赖。外部服务需要专用沙箱凭据，缺条件不会判定验收通过。默认最多 8 个任务、2 个编码任务并行、3 轮修复、6 小时。具体安全边界和部署限制见开发 harness 指南。

Autopilot 使用本地 Codex 的模型和提供方连接（包括 cc-switch），同时隔离任务凭据和配置。请保持配置的本地代理运行；`--model` 只覆盖模型，不改变提供方。

Autopilot 从启动时的 PATH 解析并固定 Codex 可执行文件。能力检查在帮助模式下校验实际必需参数，不调用模型；帮助内容精简或写入 stderr 不会被误报为缺少参数。

[Harness](../../harness/README.md)

Playwright 文件检查和已注册的 E2E/性能脚本必须生成本次结构化报告；即使命令成功，缺失、空结果、失败或不稳定证据仍不能通过。定向或映射到验收要求的检查，无论标注何种类型，都不允许跳过；只有控制器补充的全量质量检查可保留平台排除项，且不算作需求验收通过。

规划会在冻结前补齐必需规则，包括测试任务的文档影响审查，不改变验收标准或写入范围；已冻结计划仍严格校验。

Autopilot 工作区共用项目 `node_modules/.autopilot-cache/` 下的增量 pnpm 包仓库和持久下载缓存，依赖目录仍独立，清理不会删除共享缓存。该专用缓存不是主工作区已安装的依赖树，首次使用会下载缺失的包。安装前会验证并复制版本匹配的本机 uv；必需的 GitHub 下载不可用时明确报告环境阻塞。初始化每分钟提示阶段和日志位置；`--init-timeout-minutes` 默认 30 分钟，并受总运行期限约束。

依赖初始化使用锁文件对应的 sharp 预编译模块，不探测系统 Homebrew/libvips，安装脚本仍正常执行。POSIX 集成测试使用专属短路径 socket，避免深层 worktree 目录导致地址截断。

独立验收审查必须为每条冻结标准提供唯一通过结论；重复、遗漏或未知 ID 都不能通过。`tests/unit/harness-autopilot-frozen-contract.test.ts` 用受控用例验证启动、权限、规则补齐和证据边界，不代表真实外部认证。

受控编码工作区将实际依赖及安装脚本、扩展桥接生成和启动类型检查记录到 `initialization.json`。编码前，控制器和代理按 AGENTS 启动规则核对任务、资源、基础提交及成功退出结果。复用已完成的准备，不在冻结写入范围之外重复完整 `init`。凭证缺失、失败或被修改都阻塞编码；凭证不认证可选捆绑工具，不替代任务测试与资源前提。手动开发仍采用原有启动流程。
