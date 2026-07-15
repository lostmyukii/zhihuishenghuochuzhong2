# 证据链 Dashboard 与完整工作台实施计划

> 状态：设计规格已确认，本文件只定义后续实施顺序；当前不修改运行代码、不烧录、不连接真板。
> 设计依据：[`../specs/2026-07-15-evidence-chain-dashboard-design.md`](../specs/2026-07-15-evidence-chain-dashboard-design.md)
> 项目：`smartlife-junior-context`
> 画像：`smartlife-junior-context-detective-v1`

## 1. 目标

在现有 Vanilla HTML/CSS/JavaScript、Web Serial、Python WebSocket 网关和 `0.4.0` 固件基础上，完成：

1. “真实采集 → 情境推理 → 控制来源 → 联动结果 → 事件记录”的证据链总览。
2. 侦探总览、设备注册、情境联动、网页语音、调试台、数据日志六大工作台。
3. 参考站现有功能的完整能力对照，而不是只复制页面外观。
4. 真板、Mock、缓存、离线、计划动作和真实动作的严格区分。
5. 阈值调整、麦克风入口、8键来源、日志过滤/导出等真实闭环，不留下无响应的装饰按钮。
6. 桌面投屏、平板和 `390px` 手机布局。

## 2. 实施边界

### 2.1 本计划允许

- 修改 `dashboard/`、Dashboard 测试和 Mock 网关。
- 为完成阈值/按键闭环增加最小固件协议和纯逻辑模块。
- 运行 Python/Node 契约测试、JavaScript 语法检查和 PIO 纯编译。
- 使用明确标记 `mock=true` 的本地网关做浏览器验证。
- 更新 `设计方案.md`、`开发文档.md` 和 `AGENTS.md` 的软件状态。

### 2.2 本计划不授权

- `pio run -t upload`。
- `esptool write_flash`、`erase_flash` 或任何串口写入。
- 枚举、打开或占用 CH340。
- 发送任何真板模式、阈值或执行器命令。
- 触发风扇、舵机、继电器、蜂鸣器或RGB动作。
- 修改 Wi-Fi、NVS、小智激活数据或凭据。

软件实现完成后，真板页面连接、阈值实测和执行器动作验收必须另行取得明确授权。

## 3. 总体架构

保持当前无构建工具、无框架的页面结构，新增纯逻辑模块，避免继续把全部状态塞进 `app.js`：

```text
Web Serial / WebSocket
  -> serial-core.js
  -> dashboard-state-core.js       连接与数据源真相
  -> presentation-core.js          传感、证据、动作视图模型
  -> command-ledger-core.js         三种来源、命令ID、ACK、超时
  -> history-core.js                有界历史、过滤、CSV/JSON导出
  -> threshold-core.js              参数白名单、范围、本地配置
  -> voice-core.js                  规则意图与标准命令
  -> registry-core.js / theme-core.js
  -> app.js                         DOM绑定与浏览器API
```

固件仅为真实闭环增加：

```text
UserThresholds      非安全情境阈值，RAM生效
KeypadIntentMapper  8键ADC -> 标准模式/参数意图
hello.capabilities  声明真实支持项
telemetry.config    回传当前阈值和按键来源
ack.applied         回传已应用参数
```

水滴、火焰和MQ2安全阈值不开放给网页覆盖；固定GPIO、安全优先级和输出范围不可配置。

## 4. 测试与提交原则

每一批严格遵循：

1. 先写或修改测试。
2. 运行目标测试并确认因缺少实现而失败。
3. 实现最小代码。
4. 重跑目标测试。
5. 重跑相关全量回归。
6. `git diff --check`。
7. 只提交本批文件并推送 `origin/main`。

不得把“新增测试一开始就通过”记录成有效红灯证据。

## 5. 批次A：页面基础与证据链总览

### 任务A0：记录软件基线

**不修改文件。**

