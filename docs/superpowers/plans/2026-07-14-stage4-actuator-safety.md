# 阶段4执行器与安全引擎软件基线实施计划

> **执行要求：** 严格按任务顺序逐项完成；每个任务先写失败测试、确认失败原因正确，再实现最小代码、运行回归并提交。任何步骤都不得烧录、访问Flash或占用串口。

**目标：** 在`ACTUATORS_ARMED=false`的前提下，完成可测试的安全判断、普通动作规划、安全覆盖、协议扩展、mock和Dashboard最小闭环，并通过PlatformIO纯编译。

**架构：** `SensorSnapshot`分别进入`SafetyEngine`和普通情境规划；`ActuatorPlanner`逐执行器合并普通目标与安全目标；`ActuatorDriver`作为唯一物理输出边界，在本阶段始终返回`unarmed`且不初始化GPIO。遥测分别输出`actuatorTargets`和`actuators`，Dashboard不得把计划、mock或未武装状态描述成真板动作。

**技术栈：** C++17纯逻辑测试、PlatformIO Arduino ESP32-S3、ArduinoJson 7、Python `unittest`、Node.js `node:test`、原生WebSocket mock网关。

**依据规格：** `docs/superpowers/specs/2026-07-14-stage4-actuator-safety-design.md`

---

## 总体执行约束

- 工作目录固定为`/Users/yukii/Desktop/智慧生活/初中2组`。
- 开始和结束都运行`git status --short --branch`。
- 保留未跟踪的`评分表.png`，不得修改、暂存或提交。
- 不改变13个固定GPIO、项目标识、`profileId`、CH340构建标志或PlatformIO版本。
- 不运行`pio run -t upload`、`esptool write_flash`、`erase_flash`、串口监视、端口枚举或Flash备份命令。
- 每个任务只暂存该任务列出的文件；测试变绿后再提交。
- 最终统一推送`origin/main`。推送失败时停止扩大范围，先恢复仓库同步。

## 执行前基线门

在修改任何实现文件前运行：

