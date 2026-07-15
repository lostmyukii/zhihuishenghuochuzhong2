# 阶段4 GPIO13有源蜂鸣器真板验收设计规格

> 项目：N16R8 无摄像头家庭情境侦探屋
>
> project：`smartlife-junior-context`
>
> profileId：`smartlife-junior-context-detective-v1`
>
> 规格日期：2026-07-15
>
> 规格状态：A方案和书面规格已由用户确认，等待按实施计划执行
>
> 实施边界：只验收GPIO13有源蜂鸣器；风扇、舵机、继电器和RGB继续保持未武装

## 1. 已确认前提

- 用户已把有源蜂鸣器接到拓展板`GPIO13`端口，接线为`V-G-S`。
- 用户确认当前固件运行时蜂鸣器保持静音。
- 2026-07-15真板会话已经完成整片16MB Flash私密备份、首次PIO完整上传、四段摘要校验以及`hello/telemetry/ack`串口验证。
- 当前主板运行本项目PIO固件`0.3.0`，PIO应用偏移为`0x10000`；本规格不改变板卡、分区表或13个固定GPIO。
- MQ2、火焰或其他安全输入不得使用真实燃气、危险烟雾或明火触发。

当前物理执行器仍只有蜂鸣器接入。风扇`GPIO11`、舵机`GPIO9`、继电器`GPIO12`和RGB`GPIO46`必须继续断开。

## 2. 方案比较与已选方案

### A：上电静音、命令触发150ms短鸣（已确认）

- GPIO13按高电平有效的起始假设实现。
- 上电先写安全低电平，再切换为输出，禁止启动自检声。
- `actuator.buzzer=true`只触发一次约`150ms`的非阻塞短鸣，然后自动回到静音。
- `actuator.buzzer=false`立即停止尚未结束的短鸣。
- 本轮不把安全引擎的`alarm`或`intermittent`目标直接映射到实物，避免未完成风险阈值复核时持续鸣叫。

优点是启动风险最低、现场现象明确，并能单独证明GPIO13、电平和协议闭环。代价是本轮只验收蜂鸣器硬件输出，不验收最终安全报警节奏。

### B：命令控制连续开关（未选）

`true`持续响、`false`停止。它便于观察，但串口中断或命令未送达时可能持续鸣叫，不适合作为第一次武装行为。

### C：每次上电自动鸣叫（未选）

启动自检可以快速发现模块，但违背本项目“上电物理静音”的固定安全合同，也会让烧录、复位和串口重连产生不必要声音。

## 3. 安全与电气合同

1. 仅使用拓展板`GPIO13`的`V-G-S`三针口，不改变线序。
2. 首次实现使用`LOW=静音、HIGH=鸣叫`的起始假设。该假设只有在真板短鸣通过后才能标记为已验证。
3. 初始化顺序固定为先锁存`LOW`，再把GPIO13设为输出，禁止先输出高电平或在`setup()`中鸣叫。
4. 如果上传或复位后蜂鸣器持续响，立即拔下USB，不继续发送命令；该结果判定为电平假设不成立或接线异常。
5. 蜂鸣器是本轮唯一允许初始化的执行器。GPIO9、GPIO11、GPIO12和GPIO46不得调用输出初始化、PWM、舵机`attach`或NeoPixel初始化。
6. 本轮不使用安全传感器制造真实风险，也不以一次短鸣代替最终报警模式验收。

## 4. 软件边界与状态机

### 4.1 武装开关

实现后配置状态为：

```cpp
constexpr bool ACTUATORS_ARMED = true;
constexpr bool BUZZER_ARMED = true;
constexpr bool FAN_ARMED = false;
constexpr bool SERVO_ARMED = false;
constexpr bool RELAY_ARMED = false;
constexpr bool RGB_ARMED = false;
```

`ACTUATORS_ARMED=true`只表示物理驱动总边界已打开；每个模块仍必须通过独立开关。不得据此初始化或宣称其他执行器可用。

### 4.2 蜂鸣器验证状态

驱动维护以下最小状态：

```text
boot/unarmed -> idle-silent
idle-silent + buzzer=true -> pulse-active
pulse-active + 150ms到期 -> idle-silent
pulse-active + buzzer=false -> idle-silent
```

- 使用`millis()`计算截止时间，不在主循环中使用`delay(150)`。
- 重复的`buzzer=true`可以重新开始一次150ms窗口，但不会变成持续鸣叫。
- `buzzer=false`具有即时停止优先级。
- 上电、模式切换、MQ2预热和普通遥测都不能自动启动验证短鸣。
- 本轮`ActuatorPlanner`产生的`alarm/intermittent`继续只作为`actuatorTargets`逻辑计划，不由验证驱动物理执行。

### 4.3 驱动职责

`ActuatorDriver`是唯一可以接触GPIO13的模块，至少提供：

- `begin(nowMs)`：建立GPIO13安全静音状态。
- `requestBuzzerPulse(nowMs)`：启动或刷新150ms短鸣窗口。
- `stopBuzzer()`：立即静音。
- `tick(nowMs)`：非阻塞处理到期自动静音。
- `result()`：返回当前物理蜂鸣器状态和部分武装状态。

`main.cpp`只负责命令解析、调用驱动和序列化协议，不直接调用`pinMode`或`digitalWrite`。

## 5. 串口协议与诚实状态

### 5.1 命令

开始短鸣：

```json
{"type":"command","id":"buzzer-test-1","actuator":{"buzzer":true}}
```

预期成功确认：

```json
{"type":"ack","id":"buzzer-test-1","ok":true,"applied":{"buzzerPulseMs":150}}
```

立即停止：

