# Ink Arena 迭代报告 — 2026-10-25「细节扩展」迭代

本轮采用「四路并行头脑风暴 → 评选主编遴选 → 独立评审员对照源码复审 → 逐项实现 → 类型检查与全量单测门禁 → 成文交付」的流程。四个视角（玩法机制 GP / 场景细节 SC / 人物细节 CH / 手感与界面 FE）共提出 **12 个提案**，评选出 **4 项**（GP-1、GP-2、CH-1、FE-2）并全部实现。门禁结果：**typecheck 全绿，vitest 全量 44 个测试文件 / 339 个用例全部通过**（本文档第五节为本轮实测记录）。改动尚未 commit，全部留在工作区。

> 数据来源说明：现状盘点与提案清单取自本轮四个策划代理的读码产出与评选/评审记录；入选项实现说明已由成文时代理逐条对照 `git diff` 与测试源码核实；门禁数字为成文时代理在本工作区实测（命令与结果见第五节）。

---

## 一、四个视角的现状盘点

### 1. 玩法机制（GP）

- **已有什么**：机制骨架相当完整——5 种模式各有独立计分（`server/src/Match.ts`），10 主武器 / 7 副武器 / 5 大招全部走服务端权威模拟（`server/src/WeaponSimulation.ts`，各武器 fireRate 按 `shared/src/config.ts` 生效），12 个被动装备技能由服务端逐项乘算（`shared/src/skills.ts` + `WeaponSimulation.ts:115-159`），Brella 护盾与 Dualies 翻滚已有完整规则。迭代前基线实测：`npx vitest run` → 40 文件 / 303 用例全部通过。
- **明显缺口**：① BotAI 只有 PATROL/COMBAT/REFILL 三态，waypoint 纯随机，完全不感知占区（grep BotAI.ts 无任何 zone 引用）、无难度档、`skills` 恒为空数组——5 种模式里 4 种对 bot 房来说玩法等同涂地；② 大招落点写死，"按 E 随缘"。

### 2. 场景细节（SC）

- **已有什么**：地形与氛围骨架完整——`shared/src/maps.ts` 用镜像辅助函数定义 4 张对称图（60-80 障碍/坡道/可攀爬面/可涂墙 + 各自主题色），`client/src/world/Arena.ts`（约 2481 行）配齐天空穹顶、外墙剪影、旋转地标（吊臂/陀螺环/雷达罩）、霓虹爬墙导轨、海报/巨幅广告牌、漂尘与出生点穹顶。
- **明显缺口**：① 墙面涂料没有空间性——所有 PaintSurface 共用一张 512×512 canvas，按服务器下发的覆盖率标量从底往上填充，打哪里、打多少都不改变图案；② 可攀爬面与涂料零联动——squid 爬墙完全不检查墙面墨水归属；③ 氛围全是静态的——aurora_outpost 的极光画死在 canvas 上（`MapArt.ts:1424-1436`），而 `maps.ts:870` 的地图文案承诺 "under drifting aurora light"。

### 3. 人物细节（CH）

- **已有什么**：`client/src/player/PlayerView.ts`（约 2500 行）用共享缓存 + 分材质合并几何搭出完整低模战士：10 种武器专属持枪姿态、步行摆臂/呼吸/跳跃挤压拉伸/闪避倾斜，墨水罐液位随真实 ink% 联动、LED 低墨告警。状态表现有 8 块随 HP 递进的敌方墨渍、脚印涟漪、游泳尾迹、敌墨靴套、落地水花与死亡墨渍，并配 3 个测试文件。表情系统 5 种快捷消息全链路（按键 → 服务端 0.5s 限速 → DOM 气泡池 → zh/ja/en 三语）。
- **明显缺口**：① 墨渍/脚印/靴套只对本地玩家生效——`setGroundInk`/`setDamageStains` 仅本地调用，远程玩家的 hp 明明已在插值状态里却永远干净、不踩脚印；② 复活零演出（死亡侧很完整）；③ 6×5×5=150 套外观由 id 哈希纯随机，玩家无法选择、大厅无预览。

### 4. 手感与界面（FE）

