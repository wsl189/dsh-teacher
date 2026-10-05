# Standalone CAJ preview engine

English | [中文](README.zh.md)

Windows x64 desktop packaging stages the command-line payload from [caj2pdf-qt v0.1.6](https://github.com/sainnhe/caj2pdf-qt/releases/tag/v0.1.6). The executable runs as a separate child process; the Qt interface is not distributed. The pinned archive SHA-256 is recorded by the [staging script](../../../../../apps/desktop/scripts/stage-paper-preview.mjs). Generated binaries are excluded from Git and included in the package publication view.

The converter is [caj2pdf](https://github.com/caj2pdf/caj2pdf/tree/acce7c9ffd919e67b447e7baa8df2ae17b450dd4), licensed under [GLWTPL](COPYING.GLWTPL), with the [GPL-3.0 caj2pdf-qt patches](https://github.com/sainnhe/caj2pdf-qt/tree/v0.1.6/patches). The release's Windows workflow selects [MuPDF 1.8](https://github.com/ArtifexSoftware/mupdf/tree/1.8), under [AGPL-3.0](COPYING.AGPL-3). The [decoder wrappers](https://github.com/caj2pdf/caj2pdf/tree/acce7c9ffd919e67b447e7baa8df2ae17b450dd4/lib) by Hin-Tak Leung use the [FreeType Project License](COPYING.FTL); the JBIG2 codec also uses [jbig2dec](https://github.com/ArtifexSoftware/jbig2dec). The complete [GPL-3.0](COPYING.GPL-3) terms and [source/replacement notice](NOTICE.txt) accompany the tools. These licenses apply to the separate tools and are not replaced by the Harness MIT license.

CAJ variants unsupported by this converter remain stored and downloadable. Other Host platforms use the configured `paperCajCommand`, whose default invokes `caj2pdf` from PATH.
