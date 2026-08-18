# YYClaw 多Agent协作系统设计文档

> 版本：v0.1 Draft  
> 日期：2026-05-23  
> 范围：YYClaw客户端 + ClawManager管控平台  
> 状态：方案设计阶段

---

## 一、文档概述

### 1.1 背景

YYClaw 作为基于 OpenClaw 的 Electron 客户端，当前已支持单 Agent 对话与任务执行。随着企业用户场景复杂化，需要支持多个 Agent 协同完成复杂任务。本文档定义 YYClaw 多 Agent 协作的产品能力边界、系统架构和技术实现方案。

### 1.2 目标

- **单客户端协作**：同一用户在单个 YYClaw 客户端内，编排或自动组织多个 Agent 协同工作
- **多客户端协作**：不同角色用户的 Agent 跨客户端协同，由 ClawManager 中控调度，满足企业跨部门协作与数据隔离需求
- **渐进式落地**：架构一次设计到位，功能分期交付，Phase 1 可在 4-6 周内交付可用版本

### 1.3 术语定义

| 术语 | 定义 |
|------|------|
| **Agent** | YYClaw 中的一个智能体实例，具有独立的模型配置、Skill集合、人格设定和记忆积累 |
| **Flow** | 多个 Agent（及人工节点）按特定拓扑结构组成的可执行协作流程，本质是一个有向图 |
| **Node（节点）** | Flow 中的一个执行单元，可以是 Agent 执行、人工操作、条件判断或聚合器 |
| **Edge（边）** | Flow 中节点之间的连接，可附加条件表达式 |
| **Session（协作会话）** | 一次 Flow 执行的运行时上下文，包含所有中间状态和共享数据 |
| **ACP（Agent能力协议）** | Agent 的标准化能力描述格式，用于调度匹配和自主编排 |
| **Conductor（指挥Agent）** | 自主协作模式下，负责任务分析、Agent 招募、任务分配和结果聚合的特殊 Agent |
| **Context Pool（上下文池）** | 协作会话中的共享数据空间，Agent 可读写中间结果 |

---

## 二、需求场景与协作模式映射

### 2.1 场景全景

根据客户端边界和编排方式两个维度，将需求场景分为以下类别：

```
                     ┌─────────────────────────────────┐
                     │         编排方式                  │
                     ├────────────┬────────────────────┤
                     │  人工编排   │    自主编排          │
        ┌────────────┼────────────┼────────────────────┤
  客户  │ 单客户端    │ S1: Flow   │ S2: Conductor      │
  端    │            │ 可视化编排  │ 自主协作             │
  边    ├────────────┼────────────┼────────────────────┤
  界    │ 多客户端    │ S3: 跨端   │ S4: 跨端            │
        │            │ Flow编排   │ 自主协作             │
        └────────────┴────────────┴────────────────────┘
```

### 2.2 场景与协作模式对应关系

**S1 — 单客户端人工编排 Flow**（对应需求 1.2、1.3、1.4）

用户通过可视化编辑器或自然语言描述，构建 Agent 协作流程。Flow 支持以下结构：

- **顺序链（Chain）**：A → B → C，适合多步骤处理任务
- **并行扇出/汇聚（Fan-out/Fan-in）**：A → [B, C, D] → E，适合并行处理后聚合
- **条件分支（Conditional）**：A → (条件判断) → B 或 C，适合审批/分类逻辑
- **循环（Loop）**：A → B → (满足条件?) → 退出 / 回到 A，适合迭代优化任务
- **人工节点（Human-in-the-loop）**：流程中嵌入需要人工完成的步骤

NL-to-Flow（需求 1.3）是 S1 的输入方式扩展：用户用自然语言描述需求 → LLM 生成 Flow 定义 → 用户确认/调整 → 执行。底层复用同一套 Flow 引擎。

**S2 — 单客户端自主协作**（对应需求 1.5）

没有预定义的 Flow。用户提出需求后，一个 Conductor Agent 自主完成：

1. 分析任务复杂度和所需能力
2. 从当前客户端的 Agent 列表中招募合适的 Agent；若存在能力缺口，提示用户创建新 Agent 并保留用于后续培养
3. 发起讨论，Agent 各自从自身视角分析任务
4. Conductor 综合各方意见，拆解任务并分配给 Agent 或人工（审批、确认、手动处理等）
5. Agent 和人工各自执行任务，过程中可动态调整分工
6. Conductor 汇总结果交付给用户

**S3 — 多客户端人工编排 Flow**（对应需求 2.2、2.4）

流程在 ClawManager 管控台配置，跨多个客户端的 Agent 参与。关键差异：

- RBAC 权限不同，数据访问范围不同
- Agent 执行发生在各自客户端，中间数据经过服务端中转
- 服务端负责权限校验、数据脱敏、审计日志

**S4 — 多客户端自主协作**（对应需求 2.4）

Conductor 由服务端运行，跨客户端招募 Agent。受限于权限和数据隔离，Conductor 只能看到各 Agent 的能力描述（ACP），不能直接访问其他客户端的数据。与单客户端自主协作一致，Conductor 可在能力缺口时提示管理员创建新 Agent（由管理员指定归属客户端），也可将部分子任务分配为人工任务（由对应客户端用户完成）。

