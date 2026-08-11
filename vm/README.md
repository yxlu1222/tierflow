# TierFlow 开发虚拟机

本目录用于在 Windows 开发机上创建独立的 `TierFlow-Dev` WSL2 Ubuntu 24.04 环境。它负责验证 TierFlow 后台服务、New API、数据库和容器编排，不替代 DGX Spark 真机上的 Arm64、GPU、UEFI、原生系统外壳、USB 和断电测试。

## 已采用的边界

- 开发环境：Windows WSL2，`x86_64` Ubuntu 24.04
- 生产一体机：DGX Spark 原生 DGX OS，`aarch64`，不嵌套虚拟机
- 应用运行：Docker Compose + systemd
- 最终本地界面：Cage/Weston + Qt 6/QML 原生 TierFlow System Shell，不使用浏览器作为产品界面

## 管理命令

```powershell
wsl -d TierFlow-Dev
wsl --terminate TierFlow-Dev
wsl --shutdown
wsl --list --verbose
```

WSL 在没有前台会话时可能自动休眠。要在后台持续运行 New API，可执行：

```powershell
powershell -ExecutionPolicy Bypass -File C:\tierflow\vm\Start-TierFlowDev.ps1
```

停止后台虚拟机：

```powershell
powershell -ExecutionPolicy Bypass -File C:\tierflow\vm\Stop-TierFlowDev.ps1
```

## 重新执行初始化

```powershell
wsl -d TierFlow-Dev -u root -- bash /mnt/c/tierflow/vm/bootstrap-tierflow-dev.sh
```

## 验证

```powershell
wsl -d TierFlow-Dev -- bash /mnt/c/tierflow/vm/verify-tierflow-dev.sh
```

如果当前网络无法直接访问 Docker Hub，可为这个开发虚拟机配置镜像加速：

```powershell
wsl -d TierFlow-Dev -u root -- bash /mnt/c/tierflow/vm/configure-docker-mirror.sh
```

镜像加速只用于开发环境。生产一体机应从企业自建仓库拉取经过 digest 固定和签名验证的镜像。

## 启动 New API 验证栈

```powershell
wsl -d TierFlow-Dev -- bash /mnt/c/tierflow/deploy/dev/start.sh
```

`http://127.0.0.1:3000` 仅用于开发人员调试 New API 后台，不是最终产品入口。PostgreSQL 和 Redis 只存在于内部容器网络，不映射到 Windows；正式一体机上的本地用户只进入 TierFlow System Shell。

```powershell
wsl -d TierFlow-Dev -- bash /mnt/c/tierflow/deploy/dev/status.sh
wsl -d TierFlow-Dev -- bash /mnt/c/tierflow/deploy/dev/stop.sh
```

## 限制

该虚拟机是 x86_64，不可用于判断 DGX Spark 的 Arm64 镜像、GB10 GPU、统一内存或物理设备安全是否合格。正式发布仍需经过 Arm64 集成环境和真实 DGX Spark。
