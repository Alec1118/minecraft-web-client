# webmc 运行时补丁集（Alec 服 minecraft.aialec.cn）

对 zardoy/minecraft-web-client 构建产物（bundle `493.*.js` + `index.html`）的**运行时内联补丁**全集。
所有补丁以 `<script>` 块内联进 `index.html`，no-store 即时生效，不改 bundle 本体。
本目录 `index.html` 即线上部署版（2026-11-20 同步自 dist，md5 `b191cafe9a639b761b87b489c8a8476b`）。

## 部署方式

```bash
# 服务端 /opt/mwc-web/dist/
scp index.html root@server:/tmp/ && cp /tmp/index.html /opt/mwc-web/dist/index.html
# index.html / bundle / service-worker 均 no-store + CDN no-store，普通刷新即得最新
```

## 补丁清单

### 1. q-anim v11（人形生物动画，`src/qanim_v11.js`）

bundle 有 Bedrock 动画 JSON 但**零播放引擎**（四足纯平移），v11 补上：

- 挂 `world.scene.onAfterRender`（bundle 渲染**后**写入，夺回被 bundle 攻击动画覆盖的写权）
- 摆臂/摆腿：腿 `sin(ph)*0.85*mv`、臂 `sin(ph)*0.75*mv`，**对角步态**（右腿+左臂同相等幅反相）
- 速度归一 `sp/0.5` + EMA 平滑（防 tp 瞬移假速单帧爆幅）；僵尸 0.35m/s 步速 → 摆臂 ±0.5rad
- 拉弓：检测 `equipment[0]`/`heldItem` 含 bow → `rotation.x -= bowK*1.5`（**负值=前抬**，人形模型前向=+z）
- bundle 让位检测：骨骼 rotation 偏离 default >0.03rad 即放弃该骨（bundle 自己的动画优先）
- clamp ±1.3rad 防脱骨

历史坑：v6 骨头脱离（直接写 position）；v8 弓臂符号反（前向假设错误）；v9 以前 rAF 先注册先执行被 bundle 覆盖 → 全部重写为 onAfterRender。

### 2. bubble v7（气泡柱粒子+音效，`src/bubble_v7.js`）

Alec 反馈"岩浆块水下音效有、没气泡"：

- **渲染死因**：bundle 的 `worldRenderer.render()` 手动调用各子系统 `.render()`，不走 three `scene.traverse`——`scene.add()` 的裸 mesh 永远不进管线（`renderer.info.render.calls` 恒定 2 实证）
- **v5 修法**：照 waypoints 官方路径——独立 `bubbleScene` + `onRender.push(pass)`，pass 内 `autoClear=false → render(bubbleScene, camera) → 恢复`
- **v6/v7 修法**：chunk-relative 渲染——相机永在原点，mesh position 必须走 `sceneOrigin.toSceneX/Y/Z(世界坐标)`；外加 `frustumCulled=false` + `camera.updateMatrixWorld()` 双保险
- 实证：`pass` 每帧调 render，`info.render.calls=12` = 粒子数，12 个 mesh 全部真实绘制
- 柱型判定：`drag=true`→涡流（岩浆，下沉）/灵魂沙→涌流（上浮）；±6 扫描 + 服务端 particle 包辅路
- 音效：仅轴内触发，上浮/下沉不同（upwards_inside/whirlpool_inside + ambient），`__soundBridge` 优先、Audio 回退

### 3. q-itemfix v1（苹果连吃修复）

 bundle `startUsingItem` 开头 `if(this.itemBeingUsed) return;`——吃完不松手直接再按，activateItem 被吞 = "时好时坏吃不了"。
轮询检测使用态结束即清残留 + 放宽按下宽限窗。

### 4. q13 v5 / eat-anim v2 / useanim v5 等交互动画

- q13 v5：副手显示+姿势全崩修复（`globalThis.__qIsHand` 所在 webpack 模块是死码 → index.html 补定义）
- eat v2：4gt 平滑咀嚼（举嘴+咬合+微颤），松手 100ms 内立即停
- useanim v5：vanilla-priority + protocol-down
- offsync v1：副手 slots[45]→updateHeldItem 同步

