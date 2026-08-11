# TierFlow Appliance

TierFlow 一体机系统的开发与验证仓库，包含 TierFlow 定制平台源码、部署配置、虚拟机自动化脚本以及 DGX Spark 一体机方案文档。

## 目录结构

- `tierflow-core-main/`：TierFlow 定制平台源码。
- `new-api/`：上游 New API 仓库，以 Git 子模块管理。
- `deploy/`：本地开发及验证部署文件。
- `vm/`：一体机虚拟机配置、启动和修复脚本。
- `dgx-spark-appliance-solution.md`：DGX Spark 一体机总体实施方案。

虚拟磁盘、系统镜像、运行数据库、日志、截图、压缩包和本地密钥不会进入版本库。

## 克隆

```bash
git clone --recurse-submodules <repository-url>
```

已有工作副本可使用：

```bash
git submodule update --init --recursive
```
