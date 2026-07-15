# 阶段4 GPIO13有源蜂鸣器真板验收实施计划

> **执行要求：** 严格按任务顺序推进。软件步骤先写失败测试、确认失败原因正确，再做最小实现；硬件步骤只写PIO应用段`0x10000`，每次写入后必须独立校验。任何停止条件出现时立即停在当前检查点。

**目标：** 在风扇、舵机、继电器和RGB继续未武装的前提下，为GPIO13有源蜂鸣器建立上电静音、命令触发150ms非阻塞短鸣、自动停止、同ID确认和真实遥测，并完成一次用户可感知的真板验收。

**架构：** 纯C++ `BuzzerPulseController`只管理150ms时间窗口；`ActuatorDriver`是唯一GPIO13物理边界；`main.cpp`只解析命令、调度驱动和序列化协议。逻辑安全目标继续留在`actuatorTargets`，本轮不把`alarm/intermittent`自动映射到物理蜂鸣器。

**技术栈：** C++17原生测试、PlatformIO Arduino ESP32-S3、ArduinoJson 7、Python `unittest`、Node.js `node:test`、esptool.py 4.11.0、CH340 UART 115200。

**依据规格：** `docs/superpowers/specs/2026-07-15-stage4-buzzer-hardware-validation-design.md`

---

## 0. 已验证基线与权限边界

2026-07-15在提交`1a09364`上重新验证：

- Python 24项通过。
- Node 15项通过。
- `dashboard/context-core.js`和`dashboard/app.js`语法检查通过。
- PIO编译`[SUCCESS]`。
- RAM `19316 / 327680 bytes`，Flash `297713 / 6553600 bytes`。
- 工作区除用户已有`评分表.png`外无未提交改动。

用户此前已经明确授权本次阶段4真板烧录、串口采样和逐个低压执行器测试；本轮授权只用于已确认的GPIO13蜂鸣器A方案，不扩展到其他执行器、全片擦除、NVS修改或小智统一固件。

### 副作用与恢复覆盖

| 动作 | 影响 | 恢复方式 | 权限门 |
| --- | --- | --- | --- |
| 修改仓库代码和文档 | Git跟踪文件 | 回到已知良好提交并重新编译 | 可按计划小步执行 |
| PIO编译 | 只更新忽略的`.pio/`产物 | 删除产物或重新编译 | 无硬件副作用 |
| 应用段写入 | 修改Flash `0x10000`应用区域 | 写回保存的`0.3.0`应用产物；整片私密备份只作最后恢复手段 | 已明确授权，仅按本计划执行 |
| 150ms短鸣 | 产生一次可听声音 | 自动停止或发送`buzzer=false`；异常时拔USB | 用户必须在场确认 |
| Git推送 | 更新`origin/main` | 新提交纠正，不改写远端历史 | 软件和硬件证据通过后执行 |

明确禁止：

- `erase_flash`或任何全片擦除。
- 写入`0x400000`或技能旧示例`0x100000`。
- 改写bootloader、分区表、NVS、Wi-Fi或小智激活数据。
- 初始化GPIO9、GPIO11、GPIO12或GPIO46。
- 真实燃气、危险烟雾或明火测试。
- 修改、暂存或提交`评分表.png`。

## 任务1：建立执行前检查点

### 1.1 复核仓库与硬件边界

```bash
git status --short --branch
git log -3 --oneline --decorate
```

必须确认`main`与`origin/main`同步、只有`评分表.png`未跟踪、蜂鸣器接在GPIO13且静音、其他四个执行器仍断开。

### 1.2 保存恢复产物

在首次重新编译前，把当前已真板验证的`firmware.bin`复制到Git仓库外的私密备份目录，标记为`0.3.0`应用段，记录大小和SHA-256，权限设为`600`。

只读复核现有16MB私密备份存在、大小为`16777216`字节且校验文件可用。不得把备份路径、哈希或内容写进Git或公开日志。

恢复优先级：先把保存的`0.3.0`应用产物写回`0x10000`；只有应用段恢复不可行时，才评估整片备份恢复，且不得自动执行整片恢复。

## 任务2：TDD建立150ms计时控制器和GPIO13安全驱动

**文件：**

