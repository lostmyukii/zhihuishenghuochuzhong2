# N16R8 无摄像头家庭情境侦探屋独立公网与网页语音设计

> 日期：2026-07-16  
> 状态：方案A已经用户确认，本文是实施前的书面设计规格。  
> 项目：`smartlife-junior-context`  
> 项目画像：`smartlife-junior-context-detective-v1`

## 1. 决策摘要

本项目参照服务器现有“初中”项目已经运行的网页语音方式，但建立完全独立的运行资源，不能复用或覆盖现有项目的目录、服务名、端口、域名配置、MQTT Topic、缓存名或项目画像。

最终链路为：

```text
浏览器首页或网页语音工作台
  -> 用户主动授权麦克风
  -> MediaRecorder录制短音频
  -> HTTPS POST /api/voice/transcribe
  -> 服务器ffmpeg转换为16kHz/16bit/单声道PCM
  -> 讯飞语音听写（流式版）得到文字
  -> HTTPS POST /api/voice/intent + 当前新鲜情境摘要
  -> 讯飞星火Ultra理解自然语义
  -> 服务端清洗为本项目白名单意图
  -> dashboard/voice-core.js再次校验
  -> 带ID的标准command
  -> Web Serial或WSS远程网关
  -> N16R8执行并返回同ID ack + telemetry
```

无法识别、低置信度、参数越界、身份不匹配或数据过期时不发送控制命令。主板本地采集、情境判断和安全中断不依赖语音服务器。

## 2. 已核实的参考实现

2026-07-16对服务器进行了只读检查，没有修改或重启任何服务。现有“初中”项目实际使用：

- `/home/ubuntu/smartlife-junior`作为运行目录。
- `19166/19167/19168/19183`分别用于Relay、网页、语音和MQTT。
- 浏览器用`MediaRecorder`录制约4.2秒音频。
- 语音服务用`ffmpeg`把浏览器录音转换为讯飞要求的PCM。
- `/api/voice/transcribe`负责STT，`/api/voice/intent`负责自然语义。
- 参考项目当前STT是讯飞流式听写，意图解析是DeepSeek加本地规则回退。
- 服务器关键语音文件与本机`../初中`对应文件SHA-256一致，可将本机源码作为可审计参考。

本项目只复用架构和经过验证的音频处理方法，不复制参考项目的模式名、意图、硬编码令牌、生产端口或公网暴露方式。

## 3. 目标与非目标

### 3.1 目标

1. 首页直接提供麦克风入口、识别文字、意图结果、命令ID和ACK状态。
2. 保留独立“网页语音”工作台，用于麦克风自检、文本降级、快捷表达和详细诊断。
3. 支持自然中文表达，不要求用户逐字命中固定口令。
4. 服务端和Dashboard执行两次白名单清洗。
5. 建立独立公网HTTPS、WSS和MQTT链路，第二浏览器可看到真实板状态并发送白名单命令。
6. 所有新服务与现有服务器项目隔离，并提供明确回滚方式。
7. 没有新鲜`hello/telemetry`时，查询类语音诚实回答数据不可用。

### 3.2 非目标

- 不修改N16R8本地语义能力；`localVoiceNlu=false`和`mcp=false`保持不变。
- 不让大模型直接生成GPIO、PWM、舵机角度、继电器或任意JSON命令。
- 不使用摄像头，不保存声音传感器GPIO4的原始音频。
- 不默认长期保存浏览器麦克风录音。
- 不在本批次烧录开发板或进行执行器动作验收。
- 不复用参考项目的DeepSeek凭据、MQTT凭据或浏览器可见令牌。
- 不改动或重启`smartlife-junior-*`、`smartlife-primary-*`、`smartlife-primary-hk2-*`。

## 4. 独立服务器资源

### 4.1 固定资源

| 资源 | 本项目固定值 |
| --- | --- |
| 运行目录 | `/home/ubuntu/smartlife-context-detective` |
| 网页服务 | `smartlife-context-web.service` |
| Relay服务 | `smartlife-context-relay.service` |
| 语音服务 | `smartlife-context-voice.service` |
| MQTT服务 | `smartlife-context-mqtt.service` |
| Relay端口 | `127.0.0.1:19466` |
| 网页端口 | `127.0.0.1:19467` |
| 语音端口 | `127.0.0.1:19468` |
| MQTT端口 | `127.0.0.1:19483` |
| WSS路径 | `/smartlife-context-ws` |
| 语音路径 | `/api/voice/` |
| MQTT前缀 | `smartlife/context-detective/n16r8` |
| 环境文件 | `/home/ubuntu/smartlife-context-detective/deploy/.env`，权限`600` |