### 2.3 补充协作模式（需求 1.6）

除上述核心场景外，以下模式作为 Flow 节点的组合模式提供，不作为独立场景：

| 模式 | 适用场景 | 实现方式 |
|------|---------|---------|
| **对抗审查（Review/Critique）** | 代码审查、文案校对、方案评审 | Flow 中设置 "生产者Agent → 审查者Agent" 循环，审查不通过则回到生产者 |
| **集成投票（Ensemble）** | 需要高准确率的判断类任务 | Fan-out 给多个 Agent 同一任务，Aggregator 节点做多数投票或置信度加权 |
| **共享黑板（Blackboard）** | 开放式研究分析、头脑风暴 | 特殊的自主协作变体，Agent 以轮询方式向 Context Pool 贡献分析，直到收敛 |
| **事件驱动响应（Reactive）** | 监控告警、异常自动处理 | 基于外部事件触发 Flow 实例，Agent 按预定义流程响应 |

---

## 三、系统架构

### 3.1 架构总览

```
┌───────────────────────────────────────────────────────────┐
│                    YYClaw 客户端                       │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Flow Editor │  │  Agent Pool  │  │  Local Flow Engine │  │
│  │ (可视化编排) │  │  (本地Agent)  │  │  (单客户端执行器)   │  │
│  └──────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │               │                    │             │
│  ┌──────┴───────────────┴────────────────────┴──────────┐  │
│  │              Context Pool (本地共享上下文)              │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │ WebSocket / HTTP                  │
└─────────────────────────┼──────────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────────────┐
│              ClawManager 服务端                              │
│  ┌──────────────────────┴───────────────────────────────┐  │
│  │               Collaboration Service                   │  │
│  │  ┌─────────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ Cross-Client │ │ RBAC     │ │ Server Flow       │  │  │
│  │  │ Router       │ │ Enforcer │ │ Engine            │  │  │
│  │  └─────────────┘ └──────────┘ └───────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ Flow Registry │  │ ACP Registry │  │ Audit Logger   │   │
│  │ (Flow定义存储) │  │ (能力注册中心) │  │ (审计日志)     │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Server Context Pool (跨端共享上下文)           │  │
│  │         (ClawMem: Redis + PostgreSQL + Milvus)        │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

**Local Flow Engine（本地流程引擎）**

单客户端场景的执行器。在客户端进程内运行 Flow，调度本地 Agent Pool 中的 Agent。不涉及网络通信（除 Agent 自身调用模型API外），延迟低、数据不出端。

**Server Flow Engine（服务端流程引擎）**

多客户端场景的执行器。在 ClawManager 服务端运行，通过 WebSocket 向各客户端下发执行指令，收集执行结果。负责跨端协调、权限校验、超时控制。

**Context Pool（上下文池）**

Flow 执行期间的共享数据空间。单客户端使用内存 KV 存储；多客户端使用 ClawMem 的 Redis 层（热数据）+ PostgreSQL（持久化），通过 session_id 隔离不同 Flow 实例。

**ACP Registry（能力注册中心）**

存储所有 Agent 的能力描述。单客户端场景下为本地内存索引；多客户端场景下由 ClawManager 统一管理，支持按能力标签检索和语义匹配。

**RBAC Enforcer（权限执行器）**

仅在多客户端场景生效。校验跨端协作中每个 Agent 的数据访问权限，拦截越权操作，对敏感数据执行脱敏。

---

## 四、核心协议与数据结构

### 4.1 Agent 能力协议（ACP）

每个 Agent 必须注册一份 ACP，作为调度和自主编排的依据：

```json
{
  "agent_id": "agent_fin_001",
  "name": "财务分析师",
  "description": "擅长财务报表分析、成本核算和预算编制，熟悉中国会计准则",
  "model_config": {
    "provider": "maas_internal",
    "model_id": "deepseek-v3",
    "temperature": 0.3,
    "max_tokens": 4096
  },
  "skills": [
    { "skill_id": "excel_analysis", "name": "Excel数据分析" },
    { "skill_id": "financial_report", "name": "财务报告生成" }
  ],
  "persona": {
    "name": "张会计",
    "traits": "严谨、注重数据准确性、熟悉税务法规"
  },
  "capabilities": {
    "input_types": ["text", "csv", "xlsx"],
    "output_types": ["text", "xlsx", "chart"],
    "domains": ["finance", "accounting", "tax"],
    "specialties": ["cost_analysis", "budget_planning", "audit"]
  },
  "constraints": {
    "max_concurrent_tasks": 3,
    "timeout_seconds": 300,
    "token_budget_per_task": 8000
  },
  "rbac": {
    "role": "finance_analyst",
    "data_access": ["financial_reports", "budget_data"],
    "restricted_data": ["hr_salary", "customer_pii"]
  },
  "client_id": "client_hangzhou_fin_01",
  "status": "available",
  "version": "1.2.0"
}
```

**设计要点：**

- `description` 和 `capabilities` 既供人阅读，也供 Conductor Agent 做语义匹配。description 需要足够具体，避免泛化描述
- `rbac` 字段仅在多客户端场景由服务端填充和校验，单客户端场景可忽略
- `constraints` 用于调度器做资源规划和超时控制
- `status` 由心跳机制维护，支持 `available | busy | offline`

### 4.2 Flow 定义格式（FDL）

```json
{
  "flow_id": "flow_contract_review_001",
  "name": "合同审查流程",
  "description": "从合同文本提取关键条款，进行风险评估，生成审查报告",
  "version": "1.0.0",
  "scope": "single_client",

  "variables": {
    "contract_text": { "type": "string", "required": true },
    "risk_threshold": { "type": "number", "default": 0.7 },
    "review_result": { "type": "object", "default": null }
  },

  "nodes": [
    {
      "node_id": "extract",
      "type": "agent",
      "agent_selector": {
        "mode": "fixed",
        "agent_id": "agent_legal_001"
      },
      "prompt_template": "请从以下合同中提取关键条款：\n\n{{variables.contract_text}}",
      "output_key": "extracted_clauses",
      "timeout_seconds": 120,
      "retry": { "max_attempts": 2, "backoff": "exponential" }
    },
    {
      "node_id": "risk_assess",
      "type": "agent",
      "agent_selector": {
        "mode": "capability_match",
        "required_domains": ["risk_assessment", "legal"],
        "prefer_specialties": ["contract_risk"]
      },
      "prompt_template": "基于以下提取的条款，评估合同风险：\n\n{{context.extracted_clauses}}",
      "output_key": "risk_assessment",
      "timeout_seconds": 180
    },
    {
      "node_id": "risk_check",
      "type": "condition",
      "expression": "context.risk_assessment.score > variables.risk_threshold",
      "branches": {
        "true": "human_review",
        "false": "generate_report"
      }
    },
    {
      "node_id": "human_review",
      "type": "human",
      "title": "高风险合同人工审查",
      "description": "该合同风险评分超过阈值，请人工审查",
      "display_data": ["context.extracted_clauses", "context.risk_assessment"],
      "actions": [
        { "action_id": "approve", "label": "审核通过", "next_node": "generate_report" },
        { "action_id": "reject", "label": "驳回", "next_node": null },
        { "action_id": "modify", "label": "修改后继续", "next_node": "risk_assess", "allow_edit": true }
      ],
      "timeout_seconds": 86400,
      "notify": ["email", "wechat_work"]
    },
    {
      "node_id": "generate_report",
      "type": "agent",
      "agent_selector": { "mode": "fixed", "agent_id": "agent_legal_001" },
      "prompt_template": "根据以下信息生成合同审查报告：\n条款：{{context.extracted_clauses}}\n风险评估：{{context.risk_assessment}}",
      "output_key": "review_result"
    }
  ],

  "edges": [
    { "from": "extract", "to": "risk_assess" },
    { "from": "risk_assess", "to": "risk_check" },
    { "from": "generate_report", "to": null }
  ],

  "on_error": {
    "default_action": "pause_and_notify",
    "notify_channels": ["wechat_work"]
  }
}
```

**设计要点：**

- `agent_selector` 支持两种模式：`fixed`（指定Agent）和 `capability_match`（按能力匹配，由调度器从 ACP Registry 选取最合适的 Agent）
- `prompt_template` 使用 `{{variables.*}}` 引用流程变量，`{{context.*}}` 引用上游节点输出
- 人工节点（`type: human`）定义了操作选项、展示数据、超时时间和通知方式
- `on_error` 定义全局异常策略，节点级别可覆盖

### 4.3 协作会话（Session）

每次 Flow 执行创建一个 Session：

```json
{
  "session_id": "sess_20260523_abc123",
  "flow_id": "flow_contract_review_001",
  "flow_version": "1.0.0",
  "scope": "single_client | multi_client",
  "status": "running | paused | waiting_human | completed | failed | cancelled",
  "created_at": "2026-05-23T10:00:00Z",
  "updated_at": "2026-05-23T10:05:30Z",

  "variables": {
    "contract_text": "甲方与乙方就...",
    "risk_threshold": 0.7
  },

  "context": {
    "extracted_clauses": { "...node output..." },
    "risk_assessment": null
  },

  "execution_state": {
    "current_nodes": ["risk_assess"],
    "completed_nodes": ["extract"],
    "pending_nodes": ["risk_check", "human_review", "generate_report"],
    "failed_nodes": []
  },

  "trace": [
    {
      "node_id": "extract",
      "agent_id": "agent_legal_001",
      "started_at": "2026-05-23T10:00:01Z",
      "completed_at": "2026-05-23T10:01:45Z",
      "token_usage": { "input": 2300, "output": 1800 },
      "status": "completed"
    }
  ],

  "participants": {
    "agents": ["agent_legal_001"],
    "humans": [],
    "clients": ["client_local"]
  }
}
```

---

## 五、单客户端多Agent协作详细设计

### 5.1 Local Flow Engine

#### 5.1.1 执行模型

Local Flow Engine 本质是一个基于事件驱动的有向图执行器，运行在 YYClaw 的 Electron 主进程中：

```
用户触发 Flow
     │
     ▼
