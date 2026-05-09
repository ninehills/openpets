# PRD: 多宠物模式（Multi-Pet）

## 概述

当前 OpenPets 为单宠物模式：所有 Agent（MCP / CLI / OpenCode）共享一个宠物窗口、一个状态机。本需求扩展为多宠物模式，每个 Agent 实例对应一个独立的桌面宠物窗口，不同 Agent 类型可映射不同外观。

---

## 用户故事

1. **看到多个宠物同时工作** — 作为开发者，我同时开着 Claude Code 和 Pi，桌面上各有一个宠物独立展示各自的状态，看着热闹
2. **不同 Agent 不同外观** — 我可以配置「Claude Code 用柴犬、Pi 用猫」，一眼就区分谁在干什么
3. **向后兼容** — 单 Agent 用户（比如只装了 MCP）体验完全不变，仍然只有一个宠物
4. **不要任何开关** — 多宠物是自然行为，不需要手动开启

---

## 行为规则

### 宠物数量

```
宠物数量 = max(1, 已连接 Agent 数)
```

- **0 个 Agent 连接** → 1 个默认宠物，外观为默认 pet
- **1 个 Agent 连接** → 1 个宠物，外观按配置映射；未配置则保持默认；宠物窗口不增不减
- **N 个 Agent 连接** → N 个宠物，每个对应一个 lease
- 最后一个 Agent 断开 → 宠物数量回到 1，切换回默认外观

### Agent 连接 / 断开

- **连接**：Agent acquire lease 时，创建对应宠物窗口
- **断开**：lease 过期或主动 release 时，延迟 10 秒后关闭对应窗口（避免短暂断连闪跳）
- 同一 Agent 类型的多个实例（如两个 Claude Code 窗口）各自独立宠物

### 窗口布局

- 新宠物窗口从默认位置 `(x₀, y₀)` 开始级联偏移
- 偏移步长：120px（右下方向）
- 行宽限制：`floor((screenWidth - x₀) / 120)` 个窗口，超出换行
- Y 超出屏幕底边时回到 `y₀`
- 每个窗口独立可拖拽，位置不持久化

### Hover 信息

鼠标悬停在宠物上时，浮层显示：

```
Agent类型 · 项目名 — 当前状态
```

例如：`Pi · openpets — thinking`

---

## 配置

位置：`~/.openpets/config.json`（已有文件，新增 `agents` 字段）

```json
{
  "agents": {
    "pi": "cat-pet",
    "claude-code": "slayer"
  }
}
```

- 键为 `agentType`（从 `source` 字段解析，见下文）
- 值为已安装 pet 的 `id`（即 `~/.openpets/pets/<id>` 的目录名）或 `displayName`
- 未配置的 agentType 使用默认宠物
- 配置可选，不配 = 全用默认
- 查找时优先匹配 `id`，再匹配 `displayName`；找不到则 fallback 默认

---

## 数据模型

### source 字段约定

现有协议中 `source` 为自由字符串。多宠物模式下约定格式：

```
agentType:detail
```

| source 示例 | agentType | detail |
|---|---|---|
| `pi:openpets` | `pi` | `openpets` |
| `claude-code:myproject` | `claude-code` | `myproject` |
| `mcp` | `mcp` | `""`（老格式兼容） |

- 解析规则：取第一个 `:` 之前为 `agentType`，之后为 `detail`；无冒号时整个为 `agentType`
- `detail` 用于 hover 信息中的项目名显示，以及区分同类型多实例

### 事件路由

事件请求新增可选字段 `leaseId`：

```typescript
// 当前
{ id, method: "event", params: { type, state, source, message?, tool? } }

// 新增
{ id, method: "event", params: { type, state, source, leaseId?, message?, tool? } }
```

- `leaseId` 可选 — 不带时路由到默认宠物（向后兼容）
- 带 `leaseId` 时路由到对应 lease 的宠物窗口
- 客户端（Pi 扩展、MCP server）各自持有 `leaseId`，发事件时附带

### 宠物实例状态

```typescript
type PetInstance = {
  leaseId: string;
  agentType: string;        // 从 source 解析
  detail: string;           // 从 source 解析
  petPath: string | null;   // null = 默认宠物
  runtime: PetRuntimeState; // 每个宠物独立的状态机
  window: BrowserWindow;
  disconnectTimer?: NodeJS.Timeout; // 延迟关闭计时器
};
```

### IPC /health 响应

`health` 响应中的 `activePet` 改为 `activePets` 数组：

```typescript
{
  // ... 原有字段
  activePets: Array<{
    leaseId: string;
    agentType: string;
    detail: string;
    petName: string | null;
    state: OpenPetsState;
  }>;
}
```

---

## 技术方案

### 涉及模块

| 模块 | 改动 |
|---|---|
| `core/lifecycle.ts` | lease acquire → 触发创建 Pet 窗口；release → 触发延迟关闭 |
| `core/event.ts` | `OpenPetsEvent` 新增可选 `leaseId` 字段 |
| `core/reducer.ts` | **不变** — 每个 Pet 实例独立持有一个 reducer |
| `core/ipc.ts` | `health` 响应结构调整 |
| `core/config.ts` | `OpenPetsConfig` 新增 `agents` 字段 |
| `apps/desktop/src/main.ts` | 多窗口管理、外观映射、级联定位、hover 信息 |
| `apps/desktop/src/preload.ts` | **不变** — per-window IPC 机制不变 |
| `apps/desktop/src/renderer/src/App.tsx` | hover 浮层增加来源和状态显示 |
| `packages/client/src/client.ts` | **不变** |
| `packages/mcp/src/tools.ts` | 发送事件时附带 `leaseId`；source 可选结构化 |
| `packages/cli/src/index.ts` | 发送事件时附带 `leaseId`；source 可选结构化 |

### 不涉及

- pet-format-codex（不碰）
- pet 安装流程（不变）
- tray 菜单（保持单宠物逻辑，可后续扩展）
- speech / safety 限流（per-pet 独立，但机制不变）
- 窗口拖动和交互（已有逻辑 per-window 复用）

### 风险

- **多 BrowserWindow 内存开销**：每个宠物窗口 ~20-30MB，3 个 Agent 约 60-90MB，可接受
- **单实例锁**：当前 `requestSingleInstanceLock()` 只允许一个 OpenPets 进程，多宠物只是多窗口，不影响
- **老客户端兼容**：不带 `leaseId` 的事件走默认宠物，老 MCP 和 CLI 正常工作

---

## 行为边界

| 场景 | 预期 |
|---|---|
| 仅启动桌面应用，无 Agent 连接 | 1 个默认宠物 |
| 1 个 MCP Agent 连接 | 1 个宠物，外观按配置映射 |
| 2 个 Agent（Pi + MCP）连接 | 2 个独立宠物窗口 |
| Agent 断开，仍有其他 Agent | 对应窗口在 10 秒后关闭，其他不受影响 |
| 最后一个 Agent 断开 | 窗口保留，外观切回默认宠物 |
| 同一类型 2 个实例（两个 Claude Code） | 2 个独立窗口，各自独立状态机 |
| Agent 短暂断连后重连 | 延迟关闭计时器被取消，窗口不闪烁 |
| 配置中指定了不存在的 pet 路径 | fallback 到默认宠物 |
| 老客户端不带 `leaseId` 发事件 | 路由到第一个宠物（默认），行为不变 |
| 屏幕空间不足以级联偏移 | 自动换行，超出底部回绕 |
