# webmc 运行时补丁集（Alec 服 minecraft.aialec.cn）

对 zardoy/minecraft-web-client 构建产物（bundle `493.*.js` + `index.html`）的**运行时内联补丁**全集。
所有补丁以 `<script>` 块内联进 `index.html`，no-store 即时生效，不改 bundle 本体。
本目录 `index.html` 即线上部署版（build=20261024o，md5 `4d7cd83f61b2beca0ef915b29d978cc9`）。

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

beacon v21d（信标光柱）/ login-guard（#508 登录锁）/ webgl-guard（渲染兜底）/ cleanui v1 / fwfix v4 / fwrender v7（烟花）/ qremote v1（远程动作）/ warmup 等——全部内联于 `index.html`。

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

### q-anim v12（"手臂飞出去"根因修复）
**根因**：用 wrapper 场景坐标测速——玩家跨区块时 `sceneOrigin` 平移 → 所有 wrapper position
跳变 → 速度瞬间爆表 → 摆幅 0.85×1.9≈±1.6rad 甩过头顶（"飞出去但角度对"）。
修复：改用 `originalEntity.position`（mineflayer 世界坐标，无 sceneOrigin 跳变）+ sp>4m/s 瞬移保护。
非人形：蝙蝠 `bone_rightWing/leftWing` 扇翅（rotation.z，WingTip 子骨自动跟随）；
四足/蜘蛛/苦力怕 `bone_leg0-7` 奇偶交替步态（v11 已有，本轮实测骨骼名）。

### q-shieldpose v1（主右副左）
bundle 举盾硬编码 `rightArm.position.set(0,.5,.12)`（x=0 拉回中线=居中）且永远抬右手。
修法：onAfterRender 后覆盖——主手盾右臂 x=+0.14（偏右）；副手盾改抬左臂镜像
（rotation z 反号、x=-0.14），右臂复位。

### 验证
- _diag23：CDP 真实右键 → q16 `fired:1 blocked:0` → MouseManager `upi:7 sui:7` → use_item 发出 ✓
- _diag26：气泡 v8b `cols=1 spawned=34 Sprite:1 bubbleCalls=73 err=0` ✓
- _diag25：骨骼名实测 bat(Wing/WingTip)/cow(leg0-3)/skeleton(人形 camelCase) ✓
