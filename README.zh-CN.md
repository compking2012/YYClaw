
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="YYClaw Logo" />
</p>

<h1 align="center">YYClaw</h1>

<p align="center">
  <strong>OpenClaw AI 智能体的桌面客户端</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#为什么选择-yyclaw">为什么选择 YYClaw</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/YYClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja-JP.md">日本語</a> | <a href="README.ru-RU.md">Русский</a>
</p>

---

## 概述

**YYClaw** 是连接强大 AI 智能体与普通用户之间的桥梁。基于 [OpenClaw](https://github.com/OpenClaw) 构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

*配置存储说明：* 当前阶段，所有配置文件（包含 `openclaw.json`、`auth-profiles.json` 等）在开发与正式安装包中均**默认以明文保存**。此举旨在缓解与 OpenClaw 上游配置健康监控机制的冲突（若密文解析结果或体积相对旧基线突变，易产生 `.clobbered` 异常备份文件）。历史遗留的密文配置（`CLAWX_ENCRYPTED_v1:`）仍可正常读取兼容。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，YYClaw 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

YYClaw 预置了最佳实践的模型供应商配置，原生支持 Windows 平台以及多语言设置。当然，你也可以通过 **设置 → 高级 → 开发者模式** 来进行精细的高级配置。

## 截图预览

<p align="center">
  <img src="resources/screenshot/zh/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/cron.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/skills.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/channels.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/models.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/settings.png" style="width: 100%; height: auto;">
</p>

---

## 为什么选择 YYClaw

构建 AI 智能体不应该需要精通命令行。YYClaw 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面。**

| 痛点 | YYClaw 解决方案 |
|------|----------------|
| 复杂的命令行配置 | 一键安装，配合引导式设置向导 |
| 手动编辑配置文件 | 可视化设置界面，实时校验 |
| 进程管理繁琐 | 自动管理网关生命周期 |
| 多 AI 供应商切换 | 统一的供应商配置面板 |
| 技能/插件安装复杂 | 内置技能市场与管理界面 |

### 功能特性

YYClaw 直接基于官方 **OpenClaw** 核心构建。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验。
- **🎯 零配置门槛**：从安装到第一次 AI 对话，全程指引式图形界面，无需终端命令、YAML 配置或环境变量。
- **💬 智能聊天界面**：多会话上下文与历史记录，流式 Markdown 渲染（语法高亮、CJK 排版、表格、KaTeX 公式）、`@agent` 直接路由与 `/技能` 内联卡片，工作空间优先的会话侧边栏，以及 Markdown、`.docx`、`.pptx` 和本地 HTML 的只读预览。
- **📡 多频道管理**：同时配置和监控多个 AI 频道，每个频道独立运行并支持多账号；内置腾讯官方个人微信渠道插件。
- **⏰ 定时任务自动化**：可视化定义触发器与时间间隔，让 AI 智能体 7×24 小时自动运行；支持周期（每小时/每天/工作日/每周/自定义 cron）与单次执行，并可将结果自动投递到外部频道。
- **🧩 可扩展技能系统**：本地优先的技能管理，扫描托管与 workspace 技能目录，无需依赖 Gateway 即可启用或停用技能；预装文档处理技能（`pdf`、`xlsx`、`docx`、`pptx`）。
- **🔐 安全的供应商集成**：支持 OpenAI、Anthropic、Z.AI / GLM 等供应商，凭证经系统原生密钥链安全存储；提供自定义 Provider、OAuth 登录、图像生成端点与兼容网关的降级探测。
- **🌙 自适应主题**：支持浅色、深色与跟随系统主题。
- **🚀 开机启动控制**：在 设置 → 通用 中开启开机自动启动。
- **🔔 更新提示**：启动时自动检查新版本，由你决定是否下载或安装更新。

> 对于功能细节的完整说明，请参阅 [docs/zh-CN/features.md](docs/zh-CN/features.md)。

---

## 功能特性

### 🎯 零配置门槛
从安装到第一次 AI 对话，全程通过直观的图形界面完成。无需终端命令，无需 YAML 文件，无需到处寻找环境变量。

### 💬 智能聊天界面
通过现代化的聊天体验与 AI 智能体交互。支持多会话上下文、消息历史记录、以 Markdown 渲染智能体回复（包括 GitHub 风格表格以及由 KaTeX 渲染的 LaTeX 数学公式：`$行内$`、`$$块级$$`、`\(行内\)` 和 `\[块级\]`），用户输入则始终按原始文本显示；同时支持在多 Agent 场景下通过主输入框中的 `@agent` 直接路由到目标智能体。
当你使用 `@agent` 选择其他智能体时，YYClaw 会直接切换到该智能体自己的对话上下文，而不是经过默认智能体转发。各 Agent 工作区默认彼此分离，但更强的运行时隔离仍取决于 OpenClaw 的 sandbox 配置。
从输入框插入的技能会以 `/技能名` 卡片形式显示；点击卡片可在右侧预览栏打开并阅读该技能的 `SKILL.md`。
当你使用 `@agent` 选择其他智能体时，YYClaw 会直接切换到该智能体自己的对话上下文，而不是经过默认智能体转发。各 Agent 工作区默认彼此分离，但更强的运行时隔离仍取决于 OpenClaw 的 sandbox 配置。
会话侧边栏现在以工作空间优先组织：默认工作空间固定在最上方，其它工作空间按自然顺序排列，每个工作空间都可折叠或继续加载更多会话。AI 回复期间，会话行显示加载指示器；未查看的回复完成后显示蓝点；打开会话后恢复显示相对活跃时间，悬停时仍会露出操作按钮。导入的工作空间可从侧边栏标题处重命名，新名称会同步显示在对话输入框下方，同时悬浮标题仍可查看文件系统路径。如果当前所选会话存在有效工作空间，新对话会继承该工作空间，并在首次发送前保持可编辑。对于可编辑的新对话或未绑定对话，输入框的工作空间卡片会打开一个小菜单，列出最近使用及现有会话中的工作空间，并可切回默认工作空间或选择其它目录。如果保存的工作空间文件夹已被移动或删除，Chat 会暂停创建会话并提示选择现有文件夹，而不会持续重试失效路径。不可用的非默认工作空间会在侧边栏显示标记，并可在确认后删除；该操作会永久删除分组中的全部会话。OpenClaw 生成的 UUID 加日期兜底标题只有在与该会话 ID 匹配时才会被视为缺失标题，随后改用会话的首条用户消息展示，而不会被持久化为会话名称。冷启动或网关重启后——只要你还没有主动打开某个具体会话——Chat 会停在一个全新的空对话上，而不是恢复最近更新过的旧会话；已有会话仍会保留在侧边栏中。
每个 Agent 还可以单独覆盖自己的 `provider/model` 运行时设置；未覆盖的 Agent 会继续继承全局默认模型。
聊天输入框还提供 **技能** 选择器（插入 `/技能名  ` 令牌并高亮显示，点击可预览 `SKILL.md`）以及在有多个已配置模型时的 **模型** 选择器。模型变更由 OpenClaw 原生配置 watcher 热加载，不会重启 Gateway；YYClaw 会等待实时 `agents.list` 快照确认所选模型后再允许发送下一条消息。

### 🎙️ 语音交互
与智能体语音对话、并听取语音回复。语音能力完全通过 OpenClaw 内核原生的 Talk/TTS 网关 RPC 实现，无需额外服务。
- **语音输入**复用 OpenClaw **Talk 模式**。*听写*（按下说话）会把语音实时转写到输入框，确认后再发送；*连续对话*模式则进入免提的持续对话（聆听 → 思考 → 讲话），由服务端做语音活动检测与打断（barge-in）。可在 **设置 → 语音** 中切换模式。
- **语音输出（TTS）**：每条助手回复都带有 🔊 播放按钮；在 **设置 → 语音 → 自动朗读** 中可让最终回复自动朗读。
- **语音模型**在 **模型** 页与聊天 provider 一起列出。provider 定义在远程 provider 目录可达时以远程为准,不可达时回退本地内置的 `resources/config/providers.json`(两者二选一,不合并)——因此提供哪些能力类型(包括 `tts` / `transcription` / `realtime`)取决于该来源。配置该 provider 的 API 密钥、模型与 Base URL;选择结果写入 OpenClaw 配置（`messages.tts` 与 `voice-call` 插件）。本版本支持 **OpenAI** 与 **MiniMax** 两家内置语音 runtime,由 provider 的 `voiceRuntimeProviderId` 指定。语音参数（音色 / 音频格式 / 语速 等）已内置在这两家 runtime 中,本次暂不支持用户配置;支持语音的提供商只需声明其语音模型 id,保存账号时（或将其切换为默认 provider 时）这些类目会自动桥接写入 OpenClaw 语音配置段。删除某个语音提供商、或在智能体 **全局配置** 中关闭语音合成（现已改为标准的启用开关）时，会从这些语音配置段中移除相关条目；若仍有其它已配置的提供商可用，则将其顶替为缺省。注意：OpenAI 的 TTS 会使用该 Base URL，但内核的 realtime 转写端点固定为 `api.openai.com`（该处暂不应用 Base URL）；realtime 语音还要求内核存在与语音 provider id 同名的能力插件。Anthropic Claude 无语音模型——可用 Claude 作为对话大脑，叠加其它服务商的 TTS/ASR。语音严格按配置启停:当配置中未设置 `messages.tts` / 转写 provider 时,对应界面控件(🔊 播放按钮、🎙️ 录音按钮)置灰不可用,桌面端也会拒绝 TTS/转写调用——没有内置默认兜底。
- 首次使用会请求麦克风权限；macOS 上会弹出系统麦克风授权。

### 🌙 OpenClaw 梦境
系统设置弹窗中的 **记忆** Tab 用于管理 OpenClaw `memory-core` 做梦功能（状态、日记、维护、启用/停用）。需要 Gateway 已就绪，并在 OpenClaw 侧配置好 dreaming 插件。

Chat 右侧面板的工作空间和预览选项卡支持以只读方式预览 `.docx` 和 `.pptx` 文件。预览栏顶部可将当前文件展开至 YYClaw 的整个可视区域；再次点击该按钮或按 Esc 即可返回侧栏。旧版 `.doc` 和 `.ppt` 文件不会在应用内预览，而是继续通过操作系统打开。DOCX 的分页效果可能与 Microsoft Word 不同；PPTX 预览不支持动画、切换效果或媒体播放。超过 20 MB 的 Office 文件不会在应用内预览。

### 本地 HTML 预览
Chat 右侧面板只包含工作空间、预览和变更，不再提供通用网页浏览器、主页或地址栏。已授权的本地 `.html` 和 `.htm` 附件、文件活动及工作空间文件默认在预览中打开。文件操作可以选择 YYClaw 内置预览或系统应用，预览标题栏也可将当前 HTML 文件交给系统浏览器打开。

所有链接都不可点击。YYClaw 渲染的链接显示为普通文本，HTML 预览中的链接也会移除链接样式和指针交互。HTML 预览同时阻止表单、脚本跳转、重定向、页内跳转、弹窗、下载、网络请求和设备权限；它可以显示自包含的本地 HTML，但无法离开当前选中的文档。

### 📡 多频道管理
同时配置和监控多个 AI 频道。每个频道独立运行，允许你为不同任务运行专门的智能体。
现在每个频道支持多个账号，并可在 Channels 页面直接切换默认账号。账号与智能体的绑定已移至 Agents 页面：每个智能体卡片上都有「绑定频道」按钮，可在弹窗中一次性把多个频道账号绑定到该智能体（每个账号同一时间只由一个智能体处理）。
对于自定义频道账号 ID，YYClaw 现在会强制校验 OpenClaw 兼容的规范格式（`[a-z0-9_-]`、小写、最长 64 位、且必须以字母或数字开头），避免路由匹配异常。
YYClaw 现在还内置了腾讯官方个人微信渠道插件，可直接在 Channels 页面通过内置二维码流程完成微信连接。
一键创建飞书应用时还会自动为机器人配置「快捷指令」菜单（`/new`、`/stop`、`/reset`、`/status`、`/compact`），用户无需手动输入，点击机器人菜单即可发送会话控制命令给 OpenClaw。

### ⏰ 定时任务自动化
调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。
现在定时任务页面已经可以直接配置外部投递，统一拆成“发送账号”和“接收目标”两个下拉选择。对于已支持的通道，接收目标会从通道目录能力或已知会话历史中自动发现，不需要再手动修改 `jobs.json`。任务的消息输入框也支持像主对话框那样以内联 `/skill` 令牌的方式插入技能（按所选智能体范围加载），让定时提示词可以直接触发技能。调度选择器现在分为**周期**和**单次**两个选项卡：周期支持每小时、每天、工作日、每周、自定义（原始 cron）等频率，并内置时间/星期选择；单次则在所选日期（显示星期）和时间执行一次。单次任务必须设置为未来时间，并会在执行完成后由运行时自动清除。升级到使用 SQLite 存储 cron 的运行时后，YYClaw 会在首次启动时无感地把可恢复的用户任务从旧 `jobs.json` / `jobs.json.bak` 重新写入新存储，原件归档到 `~/.openclaw/cron/legacy-archive/`；`[managed-by=...]` 内部任务交由运行时自行重建。


### 🔀 确定性工作流引擎
对于步骤明确的任务，**工作流** 页面在主进程中运行一个确定性编排引擎（XState v5）。控制流——走哪个节点、走哪个分支、循环几次——100% 固定；只有被显式标记为 *模型*（或 *智能体*）步骤的节点才带有非确定性，并通过强约束收敛（`temperature=0` + zod 校验 + 有限重试），失败时还可回退到确定性路径。每次运行都会产出逐节点 trace，将每一步标注为 **确定性** 或 **模型**；运行态以带版本的 JSON 快照持久化在 `userData/workflows/` 下（崩溃后从断点恢复且不重跑已完成步骤）；进度通过 `workflow:progress` 事件通道实时推送到界面。引擎是“驾驭” OpenClaw 而非相反：确定性步骤就是主进程里的普通函数，单次受约束的模型步骤直接对接已配置的 Provider（绕开 agent loop）。当聊天任务被自动路由为工作流时，它会**内联到对话中**作为一条过程消息显示——query 气泡立即出现，服务端分诊（生成步骤）期间输入框复用与普通对话回合一致的"思考中"指示（此时工作流卡片的紧凑链接暂不显示）；步骤生成完毕后卡片链接就地出现并自动弹出进度小窗，点击卡片可重新打开小窗、点击旁边即可收起；每个节点作为主对话的子会话运行（而非单独的顶层 session），完成后会把一条综合反馈消息回灌到主对话。


### 🧩 可扩展技能系统
通过预构建的技能扩展 AI 智能体的能力。集成的 Skills 页面采用“本地优先”方式：扫描托管目录、内置技能、扩展技能与插件技能；不再扫描 workspace、`.agents` 与 `skills.load.extraDirs`，从而避免多目录中的重复版本。无需依赖 Gateway 即可启用或停用技能——无需包管理器。
Skill 现已按 Agent 作用域生效（`agents.list[].skills`）：在新建/编辑 Agent 时选择该 Agent 可用技能，不再对所有 Agent 全局联动；历史全局启用状态会一次性迁移到每个存量 Agent 以保持行为不变。
根目录 `package.json` 使用统一的 **`farmApiBaseUrl`**（仅协议、主机与端口，例如 `http://aiserver.example.com:9001`）作为服务端基址。应用从该基址请求 `GET /api/v1/provider-catalog` 加载 AI 提供商目录；「安装技能」侧栏（服务端来源）在同一基址下使用 `GET /api/v1/skill_list`（浏览）、`GET /api/v1/skill_search?q=`（筛选）、`GET /api/v1/skill_file/:name`（安装 zip）；如需 Bearer 鉴权可使用应用设置中的 Farm 令牌。
YYClaw 还会内置预装完整的文档处理技能（来自 `anthropics/skills` 的 `pdf`、`xlsx`、`docx`、`pptx`），并额外预置一批精选技能（GitHub、tmux、Notion、Obsidian、Trello、weather 等），这些技能在构建期通过独立的 `skills` CLI（`npx skills add …`，不依赖 OpenClaw CLI）拉取打包。全部技能在启动时自动部署到托管技能目录（默认 `~/.openclaw/skills`），并在首次安装时默认启用。带平台限制的技能（如 Apple 系列）仅在 macOS 上部署。
Skills 页面会显示每个技能的实际路径，便于直接打开真实安装位置。安装与已有托管技能元数据名称或 slug 相同的技能时会要求确认；确认后的替换采用事务式处理，安装失败会恢复原技能。

### 🔐 安全的供应商集成
连接多个 AI 供应商（OpenAI、Anthropic、Z.AI / GLM 等），凭证安全存储在系统原生密钥链中。OpenAI 同时支持 API Key 与浏览器 OAuth（Codex 订阅）登录。
在开发者模式下，独立的“图像生成”页面支持配置 OpenAI 兼容生图端点（Base URL、API Key 和模型名，例如 `gpt-image-2`），生图请求会走专用的 `/v1/images/generations` 服务，聊天仍继续使用正常的 OpenAI Provider。
Chat 里的自然语言生图不需要那个开发者页面。只要在 **设置 → AI Providers** 里给某个 Provider 账号勾选 `image_generate` 这个 model kind，它自己的 provider key（例如 `gptimage2-gptimage/gpt-image-2`）就能直接生效 —— YYClaw 内置的两个生图插件会从 `openclaw.json` 里自检出哪些 provider key 承载了自己那一族的模型（`clawx-openai-image` 认领 `gpt-image-*` / `dall-e-*`，`clawx-gemini-image` 认领 `gemini-*-image`），并把这些 key 声明成自己的 alias，因此不会新建任何 `models.providers` 条目，也不会复制 API Key。这么做的原因是 OpenClaw 只会在自己的生图注册表里解析生图 Provider，`models.providers` 里的普通条目永远不算。`imageGenerationModel.primary` 里早已写死的模型 ID 直接决定协议，运行时不做任何探测；不属于这两族的模型（例如 minimax 的 `image-01`、Google 的 `imagen-*`）留给 OpenClaw 自带的生图 Provider 处理。两个插件的区分是必需的：OpenAI 兼容中转站会拒绝在 `/v1/images/generations` 上使用非 imagen 的 Gemini 模型，而 OpenClaw 内置的 `google` 生图 Provider 把 baseUrl 硬锁在 `generativelanguage.googleapis.com`，无法指向中转站。YYClaw 的启动流程还会在需要任一插件时设置 `agents.defaults.mediaGenerationAutoProviderFallback = false`，因此中转站不支持的模型会直接报出中转站自己的错误，而不会静默改用另一个已鉴权的 Provider 出图。
如果你通过 **自定义（Custom）Provider** 对接 OpenAI-compatible 网关，可以在 **设置 → AI Providers → 编辑 Provider** 中配置自定义 `User-Agent`，以提高兼容性。
编辑或切换 Provider 时，YYClaw 会保留已有的模型级能力元数据，例如 `input: ["text", "image"]`。新选择的自定义 Provider 模型会使用与 OpenClaw onboarding 一致的图片输入能力推断；未知模型默认按纯文本模型处理。
自定义 Provider 的模型行还会写入显式的 `contextWindow`（按模型系列推断，例如 `gpt-5.x` → 272k），旧版本保存的模型行会在启动时自动回填，使 OpenClaw 能在长会话超限前主动压缩上下文，避免出现 "Context overflow" 报错。当你没有配置 compaction 时，YYClaw 会默认写入 `agents.defaults.compaction.mode = "safeguard"` 和 `reserveTokensFloor = 50000`；你手动配置过的模型行或压缩配置永远不会被修改（仅可能回填缺失的 `reserveTokensFloor`）。
Z.AI（国内站 / 国际站）会映射到 OpenClaw 内置的 `zai` 供应商（`ZAI_API_KEY`），默认模型为 `glm-5.2`。可通过 Code Plan 预设切换到编码套餐端点（`…/api/coding/paas/v4`），或使用普通 API 端点（`…/api/paas/v4`）；国内站与国际站互斥，因为它们共享同一个 OpenClaw 运行时 key。
如果兼容网关的 `/models` 因非鉴权原因不可用，YYClaw 会在校验 API Key 时自动降级为轻量的 `/chat/completions` 或 `/responses` 探测。

### 🌙 自适应主题
支持浅色模式、深色模式或跟随系统主题。YYClaw 自动适应你的偏好设置。

### 🚀 开机启动控制
在 **设置 → 通用** 中，你可以开启 **开机自动启动**，让 YYClaw 在系统登录后自动启动。

---
### 典型使用场景

- **🤖 个人 AI 助手**：配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。
- **📊 自动化监控**：设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件，结果将推送到你偏好的通知渠道。
- **💻 开发者效率工具**：将 AI 融入你的开发工作流，使用智能体进行代码审查、生成文档或自动化重复性编码任务。
- **🔄 工作流自动化**：将多个技能串联起来，创建复杂的自动化流水线——处理数据、转换内容、触发操作，全部通过可视化方式编排。

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：1GB 可用磁盘空间

### 安装方式

#### 预构建版本（推荐）

从 [Releases](https://github.com/ValueCell-ai/YYClaw/releases) 页面下载适用于你平台的最新版本。

#### 从源码开始

```bash
# 克隆仓库
git clone https://github.com/ValueCell-ai/YYClaw.git
cd YYClaw

# 初始化项目
pnpm run init

# 以开发模式启动
pnpm dev
```
### 首次启动

首次启动 YYClaw 时，**设置向导** 将引导你完成以下步骤：

1. **语言与区域** – 配置你的首选语言和地区
2. **AI 供应商** – 通过 API 密钥或 OAuth（支持浏览器/设备登录的供应商）添加账号
3. **技能包** – 选择适用于常见场景的预配置技能
4. **验证** – 在进入主界面前测试你的配置

如果系统语言在支持列表中，向导会默认选中该语言；否则回退到英文。

> Moonshot（Kimi）说明：YYClaw 默认保持开启 Kimi 的 web search。  
> 当配置 Moonshot 后，YYClaw 也会将 OpenClaw 配置中的 Kimi web search 同步到中国区端点（`https://api.moonshot.cn/v1`）。

### 代理设置

YYClaw 内置了代理设置，适用于需要通过本地代理客户端访问外网的场景，包括 Electron 本身、OpenClaw Gateway，以及 Telegram 这类频道的联网请求。

打开 **设置 → 网关 → 代理**，配置以下内容：

- **代理服务器**：所有请求默认使用的代理，填写例如 `http://127.0.0.1:7890`
- **绕过规则**：需要直连的主机，使用分号、逗号或换行分隔
- 在 **开发者模式** 下，还可以单独覆盖：HTTP 代理、HTTPS 代理、ALL_PROXY / SOCKS

本地代理的常见填写示例：

```text
代理服务器: http://127.0.0.1:7890
```
说明：

- 只填写 `host:port` 时，会按 HTTP 代理处理。
- 高级代理项留空时，会自动回退到“代理服务器”。
- 保存代理设置后，Electron 网络层会立即重新应用代理，并自动重启 Gateway。
- 如果启用了 Telegram，YYClaw 还会把代理同步到 OpenClaw 的 Telegram 频道配置中。
- 当 YYClaw 代理处于关闭状态时，Gateway 的常规重启会保留已有的 Telegram 频道代理配置。
- 如果你要明确清空 OpenClaw 中的 Telegram 代理，请在关闭代理后点一次“保存代理设置”。
- 在 **设置 → 高级 → 开发者** 中，可以直接运行 **OpenClaw Doctor**，执行 `openclaw doctor --json` 并在应用内查看诊断输出。
- 在 **设置 → 高级**(需打开开发者模式)中，**会话自动清理策略** 表单可将 `session.maintenance`(mode / pruneAfter / maxEntries / maxDiskBytes)写入 `openclaw.json`，让 Gateway 按自身计划自动剪除过期/超额的会话;`mode` 缺省为 `enforce`,启动时若未设置会自动补上。`~/.openclaw/agents/*/sessions/` 下的会话转录是只追加的,可能增长到数 GB;Dashboard/用量读取现已改用按 mtime/size 的增量缓存,大目录不再在主进程上反复全量重读。
- 在 Windows 打包版本中，内置的 `openclaw` CLI/TUI 会通过随包分发的 `node.exe` 入口运行，以保证终端输入行为稳定。

---
> 开发者模式覆盖项、Telegram 代理同步与 **OpenClaw Doctor** 等详细行为说明，请参阅 [docs/zh-CN/proxy-settings.md](docs/zh-CN/proxy-settings.md)。

## 应用更新

**macOS：** 使用应用内自动更新或点击 **安装并重启** 时，请先将 YYClaw 从 DMG **拖入「应用程序」(/Applications)** 后再从该处启动。若长期从已挂载的 DMG 内直接运行（或从其他只读卷运行），更新程序可能无法替换 `.app` 包，表现为点击安装后无反应。

---

## 应用更新（维护者）

主进程从 `{CDN}/{channel}/` 拉取 generic 更新清单（channel 由应用 semver 推导，稳定版一般为 `latest`）。若要 **强制升级**，请在对应 channel 的 `*-mac.yml` / `*.yml` **根级** 发布 `forceUpdate: true`，以便 `electron-updater` 将其传入 UI。channel 目录须与应用的预发布标签一致，否则稳定版会读到错误的清单。

---

## 系统架构

YYClaw 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理：

- **进程模型**：Electron 主进程负责窗口、网关进程监控、系统集成与自动更新；OpenClaw Gateway 作为独立运行时进程提供 AI 编排、频道和技能能力；渲染层不直接访问本地端点。
- **配置交付**：Gateway 运行时由 Main 使用 `config.get` / `config.set`，停止或启动中则更新解析后的 JSON5 配置；普通 Provider/Agent/Skill/模型修改不会替换进程，凭据通过 `secrets.reload` 热更新；连续 4 次心跳无响应后才会请求受生命周期保护的自动恢复。
- **ACP Chat**：Chat UI 基于 ACP ([Agent Client Protocol](https://agentclientprotocol.com)) 与 OpenClaw 交互，从而在高速迭代的 OpenClaw 前找到相对稳定的聊天协议面。ACP 走 Main 持有的 stdio bridge，支持配置热重载后的历史回放认证、跨页面持续流式输出，以及由 Main 验证和加载的媒体/附件/文件活动（Changes）展示。当受保护的 Gateway 重启中断已接收的对话轮次时，补丁后的 OpenClaw 运行时会将恢复 run 显式关联到原 ACP prompt，使后续文本和工具活动继续进入同一个内存轮次；之后的历史回放也会以原生 ACP 更新恢复持久化的工具边界。
- **设计原则**：前端调用单一入口、Main 掌控传输策略、优雅恢复（重连/超时/退避）、安全存储与 CORS 安全。

打开其它会话或页面时，尚未完成的 ACP 回复仍会继续流式接收。若在回复完成前返回，YYClaw 会恢复最新的内存 timeline 并继续显示实时输出；回复完成后，普通 ACP 历史回放仍是唯一事实来源。

ACP assistant 回合会显示整轮耗时。Live 计时跟随客户端观测到的 prompt 生命周期，并在应用内导航后保持连续；历史耗时由 Electron Main 根据有界的 OpenClaw transcript 时间戳计算，而且只能标注 ACP 回放已经恢复出的回合。

ACP Chat 会将标准 ACP resource 渲染为附件。用户选择的图片会显示为缩略图，并在悬停蒙层中显示文件名；其它可用的附件卡片会显示文件名，以及灰色、可截断的来源路径。当前 OpenClaw ACP adapter 遗漏 assistant 媒体时，OpenClaw 持久化的规范媒体事实和显式 assistant `MEDIA:` 指令也可恢复为附件卡片，且不会显示仅用于 transcript 的元数据。现有本地文件引用（包括当前 workspace 外的路径）在每次预览或打开前，都会由 Electron Main 按精确的 session 和 generation 重新验证。AI 生成且可预览的本地附件（包括不超过 20 MB 的 `.docx` 和 `.pptx` 文件）会保留主要的只读应用内预览操作，并提供次级菜单，可通过兼容应用打开，或在 Finder、文件资源管理器或系统文件管理器中显示。对于本地 HTML 附件，该菜单第一项会在右侧预览中打开文件。Office 预览在此处也有相同限制：`.doc` 和 `.ppt` 仍通过系统应用打开，DOCX 的分页效果可能与 Microsoft Word 不同，PPTX 的动画、切换效果和媒体播放不受支持。兼容应用发现仅在 macOS 和 Windows 上可用；在 Linux 上或发现失败时，会静默降级为仅显示文件位置。其它本地文件（包括超过 20 MB 的 Office 文件）会在用户点击后通过系统应用打开。用户选择的文件夹附件在发送后也会保持可用，点击后交给系统文件管理器打开；YYClaw 不会读取或预览其中内容。远程 HTTP 和 HTTPS 附件会在用户点击后从外部打开。没有规范媒体事实佐证的普通文本裸路径或行内路径不会被当作附件。

ACP Chat 也可在 runtime 以可信结构化媒体投递图像生成结果时显示生成图片预览。对于可信的 OpenClaw internal-UI 投递和与生图任务关联的最终回复，YYClaw 会保留原始的用户可见完成文案，包括只有文本的失败说明，而不会统一替换成通用图片文案。历史 OpenClaw 回放中，assistant 的图片 `MEDIA:` 标记只有在同一会话已记录图像生成任务启动后才会进入内联图片体验。YYClaw 通过 Electron Main 的主机媒体处理加载预览，而不是让 Renderer 任意访问文件系统。标准 ACP 图片和 resource 内容仍是首选路径，并会直接渲染。

### ACP 文件活动语义

- 文件活动由成功且已完成的 OpenClaw `write`、`edit` 和 `apply_patch` 调用投影而来。工具识别方式与 OpenClaw 官方 Chat UI 保持一致；仅接收已完成调用的筛选规则是 YYClaw 特有的。
- 已创建和已修改的活动行与可预览的 assistant 附件共用同一种文件卡片外壳和**打开方式**菜单，同时保留状态文字及可用的 `+/-` 统计。对于 HTML 文件，菜单第一项会在右侧**预览**中打开文件；已删除的活动行只保留 **Changes** 操作。应用列表、指定应用打开和显示文件位置都会由 Electron Main 根据 workspace 根目录与相对路径分别重新验证；工具路径不会因此变成附件，Renderer 也不会获得规范化系统路径。
- `write` 按工具声明的语义显示：视为创建，并展示为全部新增的差异，即使该路径可能已经存在。
- **Changes** 是按时间顺序记录工具声明活动的会话级记录，不是 Git 输出，也不是相对于已验证源码基线的差异。
- 对每个文件，Changes 在每轮助手回复中最多展示一个 diff 编辑器。可安全串联的片段会合并，独立片段会拼接到同一个编辑器中，但不会被描述为基于完整文件基线的差异。
- Shell 命令、脚本、用户或 IDE 产生的副作用不会被检测。
- 完整的 ACP 回放可以恢复已记录的文件活动；如果回放不完整，YYClaw 不会通过回退推断来补造缺失活动。

```
┌─────────────────────────────────────────────────────────────────┐
│                        YYClaw 桌面应用                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron 主进程                                 │  │
│  │  • 窗口与应用生命周期管理                                      │  │
│  │  • 网关进程监控                                               │  │
│  │  • 系统集成（托盘、通知、密钥链）                                │  │
│  │  • 自动更新编排                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（权威控制面）                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React 渲染进程                                   │  │
│  │  • 现代组件化 UI（React 19）                                   │  │
│  │  • Zustand 状态管理                                           │  │
│  │  • 统一 host-api/api-client 调用                               │  │
│  │  • 回复使用 Markdown，用户输入按原文显示                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 类型化 IPC 请求
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  主进程 Host Services 与 Gateway Manager          │
│                                                                 │
│  • host:invoke 类型化服务分发                                      │
│  • 设置、文件、会话、技能、供应商、诊断服务                           │
│  • 主进程持有 Gateway WebSocket 并负责进程监控                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 主进程持有 WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw 网关                                 │
│                                                                  │
│  • AI 智能体运行时与编排                                          │
│  • 消息频道管理                                                   │
│  • 技能/插件执行环境                                              │
│  • 供应商抽象层                                                   │
└─────────────────────────────────────────────────────────────────┘
```
### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：ACP Chat stdio bridge 与 Gateway 传输都由 Electron Main 持有，渲染进程通过类型化 IPC 调用 Main
- **扩展 IPC 贡献点**：主进程扩展通过类型化 IPC 注册表贡献 host-api action，而不是挂载 HTTP route
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：渲染进程不直接请求本地 Gateway 或 Host API HTTP 端点

### 进程模型与 Gateway 排障

- YYClaw 基于 Electron，**单个应用实例出现多个系统进程是正常现象**（main/renderer/zygote/utility）。
- 单实例保护同时使用 Electron 自带锁与本地进程文件锁回退机制，可在桌面会话总线异常时避免重复启动。
- 滚动升级期间若新旧版本混跑，单实例保护仍可能出现不对称行为。为保证稳定性，建议桌面客户端尽量统一升级到同一版本。
- 但 OpenClaw Gateway 监听应始终保持**单实例**：`127.0.0.1:18789` 只能有一个监听者。
- 可用以下命令确认监听进程：
  - macOS/Linux：`lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows（PowerShell）：`Get-NetTCPConnection -LocalPort 18789 -State Listen`
- 点击窗口关闭按钮（`X`）默认只是最小化到托盘，并不会完全退出应用。请在托盘菜单中选择 **Quit YYClaw** 执行完整退出。
- 若 Gateway 启动失败并提示 `OpenClaw package not found at: <安装目录>/resources/openclaw`，说明安装目录下的内置运行时缺失。这类失败会关闭自动重连（重试无法恢复文件），请重新安装 YYClaw。

---

## 使用场景

### 🤖 个人 AI 助手
配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。

### 📊 自动化监控
设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件。结果将推送到你偏好的通知渠道。

### 💻 开发者效率工具
将 AI 融入你的开发工作流。使用智能体进行代码审查、生成文档或自动化重复性编码任务。

### 🔄 工作流自动化
将多个技能串联起来，创建复杂的自动化流水线。处理数据、转换内容、触发操作——全部通过可视化方式编排。

---
> 完整架构说明（进程图、配置协调、ACP 文件活动语义与 Gateway 排障）请参阅 [docs/zh-CN/architecture.md](docs/zh-CN/architecture.md)。

## 开发指南

### 前置要求

- **Node.js**：22.22.3+ / 24.15.0+（推荐） / 25.9.0+
- **包管理器**：pnpm 9+
- **Linux（Ubuntu/Debian）**：运行 Electron 前需先安装系统库，见 [docs/zh-CN/development.md](docs/zh-CN/development.md)

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
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # 国际化资源
│   └── types/               # TypeScript 类型定义
├── tests/
│   ├── e2e/                 # Playwright Electron 端到端冒烟测试
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
pnpm run init        # 初始化开发环境（安装依赖并下载捆绑运行时）
pnpm dev             # 以热重载模式启动
pnpm lint            # ESLint 检查
pnpm typecheck       # TypeScript 类型检查
pnpm test            # 单元测试
pnpm run test:e2e    # Electron E2E 冒烟测试
pnpm build           # 完整生产构建
pnpm package         # 为当前平台打包（可用 :mac / :win / :linux 后缀）
```

> 在 macOS 上打 Linux `.deb` 需要 GNU tar 和 GNU ar——请先执行 `brew install gnu-tar binutils`。缺失时内置的 `fpm` 会静默产出 96 字节的空 `.deb`（非法归档），而构建仍报告成功；`pnpm package:linux` 现在会在缺失时提前报错退出。

在无头 Linux 环境下，Electron 测试需要显示服务；可使用 `xvfb-run -a pnpm run test:e2e`。

### 通信回归检查

当 PR 涉及通信链路（Gateway 事件、ACP Chat bridge 收发流程、Channel 投递、传输回退）时，建议执行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI 中的 `comms-regression` 会校验必选场景与阈值。
### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 40+ |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |

---
> 项目结构、技术栈、完整命令列表、E2E 并行策略、性能诊断与通信回归检查等细节，请参阅 [docs/zh-CN/development.md](docs/zh-CN/development.md)。

## 参与贡献

我们欢迎社区的各种贡献！无论是修复 Bug、开发新功能、改进文档还是翻译——每一份贡献都让 YYClaw 变得更好。

### 如何贡献

1. **Fork** 本仓库
2. **创建** 功能分支（`git checkout -b feature/amazing-feature`），进行开发
3. **提交** 清晰描述的变更，**推送** 到你的分支，并**创建** Pull Request

### 贡献规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰


## 致谢

YYClaw 构建于以下优秀的开源项目之上：

- [OpenClaw](https://github.com/OpenClaw) – AI 智能体运行时
- [Electron](https://www.electronjs.org/) – 跨平台桌面框架
- [React](https://react.dev/) – UI 组件库
- [shadcn/ui](https://ui.shadcn.com/) – 精美设计的组件库
- [Zustand](https://github.com/pmndrs/zustand) – 轻量级状态管理


## 社区

加入我们的社区，与其他用户交流、获取帮助、分享你的使用体验。

| 企业微信 | 飞书群组 | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="企业微信二维码" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="飞书二维码" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord 二维码" /> |

### YYClaw 合作伙伴计划 🚀

我们正在启动 YYClaw 合作伙伴计划，寻找能够帮助我们将 YYClaw 介绍给更多客户的合作伙伴，尤其是那些有定制化 AI 智能体或自动化需求的客户。

合作伙伴负责帮助我们连接潜在用户和项目，YYClaw 团队则提供完整的技术支持、定制开发与集成服务。

如果你服务的客户对 AI 工具或自动化方案感兴趣，欢迎与我们合作。

欢迎私信我们，或发送邮件至 [public@valuecell.ai](mailto:public@valuecell.ai) 了解更多。


## Stars 历史

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/YYClaw&type=Date" alt="Stars 历史图表" />
</p>


## 许可证

YYClaw 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

<hr>


<p align="center">
  <sub>由 ValueCell 团队用 ❤️ 打造</sub>
</p>
