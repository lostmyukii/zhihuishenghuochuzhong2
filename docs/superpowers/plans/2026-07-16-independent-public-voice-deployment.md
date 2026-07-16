# 独立公网与网页语音实施计划

> 状态：设计规格已经用户确认。本计划允许本地软件、Mock、协议测试、PIO纯编译和独立部署文件开发；不授权烧录、串口写入或真板执行器动作。  
> 设计依据：[`../specs/2026-07-16-independent-public-voice-deployment-design.md`](../specs/2026-07-16-independent-public-voice-deployment-design.md)  
> 项目：`smartlife-junior-context`  
> 画像：`smartlife-junior-context-detective-v1`

## 1. 实施目标

在现有证据链Dashboard和`0.4.0`协议基础上完成：

1. 首页紧凑语音卡与`#voice`完整语音工作台共用同一状态机。
2. 浏览器短录音、讯飞STT、星火Ultra意图解析、规则降级和双重白名单。
3. 九种本项目意图、六种模式和同ID命令账本闭环。
4. 独立WSS/MQTT云端同步和第二浏览器远程状态/命令闭环。
5. `/home/ubuntu/smartlife-context-detective`、`194xx`端口和`smartlife-context-*`服务模板。
6. 本地测试、Mock浏览器验证、PIO纯编译、Git提交和推送。
7. 凭据及域名满足部署门后，再实施独立服务器部署和隔离验收。

## 2. 权限边界

### 2.1 本计划允许

- 修改`dashboard/`、`tools/`、`firmware/`协议实现、`deploy/`和三份工程文档。
- 运行Python、Node、JavaScript语法和PIO纯编译测试。
- 启动显式`mock=true`的本地网关、语音Mock服务和静态网页。
- 通过SSH密钥只读检查服务器；在部署门满足后新增独立目录、服务和Nginx站点。
- 只reload经过`nginx -t`验证的Nginx配置。

### 2.2 本计划不授权

- `pio run -t upload`。
- `esptool write_flash`、`erase_flash`、串口命令或执行器动作。
- 枚举、打开或占用当前CH340。
- 使用或保存聊天中已经暴露的服务器密码和讯飞凭据。
- 修改、停止、重启或覆盖任何现有SmartLife服务。
- 删除Docker容器、Docker网络或服务器其他项目文件。

## 3. 计划文件与模块

### 3.1 新增

```text
tools/voice_transcribe_server.py
tools/test_voice_transcribe_server.py
tools/n16r8_cloud_relay.py
tools/test_cloud_relay.py
dashboard/cloud-core.js
dashboard/voice-session-core.js
dashboard/tests/cloud-core.test.js
dashboard/tests/voice-session-core.test.js
deploy/.env.example
deploy/mosquitto-context.conf
deploy/smartlife-context-web.service
deploy/smartlife-context-relay.service
deploy/smartlife-context-voice.service
deploy/smartlife-context-mqtt.service
deploy/nginx-context-http.conf.template
deploy/nginx-context-https.conf.template
deploy/README.md
```

### 3.2 修改

```text
dashboard/index.html
dashboard/style.css
dashboard/app.js
dashboard/voice-core.js
dashboard/tests/voice-core.test.js
dashboard/tests/dashboard-contract.test.js
tools/n16r8_gateway.py
tools/test_gateway.py
tools/requirements.txt
firmware/src/main.cpp
tools/test_firmware_contract.py
设计方案.md
开发文档.md
AGENTS.md
.gitignore
```

不新增Service Worker；当前仓库没有该能力，避免产生未验证缓存行为。

## 4. 测试与提交纪律

每个批次执行：

1. 写失败测试。
2. 运行目标测试并确认因缺失能力失败。
3. 实现最小代码。
4. 重跑目标测试。
5. 重跑相关全量回归。
6. `git diff --check`和`git status --short --branch`。
7. 只提交本批文件并推送`origin/main`。

用户已有未跟踪`评分表.png`始终不暂存、不修改。

## 5. 批次B0：记录当前基线

**不修改运行代码。**

运行：

