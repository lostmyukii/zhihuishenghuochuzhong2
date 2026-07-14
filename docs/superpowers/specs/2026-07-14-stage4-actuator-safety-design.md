# 阶段4执行器与安全引擎软件基线设计规格

> 项目：N16R8 无摄像头家庭情境侦探屋
>
> project：`smartlife-junior-context`
>
> profileId：`smartlife-junior-context-detective-v1`
>
> 目标固件版本：`0.3.0`
>
> 规格日期：2026-07-14
>
> 规格状态：三部分设计已由用户确认，等待书面规格复核
>
> 实施边界：只建立阶段4软件、测试和PlatformIO纯编译基线，不烧录、不读取Flash、不占用串口、不驱动真板执行器

## 1. 背景与目标

阶段3已经建立真实GPIO采样代码、DHT有效期、MQ2预热、数字输入去抖和纯C++情境引擎。当前代码仍诚实输出：

```text
actuatorsReady=false
safetyReady=false
hardwareVerified=false
calibrationRequired=true
```

阶段4要在不触碰执行器硬件的前提下，补齐三项软件能力：

1. 用独立安全引擎判断MQ2、水滴、火焰和安全输入失效状态。
2. 用执行器规划器合并普通情境目标与安全覆盖目标，并保证安全目标优先。
3. 用默认未武装的执行器驱动层建立物理动作总闸，使软件可以完整测试，但不会写入任何执行器GPIO。

本阶段完成后，只能表述为“执行器与安全引擎软件基线通过”。它不证明风扇、舵机、继电器、蜂鸣器或RGB已经接线、上电、标定或真板验收。

## 2. 范围与非目标

### 2.1 本阶段范围

- 固件版本升级到`0.3.0`。
- 新增纯C++ `SafetyEngine`。
- 新增纯C++ `ActuatorPlanner`。
- 新增唯一允许接触执行器GPIO的`ActuatorDriver`，但保持全局未武装。
- 增加普通情境目标、安全目标、最终计划目标和实际执行状态的分层数据。
- 增加安全报警、显式静音和执行器命令错误处理。
- 同步最小mock和Dashboard协议展示，明确区分模拟执行、计划动作和真板实际动作。
- 先写失败测试，再实现最小代码，最后运行全量契约测试和PIO纯编译。

### 2.2 本阶段不做

- 不上传、烧录、擦除、读取或校验开发板Flash。
- 不枚举、打开或占用CH340串口。
- 不对风扇、舵机、继电器、蜂鸣器或RGB执行`pinMode`、`digitalWrite`、PWM、`attach`或灯环初始化。
- 不把快速传感器检查写成阈值、电平或电压已经完成实物标定。
- 不启用8键AD参数编辑、自定义模板持久化、语音服务、公网WSS/MQTT或历史数据功能。
- 不使用真实燃气、危险烟雾或明火。
- 不把mock动作描述为真板动作。

## 3. 固定硬件合同

阶段4不得改变现有GPIO：

| 模块 | GPIO | 固件符号 |
| --- | ---: | --- |
| 有源蜂鸣器 | 13 | `PIN_BUZZER` |
| 风扇 | 11 | `PIN_FAN` |
| 舵机 | 9 | `PIN_SERVO` |
| 继电器 | 12 | `PIN_RELAY` |
| RGB灯环 | 46 | `PIN_RGB` |
| MQ2 | 2 | `PIN_MQ2` |
| 水滴 | 8 | `PIN_WATER` |
| 火焰 | 45 | `PIN_FLAME` |

RFID保持禁用。MQ2使用5V供电时，AO仍必须先分压，并在未来真板阶段实测最大输入不超过`3.3V`。继电器未来只允许连接低压模型负载；外部执行器电源必须与N16R8共地。

## 4. 总体架构

数据只沿以下方向流动：

```text
SensorSnapshot
  -> SafetyEngine
  -> SafetyResult

SensorSnapshot + ContextResult + selectedMode
  -> ActuatorPlanner普通目标

普通目标 + SafetyResult + buzzerEnabled
  -> ActuatorPlanner最终目标 actuatorTargets

actuatorTargets + 编译期武装门控
  -> ActuatorDriver
  -> actuators实际状态

以上结果
  -> 单行JSON telemetry / alerts / safety / health
  -> mock与Dashboard合同
```

