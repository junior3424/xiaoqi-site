# 通用 AI Agent 工作区治理与自治任务管理机制（TB-Auto）设计及落地指导书

> **文档定位**：本文档提炼自真实生产环境的工程实践，剥离了特定硬件与具体业务耦合，总结出一套**适用于任何 AI Agent（DSH / Claude Code / Cursor 等）单工作区或多工作区环境的通用任务管理与工作区治理机制**。
> 既可作为架构思路分享给其他开发者，也可直接作为蓝本交给 AI Agent 在任意新工作区一键复刻落地。

---

## 一、为什么要设计这套机制？（解决 AI 协作的 4 大通病）

在长期使用 AI Agent 处理复杂工程、运维或日常任务时，几乎所有工作区都会在两周内陷入以下 4 种混乱：

1. **目录腐化（过程垃圾淹没正式成果）**：Agent 在排查和开发过程中会产生大量临时脚本、日志、备份文件（`.bak`）、半截下载物（`.part`）。久而久之，工作区根目录一团糟，人类和下一次进入的 Agent 都分不清哪个是最终成品、哪个是废弃探针。
2. **跨会话失忆（多窗口/多日协作断片）**：当一个任务跨越多个对话窗口或中断数日后，新会话里的 Agent 不知道之前试过什么方案、改了哪些文件、卡在哪个报错、如何回滚。
3. **周期性自动化失控（黑盒运行与账本膨胀）**：定时脚本或 AI 定时唤醒任务上线后，要么静默挂死无人知晓，要么每次运行都往任务看板里刷记录，几百次运行后把看板彻底冲垮。
4. **“人懒得建单”导致账本名存实亡**：最致命的痛点——如果要求人类每次开窗口聊天前都手动建任务，或者完全指望当班 Agent 自觉登记，只要忘了一次，账本就会漏单并迅速失去可信度。

---

## 二、核心设计哲学：六大通用支柱

本机制通过 **“双树物理隔离 + 事件溯源账本 + 建设/运行解耦 + 每日凌晨自动巡检补账 + Doctor 六道体检”** 形成完整闭环：

```text
                ┌────────────────────────────────────────────────┐
                │            日常工作流（主动入账）                │
                │  开工 tb brief ──► 登记 artifact ──► 尾行贴 ▸ ID │
                └───────────────────────┬────────────────────────┘
                                        │
                                        ▼
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│   双树物理隔离       │      │  事件溯源任务账本      │      │   双轨定时自动化     │
│ • 结果树 (长期自洽)  │◄────►│ • events.jsonl 追加写│◄────►│ • AI 唤醒 (schedule)│
│ • 过程树 (_proc 可弃)│      │ • board.md/html 投影 │      │ • 脚本定时 (timer)  │
└─────────────────────┘      └──────────▲───────────┘      └──────────┬──────────┘
                                        │                             │
                ┌───────────────────────┴────────────────────────┐    │
                │       每日凌晨 04:00 兜底巡检（被动自动补账）     │◄───┘
                │  增量扫描新会话 ──► 完结建单+done / 半截建 open  │
                └────────────────────────────────────────────────┘
```

---

### 支柱 1：过程树与结果树物理隔离（Dual-Tree Isolation）

将工作区内的所有文件严格划分为**“结果树”**与**“过程树”**，判据只有一句话：
> **任何时候执行 `rm -rf _proc`，工作区内所有的代码、文档、配置与交付成品必须 100% 自洽可用、不产生任何死链。**

#### 通用标准目录树
```text
<WORKSPACE_ROOT>/
├── README.md                        ← 工作区导航（人读）
├── AGENTS.md                        ← Agent 行为规程（AI 读）
├── TASKS/                           ← 【账本核心】events.jsonl / inbox.jsonl / board.md / board.html / tasks/
│   └── board.config.json            ← 工作区配置（任务前缀 prefix、根目录白名单）
├── DELIVERY/                        ← 【验收归档】按任务 ID 归档的正式交付物（含 _DELIVERY.md 与 SHA256）
├── SHARED_OUT/                      ← 【公共取件口，可选】原子发布的最新成品（packages / datasets / reports）
├── projects/                        ← 【结果树·工程】独立功能模块或代码库（每子目录必配 _MANIFEST.md）
├── ops/                             ← 【结果树·运维，可选】系统配置与维护脚本（每子目录必配 _MANIFEST.md）
├── jobs/                            ← 【结果树·自动化】定时/周期任务（每子目录必配 _JOB.md + run.sh / prompt.md）
├── docs/                            ← 【结果树·文档】架构方案、排障记录、经验沉淀（*.md）
├── state/                           ← 【运行态】定时任务最新一次运行心跳（<job-slug>.json）与游标（cursors/）
├── archive/                         ← 【冷归档】已废弃或下线的历史模块与旧文件
├── _proc                            ← 【过程树·随时可弃】按 <YYYYMMDD>_<slug> 存放单次日志、探针、临时文件
└── tools/
    └── taskboard/                   ← 零外部依赖的 Node.js 账本引擎 tb.mjs 与自检套件 selftest.mjs
```