新服务只监听回环地址。公网浏览器只通过独立Nginx HTTPS站点访问，不直接访问`194xx`端口。

### 4.2 独立域名输入门

公网域名是部署输入，不进入应用协议。部署前必须满足：

1. 用户给出本项目独立域名。
2. 该域名A记录已经解析到当前服务器。
3. HTTP ACME验证可访问。

三个条件未满足时，只实施本地软件、服务器回环服务和配置模板，不安装引用不存在证书的HTTPS配置，也不把裸IP HTTP描述为可用麦克风页面。

## 5. 组件边界

### 5.1 `tools/voice_transcribe_server.py`

只负责三件事：

1. 接收短音频并调用STT。
2. 接收文字和情境摘要并调用语义模型。
3. 输出经过白名单清洗的结构化结果。

它不直接连接串口、不直接写GPIO、不修改Dashboard状态，也不把查询回答伪装成设备ACK。

### 5.2 `dashboard/voice-core.js`

负责浏览器侧第二次校验：

- 检查`project/profileId`。
- 检查允许的意图和模式。
- 限制阈值名称、步长和范围。
- 把可执行意图转换为带唯一ID的标准`command`。
- 查询/解释类意图只读取新鲜遥测，不生成硬件命令。

### 5.3 `dashboard/app.js`

负责麦克风授权、录音状态、调用两个语音接口、显示文字与意图、发出标准命令、等待ACK及记录失败原因。它不包含供应商密钥。

### 5.4 `tools/n16r8_cloud_relay.py`

负责WSS、MQTT与USB浏览器之间的项目级路由：

- 只接受`smartlife-junior-context`和正确`profileId`。
- USB浏览器给帧增加随机`originClientId`。
- 返回自身的帧由原浏览器去重。
- 远程命令必须经过项目白名单并等待真板ACK。
- MQTT保留最新板端状态，但浏览器仍按3500ms新鲜度判断在线。

## 6. 语音接口合同

### 6.1 `GET /api/voice/health`

只返回非敏感状态：

```json
{
  "ok": true,
  "service": "smartlife-context-voice",
  "transcribeProvider": "xunfei",
  "transcribeConfigured": true,
  "intentProvider": "xunfei-spark-ws",
  "intentConfigured": true,
  "ffmpeg": true
}
```

不得返回APPID、APIKey、APISecret、签名URL、服务器令牌或上游错误原文中的凭据。

### 6.2 `POST /api/voice/transcribe`

请求为`multipart/form-data`：

- `audio`：浏览器主动录制的短音频。
- `language=zh`。
- `prompt`：仅作为比赛词汇提示，不包含传感器隐私数据。

限制：

- 默认录音4.2秒。
- 最大请求8MB。
- 允许`webm/opus`、`ogg/opus`、浏览器支持的`mp4`。
- 临时文件在请求结束时删除。
- 默认不保存音频和识别文本到文件。

响应：

```json
{"ok":true,"text":"进入湿热通风","provider":"xunfei","model":"iat-v2"}
```

### 6.3 `POST /api/voice/intent`

请求：

```json
{
  "text": "屋里有点闷，帮我通通风",
  "project": "smartlife-junior-context",
  "profileId": "smartlife-junior-context-detective-v1",
  "context": {
    "fresh": true,
    "mode": "detect",
    "candidate": "ventilation",
    "coverage": 100,
    "match": 82,
    "alerts": []
  }
}
```

服务端只能输出：

```text
queryContext
explainContext
setMode
confirmContext
correctContext
setThreshold
querySafety
muteBuzzer
unknown
```

`setMode.mode`只能是：

```text
detect, study, rest, ventilation, energy, custom
```

`setThreshold`首批只允许：

```text
lightThreshold, soundThreshold, temperatureThreshold,
humidityThreshold, mq2Threshold
```

阈值只能在固件合同范围内按固定步长改变。语句含糊、对象不明、超出范围或置信度不足时返回`unknown`，不能像参考项目旧配置那样强制贴近到某个动作。

当前`0.4.0`与本批次目标的能力边界必须显式区分：

| 意图 | 当前`0.4.0` | 本批次处理 |
| --- | --- | --- |
| `queryContext`、`explainContext`、`querySafety` | 不需要板端命令 | 只读取3500ms内的新鲜遥测并生成页面答复 |
| `setMode` | 已支持 | 转换为现有带ID模式命令 |
| `muteBuzzer` | 已支持 | 转换为`set.buzzerEnabled=false` |
| `confirmContext`、`correctContext`、`setThreshold` | 尚未支持 | 先扩展mock、协议测试和PIO固件并完成纯编译；未获再次烧录授权前，公网页面对真板显示“固件待升级”，不得把失败ACK写成已执行 |