三个组件必须互相隔离：

- `SafetyEngine`只判断风险，不写GPIO，也不依赖Arduino。
- `ActuatorPlanner`只计算目标，不写GPIO，也不把用户请求当作已经执行。
- `ActuatorDriver`是唯一允许接触执行器GPIO的组件；未武装时不得初始化或写入任何执行器端口。

## 5. 核心组件

### 5.1 SafetyEngine

输入：

- 当前`SensorSnapshot`。
- 当前时间。
- MQ2预热状态。
- MQ2、水滴和火焰的有效性、数据年龄与去抖结果。
- 软件测试用MQ2报警阈值与恢复阈值。

输出`SafetyResult`：

- `state`：`normal`、`warming`、`risk`或`sensor_fault`。
- `primary`：当前解决动作冲突时的主风险；无风险时为`none`。
- `causes`：全部有效风险代码，按`flame`、`mq2`、`water`、`safety_sensor_fault`的固定顺序去重。
- `buzzerRequested`：是否有安全规则请求报警声。
- `overrideActive`：MQ2预热提示、安全风险或安全输入故障是否实际覆盖了至少一个普通目标。
- 每个执行器的安全目标或“无安全覆盖”。

固定风险代码：

```text
mq2
water
flame
safety_sensor_fault
```

MQ2预热使用状态字段表达，不加入`alerts`，也不能显示为“环境安全”。
`primary`按`flame > mq2 > water > safety_sensor_fault > none`选择，只用于解决动作冲突，不能删除低优先级原因。

### 5.2 ActuatorPlanner

规划器分三层计算：

1. `normalTarget`：由当前模式、情境结果和有效传感器生成普通目标。
2. `safetyTarget`：由`SafetyResult`生成安全覆盖目标。
3. `actuatorTargets`：逐个执行器解决冲突后的最终计划目标。

最终目标采用语义字段，避免在实物标定前伪造舵机角度或RGB底层参数：

```json
{
  "fanPercent": 0,
  "servoPosition": "hold",
  "relayOn": false,
  "buzzerMode": "off",
  "rgbState": "off"
}
```

允许的舵机语义位置为：

```text
hold, study, rest, ventilation-open, energy, safety-closed
```

允许的蜂鸣器语义模式为：

```text
off, alarm, intermittent
```

允许的RGB语义状态为：

```text
off, study, orange, blue-low, cyan, yellow, red, blue-red, gray
```

这些是软件意图，不是已经验证的实际角度、波形或颜色值。

### 5.3 ActuatorDriver

驱动层使用一个全局总闸和五个独立开关：

```cpp
constexpr bool ACTUATORS_ARMED = false;
constexpr bool BUZZER_ARMED = false;
constexpr bool FAN_ARMED = false;
constexpr bool SERVO_ARMED = false;
constexpr bool RELAY_ARMED = false;
constexpr bool RGB_ARMED = false;
```

本阶段所有值固定为`false`。只有未来取得真板烧录和逐项接线授权后，才允许先打开总闸，再一次只启用一个模块。

当`ACTUATORS_ARMED=false`时，驱动层必须：

- 不为GPIO9/11/12/13/46调用输出初始化。
- 不attach舵机。
- 不初始化NeoPixel/RGB对象。
- 不写PWM或数字电平。
- 返回`unarmed`应用结果。
- 不把逻辑目标记录为物理成功。

由于端口没有被驱动，本阶段不能宣称实际硬件处于某个电平。遥测中的实际执行字段必须使用`null`表示不可用，而不是用`false`冒充已经物理关闭。

## 6. 普通情境目标

普通目标使用现有阶段3暂定阈值；所有阈值仍标记`provisional-unverified`。阶段4增加以下软件测试常量：

```text
FAN_LOW_PERCENT=35
FAN_VENTILATION_PERCENT=70
FAN_ALERT_PERCENT=100
PROVISIONAL_MQ2_ALERT_RAW=2600
PROVISIONAL_MQ2_RECOVERY_RAW=2400
FAST_SAFETY_STALE_MS=1500
```

