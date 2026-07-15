# 阶段4 GPIO46 RGB灯环真板验收实施计划

> **计划状态：** RGB点灯部分已安全收口；GPIO46有源蜂鸣器基础输出诊断A5已获明确烧录授权，待执行后再次恢复`0.3.2`。
>
> **执行要求：** 软件步骤严格执行“先失败测试、再最小实现、再全量回归”；硬件步骤只写PIO应用段`0x10000`并独立校验。任何停止条件出现时立即停在当前检查点。

**目标：** 在不改变正式GPIO合同的前提下，临时禁用蜂鸣器并复用已验收GPIO13端口，以第1颗红灯`128 / 255`、5秒自动熄灭的动作交叉诊断灯环；测试结束后恢复RGB未武装的正式安全固件。

**架构：** 纯C++ `RgbPulseController`只管理5000ms状态窗口；`ActuatorDriver`独占NeoPixel物理输出并只设置索引0；`main.cpp`只校验命令、调度驱动和序列化协议。`ActuatorPlanner`和`SafetyEngine`继续只产生逻辑目标，不自动驱动本轮灯环。

**技术栈：** C++17原生测试、PlatformIO Arduino ESP32-S3、Adafruit NeoPixel 1.15.5、ArduinoJson 7、Python `unittest`、Node.js `node:test`、esptool.py、CH340 UART 115200。

**依据规格：** `docs/superpowers/specs/2026-07-15-stage4-rgb-hardware-validation-design.md`

---

## 0. 已验证基线与权限边界

- 当前`main`和`origin/main`以提交`c09bfd4`为设计检查点。
- 主板当前运行已验证固件`0.3.1`；GPIO13蜂鸣器已验收并保持静音。
- RGB灯环已确认是12颗灯珠，接在拓展板GPIO46端口的`V-G-S`。
- 用户已明确授权本轮软件修改、PIO应用区烧录、串口采样和低压RGB实物测试。
- 用户已有未跟踪文件`评分表.png`，全过程不得修改、暂存或提交。

### 副作用与恢复覆盖

| 动作 | 影响 | 恢复方式 |
| --- | --- | --- |
| 修改代码、测试和文档 | Git跟踪文件 | 以独立提交纠正，不改写历史 |
| PIO编译 | 只更新忽略的`.pio/`产物 | 重新编译即可 |
| 应用区写入 | 只修改Flash `0x10000`应用段 | 写回已知良好的`0.3.1`应用产物 |
| 800ms低亮青色 | GPIO46短时输出 | 自动熄灭、发送`rgb=off`或异常时拔USB |
| 修订3秒低亮青色 | GPIO46以`24 / 255`短时输出 | 自动熄灭、发送`rgb=off`或异常时拔USB |
| 单颗高可见度诊断 | 仅第1颗红灯以`128 / 255`输出5秒 | 自动熄灭、发送`rgb=off`或异常时拔USB |
| GPIO13交叉诊断 | 临时禁用蜂鸣器并把NeoPixel数据输出切到已验收GPIO13 | 只写应用区；完成后写回RGB未武装的正式安全固件 |
| Git推送 | 更新`origin/main` | 追加纠正提交，不强推 |

明确禁止：全片擦除、写入`0x400000`或`0x100000`、改写bootloader/分区表/NVS、修改Wi-Fi或小智激活数据、初始化GPIO11/9/12、提高RGB亮度、真实燃气/烟雾/明火测试。

## 任务6：GPIO13临时交叉诊断A4

1. 在规格中记录：正式`PIN_RGB=46`保持不变，候选固件只通过`RGB_DIAGNOSTIC_PIN=13`临时改变物理输出。
2. 先更新静态合同，要求版本`0.3.2-rc4-pin13-diagnostic`、`BUZZER_ARMED=false`、`RGB_ARMED=true`、诊断引脚13，并确认测试对旧实现失败。
3. 最小实现中让NeoPixel对象使用诊断引脚；健康字段明确报告正式RGB端口46和临时诊断端口13，蜂鸣器命令必须被拒绝。
4. 运行Python、Node、JavaScript语法检查和PIO编译；保存当前应用产物作为私密回退点。
5. 重新枚举CH340，只写并校验PIO应用区`0x10000`，不得写bootloader、分区、NVS或其他地址。
6. 复位后确认候选版本、`physicalBuzzer=false`、`buzzerArmed=false`、`rgbArmed=true`和初始RGB关闭。
7. 只发送一次`rgb=red`，采集同ID回执、红色状态和约5秒自动关闭状态，并由用户报告是否肉眼可见。
8. 无论人工结果如何，发送显式关闭命令并制作/写回RGB未武装的正式安全固件；A4只形成诊断结论，不改变正式GPIO合同。

