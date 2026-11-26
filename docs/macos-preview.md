# 爱丽丝桌宠 v2.1.0：Apple Silicon Mac 试用版

此包适用于搭载 Apple 芯片的 Mac。解压 ZIP 后打开 `Arisu Maid.app`，第一次启动会在 `~/Library/Application Support/Arisu Maid Trial` 建立独立的设置和角色库。菜单栏图标和角色右键菜单都能打开设置。此包使用临时签名供测试，未经 Apple 公证；系统提示无法验证时，只在确认下载来源后使用「系统设置 → 隐私与安全性 → 仍要打开」。

Windows 版和既有 Petex 设置不受影响。试用包暂不提供 Windows 的 Codex 伴随启动功能，也不提供「全屏时自动隐藏」。本机 Codex 日志读取逻辑沿用，需用实际 Mac 会话验收。

## 桌面验收

1. 启动后确认主角是女仆爱丽丝。点角色外侧透明区域，确认能点中后面的窗口；点角色本身应当触发动作。
2. 在头顶移动鼠标触发摸头，核对动作、台词气泡及结束后恢复待机。
3. 拖到四个方向，核对各自缩入、探出、气泡限位和往屏内拖离。边缘以避让菜单栏和 Dock 后的可用区为准。
4. 切换桌面空间、进入及退出其他应用的全屏，再试睡眠恢复。有外接屏时，重测跨屏拖动和边缘位置。

## 构建与自动验证

在 Apple Silicon Mac 上用原生 arm64 Node.js 24 运行：

```sh
npm ci
node tests/edge/run.cjs
npm run package:mac
```

ZIP 位于 `dist/`。GitHub Actions 会在 macOS runner 构建、解压并实际启动应用，检查角色首启、高清图集、四个方向和摸头动作及气泡，通过后上传 ZIP 和 SHA-256 校验文件。自动检查使用隔离的数据目录，不模拟系统鼠标和屏幕空间切换；这些以桌面验收为准。
