# 飞牛 APP 中继访问 Immich 问题追踪

## 1. 文档用途

本文记录 AXERA AArch64 版本 Immich 通过飞牛 APP 中继访问时出现的登录、WebSocket、图片加载和图片上传问题，方便后续继续定位同一链路上的新问题。

本文只描述本次中继兼容问题。机器学习服务、模型运行和数据库部署问题不在本文范围内。

## 2. 当前状态

记录时间：2026-07-31。

| 项目                    | 当前状态                       |
| ----------------------- | ------------------------------ |
| 飞牛 APP 中继登录       | 正常                           |
| 飞牛 APP 中继 WebSocket | 正常                           |
| 飞牛 APP 中继图片加载   | 正常                           |
| 飞牛 APP 中继图片上传   | 正常                           |
| 局域网访问              | 正常，保持原有 Cookie 鉴权路径 |
| Immich Server           | `healthy`                      |
| Immich 版本             | `v3.0.1`                       |

本次修改无数据迁移，直接替换 Web 和 Server 相关逻辑。

## 3. 环境信息

| 项目            | 值                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| 服务器地址      | `xxx`                                                                                             |
| Immich 直连入口 | `http://xxx:2283`                                                                                 |
| 部署架构        | AXERA AArch64                                                                                                |
| 代码分支        | `yyue1024`                                                                                                   |
| Server 容器     | `immich_server`                                                                                              |
| PostgreSQL 容器 | `immich_postgres`                                                                                            |
| Redis 容器      | `immich_redis`                                                                                               |
| 机器学习容器    | `immich_machine_learning`                                                                                    |
| 部署 Compose    | `deploy/docker-compose.yml`                                                                                  |
| 服务器部署目录  | `/vol1/1000/immich/immich-axera-aarch64/immich-axera-aarch64-v3.0.1-nas.tar/immich-axera-aarch64-v3.0.1-nas` |

文档不记录 SSH 密码、用户密码或访问令牌。后续补充日志时也必须删除这些敏感信息。

## 4. 总体根因

本次问题不是 Immich 使用 HTTP 入口导致的，也不是 12M 网络带宽直接导致的。

判断依据：

1. 使用 `http://xxx:2283/photos` 直连正常。
2. 使用飞牛 APP 在局域网内访问正常。
3. 只有经过飞牛中继时出现登录、媒体和上传异常。
4. 服务器磁盘空间、inode、`/data/upload` 写入和容器健康状态均正常。

中继链路的核心差异是认证 Cookie 没有被可靠保留或发送。Immich 原有 Web 实现主要依赖 Cookie，但不同请求使用了不同浏览器机制，因此不能用一个修改覆盖所有请求：

| 请求类型         | 原始请求方式          | 中继兼容方式                                    |
| ---------------- | --------------------- | ----------------------------------------------- |
| 普通 API         | Immich SDK            | SDK 全局 `Authorization: Bearer`                |
| WebSocket        | Socket.IO 握手        | `handshake.auth.accessToken`，Server 端回退鉴权 |
| 图片、视频、头像 | 原生媒体 URL          | Cookie 缺失时追加 `sessionKey`                  |
| 文件上传         | 原生 `XMLHttpRequest` | Cookie 缺失时设置 `Authorization: Bearer`       |

## 5. 问题和修复过程

### 5.1 中继登录后无法保持认证

**现象**

- 局域网登录正常。
- 中继登录接口可能成功，但后续用户信息请求无法稳定完成认证。

**根因**

中继环境没有可靠保留 `immich_is_authenticated` Cookie。后续 SDK 请求只依赖 Cookie 时会返回未认证。

**修复**

- 登录成功后将访问令牌保存到浏览器 `localStorage`。
- 同时给 Immich SDK 设置全局 `Authorization: Bearer <token>`。
- 页面重新加载时恢复令牌。
- 登出时清除 SDK、Service Worker 和本地存储中的令牌。

**对应提交**

```text
968b247 修复飞牛app问题，不作为主线合入
```

**主要文件**

- `web/src/routes/auth/login/+page.svelte`
- `web/src/lib/managers/auth-manager.svelte.ts`
- `web/src/lib/utils/access-token.ts`

### 5.2 WebSocket 认证失败

**现象**

Server 日志出现 WebSocket 未认证，页面实时事件不可用或反复重连。

**根因**

Socket.IO 握手原来只使用请求 Cookie。中继缺少 Cookie 时，即使普通 API 已通过 Bearer 恢复，WebSocket 仍然无法认证。

**修复**