```json
{"type":"command","id":"buzzer-stop-1","actuator":{"buzzer":false}}
```

预期成功确认必须保留同一ID，并说明蜂鸣器已关闭。风扇、舵机、继电器和RGB的合法命令仍返回`actuators_unarmed`。

### 5.2 `hello`和`telemetry`

全局能力不得伪装为全部执行器可用：

- `features.physicalActuators`继续为`false`。
- 新增或保留可单独表达的`features.physicalBuzzer=true`。
- `health.actuatorsArmed=true`，但`health.actuatorsReady=false`。
- `health.buzzerArmed=true`；真板短鸣人工确认前`health.buzzerHardwareVerified=false`。
- `health.fanArmed/servoArmed/relayArmed/rgbArmed`全部为`false`。
- `health.hardwareVerified=false`、`health.calibrationRequired=true`继续保持。
- `health.actuatorApplyState`使用明确的部分状态，例如`partial-buzzer-test`，不得显示为全部`applied`。

实际状态字段：

```json
"actuators": {
  "fanPercent": null,
  "servoAngle": null,
  "relayOn": null,
  "buzzerOn": true,
  "rgbState": null
}
```

`buzzerOn`只在GPIO13实际为鸣叫电平时为`true`，自动关闭后必须为`false`；其他四项继续为`null`。Dashboard不得从`actuatorTargets.buzzerMode`推断真实声音。

人工确认通过后，只把蜂鸣器单项验收状态写入文档和健康字段；不得把整机`hardwareVerified`或全部`actuatorsReady`改为`true`。

## 6. PlatformIO串口稳定性修正

当前真板已经证明CH340在PlatformIO Monitor默认拉起RTS/DTR时可能保持复位；手动把DTR和RTS切换为inactive后才出现`hello/telemetry`。实现时在`firmware/platformio.ini`加入固定的Monitor控制线安全设置，使后续监视无需人工切换。

```ini
monitor_dtr = 0
monitor_rts = 0
```

该修改只影响串口监视器控制线，不改变上传速度、CH340构建标志、板卡JSON、分区表或应用偏移。

## 7. 测试先行要求

实现前先更新测试，并确认旧实现因缺少蜂鸣器物理驱动而失败。至少覆盖：

1. GPIO13仍是唯一蜂鸣器端口。
2. 总闸和蜂鸣器独立开关开启，其他四个独立开关保持关闭。
3. `ActuatorDriver`安全顺序为先写`LOW`再将GPIO13设为输出。
4. 其他执行器GPIO没有初始化或写入。
5. `buzzer=true`产生150ms窗口并返回同ID成功`ack`。
6. 到期后自动静音，且实现不包含阻塞式`delay(150)`。
7. `buzzer=false`立即停止。
8. 其他执行器命令仍返回`actuators_unarmed`。
9. `buzzerOn`真实反映物理窗口，其他执行器实际值继续为`null`。
10. `physicalActuators=false`、`actuatorsReady=false`、`hardwareVerified=false`保持真实。
11. PlatformIO Monitor固定DTR/RTS为inactive。
12. 原有SafetyEngine、ActuatorPlanner、网关和Dashboard测试继续通过。

驱动计时逻辑应可在本机C++测试中使用假的`nowMs`验证，不依赖真实等待150ms。

## 8. 编译、上传与真板验收顺序

1. 运行Python、Node和驱动原生测试，确认全部通过。
2. 运行`pio run -d firmware -j1`，确认编译成功。
3. 保持只有蜂鸣器接入，其他执行器断开。
4. 因主板已经运行同一板卡、同一分区表的PIO基线，本轮只更新`0x10000`应用，不重写bootloader、分区表或NVS，也不执行全片擦除。
5. 写入后对`0x10000`实际应用段运行摘要校验。
6. 复位并观察：蜂鸣器必须保持静音，串口持续输出正确`hello/telemetry`。
7. 发送一次`buzzer=true`，用户确认只听到一次约150ms短鸣且自动停止。
8. 发送`buzzer=false`，确认保持静音。
9. 观察后续遥测，确认`buzzerOn`由`true`自动恢复为`false`，其他执行器实际字段仍为`null`。
10. 记录一次同ID成功`ack`和一次其他执行器`actuators_unarmed`拒绝证据。

本轮不执行`erase_flash`，不写入`0x400000`，不触碰私密Flash备份、Wi-Fi或小智激活数据。

## 9. 通过、失败与回退条件

### 9.1 通过条件

- 上电和复位均无启动鸣叫。
- 命令只产生一次短鸣，并在约150ms后自动停止。
- 停止命令可以即时静音。
- 串口协议、传感器遥测和USB供电保持稳定。
- GPIO13以外没有执行器被初始化或动作。
- 自动化测试、PIO编译和应用段校验全部通过。

### 9.2 立即停止条件

- 上电持续鸣叫或短鸣无法自动停止。
- USB端口消失、反复重连或出现持续`Device not configured`。
- 主板重启、遥测中断或其他执行器出现动作。
- 蜂鸣器、拓展板、USB线或主板出现异常发热。

发生上述情况时先拔USB并断开蜂鸣器；代码恢复为总闸和蜂鸣器均未武装，重新编译验证后再决定是否反转有效电平或检查接线。

## 10. 本轮完成后的真实表述

通过后可以表述：

> GPIO13有源蜂鸣器已完成上电静音、单次150ms短鸣、自动关闭、停止命令和串口状态真板验收。

仍不能表述：

- 五个执行器全部已验收。
- 安全报警节奏已经实物验收。
- 整机硬件已经验证完成。
- 风扇、舵机、继电器或RGB已经可用。

下一项执行器继续按“一次只接一个、一次只启用一个独立开关”的原则进行。
