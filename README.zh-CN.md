<p align="center">
  <img src="./icons/relay-256.png" width="72" height="72" alt="Relay 标志" />
</p>

<h1 align="center">Relay</h1>
<p align="center">从一个想法开始。</p>
<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="./PRIVACY.md">隐私说明</a> ·
  <a href="./CHANGELOG.md">更新记录</a>
</p>

Relay 把 Google 搜索和 ChatGPT、Claude、Gemini、Grok、DeepSeek、豆包的对话入口集中到 Chrome 新标签页。英文界面跟随系统主题，直接加载仓库即可使用。

## 安装

1. 打开 `chrome://extensions`，启用**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的项目根目录。
3. 可将 Relay 固定到工具栏，方便打开启动器。

更新文件后，点击扩展的**重新加载**按钮，刷新已打开的服务页面，再打开一个新标签页。如果其他扩展接管了新标签页，请停用该扩展。

## 使用

打开新标签页，或点击工具栏的 Relay 图标。选择服务，准备好文字或附件后按 **Enter**。单服务模式在当前标签页打开搜索或新对话。草稿为空时，直接打开所选服务。

开启 **Multiple services** 后，可从七个服务中任选，初始全选。启动器保持打开；Google 在后台新建标签页，AI 服务优先复用当前窗口的匹配标签页，再查找其他窗口或新建。每个新启动器默认使用单服务模式，并记住上次的单选服务。

### 附件

点击 **Attach**、把文件拖到输入区，或从剪贴板粘贴图片。Relay 最多接收 **5 个文件**，单个不超过 **10 MiB**，合计不超过 **20 MiB**；可用格式由各服务决定。六个聊天服务在网站允许时也可以只发附件。

有附件时，Google 走 [Google AI Mode（AI 模式）](https://support.google.com/websearch/answer/16011537?co=GENIE.Platform%3DDesktop&hl=zh-Hans)，需要同时输入问题；没有附件时仍使用普通网页搜索。发送前请先登录所选服务。

## 快捷键

| 位置 | 快捷键 | 操作 |
| --- | --- | --- |
| 新标签页 | `Enter` / `Shift+Enter` | 提交 / 换行；输入法选词不会提交。 |
| 新标签页 | `Option+1–7` / `Alt+1–7` | 单服务时切换，多服务时切换选中状态。顺序为 Google、ChatGPT、Claude、Gemini、Grok、DeepSeek、Doubao。 |
| 新标签页，输入框外 | `/` | 聚焦输入框。 |
| 支持的 AI 网站 | `Command+Shift+O` / `Ctrl+Shift+O` | 新建对话，可在 `chrome://extensions/shortcuts` 修改。 |
| 支持的 AI 网站 | `Command+K` / `Ctrl+K` | 使用网站的对话搜索命令；扩展为 Gemini 映射此快捷键。 |

页面快捷键需要页面焦点。Chrome 新建标签页时，可能仍优先聚焦地址栏。

## 发送结果与恢复

各服务独立处理。**Opened Google search** 表示已打开搜索标签页；**Sent to …** 表示网站出现了提交证据。未确认发送时，重试前请先检查目标页面。多数聊天适配在未确认时会重试一次；豆包和 Google AI Mode 最多点击一次发送。

失败或中断时会保留临时草稿。单服务发送失败且标签页仍停在 Relay 打开的页面时，会返回启动器。恢复后的文件标记为 **(add again)**，重新选择或移除后才能重试。多服务启动器保持打开时，已选文件仍可用。**Copy prompt** 只复制文字。

如果网站没有出现可用的发送或上传控件，请确认已登录、账号可使用该功能，再尝试在网站上操作。Google AI Mode 也可以使用页面自带的附件入口。

## 隐私

草稿通过临时会话记录恢复，附件内容只留在内存中。存储字段、清理规则和网站访问范围见[隐私说明](./PRIVACY.md)。

## 开发

架构、网站适配、测试与发布检查见[开发指南](./docs/DEVELOPMENT.md)。

[MIT](./LICENSE) · [GitHub](https://github.com/algorirhy/one-ai-shortcut)
