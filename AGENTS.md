# N16R8 无摄像头家庭情境侦探屋协作规则

本目录是智慧生活初中组独立作品 `N16R8 无摄像头家庭情境侦探屋`。进入本目录后，先按顺序阅读：

1. `设计方案.md`
2. `开发文档.md`
3. 本文件

相邻 `../初中` 项目只作为已经验证过的工程参考，不得覆盖本项目的作品名称、项目画像、模式名、部署标识或在线服务。

## 项目身份

| 项目 | 固定值 |
| --- | --- |
| 作品名称 | N16R8 无摄像头家庭情境侦探屋 |
| project | `smartlife-junior-context` |
| profileId | `smartlife-junior-context-detective-v1` |
| 主控 | N16R8 / LY-AS-ESP32-S3 v1.2，16MB Flash，8MB OPI PSRAM |
| 主固件 | PlatformIO + Arduino |
| 串口 | CH340 UART，`115200` |
| 当前连接路线 | N16R8 -> Web Serial/Python网关 -> Dashboard -> WSS/MQTT |
| 语音语义 | 网页端链路判断；主板不运行本地语义模型或MCP |
| GitHub | `https://github.com/lostmyukii/zhihuishenghuochuzhong2.git` |

## 当前阶段

阶段0至阶段5软件基线、`0.4.0`应用区烧录/静态串口验收和证据链Dashboard批次A已经完成。当前开发板运行`0.4.0`；最近一次真板验收只检查启动保护、传感器、MQ2预热和默认安全状态，没有发送模式或执行器命令。批次A只运行软件测试、显式Mock和PIO纯编译。

- `0.4.0`按200ms采集快速输入、按2000ms读取DHT，并输出数值、有效性、数据年龄、情境证据、安全判断、逻辑动作目标和真实驱动状态。
- DHT最近有效值最多保留6000ms；MQ2预热30000ms；水滴和火焰使用连续3帧确认及3帧恢复。MQ2暂定报警/恢复阈值`2600/2400`、水滴/火焰触发电平和其他阈值仍待真板复核。
- 五个执行器驱动均已进入软件基线：GPIO11风扇25kHz/8位PWM、GPIO9舵机、GPIO12低压LED继电器、GPIO13有源蜂鸣器、GPIO46 12颗GRB灯环。`ACTUATORS_ARMED`及五个独立开关均为`true`。
- 上电先应用风扇0%、继电器断开、蜂鸣器LOW、RGB熄灭和舵机安全位置，保持`ACTUATOR_BOOT_GUARD_MS=5000`；保护窗结束前`actuatorsReady=false`且物理执行器命令返回`actuators_boot_guard`。
- `BUZZER_HARDWARE_VERIFIED=true`沿用既有GPIO13人工证据；风扇、舵机、继电器和RGB均为`HardwareVerified=false`。特别是RGB虽然参与软件联动，GPIO46仍没有人工可见亮灯证据。
- 安全优先级固定为火焰 > MQ2 > 水滴 > 传感器故障；手动覆盖不能覆盖相同执行器的安全目标。`buzzerEnabled=false`只静音声音，不删除风险或其他保护动作。
- Web Serial是主连接路线；`tools/n16r8_gateway.py`是真CH340备用路线，`--mock-board`只产生显式`mock=true`的数据。WebSocket在线、USB已授权、页面已渲染或旧遥测都不等于开发板数据在线。
- Dashboard必须分开显示计划目标、实际应用、Mock模拟执行、启动保护和硬件验收状态；3500ms没有新鲜遥测后清除旧结论。
- Dashboard现有六个hash工作台和五节点证据链；`dashboard-state-core.js`、`presentation-core.js`、`command-ledger-core.js`分别负责连接真相、诚实呈现和同ID命令台账。ACK成功或后续看到遥测仍不等于实物已经验收。
- 新鲜、非Mock、项目/画像匹配的真板遥测已经到达，但同源启动`hello`未被浏览器捕获时，状态必须为`real-telemetry`：开发板显示“真板遥测在线”，数据源显示“未捕获启动身份”，不得回落为“无实时数据”，也不得冒充完整“真板在线”。
- 本轮烧录与静态采样授权已经使用完毕，当前默认回到契约测试、`pio run`纯编译、本地Mock网关与静态Dashboard。下一次真板控制或再次写入仍需用户明确授权。
- 任何后续PIO应用写入仍只允许`0x10000`，写后独立校验；不得擦除或覆盖bootloader、分区表、NVS、Wi-Fi或小智激活数据。