- **已有什么**：反馈 juice 厚——按武器分档的开火 shake/recoil（`Game.ts`）、落地 dip+水花、服务端命中确认 → hit marker+金色粒子+击杀 chime、受击方向罗盘（`HUD.ts` + `ThreatAngle.ts`）、kill feed/splat callout/表情气泡。HUD/雷达/计分板齐全：血量墨水条、充能环、4 阶等高线雷达、Tab 计分板、F3 调试面板。性能底线好：PaintEngine 脏矩形 texSubImage2D+33ms 节流、角色静态件按材质槽 mergeGeometries、Arena 大量 InstancedMesh。
- **明显缺口**：① 命中反馈是二值的——`S2C_HIT_FEEDBACK` 只带 `{targetId,isKill}`，看不到敌人还剩几发；② 全部 SFX 单声道——所有声源直连 sfxGain，远距枪声只有 30u 距离门限 + 130ms 全局节流，背后与面前的枪声无差别；③ HUD/雷达存在每帧 DOM 重写路径。

---

## 二、全部提案清单与评选结果（12 项）

| 视角 | ID | 提案 | 工作量 | 结果 |
| :-- | :-- | :-- | :--: | :-- |
| GP | GP-1 | Bot 懂模式规则与难度 | M | ✅ 入选并实现 |
| GP | GP-2 | 涂地战延长赛 | M | ✅ 入选并实现 |
| GP | GP-3 | 大招落点可瞄 + 预警 | M | ❌ 落选 |
| SC | SC-1 | 空间化墙面墨迹 | L | ❌ 落选 |
| SC | SC-2 | 我方墨水门槛攀爬 | M | ❌ 落选 |
| SC | SC-3 | 会动的极光与终盘氛围 | M | ❌ 落选 |
| CH | CH-1 | 全员污渍脚印 | S | ✅ 入选并实现 |
| CH | CH-2 | 复活墨泉演出 | M | ❌ 落选 |
| CH | CH-3 | 可选外观系统 | M | ❌ 落选 |
| FE | FE-1 | 准星敌方血条与伤害数字 | M | ❌ 落选 |
| FE | FE-2 | 立体声方位音效 | M | ✅ 入选并实现 |
| FE | FE-3 | HUD/雷达每帧开销削减 | M | ❌ 落选 |

### 各提案要点与落选原因

**GP-1 Bot 懂模式规则与难度（入选）**：给 BotAI 注入 `{mode, zoneRect, 双方分数}` 上下文——占区/终盘推进模式中落后队把 waypoint 采进占区矩形、领先队在周边防守环带；TDM 朝最近敌人游走；同时新增 easy/normal/hard 难度预设并给 bot 配服务器实际生效的技能。价值：8 人 bot 房是本 demo 最高频游玩方式，4/5 模式由此真正成立。

**GP-2 涂地战延长赛（入选）**：仅对 turf_war——覆盖率差 ≤3pt 到期不结算，顺延最多 60s，期间分差拉开即结算，HUD 显示三语 OVER TIME。价值：把最后 30 秒从垃圾时间变成翻盘悬念，默认模式人人可感。

**GP-3 大招落点可瞄 + 预警（落选）**：inkstrike/ink_storm 落点改为视线-地面交点、激活前广播 1.2s 预警。落选原因：需把 WeaponSimulation 两段式 TPS 准星重建抽成公共函数并做一致性回归，射线-地面交点数学与观感风险是本轮 M 里最高的，且与 SC-1 同动 `WeaponSimulation.ts`；名额让给风险更低、受感面更广的 GP-2/FE-2。建议下轮与 SC-1 组成「武器可读性/墙面」主题。

**SC-1 空间化墙面墨迹（落选）**：每面墙独立画布 + `SurfaceInkEvent` 协议消息 + late-join 回放。落选原因：唯一 L 档，按「至多 1 项 L 且必须价值极高」的预算控制未入选——协议新消息、服务器事件环形缓冲、迟加入历史回放、每墙独立 CanvasTexture 是 12 项里实现与回归成本之最。建议独立成轮，与 GP-3 同做共享 WeaponSimulation 改动。