```bash
git status --short --branch
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

必须确认：

- 当前`main`与`origin/main`同步。
- 除用户已有`评分表.png`外没有未知改动。
- 阶段3 Python、Node测试全部通过。
- PIO显示`[SUCCESS]`。
- 命令没有枚举或打开USB串口，也没有上传目标。

若基线失败，先诊断并向用户报告；不能在未知旧故障上继续叠加阶段4修改。

## 任务1：建立SafetyEngine纯C++安全判断

**文件：**

- 新增：`firmware/include/safety_engine.h`
- 新增：`firmware/src/safety_engine.cpp`
- 新增：`firmware/native_tests/safety_engine_test.cpp`
- 新增：`tools/test_safety_engine.py`
- 修改：`firmware/include/project_config.h`
- 修改：`firmware/include/project_types.h`

### 1.1 先写主机行为测试

在`firmware/native_tests/safety_engine_test.cpp`建立独立`main()`断言，提供可指定数值、有效性和更新时间的`SensorSnapshot`构造助手。至少覆盖：

1. MQ2未完成30000ms预热时：`state=warming`、无报警原因、只产生黄色预热提示目标。
2. MQ2预热结束后，原始值2600以上连续前两帧不报警，第三帧确认`mq2`。
3. MQ2在2400以下连续前两帧不恢复，第三帧才清除；2401至2599保持原状态。
4. 水滴确认产生`water`，不生成风扇或舵机覆盖。
5. 火焰确认产生`flame`，要求风扇0和舵机`safety-closed`。
6. MQ2和火焰同时存在时，`causes`按`flame,mq2`排序，`primary=flame`。
7. 水滴和火焰同时存在时保留两个原因，继电器仍关闭。
8. 安全输入超过1500ms未更新时进入`sensor_fault`。
9. 已确认火焰后输入失效时，同时保留`flame`与`safety_sensor_fault`；恢复有效并连续三帧安全后才清除火焰。

`tools/test_safety_engine.py`复用`tools/test_context_engine.py`的模式：在临时目录使用`c++ -std=c++17 -Wall -Wextra -Werror`编译`safety_engine.cpp`和对应原生测试，再运行生成的二进制。

### 1.2 运行测试并确认预期失败

```bash
python3 -m unittest tools/test_safety_engine.py -v
```

预期：测试因`safety_engine.h/.cpp`和新数据类型尚不存在而失败。若因为编译器、路径或无关旧测试失败，先修正测试入口，不能把错误失败当作有效红灯。

### 1.3 实现最小数据类型和常量

在`project_config.h`增加并集中管理：

```text
FAN_LOW_PERCENT=35
FAN_VENTILATION_PERCENT=70
FAN_ALERT_PERCENT=100
PROVISIONAL_MQ2_ALERT_RAW=2600
PROVISIONAL_MQ2_RECOVERY_RAW=2400
FAST_SAFETY_STALE_MS=1500
ACTUATORS_ARMED=false
BUZZER_ARMED=false
FAN_ARMED=false
SERVO_ARMED=false
RELAY_ARMED=false
RGB_ARMED=false
```

在`project_types.h`增加：

- `SafetyState`：`Normal/Warming/Risk/SensorFault`。
- `SafetyCause`：`Mq2/Water/Flame/SafetySensorFault`。
- 固定容量`SafetyCauseList`，按规格顺序去重。
- `ServoPosition`、`BuzzerMode`、`RgbState`语义枚举。
- `ActuatorTarget`：`fanPercent/servoPosition/relayOn/buzzerMode/rgbState`。
- `SafetyResult`：状态、主风险、全部原因、覆盖标志、蜂鸣请求和安全目标。

所有新类型保持纯C++，不包含`Arduino.h`、ArduinoJson、Servo或NeoPixel类型。

### 1.4 实现SafetyEngine

`SafetyEngine::update(const SensorSnapshot&, uint32_t nowMs)`负责：

- 使用现有`snapshot.mq2WarmedUp`，不另建第二套预热计时。
- 为MQ2维护报警和恢复连续帧计数。
- 使用阶段3已经去抖后的`snapshot.water/flame`布尔结果，不重复做第二套数字去抖。
- 根据`updatedAtMs`与`FAST_SAFETY_STALE_MS`判断安全输入新鲜度。
- 已确认风险遇到输入失效时保留原风险，并增加故障原因。
- 按`flame > mq2 > water > safety_sensor_fault`确定`primary`。
- 只输出安全结果和安全目标，不读取模式、不写GPIO。

同时提供稳定的枚举转协议字符串函数，避免在`main.cpp`重复switch。

### 1.5 运行目标测试和阶段3回归

```bash
python3 -m unittest tools/test_safety_engine.py tools/test_context_engine.py -v
```

预期：两个纯C++测试入口全部通过，编译参数无warning。

### 1.6 提交

```bash
git add firmware/include/project_config.h \
  firmware/include/project_types.h \
  firmware/include/safety_engine.h \
  firmware/src/safety_engine.cpp \
  firmware/native_tests/safety_engine_test.cpp \
  tools/test_safety_engine.py
git diff --cached --check
git commit -m "feat: add stage4 safety engine"
```

## 任务2：建立ActuatorPlanner普通目标和安全仲裁

**文件：**

- 新增：`firmware/include/actuator_planner.h`
- 新增：`firmware/src/actuator_planner.cpp`
- 新增：`firmware/native_tests/actuator_planner_test.cpp`
- 新增：`tools/test_actuator_planner.py`
- 视测试需要修改：`firmware/include/project_types.h`

### 2.1 先写规划器行为测试

原生测试至少覆盖：

1. `detect`输出安全空闲普通目标。
2. `study`在PIR有效且活动、光照低于1400时请求继电器；声音高于2300时RGB橙色。
3. `study`在DHT有效且温度达到28°C或湿度达到70%时请求35%风扇和`ventilation-open`。
4. `rest`输出舵机`rest`、RGB低亮蓝，湿热时只请求35%风扇。
5. `ventilation`在DHT有效时输出35%或70%风扇；DHT无效时固定输出风扇0、舵机`hold`、继电器关闭、蜂鸣器关闭、RGB灰色。
6. `energy`关闭风扇、继电器、蜂鸣器和RGB，舵机为`energy`。
7. `custom`在阶段5前与`detect`一样保持空闲。
8. 水滴只覆盖继电器、RGB和蜂鸣器，不覆盖普通风扇或舵机目标。
9. MQ2覆盖风扇为100%、舵机通风、继电器关闭和RGB红色。
10. 火焰覆盖MQ2：风扇0、舵机`safety-closed`。
11. `buzzerEnabled=false`时最终蜂鸣器关闭，但安全原因和其他目标不变。
12. 安全传感器故障停止普通自动目标并返回灰色提示。

### 2.2 运行测试并确认预期失败

```bash
python3 -m unittest tools/test_actuator_planner.py -v
```

预期：因规划器文件尚不存在而失败。

### 2.3 实现普通目标和逐执行器合并

实现接口：

```text
ActuatorTarget normalTarget(ContextMode, SensorSnapshot, ContextResult)
ActuatorPlan plan(ContextMode, SensorSnapshot, ContextResult, SafetyResult, buzzerEnabled)
```

实现规则：

- 每项普通动作只读取其依赖的有效输入，失效数据不参与。
- `detect/custom`不产生普通强动作。
- 安全目标逐执行器覆盖，不能用一个整体布尔值粗暴替换全部普通目标。
- 水滴不修改风扇和舵机；火焰、MQ2和故障按规格处理冲突。
- 规划器不存手动命令、不写GPIO、不把计划标记为已经执行。
- `ActuatorPlan`同时保留普通目标、最终目标和安全覆盖信息，便于测试与遥测解释。

### 2.4 运行纯逻辑回归

```bash
python3 -m unittest \
  tools/test_actuator_planner.py \
  tools/test_safety_engine.py \
  tools/test_context_engine.py -v