- 新增：`firmware/include/buzzer_pulse_controller.h`
- 新增：`firmware/src/buzzer_pulse_controller.cpp`
- 新增：`firmware/native_tests/buzzer_pulse_controller_test.cpp`
- 新增：`tools/test_buzzer_pulse_controller.py`
- 修改：`firmware/include/project_config.h`
- 修改：`firmware/include/project_types.h`
- 修改：`firmware/include/actuator_driver.h`
- 修改：`firmware/src/actuator_driver.cpp`
- 修改：`tools/test_firmware_contract.py`
- 修改：`firmware/platformio.ini`

### 2.1 先写失败测试

原生测试至少覆盖：初始静音、请求后开启、149ms仍开、150ms自动关闭、重复请求刷新窗口、`stop()`立即关闭和`uint32_t`计时回绕。

静态合同先要求：

- `BUZZER_TEST_PULSE_MS=150`。
- 验证固件版本`0.3.1-rc1`。
- `ACTUATORS_ARMED=true`、`BUZZER_ARMED=true`。
- `FAN_ARMED/SERVO_ARMED/RELAY_ARMED/RGB_ARMED=false`。
- `BUZZER_HARDWARE_VERIFIED=false`。
- `monitor_dtr=0`、`monitor_rts=0`。
- `digitalWrite(PIN_BUZZER, LOW)`必须位于`pinMode(PIN_BUZZER, OUTPUT)`之前。
- 驱动不得引用其他四个执行器引脚，不得包含PWM、舵机或NeoPixel调用。

```bash
python3 -m unittest tools/test_buzzer_pulse_controller.py tools/test_firmware_contract.py -v
```

预期失败只能来自控制器尚不存在、旧武装值或旧驱动无GPIO实现。

### 2.2 实现最小控制器和驱动

`BuzzerPulseController`保持纯C++，接口为`requestPulse(nowMs)`、`stop()`、`tick(nowMs)`和`isOn()`；使用无符号时间差处理`millis()`回绕，不调用GPIO。

`ActuatorDriver`负责：

- `begin(nowMs)`先锁存GPIO13为`LOW`，再设为`OUTPUT`。
- `requestBuzzerPulse(nowMs)`启动控制器并写`HIGH`。
- `stopBuzzer()`立即写`LOW`。
- `tick(nowMs)`在到期时写`LOW`，不使用`delay(150)`。
- `result()`返回`PartialBuzzerTest`、`buzzerAvailable`和真实`buzzerOn`。
- `apply(finalTarget, nowMs)`保留计划接口，但不把`alarm/intermittent`写到GPIO13。

`ActuatorApplyState`增加`PartialBuzzerTest`，其他四个实际执行器继续不可用。

### 2.3 目标测试和提交

```bash
python3 -m unittest tools/test_buzzer_pulse_controller.py tools/test_firmware_contract.py -v
```

测试通过并运行`git diff --cached --check`后，只提交本任务文件：

```text
feat: add guarded buzzer pulse driver
```

## 任务3：接入命令、真实遥测和Dashboard部分武装状态

**文件：**

- 修改：`firmware/src/main.cpp`
- 修改：`tools/test_firmware_contract.py`
- 修改：`dashboard/context-core.js`
- 修改：`dashboard/tests/context-core.test.js`
- 修改：`dashboard/tests/dashboard-contract.test.js`

### 3.1 先写协议和页面失败测试

固件合同要求：

- `features.physicalActuators=false`、`features.physicalBuzzer=true`。
- `health.actuatorsArmed=true`但`health.actuatorsReady=false`。
- 五个独立武装字段存在，只有`buzzerArmed=true`。
- `health.buzzerHardwareVerified=false`。
- `health.actuatorApplyState="partial-buzzer-test"`。
- `hardwareVerified=false`、`calibrationRequired=true`。
- `actuators.buzzerOn`来自驱动；其他四项继续为JSON `null`。
- `actuator.buzzer=true`返回同ID成功`ack`和`buzzerPulseMs=150`。
- `actuator.buzzer=false`返回同ID成功`ack`并立即静音。
- 其他四类合法执行器命令继续返回`actuators_unarmed`。
- `set.buzzerEnabled`仍只改变安全静音配置，不阻止用户明确发起验证短鸣。