### 5. perf-guard v1（低配自动降档，`src/perf_guard.js`）

- SwiftShader/llvmpipe 软渲染检出 → 视距 `max(4, base-4)` + 像素比 0.7
- 看门狗：2s 窗均帧 >45ms 连续 3 次 → 视距逐级降 `max(3, cur*0.7)`
- 每分钟 console 摘要（F12 可归因）；只降不升

### 6. 其他在线补丁

beacon v60（信标光柱）/ login-guard（#508 登录锁）/ webgl-guard（渲染兜底）/ cleanui v1 / fwfix v4 / fwrender v7（烟花）/ qremote v1（远程动作）/ warmup 等——全部内联于 `index.html`。

## 服务端配套（另仓 AlecTools）

TNTGuard v20：禁止放置/点燃/命令生成 TNT **和末影水晶**（`alectools/TNTGuard_v20.patch`）。

## 验证方法

```bash
# 无头 CDP 探针（.workbuddy/tools/_diag*.js）
node _diag15.js   # 白天气泡柱截屏 + 僵尸行走摆幅 + heap
# 真机：水下放岩浆块=下沉气泡柱，灵魂沙=上浮柱；刷怪蛋招僵尸看摆臂/拉弓
```


## 第二轮（build 20261024p, md5 8be82158）— 2026-10-25

### q-overfix v1（最重要）
**根因**：bundle 官方 CSS `#ui-root{position:fixed;...;z-index:8}` 没有 `pointer-events:none`——
全屏 GUI 层盖住 canvas，`document.elementFromPoint()` 永远命中它，所有右键被精准命中测试
判为 UI 点击拦截 → **`use_item` 包从不发出**（苹果/盾/放置全部"感觉没触发"的终极根因）。
修法：`#ui-root{pointer-events:none}` + 可交互控件单独 auto。上游值得修。

### bubble v8b（原版贴图）
- 粒子从 `THREE.SphereGeometry` 白球改为 **真原版贴图**：`textures/particle/bubble.png`
  （Mojang 官方 8x8 PNG，data URI 内嵌，NearestFilter 像素风）+ `THREE.Sprite` billboard。
- 静水触发语义：`bubble_column` 方块有效性由服务端每 tick 校验（流动水/水源不足自动移除），
  客户端只渲染真实存在的柱——扫到柱 = 服务端已判静水有效。
- 渲染路径同 v7（独立 bubbleScene + onRender + sceneOrigin 相对坐标 + frustumCulled=false）。

### q-anim v12（r42–r127 / 运行标记 v119）

> 文件名沿用 `src/qanim_v12.js`，但内容已演进到 r42–r127（标记 v119）。三类分治：
> 人形（zombie/skeleton/villager…）、四足（cow/pig/sheep/horse/spider…）、其他（squid/bat/bee…）。

**设计铁律（Alec 拍板）**：以生物静止姿态为基准，动画只写 `rotation`（腿/臂 rotation.x、翅膀/触手 rotation.z），
**绝不碰 position**（r64 删掉 v45 的“每帧把骨骼 position 拉回静止”——那段会把原版 molang 动画整体冻住）。
reRig 只修“绝对 pivot 嵌套”导致的旋转中心抬高（r49/r51 数学闭环），不平移骨骼。

**r127 幅度随速度缩放（治“动起来就满幅行军感”）**：
- 旧：`targetMove = sp>0.1?1:0` + `mb` 二值混合 → 任何移动都满幅摆（慢走也 28° 大摆，像行军）。
- 新：`targetMag = min(1, sp/0.5)`（24 帧环形缓冲平滑后再 dt*12 二次平滑）→ 慢走小摇、快走大摆，
  静止 mb→0 腿/臂回落到 rx 静止基准（“静止时每个都没问题”）。
