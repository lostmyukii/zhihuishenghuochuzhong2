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

阶段0至阶段4软件基线已经完成，并已完成阶段4第一个物理执行器——GPIO13有源蜂鸣器——的真板验收。当前开发板运行PIO固件 `0.3.1`；风扇、舵机、继电器和RGB仍保持未连接、未武装、未验收。

- 固件版本为 `0.3.1`，按200ms采集快速输入、按2000ms读取DHT，并输出数值、有效性、数据年龄、情境候选、固定证据代码、安全状态、逻辑动作目标和物理执行状态。
- DHT最近有效值最多保留6000ms；MQ2在启动后30000ms内只标记预热；水滴和火焰使用连续3帧确认及连续3帧恢复。
- MQ2暂定报警/恢复阈值为 `2600/2400`，使用连续3个新采样确认；快速安全输入超过1500ms未更新时进入传感器故障判断。以上仍是待实物复核的基线。
- `ACTUATORS_ARMED=true`只允许进入逐项验收路径；`BUZZER_ARMED=true`且`BUZZER_HARDWARE_VERIFIED=true`，其他四个独立开关仍为 `false`。驱动层只允许写GPIO13，不得写GPIO11/9/12/46、PWM、舵机attach或灯环输出。
- GPIO13按高电平有效处理：初始化时先写`LOW`再设为输出，上电静音；`actuator.buzzer=true`触发约800ms非阻塞短鸣并自动回到`LOW`，`false`立即停止。
- `actuators.buzzerOn`可为真实`true/false`；风扇、舵机、继电器和RGB实际值仍为`null`。`actuatorsReady=false`继续表示整组执行器尚未完成。
- `safetyReady=true`只表示安全软件判断已通过测试；安全规划中的`alarm/intermittent`尚未自动映射到物理蜂鸣器。全项目仍保留`hardwareVerified=false`、`calibrationRequired=true`。
- 安全优先级固定为火焰 > MQ2 > 水滴 > 传感器故障；火焰必须覆盖MQ2排风并停止风扇，水滴不得启动风扇或舵机，静音只关闭声音而不删除风险或其他保护目标。
- 阈值和水滴/火焰高电平触发都只是待实物验证的起始基线；遥测必须保留 `hardwareVerified=false`、`calibrationRequired=true`。
- `tools/n16r8_gateway.py --mock-board` 只产生显式 `mock=true` 的模拟数据，不得把它描述为真板采样。
- Dashboard只有在收到新鲜mock `telemetry` 时才能显示“模拟板在线”；真板当前显示“仅蜂鸣器测试已武装”，其他执行器显示“未武装/未应用”。WebSocket已连接、页面已渲染或收到旧数据都不等于真板在线。
- 本轮硬件验收完成后，当前只运行契约测试和 `pio run` 编译，并可运行阶段2的本地mock网关与静态Dashboard；未经新的明确授权，不再执行`upload`、`write_flash`、`erase_flash`、串口烧录或固件恢复。
- 未经用户再次明确授权，不接触开发板Flash、NVS、Wi-Fi或小智激活数据。

2026-07-15 GPIO13验收证据：Python 25项、Node 17项测试通过；PlatformIO显示`[SUCCESS]`，RAM使用`19324 / 327680 bytes`，Flash使用`299385 / 6553600 bytes`。候选应用和最终应用均只写PIO应用区`0x10000`并独立出现`verify OK (digest matched)`；真板确认上电静音、800ms单次可听短鸣、自动停止、显式停止回执，以及风扇命令被`actuators_unarmed`拒绝。

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
{"type":"hello","project":"smartlife-junior-context","profileId":"smartlife-junior-context-detective-v1","board":"n16r8_esp32s3","firmware":"0.3.1","baud":115200,"rfid":false,"features":{"contextReasoning":true,"safetyReasoning":true,"actuatorPlanning":true,"physicalActuators":false,"physicalBuzzer":true,"webVoiceIntent":true,"localVoiceNlu":false,"mcp":false}}
```

阶段4遥测必须区分逻辑动作目标、物理实际值和实物尚未验收。以下数值只展示字段结构，不是标定结果：

```json
{"type":"telemetry","project":"smartlife-junior-context","mode":"detect","sensors":{"light":0,"sound":0,"temperature":null,"humidity":null,"pir":false,"keypad":0,"mq2":0,"water":false,"flame":false},"sensorValid":{},"sensorAgeMs":{},"context":{"candidate":"detect","coverage":0,"match":0,"status":"unknown","supporting":[],"opposing":[],"missing":[]},"actuatorTargets":{"fanPercent":0,"servoPosition":"hold","relayOn":false,"buzzerMode":"off","rgbState":"off"},"actuators":{"fanPercent":null,"servoAngle":null,"relayOn":null,"buzzerOn":false,"rgbState":null},"alerts":[],"safety":{"state":"normal","primary":"none","causes":[],"overrideActive":false,"buzzerRequested":false,"buzzerMuted":false},"health":{"stage":"stage4-buzzer-hardware-validation","sensorsReady":true,"actuatorsArmed":true,"actuatorsReady":false,"buzzerArmed":true,"fanArmed":false,"servoArmed":false,"relayArmed":false,"rgbArmed":false,"buzzerHardwareVerified":true,"actuatorApplyState":"partial-buzzer-test","contextReady":true,"safetyReady":true,"hardwareVerified":false,"calibrationRequired":true}}
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

阶段3和阶段4软件验证命令：

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

阶段4真板验收已完成蜂鸣器，下一项为RGB灯环`GPIO46`，之后依次为风扇、舵机和继电器。每次只新增一个独立武装开关并重新完成上电默认、命令回执、自动停止/恢复、串口状态和人工实物证据；未经对应实物验收，不得把该执行器开关改为`true`，也不得声称物理执行成功。下一次Flash或物理测试仍需用户明确授权。