Dashboard测试要求：部分武装状态显示“仅蜂鸣器测试已武装”；蜂鸣器显示真实开关；其他四项仍显示“未武装/未应用”；Mock仍显示“模拟执行”。

```bash
python3 -m unittest tools/test_firmware_contract.py -v
node --test dashboard/tests/*.test.js
```

预期：旧协议、全局未武装展示和全`null`实际字段断言失败。

### 3.2 接入主循环和命令

调度顺序固定为：

```text
pollSerial
sensor poll
context/safety/plan update
actuatorDriver.apply(plan, nowMs)
actuatorDriver.tick(nowMs)
telemetry emit
```

- `buzzer=true`调用`requestBuzzerPulse(millis())`，返回同ID成功`ack`并立即输出`buzzerOn=true`遥测。
- `buzzer=false`调用`stopBuzzer()`，返回同ID成功`ack`并立即输出`buzzerOn=false`遥测。
- 150ms到期发生状态变化时立即输出`buzzerOn=false`遥测，不能依赖500ms周期偶然捕捉短脉冲。
- 重复`buzzer=true`只刷新150ms窗口。
- 其他合法执行器命令按独立武装开关拒绝。
- 串口仍保持一行一个完整JSON对象，不混入调试文字。

### 3.3 更新Dashboard诚实展示

`context-core.js`按执行器分别处理部分状态：蜂鸣器有真实布尔值时显示实际开启/关闭；其他四个独立开关为false时显示未武装/未应用；总体标签显示“仅蜂鸣器测试已武装”。整机校准未完成和未验证状态保持。

不新增公网、语音、MQTT或无关页面功能。

### 3.4 目标回归、PIO编译和提交

```bash
python3 -m unittest \
  tools/test_buzzer_pulse_controller.py \
  tools/test_firmware_contract.py \
  tools/test_actuator_planner.py \
  tools/test_safety_engine.py \
  tools/test_context_engine.py -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

全部通过后只提交本任务文件：

```text
feat: expose partial buzzer hardware state
```

## 任务4：完整软件门和验证产物冻结

### 4.1 全量验证

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

预期至少Python 25项、Node 17项通过；实际数量以新增测试为准并写入验收记录。除`评分表.png`外工作区应干净。

### 4.2 冻结验证固件

记录`firmware.bin`精确字节数和SHA-256、固件版本`0.3.1-rc1`、Git提交ID、PIO RAM/Flash占用和应用偏移`0x10000`。只有测试、编译和工作区检查全部通过，才进入真板写入。

## 任务5：写入`0.3.1-rc1`并完成一次短鸣人工验收

### 5.1 写入前只读预检

1. 重新查找`/dev/cu.usbserial-*`或`/dev/tty.usbserial-*`，不能硬编码端口编号。
2. 检查没有Monitor、网关、浏览器Web Serial或其他进程占用端口。
3. 确认只有蜂鸣器这一项执行器连接，其他四项断开。
4. 确认用户在板旁，可以在异常持续鸣叫时立即拔USB。
5. 再次确认`firmware.bin`哈希与任务4记录一致。

如果端口不稳定或蜂鸣器在写入前已经发声，停止，不执行Flash。

### 5.2 仅写PIO应用段

使用PlatformIO自带Python和esptool.py 4.11.0，以115200写入：

```bash
"$PIO_PY" "$ESPTOOL" --chip esp32s3 -p "$PORT" -b 115200 \
  --before default_reset --after no_reset \
  write_flash --flash_mode keep --flash_freq keep --flash_size keep \
  0x10000 "$APP_BIN"
```

该命令不使用`--erase-all`，不写bootloader、分区表或NVS。

### 5.3 独立校验和启动

```bash
"$PIO_PY" "$ESPTOOL" --chip esp32s3 -p "$PORT" -b 115200 \
  --before default_reset --after no_reset \
  verify_flash --flash_mode keep --flash_freq keep --flash_size keep \
  0x10000 "$APP_BIN"

"$PIO_PY" "$ESPTOOL" --chip esp32s3 --no-stub -p "$PORT" -b 115200 \
  --before default_reset --after hard_reset run
