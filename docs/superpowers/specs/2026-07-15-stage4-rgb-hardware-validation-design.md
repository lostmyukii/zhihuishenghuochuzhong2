# 阶段4 GPIO46 RGB灯环真板验收设计规格

> 项目：N16R8 无摄像头家庭情境侦探屋
>
> project：`smartlife-junior-context`
>
> profileId：`smartlife-junior-context-detective-v1`
>
> 规格日期：2026-07-15
>
> 规格状态：整圈A1/A2机器证据均通过但用户未见亮灯；单颗高可见度诊断A3已获用户批准，书面修订待复核
>
> 实施边界：只新增GPIO46 RGB灯环真板验收；蜂鸣器保持静音，风扇、舵机和继电器继续未武装

## 1. 已确认前提

- 用户已明确授权本轮GPIO46 RGB灯环的软件修改、应用区烧录、串口采样和低压实物测试。
- RGB灯环为12颗灯珠，三根线全部接在拓展板`GPIO46`端口的`V-G-S`，由该端口供电和提供数据信号。
- 相邻已验证工程使用同一GPIO46、12颗WS2812/NeoPixel兼容灯珠以及`NEO_GRB + NEO_KHZ800`；这些参数只作为本轮起始配置，必须以当前实物亮灯结果验收。
- 主板当前运行候选固件`0.3.2-rc2`；GPIO13有源蜂鸣器已经完成上电静音、800ms短鸣、自动停止和真板验收。
- 首轮RGB命令两次都取得同ID成功回执，串口分别在约815ms和840ms后由`cyan`恢复为`off`，但用户均未看到灯环亮起，因此GPIO46仍未通过实物验收。
- 第二轮`0.3.2-rc2`以`24 / 255`青色驱动整圈约2.99秒，回执、遥测和自动关闭仍正常，用户仍未看到灯环亮起；不再提高整圈亮度。
- 首轮失败后已复核灯环端标记为`G-V-S0`、拓展板端为`G-V-S`，信号连接在`S0`输入端，未发现线序或数据方向错误。
- 本项目PIO应用偏移固定为`0x10000`。本轮不得执行全片擦除，不得写入错误的`0x400000`地址，也不得改写bootloader、分区表、NVS、Wi-Fi或小智激活数据。
- 本轮不使用真实燃气、危险烟雾或明火制造安全情境，也不把传感器风险结果直接映射到灯环。

GPIO13蜂鸣器可以保持已验收连接状态，但本轮不得发送蜂鸣器动作命令。风扇`GPIO11`、舵机`GPIO9`和继电器`GPIO12`继续保持未武装、未验收。

## 2. 方案比较与已选方案

### A1：全环`8 / 255`低亮青色800ms（首轮未通过视觉验收）

- 上电和复位时12颗灯珠全部熄灭，不运行启动灯效。
- 只在收到带ID的标准串口白名单命令后，将12颗灯珠设为青色。
- 全局亮度为`8 / 255`，点亮窗口为`800ms`。
- 固件、回执、遥测和自动关闭全部正常，但用户两次均未看到可见亮灯，不能据此标记硬件通过。

### A2：全环`24 / 255`低亮青色3秒（修订后已选）

- 上电和复位继续全灭，不运行启动灯效。
- 收到带ID的标准白名单命令后，12颗灯珠以`24 / 255`青色显示`3000ms`。
- 到期后由非阻塞计时器自动清空并刷新灯环；`rgb=off`可以提前立即熄灭。
- 本轮不把情境计划或安全覆盖中的`red`、`blue-red`等状态自动应用到实物。

该修订仍属于低亮短时测试，比首轮更容易被肉眼观察；若仍无可见输出，则停止继续提高亮度，转为检查灯环供电、模块协议或GPIO46实际数据波形。

### A3：只点第1颗红灯的高可见度诊断（当前已选）

