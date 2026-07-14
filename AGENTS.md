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

阶段0、阶段1、阶段2和阶段3软件基线已经完成：仓库、最小协议、mock闭环、真实GPIO采样代码、情境引擎、协议测试和纯编译均已通过。阶段3尚未烧录或完成实物标定，当前不得自行扩大到阶段4。

- 固件版本为 `0.2.0`，按200ms采集快速输入、按2000ms读取DHT，并输出数值、有效性、数据年龄、情境候选和固定证据代码。
- DHT最近有效值最多保留6000ms；MQ2在启动后30000ms内只标记预热；水滴和火焰使用连续3帧确认及连续3帧恢复。
- 阶段3只采样和判断，不写风扇、舵机、继电器、蜂鸣器或RGB；`actuatorsReady=false`、`safetyReady=false`必须保持真实。
- 阈值和水滴/火焰高电平触发都只是待实物验证的起始基线；遥测必须保留 `hardwareVerified=false`、`calibrationRequired=true`。
- `tools/n16r8_gateway.py --mock-board` 只产生显式 `mock=true` 的模拟数据，不得把它描述为真板采样。
- Dashboard只有在收到新鲜mock `telemetry` 时才能显示“模拟板在线”；WebSocket已连接、页面已渲染或收到旧数据都不等于真板在线。
- 当前只运行契约测试和 `pio run` 编译，并可运行阶段2的本地mock网关与静态Dashboard；不执行 `upload`、`write_flash`、`erase_flash`、串口烧录或固件恢复。
- 未经用户再次明确授权，不接触开发板Flash、NVS、Wi-Fi或小智激活数据。

2026-07-14阶段3纯编译证据：PlatformIO显示 `[SUCCESS]`，RAM使用 `19140 / 327680 bytes`，Flash使用 `291693 / 6553600 bytes`；本次没有执行上传或串口操作。

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

当前任务禁止执行：

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
{"type":"hello","project":"smartlife-junior-context","profileId":"smartlife-junior-context-detective-v1","board":"n16r8_esp32s3","firmware":"0.2.0","baud":115200,"rfid":false,"features":{"contextReasoning":true,"webVoiceIntent":true,"localVoiceNlu":false,"mcp":false}}
```

阶段3遥测必须区分采样器就绪与实物尚未验收。以下数值只展示字段结构，不是标定结果：

```json
{"type":"telemetry","project":"smartlife-junior-context","mode":"detect","sensors":{"light":0,"sound":0,"temperature":null,"humidity":null,"pir":false,"keypad":0,"mq2":0,"water":false,"flame":false},"sensorValid":{},"sensorAgeMs":{},"context":{"candidate":"detect","coverage":0,"match":0,"status":"unknown","supporting":[],"opposing":[],"missing":[]},"actuators":{},"alerts":[],"health":{"stage":"stage3-sensors-context","sensorsReady":true,"actuatorsReady":false,"contextReady":true,"safetyReady":false,"hardwareVerified":false,"calibrationRequired":true}}
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

阶段3验证命令：

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
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

阶段3软件基线完成后，下一步仍是阶段3真板验收：获得明确烧录授权后，逐项采集光敏、声音、DHT、PIR、8键AD、MQ2、水滴和火焰原始值，确认MQ2分压以及水滴/火焰触发电平，再修订暂定阈值。完成实物证据前，不进入阶段4执行器和安全引擎。
