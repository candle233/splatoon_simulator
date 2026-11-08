# 新增角色与场景报告（2026-10-26）

本轮通过工作流「新增角色与场景」交付：图鉴新增 2 名角色 + 第 5 张对战地图 tide_garden（潮汐庭园）。
门禁结果：**类型检查（shared 构建 + server/client --noEmit）全绿；vitest 全量 44 个测试文件 / 347 个用例全部通过**。
改动未 commit，全部留在工作区（与上一轮「细节扩展」迭代的未提交改动共存，见 `docs/iteration_2026-10-25.md`）。

---

## 一、新增角色（图鉴 Codex）

在 `client/src/ui/CodexData.ts` 的 CHARACTER_TAB 中新增 2 名角色（位于 squid_morph 之前，锦标赛 key art 收尾不变）：

| 角色 | 定位 | 配色 | 主武器 |
| --- | --- | --- | --- |
| 珊瑚礁歌姬（Coral Chanter / サンゴの歌い手） | 章鱼人形 · 区域封锁/支援 | 青绿 → 珊瑚橙 | 泡泡桶（Slosher） |
| 雷紫疾冲手（Volt Skimmer / ボルト・スキマー） | 墨水人形 · 高速游袭/远程压制 | 电紫 → 柠黄 | 充能水枪（Charger） |

- title / desc / tags 全部三语（zh desc 46–48 字，口吻对齐旧条目）。
- 徽章走新 i18n key `codex.badgeCoral` / `codex.badgeVolt`，zh/ja/en 三字典同步补齐；`client/src/style.css` 新增 `.codex-badge.coral` / `.codex-badge.volt` 样式。
- 立绘 2 张（`client/public/assets/characters/coral_chanter.jpg`、`volt_skimmer.jpg`）：独立复核发现初版为抽象渐变占位后已重绘为**完整角色插画**（珊瑚歌姬：青绿触手发 + 吹泡泡 + 提桶倾倒墨水；雷紫疾冲手：黄紫触手 + 耳机 + 科幻水枪），经图像视觉复核确认。
- 新增 `tests/characterCodex.test.ts` 守护（条目存在、图片存在、badge key 三语齐全，15 条用例）。

## 二、新增地图 tide_garden（潮汐庭园）

- `shared/src/types.ts`：MapId 联合类型扩为 5 项；`shared/src/maps.ts` 新增完整 MapDef——**155×155（全库尺寸唯一）**，中央高潮池 7 层同心叠台（pool_rim 3.6m → tide_needle 10.8m 逐层 1.2m 爬升）、4 条 tidal 坡道（rise 3.6 / len 12，精确衔接 pool_rim 边缘）、每象限镜像珊瑚柱组（climbablePillar，可攀爬）、周边掩体与阶梯（tidal_berm / kelp_row / lily_terrace / anemone_hill / coral_keep），spawnX=62 左右对称，zone {0,0,54,40}，主题青绿海水 + 珊瑚橙（sky 0x0B3D52 / groundBase 0x0E6E6E / accentA 0xFF7F50 / accentB 0x7FFFD4），paintSurfaces 覆盖外墙 + 中央池壁 + 百合台。
- `client/src/ui/LobbyScreen.ts`：MAP_METAS 补全 tide_garden 三语条目（scale / 垂直度 ★★★★☆ / peak 8.4m=tide_crown 顶 / 地标 / 层带 / 推荐武器，数值与实际布局一致）。
- `client/src/world/Arena.ts`：补齐 5 个必填 Record（RULES / PERIMETER / NEON / SIGNS / RAMP_STYLE）+ buildBackdrop / buildLandmarks / buildGiantBillboards 三个 mapId 分支（珊瑚丘、发光海藻尖塔、双潮汐环、发光珍珠、池缘四面屏、礁岩堡垒幕墙）。
- `client/src/rendering/MapArt.ts`：地板绘制器与天空穹顶绘制器各加 tide_garden 分支（湿滑青绿地面 + 潮汐同心环 + 沙色潮道 + 珊瑚点阵；层叠潮浪天际线 + 薄荷色太阳），避免误用极光图的雪地材质。
- 缩略图 `client/public/assets/maps/tide_garden.jpg`：初版与 aurora_outpost 逐字节相同（复核发现），已重新生成为独立图像（md5 已不同）；另有背景图 `client/public/assets/backgrounds/arena_tide_garden.jpg`（当前无活跃代码路径消费，属占位资产）。
- 测试：`tests/maps.test.ts` 首条用例更新为 five maps（≥5）+ tide_garden 专属 describe 6 条（id 注册、size=155 全库唯一、三语字段非空、障碍 id 无重复、出生点对称且在 zone 内、爬墙与可涂墙面存在）。

