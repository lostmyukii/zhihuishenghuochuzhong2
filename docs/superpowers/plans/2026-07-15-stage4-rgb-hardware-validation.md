# 阶段4 GPIO46 RGB灯环真板验收实施计划

> **计划状态：** 设计规格已确认，待按本计划实施。
>
> **执行要求：** 软件步骤严格执行“先失败测试、再最小实现、再全量回归”；硬件步骤只写PIO应用段`0x10000`并独立校验。任何停止条件出现时立即停在当前检查点。

**目标：** 在GPIO13蜂鸣器保持静音、风扇/舵机/继电器继续未武装的前提下，为GPIO46的12颗RGB灯环建立上电全灭、标准命令触发、`8 / 255`低亮青色800ms、自动熄灭、同ID回执和真实遥测，并完成一次用户可见的真板验收。

**架构：** 纯C++ `RgbPulseController`只管理800ms状态窗口；`ActuatorDriver`独占NeoPixel物理输出；`main.cpp`只校验命令、调度驱动和序列化协议。`ActuatorPlanner`和`SafetyEngine`继续只产生逻辑目标，不自动驱动本轮灯环。

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
| Git推送 | 更新`origin/main` | 追加纠正提交，不强推 |

明确禁止：全片擦除、写入`0x400000`或`0x100000`、改写bootloader/分区表/NVS、修改Wi-Fi或小智激活数据、初始化GPIO11/9/12、提高RGB亮度、真实燃气/烟雾/明火测试。

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

原生测试覆盖：初始关闭、请求后开启、到期前保持、800ms自动关闭、重复请求刷新、`stop()`立即关闭和`uint32_t`回绕。

静态合同要求：

- 候选版本为`0.3.2-rc1`。
- `RGB_LED_COUNT=12`、`RGB_TEST_BRIGHTNESS=8`、`RGB_TEST_PULSE_MS=800`。
- `RGB_ARMED=true`、`RGB_HARDWARE_VERIFIED=false`；风扇/舵机/继电器仍为`false`。
- 使用`Adafruit_NeoPixel`、`PIN_RGB`、`NEO_GRB + NEO_KHZ800`。
- 初始化执行`begin()`、`setBrightness(8)`、`clear()`、`show()`，不得产生启动灯效。
- 驱动不得引用GPIO11、GPIO9或GPIO12，不得包含`delay(800)`。

先运行目标测试并确认旧实现只因缺少上述能力失败。

### 2.2 最小实现

- `RgbPulseController`保持纯C++，仅提供`requestPulse(nowMs)`、`stop()`、`tick(nowMs)`和`isOn()`。
- `ActuatorDriver`持有12灯NeoPixel对象；`begin()`初始化后立即清空刷新。
- `requestRgbTestPulse()`用`Color(0,255,255)`填充12颗灯珠并刷新，实际全局亮度由`setBrightness(8)`限制。
- `stopRgb()`立即清空刷新。
- `tick()`分别处理蜂鸣器和RGB到期，任何一项状态改变都返回`true`，不阻塞主循环。
- `result()`返回`PartialBuzzerRgbTest`、真实`buzzerOn`和真实`rgbState`。

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
- `rgb=cyan`返回同ID成功确认及`800/8/12`三个固定参数。
- `rgb=off`立即关闭并返回同ID成功确认。
- 其他已知RGB状态返回同ID错误`rgb_test_state_only`。
- 风扇、舵机和继电器继续返回`actuators_unarmed`。
- Dashboard在部分武装状态下分别展示蜂鸣器和RGB真实值，不把逻辑目标冒充物理动作。

### 3.2 最小协议实现

- 只把`cyan/off`两种RGB命令路由到验证驱动。
- 命令触发和到期改变时立即发送遥测，确保800ms窗口可被观察。
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

只有全部通过才冻结`0.3.2-rc1`的`firmware.bin`，记录精确大小、SHA-256、Git提交、RAM/Flash占用和应用偏移`0x10000`。失败时停在软件阶段，不接触真板Flash。

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

复位后先确认：灯环全灭、蜂鸣器静音；`hello`版本为`0.3.2-rc1`；连续遥测正常；`physicalRgb=true`但`rgbHardwareVerified=false`。

任何上电亮灯、持续闪烁、USB掉线或主板重启都立即停止并回退`0.3.1`。

### 5.4 单次RGB脉冲门

发送：

```json
{"type":"command","id":"hw-rgb-pulse-1","actuator":{"rgb":"cyan"}}
```

机器证据必须满足：同ID且`ok=true`；遥测出现`rgbState=cyan`；约800ms后自动出现`rgbState=off`；uptime不中断且USB端口保持存在。

人工证据由用户确认：

```text
看到12颗灯珠整圈低亮青色亮起，并自动熄灭
```

随后发送`rgb=off`，确认同ID成功回执且灯环保持全灭。

## 任务6：形成`0.3.2`最终状态并收口

只有机器证据和用户视觉证据都通过后：

1. 将`RGB_HARDWARE_VERIFIED`改为`true`，版本改为`0.3.2`。
2. 更新`设计方案.md`、`开发文档.md`、`AGENTS.md`和RGB规格/计划状态，只记录真实通过项。
3. 重新运行全量Python、Node、JavaScript语法和PIO编译。
4. 只更新应用区并独立校验；最终复位确认上电全灭、蜂鸣器静音和串口状态正确。
5. 运行`git diff --check`与`git status --short --branch`，提交并推送`origin/main`。

完成后仍保持：`physicalActuators=false`、`actuatorsReady=false`、整机`hardwareVerified=false`、风扇/舵机/继电器未武装。下一项不得在没有新授权的情况下开始。
