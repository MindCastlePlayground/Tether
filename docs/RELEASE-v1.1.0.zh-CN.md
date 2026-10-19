# Tether v1.1.0

[English](RELEASE-v1.1.0.md)

**发布日期：** 2026-10-19

## 安装变化

- `--extension-dir PATH` 将已解压扩展安装到独立目录，并记住位置供升级和诊断使用。
- `install --upgrade` 一条命令更新托管 runtime 与所选 Agent 的 Skill。
- `--force` 支持同版本重装，并备份后替换冲突的 Tether 文件和 MCP 配置项。
- 交互式安装提供上述选项。升级保留 runtime 凭据与扩展身份。

## 升级

使用原安装的 home/project 参数执行 `install.bat install --agent codex --upgrade`。添加 `--extension-dir "D:\Extensions\Tether"` 可选择独立扩展目录；确认需要覆盖冲突时使用 `--force`。完成后在浏览器重新加载扩展；移动目录时重新选择新文件夹。

参见[安装说明](INSTALL.zh-CN.md)和[验收记录](INSTALL-VERIFICATION.zh-CN.md)。