- 上电和复位继续全灭。
- 收到`rgb=red`标准命令后，只设置索引0的第1颗灯珠，其余11颗保持关闭。
- 单颗红灯亮度为`128 / 255`，持续`5000ms`后自动熄灭，`rgb=off`可以提前关闭。
- 单颗输出比整圈青色更容易观察，同时不扩大为整圈高亮。
- 该动作只判断“灯环供电、数据输入和第1颗像素是否能产生可见输出”，不能据此验收整圈12颗灯珠。

若A3仍无可见输出，停止继续修改颜色、亮度和时长，转入VCC-GND电压测量、GPIO46波形检查或更换已知良好灯环。

### B：只点亮1颗灯珠（未选）

电流更低，但不能证明全部12颗灯珠都能收到数据，不适合作为本轮完整灯环验收结论。

### C：依次显示红、绿、蓝（未选）

可以分别验证三个颜色通道，但动作更长、代码和观察项更多。用户已明确本阶段不需要测得过细，因此不作为首次验收方案。

## 3. 电气与安全合同

1. 固定使用`PIN_RGB = 46`、12颗灯珠、`NEO_GRB + NEO_KHZ800`起始配置，不改变既定GPIO表。
2. 固定使用`Adafruit_NeoPixel`现有依赖，不新增另一套灯带驱动库。
3. A3只允许第1颗红灯使用`128 / 255`，其余11颗必须清空；不得把该亮度应用到整圈，也不得使用白色满亮输出。
4. 初始化必须完成`begin()`后立即`clear()`并`show()`，使灯环进入明确的全灭状态；不得在`setup()`中自动点亮。
5. RGB灯环是本轮唯一新增初始化的执行器。GPIO11、GPIO9和GPIO12不得调用输出初始化、PWM、舵机`attach`或继电器写入。
6. GPIO13蜂鸣器保留已经验证的安全低电平和独立驱动，但本轮不触发短鸣，不把RGB动作与蜂鸣器联动。
7. 如果灯环持续高亮、颜色异常、闪烁不止、主板反复重启、USB掉线或模块异常发热，立即拔下USB并停止测试。
8. 本轮通过仅证明低亮青色短时输出，不证明满亮电流、全部颜色通道、长期灯效或安全报警灯效已经验收。

## 4. 软件边界与状态机

### 4.1 独立武装与验证开关

候选验收固件使用以下真实状态：

```cpp
constexpr bool ACTUATORS_ARMED = true;
constexpr bool BUZZER_ARMED = true;
constexpr bool BUZZER_HARDWARE_VERIFIED = true;
constexpr bool FAN_ARMED = false;
constexpr bool SERVO_ARMED = false;
constexpr bool RELAY_ARMED = false;
constexpr bool RGB_ARMED = true;
constexpr bool RGB_HARDWARE_VERIFIED = false;
```

并加入固定测试参数：

```cpp
constexpr uint8_t RGB_LED_COUNT = 12;
constexpr uint8_t RGB_TEST_ACTIVE_PIXELS = 1;
constexpr uint8_t RGB_TEST_BRIGHTNESS = 128;
constexpr uint32_t RGB_TEST_PULSE_MS = 5000;
```

`RGB_ARMED=true`只允许进入受限的真板验收驱动，不等于当前实物已经通过。只有用户亲眼确认整圈低亮青色显示并自动熄灭后，最终固件才能把`RGB_HARDWARE_VERIFIED`改为`true`。

### 4.2 RGB验证状态

```text
boot -> idle-off
idle-off + rgb=red -> pulse-first-red
pulse-first-red + 5000ms到期 -> idle-off
pulse-first-red + rgb=off -> idle-off
```

- 使用`millis()`计算截止时间，不在主循环中使用`delay(800)`。
- 重复收到`rgb=red`时可以重新开始一次5000ms窗口，但不能变成无限持续亮灯。
- `rgb=off`具有即时关闭优先级。
- 上电、复位、模式切换、情境重算、传感器告警、MQ2预热和普通遥测都不能启动RGB测试脉冲。
- A3只把`red`和`off`映射到物理诊断驱动。其他逻辑RGB状态继续保留在`actuatorTargets`中，不得静默当作真实硬件动作成功。

### 4.3 驱动职责

`ActuatorDriver`是唯一可以控制GPIO13和GPIO46物理输出的模块。RGB部分至少提供：