运行：

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/serial-core.js
node --check dashboard/registry-core.js
node --check dashboard/voice-core.js
node --check dashboard/alert-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git status --short --branch
```

验收：

- 记录当前 Python、Node、RAM和Flash结果。
- 工作区除用户已有 `评分表.png` 外无其它意外改动。
- 不启动串口、不上传。

### 任务A1：建立页面状态与呈现纯逻辑

**新增：**

- `dashboard/dashboard-state-core.js`
- `dashboard/presentation-core.js`
- `dashboard/tests/dashboard-state-core.test.js`
- `dashboard/tests/presentation-core.test.js`

**修改：**

- `dashboard/tests/dashboard-contract.test.js`

先写失败测试，覆盖：

1. 页面状态只允许 `waiting / real-telemetry / real-live / mock-live / stale / offline`；其中`real-telemetry`表示新鲜真板遥测已到达，但没有捕获同源启动`hello`。
2. WebSocket已连接但没有新鲜项目遥测时，不得显示真板或模拟板在线。
3. `telemetry.mock=true`只能映射为模拟板在线。
4. 完整`real-live`必须同时满足匹配`hello`、项目、画像和新鲜遥测；只有项目/画像匹配的新鲜非Mock遥测时，显示待确认的`real-telemetry`，不得误写成“无实时数据”或完整“真板在线”。
5. 声音显示“相对强度”，MQ2显示“原始ADC”，不生成 `dB` 或 `ppm`。
6. 四类关键输入与额外输入分层。
7. `actuatorTargets`和`actuators`继续分栏。
8. 单个执行器验收状态不能推断其它执行器。
9. `hardwareVerified=false`、`calibrationRequired=true`不会被隐藏。

目标测试：

```bash
node --test \
  dashboard/tests/dashboard-state-core.test.js \
  dashboard/tests/presentation-core.test.js \
  dashboard/tests/context-core.test.js
```

### 任务A2：重建六入口页面骨架

**修改：**

- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/tests/dashboard-contract.test.js`

实现：

1. 固定完整作品名和副标题。
2. 六个一级入口：侦探总览、设备注册、情境联动、网页语音、调试台、数据日志。
3. 状态条和可展开连接中心。
4. 每个工作台使用真实 `<section>`、标题和可访问导航关系。
5. URL hash 可直达工作台；刷新后保持当前入口。
6. 无JavaScript时保留项目身份和基本说明。
7. 静态HTML不包含“真板在线”等默认成功文案。
8. 页面可见文字不出现评分、得分、高分或功能编号。

先让合同测试因新结构缺失而失败，再实现最小骨架。

目标测试：

```bash
node --test dashboard/tests/dashboard-contract.test.js
node --check dashboard/app.js
```

### 任务A3：实现证据链总览

**修改：**

- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/presentation-core.js`
- `dashboard/tests/presentation-core.test.js`
- `dashboard/tests/dashboard-contract.test.js`

实现：

1. 五节点证据链轨道。
2. 四类关键输入置顶，额外输入折叠/次级显示。
3. 六房间线索地图。
4. 当前候选、覆盖率、匹配度和 `status`。
5. 支持、反向和缺失证据。
6. 三种控制来源摘要。
7. 五类执行器“计划/实际/来源/安全覆盖/验收”表。
8. 最近 3—5 条事件摘要。
9. 新鲜度过期时同时清除情境、输入和执行器状态。

Mock必须显示“模拟数据/模拟执行”。没有遥测时只显示等待态。

### 任务A4：建立命令账本

**新增：**

- `dashboard/command-ledger-core.js`
- `dashboard/tests/command-ledger-core.test.js`

**修改：**

- `dashboard/app.js`
- `dashboard/tests/dashboard-contract.test.js`

从 `app.js` 抽出纯逻辑，记录：

```text
id
source: keypad | web | voice | system
description
sentAt
route
ackAt
ok
error
applied
observedActualAt
```

测试：

1. 无ID命令不能进入账本。
2. ACK必须匹配同一ID。
3. 未匹配ACK可见但不错误关闭其它命令。
4. 超时后状态为失败。
5. ACK成功不自动等同于执行器实物已验收。
6. 页面断线时所有 pending 命令被取消并说明原因。

### 批次A验收

```bash
node --test dashboard/tests/*.test.js
node --check dashboard/dashboard-state-core.js
node --check dashboard/presentation-core.js
node --check dashboard/command-ledger-core.js
node --check dashboard/app.js
git diff --check
```

建议提交：

```text
feat: build evidence-chain dashboard shell
```

## 6. 批次B：六大工作台完整功能

### 任务B1：设备注册与主题

**新增：**

- `dashboard/theme-core.js`
- `dashboard/tests/theme-core.test.js`

**修改：**

- `dashboard/registry-core.js`
- `dashboard/tests/registry-core.test.js`
- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`

实现：

1. 13模块、固定GPIO、模块类型、房间和情境绑定。
2. 分步骤显示主板身份、端口、模块、房间、情境、本地保存。
3. 仍使用画像隔离的本地存储键。
4. 云端未配置时明确显示“后续接入”，不伪造同步成功。
5. 五套主题：档案纸、工程蓝、安全警戒、节能清新、夜间低光。
6. 主题只改变视觉令牌，不改变红/黄/绿状态语义。
7. 系统 `prefers-color-scheme` 只作为建议，不覆盖用户明确选择。

测试13模块和GPIO仍完全固定，RFID不得出现。

### 任务B2：有界历史、过滤与导出

**新增：**

- `dashboard/history-core.js`
- `dashboard/tests/history-core.test.js`

**修改：**

- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`

实现：

1. 内存环形记录，默认最多 `500` 条。
2. 记录 `hello / telemetry摘要 / command / ack / alert / source-change`。
3. 按来源、模式、设备、告警和成功/失败过滤。
4. 传感趋势只对有限时间窗做降采样，不保存无限原始帧。
5. JSON与CSV导出。
6. CSV公式注入防护：以 `= + - @` 开头的单元格做安全前缀处理。
7. 导出不包含密钥、串口对象或浏览器权限信息。

测试固定时间和固定输入，避免依赖本机时区导致不稳定。

### 任务B3：网页麦克风与语音降级

**修改：**

- `dashboard/voice-core.js`
- `dashboard/tests/voice-core.test.js`
- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/tests/dashboard-contract.test.js`

实现：

1. 用户点击后才调用 `navigator.mediaDevices.getUserMedia`。
2. 枚举麦克风、刷新、自检和停止。
3. 浏览器支持 `SpeechRecognition/webkitSpeechRecognition` 时允许语音转文本。
4. 不支持时显示可见降级并保留文本测试。
5. 原始文本先进入 `VoiceCore.parseIntent`，再生成标准白名单命令。
6. 显示原始文本、解析意图、命令ID、发送路线、ACK和错误。
7. 不自动请求权限，不把音频上传到未配置服务。
8. “打开摄像头”及任意GPIO/PWM自由文本继续被拒绝。

浏览器API通过依赖注入或薄适配层测试；Node测试只验证纯逻辑和静态合同。

### 任务B4：调试台安全交互

**修改：**

- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/tests/dashboard-contract.test.js`
- `dashboard/tests/presentation-core.test.js`

实现：

1. 五类执行器控制全部保留。
2. Mock只能模拟执行。
3. 真板首次单项动作出现确认提示。
4. 发送后先等待ACK，再等待新遥测的实际状态。
5. 不提供“一键全部动作”。
6. 安全覆盖原因始终可见。
7. 当前没有硬件授权时，不在自动化测试中连接Web Serial。

页面确认提示不是硬件授权的替代；开发流程仍需用户在会话中明确授权。

### 批次B验收

```bash
node --test dashboard/tests/*.test.js
node --check dashboard/theme-core.js
node --check dashboard/history-core.js
node --check dashboard/voice-core.js
node --check dashboard/app.js
git diff --check
```

建议提交：

```text
feat: complete dashboard workbenches
```

## 7. 批次C：阈值与8键真实闭环

这一批是实现“完整功能”所需的最小跨层扩展。只做软件和编译，不烧录。

### 任务C1：先定义阈值协议失败测试

**新增：**

- `dashboard/threshold-core.js`
- `dashboard/tests/threshold-core.test.js`
- `firmware/include/user_thresholds.h`
- `firmware/src/user_thresholds.cpp`
- `tools/test_user_thresholds.py`

**修改测试：**

- `tools/test_firmware_contract.py`
- `tools/test_gateway.py`
- `dashboard/tests/dashboard-contract.test.js`

先只写测试和头文件合同，要求：

1. 只允许非安全情境参数：
   - `lightStudyMin`
   - `soundStudyMax`
   - `temperatureVentMinC`
   - `humidityVentMinRh`
2. 每次命令只改一个参数。
3. 参数名白名单、类型和范围必须在板端再次校验。
4. 水滴、火焰、MQ2安全阈值不可由网页改写。
5. 命令必须带ID。
6. 成功ACK回传 `applied.threshold.name/value`。
7. 失败ACK回传 `unknown_threshold / invalid_threshold_value`。
8. telemetry回传当前 `config.thresholds` 和配置来源。

建议命令：

```json
{"type":"command","project":"smartlife-junior-context","id":"threshold-1","threshold":{"name":"lightStudyMin","value":600}}
```

### 任务C2：实现板端动态阈值

**修改：**

- `firmware/include/context_engine.h`
- `firmware/src/context_engine.cpp`
- `firmware/src/main.cpp`
- `firmware/include/project_config.h`
- `tools/test_context_engine.py`
- `tools/test_firmware_contract.py`

实现：

1. `UserThresholds`提供默认值、范围校验和单项更新。
2. `ContextEngine`每次评估读取当前非安全阈值。
3. 更新后下一帧判断即可变化。
4. 板端重启回到编译默认值，不写NVS。
5. Dashboard可在用户确认后重新应用浏览器保存的画像配置。
6. 安全引擎继续使用固定安全阈值，不读取用户配置。

原生C++测试至少证明：相同传感输入在修改前后得到不同情境证据，同时安全结果不变。

### 任务C3：实现阈值工作台

**修改：**

- `dashboard/threshold-core.js`
- `dashboard/tests/threshold-core.test.js`
- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/history-core.js`

实现：

1. 显示板端当前值和本地草稿值。
2. 显示合法范围和单位口径。
3. 修改后生成单参数命令。
4. ACK成功后仍等待telemetry回传新值。
5. 显示旧值、新值、命令ID、生效时间和判断变化。
6. 页面刷新后从画像隔离的localStorage恢复草稿。
7. 板端重启后显示“待重新应用”，由用户点击确认，不静默改变板端逻辑。

### 任务C4：8键来源与意图映射

**新增：**

- `firmware/include/keypad_intent_mapper.h`
- `firmware/src/keypad_intent_mapper.cpp`
- `tools/test_keypad_intent_mapper.py`

**修改：**

- `firmware/src/main.cpp`
- `firmware/include/project_config.h`
- `tools/test_firmware_contract.py`
- `tools/n16r8_gateway.py`
- `tools/test_gateway.py`
- `dashboard/presentation-core.js`
- `dashboard/tests/presentation-core.test.js`

规则：

1. 先使用当前已经记录的8键ADC区间；若文档没有完整可复现区间，本任务只实现可配置映射，不伪造实物键值。
2. 模式键生成与网页相同的标准模式意图。
3. 参数键只作用于当前允许调整的非安全阈值。
4. 去抖、长按和重复触发由纯逻辑状态机控制。
5. telemetry回传最近按键、标准意图、事件ID和时间。
6. Dashboard把它显示为“8键AD”来源，不把原始ADC变化冒充已执行命令。

若缺少完整实物键值，本批软件可通过 Mock 和原生测试，但 `keypadMapping`仍必须保持待实物确认，不能写成已验收。

### 任务C5：同步Mock与网关

**修改：**

- `tools/n16r8_gateway.py`
- `tools/test_gateway.py`

Mock增加：

- `config.thresholds`。
- 三种控制来源事件。
- 阈值成功/失败ACK。
- 修改阈值后的情境结果变化。
- 明确 `mock=true` 和模拟执行标签。

真实串口网关只透传协议，不在网关伪造板端ACK或实际动作。

### 批次C验收

```bash
python3 -m unittest \
  tools/test_user_thresholds.py \
  tools/test_keypad_intent_mapper.py \
  tools/test_context_engine.py \
  tools/test_firmware_contract.py \
  tools/test_gateway.py -v
node --test dashboard/tests/*.test.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git diff --check
```

建议提交：

```text
feat: add threshold and keypad control loop
```

## 8. 批次D：响应式、浏览器验证与文档

### 任务D1：响应式与可访问性

**修改：**

- `dashboard/style.css`
- `dashboard/index.html`
- `dashboard/app.js`
- `dashboard/tests/dashboard-contract.test.js`

完成：

- `1600px`三列。
- `1280px`压缩三列或两行。
- `768px`两列。
- `390px`单列且无页面级横向滚动。
- `44px`最小触控面积。
- 焦点环、label、ARIA和减少动态效果。
- 告警不让每个遥测帧反复触发读屏。

### 任务D2：本地Mock浏览器验证

启动：

```bash
python3 tools/n16r8_gateway.py --mock-board --ws-port 18766
python3 -m http.server 18767 -d dashboard
```

入口：

```text
http://127.0.0.1:18767/?ws=ws://127.0.0.1:18766
```

浏览器检查：

1. Mock在线但USB未连接。
2. 六个工作台可访问。
3. 六种情境切换与同ID ACK。
4. 三种控制来源可区分。
5. MQ2/水滴/火焰Mock告警与安全覆盖。
6. 阈值修改前后情境结果变化。
7. 语音支持、拒绝或降级状态真实。
8. 日志过滤和JSON/CSV导出。
9. 桌面与390px手机截图。
10. 断开网关后旧状态清除。

此验证不得枚举或打开任何USB串口。

### 任务D3：全量回归和文档

运行：

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/dashboard-state-core.js
node --check dashboard/presentation-core.js
node --check dashboard/command-ledger-core.js
node --check dashboard/history-core.js
node --check dashboard/threshold-core.js
node --check dashboard/theme-core.js
node --check dashboard/voice-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git diff --check
git status --short --branch
```

更新：

- `设计方案.md`
- `开发文档.md`
- `AGENTS.md`

文档必须分别记录：

- 软件已完成。
- Mock已验证。
- PIO编译结果。
- 尚未烧录的阈值/按键协议。
- 尚未完成的真板执行器动作验收。

建议提交：

```text
docs: record evidence-chain dashboard baseline
```

## 9. 最终软件验收清单

### 9.1 身份与功能

- [ ] 页面只使用本项目名称、画像、六种模式和固定GPIO。
- [ ] 页面可见区域不出现评分、得分、高分或功能编号。
- [ ] 参考站功能均有真实页面落点。
- [ ] RFID不出现。

### 9.2 数据真实性

- [ ] WebSocket连接不等于开发板在线。
- [ ] 真板、Mock、缓存和离线状态严格区分。
- [ ] 声音不虚标dB，MQ2不虚标ppm或空气质量。
- [ ] 旧遥测清除输入、情境和动作状态。
- [ ] 计划动作、ACK、板端实际状态和实物验收分别显示。

### 9.3 控制闭环

- [ ] 网页、网页语义和8键来源使用同一标准命令合同。
- [ ] 每个命令带ID，成功/失败/超时都有可见结果。
- [ ] 阈值修改由板端再次校验并回传实际值。
- [ ] 用户阈值不能覆盖安全阈值。
- [ ] 调试台没有一键全部动作。

### 9.4 工程质量

- [ ] Python和Node全量测试通过。
- [ ] 所有新增JavaScript通过 `node --check`。
- [ ] PIO纯编译成功。
- [ ] 桌面、平板和390px布局通过浏览器检查。
- [ ] `git diff --check`通过。
- [ ] 没有提交日志、密钥、备份、`.pio/`或用户 `评分表.png`。

## 10. 后续硬件门

完成本计划只代表软件与Mock基线完成。后续应分开申请：

1. 真板烧录与连续串口采样授权。
2. 8键ADC区间与阈值改变效果验收。
3. 网页、语义、8键三种控制方式的同类真板动作验收。
4. 风扇、舵机、继电器、RGB逐个低压动作验收。
5. 两个多设备场景的组合验收。

在这些证据完成前，`hardwareVerified=false`和`calibrationRequired=true`继续保持真实。