`confirmContext`必须携带当前候选情境；`correctContext`必须携带六种模式之一作为纠正结果；`setThreshold`每次只能携带一个白名单阈值字段。三类命令都必须返回同ID ACK。

### 6.4 星火Ultra调用

意图解析使用讯飞官方WebSocket接口：

```text
wss://spark-api.xf-yun.com/v4.0/chat
domain=4.0Ultra
```

服务器使用APPID、APIKey和APISecret生成临时签名URL。签名URL只存在于内存，不进入日志。模型提示词要求只输出一个JSON对象；即使模型返回了其他内容，服务端仍执行独立结构校验和白名单清洗。

官方参考：

- https://www.xfyun.cn/doc/spark/Web.html
- https://www.xfyun.cn/doc/asr/voicedictation/API.html

## 7. 首页语音卡

首页右侧“控制来源与联动结果”区域增加紧凑语音卡，不改变现有五节点证据链：

```text
网页语音
  [开始说话 / 停止]
  麦克风状态与4秒倒计时
  实时阶段：录音中 -> 上传中 -> 识别文字 -> 解析意图 -> 等待ACK
  最近识别文字
  白名单意图与置信度
  命令ID / ACK / 后续遥测观察
  文本降级输入
  快捷表达：判断情境、解释依据、湿热通风、安全查询、蜂鸣静音
```

首页卡只展示最近一次完整闭环。详细麦克风选择、自检、错误诊断、历史语音记录仍放在`#voice`工作台。

页面必须显示：

- “麦克风音频只在点击识别时发送到服务器，默认不保存”。
- “GPIO4声音模块只测强度，与网页麦克风录音是两条独立数据路径”。
- “识别成功不等于设备执行成功，需等待同ID ACK和真实状态”。

## 8. 状态与错误处理

语音状态使用明确状态机：

```text
idle
permission-requested
recording
uploading
transcribed
intent-resolved
command-pending
acked
observed
failed
```

错误必须区分：

| 错误 | 页面处理 |
| --- | --- |
| 浏览器不支持MediaRecorder | 保留文本输入和快捷表达 |
| 麦克风权限拒绝 | 显示重新授权说明，不自动重试 |
| 录音为空 | 不调用意图接口 |
| STT未配置/超时 | 显示语音服务不可用，保留文本意图 |
| STT无文字 | 不发送命令 |
| 星火不可用 | 回退本项目本地规则；无法安全归并则`unknown` |
| 遥测不新鲜 | 查询类回答“当前数据不可用” |
| 意图越界 | 服务端拒绝，Dashboard再次拒绝 |
| 命令ACK超时 | 显示“未确认”，不能显示已执行 |
| ACK成功但执行器未验收 | 仍显示对应实物证据状态，不自动标记验收 |

## 9. 安全与隐私

1. 之前在聊天和截图中出现的服务器密码及讯飞凭据视为已暴露，部署不能使用。
2. 新凭据不通过聊天、Git、浏览器JavaScript、命令行参数或日志传递。
3. 用户在服务器交互式写入`deploy/.env`，文件权限固定为`600`。
4. 新服务只读取自己的环境文件，不能读取其他SmartLife项目的`.env`。
5. Nginx只代理新域名到`127.0.0.1:194xx`。
6. 语音POST接口检查同源`Origin`、请求大小和速率；CORS不使用`*`。
7. 日志只记录请求ID、阶段、耗时、供应商、结果代码和文字长度，不记录音频、完整识别文本或签名URL。
8. systemd使用`NoNewPrivileges=true`、`PrivateTmp=true`和受限写目录。
9. MQTT账号仅存在服务器运行环境，浏览器只连接WSS Relay。
10. 不把参考项目浏览器代码中的公开令牌复制到本项目。

## 10. Nginx、证书与部署顺序

部署按以下顺序执行：

1. 记录所有现有SmartLife服务、监听端口和Nginx配置摘要。
2. 在新目录建立虚拟环境和运行文件，不写现有项目目录。
3. 创建四个新的systemd单元，但先不启动。
4. 创建只含HTTP/ACME的新域名站点，运行`nginx -t`后只执行reload。
5. 取得独立证书。
6. 写入最终HTTPS/WSS/语音代理配置，再次`nginx -t`和reload。
7. 启动并验证四个新服务。
8. 比较部署前后的现有项目服务PID/状态和公网健康状态。