- 四足基础幅度统一 0.45（去掉旧 `0.35+sp*0.04` 与 mb 的速度双重缩放，避免低速过僵）。
- 步态：四足按 `sx===sz`（x>0 与 z<0 同号）对角配对 = 前左+后右 / 前右+后左 同相（原版对角小跑）；
  人形左腿与左臂反相（同侧腿臂相反），僵尸/骨骼系才摆臂（原版铁律，村民/末影人不摇）。

非人形：蝙蝠 `rightWing/leftWing` 扇翅（rotation.z，WingTip 子骨自动跟随）；bee `wing_bone` 同式；
触手 `tentacle\d` 小相位独立摆动。

### q-shieldpose v1（主右副左）
bundle 举盾硬编码 `rightArm.position.set(0,.5,.12)`（x=0 拉回中线=居中）且永远抬右手。
修法：onAfterRender 后覆盖——主手盾右臂 x=+0.14（偏右）；副手盾改抬左臂镜像
（rotation z 反号、x=-0.14），右臂复位。

### 验证
- _diag23：CDP 真实右键 → q16 `fired:1 blocked:0` → MouseManager `upi:7 sui:7` → use_item 发出 ✓
- _diag26：气泡 v8b `cols=1 spawned=34 Sprite:1 bubbleCalls=73 err=0` ✓
- _diag25：骨骼名实测 bat(Wing/WingTip)/cow(leg0-3)/skeleton(人形 camelCase) ✓

## 第三轮（2026-11-20）— 信标光柱 beacon v60（对齐原版规则）

线上 dist 全量同步回本目录 `index.html`（md5 `b191cafe9a639b761b87b489c8a8476b`），含以下修复：

### beacon v60：激活/渲染两套判定统一到原版
- `isClear()`（激活判定）补 `.replace('minecraft:','')` 去命名空间前缀：此前 blockAt 返回
  `minecraft:beacon` 时匹配不到白名单，导致**信标上方叠信标被误判为不透明、整根熄灭**。
  修复后信标/玻璃/玻璃板/树叶/水/熔岩正确穿透。
- `isClear()` 与 `scanSegs()`（渲染判定）显式一致阻断 `tinted_glass` / `tinted_glass_pane`
  （原版遮光玻璃透光但阻挡光柱），两套判定不再矛盾。
- 不透明方块（石头/草方块等）阻断光柱；染色玻璃按 `floor((cur+new)/2)` 逐通道混色。
- 单测 `test_v60_isclear.js`（提取真实函数体 mock）：11/11 通过。
- 配套服务端：Paper `redstone-implementation` 保持 `VANILLA`（EIGENCRAFT 会破坏粘性活塞推/拉方块）。

### v61 (2026-11-21)
- Language packs chat13/chat9 -> chat14/chat10: isServerValid rejects ws://, wss:// and any address containing /, so wss://aialec.cn/mcws is no longer sent to api.mcstatus.io (was 404 every minute).
- Refreshed .gz after deploy: gzip_static served stale compressed JS until gzip -9 -k -f was rerun.
- SWV 290 -> 291; index.html synced with live dist (md5 89aa738c188082d1fb4041dd40d46b4a).

### v62 (2026-11-21)
- vprof diagnostic timer now opt-in via ?vprof=1 or #vprof; production no longer scans chunk sectionObjects and console.logs every 2s. SWV 291 -> 292.
- Cross-world render measurement: survival 32 entities / geo 193 / p95 150ms; AlecCity geo 24 / p95 83-100ms; pvp and parkour Multiverse spawns are in the void (need safe spawn coords).


## v63（2026-11-21）— 信标光柱脚本降频，根治 3 秒周期长任务（md5 a6cb866f）

**根因（有头真机 + CDP Tracing 实锤）**：非 GC（30s 仅 1 次 MajorGC）、非渲染。
`RunTask→TimerFire(timerId=5)→FunctionCall(script13:1056 col30)` 精确 3000ms 周期，
每次 75–142ms。定位到 beam-boot 信标脚本（index.html 内联 473–1064 行）：
- `setInterval(tick,1500)` 每轮 `tick()` 做 3×3 `getColumn`+81 次同步 `getBlockStateId`、
  `inspect()` 每信标 96 格 `blockAt`、`bgScan()` 全图 `findBlocks`（自注释"210ms 元凶"）、
  每 10 tick 遍历全部 sectionObjects 打日志。