---

### 支柱 2：零依赖事件溯源账本（Event-Sourcing Taskboard）

不依赖数据库、不依赖第三方 npm 包，仅用单文件 Node.js 标准库脚本 `tools/taskboard/tb.mjs` 实现**事件溯源（Event Sourcing）+ CQRS 读写分离投影**：

1. **唯一真相源（`TASKS/events.jsonl`）**：
   * 所有状态变更（`new`、`claim`、`renew`、`release`、`handoff`、`note`、`block`、`unblock`、`artifact`、`retract`、`deliver`、`done`、`abandon`）一律以单行 JSON 追加写入（`appendFileSync`），天然防并发覆盖、可追溯完整时间线。
2. **多视图自动投影（`tb rebuild`）**：
   * 从 `events.jsonl` 重放生成：`TASKS/index.json`（机器索引）、`TASKS/board.md`（Markdown 看板）、`TASKS/board.html`（单文件自包含可视化网页看板）、`TASKS/tasks/<ID>.md`（单任务详情页）。
3. **通用任务分类（`--kind`）与前置/后置卡点**：
   * `project`（工程开发）、`ops`（运维/配置变更，创建时强提醒填 `--rollback` 回滚方案）、`auto-job`（自动化作业，创建时必填 `--schedule` 触发周期）、`delivery`（对外交付，结案前检查是否已 `deliver`）、`research`（纯调研排查，免除产物卡点）。
   * 除 `research` 外，所有任务在 `done` 结案时必须至少登记 1 个结果树 `artifact` 或传入 `--verify "<实测结论>"`。
4. **当班 Agent 极简三步规程**：
   * **开工**：跑 `./tools/taskboard/tb brief` 秒读全局简报（进行中任务 + 自动任务失败报警 + 最近 5 条事件）；
   * **干活**：结果树产出用 `tb artifact <ID> <路径>` 登记，半途交接用 `tb handoff <ID> "做到哪/卡在哪/下一步/怎么验证"`；
   * **收尾**：回复末尾原样附上 `tb tail` 输出的 `▸ <PREFIX>-xxxx <标题>` 归属尾行（这行尾行也是后续自动巡检器判断“该对话已入账”的核心标记）。

---

### 支柱 3：建设期与运行态解耦的双轨自动化（Dual-Track Automation）

针对“每周或每天固定时间自动开始某项任务”的需求，本机制提出两条核心设计准则：

#### 准则 A：任务账本管“建设与变更”，`state/` 心跳管“日常运行”
* **痛点**：一个每 15 分钟跑一次的定时任务，一年运行 35,000 次。如果每次运行都往 `events.jsonl` 写事件，账本会迅速报废；如果规定定时任务永远处于 `open` 状态不结案，`tb brief` 的待办列表就会被已上线的常驻任务塞满。
* **解法**：
  * **建设期写账本**：新建或改造定时任务时建单（`open` $\rightarrow$ `claimed`）$\rightarrow$ 编写契约与逻辑 $\rightarrow$ 手动冒烟测试通过并挂载定时器后，**立即 `tb done <ID> --verify "..."` 结案**（代表“该自动化作业已交付上线”）。
  * **运行期写心跳**：每次定时触发只向 `state/<slug>.json` 原子覆写最新一次心跳（记录 `last_run`、`exit_code`、`duration_s`、`consecutive_fail` 连续失败次数、`last_ok`），详细日志落入过程树并按 `retain_days` 自动清理过期目录。
  * **异常置顶报警**：`tb brief` 每次运行时自动扫描 `state/*.json`，一旦发现某作业 `exit_code != 0`，立即在简报最顶部标红报警：`! 自动任务失败：<slug>（exit=1，连续失败 N 次）`。

#### 准则 B：AI 唤醒型与 OS 脚本型“双轨并存、统一契约”
所有自动化作业统一在 `jobs/<slug>/_JOB.md` 登记契约，按 `driver` 分为两轨：
1. **轨道 A（`driver: dsh-schedule` · AI 会话定时唤醒）**：
   * 适用：需要大模型推理、调用工具/MCP、阅读网页或汇总分析的任务。
   * 机制：`tb job-init <slug> --driver dsh-schedule` 生成 `_JOB.md` 与 `prompt.md`，通过宿主环境的会话定时器（如 DSH `schedule_create`）在指定时间将 `prompt.md` 投递进会话唤醒 Agent；唤醒词尾步强制要求 Agent 执行 `tb job-heartbeat <slug> --exit 0 --note "摘要"` 更新心跳。