- Web 客户端在 Socket.IO `auth` 中发送本地访问令牌。
- Server 先执行原有 Cookie 鉴权。
- 只有原鉴权抛出 `UnauthorizedException` 时，才读取握手中的 `accessToken` 并按会话令牌重新鉴权。
- 非认证类错误不被吞掉，避免掩盖服务端真实异常。

**对应提交**

```text
cd6c6b3 修复图片无法下载问题
```

**主要文件**

- `web/src/lib/stores/websocket.ts`
- `server/src/app.module.ts`

### 5.3 中继图片无法加载

**现象**

- 普通 API 和 WebSocket 已恢复。
- 相册列表可以打开，但缩略图、原图、视频或头像仍可能无法显示。
- 清理浏览器缓存不能解决问题。
- 局域网访问正常。

**根因**

图片通常由 `<img>`、视频播放器或 HLS 地址直接加载，不经过 Immich SDK，因此 SDK 的 Bearer 请求头对这些请求无效。

第一阶段尝试由 Service Worker 给媒体请求添加 Bearer。该方案在普通浏览器中可以工作，但飞牛中继环境下 Service Worker 不一定处于安全上下文、已激活或实际控制当前页面，因此不能作为唯一方案。

**最终修复**

- 共享链接继续使用原有 `key` 或 `slug`。
- 普通登录且认证 Cookie 存在时保持原地址，不附加令牌。
- 普通登录、Cookie 缺失且本地令牌存在时，在媒体 URL 中追加 Immich 已支持的 `sessionKey`。
- 覆盖缩略图、原图、视频播放、HLS、人物缩略图和用户头像。
- Service Worker Bearer 逻辑作为补充路径保留。

**主要文件**

- `web/src/lib/utils.ts`
- `web/src/lib/utils/access-token.ts`
- `web/src/lib/utils.spec.ts`
- `web/src/service-worker/request.ts`
- `web/src/service-worker/messaging.ts`
- `web/src/lib/utils/sw-messaging.ts`
- `web/src/lib/utils/sw-messenger.ts`

**安全边界**

`sessionKey` 会出现在媒体 URL 中，可能被中继或访问日志记录。因此它只在 Cookie 缺失时启用，局域网正常路径不使用 URL 令牌。

### 5.4 中继图片上传失败

**现象**

- 图片已经可以加载。
- 通过飞牛中继上传图片时报错。
- Server 端没有新增资产记录，也没有明确的存储写入错误。
- 局域网上传正常。

**根因**

上传分为两个阶段：

1. `checkBulkUpload()` 通过 Immich SDK 请求，能够使用 SDK Bearer。
2. 真正的 `POST /api/assets` 文件上传使用独立 `XMLHttpRequest`，不会继承 SDK 全局请求头。

中继下 Cookie 缺失时，第二阶段既没有 Cookie，也没有 Bearer，所以请求无法通过认证。

**修复**

- `uploadRequest()` 增加可选的自定义请求头。
- 非共享链接、认证 Cookie 缺失且本地令牌存在时，为上传 XHR 设置 `Authorization: Bearer <token>`。
- 局域网 Cookie 正常时不添加额外请求头。
- 共享链接继续使用原有 URL 参数，不混用用户 Bearer。
- 空值认证 Cookie 不再被误判为有效 Cookie。

**主要文件**

- `web/src/lib/utils.ts`
- `web/src/lib/utils/file-uploader.ts`
- `web/src/lib/utils/access-token.ts`
- `web/src/lib/utils/file-uploader.spec.ts`
- `web/src/lib/utils.spec.ts`

## 6. 已排除的问题

以下项目在本次排查中已经验证，不是当前故障根因：

| 排查项          | 结论                                                         |
| --------------- | ------------------------------------------------------------ |
| HTTP 入口       | 直连 HTTP 和局域网 HTTP 均正常，不能据此判断必须改 HTTPS     |
| 网络带宽        | 12M 会影响加载和上传耗时，但不能解释只在中继下发生的认证失败 |
| 上传目录权限    | `/data/upload` 可写                                          |
| 磁盘空间        | 空间充足                                                     |
| inode           | 使用率正常                                                   |
| PostgreSQL      | 运行正常                                                     |
| Redis           | 运行正常                                                     |
| Server 健康状态 | 当前为 `healthy`                                             |
| 浏览器缓存      | 清理缓存后问题仍存在，说明不是单纯缓存问题                   |

## 7. 代码状态

### 7.1 已提交修改

```text
968b247 修复飞牛app问题，不作为主线合入
cd6c6b3 修复图片无法下载问题
```

### 7.2 当前工作区修改

截至 2026-07-31，媒体 URL `sessionKey` 和上传 XHR Bearer 的最终修改尚未形成独立提交，涉及：