创建 Session（初始化 Context Pool）
     │
     ▼
解析 Flow DAG，找到入口节点（无入边的节点）
     │
     ▼
┌──► 执行当前可执行节点集合 ◄────────────────────┐
│    │                                            │
│    ├─ Agent节点: 调用Agent执行，结果写入Context   │
│    ├─ 人工节点: 暂停Flow，推送通知给用户          │
│    ├─ 条件节点: 读取Context，评估表达式，选择分支  │
│    └─ 聚合节点: 等待所有上游完成，合并结果         │
│    │                                            │
│    ▼                                            │
│  更新 execution_state，记录 trace               │
│    │                                            │
│    ▼                                            │
│  检查是否有新的可执行节点（所有前置依赖已完成）     │
│    │                                            │
│    ├─ 有 → 继续 ──────────────────────────────── ┘
│    └─ 无 → 检查状态
│         ├─ 所有节点完成 → Flow 完成
│         ├─ 存在等待人工 → Flow 暂停
│         └─ 存在失败节点 → 执行 on_error 策略
```

#### 5.1.2 并行执行

当一个节点的输出连接到多个下游节点（Fan-out），这些下游节点同时变为可执行状态。引擎使用 Promise.allSettled 并行执行，每个 Agent 调用独立计时。聚合节点等待所有上游完成后才执行。

部分失败策略：
- `fail_fast`：任一分支失败则整个 Fan-out 失败
- `best_effort`：等待所有分支完成，将成功结果传递给聚合节点，失败结果标记在 Context 中
- `quorum`：至少 N 个分支成功即可继续（用于投票/集成模式）

#### 5.1.3 循环控制

循环通过条件节点实现。条件节点的 `branches` 可以指向上游节点，形成回路。为防止无限循环：

- 每个循环必须设置 `max_iterations`（默认 10）
- 每次迭代在 Context 中自增 `_loop_{node_id}_count`
- 超过最大迭代次数时，按 `on_loop_exceeded` 策略处理（默认暂停并通知用户）

### 5.2 人工节点设计

人工节点是 Flow 引擎中的一等公民，不是事后补丁。当执行到人工节点时：

1. Flow Engine 将 Session 状态设为 `waiting_human`
2. 在 YYClaw 客户端界面弹出任务卡片，展示 `display_data` 中指定的上下文数据
3. 用户可以执行 `actions` 中定义的操作
4. 用户操作后，将选择结果和（可选的）修改数据写入 Context
5. Flow Engine 恢复执行，根据用户选择的 action 跳转到 `next_node`

超时处理：人工节点可设置超时，超时后按预设策略处理（提醒、自动通过、自动驳回）。

### 5.3 NL-to-Flow（自然语言生成 Flow）

实现思路分三步：

**Step 1 — 意图理解与 Flow 骨架生成**

将用户的自然语言描述 + 当前客户端所有 Agent 的 ACP 列表作为上下文，调用 LLM 生成 Flow 定义的 JSON。Prompt 结构：

```
系统提示: 你是一个流程编排专家。根据用户的需求描述和可用的Agent列表，
生成一个Flow定义JSON。Flow定义的schema如下：{FDL schema}

