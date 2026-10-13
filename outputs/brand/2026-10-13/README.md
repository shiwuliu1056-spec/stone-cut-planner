# 宝松启动图标 · 墨绿暖金字标

- `baosong-avatar-1024.png`：正式头像候选，不透明 RGB PNG，1024×1024。
- `baosong-avatar.svg`：两字独立矢量路径，文字已转轮廓，不依赖安装字体。
- `baosong-avatar-preview.png`：白底圆形裁切及 48/80/144 像素可读性预览。
- 另附 48/80/144 像素方形 PNG，方便检查或复用。

底色 `#173E38`，字色 `#D8B37A`，使用 sRGB 导出。字体来自本机 CoreText 实际解析的 `PingFangSC-Semibold`；轮廓宽度占 58%，按实际轮廓边界居中。SVG 中两个字可以单独选中编辑。

已验证：字形不缺失，圆形裁切不碰笔画，48/80/144 像素可辨认，无透明通道，色值正确。

这些是独立设计文件，没有放入小程序代码包，没有增加开屏动画或等待，也没有修改微信后台头像。

本机重建：`swift build.swift "$PWD"`（macOS，需要已安装 PingFang SC Semibold）。