**修法（5 处，仅改频率不动逻辑，blockUpdate 事件仍即时点亮/熄灭）**：
1. 主 tick interval 1500 → 3000ms
2. 3×3 列指纹检测 2000 → 8000ms
3. bgScan 全图 findBlocks SCAN_MS 2500 → 9000ms
4. 已知光柱遮挡重扫间隔 1000 → 2500ms
5. 诊断 log 遍历 sectionObjects 每 10 → 每 40 tick

**10 轮有头真机 A/B（Intel Iris Xe，主城 AlecCity 25–45s/轮，serviceWorkers:block）**：

| 轮次 | 方案 | ltN | ltSum | p99 | renderFps |
|---|---|---|---|---|---|
| r0 | 基线 | 9 | 695ms | 17 | 117.4 |
| r1 | 信标4项降频 | 3 | 202ms | 34 | 116.2 |
| r2 | 指纹30s（有害，回退）| 5 | 712ms | 66 | 77.5 |
| r3 | r1+inspect2.5s（**采用**）| **2** | **121ms** | **17** | **119.8** |
| r4 | idle compile（有害，回退）| 10 | 1334ms | 83 | 64.2 |
| r5 | tick5s（回退）| 3 | 277ms | 17 | 118.9 |
| r6 | cleanup15s（回退）| 4 | 361ms | 34 | 110.4 |
| r7 | evprobe600ms（回退）| 4 | 446ms | 17 | 117.7 |
| r10 | r3 长时45s 复验 | 4* | 283ms | 17 | 119.5 |

\* r10 的 4 个 longtask 间隔 12s（地形加载），不再有原 3s 信标列队。
上线：SWV 292→293；index.html CRLF 6421/6421；HTTP gzip 解压后 5 处标记实证全部命中。
回退项均因测量噪声或引入新卡顿被丢弃，最终仅 v3 组合上线。


## v64 (2026-11-21) — 单人创建世界页按原版重做 + 单人皮肤库"密码错误"根治
- 主体 UI 在 7.3MB bundle（md5 与线上一致），按铁律不动 bundle；全部走外部补丁注入。
- **根因1 单人皮肤"密码错误"**：线上 ui_menu v12g 用 `local=!bot.username` 判单人，
  但单人世界 bot.username='wanderer' 非空 → 误判多人 → 走 `/skinapi/apply`(需密码) → 报错。
  修：改用 singleworld 在 `singleplayer` 事件打的 `__alecSingle` 标记（只有单人派发该事件），
  单人 → localStorage 分支，绝不碰 /skinapi/apply。
- **根因2 种子不随机**：线上种子逻辑已被历史 #782 删光；恢复并改为
  `crypto.getRandomValues`，留空每次派发都新随机、不写回不持久化（跨世界绝不重复）。
  实测连续 8 次派发得 8 个不同种子。
- **创建世界页**：注入四游戏模式 survival/creative/adventure/spectator（替换原 disabled 按钮）、
  种子输入框(手填+🎲随机)、独立版本输入框(绕过 bundle 的 1.21.7 过滤，任意版本可选)、
  响应式 flex-wrap；劫持 singleplayer detail 写入 gameMode/seed/version。
- 新文件 `webmc_singleworld.js?v=sw1`；`webmc_ui_menu.js` v12g→v13。
- 三轮有头真机 A/B + 线上真机验证：四模式 gameMode=2 生效、版本1.21.7、种子123456789
  全部写入 detail；留空种子 8/8 唯一；单人皮肤库显示"单人/本地模式"；页面错误 0。
- 部署：index CRLF 6422/6422；SWV 293→294；HTTP gzip 解压实证 ui13/sw1 内容全部命中。