```

预期：全部通过。

### 2.5 提交

```bash
git add firmware/include/project_types.h \
  firmware/include/actuator_planner.h \
  firmware/src/actuator_planner.cpp \
  firmware/native_tests/actuator_planner_test.cpp \
  tools/test_actuator_planner.py
git diff --cached --check
git commit -m "feat: add layered actuator planner"
```

## 任务3：加入未武装驱动边界和固件协议

**文件：**

- 新增：`firmware/include/actuator_driver.h`
- 新增：`firmware/src/actuator_driver.cpp`
- 修改：`firmware/src/main.cpp`
- 修改：`tools/test_firmware_contract.py`
- 修改：`firmware/include/project_config.h`（仅在前两项遗漏常量时）
- 修改：`firmware/include/project_types.h`（仅补充驱动应用结果）

### 3.1 先更新固件静态契约

将阶段3合同改为阶段4合同，先要求以下内容：

- 固件版本`0.3.0`。
- `SafetyEngine`、`ActuatorPlanner`和`ActuatorDriver`实例及调用存在。
- 六个武装开关全部为`false`。
- `hello.features`含`safetyReasoning=true`、`actuatorPlanning=true`、`physicalActuators=false`。
- `telemetry`含`actuatorTargets`、`actuators`、`alerts`、`safety`。
- `health.stage=stage4-actuator-safety-software`。
- `safetyReady=true`、`actuatorsArmed=false`、`actuatorsReady=false`、`hardwareVerified=false`、`calibrationRequired=true`。
- 未武装实际状态使用JSON `null`。
- 错误码包括`missing_id`、`invalid_actuator_command`、`actuators_unarmed`。
- 有效模式命令与`set.buzzerEnabled`仍可成功。
- `actuator.buzzer=false`没有改变`buzzerEnabled`。
- `main.cpp`、传感器层、情境层和安全/规划层不出现执行器GPIO写入；`ActuatorDriver`本阶段也不包含实际硬件调用。

### 3.2 运行固件合同并确认预期失败

```bash
python3 -m unittest tools/test_firmware_contract.py -v
```

预期：版本、模块、遥测、健康字段和驱动文件相关断言失败；原有GPIO与PIO基线断言仍通过。

### 3.3 实现ActuatorDriver未武装骨架

驱动接口至少包括：

```text
begin() -> ActuatorApplyResult
apply(const ActuatorTarget&) -> ActuatorApplyResult
```

本阶段实现固定行为：

- 总闸为false时立即返回`unarmed`。
- 不调用`pinMode`、`digitalWrite`、PWM、Servo attach或NeoPixel begin/show。
- 实际执行字段全部标记为不可用，由协议序列化为`null`。
- 不缓存计划目标为实际状态。

### 3.4 将三层逻辑接入main.cpp

调度顺序固定为：

```text
pollSerial
sensor poll
context evaluate
safety update
actuator plan
driver apply
telemetry emit
```

集成要求：

- 版本升级为`0.3.0`。
- `hello`增加阶段4能力，保留项目身份、GPIO和网页语音边界。
- 遥测按规格输出语义`actuatorTargets`、全null的`actuators`、固定顺序`alerts`、完整`safety`和真实`health`。
- MQ2预热不进入`alerts`；安全传感器故障只进入`safety.causes`。
- `buzzerEnabled`默认true，并出现在健康或安全状态中。

### 3.5 扩展命令解析

命令校验顺序：JSON、ID、类型、结构、字段和值域、武装状态。

- 无ID或无法解析时返回`id:null`。
- 一个命令只允许`mode`、`set`或`actuator`一种操作。
- `set.buzzerEnabled`只接受布尔值，未武装时仍可成功。
- 识别规格列出的五类执行器字段和值域。
- 未知字段/非法值返回`invalid_actuator_command`。
- 合法执行器命令返回同ID的`actuators_unarmed`，不保存手动目标。
- 模式命令继续使用六种固定名称并返回同ID成功ack。

### 3.6 运行合同、纯逻辑测试和首次阶段4 PIO纯编译

```bash
python3 -m unittest \
  tools/test_firmware_contract.py \
  tools/test_context_engine.py \
  tools/test_safety_engine.py \
  tools/test_actuator_planner.py -v
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

