# 后端预留架构草案 v0.1

更新时间：2026-03-12

## 1. 文档目标

这份文档的目标不是现在就设计完整后端，而是回答：

`在当前不上后端的前提下，前端/桌面端应该怎么设计，才能避免以后接云同步和商业化时推倒重来。`

## 2. 结论

当前阶段可以不上后端，但必须从现在起按以下原则设计：

- 业务层不直接依赖本地存储
- 数据模型从第一天就具备同步友好性
- AI 调用从第一天就具备 provider 可替换性
- 附件与元数据从第一天就分离

## 3. 未来大概率会有的后端能力

第一层：

- 账户系统
- 云同步
- 附件存储
- AI 代理层
- 基础埋点

第二层：

- 搜索索引
- OCR 索引
- 备份恢复
- 计费与订阅

第三层：

- 团队协作
- 分享链接
- 权限系统
- 管理后台

## 4. 当前就要落下来的架构约束

### 4.1 Repository 抽象层

业务代码不能直接写：

- IndexedDB API
- Local file API
- Electron store API

而是应该通过接口访问。

建议接口：

- `CaptureRepository`
- `SourceCardRepository`
- `TaskItemRepository`
- `BoardRepository`
- `AttachmentRepository`

这样当前可以是本地实现，未来可以加：

- `LocalCaptureRepository`
- `CloudCaptureRepository`

## 4.2 稳定数据模型

核心对象：

- `Capture`
- `SourceCard`
- `TaskItem`
- `Board`
- `Attachment`

要求：

- 每个对象都要有稳定 ID
- ID 生成策略不能依赖临时数组下标
- 对象结构要考虑未来序列化和同步

## 4.3 Schema Version

所有持久化对象建议都有：

- `schemaVersion`
- `createdAt`
- `updatedAt`

原因：

- 未来一定会改字段
- 没有版本迁移会导致历史数据难以恢复

## 4.4 附件与元数据分离

不要把截图、图片、OCR 结果、任务元数据混成一个大对象。

建议：

- `Attachment` 单独存二进制或文件引用
- `Capture` 只引用 `attachmentIds`
- OCR / 摘要 / 标签作为元数据单独存

这样以后更容易做：

- 云上传
- 去重
- 压缩
- CDN

## 4.5 AI Provider 抽象

第一版即使先走本地 mock 或直连外部 API，也不应该把业务逻辑写死到某个 SDK。

建议接口：

- `summarizeCapture()`
- `extractTaskSuggestions()`
- `extractTimeHints()`

未来可以切换为：

- 本地规则
- 客户端直连模型
- 自建后端代理
- 多模型路由

## 4.6 变更导向而不是整块覆盖

未来同步时，最怕只有“大对象整体覆盖”。

从现在起建议按变更组织操作：

- 创建 Capture
- 创建 SourceCard
- 创建 TaskItem
- 更新 TaskItem 状态
- 建立 SourceCard 与 TaskItem 的关联
- 更新画布位置

即使本地实现里暂时还是整块保存，业务语义也要先独立出来。

## 5. 推荐模块边界

```text
src/
  domain/
    models/
    services/
  repositories/
    interfaces/
    local/
    future-cloud/
  storage/
    local-db/
    attachments/
  ai/
    adapters/
    prompts/
  sync/
    future/
```

说明：

- `repositories/interfaces` 定义业务读写契约
- `repositories/local` 放当前本地实现
- `future-cloud` 先占位，不一定现在实现
- `sync/future` 先占目录和边界，方便后续接入

## 6. 核心对象建议字段

### Capture

- `id`
- `schemaVersion`
- `createdAt`
- `updatedAt`
- `sourceType`
- `rawText`
- `attachmentIds`
- `ocrText`
- `aiStatus`

### SourceCard

- `id`
- `schemaVersion`
- `captureId`
- `boardId`
- `position`
- `title`
- `summary`
- `tagIds`

### TaskItem

- `id`
- `schemaVersion`
- `boardId`
- `title`
- `summary`
- `status`
- `timeHint`
- `sourceCardIds`
- `confidence`

### Board

- `id`
- `schemaVersion`
- `name`
- `createdAt`
- `updatedAt`

### Attachment

- `id`
- `schemaVersion`
- `mimeType`
- `storageKey`
- `size`
- `sha256`

## 7. 当前不做但要留口的东西

现在不做：

- 登录
- 远程数据库
- 云对象存储
- 实时同步
- 计费

但现在就要为它们留口：

- `userId` 可选字段
- `remoteId` 可选字段
- `syncState` 可选字段
- `lastSyncedAt` 可选字段

## 8. 商业化前最先补的后端顺序

建议顺序：

1. 账号
2. AI 代理层
3. 云同步
4. 附件云存储
5. 搜索索引
6. 订阅计费

## 9. 当前判断

结论：

- 现阶段可以不做后端
- 但现阶段绝对不能把架构写死在“纯本地、纯单体、纯直连 AI”上

一句话版本：

`现在不上后端，是为了更快验证产品；现在就按将来会上后端来设计，是为了不把自己锁死。`