MQ2数值依据当前mock风险值和阶段3原始值范围选作可测试起点，不是专业报警限值；普通风扇档位也不是实物转速标定。它们都必须通过命名常量集中管理，并继续保留`calibrationRequired=true`。

普通动作按传感器分别门控：某项输入无效或过期时，只取消依赖该输入的普通动作，不能用旧值继续动作，也不能阻止独立的安全判断。`ventilation`完全依赖DHT，DHT无效时固定输出风扇0、舵机`hold`、继电器关闭、蜂鸣器关闭、RGB灰色。

| 模式 | 普通目标 |
| --- | --- |
| `detect` | 风扇0、舵机`hold`、继电器关闭、蜂鸣器关闭、RGB关闭；只观察情境和安全结果。 |
| `study` | PIR有效且有活动、光照低于暂定暗阈值时请求低压继电器；声音高于暂定学习阈值时RGB橙色；有效DHT达到湿热阈值时请求35%风扇和`ventilation-open`，否则舵机为`study`。普通蜂鸣器保持关闭。 |
| `rest` | 继电器关闭、舵机`rest`、RGB低亮蓝；有效DHT达到湿热阈值时可请求35%风扇，否则风扇关闭；普通蜂鸣器保持关闭。 |
| `ventilation` | 有效DHT达到暂定高温或高湿条件时请求70%风扇，否则请求35%基础通风；舵机`ventilation-open`、RGB青色、继电器关闭、普通蜂鸣器关闭。DHT无效时使用上一段规定的固定停止目标。 |
| `energy` | 风扇、继电器、蜂鸣器和RGB关闭，舵机`energy`。 |
| `custom` | 阶段5自定义配置尚未实现，本阶段保持与`detect`相同的安全空闲目标，不接受任意动作。 |

无论普通目标为何，安全引擎都可以逐个覆盖。普通模式、手动命令和未来自定义规则均不能清除已确认风险。

## 7. 安全规则与冲突优先级

### 7.1 MQ2

- 启动后前`30000ms`标记`warming`，只把RGB计划目标覆盖为黄色；风扇保持0、舵机不动作、继电器保持关闭、蜂鸣器保持关闭。`warming`不产生报警代码。
- 预热完成后，MQ2原始值达到或超过`PROVISIONAL_MQ2_ALERT_RAW=2600`，并连续3个快速采样周期满足条件，确认`mq2`。
- MQ2原始值降到或低于`PROVISIONAL_MQ2_RECOVERY_RAW=2400`，并连续3个快速采样周期满足条件后才允许恢复；中间区间保持原状态形成迟滞。
- 安全目标：风扇100%、舵机`ventilation-open`、继电器关闭、RGB红色、蜂鸣器`alarm`。
- 阈值和分压电压仍未完成实物标定，必须继续显示校准提示。

### 7.2 火焰

- 使用阶段3连续3帧确认、连续3帧恢复后的数字结果。
- 火焰是执行器冲突的最高优先级。
- 安全目标：风扇0、舵机`safety-closed`、继电器关闭、RGB红色、蜂鸣器`alarm`。
- 火焰与MQ2同时存在时，`alerts`保留两个代码，但风扇必须为0，不能执行MQ2排风。

### 7.3 水滴

- 使用阶段3连续3帧确认、连续3帧恢复后的数字结果。
- 安全目标：继电器关闭、RGB蓝红、蜂鸣器`intermittent`。
- 水滴不启动无关风扇，也不移动无关舵机。
- 与其他风险同时存在时，继电器始终保持关闭，全部原因都必须可见。

### 7.4 安全输入失效或过期

- MQ2、水滴或火焰任一安全输入无效或超过快速输入新鲜度上限时，加入`safety_sensor_fault`。
- 快速输入新鲜度上限使用`FAST_SAFETY_STALE_MS=1500`，约为三个遥测周期；它是软件失效保护常量，不是传感器阈值标定值。
- 故障状态不能显示“安全”或“正常”。
- 停止普通自动目标：风扇0、舵机`hold`、继电器关闭、RGB灰色、蜂鸣器关闭。
- 数据断开或拔掉传感器不能被当作风险恢复。
- 某项风险已经确认后，如果对应输入失效，保留原风险原因并同时加入`safety_sensor_fault`；只有该输入恢复有效并完成连续安全恢复序列，才允许清除原风险。