**SC-2 我方墨水门槛攀爬（落选）**：墙面我方墨水份额 ≥ 阈值才允许泳升，把涂墙变成打开垂直路线的钥匙。落选原因：服务器 20Hz 墙面份额与客户端预测的临界抖动需要快照容差设计，MovementSimulation/LocalPlayer 双侧对齐用例成本不低；本轮 4 席已满且受感面更窄（依赖玩家主动爬墙）。建议下轮与 SC-1 组成「墙面玩法」主题。

**SC-3 会动的极光与终盘氛围（落选）**：静态极光改为随时间位移的条带网格，最后 30 秒天空渐变。落选原因：非重复提案（GP-2 是 overtime 机制、SC-3 是纯客户端表现），但其 overtime 天空渐变依赖 GP-2 的快照标记先落地；极光动画独立价值偏氛围向，在「玩家可感知价值」排序居末。评审确认 `maps.ts:870` 的 "drifting aurora" 死图问题属实，值得排期。

**CH-1 全员污渍脚印（入选）**：把本地玩家已有的伤害污渍/脚印/蹚墨靴套管线接到远端角色——消费插值 hp 与本地 PaintGrid 采样，零新增网络流量。价值：「哪个敌人残血了」一眼可读是 Splatoon 类游戏的核心视觉语言；全场唯一 S 档。

**CH-2 复活墨泉演出（落选）**：出生点 0.35s 锥形墨水柱涌出动画。落选原因：与 CH-1 同域冲突——两者都改 `PlayerView.ts` + `Game.ts` + `tests/characterDetail.test.ts` 同一文件组，人物细节二选一取成本更低的 CH-1（S 对 M）。建议下轮作独立人物演出项，可与 CH-1 落地的脚印/污渍池化通道共享。

**CH-3 可选外观系统（落选）**：大厅头饰/上装/墨水罐三键自选 150 套已有外观并全端同步。落选原因：价值确认（已有美术资产变现为玩家自定义），但跨端同步回归面 12 项中最大——大厅广播、S2C_PLAYER_JOINED、断线重连、迟加入四条路径都要携带 cosmetics 且严防误入 20Hz 快照。建议独立成轮，配 `validation.ts` 单测先行。

**FE-1 准星敌方血条与伤害数字（落选）**：命中反馈从二值 hit marker 升级为「敌人名+剩余血条+飘出伤害数字」。落选原因：非重复提案，按文件冲突裁决——与 CH-1 都要改 `RemotePlayer.update` 同一方法（FE-1 缓存插值 hp、CH-1 驱动污渍）直接冲突；「敌人残血可读」本轮由更便宜的 CH-1 以墨渍形式承担。建议下轮与 FE-3 组成 UI 反馈主题。

**FE-2 立体声方位音效（入选）**：SoundManager 加可选 StereoPanner 声像支路 + 距离衰减，替换 30u 一刀切静音与 130ms 全局节流（改按方位扇区 × 武器大类键控）。价值：听声辨位是 TPS 核心操作信息，背后的敌人不再是隐形的。

**FE-3 HUD/雷达每帧开销削减（落选）**：签名去重跳过 innerHTML、小地图静态层离屏缓存。落选原因：纯性能优化，玩家只通过帧率稳定性间接感知，排序居末；且 `refreshI18n` 依赖每次重写换语言，跳过逻辑必须把语言切换视为签名失效，回归面涉及 HUD 全部文案。建议下轮与 FE-1 组成 UI 轮，用 `__inkArena.getFrameStats()` 量化验收。

### 评选与评审修订过程

评选主编按「玩家可感知价值优先、成本可控、文件不冲突、与服务器权威架构兼容」初选 GP-1/GP-2/CH-1/FE-2 四项。独立评审员对照源码复审：实测基线 `npx vitest run` → 40 文件/303 用例全绿（48.25s）；逐条核对行号绝大多数准确，但发现 **2 个「照单施工必然产出缺陷」的硬伤**——FE-2 原方案的 `cross(up, forward)` 公式在 yaw=0 朝 -Z 的相机约定下会得到左向量、全游戏声像左右反相；CH-1 原方案的 `lastHp` 缓存会让每调用只走一步 lerp(0.06) 的 `setDamageStains` 永不收敛（污渍停在首个透明度步长上）。另有 GP-1 原验收的统计口径脆弱、技能「作用于移速」为事实错误（server 全库无 `run_speed`/`swim_speed` 生效点）等。评选主编逐条修订后**四项全部保留、ID 不变**，修订点全部体现在最终实现中（见下节）。