可用Agent列表：
{agent_1.acp}
{agent_2.acp}
...

用户需求：{user_input}

请输出符合schema的Flow定义JSON。
```

**Step 2 — 校验与补全**

对 LLM 输出的 Flow JSON 做结构校验（schema validation）、引用检查（agent_id 和 variable 引用是否合法）、环路检测（除显式循环外不允许出现隐式环路）。

**Step 3 — 用户确认**

将生成的 Flow 渲染为可视化图展示给用户，用户可以：
- 直接执行
- 在可视化编辑器中调整后执行
- 重新描述需求

### 5.4 自主协作模式（Conductor）

自主协作模式不走 Flow Engine，而是由 Conductor Agent 驱动的多轮对话式协作。

#### 5.4.1 执行流程

```
用户提出需求
     │
     ▼
Conductor Agent 接收需求
     │
     ▼
【招募阶段】
  Conductor 查询 ACP Registry，筛选能力匹配的 Agent
  ┌─ 能力完全覆盖 → 生成招募列表及理由，展示给用户确认（可选）
  └─ 存在能力缺口 → 提示用户：
       "当前缺少具备 [XX能力] 的Agent，是否创建一个新Agent？"
       ├─ 用户同意 → 引导创建Agent（预填建议的能力标签和配置）
       │              创建完成后自动加入本次协作
       └─ 用户拒绝 → Conductor 尝试用现有Agent的组合覆盖缺口，
                      或标记该部分为人工处理
     │
     ▼
【讨论阶段】（可多轮）
  Conductor 将任务描述发送给所有被招募的 Agent
  每个 Agent 从自身视角返回：
    - 对任务的理解
    - 自己能承担的部分
    - 需要其他 Agent 配合的部分
    - 潜在风险或注意事项
  Conductor 综合所有反馈，提出任务拆解方案
  如果存在分歧，发起下一轮讨论直到方案收敛
     │
     ▼
【执行阶段】
  Conductor 按方案下发子任务给各 Agent 或人工
  ┌─ Agent任务: Agent执行并将结果写入 Context Pool
  └─ 人工任务: 推送任务卡片给用户（审批、确认、手动处理等）
                用户完成后结果写入 Context Pool
  Conductor 监控进度：
    - 子任务失败 → 决定重试、换Agent、或调整方案
    - 发现需要额外信息 → 动态插入新任务
    - 判断某步骤需要人工确认 → 动态插入人工任务
    - 所有子任务完成 → 进入汇总
     │
     ▼
