# TierFlow 新服务器部署手册 (v1.0.1)

把现有服务器的全部数据（渠道 / 模型价格 / 分层计费表达式 / 用户 / token / 系统设置）
和静态资源整体迁移到新服务器，**无需重新配置任何上游渠道或价格**。

---

## 本 bundle 内容

| 文件                          | 说明                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `tierflow-db.sql.gz`          | `tierflow` 库全量导出（含建库语句）。渠道/价格/计费/用户/token/系统设置全在这里 |
| `data-public.tgz`             | `./data/public` 静态资源（当前含 `tierflow-logo.svg`）       |
| `docker-compose.tierflow.yml` | 部署用 compose（已指向 GHCR 镜像）                           |
| `env.snapshot`                | 旧服务器 `.env` 快照 **（含明文密钥，注意保密）**            |
| `DEPLOY.md`                   | 本文件                                                       |

> 关于 `<PAT>`：GitHub 个人访问令牌，相当于一次性密码，用来让 Docker 代表你的账号拉
> **私有**镜像。在 https://github.com/settings/tokens → Tokens(classic) 生成，**勾 `read:packages`**
> （部署机只拉镜像，读权限即可），复制 `ghp_...` 那串就是 `<PAT>`。它必须属于对镜像有读权限的
> 账号（owner 或仓库协作者）。

---

## 阶段 0 · 新服务器前置检查

```bash
# 0.1 确认 Docker + Compose v2（没有就装）
docker --version && docker compose version
#   未安装:  curl -fsSL https://get.docker.com | sh   然后 systemctl enable --now docker

# 0.2 确认网络:能出外网(拉镜像+上游渠道)、能到 infer 机
curl -s -o /dev/null -w '%{http_code}\n' https://ghcr.io      # 期望非 000
ping -c1 <infer机IP>                                          # 推理路由要用到

# 0.3 准备 GitHub PAT(勾 read:packages),用于拉私有镜像
#     https://github.com/settings/tokens → Tokens(classic) → 勾 read:packages
```

## 阶段 1 · 传输并解包

```bash
# 在旧机上把包传到新机(或用 U 盘/对象存储)
scp tierflow-migrate-20260613.tar.gz <用户>@<新服务器>:~/

# 新机上
cd ~
sha256sum tierflow-migrate-20260613.tar.gz        # (可选)和旧机 .sha256 对比
tar xzf tierflow-migrate-20260613.tar.gz
cd tierflow-migrate-20260613                       # ← 之后所有命令都在这个目录里跑
ls -la
```

## 阶段 2 · 登录 GHCR（私有镜像，必须）

```bash
echo "<你的PAT>" | docker login ghcr.io -u <你的GitHub用户名> --password-stdin
# 期望输出: Login Succeeded
```

## 阶段 3 · 配置 .env

```bash
cp env.snapshot .env
echo 'TIERFLOW_IMAGE=ghcr.io/zer0echo/tierflow-api:v1.0.1' >> .env   # 钉死镜像版本(推荐)
nano .env
```

`.env` 逐项确认：

| 变量                             | 怎么处理                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| `INFERENCE_SERVICE_URL`          | **必改** → 新机能访问到 infer 机的地址（旧值内网 `http://192.168.31.15:8001`） |
| `INFERENCE_SERVICE_SECRET`       | 和 infer 端保持一致，一般不动                                |
| `SESSION_SECRET`                 | **保持不变** → 旧网页登录会话继续有效（改了只是要重登；API token 不受影响） |
| `DB_PASSWORD` / `REDIS_PASSWORD` | 保留即可（compose 两边自动对齐）                             |
| `TIERFLOW_IMAGE`                 | `ghcr.io/zer0echo/tierflow-api:v1.0.1`                       |
| `PORT`                           | 默认 3000，如冲突可改                                        |

## 阶段 4 · 还原静态资源

```bash
mkdir -p data logs
tar xzf data-public.tgz             # 解出 data/public/tierflow-logo.svg
ls data/public                      # 确认 logo 在
```

## 阶段 5 · 先起 MySQL，导入旧库（关键：必须在起 app 之前）

```bash
docker compose -f docker-compose.tierflow.yml up -d mysql

# 等 mysql 变 healthy
watch -n3 'docker compose -f docker-compose.tierflow.yml ps'   # Ctrl+C 退出

# 导入(渠道/价格/计费/用户/token 全进来)
gunzip -c tierflow-db.sql.gz | \
  docker exec -i tierflow-mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'

# 校验:应看到 27 张表
docker exec tierflow-mysql sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"tierflow\";"' 2>/dev/null
```

## 阶段 6 · 起全套

```bash
docker compose -f docker-compose.tierflow.yml pull          # 拉 app 镜像 v1.0.1
docker compose -f docker-compose.tierflow.yml up -d
docker compose -f docker-compose.tierflow.yml ps            # api/mysql/redis 都应 healthy
```

## 阶段 7 · 验证

```bash
curl -s http://localhost:3000/api/status                    # 期望 "success":true
docker compose -f docker-compose.tierflow.yml logs -f tierflow-api   # 看启动日志,Ctrl+C 退出
```

浏览器开 `http://<新服务器IP>:3000`，用**原账号**登录，核对：

- 上游渠道列表都在、key 没丢
- 模型价格 / 分层计费表达式正确
- 发一条测试请求走通（验证 infer 路由 + 上游连通）

## 阶段 8 · 收尾

```bash
# 8.1 安全:删掉含明文密钥的快照
shred -u env.snapshot 2>/dev/null || rm -f env.snapshot

# 8.2 防火墙:对外只放需要的端口
#     直连:放行 3000;走 Nginx/反代:只放 80/443,3000 留内网

# 8.3 开机自启已由 compose 的 restart: unless-stopped 保证
```

---

## 注意事项

1. **必须用 `docker-compose.tierflow.yml`（MySQL）**，不要用上游 `docker-compose.yml`
   （那是 PostgreSQL + 不同库名，会连到空库，看起来像数据没了）。
2. **导库要在首次启动 app 之前做**（阶段 5 先于阶段 6）：导进空库，app 再跑幂等迁移。
3. 库名固定 `tierflow`、MySQL 固定 8.4（compose 已写死），无需手动改。
4. **旧服务器迁移期间可继续运行**；新机验证 OK 再切流量。
5. `env.snapshot` / `.env` 含明文密钥，部署完注意保管或删除。

---

## 回滚

新机有任何问题——**旧服务器原样在跑，直接把流量切回旧机**即可。`tierflow-db.sql.gz` 本身就是
完整备份，可随时重新导入。切流量前不要动旧机数据。

---

## 一页速记（熟练后）

```bash
tar xzf tierflow-migrate-20260613.tar.gz && cd tierflow-migrate-20260613
echo "<PAT>" | docker login ghcr.io -u <用户名> --password-stdin
cp env.snapshot .env && echo 'TIERFLOW_IMAGE=ghcr.io/zer0echo/tierflow-api:v1.0.1' >> .env && nano .env   # 改 INFERENCE_SERVICE_URL
mkdir -p data logs && tar xzf data-public.tgz
docker compose -f docker-compose.tierflow.yml up -d mysql      # 等 healthy
gunzip -c tierflow-db.sql.gz | docker exec -i tierflow-mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
docker compose -f docker-compose.tierflow.yml pull && docker compose -f docker-compose.tierflow.yml up -d
curl -s http://localhost:3000/api/status
```