---

## 三、入选项设计与实现说明

### GP-1 Bot 模式感知与三档难度

**玩家可感知**：bot 房里占区/TDM 模式终于"有人抢点、有人追人"；同一局里 bot 有明显的强弱档差距。

**设计**（`shared/src/config.ts:710-779`）：
- 新增 `BotDifficulty` 类型与 `BOT_DIFFICULTY_PRESETS`，三档数值：

| 档位 | aimErrorY | thinkIntervalMs | detectRange | fireChance | skills（服务器实际生效） |
| :-- | :--: | :--: | :--: | :--: | :-- |
| easy | 0.9 | 380ms | 24u | 0.75 | ink_saver, ink_recovery, quick_respawn |
| normal | 0.6 | 250ms | 36u | 1 | defense, special_charge, sub_saver |
| hard | 0.3 | 160ms | 44u | 1 | main_power, paint_boost, special_power |

  normal 即迭代前行为（0.6 瞄准幅度 / 250ms 决策基值 / 36u 索敌原为硬编码）；每档 3 个技能 ≤ `MAX_SKILL_SLOTS`，**全部避开 `run_speed`/`swim_speed`**——MovementSimulation 无 skillMultiplier，配上即是安慰剂档位（评审实测 server 全库 grep 此二 id 零命中）。`resolveBotDifficulty` 对非法值回落 `normal` 而不抛错。

**实现**：
- `server/src/BotAI.ts:153` 构造函数注入 `rng: () => number = Math.random`，类内 **13 处** `Math.random()` 全量替换为 `this.rng()`（含 `getMemory` 的 strafeDir 初始化——漏任何一处可复现断言即挂）；全文件仅剩构造函数默认值一处 `Math.random`（本轮 grep 实测）。
- `BotMemory.difficulty`（默认 'normal'）+ `setDifficulty`（`BotAI.ts:62,172`）；think 读预设驱动 detectRange（`:490`）、aimErrorY（`:554`）、fireChance（`:604`，`fireChance>=1` 短路保证 normal/hard 的 rng 流不受影响）与决策间隔（`:251-258`）。
- 新增 `export interface BotMatchContext { mode; zoneRect?; pinkScore; cyanScore }`（`BotAI.ts:28`），`think` 增加第 8 个可选参 `context`（`BotAI.ts:226`）——旧调用零改动。
- 模式感知挂在 `pickWaypoint` 开头的前置 `pickModeAwareWaypoint`（`BotAI.ts:355-446`）：splat_zones/final_push 落后侧 **100%** 在 zoneRect 每侧内缩 10% 的矩形内采样（`innerHalf = rect*0.4`）、领先侧在 +6u（`MODE_BAND_EXPANSION=6`）外扩环带采样、落入内缩区的样本按最近内边确定性推挤出环带（`MODE_BAND_CLEARANCE=0.5`）；team_deathmatch 偏向最近存活敌人 ±8u（`TDM_HUNT_JITTER=8`）；turf_war/无 context 走原漫游。采样后经 `getGroundHeightAt`+castRay 探针（与巡逻避障同模式）确认不落障碍，失败重试 ≤4 次（`MODE_WAYPOINT_RETRIES=4`）回退漫游。
- `server/src/GameServer.ts`：`addBot` 加第三参 `difficulty`（`:487`），经 `resolveBotDifficulty` + `sanitizeSkills` 写入 `bot.skills`（`:517`）并 `botAI.setDifficulty`（`:518`）；`C2S_LOBBY_ADD_BOT` 处理器透传校验 `data.difficulty`（非法回落 normal 不抛错，客户端现发 `{team}` 向后兼容零改动，`GameServer.ts:346-358`）；`fixedUpdate` 每 tick 懒构建一次 context 传入 think（`botContext ??= buildBotMatchContext(now)`，`GameServer.ts:571-583,771`）。
- 难度选择 UI 按 plan 留后续轮；**本期无新增 UI 文案，故无 i18n 改动**。

