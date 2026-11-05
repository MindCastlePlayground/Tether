# 开发与发布

[English](DEVELOPMENT.md) · [项目介绍](../README.zh-CN.md)

- `main` 保存当前可发布的源码、安装器、文档和可复现测试。
- `dev` 用于下一版本的开发集成，验证后再合并到 `main` 发布。
- 两个分支均公开。凭据、本地运行状态、原始验收数据、调试截图和临时安装仅保存在被忽略的本地目录。
- npm 的 `files` 白名单定义可安装发布包。测试及开发脚本保留在 Git 中，不进入安装包。

`prototype/` 是当前运行源码目录的历史名称，安装器会复制并构建它，发布时必须保留。需要改名时，应单独迁移安装器引用和已有使用流程。

版本号遵循 `a.b.c`：`a` 用于重大功能或破坏性更新，并同步更新配套组件；`b` 用于功能更新；`c` 用于修复。本次补丁版本为 `3.0.2`，根安装器与 `prototype/` 包版本保持一致。为适配当前集成，Playwright 固定为 1.64.0。依赖使用兼容的同主版本范围；安装使用 `npm install --package-lock=false`，继承用户配置的 registry 与企业 npm 设置。两个目录均不提交 lock 文件。

合并前在根目录运行 `npm test` 和 `npm run docs:check`；运行代码变更还需在 `prototype/` 执行 `npm install --package-lock=false`、构建和测试。安装器改动使用隔离 home 与项目验收；不希望切换当前浏览器注册时，传入 `--no-register --no-open`。