2026-07-15 GPIO13验收证据：Python 25项、Node 17项测试通过；PlatformIO显示`[SUCCESS]`，RAM使用`19324 / 327680 bytes`，Flash使用`299385 / 6553600 bytes`。候选应用和最终应用均只写PIO应用区`0x10000`并独立出现`verify OK (digest matched)`；真板确认上电静音、800ms单次可听短鸣、自动停止、显式停止回执，以及风扇命令被`actuators_unarmed`拒绝。

2026-07-15 RGB诊断证据：灯环端丝印为字母`SI`输入和`SO`输出，不能写成数字`S1/S0`。信号改接`SI`后，同一灯环和线材在GPIO13可见点亮；接回GPIO46时，候选固件同ID回执、红色状态、约4.98秒自动关闭和显式关闭均正常，但人工未见亮灯。最终`0.3.2`已恢复`RGB_ARMED=false`、`RGB_HARDWARE_VERIFIED=false`，真板`rgbState=null`且RGB命令被`actuators_unarmed`拒绝。安全版Python 26项、Node 18项和PIO编译通过，应用区校验为`verify OK (digest matched)`。

2026-07-15阶段5软件证据：Python 30项、Node 28项全部通过；JavaScript语法检查通过；本地浏览器完成Mock模式、MQ2安全覆盖、手动风扇、安全静音、同ID回执及390px布局验证；PlatformIO纯编译`[SUCCESS]`，RAM`19712 / 327680 bytes`（6.0%），Flash`325881 / 6553600 bytes`（5.0%）。本次没有上传、串口监视或占用USB。

2026-07-15阶段5真板静态证据：用户确认风扇外接电池关闭、Web Serial释放且高电流负载安全后，只将326240字节、SHA-256为`a61dbe59b6319f894f34ebc51359b42ef212c8dcdafd45d12eb0de8dbdc757ec`的应用镜像写入`0x10000`；写入范围为`0x00010000-0x0005ffff`，独立`verify_flash`返回`verify OK (digest matched)`，未写bootloader、分区表或NVS。串口确认`hello.firmware=0.4.0`，约5.15秒由`boot-guard`进入`fully-armed`；30.65秒MQ2退出预热，安全状态为`normal`、9项传感器有效、无告警，实际状态为风扇0%、舵机0度、继电器断开、蜂鸣器关闭、RGB关闭。仍保持`hardwareVerified=false`、`calibrationRequired=true`和四项未验收标志。

2026-07-15证据链Dashboard批次A软件证据：Python 30项、Node 47项全部通过，全部Dashboard JavaScript语法检查和`git diff --check`通过；显式Mock实际收到正确项目/画像`hello`、`mock=true`遥测、同ID成功ACK和模式变化后的新遥测，结束后恢复`detect`。PIO纯编译`[SUCCESS]`，RAM`19712 / 327680 bytes`（6.0%），Flash`325881 / 6553600 bytes`（5.0%）。本轮内置浏览器无可用实例，故没有新增视觉截图证据；没有连接、枚举或占用USB，也没有烧录。

2026-07-16真板遥测身份待补状态证据：定向测试先因缺少`real-telemetry`失败，最小实现后全量Python 30项、Node 49项和全部Dashboard JavaScript语法检查通过；PIO纯编译`[SUCCESS]`，RAM`19712 / 327680 bytes`（6.0%），Flash`325881 / 6553600 bytes`（5.0%）。本轮只改Dashboard状态机、测试和文档，没有连接、枚举或占用USB，也没有烧录。

阶段2固定本地端口：WebSocket网关 `127.0.0.1:18766`，静态Dashboard `127.0.0.1:18767`。标准启动命令：