- `begin(nowMs)`：保持蜂鸣器静音，并初始化灯环为全灭。
- `requestRgbTestPulse(nowMs)`：清空整圈后只设置第1颗红灯，并启动或刷新5000ms窗口。
- `stopRgb()`：立即清空12颗灯珠并刷新。
- `tick(nowMs)`：非阻塞处理蜂鸣器和RGB各自的到期关闭。
- `result()`：如实返回蜂鸣器和RGB的当前物理状态，以及部分武装状态。

`main.cpp`只负责命令校验、调用驱动和序列化协议，不直接操作NeoPixel或GPIO46。`ActuatorPlanner`和`SafetyEngine`仍只产生逻辑目标，不得自动调用本轮验证驱动。

## 5. 串口协议与诚实状态

### 5.1 测试命令

启动低亮青色短脉冲：

```json
{"type":"command","id":"rgb-test-1","actuator":{"rgb":"red"}}
```

预期同ID成功确认：

```json
{"type":"ack","id":"rgb-test-1","ok":true,"applied":{"rgbState":"red","rgbPulseMs":5000,"rgbBrightness":128,"rgbPixels":1,"rgbRingPixels":12}}
```

立即关闭：

```json
{"type":"command","id":"rgb-off-1","actuator":{"rgb":"off"}}
```

关闭确认必须保留同一ID并报告`rgbState=off`。其他已知但尚未开放实物映射的RGB状态固定返回同一ID和`rgb_test_state_only`，不得静默成功；风扇、舵机和继电器命令继续返回`actuators_unarmed`。

### 5.2 `hello`和`telemetry`

- `features.physicalActuators`继续为`false`。
- `features.physicalBuzzer=true`继续保留，并新增`features.physicalRgb=true`。
- `health.actuatorsArmed=true`，但`health.actuatorsReady=false`。
- `health.buzzerArmed=true`、`health.buzzerHardwareVerified=true`保持真实。
- `health.rgbArmed=true`；人工确认前`health.rgbHardwareVerified=false`。
- `health.fanArmed/servoArmed/relayArmed`全部为`false`。
- `health.hardwareVerified=false`、`health.calibrationRequired=true`继续保持。
- `health.actuatorApplyState`使用明确的部分状态`partial-buzzer-rgb-test`，不得显示为整组执行器已应用。

实际状态示例：

```json
"actuators": {
  "fanPercent": null,
  "servoAngle": null,
  "relayOn": null,
  "buzzerOn": false,
  "rgbState": "cyan"
}
```

`rgbState`只在GPIO46实际处于5000ms单颗红灯输出窗口时为`red`，自动关闭后必须恢复为`off`。Dashboard不得从`actuatorTargets.rgbState`推断灯环真实亮起。

人工确认通过后，只更新RGB单项验证状态；不得把整机`hardwareVerified`或全部`actuatorsReady`改为`true`。

## 6. 测试先行要求

实现前先更新测试，并确认旧实现因缺少RGB物理驱动而失败。至少覆盖：

1. GPIO46、12颗灯珠、`NEO_GRB + NEO_KHZ800`、第1颗索引0和单颗亮度`128 / 255`固定不变。
2. RGB独立开关开启、候选固件验证值为`false`，风扇、舵机和继电器开关保持关闭。
3. 灯环初始化后立即执行全灭刷新，不产生启动灯效。
4. GPIO11、GPIO9和GPIO12没有初始化或写入。
5. `rgb=red`只设置第1颗并产生5000ms窗口，返回同ID成功`ack`及活动灯珠数1、总灯珠数12。
6. 到期后自动全灭，且实现不包含阻塞式`delay(5000)`。
7. `rgb=off`可以立即熄灭。
8. 其他RGB状态不会被当作物理成功，其他未武装执行器仍被明确拒绝。
9. `actuators.rgbState`真实反映`cyan/off`窗口，蜂鸣器保持`false`，其余三个实际字段继续为`null`。
10. `physicalActuators=false`、`actuatorsReady=false`、`hardwareVerified=false`保持真实。
11. 现有GPIO13蜂鸣器的上电静音、800ms短鸣和停止测试全部继续通过。
12. 原有传感器、SafetyEngine、ActuatorPlanner、网关和Dashboard回归测试继续通过。
13. PIO编译成功，且使用固定N16R8板卡、CH340构建标志和`default_16MB.csv`分区合同。