## v65 (2026-11-21) — 创建世界页视觉重构（原版样式/汉化/响应式）
- 用户反馈 v64 的视觉问题（此前只测 DOM 数值漏掉）：Create world/Use Mods 英文、框跑到屏幕外、样式不统一。
- **真机截图定位根因**（之前只看 DOM 数值是失误）：
  - screen-content 是 column + flex-wrap:wrap，插入 3 行后内容超高 → 整列被 wrap 到右侧（取消/创建 l=1310/1910 全在屏外）。改 nowrap 后回屏内。
  - 我手搓的绿框小按钮 ≠ 原生 button-KqXTeV（灰底/minecraft 10px/20px 高）。
  - zh.js(chat14) 未翻译 Create world/Use Mods，需补丁补译。
- **重构 webmc_singleworld.js**：
  - 所有控件改用 nativeBtn()/nativeInput() 克隆原生节点 → 样式 100% 一致。
  - nowrap 修复整列溢出；窄屏 form flex-wrap 让世界名/版本框换行不贴边。
  - 紧凑布局：label inline、4模式一行(窄96px)、种子/随机/版本同一行、删 WIP 提示行 → 取消/创建可见无滚动遮挡。
  - 汉化：Create world→创建世界、Use Mods→使用模组。
  - 保留 v64 全部功能（四模式/crypto真随机/任意版本/单人皮肤判定）。
- 三轮真机截图迭代(桌面1280+手机420) + 完整功能回归 + 线上真机验证全过：
  四模式 gameMode=2、种子123456789、版本1.21.7 写入 detail，随机种子 8/8 唯一，单人皮肤库"单人/本地模式"，无英文残留，页面错误 0。
- 部署：index 引用 sw1→sw2，CRLF 6422/6422，SWV 294→295，HTTP gzip 解压实证 nativeBtn/创建世界/使用模组/nowrap 全命中。


## v66 (2026-11-22) — 创建世界界面按原版重构 + 存档损坏根治 + 完整闭环实测
- 用户要求：全部按原版，不要自创4按钮；上网查证原版 Java Create New World = 三标签(游戏/世界/更多) + 点击循环切换按钮。
- **界面重构**（webmc_singleworld.js v3）：三标签"游戏/世界/更多"，循环按钮
  "游戏模式: 生存→极限→创造→冒险→旁观"、"难度: 和平→简单→普通→困难"、
  "世界类型: 默认→超平坦→草原→空世界→所有方块→下界"，"允许作弊: 开启"(webmc硬编码)。
  全部克隆原生 button-KqXTeV/input-Mraw77 样式；响应式(桌面/手机截图验证)。
- **可生效字段(真机核实 window.localServer)**：gameMode 0/1/2/3/4、difficulty 0-3、
  generation.name(6个真实支持值)、generation.options.seed、version。
  不可生效(webmc限制,如实说明)：允许作弊硬编码开、生成结构/奖励箱无此概念 → 原版这些项不硬凑。
- **种子"每次都一样" & 字符串种子损坏根治**：
  - 用户填字符串种子(如 ALICE123)→ webmc BigInt 崩溃 → 世界损坏进不去(正是"损坏进不了"根因)。
    修 normSeed()：纯数字直接用，字符串用 Java String.hashCode 转数字(贴近原版语义)。
  - 留空种子 crypto 真随机，每次不同(实测 4 次随机不同)，重进后稳定一致。
- ★**存档损坏根治(关键 bug)**：webmc 单人世界运行后 **不会自动写 level.dat**，
  reload 后世界列表扫描 `tb.C4()` 返回 undefined → zh.js `levelDat` TypeError → 世界被标 broken 无法进入。
  对照实验证实是 webmc/zh.js **既有 bug**(线上原样也复现，与补丁无关)。
  修：补丁 setInterval 每6s + beforeunload 自动 `window.localServer.writeLevelDat()` 确保落盘。
- **完整闭环实测**(线上真机，6 类型全过 6/6)：创建→配置→进世界→读 window.localServer 真实
  seed/difficulty/gameMode/genName→执行 /seed→WASD走动→reload→世界列表不broken→双击存档重新进入→配置一致。
  6 组合：生存/和平/默认+ALICE123、创造/普通/超平坦+随机、冒险/困难/草原+BOB456、
  生存/简单/下界+随机、极限/困难/默认+CHARLIE789、旁观/普通/空世界+随机。