```bash
python3 tools/n16r8_gateway.py --mock-board --ws-port 18766
python3 -m http.server 18767 -d dashboard
```

浏览器入口：`http://127.0.0.1:18767/?ws=ws://127.0.0.1:18766`。阶段2不枚举或占用任何USB串口。

## 固定GPIO合同

### 传感器与输入

| 模块 | 拓展板端口 | 接线 | 固件符号 |
| --- | --- | --- | --- |
| 光敏传感器 | `GPIO1` | `V-G-S` | `PIN_LIGHT` |
| 声音传感器 | `GPIO4` | `V-G-S` | `PIN_SOUND` |
| 温湿度DHT | `GPIO14` | `V-G-S` | `PIN_DHT` |
| PIR人体红外 | `GPIO5` | `V-G-S` | `PIN_PIR` |
| 8键AD键盘 | `GPIO10` | `V-G-S10` | `PIN_KEYPAD_ADC` |
| MQ2烟雾/燃气 | `GPIO2` | `AO -> S2`，`G -> G` | `PIN_MQ2` |
| 水滴传感器 | `GPIO8` | `V-G-S` | `PIN_WATER` |
| 火焰传感器 | `GPIO45` | `V-G-S` | `PIN_FLAME` |

### 执行器

| 模块 | 拓展板端口 | 固件符号 |
| --- | --- | --- |
| 有源蜂鸣器 | `GPIO13` | `PIN_BUZZER` |
| 风扇 | `GPIO11` | `PIN_FAN` |
| 舵机 | `GPIO9` | `PIN_SERVO` |
| 继电器 | `GPIO12` | `PIN_RELAY` |
| RGB灯环 | `GPIO46` | `PIN_RGB` |

RFID保持禁用，`GPIO11/12/13`分别固定给风扇、继电器和蜂鸣器。改变任何GPIO前，必须同步修改 `设计方案.md`、`开发文档.md`、固件、mock、Dashboard注册表和契约测试。

当前实物GPIO13拓展板端口与蜂鸣器模块均按丝印`G-V-S`同序连接，必须逐针核对`G→G、V→V、S13→S`，不得仅根据通用表格猜测三针物理排列。

## 硬件安全合同

- MQ2如果使用5V供电，AO禁止直接连接GPIO2，必须先分压并实测确认最大不超过 `3.3V`。
- 继电器只控制低压模型负载，不连接 `220V`。
- 风扇、舵机、继电器和RGB使用外部电源时必须与N16R8共地。
- 正式硬件阶段的上电默认值必须为：风扇关闭、继电器断开、蜂鸣器物理静音、RGB安全状态、舵机安全位置。
- 上电静音不等于关闭安全报警；只有明确的 `buzzerEnabled=false` 才表示用户主动静音。
- 不使用真实燃气、危险烟雾或明火测试。
- 水滴、火焰模块触发电平必须以当前实物测量为准，未测量前不得写成已确认值。

## PlatformIO合同

固定基线：

```text
platformio/espressif32@7.0.1
framework = arduino
board = n16r8_esp32s3
monitor_speed = 115200
upload_speed = 115200
default_16MB.csv
PIO app offset = 0x10000
```

必须保留CH340构建标志：

```text
-DARDUINO_USB_MODE=0
-DARDUINO_USB_CDC_ON_BOOT=0
```

标准编译命令：