RGB计时和状态逻辑应尽量使用可在本机C++测试中注入假的`nowMs`的纯逻辑控制器；不通过真实等待5000ms验证核心状态机。

## 7. 编译、烧录与真板验收顺序

1. 先写契约测试并证明旧实现不能满足RGB验收合同。
2. 实现最小RGB验证驱动，运行Python、Node和本机C++测试。
3. 运行`pio run -d firmware -j1`并确认编译成功。
4. 使用`git diff --check`和`git status --short --branch`复核，仅处理本轮文件。
5. 诊断候选版本使用`0.3.2-rc3`，只写入PIO应用区`0x10000`；不擦除Flash，不改写bootloader、分区表或NVS。
6. 对写入后的实际应用段执行摘要校验。
7. 复位并观察：RGB必须保持全灭、蜂鸣器保持静音，串口持续输出正确`hello/telemetry`。
8. 发送一次`rgb=red`，用户观察是否只有第1颗红灯明显亮起，并在约5秒后自动熄灭。
9. 发送一次`rgb=off`，确认灯环保持熄灭。
10. 串口确认同ID成功`ack`，并观察`actuators.rgbState`由`cyan`自动恢复为`off`。
11. 用户人工确认通过后，将RGB单项验证值改为`true`，版本定为`0.3.2`；重新运行全量测试、PIO编译并仅更新应用区。
12. 最终复位确认上电全灭、蜂鸣器静音、串口身份和单项验证状态正确。

本轮不执行`erase_flash`，不写入`0x400000`，不覆盖或提交私密Flash备份，也不触碰Wi-Fi及小智激活数据。

## 8. 通过、停止与回退条件

### 8.1 通过条件

- 上电、复位和普通遥测期间12颗灯珠全部保持熄灭。
- A3标准命令使第1颗红灯明显亮起，并在约5秒后自动熄灭；该结果只表示诊断通过，不表示整圈验收通过。
- 关闭命令可以即时清空灯环。
- 蜂鸣器全程静音，风扇、舵机和继电器无动作。
- 串口、传感器遥测和USB供电保持稳定。
- 同ID命令回执、真实RGB状态、自动关闭状态均可在串口中观察。
- 自动化测试、PIO编译和应用段校验全部通过。

### 8.2 立即停止条件

- 上电自动亮灯、5秒后没有熄灭、超过1颗灯珠高亮或出现持续闪烁。
- 灯环不是低亮青色、只有部分灯珠异常显示，或其他执行器发生动作。
- USB端口消失、反复重连、主板重启或遥测中断。
- 灯环、拓展板、USB线或主板出现异常发热、气味或供电不稳。

发生上述情况时立即拔下USB。软件回退为`RGB_ARMED=false`并恢复已知良好的`0.3.1`应用；先检查线序、灯珠协议和供电，再决定是否重新验收，不扩大到其他执行器。

## 9. 本轮完成后的真实表述

如果A3出现可见红灯，可以表述：

> GPIO46已完成单颗红灯高可见度诊断，证明当前供电、数据输入和第1颗像素可以产生可见输出；整圈12颗灯珠仍待后续验收。

如果A3仍无可见输出，只能表述：

> RGB命令回执、遥测计时和自动关闭软件链路正常，但灯环未产生可见输出；需继续检查供电、信号波形、模块协议或灯环本体。

仍不能表述：

- 五个执行器已经全部验收。
- GPIO46整圈12颗灯珠已经验收。
- RGB全部颜色、满亮输出或长期灯效已经验收。
- RGB已经接入自动情境和安全报警实物联动。
- 整机硬件已经验证完成。
- 风扇、舵机或继电器已经可用。

下一项仍按“一次只新增一个独立武装开关”的原则进行。