```text
web/src/lib/managers/auth-manager.svelte.ts
web/src/lib/utils.spec.ts
web/src/lib/utils.ts
web/src/lib/utils/access-token.ts
web/src/lib/utils/file-uploader.spec.ts
web/src/lib/utils/file-uploader.ts
```

提交前必须将以上文件一起加入暂存区，避免 CI 镜像只包含部分修复：

```bash
git add \
  deployment/axera/aarch64/fnos-relay-troubleshooting.md \
  web/src/lib/managers/auth-manager.svelte.ts \
  web/src/lib/utils.spec.ts \
  web/src/lib/utils.ts \
  web/src/lib/utils/access-token.ts \
  web/src/lib/utils/file-uploader.spec.ts \
  web/src/lib/utils/file-uploader.ts
```

## 8. 构建和测试记录

### 8.1 依赖检查

```bash
test -x web/node_modules/.bin/vite && echo "web vite ready"
test -x packages/sdk/node_modules/.bin/tsc && echo "sdk typescript ready"
```

### 8.2 定向测试

```bash
corepack pnpm --filter immich-web test --run \
  src/lib/utils/file-uploader.spec.ts \
  src/lib/utils.spec.ts \
  src/service-worker/request.spec.ts
```

最终结果：3 个测试文件、26 项测试全部通过。

### 8.3 TypeScript 检查

```bash
corepack pnpm --filter immich-web check:typescript
```

最终结果：通过。

### 8.4 Web 构建

```bash
corepack pnpm --filter @immich/sdk --filter immich-web build
```

最终结果：

- SDK 构建成功。
- Web 构建成功。
- 构建耗时约 15 秒。
- `web/build` 约 35MB，共 1157 个文件。

## 9. 当前服务器部署状态

当前运行 Web 首页 SHA256：

```text
187763cb7f737bae8bbe23b64bdbd7611e52437720eb25a0b9e9b55aa2fe0aa6
```

容器内目录：

| 目录                            | 用途                       | 首页 SHA256                                                        |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `/build/www`                    | 当前正常版本               | `187763cb7f737bae8bbe23b64bdbd7611e52437720eb25a0b9e9b55aa2fe0aa6` |
| `/build/www.before-upload-auth` | 上传鉴权修复前版本         | `bd7491780ccef459a1456a3cd74cf1fe1096eaddad15f7cd53f8e4f067aa370e` |
| `/build/www.before-sessionkey`  | 媒体 sessionKey 修复前版本 | `32ea1d6f09c222693af021becb82d151adb64b48d991846b7a97e4211722b538` |

当前健康检查：

```text
immich_server healthy
immich_postgres healthy
immich_redis healthy
immich_machine_learning healthy
GET /api/server/ping -> {"res":"pong"}
```

## 10. 正式镜像和热替换边界

本次中继修复涉及 Web，并包含一处 Server WebSocket 修改。Web 产物位于 `ax-immich-server` 镜像的 `/build/www` 中，因此正式发布时只需要重新构建并替换 Server 镜像，不需要替换 PostgreSQL、Redis 或机器学习镜像。

当前服务器使用的是容器可写层中的 Web 热替换版本。以下操作可能重建容器并丢失热替换内容：

- 删除 `immich_server` 容器。
- 使用新镜像强制重建容器。
- 执行会触发容器重新创建的 Compose 配置变更。

因此最终必须把全部源代码修改提交到 Git，并由 CI 重新构建 `ax-immich-server` 镜像。正式镜像部署完成后，容器内临时备份不再是唯一回退依据。

## 11. Compose 操作

部署目录：

```bash
cd /vol1/1000/immich/immich-axera-aarch64/immich-axera-aarch64-v3.0.1-nas.tar/immich-axera-aarch64-v3.0.1-nas
```

启动或更新 Server Compose：

```bash
sudo docker compose -f deploy/docker-compose.yml up -d
```

只重启当前容器并保留容器可写层热修复：

```bash
sudo docker compose -f deploy/docker-compose.yml restart immich-server
```

不要使用 `deploy/docker-compose.ml.yml` 重启 Server。没有明确需要时也不要使用 `--force-recreate`。

## 12. 临时回退方式

只有当前热替换版本发生严重问题时才执行回退。回退上传鉴权修复：

```bash
sudo docker exec immich_server sh -c '
  set -eu
  test -d /build/www.before-upload-auth
  rm -rf /build/www.failed-upload-auth
  mv /build/www /build/www.failed-upload-auth
  mv /build/www.before-upload-auth /build/www
'

cd /vol1/1000/immich/immich-axera-aarch64/immich-axera-aarch64-v3.0.1-nas.tar/immich-axera-aarch64-v3.0.1-nas
sudo docker compose -f deploy/docker-compose.yml restart immich-server
```