**测试**（`tests/bots.test.ts` 11→18 例，新增 7 例）：
1. 三档 `aimErrorY`/`thinkIntervalMs` 严格递减、`detectRange` 严格递增；
2. 三档 skills 非空、≤MAX_SKILL_SLOTS、唯一且不含 run_speed/swim_speed（防安慰剂档位回归）；
3. 同 seed mulberry32 双 BotAI 实例跑 50 tick（前 25 tick 有可见敌人走 COMBAT 蓄力枪 rng 路径、后 25 tick 无敌走 PATROL 选点 rng 路径），`input.yaw`/`input.fire` 序列 `toEqual` 完全相等；
4. splat_zones 落后侧（pinkScore:0/cyanScore:100）：静态 bot、thinkIntervalMs=0、now 从 2000 起 +1700ms 步进走 stuck 路径决策 40 次（断言 `stuckCheckAt===2000+39*1700` 证明 40 次全部重选），waypoint 100% 落在内缩区；
5. 领先侧同法 100% 落在外扩环带且不在内缩区；
6. team_deathmatch waypoint 100% 在最近敌人 ±8u 内；
7. `GameServer.addBot` 第三参写入 skills>0、`getLobbyState` 对应条目 skills 非空、非法难度串回落 normal 档不抛错。

### GP-2 涂地战延长赛

**玩家可感知**：涂地战最后关头双方胶着时，计时器附上「延长赛 / オーバータイム / OVER TIME」并金色脉冲高亮，比赛最多再打 60 秒；一旦分差拉开立即结算。

**设计**（`shared/src/config.ts:608-615`）：`OVERTIME_TRIGGER_PT = 3`（覆盖率百分点差阈值）、`OVERTIME_MAX_SEC = 60`；`shared/src/types.ts:279-285` 给 `MatchStateSnapshot` 加**可选** `overtime?: boolean`——旧客户端对 undefined 兼容，无破坏性协议变更。

**实现**：
- `server/src/Match.ts`：私有 `overtime` 标志（`:53`）；PLAYING 到期分支改为 turf_war 专用一次性顺延——`maybeStartOvertime`（`:280-287`）仅在 `mode==='turf_war' && !overtime && coverageGap() <= 3` 时置位并 `matchEndAt = now + 60_000`（`phaseChanged` 保持 false）；延长赛期间每 tick **先查**「差 >3pt 立即 endMatch」（`:217-222`）**再查**顺延耗尽（`:225-229`），只顺延一次；`coverageGap()` 走 PaintGrid O(1) 计数器（`:289-292`）；`overtime` 在 `resetModeScores`（`:84`）与 `startPlaying`（`:271`）双处清零防串局；`getSnapshot` 返回 `overtime`（`:388`）。
- `client/src/core/Game.ts`：快照处理存 `matchOvertime = state.overtime === true`（`Game.ts:1902`），`hud.updateMatch` 扩传第 6 参（`Game.ts:1200-1207`）；`remainingMatchSec` 由 `matchEndAt` 推导，顺延后倒计时自动变长。
- `client/src/ui/HUD.ts:186-205`：`updateMatch` 加可选 `overtime` 参，`lastMatchArgs` 扩为 6 元组（否则 `refreshI18n` 的 spread 重放会静默丢掉高亮）；计时器附缀 `t('hud.overtime')` 并切换 `.overtime` 高亮类。
- `client/src/style.css:560-577`：新增 `#match-timer.overtime` 金色 + `overtime-pulse` 1s 脉冲动画。
- `client/src/i18n.ts`：`hud.overtime` 三语齐备——zh『延长赛』（`:154`）/ ja『オーバータイム』（`:434`）/ en『OVER TIME』（`:714`）。