## 任务1：执行前检查点与恢复产物

1. 运行`git status --short --branch`和`git log -3 --oneline --decorate`，确认远端同步且只有`评分表.png`未跟踪。
2. 只读确认现有私密Flash备份仍存在且未进入Git。
3. 在重新编译覆盖`.pio`产物前，把当前已验证的`0.3.1`应用固件保存为私密恢复产物，记录大小和SHA-256，不在Git中暴露备份内容。
4. 枚举当前CH340串口并检查没有Monitor、网关或Web Serial占用；不在软件开发阶段提前打开或重置端口。

## 任务2：TDD建立RGB脉冲控制器和GPIO46安全驱动

**新增：**

- `firmware/include/rgb_pulse_controller.h`
- `firmware/src/rgb_pulse_controller.cpp`
- `firmware/native_tests/rgb_pulse_controller_test.cpp`
- `tools/test_rgb_pulse_controller.py`

**修改：**

- `firmware/include/project_config.h`
- `firmware/include/project_types.h`
- `firmware/include/actuator_driver.h`
- `firmware/src/actuator_driver.cpp`
- `tools/test_firmware_contract.py`
- `firmware/platformio.ini`

### 2.1 先写失败测试

原生测试覆盖：初始关闭、请求后开启、到期前保持、5000ms自动关闭、重复请求刷新、`stop()`立即关闭和`uint32_t`回绕。

静态合同要求：

- 诊断候选版本为`0.3.2-rc3`。
- `RGB_LED_COUNT=12`、`RGB_TEST_ACTIVE_PIXELS=1`、`RGB_TEST_BRIGHTNESS=128`、`RGB_TEST_PULSE_MS=5000`。
- `RGB_ARMED=true`、`RGB_HARDWARE_VERIFIED=false`；风扇/舵机/继电器仍为`false`。
- 使用`Adafruit_NeoPixel`、`PIN_RGB`、`NEO_GRB + NEO_KHZ800`。
- 初始化执行`begin()`、`setBrightness(128)`、`clear()`、`show()`，不得产生启动灯效。
- 驱动不得引用GPIO11、GPIO9或GPIO12，不得包含`delay(800)`。

先运行目标测试并确认旧实现只因缺少上述能力失败。

### 2.2 最小实现

- `RgbPulseController`保持纯C++，仅提供`requestPulse(nowMs)`、`stop()`、`tick(nowMs)`和`isOn()`。
- `ActuatorDriver`持有12灯NeoPixel对象；`begin()`初始化后立即清空刷新。
- `requestRgbTestPulse()`先清空整圈，只用`Color(255,0,0)`设置索引0并刷新，实际单颗亮度由`setBrightness(128)`限制。
- `stopRgb()`立即清空刷新。
- `tick()`分别处理蜂鸣器和RGB到期，任何一项状态改变都返回`true`，不阻塞主循环。
- `result()`返回`PartialBuzzerRgbTest`、真实`buzzerOn`和真实`rgbState=red/off`。

目标测试通过后，以独立提交保存控制器和驱动基线。

## 任务3：接入命令、协议和Dashboard诚实状态

**修改：**

- `firmware/src/main.cpp`
- `tools/test_firmware_contract.py`
- `dashboard/context-core.js`
- `dashboard/tests/context-core.test.js`
- `dashboard/tests/dashboard-contract.test.js`

### 3.1 先写失败测试

合同至少要求：

- `features.physicalActuators=false`、`physicalBuzzer=true`、`physicalRgb=true`。
- `health.rgbArmed=true`、`rgbHardwareVerified=false`、`actuatorsReady=false`、`hardwareVerified=false`。
- `actuatorApplyState=partial-buzzer-rgb-test`。
- `actuators.rgbState`在真实窗口中为`cyan`，到期后为`off`；蜂鸣器保持真实布尔值，其他三项为`null`。
- `rgb=red`返回同ID成功确认及`5000/128/1/12`四个固定参数。
- `rgb=off`立即关闭并返回同ID成功确认。
- 其他已知RGB状态返回同ID错误`rgb_test_state_only`。
- 风扇、舵机和继电器继续返回`actuators_unarmed`。
- Dashboard在部分武装状态下分别展示蜂鸣器和RGB真实值，不把逻辑目标冒充物理动作。

### 3.2 最小协议实现

- A3只把`red/off`两种RGB命令路由到诊断驱动。
- 命令触发和到期改变时立即发送遥测，确保5000ms窗口可被观察。
- 其他RGB逻辑状态只保留在计划层并明确拒绝物理命令。
- 串口继续一行一个完整JSON对象，不加入调试文字。