预期：全部通过，PIO显示`[SUCCESS]`。不得追加`-t upload`。

### 3.7 提交

```bash
git add firmware/include/actuator_driver.h \
  firmware/src/actuator_driver.cpp \
  firmware/include/project_config.h \
  firmware/include/project_types.h \
  firmware/src/main.cpp \
  tools/test_firmware_contract.py
git diff --cached --check
git commit -m "feat: integrate unarmed actuator protocol"
```

## 任务4：同步stage4 mock网关合同

**文件：**

- 修改：`tools/n16r8_gateway.py`
- 修改：`tools/test_gateway.py`

### 4.1 先更新mock测试

测试先要求：

- `hello.features`包含安全判断、执行器规划和mock来源说明。
- 每帧保持`mock=true`和`source=mock-board`。
- `telemetry.actuatorTargets`使用语义字段。
- `telemetry.actuators`使用实际字段名并表示模拟执行结果。
- `safety`使用`state/primary/causes/overrideActive/buzzerRequested/buzzerMuted`。
- `health.actuatorApplyState=simulated`，不能冒充真板硬件验收。
- MQ2、水滴、火焰分别产生正确目标和模拟结果。
- `set.buzzerEnabled=false`返回同ID成功ack，并让后续风险帧保留报警原因但关闭模拟蜂鸣器。
- 缺少ID的mock命令返回`id:null`。
- 现有WebSocket `hello -> command -> ack -> telemetry`闭环继续通过。

### 4.2 运行测试并确认预期失败

```bash
python3 -m unittest tools/test_gateway.py -v
```

预期：新字段、静音行为和`id:null`断言失败，WebSocket基础连接不应无故失效。

### 4.3 最小修改mock状态

- 保留六种模式和`normal/mq2/water/flame`四种场景。
- 把现有模式动作拆为`actuatorTargets`和模拟`actuators`。
- 安全场景复用与固件相同的风险名称和动作语义。
- 增加`buzzerEnabled`状态，仅影响模拟蜂鸣器，不删除风险。
- mock健康状态明确写`source=mock-board`和`actuatorApplyState=simulated`。
- 不在本任务加入串口、MQTT、语音或新依赖。

### 4.4 运行网关与全部Python回归

