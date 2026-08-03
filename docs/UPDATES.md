# CodeSprite 发布与在线更新

## 当前产物

执行 `npm run tauri build` 后生成：

- `src-tauri/target/release/bundle/nsis/CodeSprite_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/nsis/CodeSprite_<version>_x64-setup.exe.sig`
- `src-tauri/target/release/bundle/msi/CodeSprite_<version>_x64_en-US.msi`
- `src-tauri/target/release/bundle/msi/CodeSprite_<version>_x64_en-US.msi.sig`

`.sig` 必须与安装包同时发布。客户端内置公钥，只会安装由匹配私钥签名的包。

## 密钥管理

- 私钥：`.secrets/codesprite.key`，已被 `.gitignore` 排除。
- 公钥：`.secrets/codesprite.key.pub`，内容已写入 `tauri.conf.json`。
- 私钥丢失后，已经安装的客户端将无法验证后续更新。正式发布前必须把私钥备份到受控密码库，不能上传服务器公开目录或 Git。
- 发布构建前设置 `TAURI_SIGNING_PRIVATE_KEY` 为私钥文件内容。当前私钥没有密码，Tauri CLI 出现 `Password:` 时直接回车。

## 更新服务接口

默认使用本仓库 GitHub Releases 中的静态更新清单：

```text
https://github.com/lengfengquanjun/codesprite/releases/latest/download/latest.json
```

也支持自行部署动态接口：

```text
https://updates.example.com/{{target}}/{{arch}}/{{current_version}}
```

服务端必须使用 HTTPS，并根据请求路径判断目标平台、架构和当前版本。没有更新时返回 `204 No Content`；存在更新时返回 `200 application/json`：

```json
{
  "version": "0.2.0",
  "notes": "新增端口进程工具并优化稳定性",
  "pub_date": "2026-07-20T13:00:00Z",
  "url": "https://downloads.example.com/CodeSprite_0.2.0_x64-setup.exe",
  "signature": "把对应 .sig 文件的完整单行内容放在这里"
}
```

版本必须高于客户端 `tauri.conf.json` 中的版本。`url` 指向安装包，`signature` 是同名 `.sig` 文件的完整文本内容，不是文件 URL。

## 发布步骤

1. 同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 运行 `npm run check` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
3. 设置签名私钥并运行 `npm run tauri build`。
4. 上传 NSIS 安装包及其 `.sig`；MSI 可作为手工下载安装备用。
5. 更新服务器返回的新版本 JSON，最后再启用该版本，避免客户端先读到清单却下载不到文件。
6. 使用旧版本客户端在设置页执行“检查更新”，完成下载、签名验证、安装和重启回归。

仓库包含 `.github/workflows/release.yml`。配置仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 后，推送 `v*` 标签会在 Windows Runner 上测试、构建、创建 Release，并自动上传 `latest.json`。当前本地私钥未设置密码时，密码 Secret 保持空字符串即可；正式发布建议换成有密码的密钥，并在已公开首个版本之前完成更换。

“启动时自动检查”只提示有新版本，不会静默安装。安装始终由用户确认。