【汇总阶段】
  Conductor 读取 Context Pool 中所有产出
  综合生成最终交付物
  呈现给用户
```

#### 5.4.2 技术实现

Conductor 本质上是一个配置了特殊系统提示的 Agent，其系统提示包含：
- 角色定义（项目经理/协调者）
- 当前可用 Agent 的 ACP 摘要
- 协作协议（如何与其他 Agent 交互的格式约定）
- Context Pool 的读写规范

讨论阶段的每一轮实现为：

```
for agent in recruited_agents:
    response = agent.execute({
        task_description: original_task,
        discussion_history: previous_rounds,
        other_agents_capabilities: acp_summaries,
        your_capability: agent.acp,
        instruction: "从你的专业视角分析这个任务..."
    })
    discussion_round.append(response)

conductor_synthesis = conductor.execute({
    discussion_history: all_rounds,
    instruction: "综合各Agent反馈，生成任务分配方案..."
})
```

每一轮讨论都是独立的 LLM 调用，通过 discussion_history 传递上下文。Conductor 的 synthesis 调用决定是继续讨论还是进入执行。

#### 5.4.3 与 Flow 模式的互操作

自主协作的执行阶段可以动态生成 Flow。如果 Conductor 在讨论后发现任务拆解的结构足够清晰，可以：
1. 将分配方案转化为 FDL 格式的 Flow
2. 交给 Flow Engine 执行
3. 自己退化为 Flow 的监控者

这种 "先讨论再固化" 的模式兼顾了灵活性和可控性。

#### 5.4.4 能力缺口检测与Agent动态创建

招募阶段 Conductor 将任务所需能力与 ACP Registry 中已有 Agent 能力做对比。当发现缺口时，触发以下流程：

```
Conductor 分析任务所需能力集合: [A, B, C, D]
已有 Agent 可覆盖: [A, B, C]
识别缺口: [D]
     │
     ▼
向用户发送提示：
  "当前没有擅长 [D能力描述] 的Agent。
   建议创建一个具备该能力的新Agent，创建后可长期保留并持续培养。"
     │
     ├─ 用户同意 →
     │    1. 打开Agent创建面板，预填信息：
     │       - name: Conductor建议的名称
     │       - capabilities.domains: 缺口能力对应的领域
     │       - capabilities.specialties: 具体专长
     │       - persona: 建议的角色定位
     │       - model_config: 根据任务类型推荐的模型
     │    2. 用户确认或调整后创建
     │    3. 新Agent自动注册到ACP Registry
     │    4. 新Agent加入本次协作的招募列表
     │    5. 新Agent持久保存在客户端Agent Pool中，
     │       后续可通过使用不断积累经验和记忆
     │
     └─ 用户拒绝 →
          Conductor 尝试两种降级策略：
          1. 组合策略：用现有Agent的能力组合近似覆盖缺口
             （如缺少"数据可视化"Agent，可让"数据分析"Agent输出结构化数据，
              再让"文档生成"Agent基于数据生成图表描述）
          2. 人工兜底：将该部分标记为人工任务，由用户自行处理
```

这一机制的价值不仅在于补齐当次任务的能力缺口，更重要的是帮助用户逐步建立起一支能力完整的Agent团队。每次协作中暴露的缺口，都是扩充Agent Pool的契机。

#### 5.4.5 自主协作中的人工任务

Conductor 在任务分配阶段可以将部分子任务标记为人工任务。人工任务的触发有三种来源：

**来源一：Conductor 主动规划**

Conductor 在讨论阶段分析任务后，判断某些步骤需要人工参与（如涉及主观判断、外部确认、物理操作等），直接在任务分配方案中标记为人工任务。

**来源二：Agent 执行中请求**

Agent 在执行子任务过程中，遇到超出自身能力或需要人工确认的情况，向 Conductor 发出人工介入请求。Conductor 评估后动态插入一个人工任务。

**来源三：能力缺口降级**

如 5.4.4 所述，当用户拒绝创建新Agent时，缺口任务自动降级为人工任务。

人工任务在自主协作模式中的实现复用 Flow 引擎的人工节点设计（见 5.2 节），但有以下差异：

| 维度 | Flow 人工节点 | 自主协作人工任务 |
|------|-------------|----------------|
| 触发方式 | 预定义在 Flow 中 | Conductor 动态插入 |
| 任务描述 | 固定的 title/description | Conductor 根据上下文动态生成 |
| 操作选项 | 预配置的 actions | Conductor 根据任务类型动态生成（如审批类提供通过/驳回，处理类提供提交结果/跳过） |
| 完成后流转 | 按 next_node 跳转 | 结果写入 Context Pool，Conductor 读取后决定下一步 |

人工任务的消息格式：

```json
{
  "task_type": "human",
  "source": "conductor_planned | agent_requested | capability_fallback",
  "title": "确认供应商报价",
  "description": "Agent已完成初步比价分析，以下3家供应商的报价需要您确认最终选择",
  "context_refs": ["price_comparison_result"],
  "actions": [
    { "action_id": "select", "label": "选择供应商", "input_type": "single_select",
      "options": ["供应商A: ¥12万", "供应商B: ¥15万", "供应商C: ¥11.5万"] },
    { "action_id": "reject_all", "label": "全部不合适，重新寻找" },
    { "action_id": "manual_input", "label": "手动输入结果", "input_type": "text" }
  ],
  "priority": "normal",
  "timeout_seconds": 3600
}