```bash
python3 -m unittest tools/test_gateway.py -v
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

预期：全部通过。

### 4.5 提交

```bash
git add tools/n16r8_gateway.py tools/test_gateway.py
git diff --cached --check
git commit -m "feat: align mock with stage4 actuation"
```

## 任务5：Dashboard区分计划、模拟和实际动作

**文件：**

- 修改：`dashboard/context-core.js`
- 修改：`dashboard/app.js`
- 修改：`dashboard/index.html`
- 修改：`dashboard/tests/context-core.test.js`
- 修改：`dashboard/tests/dashboard-contract.test.js`

### 5.1 先写Node测试

在`context-core.test.js`增加纯函数夹具：

1. 真固件未武装帧：计划动作可见，实际动作显示“未武装/未应用”。
2. mock帧：计划动作和实际动作都显示，但实际部分标为“模拟执行”。
3. 真固件未来有实际值时：只按`actuators`显示实际，不从计划值推断。
4. 缺失字段：显示未知，不假设关闭。
5. `safety_sensor_fault`有明确中文说明。

在`dashboard-contract.test.js`要求：

- 页面阶段文案更新为阶段4软件基线。
- `app.js`同时读取`actuatorTargets`和`actuators`。
- 未武装文案、模拟执行文案和校准提示存在。
- 3500ms过期后计划、实际和安全状态都被清除。
- 仍不出现把WebSocket状态写成“真板在线”的文案。

### 5.2 运行测试并确认预期失败

```bash
node --test dashboard/tests/*.test.js
```

预期：计划/实际规范化函数、阶段4文案和未武装显示断言失败。

### 5.3 扩展ContextCore

- `normalizeTelemetry()`补齐`actuatorTargets`、`actuators`、`safety`和`health`默认对象。
- 新增纯函数把五个计划目标格式化为中文。
- 新增纯函数只根据`mock`、`health.actuatorApplyState`和实际字段生成“模拟执行”“未武装/未应用”或实际数值。
- 增加`safety_sensor_fault`中文标签；未知代码仍原样可见。
- 不在纯函数中读取DOM或当前时间。

### 5.4 最小修改页面渲染

- 沿用现有五个执行器行，在每行显示“计划：… / 实际：…”，不新增独立UI框架。
- 安全状态区分“安全引擎就绪”“安全覆盖中”“执行器未武装”“模拟执行”。
- 真固件`hardwareVerified=false`或`calibrationRequired=true`时显示校准提示。
- ack失败继续显示服务端/固件返回的`actuators_unarmed`，不翻译成成功。
- `clearTelemetry()`清空计划、实际、安全和校准提示。
- `index.html`顶部和页脚从阶段3更新为“阶段4软件基线”，保留Mock、WebSocket、USB和MQTT事实分离。
- 不增加外部字体、CDN、Service Worker或公网端点。

### 5.5 运行Dashboard检查

```bash
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
```

预期：全部通过。

### 5.6 提交

```bash
git add dashboard/context-core.js \
  dashboard/app.js \
  dashboard/index.html \
  dashboard/tests/context-core.test.js \
  dashboard/tests/dashboard-contract.test.js
git diff --cached --check
git commit -m "feat: show planned and applied actions"
```

## 任务6：同步工程文档并完成阶段4软件验收

**文件：**

- 修改：`AGENTS.md`
- 修改：`开发文档.md`
- 不修改：`设计方案.md`，除非实施过程中发现已确认设计与代码存在真实冲突；若有冲突必须先停下请用户决定。

### 6.1 先运行全量软件验证

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
node --check dashboard/context-core.js
node --check dashboard/app.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
```

记录实际测试数量、PIO RAM和Flash使用量。只有真实输出为成功时才能写入文档。

### 6.2 更新AGENTS.md

把阶段状态更新为阶段4软件基线完成，并明确：

- 固件版本`0.3.0`。
- `SafetyEngine/ActuatorPlanner/ActuatorDriver`软件合同已通过。
- `safetyReady=true`只代表软件引擎就绪。
- `ACTUATORS_ARMED=false`、五个独立开关为false。
- `actuatorsReady=false`、`hardwareVerified=false`、`calibrationRequired=true`继续保持。
- 当前仍只允许测试和`pio run`，不得烧录或串口操作。
- 下一步需要再次明确授权，才可进入阶段4真板逐执行器验收。

### 6.3 更新开发文档.md

- 更新开头当前阶段和固件版本。
- 在模块、协议、测试和当前进度部分写入阶段4真实实现。
- 写入本次实际测试数量和PIO资源使用量。
- 把旧的“下一步仍属于阶段3”改为“下一步是阶段4逐执行器真板验收”。
- 保留MQ2分压、水滴/火焰电平、舵机角度、风扇/继电器有效电平均待实物确认。
- 不写入串口成功、真板动作成功或烧录成功等未经执行的结论。

### 6.4 文档更新后再跑最终回归

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
node --test dashboard/tests/*.test.js
PLATFORMIO_SETTING_ENABLE_TELEMETRY=no \
  /Users/yukii/.platformio/penv/bin/pio run -d firmware -j1
git diff --check
git status --short --branch
```

预期：测试和编译全部通过；状态中只出现阶段4相关修改和用户原有`评分表.png`。

### 6.5 提交文档与最终状态

```bash
git add AGENTS.md 开发文档.md
git diff --cached --check
git commit -m "docs: record stage4 software baseline"
git status --short --branch
git log --oneline --decorate -8
git push origin main
```

推送后再次确认：

```bash
git status --short --branch
git log -1 --oneline --decorate
```

期望`main...origin/main`同步，仅保留未跟踪的`评分表.png`。

## 最终交付报告

执行计划全部完成后，向用户报告：

- 新增的安全引擎、规划器和未武装驱动边界。
- 固件版本和协议新增字段。
- Python、Node测试实际通过数量。
- PIO实际RAM/Flash使用量和`[SUCCESS]`证据。
- 明确说明没有烧录、没有串口操作、没有真板执行器动作。
- Git提交和推送结果。
- 下一步逐个执行器接线顺序与仍需再次取得的烧录授权。
