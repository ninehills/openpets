# PRD: 多宠物模式（Multi-Pet）

## 概述

OpenPets 从单宠物模式扩展为多宠物模式：每个 active lease 对应一个独立桌面宠物窗口。不同 agent/session 的状态互不影响；没有 active lease 时仍保留一个默认宠物，保证单用户与旧事件路径可用。

## 用户故事

1. **多个 agent 同时可见** — 同时使用 Pi、Claude Code、MCP 等 agent 时，每个 session 有独立宠物反馈状态。
2. **同 agent 同目录不串消息** — 两个 Pi session 即使 agent 名称和项目目录相同，也能通过不同 lease/source 精确路由到各自宠物。
3. **不同 agent 可映射不同外观** — 可配置 agent type 到已安装 pet 的映射。
4. **默认体验不变** — 没有 lease 或旧事件不带路由信息时，仍更新默认宠物。

## 行为规则

### 宠物数量

```txt
宠物数量 = max(1, active lease 数)
```

- 0 个 active lease：显示 1 个默认宠物。
- 1 个 active lease：显示 1 个对应宠物。
- N 个 active lease：显示 N 个独立宠物。
- 最后一个 lease release/过期后：延迟关闭对应窗口，然后回到 1 个默认宠物。

### Agent 连接 / 断开

- acquire lease：创建对应宠物窗口；如果只存在默认宠物，则替换为 lease 宠物。
- heartbeat：取消该 lease 的延迟关闭 timer。
- release：10 秒后关闭对应宠物窗口，避免短暂断连导致闪烁。
- 同 agent、同目录、多 session：只要 lease id 不同，就创建不同宠物。

### 事件路由

事件路由按稳定 session key 精确匹配：

1. 优先使用 `event.leaseId` 匹配 `PetInstance.leaseId`。
2. 其次使用 `event.source` 精确匹配 `PetInstance.leaseId`。
3. 都没有或匹配失败时，fallback 到默认宠物。

第二条用于兼容旧 `@open-pets/client/core`：旧版本会保留 `source`，但会剥掉未知的 `leaseId`。因此 Pi 等客户端可以将 `source` 设置为与 lease id 相同的值，实现低改动精确路由。

### source 与展示

`source` 不再做 agentType/detail 的模糊路由。推荐约定：

- 路由用 source：`source = leaseId`，例如 `pi:openpets:<session>`。
- 展示用 lease label：例如 `Pi Agent - openpets`。

Hover 显示短标签：

```txt
AgentName(project) — state
```

例如：`Pi Agent(openpets) — working`。

### 窗口布局

- 新窗口从默认位置开始级联偏移。
- 偏移步长：120px。
- 超出屏幕宽度自动换行；超出底部回绕。
- 每个窗口独立可拖拽；默认窗口位置可持久化，lease 窗口位置不持久化。

## 配置

`OpenPetsConfig` 新增可选字段：

```json
{
  "agents": {
    "pi": "cat-pet",
    "mcp": "slayer"
  }
}
```

- key：agentType，来自展示 source/label 的第一个 `:` 前缀。
- value：已安装 pet 的 `id` 或 `displayName`。
- 找不到映射时 fallback 默认宠物。

## 数据模型

```ts
type PetInstance = {
  leaseId: string;
  agentType: string;
  detail: string;
  pet: LoadedCodexPet | null;
  runtime: PetRuntimeState;
  window: BrowserWindow | null;
  rendererReady: boolean;
  expirationTimer: ReturnType<typeof setTimeout> | null;
  disconnectTimer?: ReturnType<typeof setTimeout>;
};
```

## IPC / health

`health` 保留 deprecated `activePet`，新增 `activePets`：

```ts
activePets: Array<{
  leaseId: string;
  agentType: string;
  detail: string;
  petName: string | null;
  state: OpenPetsState;
}>;
```

capabilities 增加：

```txt
multi-pet-v1
```

## 行为边界

| 场景 | 预期 |
|---|---|
| 仅启动桌面，无 lease | 1 个默认宠物 |
| 1 个 lease acquire | 1 个对应宠物 |
| N 个 lease acquire | N 个独立宠物 |
| event 带 `leaseId` | 路由到对应 lease 宠物 |
| event 不带 `leaseId` 但 `source === leaseId` | 路由到对应 lease 宠物 |
| event 无路由信息 | fallback 默认宠物 |
| 同 agent 同目录两个 session | 通过不同 lease/source 更新各自宠物 |
| release 一个 lease | 10 秒后关闭对应窗口 |
| 最后一个 lease release | 回到默认宠物 |
