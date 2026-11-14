# Privacy / 隐私说明

## English

Relay has no developer-operated backend, analytics, advertising, or tracking. It does not intercept AI replies or keep permanent prompt history. Selected providers receive search terms, messages, and attachments according to the actions you choose and process them under their own terms and privacy policies.

### Local data

| Data | Handling |
| --- | --- |
| New-tab recovery task | Exact text, selected destinations, source tab and window, timestamp, result, and file metadata (name, MIME type, size, modified time) stored in `chrome.storage.session`. No cloud sync or local/sync storage of prompts. |
| Attachment contents | Kept only in memory while composing and sending. After restoring a draft, reselect missing files. |
| Last single-service choice | Service ID saved in extension-origin `localStorage`. |
| Google search | Terms appear in the destination URL and may enter browser history. |
| Clipboard | Changed only by an explicit **Copy prompt** fallback; system clipboard history/sync settings then apply. |

Once all selected operations succeed, recovery text and file metadata are removed. Failed or unconfirmed tasks retain the draft. Closing the source tab clears its record; records older than one hour are removed when accessed. Disabling, reloading, or updating the extension, or restarting Chrome, clears session memory. Recovery data is not exposed to content scripts under the default session access policy.

### Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Identify the source tab and find, reuse, navigate, or create destination tabs. |
| `notifications` | Report failed or unconfirmed delivery. |
| `storage` | Keep temporary new-tab recovery tasks in session memory. |

Content scripts run on the six supported chat services and the Google AI Mode routes used for requests with files. Ordinary Google searches use a search URL and do not trigger attachment automation.

## 简体中文

Relay 没有开发者后端、使用分析、广告或跟踪，不截取 AI 回复，不保存永久提问历史。所选服务根据你的操作接收搜索词、消息和附件，并按各自条款与隐私政策处理。

### 本地数据

| 数据 | 处理方式 |
| --- | --- |
| 新标签页恢复任务 | 完整文字、所选服务、来源标签页和窗口、时间、结果和文件元数据（文件名、MIME 类型、大小及修改时间）暂存在 `chrome.storage.session`，问题不写入 local/sync 存储或云端同步。 |
| 文件内容 | 编辑和发送时只保留在内存中。恢复草稿后需要重新选择缺失的文件。 |
| 上次单选服务 | 服务 ID 保存在扩展来源的 `localStorage`。 |
| Google 搜索 | 搜索词包含在目标 URL 中，可能进入浏览器历史。 |
| 剪贴板 | 仅主动点击 **Copy prompt** 时覆盖；之后受系统剪贴板历史 / 同步设置影响。 |

所有所选操作均成功后，会移除恢复任务中的文字和文件元数据。失败或未确认发送时会保留草稿。关闭来源标签页会清理记录，超过一小时的记录在再次访问时清理。停用、重载、更新扩展或重启 Chrome 会清空会话内存。会话恢复数据默认不向内容脚本开放。

### 权限

| 权限 | 用途 |
| --- | --- |
| `tabs` | 识别来源标签页，查找、复用、导航或创建目标标签页。 |
| `notifications` | 提示发送失败或未确认发送。 |
| `storage` | 在会话内存中暂存新标签页恢复任务。 |

内容脚本在六个受支持的聊天服务及带附件请求使用的 Google AI Mode 页面运行。普通 Google 搜索通过搜索 URL 打开，不会触发附件自动化。