禁止：

- `docker system prune`、删除容器或改Docker网络。
- 停止、重启或覆盖现有SmartLife服务。
- 复用`191xx/192xx/193xx`端口。
- 在证书不存在时安装引用证书文件的TLS配置。
- 直接把`194xx`端口暴露到公网。

## 11. 回滚

回滚只作用于本项目：

1. 停止并禁用`smartlife-context-*`四个新服务。
2. 移除本项目Nginx站点软链接，保留带时间戳备份。
3. `nginx -t`通过后reload。
4. 保留运行目录和日志供诊断，不删除其他项目文件。
5. 再次确认全部原有SmartLife服务和站点仍正常。

如果任何一步发现现有项目状态变化，立即停止扩大部署范围并执行上述回滚。

## 12. 测试与验收

### 12.1 Python合同

- 音频大小、格式、临时文件清理和ffmpeg错误。
- 讯飞STT鉴权URL生成，但测试不使用真实密钥。
- 星火Ultra请求结构、JSON提取和上游错误。
- 九种意图、六种模式、阈值白名单和范围。
- 模型返回任意GPIO、继电器、PWM或混合动作时拒绝。
- 规则降级和`unknown`不发送命令。
- 健康接口不泄露密钥。

### 12.2 Dashboard合同

- 首页语音卡和`#voice`工作台共用同一状态与接口。
- 服务端结果经过`voice-core.js`第二次校验。
- 每个控制命令拥有唯一ID并进入现有命令账本。
- 查询类意图不生成硬件命令。
- 3500ms旧遥测不能回答实时安全或情境。
- 麦克风失败时文本降级仍可测试。
- 390px宽度无横向溢出，减少动态效果时信息仍完整。

### 12.3 Relay与MQTT合同

- 项目和画像隔离。
- WSS自身回环帧去重。
- MQTT Topic只使用`smartlife/context-detective/n16r8`前缀。
- 远程命令只由当前USB浏览器写入串口。
- ACK和后续telemetry分别记录。
- retained测试数据在测试结束后清除。

### 12.4 公网验收

- 独立HTTPS证书有效。
- 首页可以请求麦克风权限。
- `/api/voice/health`只返回非敏感健康信息。
- 文本意图完成`intent -> command -> ack` Mock闭环。
- 麦克风完成`audio -> text -> intent`闭环。
- WSS返回101，第二浏览器可见状态。
- 真板在线只由新鲜正确项目`hello/telemetry`证明。
- 部署前后全部原有SmartLife服务保持active，原有站点HTTP状态不变。

### 12.5 固件边界

本批次运行现有固件契约测试和PIO纯编译，证明网页/服务修改没有破坏协议。没有新的烧录授权，不执行upload、write_flash、erase_flash或串口执行器命令。

## 13. 实施批次

### 批次B1：本地语音闭环

- 先写`tools/test_voice_transcribe_server.py`和Dashboard失败测试。
- 建立本项目独立语音服务。
- 扩展`voice-core.js`为本项目九种意图。
- 首页加入紧凑语音卡，`#voice`加入完整诊断。
- 使用Mock供应商完成本地音频/文本/ACK闭环。

### 批次B2：云端同步闭环

- 建立项目级Cloud Relay、MQTT适配和测试。
- Dashboard增加WSS连接、来源ID和回环去重。
- 使用显式Mock验证第二浏览器状态与远程命令。

### 批次B3：独立服务器部署

- 用户先完成凭据轮换，并在服务器本地交互式写入新环境文件。
- 用户提供已经解析到服务器的独立域名。
- 部署新服务、独立Nginx站点与证书。
- 运行公网麦克风、WSS、MQTT和隔离验收。

## 14. 完成定义

只有以下条件全部满足，才可以称为“独立公网语音系统已完成”：

- 本地Python、Node和PIO纯编译全部通过。
- 首页与语音工作台均能显示真实语音阶段和文本降级。
- 星火输出只能落入本项目白名单，双重清洗测试通过。
- 控制动作得到同ID ACK；查询动作使用新鲜遥测。
- WSS/MQTT使用独立端口、服务名、Topic和域名。
- 新凭据仅存在服务器权限`600`的环境文件。
- 公网HTTPS、麦克风、语音、WSS和第二浏览器验收通过。
- 现有服务器项目未被修改、停止或覆盖。
- 没有把网页命令成功误写成风扇、舵机、继电器或RGB实物验收成功。
