# Plan: 多宠物模式（Multi-Pet）

## Context

OpenPets 原先只有一个 BrowserWindow 和一个 runtime state。多宠物模式将运行时改为 `Map<leaseId, PetInstance>`：每个 active lease 拥有独立窗口、pet 外观和 reducer state。

最终实现采用低改动路由策略：**lease id 是 session key；事件可通过 `leaseId` 或 `source === leaseId` 路由**。`source === leaseId` 用于兼容旧 `@open-pets/client/core` 会剥掉 `leaseId` 字段的问题。

## Implementation Summary

### Core

- `OpenPetsConfig` 新增：
  - `agents?: Record<string, string>`
- `OpenPetsEvent` 新增：
  - `leaseId?: string`
- `validateOpenPetsEvent()` 允许 `leaseId` 通过。
- 新增 `parseSource(source)`，用于把展示 source/label 解析成 `{ agentType, detail }`。
- `OpenPetsHealthV2` 新增：
  - `activePets: OpenPetsHealthPet[]`
  - capability `multi-pet-v1`
- `activePet` 保留作为旧客户端兼容字段。

### Desktop main process

- 引入 `PetInstance`：每个实例持有自己的：
  - `leaseId`
  - `agentType/detail`
  - `pet`
  - `PetRuntimeState`
  - `BrowserWindow`
  - temporary state expiration timer
  - disconnect delay timer
- `petInstances: Map<string, PetInstance>` 替代单例 runtime/window。
- `ensureDefaultPet()` 保证无 lease 时仍有默认宠物。
- `createForLease(id, source)` 在 acquire 时创建窗口。
- `scheduleDestroyForLease(id)` 在 release 时延迟 10 秒关闭窗口。
- `createWindowForInstance(instance)` 复用原窗口配置，并为新窗口做 cascade 定位。
- drag 使用 IPC sender 定位对应窗口，避免拖动任意宠物都移动第一个窗口。

### Event routing

最终路由逻辑：

```ts
function getInstanceForEvent(event: OpenPetsEvent) {
  if (event.leaseId) return petInstances.get(event.leaseId) ?? getDefaultInstance();
  if (event.source) return petInstances.get(event.source) ?? getDefaultInstance();
  return getDefaultInstance();
}
```

含义：

1. 新客户端可显式传 `leaseId`。
2. 旧客户端可设置 `source = leaseId`，因为旧 core 会保留 source。
3. 无路由信息时保持旧行为，更新默认宠物。

不再按 `agentType/detail` 模糊匹配路由，避免相同 agent + 相同目录的多个 session 串消息。

### Display / hover

- lease acquire 时优先用 `params.label` 作为展示 source：
  - 例如 `cli:Pi Agent - openpets`
- renderer hover 将 `Agent - project` 格式压缩为：
  - `Agent(project) — state`
- 路由 source 和展示 label 解耦：
  - 路由：`source = leaseId` 或 `leaseId`
  - 展示：lease label

### Client / MCP

- `packages/client/src/event-input.ts` 支持 `leaseId` 透传。
- `packages/client/src/client.ts` 不保存 active lease，也不自动补 `leaseId`。
- MCP 自己持有 lease manager，发送事件时显式带 `leaseId`。
- Pi 扩展推荐用低改动兼容模式：event `source` 设置成 lease id。

## Files Modified

| 文件 | 说明 |
|---|---|
| `packages/core/src/config.ts` | 新增 `agents` 配置 |
| `packages/core/src/event.ts` | 新增 `leaseId` 和 `parseSource()` |
| `packages/core/src/ipc.ts` | 新增 `activePets` / `multi-pet-v1` |
| `packages/client/src/event-input.ts` | event input 支持 `leaseId` |
| `packages/client/src/client.ts` | 保持显式透传，不做 lease 推断 |
| `packages/mcp/src/tools.ts` | MCP 事件显式带 `leaseId` |
| `apps/desktop/src/main.ts` | 多窗口、多 runtime、lease 生命周期、事件路由 |
| `apps/desktop/src/preload.ts` | renderer state 增加 agent/display 字段 |
| `apps/desktop/src/renderer/src/App.tsx` | hover 显示短标签 |
| `apps/desktop/src/renderer/src/styles.css` | hover 样式 |

## Verification

已覆盖/需保持的测试点：

1. Core event validation 保留 `leaseId`。
2. Client 显式传 `leaseId` 时原样透传。
3. Client acquire 后不会自动推断/补 `leaseId`。
4. MCP acquire 后发送事件时带对应 `leaseId`。
5. Desktop 手测：
   - 多个 lease 创建多个窗口。
   - event `leaseId` 命中对应窗口。
   - event `source === leaseId` 命中对应窗口。
   - 相同 agent + 相同目录 + 不同 session 不串消息。
   - 拖动任意宠物只移动当前窗口。
   - release 后对应窗口延迟关闭。

## Non-goals

- 不新增 event `id` 字段。
- 不使用 `agentType/detail` 做事件路由。
- 不在 `@open-pets/client` 中做 session 记忆或自动补路由字段。
- 不持久化每个 lease 窗口位置。