2. **轨道 B（`driver: systemd-timer | cron` · OS 脚本确定性定时）**：
   * 适用：不消耗大模型 Token、逻辑固定的批处理/备份/同步脚本。
   * 机制：`tb job-init <slug> --driver systemd-timer` 生成 `_JOB.md` 与标准包装入口 `run.sh`（内置 `flock -n` 防重入锁、`timeout` 防卡死、退出自动调用 `job-heartbeat`、自动清理超期过程日志），经 `tb job-run <slug>` 冒烟通过后，由 `tb job-enable <slug>` 一键生成并启用系统定时器。

---

### 支柱 4：主被动双保险——未入账对话自动巡检与兜底补账（`session-ledger-sync`）

这是让整套任务管理机制真正实现**“自治（Self-Driving）”**的核心组件。
即便用户平时随手开窗口让 AI 干活、完全忘了建任务，系统也会在**每天凌晨 `04:00`** 自动唤醒巡检员，把上个周期漏记的新对话归纳进账本。

#### 两阶段低 Token 巡检架构

1. **第一阶段：零 Token 确定性增量预筛脚本（`scan-sessions.mjs`）**
   * **读取水位游标（`state/cursors/session-ledger-cursor.json`）**：记录每个会话上次已处理到的轮次 `lastTurn` 与已关联任务 `linkedTasks`。每次唤醒只扫描 `turn > lastTurn` 的新增对话轮次（天然支持停机多日后自动追平、随时手动加跑不冲突）。
   * **五重去噪与防重过滤**：
     1. **初始化基线锚定（`--init-baseline`）**：首次上线时将历史老会话一键锚定为 `baseline`，避免把历史老账翻出来重建；
     2. **剔除子 Agent 会话**：凡带 `parentSession` 的派生子会话一律跳过，只看用户主会话；
     3. **剔除巡检会话自身（防自指死循环）**：匹配当前 `DSH_SESSION_ID` 或标题/首条消息含 `session-ledger-sync` 的巡检会话自身无条件跳过；
     4. **剔除当班已入账轮次**：若新增轮次中助手已贴 `▸ <PREFIX>-xxxx` 归属尾行，或已调用过 `tb` 写操作，说明当班 Agent 已自觉入账，脚本自动推进游标免打扰；
     5. **30 分钟静默保护窗（Cooldown）**：距最后一条消息不足 30 分钟的活跃对话暂不处理，防止用户半夜正在聊天被半途截胡（留待次日凌晨自动捞出）。

2. **第二阶段：AI 唤醒语义四分支归纳（每日 `04:00` 触发）**
   * 当预筛脚本返回 `untrackedCount === 0` 时，直接写心跳收工；
   * 当存在未入账候选会话时，Agent 阅读精简摘要并按 4 种情况处理：
     * **分支 A（纯闲聊 / 简单问答）**：不建任务，直接调用 `--mark` 推进游标跳过；
     * **分支 B（全新未入账且【已完结】的实质工作）**：提炼标题与分类，调用目标工作区 `tb new --ts <对话开始时间> --objective "... [session:<id8>]"` + 登记关键 `artifact` + `tb done --ts <最后活跃时间> --verify "自动巡检归档 [session:<id8>]"`；
     * **分支 C（全新未入账但【聊了一半没做完】的工作）**：直接在目标工作区调用 `tb new` 新建一条 **`open` 状态的正式任务**，并调用 `tb handoff <新ID> "做到哪/卡在哪/下一步/怎么验证 [session:<id8>]"`，挂在看板【进行中】列表提醒用户继续；
     * **分支 D（已关联 `open` 任务的会话出现后续新轮次）**：读取游标中的 `existingLinkedTasks`，直接在原 `open` 任务上追加 `artifact` / `handoff` 或执行 `done` 收尾，**绝不重复新建第二条任务**。

---

### 支柱 5：六道自动化体检护栏（`tb doctor` C1–C6）

任何规范如果只写在文档里，三天后就会被破坏。因此 `tb.mjs doctor` 内置了 6 条硬性静态检查（要求日常保持 **0 警告 0 错误**）：