### 5.5 补充协作模式的实现

**对抗审查（Review/Critique）：**
用 Flow 实现。设置 "生产者 → 审查者 → 条件判断（通过？）" 的循环结构。审查者 Agent 需要在 ACP 中标注 `specialties: ["review", "quality_assurance"]`。条件判断可以基于审查者输出的结构化评分。

**集成投票（Ensemble）：**
Fan-out 结构 + 自定义聚合节点。聚合节点支持多种策略：
- `majority_vote`：多数决
- `weighted_average`：按 Agent 置信度加权
- `best_of`：选择评分最高的结果

**共享黑板（Blackboard）：**
自主协作模式的变体。没有 Conductor 做中心调度，而是：
- Context Pool 作为黑板
- Agent 轮询黑板内容，如果发现自己能贡献新信息则写入
- 设置收敛条件（如连续 N 轮无新信息）或最大轮次
- 适合头脑风暴和开放式分析

**事件驱动响应（Reactive）：**
预定义 "事件 → Flow" 的映射关系。当外部事件（如文件变更、消息接收、定时触发）到来时，自动创建 Flow Session 并执行。事件源通过 OpenClaw 的插件体系接入。

---

## 六、多客户端多Agent协作详细设计

### 6.1 核心差异

多客户端协作相比单客户端，核心差异在三个方面：

**差异一：Agent 归属和权限**

单客户端中所有 Agent 属于同一用户，权限一致。多客户端中 Agent 分属不同用户（不同部门/角色），每个 Agent 的数据访问范围由其所属用户的 RBAC 角色决定。

**差异二：执行位置**

单客户端的 Agent 执行全部发生在本地。多客户端的 Agent 执行发生在各自的客户端上，结果通过服务端中转。

**差异三：数据可见性**

单客户端中 Context Pool 对所有 Agent 完全可见。多客户端中 Context Pool 需要做访问控制——Agent 只能读取自己有权限访问的数据。

### 6.2 权限与数据隔离模型

#### 6.2.1 RBAC 集成

ClawManager 已有企业组织架构和角色权限体系，多Agent协作复用该体系：

```
组织结构：
  企业
  └── 部门（财务部、研发部、销售部...）
      └── 角色（财务主管、财务专员...）
          └── 用户
              └── Agent（继承用户的角色权限）
```

权限模型：
- **数据域（Data Scope）**：Agent 可访问的数据范围，与所属用户角色绑定
- **操作权限（Action Permission）**：Agent 可执行的操作类型（读取/写入/审批/删除）
- **协作权限（Collaboration Permission）**：Agent 可参与的跨部门协作类型

#### 6.2.2 Context Pool 访问控制

多客户端的 Context Pool 存储在 ClawManager 服务端，每个数据项带有访问控制标签：

```json
{
  "key": "financial_report_q1",
  "value": { "...报表数据..." },
  "written_by": "agent_fin_001",
  "access_control": {
    "visibility": "restricted",
    "allowed_roles": ["finance_manager", "ceo"],
    "denied_roles": [],
    "auto_desensitize_for": ["sales_manager"]
  }
}
```

当 Agent 读取 Context Pool 中的数据时，RBAC Enforcer 执行以下逻辑：
1. 检查 Agent 所属用户的角色是否在 `allowed_roles` 中
2. 如果在 `auto_desensitize_for` 中，则返回脱敏后的数据
3. 如果不在任何允许列表中，返回 `access_denied`

#### 6.2.3 数据脱敏规则

内置常见脱敏规则，可由企业管理员在 ClawManager 中配置：

| 数据类型 | 脱敏方式 | 示例 |
|---------|---------|------|
| 身份证号 | 保留前3后4 | 310***\*\*\*\*1234 |
| 手机号 | 保留前3后4 | 138\*\*\*\*5678 |
| 金额 | 替换为区间 | ¥50万-100万 |
| 姓名 | 保留姓氏 | 张** |
| 自定义 | 企业自定义正则规则 | - |

### 6.3 跨客户端通信协议

#### 6.3.1 消息流向

```
Client A (Agent执行)
    │
    │  1. 执行结果上报
    ▼
ClawManager Collaboration Service
    │
    │  2. 权限校验 + 数据写入Context Pool
    │  3. 检查后续节点的Agent归属
    │  4. 向目标Client下发执行指令
    ▼
Client B (Agent执行)
    │
    │  5. 执行完成，结果上报
    ▼
ClawManager（继续流转...）
```

#### 6.3.2 消息格式

客户端 ↔ 服务端的协作消息通过现有 WebSocket 通道传输，新增以下消息类型：