回退后应立即检查：

```bash
sudo docker ps --filter name=immich_server
curl -fsS http://127.0.0.1:2283/api/server/ping
sudo docker exec immich_server sha256sum /build/www/index.html
```

## 13. 后续问题排查顺序

后续出现新问题时，按以下顺序排查，避免把中继问题误判为 Immich 服务或网络带宽问题。

### 13.1 先比较访问路径

使用同一账号、同一文件和同一时间段分别验证：

1. 浏览器直连 `http://xxx:2283`。
2. 飞牛 APP 局域网访问。
3. 飞牛 APP 中继访问。

只有第三种失败时，优先检查中继对 Cookie、请求头、URL、WebSocket、请求体大小和超时的处理。

### 13.2 再识别失败请求类型

| 功能           | 重点请求                                    |
| -------------- | ------------------------------------------- |
| 登录和用户信息 | `/api/auth/login`、`/api/users/me`          |
| WebSocket      | `/api/socket.io`                            |
| 图片缩略图     | `/api/assets/<id>/thumbnail`                |
| 图片原图       | `/api/assets/<id>/original`                 |
| 视频           | `/api/assets/<id>/video/playback`、HLS 地址 |
| 上传预检       | `/api/assets/bulk-upload-check`             |
| 文件上传       | `POST /api/assets`                          |

检查请求中是否至少存在一种有效认证：

- `immich_is_authenticated` Cookie；
- `Authorization: Bearer <token>`；
- 媒体 URL 的 `sessionKey`；
- 共享链接的 `key` 或 `slug`。

### 13.3 检查 Server 是否收到请求

```bash
sudo docker logs --since 10m immich_server 2>&1 | tail -300
```

- Server 有 401 或认证错误：优先检查认证信息。
- Server 完全没有对应请求：优先检查飞牛中继转发、请求体限制或客户端缓存。
- Server 已接收请求并返回 413：检查中继或反向代理上传大小限制。
- 小文件成功、大文件失败：优先检查中继请求体大小、上传超时和网络中断，不再优先修改认证代码。

### 13.4 检查服务和存储

```bash
sudo docker ps --format '{{.Names}} {{.Status}}' | grep '^immich_'
sudo docker exec immich_server sh -c 'test -w /data/upload && echo upload_write_ok'
curl -fsS http://127.0.0.1:2283/api/server/ping
```

只有确认请求已经到达 Server 且通过鉴权后，才继续检查存储、数据库和后台任务。

## 14. 中继能力边界

当前已确认解决的是中继缺少 Cookie 时的认证兼容问题。

以下问题尚不能由当前代码修复保证：

- 飞牛中继限制单次上传文件大小。
- 飞牛中继对长时间上传设置较短超时。
- 中继网络中断导致大文件上传失败。
- 飞牛 APP 内置浏览器长期保留旧 Service Worker 或旧首页。
- 飞牛中继修改跨域、安全上下文或 WebSocket 策略。

出现“小图片正常、大图片失败”时，不应继续增加新的鉴权兜底，应先取得 HTTP 状态码、文件大小、上传耗时和中继日志。

## 15. 新问题记录模板

后续在本文末尾追加记录，至少填写以下信息：

```text
问题编号：FNOS-RELAY-XXX
发生时间：
当前提交：
当前镜像标签：
客户端和飞牛 APP 版本：
访问路径：直连 / 局域网 / 中继
操作步骤：
文件类型和大小：
界面错误文字：
失败请求 URL：
HTTP 状态码：
Cookie 是否存在：
Authorization 是否存在：
sessionKey 是否存在：
Server 是否收到请求：
Server 日志时间段：
直连对比结果：
局域网对比结果：
中继对比结果：
已确认根因：
修改文件：
验证命令和结果：
部署版本和首页 SHA256：
是否需要回退：
最终状态：处理中 / 已解决 / 外部限制
```

## 16. 当前结论

截至 2026-07-31，飞牛 APP 中继下的登录、WebSocket、媒体加载和图片上传均已由用户确认恢复正常。当前方案遵循以下原则：

1. 局域网 Cookie 正常路径不改变。
2. 普通 API 使用 Bearer 兜底。
3. WebSocket 使用握手令牌兜底。
4. 原生媒体请求使用 `sessionKey` 兜底。
5. 上传 XHR 使用 Bearer 请求头兜底。
6. 共享链接继续使用原有共享链接鉴权。
7. 后续大文件失败应先检查中继限制，不应直接归因于 Immich 网络或 HTTP 入口。