### 7.5 逐执行器冲突规则

| 执行器 | 冲突规则 |
| --- | --- |
| 风扇 | 火焰0优先；否则MQ2为100%；否则安全传感器故障为0；再否则使用普通目标。 |
| 舵机 | 火焰`safety-closed`优先；否则MQ2为`ventilation-open`；否则故障为`hold`；再否则使用普通目标。 |
| 继电器 | 任一已确认风险或安全传感器故障都强制关闭。 |
| RGB | 火焰或MQ2风险为红色；仅水滴风险时为蓝红；无风险但有故障时为灰色；无风险和故障但MQ2仍预热时为黄色；否则使用普通目标。 |
| 蜂鸣器 | 已确认风险按规则请求声音；显式静音后目标为`off`，但风险和其他保护动作不变。安全传感器故障本身不伪装成燃气、漏水或火焰报警声。 |

## 8. 静音与手动命令

`buzzerEnabled`默认保持`true`。

- `set.buzzerEnabled=false`表示用户明确静音安全报警声。
- 静音只让最终`buzzerMode`变为`off`。
- 静音不删除`alerts`、`safety.causes`、继电器保护、RGB提示、风扇或舵机安全目标。
- `actuator.buzzer=false`只停止手动或测试声音，不能修改`buzzerEnabled`。

在本阶段未武装状态下，任何`actuator`命令都不得保存为手动目标，也不得返回成功：

```json
{"type":"ack","id":"cmd-005","ok":false,"error":"actuators_unarmed"}
```

六种模式命令继续正常工作，因为它们只改变逻辑规划输入，不代表执行器已经动作。

命令校验顺序固定为：JSON格式、命令ID、消息类型、命令结构、字段和值域、武装状态。这样，未知执行器或非法值返回`invalid_actuator_command`；只有结构和值域正确的执行器命令才返回`actuators_unarmed`。

阶段4只识别以下手动执行器字段：

```text
fan: 0~100整数
servo: study | rest | ventilation-open | energy | safety-closed
relay: true | false
buzzer: true | false
rgb: off | study | orange | blue-low | cyan | red | blue-red
```

不接受GPIO编号、任意舵机角度、底层PWM或未列出的RGB值。一个`command`只能包含`mode`、`set`或`actuator`中的一种操作；混合多个操作返回`unsupported_command`。`set.buzzerEnabled`只接受布尔值，它是逻辑配置，即使执行器未武装也可以返回成功并在后续遥测中体现。

## 9. 串口协议扩展

### 9.1 hello

`hello.firmware`升级为`0.3.0`，并增加诚实能力说明：

```json
{
  "type": "hello",
  "project": "smartlife-junior-context",
  "profileId": "smartlife-junior-context-detective-v1",
  "firmware": "0.3.0",
  "features": {
    "contextReasoning": true,
    "safetyReasoning": true,
    "actuatorPlanning": true,
    "physicalActuators": false,
    "webVoiceIntent": true,
    "localVoiceNlu": false,
    "mcp": false
  }
}
```

### 9.2 telemetry

阶段4真固件遥测必须同时包含计划目标、实际状态、安全结果和健康状态：

```json
{
  "type": "telemetry",
  "project": "smartlife-junior-context",
  "firmware": "0.3.0",
  "mode": "detect",
  "actuatorTargets": {
    "fanPercent": 0,
    "servoPosition": "hold",
    "relayOn": false,
    "buzzerMode": "off",
    "rgbState": "off"
  },
  "actuators": {
    "fanPercent": null,
    "servoAngle": null,
    "relayOn": null,
    "buzzerOn": null,
    "rgbState": null
  },
  "alerts": [],
  "safety": {
    "state": "normal",
    "primary": "none",
    "causes": [],
    "overrideActive": false,
    "buzzerRequested": false,
    "buzzerMuted": false
  },
  "health": {
    "stage": "stage4-actuator-safety-software",
    "sensorsReady": true,
    "contextReady": true,
    "safetyReady": true,
    "actuatorsArmed": false,
    "actuatorsReady": false,
    "actuatorApplyState": "unarmed",
    "hardwareVerified": false,
    "calibrationRequired": true,
    "thresholdProfile": "provisional-unverified"
  }
}
```

