# Plan: 多宠物模式（Multi-Pet）

## Context

当前 OpenPets 是单宠物：所有 Agent 共享一个状态机、一个 BrowserWindow。本需求改为每个 Agent lease 对应一个独立宠物窗口，支持不同 Agent 类型映射不同外观。详见 `docs/prd/01-multi-pet.md`。

## Approach

核心思路：**宠物数 = max(1, lease 数)**。lease 的 acquire/release 事件驱动宠物窗口的创建/销毁。事件通过可选的 `leaseId` 字段路由到对应宠物。老客户端不带 `leaseId` 时走默认宠物，完全向后兼容。

`main.ts` 中当前是单例变量（`activePet`, `runtimeState`, `mainWindow`），改为 `Map<string, PetInstance>`，用一个 `PetInstanceManager` 集中管理。

## Files to modify

| 文件 | 改动重点 |
|---|---|
| `packages/core/src/config.ts` | `OpenPetsConfig` 新增 `agents` 字段 |
| `packages/core/src/event.ts` | `OpenPetsEvent` 新增可选 `leaseId`；新增 `parseSource()` 工具函数 |
| `packages/core/src/ipc.ts` | `OpenPetsHealthV2.activePet` → `activePets` 数组 |
| `apps/desktop/src/main.ts` | 核心改动：PetInstanceManager、多窗口管理、事件路由、cascade 定位 |
| `apps/desktop/src/preload.ts` | `RendererPetState` 新增 `agentType`、`detail` 字段 |
| `apps/desktop/src/renderer/src/App.tsx` | hover 浮层显示来源和状态 |
| `packages/mcp/src/tools.ts` | 发送事件时附带 `leaseId` |
| `packages/cli/src/index.ts` | 发送事件时附带 `leaseId`（如适用） |
| `packages/client/src/event-input.ts` | `OpenPetsEventInput` 支持 `leaseId` |

## Steps

### Step 1: Core 协议层改动

- [x] `core/config.ts` — `OpenPetsConfig` 新增 `agents?: Record<string, string>`（agentType → pet id/displayName）
- [x] `core/event.ts` — `OpenPetsEvent` 新增可选 `leaseId?: string`；新增 `parseSource(source: string)` 导出函数，返回 `{ agentType, detail }`
- [x] `core/ipc.ts` — `OpenPetsHealthV2` 新增/替换 `activePets` 字段（数组，替代原来的 `activePet` 单值）
- [x] `core/event.ts` — `validateOpenPetsEvent` 允许 `leaseId` 通过

### Step 2: PetInstance 管理器（main.ts 核心重构）

- [x] 定义 `PetInstance` 类型和 `PetInstanceManager`
- [x] 实现：`createForLease(leaseId, source)` — 解析 source，查 agents 配置获取 pet，创建运行时状态
- [x] 实现：`destroyForLease(leaseId)` — 清除 timer，关闭窗口，从 map 删除
- [x] 实现：`ensureDefaultPet()` — 没有 lease 时保证至少 1 个默认宠物实例
- [x] 实现：`getDefault()` — 返回默认宠物（第一个，或无 lease 的那个）
- [x] 实现：`getByLeaseId(leaseId)` — 查询
- [x] 配置解析：`resolvePet(agentType)` — 按 agents 配置匹配已安装 pet（先 id，再 displayName，找不到回退默认）

### Step 3: 窗口管理重构

- [x] 将 `createPetWindow()` 抽象为 `createWindowForInstance(instance: PetInstance)`
- [x] 模块级变量 `mainWindow` → 移到 `getMainWindow()` 辅助函数
- [x] `publishState()` 改为 `publishStateForInstance(instance)`

### Step 4: 事件路由 & Lease 集成

- [x] 修改 `applyEvent(event)`:
- [x] 修改 `handleLease(params)`:
- [x] `applyLeaseAction` 返回的 `LeaseResult` 携带足够信息让 `handleLease` 判断后续操作

### Step 5: IPC health 响应更新

- [x] `getIpcHealth()` 返回 `activePets` 数组而非 `activePet` 单值
- [x] `activePets` 内容：`{ leaseId, agentType, detail, petName, state }`
- [x] 保留 `activePet` 字段（deprecated）供老客户端兼容

### Step 6: Renderer 改动

- [x] `preload.ts` — `RendererPetState` 新增 `agentType?: string`、`detail?: string`
- [x] `main.ts` publishState — 传递 `agentType` 和 `detail`
- [x] `App.tsx` — 在 `.pet-container` 上添加 hover 浮层
- [x] styles.css — 添加 `.source-hover` 样式

### Step 7: 客户端改动（MCP & CLI）

- [x] `mcp/tools.ts` — `openPetsSayTool` 和 `openPetsSetStateTool`:
- [x] `cli/src/index.ts` — 不适用（CLI 无 lease 机制）
- [x] `client/src/event-input.ts` — `OpenPetsEventInput` 支持 `leaseId` 透传

## Reuse

- `core/reducer.ts` — **不变**。每个 PetInstance 独立持有一个 `PetRuntimeState`，调用同一个 `reducePetEvent`
- `core/lifecycle.ts` — lease 存储逻辑不变，`applyLeaseAction` 接口不变
- `core/states.ts` — 完全不变
- `core/codex-mapping.ts` — 完全不变
- `packages/pet-format-codex/src/loader.ts` — 完全不变
- `apps/desktop/src/ipc-server.ts` — 几乎不变，只需 `handleLease` 和 `applyEvent` 的签名调整
- `apps/desktop/src/menu-actions/` — 不变
- 窗口拖动/交互逻辑 — 复用现有 `handlePetInteraction`，per-window 触发

## Verification

1. **单 Agent 回归**：启动桌面应用 → 1 个默认宠物 → MCP 连接 → 1 个宠物（外观不变）→ MCP 断开 → 恢复默认。与当前行为一致。
2. **多 Agent**：启动 → Pi 连接（创建窗口 A，外观按配置）→ Claude Code 连接（创建窗口 B）→ 两个窗口各自独立动画 → Pi 断开 → 10s 后窗口 A 关闭 → 只剩窗口 B。
3. **Cascade 定位**：连 5 个 Agent → 窗口不重叠 → 超出屏幕宽度自动换行。
4. **Hover 显示**：鼠标悬停 → 显示 `Agent类型 · 项目名 — 状态`。
5. **配置测试**：`agents: { "pi": "nonexistent" }` → Pi 连接 → fallback 默认外观。
6. **老客户端兼容**：不带 `leaseId` 的事件 → 路由到默认宠物。
7. **短暂断连**：lease heartbeat 中断 5 秒内重连 → 窗口不消失。