```

必须看到摘要匹配后才能记录写入成功。

### 5.4 上电静音门

复位后先确认：

- 用户确认蜂鸣器没有启动鸣叫。
- `hello`为`0.3.1-rc1`且项目身份、13个GPIO正确。
- `physicalBuzzer=true`、其他物理执行器未武装。
- 连续遥测正常，传感器链路没有因蜂鸣器接入而中断。

若上电持续响，用户立即拔USB；本轮失败并回到任务1保存的`0.3.0`应用产物，不发送测试命令。

### 5.5 单次短鸣门

发送：

```json
{"type":"command","id":"hw-buzzer-pulse-1","actuator":{"buzzer":true}}
```

机器证据必须满足：收到同ID且`ok=true`的`ack`；立即遥测出现`buzzerOn=true`；随后自动出现`buzzerOn=false`；主板uptime不中断且USB端口不消失。

人工证据由用户只回答一次：

```text
听到一次短鸣，已自动停止
```

收到这句确认前，不把蜂鸣器写成已实物验证。随后发送`buzzer=false`确认保持静音，再发送一个风扇或RGB合法命令，确认仍返回`actuators_unarmed`。

### 5.6 异常回退

- 持续鸣叫：立即拔USB、断开蜂鸣器，写回`0.3.0`应用产物并校验。
- 没有声音但协议成功：保持静音，检查供电、线序和模块有效电平；不直接反转代码并重烧。
- `Device not configured`：停止命令，重新查找端口并检查线材/供电；不重复触发短鸣。
- 自动停止失败：先发送`buzzer=false`；无效时拔USB并回退应用。

## 任务6：固化单项验证状态并写入最终`0.3.1`

只有任务5机器证据和用户人工证据同时通过，才执行本任务。

**文件：**

- 修改：`firmware/include/project_config.h`
- 修改：`tools/test_firmware_contract.py`
- 修改：`docs/superpowers/specs/2026-07-15-stage4-buzzer-hardware-validation-design.md`
- 修改：`设计方案.md`
- 修改：`开发文档.md`
- 修改：`AGENTS.md`

### 6.1 固化最终身份和文档

把验证候选改为：

```text
FIRMWARE_VERSION=0.3.1
BUZZER_HARDWARE_VERIFIED=true
```

其他四个武装和验证状态保持false；整机`hardwareVerified=false`、`actuatorsReady=false`、`calibrationRequired=true`保持不变。

同步内容：

- 规格状态改为“GPIO13真板验收通过”，记录上电静音、短鸣、自动停止、同ID ack和应用段校验。
- `设计方案.md`把执行器验收拆成单项，只勾选蜂鸣器。
- `开发文档.md`记录首次PIO完整上传、真实串口验证、USB偶发重连和本轮GPIO13证据。
- `AGENTS.md`更新当前阶段、固件版本和下一项执行器，同时保留未来Flash授权保护。
- 不记录私密备份哈希、MAC地址、Wi-Fi、令牌或激活数据。

### 6.2 最终回归、写入和校验

重复任务4全量测试和编译，再次只写`0x10000`最终应用段并独立`verify_flash`。启动后只验证上电静音、`hello.firmware=0.3.1`、`buzzerHardwareVerified=true`、其他四个执行器仍未武装、传感器遥测持续。最终固化不需要再次触发短鸣。

### 6.3 提交和推送

按职责提交，例如：

```text
chore: mark GPIO13 buzzer verified
docs: record buzzer hardware acceptance
```

最后运行：

```bash
git diff --check
git status --short --branch
git push origin main
```

必须确认`main`与`origin/main`同步，只有`评分表.png`保持未跟踪，没有`.bin`、日志、私密备份或串口采样文件进入Git。

## 最终验收口径

完成后可以表述：

> GPIO13有源蜂鸣器已通过上电静音、150ms单次短鸣、自动停止、停止命令、同ID ack、真实遥测、应用段校验和最终固件状态验收。

仍不得表述：

- 安全报警`alarm/intermittent`节奏已经实物验收。
- 风扇、舵机、继电器或RGB已经可用。
- 全部执行器或整机硬件已经验证完成。

下一步按既定顺序进入RGB低亮度真板设计与验收；一次只新增一个物理执行器，蜂鸣器不自动响应安全目标，避免干扰下一项测试。
