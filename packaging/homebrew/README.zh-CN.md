# Homebrew：ChatGPT Community

此 cask 直接下载 OpenAI 的官方 Linux RPM，并在本机应用现有社区功能。
它不下载 AppImage，也不分发修改后的 ChatGPT 二进制文件。

## 首次发布

初始 cask 处于禁用状态。新适配器必须先进入 GitHub 上可下载的源码提交，并通过两个架构的验证。
实现合并到 `main` 后，`Update Homebrew Cask` 工作流会创建首次发布 PR。
该 PR 合并后即可安装。请勿手动移除 `disable!`。

## 安装

首次验证发布完成后，运行：

```bash
brew tap bruglet/chatgpt-desktop-linux https://github.com/bruglet/chatgpt-desktop-linux
brew install --cask bruglet/chatgpt-desktop-linux/chatgpt-community
codex-desktop --diagnose
```

需要支持 Linux `preflight_steps` 和 `command_wrapper` 的 Homebrew 6。
支持 x86-64 和 ARM64。Homebrew 安装 Node 24、Python、Rust、RPM 解包工具和 curl。
主机需要提供 C 链接器及官方 Electron 程序需要的桌面库。
Ubuntu 24.04 图形测试使用 GTK 3、NSS、ALSA 和 GBM。

主机必须允许 Chromium 沙箱使用非特权用户命名空间。
cask 不会修改 AppArmor 策略、安装系统软件包或关闭 Chromium 沙箱。
若主机限制用户命名空间，请由管理员配置适当策略。

菜单名称为 **ChatGPT Community**，启动命令为 `codex-desktop`。
程序保存在 Homebrew Caskroom 中。桌面文件和图标使用 `$XDG_DATA_HOME`，默认是 `~/.local/share`。
启动器保留参数和深层链接，并调用现有社区启动器。

启用的功能来自固定源码提交中的 `features.json`：

- `mcp-helper-reaper`
- `node-repl-reaper`
- `tray-usage`。

本版本不提供自定义功能选择。官方版和社区版共享 Codex 用户资料，不要同时运行。
若原生安装已占用 `codex-desktop` 命令或桌面文件，请先通过原包管理器卸载冲突的安装。
不要使用 `--force` 覆盖其他安装的文件。

## 更新和卸载

先关闭 ChatGPT，再运行：

```bash
brew update
brew upgrade --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

普通更新同时支持 OpenAI 版本更新和社区补丁修订，无需 `--greedy`。
更新由 Homebrew 管理，不安装社区更新器。

首次安装会从源码编译 MCP helper。后续安装会复用经过校验的本地缓存。
缓存键包含源码、Cargo 锁文件、架构、编译器信息和构建参数。
只有 OpenAI 版本变化时，无需重新编译 helper。缓存缺失、损坏或构建输入改变时会重新编译。
Homebrew 清理缓存不会影响安装正确性。

```bash
brew uninstall --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

普通卸载及 `--zap` 均保留共享的 ChatGPT/Codex 用户资料、插件和会话。

## 错误恢复

解包或补丁失败会在公开启动器和桌面文件安装前终止。
Homebrew 控制升级回滚。CI 生命周期测试验证对应 Homebrew 版本的行为。
重新安装可能先移除旧安装，因此不能将重新安装视为事务备份。
若重新安装失败，请保留日志，解决依赖、下载或补丁问题后再次安装。

## 维护

所有 Homebrew 文件都是下游新增文件。现有上游文件和 AppImage 工作流保持不变。
更新工作流在 `main` 变化时、每小时以及手动触发时运行。
工作流将固定源码提交绑定到已接受的软件包版本及当前签名 APT 发布信息。
两个架构分别比较 RPM 和签名 DEB 的程序内容、符号链接及可执行权限。
DEB 将 Electron 的 `LICENSE` 移至 `usr/share/doc/chatgpt/copyright`。
比较过程仍校验该文件与 RPM 中 `LICENSE` 的内容及可执行权限，不会忽略许可证差异。

实际 cask 测试保持 Homebrew 沙箱启用。
图形测试只在一次性 CI 主机上调整 AppArmor 用户命名空间限制；客户端安装不修改主机配置。
两个架构验证成功后，工作流创建 `automation/homebrew-cask` PR 并启用自动合并。

请配置具有 Contents 和 Pull requests 写权限的 `UPSTREAM_SYNC_TOKEN`。
请在发布 PR 的仓库规则中要求两个 Homebrew CI 架构检查。
该令牌必须能够触发 PR 工作流，不能只使用 `GITHUB_TOKEN`。

cask 版本格式为 `<OpenAI version>,<downstream revision>`。
cask 内嵌发布清单和简短启动脚本。它先校验固定源码归档，再运行 RPM 适配器。
补丁引擎和功能代码仍来自源码归档。工作流仅上传元数据和诊断信息，不发布修改后的 ChatGPT。

本地验证命令及适配器接口见 [英文说明](README.md)。
请勿在个人 Homebrew 安装上运行 `lifecycle.sh`；它仅适用于一次性 GitHub Actions 主机。