目标回归通过后，以独立提交保存协议与Dashboard状态。

## 任务4：全量软件门与候选固件冻结

按项目固定顺序运行：

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

只有全部通过才冻结`0.3.2-rc3`的`firmware.bin`，记录精确大小、SHA-256、Git提交、RAM/Flash占用和应用偏移`0x10000`。失败时停在软件阶段，不接触真板Flash。

## 任务5：写入候选固件并完成可见验收

### 5.1 写入前只读预检

1. 重新枚举当前`/dev/cu.usbserial-*`或`/dev/tty.usbserial-*`，不硬编码旧端口。
2. 检查端口没有被Monitor、网关或浏览器占用。
3. 确认RGB仍接GPIO46的`V-G-S`，蜂鸣器静音，其他三个执行器未接入/未武装。
4. 确认用户在板旁，可在持续亮灯、异常发热或重启时立即拔USB。
5. 再次核对候选固件哈希。

### 5.2 只写应用区并独立校验

- 使用115200和PlatformIO环境内esptool，只写`0x10000 firmware.bin`。
- 不使用`--erase-all`，不写其他地址。
- 写入后用独立`verify_flash`校验相同应用段，再执行硬复位启动。

### 5.3 上电全灭门

复位后先确认：灯环全灭、蜂鸣器静音；`hello`版本为`0.3.2-rc3`；连续遥测正常；`physicalRgb=true`但`rgbHardwareVerified=false`。

任何上电亮灯、持续闪烁、USB掉线或主板重启都立即停止并回退`0.3.1`。

### 5.4 单次RGB脉冲门

发送：

```json
{"type":"command","id":"hw-rgb-pulse-1","actuator":{"rgb":"red"}}
```

机器证据必须满足：同ID且`ok=true`；回执报告单颗/总数`1/12`；遥测出现`rgbState=red`；约5000ms后自动出现`rgbState=off`；uptime不中断且USB端口保持存在。

人工证据由用户确认：

```text
看到第1颗红灯明显亮起，并在约5秒后自动熄灭
```

随后发送`rgb=off`，确认同ID成功回执且灯环保持全灭。A3通过只证明单颗诊断链路，不把RGB整圈标记为已验收。

## 任务6：形成`0.3.2`最终状态并收口

本轮机器证据通过但GPIO46视觉证据未通过，因此按失败收口：

1. 保持`RGB_HARDWARE_VERIFIED=false`和`RGB_ARMED=false`，版本定为安全正式版`0.3.2`。
2. 更新`设计方案.md`、`开发文档.md`、`AGENTS.md`和RGB规格/计划状态，只记录真实通过项。
3. 重新运行全量Python、Node、JavaScript语法和PIO编译。
4. 只更新应用区并独立校验；最终复位确认上电全灭、蜂鸣器静音和串口状态正确。
5. 运行`git diff --check`与`git status --short --branch`，提交并推送`origin/main`。

完成后仍保持：`physicalActuators=false`、`physicalRgb=false`、`actuatorsReady=false`、整机`hardwareVerified=false`、RGB/风扇/舵机/继电器未武装。下一次GPIO46基础输出诊断或GPIO调整不得在没有新授权的情况下开始。

## 任务7：GPIO46有源蜂鸣器基础输出诊断A5

1. 以提交`c498dd5`及真板`0.3.2`为安全回退点，确认只有有源蜂鸣器接GPIO46，GPIO13和其他执行器空置。
2. 先更新静态合同，要求候选版本`0.3.3-rc1-gpio46-buzzer-diagnostic`、实际蜂鸣输出引脚46、RGB未武装，并确认旧安全版测试失败。
3. 最小实现只把现有800ms非阻塞蜂鸣驱动临时路由到GPIO46；健康字段和成功回执都必须报告输出引脚46，不得把它记录成正式GPIO变更。
4. 运行全量Python、Node、JavaScript语法和PIO编译，保存Git检查点；只写应用区`0x10000`并独立`verify_flash`。
5. 复位确认上电静音，发送一次`buzzer=true`；采集同ID回执、`buzzerOn=true -> false`和约800ms窗口，由用户报告是否听到。
6. 发送显式停止命令，无论结果如何都重新构建并写回安全版`0.3.2`，确认GPIO46诊断输出已解除、RGB命令被拒绝、蜂鸣器正式引脚恢复为GPIO13。
7. 更新`设计方案.md`、`开发文档.md`、`AGENTS.md`和本规格/计划，只记录真实人工结果，提交并推送。
