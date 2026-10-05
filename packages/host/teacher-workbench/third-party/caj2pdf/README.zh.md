# 独立 CAJ 预览引擎

[English](README.md) | 中文

Windows x64 桌面打包从 [caj2pdf-qt v0.1.6](https://github.com/sainnhe/caj2pdf-qt/releases/tag/v0.1.6) 准备命令行工具。可执行文件作为独立子进程运行，不分发 Qt 界面。[准备脚本](../../../../../apps/desktop/scripts/stage-paper-preview.mjs) 记录固定压缩包的 SHA-256。生成的二进制文件排除在 Git 之外，并包含在软件包发布内容中。

转换器是 [caj2pdf](https://github.com/caj2pdf/caj2pdf/tree/acce7c9ffd919e67b447e7baa8df2ae17b450dd4)，使用 [GLWTPL](COPYING.GLWTPL) 许可，带有 [GPL-3.0 caj2pdf-qt 补丁](https://github.com/sainnhe/caj2pdf-qt/tree/v0.1.6/patches)。该发行版的 Windows 工作流选用 [MuPDF 1.8](https://github.com/ArtifexSoftware/mupdf/tree/1.8)，使用 [AGPL-3.0](COPYING.AGPL-3) 许可。Hin-Tak Leung 编写的[解码器包装代码](https://github.com/caj2pdf/caj2pdf/tree/acce7c9ffd919e67b447e7baa8df2ae17b450dd4/lib) 使用 [FreeType Project License](COPYING.FTL)；JBIG2 编解码器还使用 [jbig2dec](https://github.com/ArtifexSoftware/jbig2dec)。完整的 [GPL-3.0](COPYING.GPL-3) 条款及[源码和替换说明](NOTICE.txt) 与工具一同提供。这些许可适用于独立工具，不被 Harness 的 MIT 许可替代。

转换器不支持的 CAJ 变体仍保留并可下载。其他 Host 平台使用 `paperCajCommand` 设置，默认从 PATH 调用 `caj2pdf`。