## 三、独立复核与修复记录

| # | 严重度 | 问题 | 状态 |
| --- | --- | --- | --- |
| 1 | high | 两张角色立绘初版为抽象渐变占位，图鉴卡片不可用 | ✅ 已重绘为完整角色插画（视觉复核确认） |
| 2 | medium | tide_garden 缩略图与 aurora_outpost.jpg 逐字节相同 | ✅ 已重新生成，md5 独立 |
| 3 | low | arena_tide_garden.jpg 背景为简单渐变 | 保留（无活跃消费路径的占位资产） |
| 4 | low | Arena.ts 楼梯材质规则为死代码（keep_st/anemone_st 被 brick/tile 规则先命中） | ✅ 已调整规则顺序，楼梯按预期渲染为 metal |
| 5 | low | arenaAssetMaterials.test.ts 三处硬编码旧 4 图，tide_garden 无覆盖 | ✅ 已扩展全景/天空/竞技场构建覆盖，并新增 tide_garden 构建用例 |

## 四、验收结果

- 类型检查：`node tsc -p shared` + `--noEmit -p server` + `--noEmit -p client` 全部通过（工作流门禁轮 + 收尾人工复验各一次）。
- 全量测试：`vitest run` → **44 文件 / 347 用例全部通过**（含新增 characterCodex 15 条、maps tide_garden 6 条、arenaAssetMaterials 扩展）。
- 独立复核：5 条发现，high/medium 全部修复，low 中 2 条已补修、1 条作为可接受占位保留。
- **真实浏览器端到端验证（2026-10-26 补充）**：
  - 图鉴：2 名新角色卡片渲染正确（插画、`codex-badge coral/volt` 徽章样式、zh/en 文案切换均验证）。
  - 大厅：地图选择出现第 5 张卡「潮汐庭园 155m × 155m ★★★★☆ 8.4m」，缩略图指向独立的 `tide_garden.jpg`。
  - 选图链路：点击 tide_garden → 服务器 `isValidMapId` 接受 → 房间配置持久 → 「立即开始比赛」开局成功。
  - **游戏内 3D 场景**：比赛在 tide_garden 真实开局（截图 `match-tide-garden-5273.png`）——青绿海水主题、地板潮汐同心环、TIDE MART 霓虹招牌、专属 minimap 布局、完整战斗 HUD，console 0 错误。
  - 验证用截图：`codex-characters-3.png`（图鉴新角色）、`lobby-map-select-tide-garden.png`（选图）、`match-tide-garden-5273.png`（游戏内）。

### 未覆盖项

- 多人联机对战下新地图的多客户端端到端验证（本次为单客户端 + 服务器权威模拟；bot 同场机制有单测覆盖）。
- 所有改动保留在工作区，未提交 git。

### 流程备注

- 工作流中 `world.run("npm", …)` 在 Windows 上经 cmd 解析 .cmd 垫片时引号转义损坏导致门禁假红，已改为 node 直调 tsc / vitest 真实入口后全绿。
- 运行末段（报告撰写步骤）因子代理模型配额耗尽（code 1005）中断，收尾验证与本文档由主会话直接完成；随后通过修订工作流（报告已在磁盘则跳过撰写 + 最终验收轮强制全新执行）使运行**正式完成**。
- 本地 dev 环境修复记录：lockfile 变更后 `tsx` 内嵌 esbuild（0.28.2）与平台二进制（0.25.12）错配导致 `npm run dev -w server` 无法启动；`npm install` 未能补齐缺失的 optional 平台依赖，已手动将 `@esbuild/win32-x64@0.28.2` 补装至 `node_modules/tsx/node_modules/`（若日后 `npm ci` 重装需重复此步，或执行 `npm i -D @esbuild/win32-x64@0.28.2` 固化）。
- 当前本机 dev 栈：游戏服务器运行于 3000（本会话启动，替代此前僵死的旧进程），客户端 vite 5273/5274 均可访问。