```bash
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

后续默认禁止执行（只有用户对下一项硬件测试再次明确授权后才能临时解除对应最小范围）：

```text
pio run -t upload
esptool write_flash
esptool erase_flash
idf.py flash
```

## 串口JSON合同

串口每行只能包含一个完整JSON对象，不能混入普通调试文字。

启动身份：

```json
{"type":"hello","project":"smartlife-junior-context","profileId":"smartlife-junior-context-detective-v1","board":"n16r8_esp32s3","firmware":"0.4.0","baud":115200,"rfid":false,"features":{"contextReasoning":true,"safetyReasoning":true,"actuatorPlanning":true,"physicalActuators":true,"physicalBuzzer":true,"physicalFan":true,"physicalServo":true,"physicalRelay":true,"physicalRgb":true,"webVoiceIntent":true,"localVoiceNlu":false,"mcp":false}}
```

阶段5遥测必须区分逻辑动作目标、物理实际值和实物尚未验收。以下数值只展示字段结构，不是标定结果：

```json
{"type":"telemetry","project":"smartlife-junior-context","mode":"detect","sensors":{"light":0,"sound":0,"temperature":null,"humidity":null,"pir":false,"keypad":0,"mq2":0,"water":false,"flame":false},"sensorValid":{},"sensorAgeMs":{},"context":{"candidate":"detect","coverage":0,"match":0,"status":"unknown","supporting":[],"opposing":[],"missing":[]},"actuatorTargets":{"fanPercent":0,"servoPosition":"hold","relayOn":false,"buzzerMode":"off","rgbState":"off"},"actuators":{"fanPercent":0,"servoAngle":0,"relayOn":false,"buzzerOn":false,"rgbState":"off"},"alerts":[],"safety":{"state":"normal","primary":"none","causes":[],"overrideActive":false,"buzzerRequested":false,"buzzerMuted":false},"health":{"stage":"stage5-integrated-realtime","sensorsReady":true,"actuatorsArmed":true,"actuatorsReady":true,"buzzerArmed":true,"fanArmed":true,"servoArmed":true,"relayArmed":true,"rgbArmed":true,"buzzerHardwareVerified":true,"fanHardwareVerified":false,"servoHardwareVerified":false,"relayHardwareVerified":false,"rgbHardwareVerified":false,"actuatorApplyState":"fully-armed","contextReady":true,"safetyReady":true,"hardwareVerified":false,"calibrationRequired":true}}
```

当前固件只接受六个模式名：

```text
detect, study, rest, ventilation, energy, custom
```

命令必须带 `id`。成功或失败都返回同一ID的 `ack`；未知类型、未知模式或无ID命令不得静默成功。

## 网页语音边界

- 浏览器或同域服务负责STT和自然语义解析。
- 主板只接收经过服务端和Dashboard双重白名单校验后的标准 `command`。
- `hello.features.webVoiceIntent=true`表示支持网页意图桥接；`localVoiceNlu=false`和`mcp=false`必须保持真实。
- 自由文本不能直接生成GPIO、舵机角度、PWM或继电器命令。
- API密钥、STT凭据、MQTT凭据、Wi-Fi和令牌不得进入Git或浏览器JavaScript。

## 验证顺序

每个阶段遵循：

1. 先写或更新契约测试。
2. 运行测试并确认它能发现缺失实现。
3. 实现最小代码。
4. 再运行契约测试。
5. 运行PIO编译。
6. 使用 `git diff --check` 和 `git status --short --branch` 复核。
7. 只提交当前步骤文件并推送 `origin/main`。

阶段1验证命令：

```bash
python3 -m unittest tools/test_firmware_contract.py -v
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

阶段2验证命令：

```bash
python3 -m unittest tools/test_gateway.py tools/test_firmware_contract.py -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
```

阶段3至阶段5软件验证命令：

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

只有命令实际通过才可以记录成功。编译成功不等于真板运行、串口正常或硬件已验收。

## Git规则

- 开始和结束都运行 `git status --short --branch`。
- 保留用户已有改动，不修改无关文件。
- `.pio/`、私密Flash备份、`.env`、日志、缓存、Wi-Fi和服务密钥不得提交。
- 每个可验证阶段单独提交，提交说明简短明确，并推送 `origin/main`。
- 推送失败时先恢复仓库同步，再扩大开发范围。

## 下一阶段顺序

`0.4.0`应用区烧录、独立校验、5秒启动保护、30秒MQ2预热静态验收和Dashboard批次A已完成。Dashboard软件路线下一步为批次B：设备注册/主题、有限历史与安全导出、网页麦克风及文本降级；继续只做软件和显式Mock时不扩大真板权限。真板路线仍只能在用户再次明确授权后进行Web Serial只读闭环或逐个低压执行器动作验收。完成对应人工证据前不得把风扇、舵机、继电器或RGB写成已验收，也不得声称整屋物理联动已经通过。