**测试**：
- `tests/matchModes.test.ts` 5→11 例（新增 6）：差 ≤3pt（u=0.25/0.75 镜像同半径同 seed 墨渍，前置断言 gap ≤ OVERTIME_TRIGGER_PT）到期后 phase 仍 PLAYING、`getSnapshot().overtime===true`、`matchEndAt===原值+OVERTIME_MAX_SEC*1000`、无 gameOverPayload；差 ≥5pt 到期即 GAME_OVER 且 winner 按覆盖率、overtime 保持 false；延长赛拉大差后 update() 立即结算 winner PINK；顺延耗尽 → GAME_OVER 且不再顺延（只顺延一次）；splat_zones 模式守卫到期照常结算；`startCountdown`/`startPlaying` 清零 overtime 标志。
- `tests/hudOvertime.test.ts` 新建 5 例（文件头 `@vitest-environment happy-dom`，pragma 先例 `emoteDisplay.test.ts`；仅挂 `#match-timer`，其余元素靠 HUD 空保护）：无 overtime 参不显示延长文案/类名（旧快照兼容）、`true` 时出现且文案为当前语言 `t('hud.overtime')` + `.overtime` 类、`refreshI18n()` 重放后高亮仍在（验证 lastMatchArgs 扩参）、延长结束后高亮移除、`setLang` 切语言后经 `ink:langchange` 重放渲染新语文案。
- `tests/i18nCoverage.test.ts` 8→9 例（新增 1）：断言 `hud.overtime` zh/ja/en 三语精确文案。
- 既有 `tests/matchState.test.ts` 同步适配 1 处（+12 行）：为 GAME_OVER 用例补一发决定性粉色墨渍，使覆盖率差明确超过触发阈值、不误触延长赛顺延。

### CH-1 全员污渍脚印

**玩家可感知**：对手/队友身上同样随 HP 浮现敌方墨渍、踩过墨地留下脚印涟漪、蹚敌墨时靴子染色——其余 7 个角色不再像干净的贴图。

**实现**：
- `client/src/player/RemotePlayer.ts`：构造函数预置 `view.setDamageStains(1)` 满血零污渍（`:54-56`）；`update()` 在 `updateLocomotion` 之前**每帧无条件** `view.setDamageStains(clamp(hp/100, 0, 1))`（`:89-92`）——不设 hp 变化缓存，因为 `setDamageStains` 每次调用只走一步 `lerp(0.06)`，缓存会让污渍停在首步透明度（≈0.033）永不收敛（评审发现的形同虚设缺陷）；带 `hp≤0 且 alive 视为插值无数据`的守卫（`InterpolatedPlayerState.hp` 缺省 0，防止把满血远端染成残血）；新增 `setGroundInk` 透传（`:109-111`）。
- `client/src/core/Game.ts`：remote 插值循环后新增 `sampleRemoteGroundInk`（`:1881-1897`，调用点 `:1167`）——约 10Hz 节流（100ms），`PaintEngine.getInkAt` O(1) 本地采样，`!alive` 跳过，覆盖 remotePlayers + botRemotePlayers，**零新增网络流量**；bot 循环内补 `remote.view.setDamageStains(bot.hp/100)`（`:1285`）使练习 bot 房对手同样生效。
- 无 i18n / 协议改动（typecheck 通过即为类型层证据）。

**测试**（`tests/characterDetail.test.ts` 7→9 例，新增 describe『remote player detail effects』2 例）：
1. 污渍——RemotePlayer 连续 40 帧 hp=100 插值 update（>30 帧满足 0.06 lerp 收敛）后，8 片污渍池（按共享几何体最大组识别，断言池大小 ===8）可见数为 0；改喂 120 帧 hp=20 收敛后可见污渍 >0 且每片 opacity >0.5（目标 0.55~0.75；单步 lerp 实现只会停在 ≈0.033，该阈值防形同虚设）；另附 hp=0+alive 40 帧不染色守卫断言。
2. 脚印——先 `scene.add(view.group)`（`attachToWorld` 依赖 `group.parent`，裸 view 会 no-op），`setGroundInk(Team.CYAN)` 后以 5m/s 连续 update 30 帧，在 scene 遍历到世界空间脚印 ring 且沿路径分布（maxX>2）；再以 1m/s（低于 1.5 生成阈值，保证池零复用、判定确定）移开 3m，断言被追踪 ring 的 x/y/z 与移开前 bit 级相等（留痕不跟随）。

### FE-2 立体声方位音效

**玩家可感知**：背后的敌人开枪，声音从背后传来；远处枪声随距离衰减而不是一刀切消失；30~35u 区间从「无声」变为「轻微可闻」。

