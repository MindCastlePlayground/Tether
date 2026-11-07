# Tether 3.2.0

[English](RELEASE-v3.2.0.md) · [项目](../README.zh-CN.md)

## 安装器支持 DeepSeek Harness

- **解决的问题：** 安装器无法检测或配置 dsh。
- **根因：** 既有检测和路径仅覆盖五种客户端，配置写入器仅支持 JSON 和 TOML；DSH 使用 Cordis YAML 补丁列表。
- **解决方案：** 增加 `--agent dsh`、PATH/主目录自动检测、向导选项，以及 stdio `@deepseek-ai/dsh-mcp-client` 插入补丁，并安装浏览器 Skill。保留 YAML 注释、自定义标签和无关配置；Tether 配置冲突时需使用 `--force`，沿用既有备份流程。
- **影响点：** 用户级使用 `$DSH_HOME/cordis.patch.yml` 和 `$DSH_HOME/skills/tether-browser`（默认主目录 `~/.dsh`）；项目级使用 `.dsh/cordis.patch.yml` 和 `.dsh/skills/tether-browser`，启动命令为 `dsh --patch .dsh/cordis.patch.yml`。其他客户端和浏览器行为保持现状。安装器不安装 dsh，也不替它登录。

## 验证

根目录安装器测试覆盖隔离配置与 Skill 安装、重复安装、YAML 保留、冲突、检测及自定义主目录。当前开发主机没有 dsh 可执行文件，因此未验证 dsh 自身启动。

配置遵循[官方 MCP 客户端契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)和[配置补丁加载顺序](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)。