```bash
git status --short --branch
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
for file in dashboard/*.js; do node --check "$file"; done
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

记录：

- Python和Node测试数量。
- PIO RAM/Flash使用量。
- 当前只存在用户未跟踪图片和已提交计划差异。
- 不启动串口或真板网关。

## 6. 批次B1：服务器语音核心

### 任务B1.1：先建立语音服务失败测试

**新增：**

- `tools/test_voice_transcribe_server.py`

先覆盖：

1. `env_provider()`只在完整讯飞配置存在时返回`xunfei`。
2. `intent_provider()`支持`xunfei-spark-ws`和`rules`。
3. 健康结果不含APPID、APIKey、APISecret或签名URL。
4. `infer_rule_voice_intent()`覆盖九种意图和六种模式。
5. 非法GPIO、PWM、舵机角度、继电器或混合动作被清洗为`unknown`。
6. `setThreshold`只允许五个字段、一个字段和合法数值范围。
7. 低置信度控制意图降为`unknown`。
8. 星火文本只提取第一个合法JSON对象。
9. 上游返回Markdown、额外文字或未知字段时仍严格清洗。
10. Mock STT和Mock意图不访问网络。
11. multipart音频大小限制和空请求错误。
12. 临时PCM转换失败返回明确错误。

目标红灯：

```bash
python3 -m unittest tools/test_voice_transcribe_server.py -v
```

失败原因必须是`tools/voice_transcribe_server.py`缺失或目标函数缺失。

### 任务B1.2：实现本项目语音服务

**新增：**

- `tools/voice_transcribe_server.py`

从`../初中/tools/voice_transcribe_server.py`复用已验证的：

- HTTP处理器。
- multipart解析。
- ffmpeg临时文件转换。
- 讯飞IAT v2 WebSocket发送与动态修正结果合并。
- 请求大小和超时处理。

必须改写：

- 项目和画像。
- 九种意图及六种模式。
- 星火Ultra WebSocket意图解析，URL固定`wss://spark-api.xf-yun.com/v4.0/chat`、domain固定`4.0Ultra`。
- 无强制贴近动作；不确定返回`unknown`。
- 健康接口名称和非敏感字段。
- 精确CORS Origin、速率限制和不记录完整文本。

服务参数：

```text
VOICE_TRANSCRIBE_HOST=127.0.0.1
VOICE_TRANSCRIBE_PORT=19468
VOICE_TRANSCRIBE_PROVIDER=xunfei
XFYUN_IAT_MODE=legacy
VOICE_INTENT_PROVIDER=xunfei-spark-ws
```

本地开发默认`disabled`或显式`mock`，不存在凭据时不能误写为已配置。

目标绿灯：

```bash
python3 -m unittest tools/test_voice_transcribe_server.py -v
python3 -m py_compile tools/voice_transcribe_server.py
```

### 任务B1.3：依赖和私密文件合同

**修改：**

- `tools/requirements.txt`
- `.gitignore`

加入固定版本的`websockets`和后续Cloud Relay需要的`paho-mqtt`。继续忽略：

```text
.env
.env.*
!deploy/.env.example
*.log
output/
```

运行：

```bash
python3 -m pip install -r tools/requirements.txt
python3 -m unittest tools/test_voice_transcribe_server.py -v
git check-ignore deploy/.env
```

建议提交：

```text
feat: add context voice service core
```

## 7. 批次B2：首页语音与双重白名单

### 任务B2.1：扩展浏览器语音合同

**修改：**

- `dashboard/tests/voice-core.test.js`
- `dashboard/tests/dashboard-contract.test.js`

**新增：**

- `dashboard/tests/voice-session-core.test.js`

先写失败测试：

1. 服务端意图必须匹配`project/profileId`。
2. 九种意图和六种模式再次清洗。
3. 查询/解释类意图不产生`command`。
4. `setMode`、`muteBuzzer`、`confirmContext`、`correctContext`、`setThreshold`生成带ID标准命令。
5. 阈值一次只能一个字段且有范围。
6. 未知/低置信度不发送命令。
7. 会话状态只能按设计状态机迁移。
8. ACK必须匹配同一命令ID。
9. ACK成功与`observed`、硬件验收分离。
10. 首页存在语音卡、录音按钮、文字、意图、ACK和文本降级DOM。
11. `#voice`保留麦克风选择、自检和完整诊断。
12. 静态JavaScript不包含讯飞或MQTT密钥。

目标红灯：

```bash
node --test \
  dashboard/tests/voice-core.test.js \
  dashboard/tests/voice-session-core.test.js \
  dashboard/tests/dashboard-contract.test.js
```

### 任务B2.2：实现纯逻辑模块

**修改：**

- `dashboard/voice-core.js`

**新增：**

- `dashboard/voice-session-core.js`

`voice-core.js`负责：

- 服务端结果清洗。
- 规则文本降级。
- 查询类/控制类分流。
- 标准命令生成。

`voice-session-core.js`负责：

- 状态机迁移。
- 最近文字、意图、置信度、命令ID和ACK。
- 失败和降级说明。
- 不依赖DOM，便于Node测试。

### 任务B2.3：实现首页和语音工作台

**修改：**

- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`

实现：

1. 首页紧凑语音卡。
2. 4.2秒短录音和停止按钮。
3. 上传、STT、意图和命令阶段文案。
4. 麦克风权限、设备刷新和音量自检。
5. 文本降级和快捷表达。
6. 查询类意图使用3500ms内的新鲜遥测。
7. 控制类意图进入现有`CommandLedger`。
8. `confirm/correct/setThreshold`在真板固件未升级时显示协议能力提示。
9. 隐私与GPIO4数据路径说明。
10. 桌面、投屏和390px布局。

JavaScript端点：

```text
本地：http://127.0.0.1:19468/api/voice/transcribe
本地：http://127.0.0.1:19468/api/voice/intent
公网：同源/api/voice/transcribe
公网：同源/api/voice/intent
```

### 任务B2.4：语音Mock端到端

启动：

```bash
VOICE_TRANSCRIBE_PROVIDER=mock \
VOICE_INTENT_PROVIDER=mock \
VOICE_TRANSCRIBE_PORT=19468 \
  python3 tools/voice_transcribe_server.py

python3 tools/n16r8_gateway.py --mock-board --ws-port 18766
python3 -m http.server 18767 -d dashboard
```

验证：

- 首页文本测试得到安全意图。
- `setMode`得到同ID ACK和后续模式遥测。
- `querySafety`不发送命令。
- 未知语句不发送命令。
- 麦克风不可用时文本降级可见。
- Mock状态始终标注模拟数据/模拟执行。

回归：

```bash
node --test dashboard/tests/*.test.js
for file in dashboard/*.js; do node --check "$file"; done
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

建议提交：

```text
feat: add homepage server voice workflow
```

## 8. 批次B3：协议补齐但不烧录

### 任务B3.1：先扩展Mock和固件失败合同

**修改：**

- `tools/test_gateway.py`
- `tools/test_firmware_contract.py`

测试：

1. `contextConfirm`必须有候选情境和布尔确认。
2. `contextCorrect`必须有六种模式之一。
3. `set`一次只允许一个字段。
4. 五个阈值范围和类型正确。
5. 成功/失败都返回同ID ACK。
6. 遥测回传确认/纠正状态和当前阈值。
7. 原有模式、执行器和安全覆盖不回归。

### 任务B3.2：实现Mock协议

**修改：**

- `tools/n16r8_gateway.py`

加入确认、纠正和阈值内存状态，Mock刷新后不冒充持久化。安全阈值不开放给普通情境覆盖；`mq2Threshold`只允许在固件已定义的安全范围内调整，并继续显示未实物标定。

### 任务B3.3：实现PIO协议

**修改：**

- `firmware/src/main.cpp`
- 必要的现有头文件/纯逻辑模块

实现：

- 同ID ACK。
- RAM内阈值配置。
- 当前候选确认/纠正状态。
- 不修改GPIO、安全优先级或上电默认值。
- 不自动写NVS。

验证：

```bash
python3 -m unittest tools/test_gateway.py tools/test_firmware_contract.py -v
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

明确记录：编译通过不等于开发板已升级；公网真板收到这些命令时，在未烧录新固件前可能返回失败ACK。

建议提交：

```text
feat: add context confirmation command contracts
```

## 9. 批次B4：独立Cloud Relay与MQTT

### 任务B4.1：先写Cloud Relay失败测试

**新增：**

- `tools/test_cloud_relay.py`
- `dashboard/tests/cloud-core.test.js`

覆盖：

1. Topic前缀固定`smartlife/context-detective/n16r8`。
2. 外项目、缺失画像和未知类型被拒绝。
3. board帧与command Topic分离。
4. retained只用于最新板端状态，不用于命令。
5. Paho 2.x`ReasonCode`兼容。
6. WSS帧增加/清理`originClientId`元数据。
7. 浏览器忽略自己的回环帧。
8. 本地URL默认不启用公网WSS；公网URL默认同源WSS路径。
9. 没有新鲜板端帧时WSS/MQTT绿色不等于开发板在线。

### 任务B4.2：实现Cloud Relay

**新增：**

- `tools/n16r8_cloud_relay.py`

从`../初中/tools/n16r8_cloud_relay.py`复用网络骨架，改写：

- 项目、画像、Topic和端口。
- 监听`127.0.0.1:19466`。
- MQTT`127.0.0.1:19483`。
- 不使用浏览器硬编码令牌。
- WebSocket握手校验允许Origin。
- 命令与board帧路由隔离。

### 任务B4.3：实现浏览器Cloud Bridge

**新增：**

- `dashboard/cloud-core.js`

**修改：**

- `dashboard/index.html`
- `dashboard/app.js`
- `dashboard/dashboard-state-core.js`

实现：

- 独立WSS端点。
- 随机浏览器客户端ID。
- USB板帧上传WSS。
- 远程命令只由持有Web Serial的浏览器写回USB。
- 第二浏览器显示远程状态和命令ACK。
- transport健康与board新鲜度分开。

### 任务B4.4：Cloud Mock端到端

使用两个WebSocket客户端验证：

```text
USB模拟客户端 -> hello/telemetry
远程客户端 -> command(id)
USB模拟客户端 -> ack(id) + telemetry
两个客户端均看到结果
自身回环不重复记账
```

测试结束清理MQTT retained探针。

建议提交：

```text
feat: add isolated context cloud relay
```

## 10. 批次B5：独立部署文件

### 任务B5.1：部署文件失败合同

在`tools/test_deploy_contract.py`中检查：

- 运行目录唯一。
- 四个单元名唯一。
- 端口只监听`127.0.0.1:194xx`。
- Topic前缀唯一。
- `.env.example`只含空值/说明，不含真实凭据。
- systemd不引用现有项目目录。
- Nginx模板不引用现有项目端口或证书。
- MQTT禁止匿名公网监听。

### 任务B5.2：生成部署文件

**新增：**

- `deploy/.env.example`
- `deploy/mosquitto-context.conf`
- 四个systemd单元模板
- 两阶段Nginx模板
- `deploy/README.md`

`deploy/README.md`必须包含：

1. 部署前服务/端口快照。
2. 新目录安装和虚拟环境。
3. 用户在服务器交互式录入凭据的方法。
4. HTTP/ACME到HTTPS的两阶段顺序。
5. `nginx -t`、reload和新服务启动顺序。
6. 公网健康、WSS、MQTT和静态文件摘要验证。
7. 只回滚`smartlife-context-*`的流程。
8. 不影响现有项目的前后对比命令。

目标测试：

```bash
python3 -m unittest tools/test_deploy_contract.py -v
```

建议提交：

```text
ops: add isolated context deployment templates
```

## 11. 批次B6：全量软件验收与文档同步

### 任务B6.1：全量回归

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
for file in dashboard/*.js; do node --check "$file"; done
python3 -m py_compile \
  tools/n16r8_gateway.py \
  tools/n16r8_cloud_relay.py \
  tools/voice_transcribe_server.py
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git diff --check
git status --short --branch
```

### 任务B6.2：浏览器验证

验证桌面和390px：

- 首页语音卡完整可见。
- `#voice`麦克风诊断可见。
- 文本/快捷表达/Mock音频链路。
- 同ID ACK和后续遥测。
- 旧遥测查询被拒绝。
- WSS/USB/MQTT/开发板状态分离。
- 无控制台错误和横向溢出。

### 任务B6.3：同步文档

**修改：**

- `设计方案.md`
- `开发文档.md`
- `AGENTS.md`

记录：

- 实际通过的测试数量和PIO尺寸。
- 本地Mock与浏览器验证范围。
- 未执行烧录/串口/执行器动作。
- 公网部署是否仍被域名或凭据门阻塞。
- 新固件协议尚未烧录时的诚实提示。

建议提交：

```text
docs: record public voice software baseline
```

推送：

```bash
git push origin main
```

## 12. 批次B7：服务器部署门

只有同时满足以下条件才开始：

1. 用户确认服务器登录密码和讯飞凭据已经轮换。
2. 新凭据由用户直接在服务器交互式写入，不经过聊天或Git。
3. 用户给出独立域名，DNS A记录已经指向服务器。
4. 当前Git主分支已推送，工作区软件测试通过。

部署前快照：

```bash
systemctl list-units --type=service --all | grep -E 'smartlife|nginx'
ss -ltn
sudo nginx -T
```

部署必须：

- 新建`/home/ubuntu/smartlife-context-detective`。
- 只启用`smartlife-context-*`。
- 先HTTP/ACME，后证书和HTTPS。
- 每次Nginx reload前运行`nginx -t`。
- 对比现有服务前后状态。
- 对新公网文件进行SHA-256比对。

公网验证：

```text
HTTPS证书
GET /api/voice/health
文本 -> intent
麦克风 -> STT -> intent
WSS 101
第二浏览器状态
Mock同ID ACK
现有三个SmartLife站点保持正常
```

本批次仍不自动取得真板命令或烧录权限。真板Web Serial只读/控制验收必须由用户在浏览器主动授权，并按当时明确范围执行。

## 13. 完成报告

最终交付必须列出：

- 本地入口和公网URL。
- Git提交和推送结果。
- Python、Node、浏览器和PIO结果。
- 语音供应商、规则降级和双重白名单状态。
- WSS/MQTT端口、路径和Topic。
- 服务器新服务状态以及现有服务未受影响的证据。
- 未烧录的新协议能力和待真板升级说明。
- 风扇、舵机、继电器和RGB仍未实物验收的事实。