**设计**（`client/src/core/SoundManager.ts:13-46`）：
- 新增导出纯函数 `panGainFor(camYaw, camPos, sourcePos) → {pan, gain, muted}`：复用 `combat/ThreatAngle.ts` 的 `threatAngle`，钉死约定 camYaw=0 朝 -Z、右=+X；`pan = sin(angle)`、`gain = 1/(1+dist/12)`、`dist > 35`（`SFX_MAX_DISTANCE=35`）静音。**刻意避开** `cross(up, forward)` 写法——该顺序在 `camForward=(0,0,-1)` 时得到左向量，照抄会全游戏左右反相且错误约定下的自洽单测发现不了（评审头号硬伤，已在实现与单测双向钉死方向）。
- `sfxOut(ctx, pos?)`（`SoundManager.ts:120-136`）：`pos` 存在且 `typeof ctx.createStereoPanner === 'function'` 时插入 StereoPanner→Gain 支路再入原总线；否则与旧行为完全一致。

**实现**：
- 迁移前 `this.sfxOut(ctx)` 共 48 处（全在 SoundManager.ts 内，本轮 `git show HEAD` 实测），**11 处**接入 `pos` 透传、37 处保持旧行为零改动；`playShoot / playChargerShot / playRollerFlick / playBucket / playSprayerShot / playCannonShot(双层) / playMarksmanShot / playScatterShot(双层) / playExplosion / playSpecialActivate` 十个方法加可选尾参。
- `client/src/core/Game.ts`：`handleShotEvent`（`:1516-1570`）删除 30u 硬静音与全局 130ms 单键节流（`lastRemoteShotSoundAt` 字段移除），改为 `soundPanAt`（`:1504-1514`，相机 yaw+位置经 `panGainFor` 定位 + threatAngle 八等分扇区号）定位——muted 直接 return——再以『扇区 × 武器大类』键控 130ms 节流（`remoteShotSoundAt` Map，`:134`，键数上限 8×武器类，永不无界增长）；`handleSubWeaponEvent` 爆炸音（`:1591-1596`，其内部 90ms 节流保留）与 `handleSpecialEvent` 激活音（`:1606-1610`）同走 pos 通道、muted 跳过。本地玩家自己的枪在入口已提前 return，不会双响。

**测试**（`tests/soundPan.test.ts` 新建 9 例）：
- 方向钉死 6 例：yaw=0 源在 +X → pan>0.9（同时 -X → pan<-0.9，防反相）、正前居中、正后方 |pan|<0.05 且 gain<1（前后对称不可分辨属正弦固有特性，由 gain 曲线承担距离信息）、距离递增 gain 严格递减、dist≤35 不静音而 >35 muted===true。
- 全链路 fake AudioContext 3 例：带 `createStereoPanner` 的 fake 播放一次远端射击（`playShoot({pan,gain})`，即 Game 真实调用形态），断言 panner 创建 1 次、`pan.value` 与 `panGainFor` 输出一致（10 位精度）、链路 shotGain→panner→衰减 gain→sfx 总线；无 pos 调用不创建 panner、直连总线（旧行为回归）；无 `createStereoPanner` 的 fake 播放带 pos 不抛错且 gain 仍 connect 到总线（fake 覆盖 initContext 全链路，经 `(globalThis as any).window={AudioContext:Fake}` 注入，无参构造懒初始化）。
- 手测项未单测化（按 acceptance 不计入）：双声道左开火只出左声道、8 bot 混战压缩器无呼吸、30→35u 从无声变 gain≈0.23-0.29（理论曲线 1/(1+d/12) 在 30u≈0.286、35u≈0.255）。

### 本轮工作区的伴随改动（同文件组、简报未单列）

- `client/src/core/SoundManager.ts` 新增 5 个 Brella/Dualies 音效方法：`playBrellaShot`（走 pos 通道）、`playBrellaShield`/`playBrellaBreak`（护盾展开/破碎音）、`playDualiesShot`（左右枪管音高分轨）、`playDualieDodge`（翻滚音）；`Game.ts` 本地开火分支（`:753,838,844`）与 `LocalPlayer.onShieldCue` 快照沿回调（`LocalPlayer.ts:71-72,401-410` → `Game.ts:1397-1400`）接线。
- `tests/trace-match.test.ts`（新建，1 例）：Match 阶段跳转的 console.log 调试探针（门禁调试期产物，随套件通过），**建议后续清理或改写为断言式用例**。
- `tests/matchState.test.ts` 的 +12 行适配已并入上文 GP-2 一节说明。

