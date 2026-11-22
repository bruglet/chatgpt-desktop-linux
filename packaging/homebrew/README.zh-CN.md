# Homebrew：ChatGPT Community

此 cask 在 x86-64 和 ARM64 Linux 上安装预构建的 ChatGPT Community 归档。

## 安装

```bash
brew tap bruglet/chatgpt-desktop-linux https://github.com/bruglet/chatgpt-desktop-linux
brew install --cask bruglet/chatgpt-desktop-linux/chatgpt-community
codex-desktop --diagnose
```

需要支持 Linux `preflight_steps` 和 `command_wrapper` 的 Homebrew 6。
Homebrew 校验并解包归档。主机需要提供 Electron 所需的桌面库。
Ubuntu 24.04 图形测试使用 GTK 3、NSS、ALSA 和 GBM。

主机必须允许 Chromium 沙箱使用非特权用户命名空间。
cask 不会修改 AppArmor 策略、安装系统软件包或关闭 Chromium 沙箱。
若主机限制用户命名空间，请由管理员配置适当策略。

菜单名称为 **ChatGPT Community**，启动命令为 `codex-desktop`。
程序保存在 Homebrew Caskroom 中。桌面文件和图标使用 `$XDG_DATA_HOME`，默认是 `~/.local/share`。
启动器保留参数和深层链接，并调用现有社区启动器。

启用的功能来自固定源码提交中的 `packaging/homebrew/features.json`。
这是此 fork 的 cask 功能配置。正常的 Homebrew 更新会保留该配置。

- `mcp-helper-reaper`
- `node-repl-reaper`
- `pet-overlay`
- `computer-use-linux`
- `flatpak-chrome-native-messaging`
- `record-and-replay`
- `agent-workspace`
- `community-features-in-gui-settings`
- `global-dictation`
- `global-dictation-gnome`
- `wayland-global-shortcuts`
- `appshots`
- `start-minimized-to-tray`
- `model-picker-default-presets`

Record & Replay 也会启用必需的 Chronicle/Skysight 依赖。
Default 模型滑块按以下顺序显示预设：6 Luna High、6.1 Terra Low、Medium、High，
然后是 6.1 Sol Medium、High、Xhigh。默认仍为 Sol Medium。
此功能没有预设数量上限；本构建使用七个位置。账号不可用的模型会被省略，
上游的推理强度显示设置仍然有效。
CI 编译并打包所需的辅助程序。
新版 cask 必须先通过双架构验证。

Agent Workspaces 页面位于设置中。在该页面安装单独的后端（0.6.0 或更新版本），
并运行诊断以检查主机依赖。功能目录位于“设置 → 常规”，显示构建中包含的功能。
“启动时最小化到托盘”在“设置 → 常规”中添加开关；更新后请手动选择所需行为。
AppShots 在输入框中添加窗口截图功能，主机需要可用的截图工具和窗口控制后端。

GNOME 听写扩展支持 GNOME Shell 45–50。首次启动后，注销并重新登录，再手动启用：

```bash
gnome-extensions enable global-dictation-gnome@chatgpt-community.local
```

启用扩展后重启应用。全局快捷键使用桌面 portal，可能需要当前桌面会话的授权。

官方版和社区版共享 Codex 用户资料，不要同时运行。
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

首个预构建版本可以直接升级基于 RPM 的 cask。Homebrew 替换旧版程序目录并保留用户资料。

```bash
brew uninstall --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

普通卸载及 `--zap` 均保留共享的 ChatGPT/Codex 用户资料、插件和会话。

## 错误恢复

Homebrew 校验下载文件并负责升级回滚。
重新安装可能先移除旧安装。若安装失败，请保留日志并解决下载或安装问题。

## 维护

所有 Homebrew 文件都是下游新增文件。现有上游文件和 AppImage 工作流保持不变。
更新工作流在 `main` 变化时、每小时以及手动触发时运行。
工作流将固定源码提交绑定到已接受的软件包版本及当前签名 APT 发布信息。
两个架构分别比较 RPM 和签名 DEB 的程序内容、符号链接及可执行权限。
DEB 将 Electron 的 `LICENSE` 移至 `usr/share/doc/chatgpt/copyright`。
比较过程仍校验该文件与 RPM 中 `LICENSE` 的内容及可执行权限，不会忽略许可证差异。

CI 在两个架构上构建、解包并启动应用。发布归档后，工作流获取发布文件的校验值，并创建
`automation/homebrew-cask` PR。PR 使用 Homebrew 沙箱测试已发布的 cask。
只有一次性 CI 主机会为图形测试调整 AppArmor。

请配置具有 Contents 和 Pull requests 写权限的 `UPSTREAM_SYNC_TOKEN`。
请在发布 PR 的仓库规则中要求两个 Homebrew CI 架构检查。
该令牌必须能够触发 PR 工作流，不能只使用 `GITHUB_TOKEN`。

cask 版本格式为 `<OpenAI version>,<downstream revision>`。
归档包含 `prepared/app`。GitHub Release 包含归档、`SHA256SUMS` 和 `release.json`，
标签格式为 `homebrew-<OpenAI version>-<downstream revision>-<source commit>`。
Homebrew 根据本机安装路径生成桌面快捷方式。

本地验证命令及适配器接口见 [英文说明](README.md)。
请勿在个人 Homebrew 安装上运行 `lifecycle.sh`；它仅适用于一次性 GitHub Actions 主机。