- 部署：index sw2→sw3，SWV 295→296，CRLF 6422，HTTP gzip 解压实证 cycleRow/writeLevelDat/normSeed 全命中。
  测试脚本 full_e2e_live.js(线上闭环)、full_e2e.js(A/B)、probe_* 系列(根因定位)。


## v67 (2026-11-22) — 去掉“更多”标签/伪世界类型，修作弊开关与单人皮肤实时生效
- **查证**（Minecraft Wiki World_creation）：原版世界类型只有 默认/超平坦/巨型生物群系/放大化/单一生物群系/(调试模式)；
  bundle `16637` 生成器导出只有 grass_field/diamond_square/empty/superflat/all_the_blocks/nether，
  且 `default→diamond_square`、`flat→superflat`。→ 只保留 **默认 / 超平坦**，删掉“草原/空世界/所有方块/下界”等非原版项。
- **UI**：删掉整个“游戏/世界/更多”三标签（用户明确不要）；世界名+版本仍留原生顶部，
  其余 4 项排成两列网格 + 种子独占一行；窄屏(<=560)改单列、随机按钮换行、取消/创建 wrapper 50% 防溢出（420 宽实测全在屏内）。
- **允许作弊**：按钮文字改成仅 `开启`/`关闭`，可点击、可关闭；创建时写入 detail.allowCommands，
  并在 level.dat 落盘后强制同步 `levelData.allowCommands`（实测关=0、开=1）。
  注：webmc 本地服本身不按该字段做命令鉴权，这里保证存档设置与原版语义一致。
- **单人皮肤实时生效**（根因）：`webmc_ui_menu.js` 本地分支只写 localStorage，并调用从未定义的 `window.__localSkin`；
  同时 `webmc_skin.js` 每 10s 用 `/skinproxy/texture/wanderer` 覆盖回 Steve。
  修：①`installLocalFetch()` 在单人通用离线名下把该 URL 重定向到本地预设 PNG 字节（也处理 `_cape`，无披风返回 404）；
  ②`rendererApply()` 通过 webpack 方法表直调 `updatePlayerSkin(entityId, name, undefined, skinUrl, capeUrl)` 即时换肤，并同步物品栏预览；
  ③打开皮肤库时从 localStorage 恢复并重贴。原“密码错误”不再出现。
- **联机皮肤**：判断细化——单人且为通用离线名(wanderer/steve/alex)才走纯本地；若单人世界用的是真实账号，
  仍走服务端皮肤库，联机对端可经 `/skinproxy/texture/<名>` 看到。纯离线皮肤的字节只在本浏览器，
  跨客户端无法共享（浏览器隔离），自动化多客户端联机未连通，未做匿名服务端写入（安全考虑）。
- 部署：index ui13→ui14 / sw3→sw4，SWV 296→298，CRLF 6422，gzip 三文件重刷，HTTP 解压实证。
  真机验证 verify_live_v67.js 17/17 通过；mobile_v67.js 420 宽创建按钮 r=315<420。

## v68 (2026-11-22) 删种子“随机”按钮 + 种子随机性实证
- 按 Alec 要求删掉种子框右侧“随机”按钮（留空即随机，无需多余按钮）；删掉随之无用的 `toast()` 和窄屏 `rnd` 处理。
- 种子随机性真机实证：连续 5 次留空创建，`crypto.getRandomValues` 生成 5 个完全不同的种子
  （777238562 / 2132309032 / 185126640 / 427125470 / -1275853132，UNIQUE 5/5），删按钮后再测 5/5 仍全不同；
  每次 detail 传入值 == 实际世界 seed，确认随机真实生效。用户看到“固定种子”是重进同一存档所致，非创建随机失效。
- 部署：index sw4→sw5，SWV 298→299，HTTP gzip 解压实证（ref sw5 / 无随机按钮 / placeholder / SWV299 全中）；
  真机 verify_live_v68b.js 18/18 通过，皮肤 1364/1364 字节一致。