```json
// 服务端 → 客户端：下发任务
{
  "type": "collab:task_dispatch",
  "session_id": "sess_xxx",
  "node_id": "risk_assess",
  "agent_id": "agent_fin_001",
  "input": {
    "prompt": "请分析以下数据...",
    "context_refs": ["extracted_clauses"]
  },
  "timeout_seconds": 180
}

// 客户端 → 服务端：任务完成
{
  "type": "collab:task_complete",
  "session_id": "sess_xxx",
  "node_id": "risk_assess",
  "agent_id": "agent_fin_001",
  "output": { "risk_score": 0.82, "analysis": "..." },
  "token_usage": { "input": 3200, "output": 1500 },
  "duration_ms": 45000
}

// 客户端 → 服务端：任务失败
{
  "type": "collab:task_failed",
  "session_id": "sess_xxx",
  "node_id": "risk_assess",
  "agent_id": "agent_fin_001",
  "error": { "code": "MODEL_TIMEOUT", "message": "模型响应超时" }
}

// 服务端 → 客户端：人工任务通知
{
  "type": "collab:human_task_notify",
  "session_id": "sess_xxx",
  "node_id": "human_review",
  "task": {
    "title": "高风险合同人工审查",
    "description": "...",
    "display_data": { "...已按权限过滤..." },
    "actions": ["approve", "reject", "modify"]
  }
}
```

#### 6.3.3 离线处理

多客户端场景中，目标客户端可能离线。处理策略：

- 短期离线（< 5分钟）：服务端缓存任务，客户端上线后自动下发
- 长期离线（> 5分钟）：服务端尝试将任务转派给同角色的其他在线客户端上的同能力 Agent（需要该能力在多个客户端上有部署）
- 无可用替代：Session 进入 `waiting` 状态，通知 Flow 发起人

### 6.4 多客户端自主协作

Conductor 运行在 ClawManager 服务端（使用服务端的模型调用能力）。与单客户端 Conductor 的差异：

- Conductor 通过 ACP Registry 查询所有客户端上注册的 Agent，按能力匹配招募
- 讨论阶段的消息通过服务端中转，每条消息经过 RBAC 过滤
- Agent 在讨论中发表的观点如涉及受限数据，会被自动脱敏后再转发给其他 Agent
- 执行阶段的任务下发走跨客户端通信协议

---

## 七、审计与可观测性

### 7.1 审计日志

所有协作活动生成不可篡改的审计日志，存储在 ClawManager 的 PostgreSQL 中：

```json
{
  "event_id": "evt_xxx",
  "timestamp": "2026-05-23T10:01:45Z",
  "session_id": "sess_xxx",
  "event_type": "agent_execution | human_action | data_access | permission_denied",
  "actor": {
    "type": "agent | human",
    "id": "agent_fin_001",
    "client_id": "client_hangzhou_fin_01",
    "user_id": "user_zhangsan",
    "role": "finance_analyst"
  },
  "action": "execute_node",
  "target": { "node_id": "risk_assess", "flow_id": "flow_xxx" },
  "details": {
    "input_summary": "合同风险评估，输入长度3200 tokens",
    "output_summary": "风险评分0.82，发现3个高风险条款",
    "token_usage": { "input": 3200, "output": 1500 },
    "model_id": "deepseek-v3",
    "duration_ms": 45000
  }
}
```

### 7.2 Trace 追踪

每个 Session 的 `trace` 字段完整记录执行轨迹。在 ClawManager 管控台提供简单的执行记录查看页面：

- 以有向图形式展示 Flow 执行路径（已完成节点高亮）
- 点击节点查看输入输出摘要、耗时、token消耗
- 多客户端场景下展示数据流转路径和权限校验记录

初期不需要建设复杂的监控面板。当积累足够真实运行数据后，再基于 trace 数据建设效率统计和异常告警。

---

## 八、与现有系统集成

### 8.1 与 OpenClaw 的关系

| 能力 | 复用OpenClaw | 新增 |
|------|-------------|------|
| Agent 生命周期管理 | ✅ 直接复用 | — |
| Agent 执行（模型调用） | ✅ 复用执行器 | — |
| Skill 管理 | ✅ 复用插件体系 | — |
| 事件总线 | ✅ 复用基础事件 | 扩展协作事件类型 |
| ACP 协议 | — | ✅ 新增 |
| Flow Engine | — | ✅ 新增 |
| Context Pool | — | ✅ 新增（复用ClawMem存储层） |
| Collaboration Service | — | ✅ 新增 |

### 8.2 与 ClawMem/Honcho 的关系

- Context Pool 的持久化层直接使用 ClawMem 的 Redis（Session级热数据）和 PostgreSQL（历史记录）
- Agent 在协作中可以访问自身的 Honcho 用户建模数据，但不能访问其他 Agent 的 Honcho 数据
- 协作历史可以作为 Agent 记忆的一部分，通过 ClawMem 的记忆写入接口沉淀

### 8.3 与 YYClaw 客户端的关系

- Flow Editor 集成到 YYClaw 的工作区界面，作为独立 Tab
- 人工节点的任务卡片在 YYClaw 的通知区域展示
- 自主协作的讨论过程在聊天界面中以多Agent对话形式呈现
- 协作执行状态在侧边栏显示（运行中/等待人工/已完成）

### 8.4 与 ClawManager 管控台的关系

- Flow 管理（创建/编辑/版本控制/发布）在 ClawManager 中完成
- 多客户端 Flow 的配置和权限设定在 ClawManager 中完成
- ACP Registry 在 ClawManager 中统一管理
- 审计日志和 Trace 查看在 ClawManager 中提供

---

## 九、分期落地路线图

### Phase 1：基础协作能力（4-6周）

**目标**：单客户端 Flow 引擎 + 顺序链执行