字段含义固定为：

- `actuatorTargets`：软件最终希望执行的动作。
- `actuators`：驱动层实际应用结果；未武装时全部为`null`。
- `alerts`：全部已确认的`mq2`、`water`和`flame`风险代码，不包含MQ2预热或`safety_sensor_fault`；传感器故障通过`safety.causes`和`safety.state`显示。
- `safety`：安全判断与覆盖原因。
- `safetyReady=true`：纯软件安全引擎已通过测试，不代表安全传感器已经完成实物标定。
- `actuatorsReady=false`：物理执行器尚未启用或验收。

### 9.3 ack错误合同

| 情况 | `error` |
| --- | --- |
| 无法解析JSON | `invalid_json` |
| 缺少命令ID | `missing_id` |
| 未知消息类型 | `unsupported_type` |
| 未知模式 | `unsupported_mode` |
| 未知执行器、未知字段或参数越界 | `invalid_actuator_command` |
| 执行器总闸关闭 | `actuators_unarmed` |
| 其他未支持命令 | `unsupported_command` |

有ID的命令必须返回相同ID。无ID或无法解析时返回`id:null`，不得使用空字符串伪装有效命令ID，也不得静默成功。

## 10. mock与Dashboard边界

mock仍用于协议和界面开发，所有帧继续显式带：

```text
mock=true
source=mock-board
```

mock可以同时提供`actuatorTargets`和模拟后的`actuators`，但Dashboard必须标注“模拟计划”和“模拟执行”。它不能据此显示“真板执行器已动作”。

真固件且`actuatorsArmed=false`时，Dashboard必须：

- 展示安全引擎判断和`actuatorTargets`。
- 把`actuators`显示为“未武装/未应用”，而不是“设备已关闭”。
- 保留`hardwareVerified=false`和`calibrationRequired=true`提示。
- 执行器按钮可以展示，但发送后必须显示同ID的`actuators_unarmed`失败确认。
- 不因WebSocket连接、页面渲染或旧遥测而显示真板在线。

本阶段只做支撑上述合同的最小Dashboard改动，不扩展阶段6的历史、视觉动效或公网功能。

## 11. 实现文件边界

阶段4实施必须新增：

```text
firmware/include/safety_engine.h
firmware/src/safety_engine.cpp
firmware/include/actuator_planner.h
firmware/src/actuator_planner.cpp
firmware/include/actuator_driver.h
firmware/src/actuator_driver.cpp
tools/test_safety_engine.py
tools/test_actuator_planner.py
```

阶段4实施必须修改：

```text
firmware/include/project_config.h
firmware/include/project_types.h
firmware/src/main.cpp
tools/test_firmware_contract.py
tools/n16r8_gateway.py
tools/test_gateway.py
dashboard/context-core.js
dashboard/app.js
dashboard/tests/*.test.js
AGENTS.md
开发文档.md
```

阶段4不新增`dashboard/actuator-core.js`；计划动作与实际动作的规范化继续放在现有`dashboard/context-core.js`并由Node纯函数测试覆盖。不得借阶段4重构无关页面或接入公网服务。

## 12. 测试设计

实施时严格按以下顺序：先增加测试并确认因缺少实现而失败，再实现最小代码，然后运行全部回归。

### 12.1 SafetyEngine主机测试

复用`tools/test_context_engine.py`使用本机C++编译器编译纯C++模块的方式，至少覆盖：

1. MQ2预热不产生`alerts`和安全动作。
2. MQ2预热结束后三帧超限才确认。
3. MQ2单帧恢复不解除，连续三帧恢复才清除。
4. 水滴只覆盖继电器、RGB和蜂鸣器，不启动风扇或舵机。
5. 火焰确认后风扇为0、舵机为`safety-closed`。
6. MQ2与火焰同时触发时保留两个原因且火焰动作获胜。
7. 水滴与其他风险同时存在时全部原因可见且继电器关闭。
8. 安全输入失效或过期进入`sensor_fault`，不能输出正常。
9. 明确静音不删除风险或非声音保护动作。

### 12.2 ActuatorPlanner主机测试

至少覆盖：