| 规则码 | 检查项 | 拦截目标 |
|---|---|---|
| **C1** | **根目录白名单检查** | 拦截散落在工作区根目录的临时文件、日志或未知目录 |
| **C2** | **结果树禁引过程树具体文件** | 扫描 `docs/`、`projects/`、`jobs/` 下的文档，拦截任何指向 `_proc` 下具体文件的死链引用 |
| **C3** | **模块与作业契约必填字段** | 检查 `projects/*/_MANIFEST.md` 与 `jobs/*/_JOB.md` 是否包含 `task: / created: / objective: / rollback:`（作业额外检查 `schedule:`） |
| **C4** | **声明产物存在性与半成品拦截** | 检查契约 `## 产物` 表中列出的入口文件是否真实存在；检查 `SHARED_OUT/` 下是否有 `.part` / `.tmp*` 半成品残留 |
| **C5** | **脚本硬编码路径检查** | 检查脚本是否写死工作区绝对路径（强制使用相对自身目录的动态定位，确保目录迁移不断链） |
| **C6** | **账本产物禁指过程树** | 拦截任何指向 `_proc` 目录的 `tb artifact` 登记 |

---

### 支柱 6：单区开箱即用与多区联邦扩展（Registry & Inbox）

* **单工作区场景**：只部署一个工作区（如前缀 `TASK`），上述五大支柱在同一目录内自闭环运行。
* **多工作区联邦场景**（例如按“系统运维区 / 项目开发区 / 自动化调度区”拆分为多个目录）：
  * 所有工作区共用**字节级同源**的 `tools/taskboard/tb.mjs`；
  * 在 `~/.dsh/taskboard/registry.json` 中注册各工作区的 `prefix` 与 `root` 路径；
  * **日常跨区协作遵循“写就近、读任意”**：A 区想给 B 区派活，不直接改 B 区账本，而是执行 `tb -Root <B区> inbox add "需求" --from <A区>`；
  * **全局巡检特权例外**：唯有自动化区的 `session-ledger-sync` 巡检员拥有跨区补账特权，可在每天凌晨统一扫描 `registry.json` 下所有工作区的增量会话，直接把漏记任务补入对应工作区账本并刷新看板。

---

## 三、如何在任意新环境从零复刻落地？（5 步通用路线图）

当你想在一台新机器或新工作区落地这套机制时，只需将以下 5 步交给执行 AI：

1. **Step 1：建立双树目录与配置（`board.config.json`）**
   * 创建 `TASKS/tasks`、`DELIVERY`、`SHARED_OUT/{packages,datasets,reports}`、`jobs`、`projects`、`docs`、`state/cursors`、`_proc`、`archive`、`tools/taskboard`；
   * 写入 `TASKS/board.config.json`（指定任务前缀 `prefix` 与 C1 根目录白名单）；若为多工作区，同步写入 `~/.dsh/taskboard/registry.json`。
2. **Step 2：部署零依赖引擎 `tb.mjs` 与自检套件 `selftest.mjs`**
   * 放入支持事件溯源、多视图 `rebuild`、双轨 `job-*` 子命令（`job-init / job-run / job-enable / job-disable / job-status / job-heartbeat`）与 `doctor` C1–C6 的 `tb.mjs`；
   * 运行 `node tools/taskboard/selftest.mjs`，确保在临时沙箱内 100% 断言通过。
3. **Step 3：若有存量散落文件，执行“只读盘点 $\rightarrow$ 无损归位 $\rightarrow$ 历史回填”**
   * 先查活跃进程与系统定时任务防断链；将存量工程归入 `projects/<slug>/`（配 `_MANIFEST.md`），临时日志与备份移入 `_proc`；
   * 将历史重要成果用 `tb new --ts` + `artifact` + `done` 回填进初始账本。
4. **Step 4：部署 `session-ledger-sync` 每日自动巡检补账作业**
   * 用 `tb job-init session-ledger-sync --driver dsh-schedule --schedule "0 4 * * *"` 初始化巡检作业；
   * 放入增量会话扫描器 `scan-sessions.mjs`，先执行 `--init-baseline` 锚定历史会话基线水位（存入 `state/cursors/session-ledger-cursor.json`）；
   * 注册每日凌晨 `04:00` 定时唤醒，实现未入账完结对话自动归档、未完结对话自动生成 `open` 待办任务。
5. **Step 5：写入 `AGENTS.md` 与 `SKILL.md` 并执行 `tb doctor` 终检**
   * 将“双树隔离判据、双轨自动化契约、Agent 开工/干活/尾行三步规范”写入工作区根目录 `AGENTS.md`，使后续进入该工作区的所有 Agent 自动继承规程；
   * 运行 `tb doctor` 确认 **0 警告 0 错误**，即完成交付。
