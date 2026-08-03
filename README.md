<div align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="CodeSprite Logo" />
  <h1>CodeSprite · 程序员桌面小工具箱</h1>
  <p>一颗安静悬浮在桌面的玻璃水球，需要时展开，不需要时隐入屏幕边缘。</p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-36e4d4?style=flat-square" />
    <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=flat-square&logo=windows" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square&logo=tauri" />
    <img alt="Local First" src="https://img.shields.io/badge/data-local--first-8b5cf6?style=flat-square" />
  </p>

  <p>
    <a href="https://github.com/lengfengquanjun/codesprite/releases/latest"><strong>下载最新版</strong></a>
    ·
    <a href="docs/DEVELOPMENT.md">开发文档</a>
    ·
    <a href="docs/UPDATES.md">更新发布</a>
  </p>
</div>

---

## 为什么做 CodeSprite？

开发过程中有许多很小、却会反复打断思路的事情：想变量名、寻找剪贴板历史、整理当天待办、启动一组开发软件，或者忘了怎样结束占用端口的后台服务。

CodeSprite 把这些操作放进一颗小巧的桌面水球中。水位可映射 CPU 或内存占用；点击水球后，功能入口以独立透明小球展开。每个工具都是独立原生窗口，不会用一张巨大的透明页面遮挡桌面。

## 功能

| 工具 | 能做什么 |
| --- | --- |
| `{ }` 变量命名 | 输入中文意图，选择变量/函数/表/字段、命名规则和语言；本地快速生成，亦可配置 MiMo AI |
| `▣` 剪贴板 | 持久化文本历史、搜索、收藏、去重并跳过明显的密钥和密码内容 |
| `✓` 待办备忘 | Markdown 文档驱动，支持优先级、截止时间、常驻小窗以及日报/周报/月报 |
| `⌘` 工作区 | 一键启动多个程序、网址和带参数命令，支持顺序与延迟 |
| `:_` 端口进程 | 输入端口查询 TCP/UDP 占用进程，确认后释放端口，并防止 PID 变化造成误杀 |
| `⚙` 设置 | 主题、水位指标、窗口置顶、功能球显隐、AI、日志、本地数据和在线更新 |

## 桌面体验

- 48px 玻璃水球，悬浮时显示内存、CPU 与未完成待办数量。
- 拖动时水面带有惯性与撞击感。
- 靠近屏幕边缘自动吸附，只保留一条发光细线。
- 关闭主界面后驻留系统托盘，右键可直接打开任意工具。
- 功能球显隐可配置，数量变化后自动沿轨道均匀排列。
- 主题由语义令牌驱动，为后续桌面宠物渲染器预留扩展点。

## 安装

前往 [Releases](https://github.com/lengfengquanjun/codesprite/releases/latest) 下载：

- `CodeSprite_*_x64-setup.exe`：推荐的 Windows 安装程序。
- `CodeSprite_*_x64_en-US.msi`：适合需要 MSI 的环境。

当前安装包尚未购买 Windows Authenticode 商业证书。首次运行时 Windows 可能显示 SmartScreen 提示；请只从本仓库 Releases 下载，并核对发布页提供的 SHA-256。

## 数据与隐私

- 默认本地优先，待办、剪贴板、工作区和命名历史保存在本机应用数据目录。
- AI 功能默认使用用户自行填写的 API Key；仓库和安装包不包含任何可用 Key。
- AI Key 保存在 Windows Credential Manager，不写入业务 JSON 或日志。
- 自动剪贴板捕获会跳过明显的 API Key、密码赋值和私钥文本。
- 在线更新包必须通过内置公钥验证签名后才会安装。

> 普通剪贴板历史目前仍是本地明文，请不要把 CodeSprite 当作密码管理器。

## 本地开发

环境要求：Node.js、Rust stable、Windows WebView2。

```powershell
npm install
npm run tauri dev
```

提交前验证：

```powershell
npm run check
cargo test --manifest-path src-tauri\Cargo.toml
```

生产构建：

```powershell
npm run tauri build
```

项目结构与扩展约定参见 [开发文档](docs/DEVELOPMENT.md)。在线更新服务和签名流程参见 [更新发布文档](docs/UPDATES.md)。

## 技术栈

- Tauri 2 + Rust：透明窗口、系统托盘、窗口管理、凭据库、端口进程与更新安装。
- TypeScript + Vite：界面、功能控制器和本地数据仓库。
- Vitest + Rust tests：命名、Markdown、AI 路由、窗口边缘、端口与更新地址测试。

## 路线图

- [ ] 全局快捷键与开机自启
- [ ] 窗口位置和吸边状态持久化
- [ ] 加密剪贴板收藏与图片剪贴板
- [ ] 待办提醒、重复任务与冲突合并
- [ ] Team 命名词典与项目上下文
- [ ] 可替换的 AI 桌面宠物主题

## License

本项目使用 [Apache License 2.0](LICENSE)。
