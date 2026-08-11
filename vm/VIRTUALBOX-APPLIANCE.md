# TierFlow 一体机验证虚拟机

虚拟机名称：`TierFlow-Appliance-Dev`

该虚拟机用于在 DGX Spark 到货前验证 TierFlow 的本地前端、容器启动、自动登录、全屏 kiosk、冷启动和界面崩溃恢复。它是 x86_64/VirtualBox 验证环境，不替代最终的 DGX OS、Arm64、GB10 GPU、Secure Boot、Cage/Weston 和 Qt 6/QML 原生 System Shell 验收。

## 启动与关机

```powershell
powershell -ExecutionPolicy Bypass -File C:\tierflow\vm\Start-TierFlowApplianceVM.ps1
powershell -ExecutionPolicy Bypass -File C:\tierflow\vm\Stop-TierFlowApplianceVM.ps1
```

开机后会自动登录设备账户，等待 TierFlow API 就绪，然后以全屏 kiosk 显示登录页。Firefox 被关闭或异常退出后会自动恢复，并在重新启动前清除浏览恢复数据。

## 开发连接

- 宿主机前端：`http://127.0.0.1:3300`
- SSH：`127.0.0.1:2222`
- 虚拟机账户：`tierflow`

宿主端口仅用于开发验证；DGX Spark 生产拓扑不应直接暴露 TierFlow/New API 内部管理端口。

## 当前验证边界

- 已验证：TierFlow 源码镜像、SQLite 持久化、Docker 自动恢复、图形自动登录、全屏启动、冷启动、自恢复。
- 尚未验证：Arm64 镜像、NVIDIA Container Toolkit/GB10、Qt/QML 原生 Shell、Cage/Weston、磁盘加密、Secure Boot、USBGuard、生产网络隔离、签名更新和回滚。