### 与本轮四项无关的并行改动（成文时检测到）

本轮成文期间，同一工作区有**其他并行工作流**在写入（文件时间戳晚于本轮门禁）：角色图鉴新增两名角色条目（`client/src/ui/CodexData.ts`）、对应测试 `tests/characterCodex.test.ts`（5 例）、i18n 的 `codex.badgeCoral`/`codex.badgeVolt` 三语徽标键、`style.css` 两条徽标配色、两张角色立绘资源。这些**不属于本轮四个提案**，但已包含在第五节的实测门禁数字里。提交前建议人工过一遍 `git diff` 区分两条工作线。

---

## 四、门禁与验证结果

| 检查 | 命令 | 结果 |
| :-- | :-- | :-- |
| typecheck | `npm run typecheck`（shared `tsc` 构建 + server/client `tsc --noEmit`） | ✅ 全绿（本轮实测） |
| vitest 全量 | `npx vitest run` | ✅ **44 个测试文件 / 339 个用例全部通过**（70.1s，本轮实测） |

**数字口径说明**（成文时核对）：
- HEAD（未含本轮改动）tracked 测试文件为 40 个（`git ls-files tests/` 计数），与任务简报基线一致。
- 本轮四项简报的测试增量：bots +7、matchModes +6、hudOvertime 新文件 +5、i18nCoverage +1、characterDetail +2、soundPan 新文件 +9、trace-match 新文件 +1——合计 +31 用例 / +3 新文件，对应 43 文件 / 334 用例。
- 实测 44/339 比该分解多出 1 文件 / 5 用例，即第三节所述并行工作流的 `characterCodex.test.ts`（5 例）——它也在本轮实测的全量套件里通过。
- 各实现者自报的累计预期（40/310 → 41/322 → 41/332 → 42/341）为**未跑全量的推算值**，与实测不符，以实测为准。

**实现期单文件自查记录**（实现工程师自报，均已包含在全量套件中）：`npx vitest run tests/bots.test.ts` 18/18、`tests/lobby.test.ts` 5/5、`tests/matchModes.test.ts + tests/hudOvertime.test.ts + tests/i18nCoverage.test.ts` 25/25、`tests/characterDetail.test.ts` 9/9、`tests/weaponIntegration.test.ts`（唯一引 Game.ts 的源码文本断言测试）10/10、`tests/soundPan.test.ts` 9/9；`grep -rn 'run_speed|swim_speed' server/src/` 零命中。

**既有测试兼容性核对**：`weaponIntegration.test.ts` 的 HUD 源码文本断言（只查 weaponThumbMap 键）与 matchState/gameModes 的快照断言（属性访问、非 toEqual 全形状）均不受本轮改动影响，全量套件实测通过。

**未覆盖项**：
- 真实浏览器与多人联机下的手感、画面与网络同步未实测（需 `npm run dev` 人工体验）；
- 新增音效的听感（声像方向、混战混音）、延长赛 HUD 观感、远端污渍/脚印的视觉效果未经人工视觉/听觉验收（手测项清单见 FE-2/CH-1 小节）；
- 8 bot 混战下新增声像支路的压缩器行为未量化。

---

## 五、遗留事项与后续建议

1. **难度选择 UI**：GP-1 本期只交付后端通路（协议字段 + 预设），大厅难度按钮留待后续轮接入（需三语文案）。
2. **落选提案排期建议**（评选记录原案）：GP-3 + SC-1 组成「武器可读性/墙面」主题（共享 WeaponSimulation 改动）；SC-2 并入墙面玩法；CH-2 复活演出独立作人物演出项；CH-3 外观系统独立成轮（validation 单测先行）；FE-1 + FE-3 组成 UI 反馈/提效轮；SC-3 极光氛围作 GP-2 之后的纯客户端后续项。
3. **清理项**：`tests/trace-match.test.ts` 为调试脚手架，建议下轮转为断言式用例或移除；本轮全部改动尚未 commit，且工作区存在并行工作线（角色图鉴），提交前建议人工审阅 `git diff` 后分开成组提交。