- [ ] 定义 ACP 协议 v1，实现 Agent 能力注册
- [ ] 实现 Local Flow Engine 核心（顺序执行、条件分支）
- [ ] 定义 FDL v1（支持 agent 节点、condition 节点）
- [ ] 实现 Context Pool 内存版
- [ ] 在 YYClaw 中实现简单的 Flow 配置界面（JSON编辑 + 执行）
- [ ] 实现 Session 和 Trace 记录

**交付标准**：用户可以配置一个 "Agent A → 条件判断 → Agent B 或 Agent C" 的 Flow 并成功执行。

### Phase 2：完整 Flow 能力（4-6周）

**目标**：支持全部 Flow 结构 + 人工节点 + 可视化编排

- [ ] Flow Engine 支持并行（Fan-out/Fan-in）、循环、聚合
- [ ] 实现人工节点（任务卡片 UI、操作交互、通知）
- [ ] 实现可视化 Flow 编辑器（拖拽式，基于 react-flow 或类似库）
- [ ] 实现 capability_match 模式的 Agent 选择器
- [ ] 完善错误处理和重试机制

**交付标准**：用户可以可视化地编排包含并行、循环、人工审批的复杂 Flow。

### Phase 3：智能编排（3-4周）

**目标**：NL-to-Flow + 自主协作模式

- [ ] 实现 NL-to-Flow（LLM 生成 Flow JSON + 校验 + 用户确认）
- [ ] 实现 Conductor Agent 框架（招募 → 讨论 → 执行 → 汇总）
- [ ] 在 YYClaw 聊天界面中实现多Agent讨论的展示
- [ ] Conductor 到 Flow 的动态转化（讨论后固化为 Flow 执行）

**交付标准**：用户可以用自然语言描述需求，系统自动生成 Flow 或由 Conductor 自主组织 Agent 协作。

### Phase 4：多客户端基础（6-8周）

**目标**：跨客户端 Flow 执行 + RBAC 集成

- [ ] ClawManager 新增 Collaboration Service
- [ ] 实现 Server Flow Engine
- [ ] 实现 ACP Registry 服务端统一管理
- [ ] 实现 Context Pool 服务端版（Redis + PostgreSQL，带访问控制）
- [ ] 实现跨客户端通信协议（WebSocket 消息扩展）
- [ ] 集成 RBAC 权限校验和数据脱敏
- [ ] 实现审计日志
- [ ] ClawManager 管控台中的 Flow 配置和 Trace 查看

**交付标准**：管理员可以在 ClawManager 中配置跨部门的协作 Flow，不同客户端的 Agent 按权限参与协作。

### Phase 5：多客户端完整能力（4-6周）

**目标**：多客户端自主协作 + 生产级加固

- [ ] 实现服务端 Conductor（跨客户端 Agent 招募和调度）
- [ ] 客户端离线处理（任务缓存、转派、状态同步）
- [ ] 补充协作模式模板（对抗审查、集成投票等预置 Flow 模板）
- [ ] 性能优化（大规模 Agent 场景的调度性能）
- [ ] 可观测性增强（执行统计、异常告警）

---

## 十、风险与约束

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| 自主协作模式的 token 消耗过高 | 讨论阶段多轮LLM调用导致成本不可控 | 设置讨论轮次上限（默认3轮）和 token 预算；支持用户手动终止讨论 |
| NL-to-Flow 生成的 Flow 质量不稳定 | LLM 生成的 Flow 可能不合理 | 强制用户确认环节；提供预置模板降低生成难度；做严格的 schema 校验 |
| 多客户端场景的延迟 | 跨端通信引入网络延迟 | Agent 执行在本地完成，仅结果经服务端中转；非关键路径异步化 |
| 权限模型复杂度 | RBAC + 数据脱敏规则维护成本高 | 提供合理默认值；分级实施（先做部门级隔离，再做细粒度控制） |
| Context Pool 数据一致性 | 并行写入可能导致冲突 | 每个节点写入独立的 output_key，避免写冲突；聚合节点做合并 |
| 客户端离线导致 Flow 阻塞 | 目标 Agent 所在客户端不在线 | 超时 → 转派 → 通知发起人，三级降级策略 |

---

## 附录 A：Flow 结构示例

### A.1 顺序链（Chain）

```
[文档解析Agent] → [摘要生成Agent] → [翻译Agent]
```

### A.2 并行扇出/汇聚（Fan-out/Fan-in）

```
                 ┌→ [法律风险Agent] ──┐
[合同解析Agent] ─┼→ [财务风险Agent] ──┼→ [汇总Agent]
                 └→ [合规检查Agent] ──┘
```

### A.3 条件分支 + 人工节点

```
[数据分析Agent] → <金额>50万?> ─是→ [人工审批] → [执行Agent]
                                └否→ [自动执行Agent]
```

### A.4 循环（迭代优化）

```
[初稿Agent] → [审查Agent] → <质量达标?> ─是→ [输出]
                  ▲              └否─────────┘
```

### A.5 对抗审查 + 投票

```
                 ┌→ [方案A Agent] ──┐
[需求分析Agent] ─┼→ [方案B Agent] ──┼→ [评审Agent投票] → [最优方案]
                 └→ [方案C Agent] ──┘
```