- 六种模式的普通目标。
- DHT无效时不继续通风自动目标。
- 普通目标被安全目标逐执行器覆盖。
- 自定义模式在阶段5前保持安全空闲。
- 计划目标与实际应用结果不混用。

### 12.3 固件静态契约

扩展`tools/test_firmware_contract.py`，检查：

- 13个GPIO不变。
- `FIRMWARE_VERSION="0.3.0"`。
- 全局和五个独立武装开关默认都是`false`。
- 未武装分支阻止执行器GPIO初始化、舵机attach和RGB初始化。
- `actuatorTargets`、`actuators`、`alerts`、`safety`和阶段4健康字段存在。
- `safetyReady=true`与`actuatorsReady=false`同时存在且语义不混淆。
- `buzzerEnabled`与手动蜂鸣命令分离。
- 错误命令返回稳定错误代码和正确ID。

### 12.4 mock和Dashboard测试

- mock继续显式标记来源。
- mock安全场景同时产生风险、计划目标和模拟实际状态。
- Dashboard区分模拟执行、真板计划动作和真板实际状态。
- 未武装执行器命令显示`actuators_unarmed`。
- 旧遥测仍按3500ms过期，不能保留旧安全结论。
- 阶段1至阶段3已有模式、证据和WebSocket测试继续通过。

### 12.5 验证命令

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git diff --check
git status --short --branch
```

只有命令实际通过才能记录成功。不得运行`pio run -t upload`、`write_flash`、`erase_flash`、串口监视或任何Flash操作。

## 13. 阶段4软件验收标准

本阶段完成必须同时满足：

- [ ] 新测试先出现预期失败，再在实现后通过。
- [ ] SafetyEngine关键风险、恢复、冲突、静音和失效路径均有自动化测试。
- [ ] ActuatorPlanner普通目标和安全覆盖均有纯C++测试。
- [ ] 所有Python和Node回归测试通过。
- [ ] PlatformIO纯编译显示`[SUCCESS]`。
- [ ] 串口JSON仍保持一行一个完整对象。
- [ ] `actuatorTargets`与`actuators`明确分离。
- [ ] 未武装时没有执行器GPIO初始化或写入。
- [ ] 健康字段保持`safetyReady=true`、`actuatorsArmed=false`、`actuatorsReady=false`、`hardwareVerified=false`、`calibrationRequired=true`。
- [ ] mock和Dashboard没有把模拟或计划目标冒充真板实际动作。
- [ ] `git diff --check`通过，用户已有无关文件未被修改或提交。
- [ ] 没有执行上传、Flash读写、擦除或串口操作。

## 14. 后续真板门槛

阶段4软件验收完成后，仍需用户再次明确授权，才进入执行器真板验证。未来顺序固定为：

1. 确认私密Flash备份和当前PIO分区安全。
2. 断开全部执行器，烧录并确认单行JSON协议。
3. 打开`ACTUATORS_ARMED`总闸，但保持五个独立开关关闭。
4. 按RGB、蜂鸣器、继电器、舵机、风扇的低风险到高负载顺序，一次只启用一个模块。
5. 每个模块验证上电默认状态、有效电平、供电、共地、实际动作和遥测一致性。
6. 舵机角度、风扇有效电平、继电器逻辑、RGB亮度、蜂鸣器模式逐项写回配置和文档。
7. 全部实物证据完成前，不把`hardwareVerified`改为`true`。

真板阶段必须继续遵守：继电器只接低压负载、MQ2 AO不超过3.3V、外部电源共地、不使用真实燃气、危险烟雾或明火。

## 15. 已确认决策摘要

- 采用“软件先行、执行器默认未武装、以后逐个启用”的方案。
- 采用SafetyEngine、ActuatorPlanner、ActuatorDriver三层隔离架构。
- 安全目标永远优先于普通情境和手动目标。
- MQ2、水滴、火焰可以同时保留风险原因；优先级只解决动作冲突。
- 火焰覆盖MQ2排风，火焰确认后风扇必须停止。
- 显式静音只关闭声音，不解除风险和保护动作。
- 遥测区分计划动作与实际动作；未武装时实际动作不可用。
- 阶段4只做测试、实现和PIO纯编译，不烧录。
