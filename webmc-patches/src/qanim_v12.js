
(function(){
  /* r42（官方动画移植）：逐行对照官方 minecraft-renderer src/three/entity/animations.js
     WalkingGeneralSwing.animate() 移植——腿/臂幅 0.5、相位速率 8*mb、moveBlend 平滑 k=dt*20、
     臂与同侧腿反相（leftArm 用 sin(t+PI)）、含官方臂 z 分量(cos*0.03±0.02PI)。
     每帧先复位默认姿态再加摆动（官方 _applyDefaults 语义，capture 记默认角）。
     官方对 mob 不驱动 isMoving（从不调 playAnimation），这里按官方数学用服务端位置 200ms 窗口
     判定移动（>0.1格/s）。四足腿无官方步态，用同一数学做对角反相扩展。钩子 onBeforeRender
     （Q.update 之后、画之前覆盖，绝不与 renderer 的加法 += 累加）。 */
  var W = window;
  function emTable(){
    try{
      var w = W.world;
      if (w && w.entities && w.entities.entities) return w.entities.entities;
      if (W.__wb && W.__wb.entities && W.__wb.entities.entities) return W.__wb.entities.entities;
      if (W.entities && W.entities.entities) return W.entities.entities;
    }catch(e){}
    return null;
  }
  var DEFS = new WeakMap();
  var frames = 0, mobs = 0, walk = 0, idle = 0, err = 0;
  W.__qAnim = {v:120, frames:0, mobs:0, hums:0, walk:0, idle:0, bow:0, err:0, rig:0};
  try { console.log('[qAnim] v91 | r129 物种分治:苦力怕整只跳过(脚不动)/蜘蛛8足独立步态/reRig旋转补偿(羊猪腿枢轴修复) | build=20261101u'); } catch(_){}

  function findBones(w){
    var legs = [], arms = [], tents = [], wings = [], all = [];
    w.traverse(function(o){
      if (!o.name || o.name.indexOf('bone_') !== 0) return;
      all.push({b:o, px:o.position.x, py:o.position.y, pz:o.position.z});
      var n = o.name.slice(5);
      var nl = n.toLowerCase();
      if (/^leg\d+$/.test(nl)) legs.push({b:o, n:n, kind:'quad'});
      else if (nl === 'leftleg' || nl === 'rightleg') legs.push({b:o, n:(nl === 'leftleg'?'leftLeg':'rightLeg'), kind:'biped'});
      else if (nl === 'leftarm' || nl === 'rightarm') arms.push({b:o, n:(nl === 'leftarm'?'leftArm':'rightArm')});
      else if (/^tentacle\d+$/.test(nl)) tents.push({b:o, n:n});
      else if (nl === 'rightwing' || nl === 'leftwing') wings.push({b:o, n:nl, kind:'bat'});
      else if (nl === 'rightwing_bone' || nl === 'leftwing_bone') wings.push({b:o, n:n, kind:'bee'});
    });
    return {legs:legs, arms:arms, tents:tents, wings:wings, all:all};
  }

  /* r48 pivot-fix：bundle 建骨用"绝对 pivot"却互相嵌套(EntityMesh.ts L295-337) → 子骨世界原点=
     父pivot+子pivot 双叠加(僵尸腿世界原点 [−1.9,36,0]，比真髋高 1.5 格)。静态时 SkinnedMesh.bind
     的逆矩阵按同错链算好完全抵消(静止正常)；一转就绕抬高了的中心转=腿根脱开缝隙+\"绕身子转\"。
     官方对 mob 从不播骨骼动画所以上游永远不暴露。修复：把\"自身或子孙被 skinIndex 使用\"的嵌套
     骨骼 position 相对化(减父 pivot 原值)后 mesh.bind 重算逆矩阵。数学闭环：T父×T(子-父)=T子绝对，
     bind 姿态分毫不变(静态不抖)，旋转中心回到真正腿身连接处。r52 修正：此前 rightItem 等附件骨
     不相对化 → 父链(rightArm)相对化后附件世界位置净移 -36(2.25格) → 骷髅弓掉进地下。全树统一
     相对化后由归纳法保证：任意 bone 世界原点=原始绝对 pivot，附件骨归位、蒙皮由 rest-inv 重算闭环。 */
  /* r49 实锤：此前 reRig 检查 w.isSkinnedMesh，但传入的 w 是实体容器(骨骼靠 traverse 才找到)
     → 永远 return 0，rig 恒 0，pivot 修复从未执行。改为 traverse 收集全部 SkinnedMesh 逐个处理；
     __qrDone 防同一骨骼被多 mesh 重复相减。 */
  var RBQ = []; /* r50：待 rebind 队列 */
  function reRig(w){
    var meshes = [];
    w.traverse(function(o){
      if (o.isSkinnedMesh && !o.__qRig && o.skeleton && o.skeleton.bones && o.skeleton.bones.length > 1 && o.geometry && o.geometry.attributes.skinIndex){
        o.__qRig = 1; meshes.push(o);
      }
    });
    if (!meshes.length) return 0;
    var n = 0;
    try{
      meshes.forEach(function(sk){
        var bones = sk.skeleton.bones, i;
        for (i = 0; i < bones.length; i++){ if (bones[i].__qrid === undefined) bones[i].__qrid = i; }
        var gi = sk.geometry.attributes.skinIndex;
        var used = {};
        for (i = 0; i < gi.count; i++){ used[gi.getX(i)] = 1; used[gi.getY(i)] = 1; }
        function mark(b){
          var r = !!used[b.__qrid];
          for (var c = 0; c < b.children.length; c++){
            var ch = b.children[c];
            if (ch.isBone && ch.__qrid !== undefined && mark(ch)) r = true;
          }
          if (r) b.__rig = 1;
          return r;
        }
        for (i = 0; i < bones.length; i++) mark(bones[i]);
        var orig = [];
        for (i = 0; i < bones.length; i++){ var b2 = bones[i]; orig.push([b2.position.x, b2.position.y, b2.position.z]); }
        for (i = 0; i < bones.length; i++){
          var b3 = bones[i];
          if (!b3.parent || !b3.parent.isBone || b3.__qrDone) continue; /* r52：去掉 __rig 条件=全树统一相对化 */
          var pi = b3.parent.__qrid;
          if (pi === undefined) continue;
          /* r129 reRig 旋转补偿：父骨带旋转(羊/猪 body rot.x≈-1.57)时，偏移必须旋转到父局部空间
   local = R父^-1 * (子绝对 - 父绝对)；旧减法只对无旋转父级成立。r126 对此类禁 reRig，
   但绝对 pivot 嵌套 bug 残留 = 羊腿摆动绕错中心 → 跑到体外/嵌进身体。现全模型统一 reRig+补偿。 */
var __pdx = b3.position.x - orig[pi][0], __pdy = b3.position.y - orig[pi][1], __pdz = b3.position.z - orig[pi][2];
try{
  var __pq = b3.parent.quaternion;
  if (__pq && (Math.abs(__pq.x) + Math.abs(__pq.y) + Math.abs(__pq.z)) > 1e-6){
    var __pv = new b3.position.constructor(__pdx, __pdy, __pdz);
    __pv.applyQuaternion(__pq.clone().invert());
    b3.position.set(__pv.x, __pv.y, __pv.z);
  } else { b3.position.set(__pdx, __pdy, __pdz); }
}catch(eQ){ b3.position.set(__pdx, __pdy, __pdz); }
          b3.__qrDone = 1;
          n++;
        }
      });
      if (n){
        /* r50：rebind 延迟到下一帧 onBeforeRender（renderer 已 updateMatrixWorld，容器世界矩阵
           已定稿）。r49 立即 rebind 时实体常未定位 → inverse 带巨大偏移(cow inv0=[682,28,22])，
           蒙皮基准错=牛猪四肢仍脱节。zombie/pig inv0 正常纯因 spawn 时序侥幸。 */
        RBQ.push({ w: w, meshes: meshes });
        W.__qAnim.rig += n;
      }
    }catch(e){ try{ W.__qAnim.err++; }catch(_){} return -1; }
    return n;
  }

  /* r126：父骨链旋转检测——任一腿/臂骨向上 10 层内父骨 rotation.x/z 绝对值>0.4 视为旋转模型 */
  function rotParent(g){
    function chk(b){ var o=b,i=0; while(o&&i++<10){ if(o.rotation&&(Math.abs(o.rotation.x)>0.4||Math.abs(o.rotation.z)>0.4)) return true; o=o.parent; } return false; }
    var i;
    for(i=0;i<g.legs.length;i++) if(chk(g.legs[i].b)) return true;
    for(i=0;i<g.arms.length;i++) if(chk(g.arms[i].b)) return true;
    return false;
  }

  function capture(d, g){
    /* 官方 _captureDefaults：只记默认姿态，动画=复位+加法；v45 铁律(v19 复活)：位置以静止为标准 */
    d.all   = g.all;
    d.legs  = g.legs.map(function(l){ return {b:l.b, n:l.n, kind:l.kind, rx:l.b.rotation.x, sx:l.b.position.x>0, sz:l.b.position.z<0}; });
    d.arms  = g.arms.map(function(l){ return {b:l.b, n:l.n, rx:l.b.rotation.x, rz:l.b.rotation.z}; });
    d.tents = g.tents.map(function(l){ return {b:l.b, n:l.n, rx:l.b.rotation.x}; });
    d.wings = g.wings.map(function(l){ return {b:l.b, n:l.n, kind:l.kind, rz:l.b.rotation.z}; });
  }

  var __qAnimLastTick = 0;
  /* r76（Alec 拍板）：生物全部回归引擎原生渲染。qAnim/reRig/位置平滑/可见性干涉全部停用——
     自研层与 bundle 原生渲染层互相打架（打生物飞天/闪烁的根因）。原生 molang 动画即原版观感。
     保留：mheld v3(手持+盔甲,已修 Z-fighting)、取证探针。 */
  function tick(){
    frames++;
    var __t0 = performance.now(), __tRB = 0;
    var __ppB=(window.__qPerf&&window.__qPerf.knobs.animBudget)||8; /* r128 设备分档节流 */
    if (__t0 - __qAnimLastTick < __ppB && RBQ.length === 0) return; /* r125: 30→8ms 满帧率步进，治四肢 33Hz 跳变 */
    __qAnimLastTick = __t0;
    try{
      /* r51 核心修复：r49/r50 用 sk.bind() 重算，但 bind 时实体已挂世界坐标 →
         inverse 混入世界坐标(cow inv0=[682,28,22]、rebind inv0=[-495,...]) → 蒙皮基准错。
         bundle 创建时是 mesh 在原点、matrixWorld=I 时 bind 的，正确约定=boneInverses
         =网格空间静止链(骨骼本地矩阵逐级相乘)的逆，与世界位置无关。bindMatrix 保持单位阵。 */
      if (RBQ.length){
        var __t1 = performance.now();
        var __ppRB=(window.__qPerf&&window.__qPerf.knobs.rebindBatch)||4; /* r128 分档预算 */
        var rb = RBQ.splice(0, __ppRB);
        for (var ri = 0; ri < rb.length; ri++){
          try{
            var rbonesAll = rb[ri].meshes;
            for (var rj = 0; rj < rbonesAll.length; rj++){
              var rsk = rbonesAll[rj], rbones = rsk.skeleton.bones;
              for (var rk = 0; rk < rbones.length; rk++){
                var rb3 = rbones[rk];
                rb3.updateMatrix();
                var rm = rb3.matrix.clone(), rp = rb3.parent;
                while (rp && rp.isBone){ rp.updateMatrix(); rm.multiplyMatrices(rp.matrix, rm); rp = rp.parent; }
                var rinv = rsk.skeleton.boneInverses[rk];
                if (!rinv) rinv = rsk.skeleton.boneInverses[rk] = rm.clone();
                rinv.copy(rm).invert();
              }
              rsk.bindMatrix.identity();
              if (!globalThis.__qRebindLogged){
                globalThis.__qRebindLogged = 1;
                var rel = rsk.skeleton.boneInverses[0].elements;
                console.log('[qAnim] rest-inv0=[' + [rel[12], rel[13], rel[14]].map(function(v){ return +v.toFixed(2); }).join(',') + ']');
              }
            }
          }catch(e){}
        }
        __tRB += performance.now() - __t1;
      }
      var T = emTable();
      if (!T) return;
      var now = performance.now();
      var animThisTick = 0;
      /* r67-revert：视锥剔除从相机 matrixWorldInverse 构造 Frustum，但 qAnim 在动画节流帧执行时该矩阵
         常被 bundle 尚未刷新->退化视锥把可见生物也判为屏外->动画全灭，且每帧 new Frustum/Matrix4 增开销。
         已移除(three 自身渲染已做剔除，这里无需重复)。 */
      for (var k in T){
        var w = T[k];
        if (!w || !w.originalEntity || !w.position) continue;
        var oe = w.originalEntity;
        if (oe.name === 'player' || oe.type === 'player') continue;
        var oep = oe.position;
        /* r75：reRig 改骨骼后几何包围球不再匹配实体位置 -> three 视锥把屏内生物误剔
           （表现=走近突然消失但还能打/远处闪烁）。生物 mesh 一律关视锥剔除。 */
        try{ if (w.frustumCulled) w.frustumCulled = false; }catch(e0){}
        if (oep && oep.y < -70){ if (w.visible) w.visible = false; continue; }
        /* r74：距离隐藏+滞回已删——在阈值上反复切 visible=远处生物贴图闪烁的根因。
           视距裁剪/雾效交给 bundle 自己管理；这里只在坠虚空时藏、回升即恢复。 */
        if (!w.visible) w.visible = true;
        /* r82：r75 只关了 wrapper 的视锥剔除，子 mesh（geometry_* 骨骼网格）仍默认 true；
           reRig/骨骼动画后蒙皮顶点远超 bind 包围球（僵尸 bone_rightItem y=-67），
           three 对每个 mesh 子节点单独剔除会把屏内生物误剔=闪烁残留。每帧全关（骨骼树小）。 */
        w.traverse(function(_fo){ if (_fo.frustumCulled) _fo.frustumCulled = false; });
        var d = DEFS.get(w);
        if (d === undefined){
          var g0 = findBones(w);
          /* r63：四足/无臂生物(猪牛羊鸡蜘蛛等)交给原版动画——reRig 把骨骼位置改"相对父级"并重算
             bind 逆矩阵，四足骨骼层级不同，这套变换会破坏 bind 姿势(网格被抬高/位移=看起来飞天、走路怪)。
             只对人形(有 arm 骨)启用 qAnim；其余整段跳过，原版 molang 动画正常播放。 */
          /* r118 qanim-class v2（Alec 定稿三类分治）：
             1 四足 cow/pig/sheep/...：reRig(修绝对pivot旋转中心)+对角腿摆，步频/幅度随实际速度
             2 人形 zombie/villager/...：reRig+腿摆(僵尸系摆臂，村民不摆)
             3 其他 squid/bat/bee/...：触手/翅膀独立相位，不 reRig
             r63"四足禁reRig"实为 v45 每帧 position 回写所致(r64已删)——不相对化则腿旋转中心
             高出一个身位=走路怪。恢复四足 reRig(r51 正确 bindMatrix 约定下数学闭环)。 */
          var _en = String(oe.name || oe.type || '').toLowerCase();
          /* r129 物种分治(Alec)：苦力怕脚不动(原版无腿部动画)→整只跳过；蜘蛛8足独立步态；蝙蝠翅膀独立(已有) */
if (_en === 'creeper'){ DEFS.set(w, null); W.__qAnim.skip = (W.__qAnim.skip || 0) + 1; continue; }
var isSpider = (_en === 'spider' || _en === 'cave_spider');
var isHum = /zombie|skeleton|wither|piglin|villager|witch|evoker|vindicator|illusioner|pillager|enderman|husk|stray|drowned|giant|zoglin|zombified|vex/.test(_en) || g0.arms.length > 0;
          var isQuad = !isHum && !isSpider && (/^(cow|pig|sheep|horse|donkey|mule|wolf|cat|fox|goat|llama|trader_llama|hoglin|ocelot|panda|polar_bear|mooshroom|ravager|strider|camel|chicken|frog|turtle|sniffer|armadillo)$/.test(_en) || (g0.legs.length >= 3 && !g0.tents.length && !g0.wings.length));
          var isOth = !isHum && !isQuad && !isSpider;
          if (isOth && !g0.tents.length && !g0.wings.length){ DEFS.set(w, null); W.__qAnim.skip = (W.__qAnim.skip || 0) + 1; continue; }
          /* r126 reRig 门槛：父骨链有显著旋转（猪/牛 body rot.x≈-1.57）时禁 reRig。
             相对化是平移合成，过旋转父级=骨骼原点被搬离真关节（猪腿原点被抬到 y≈24px，真髋在 y≈6px），
             rebind 后静止看着正常，但旋转枢轴错=一摆腿就脱离身体/穿模。此类保持 bundle 原生枢轴（真关节）。 */
          var _rigged = false;
          if (!isOth){ reRig(w); _rigged = true; } /* r129 旋转补偿后全模型统一 reRig（撤 r126 rotParent 门槛） */
          /* itemfix-bone v1（r124）：bundle 内置几何 rightItem pivot 是坏值 [-1,-45,-5]（原版= [-6,15,1]），
             reRig 相对化后 item 骨在手臂下方 45~67px → 弓/剑掉到脚下。归位到手上（vanilla 相对偏移）。
             必须在 reRig 之后改：reRig 只减父枢轴一次，改后的值不再被动。qAnim 每帧只写 rotation，位置可保。 */
          if (_rigged) w.traverse(function(ib){
            if (!ib.isBone) return;
            var ln = (ib.name || '').toLowerCase();
            if (ln === 'bone_rightitem' || ln === 'rightitem') ib.position.set(-1, -7, 1);
            else if (ln === 'bone_leftitem' || ln === 'leftitem') ib.position.set(1, -7, 1);
          });
          if (!g0.legs.length && !g0.arms.length && !g0.tents.length && !g0.wings.length){ DEFS.set(w, null); continue; }
          d = {legs:null, arms:null, tents:null, wings:null, last:null, hist:null, ph:0, phB:0, phS:0, mb:0, hum:false, cls:(isHum?'hum':(isQuad?'quad':(isSpider?'spider':'oth')))};
          capture(d, g0);
          d.hum = isHum;
          DEFS.set(w, d); mobs++;
          if (isHum) W.__qAnim.hums++; else if (isQuad) W.__qAnim.quad = (W.__qAnim.quad || 0) + 1; else W.__qAnim.oth = (W.__qAnim.oth || 0) + 1;
          continue; /* 首帧只采样默认姿态 */
        }
        if (!d) continue;
        /* r69 动画范围=视野内：冻结半径 24格->64格(=隐藏半径)，视野内生物全部播动画 */
        /* r80：原引用 pb 已随旧补丁删除=每帧 ReferenceError 中断整个 tick（err=81 实锤），
           动画/可见性恢复全停。改用 bot.entity.position（本地玩家坐标）做 LOD 锚点。 */
        var _pp = (W.bot && W.bot.entity && W.bot.entity.position) || null;
        if (_pp){ var qdx = oep.x - _pp.x, qdz = oep.z - _pp.z; if (qdx*qdx + qdz*qdz > 4096) continue; }
        if (animThisTick >= 12) continue;
        /* r64：删掉 v45 的"每帧把骨骼 position 强制拉回静止"——那段把原版 molang 动画
           （僵尸头/身摆动、村民手臂等）整体冻住=你看到"僵尸改坏/怪"。r42 没有这段=正常。
           现在只做加法旋转（腿/臂摆），其余骨骼交给原版动画自由播放。reRig 保留(r42 就有)。
           d.all 不再参与每帧写回。 */
        var dt = d.last ? Math.min(0.1, Math.max(0, (now - d.last.t) / 1000)) : 0.016;
        if (!isFinite(dt)) dt = 0.016;
        /* r67：hist 用预分配环形缓冲，消除每帧对象分配(GC 抖动->偶发长帧) */
        var hs = d.hist;
        if (!hs){ hs = d.hist = { buf: new Array(24), w: 0, n: 0 }; for (var _h = 0; _h < 24; _h++) hs.buf[_h] = {t: 0, x: 0, z: 0}; }
        var _b = hs.buf[hs.w]; _b.t = now; _b.x = oep.x; _b.z = oep.z; hs.w = (hs.w + 1) % 24; if (hs.n < 24) hs.n++;
        var ha = hs.buf[(hs.w - hs.n + 24) % 24], hb = hs.buf[(hs.w - 1 + 24) % 24];
        var win = Math.max(0.05, (hb.t - ha.t) / 1000);
        var sp = Math.hypot(hb.x - ha.x, hb.z - ha.z) / win;
        if (!isFinite(sp)) sp = 0;
        if (sp > 6) sp = 6;
        /* r126: d.last 复用同一对象（原来每帧每只 new 一个=纯 GC 压力） */
        if (d.last){ d.last.x = oep.x; d.last.z = oep.z; d.last.t = now; } else d.last = {x: oep.x, z: oep.z, t: now};
        /* ↓↓↓ 官方 WalkingGeneralSwing.animate() 数学，逐行对应 ↓↓↓ */
        /* r127：幅度随实际速度缩放（不再是"动起来就满幅"的行军感）。
           静止基准=rx，慢走小摆、快走大摆，符合"以静止为基准只动角度"；
           sp 已用 24 帧环形缓冲平滑，这里再 dt*12 二次平滑避免起停跳变。 */
        var targetMag = sp > 0.08 ? Math.min(1, sp / 0.5) : 0;
        d.mb += (targetMag - d.mb) * Math.min(1, dt * 12);
        var mb = d.mb;
        if (!isFinite(mb)) mb = 0;
        if (animThisTick < 12) {
          animThisTick++;
          d.ph += dt * (2.5 + sp * 1.7) * mb; /* r125: 步频统一∝实际速度(人形原来写死8=滑步根因)，四足沿用 r118 公式 */
        var t = d.ph;
        d.phB += dt * 26;
        d.phS += dt * 1.6;
        if (mb > 0.05) walk++; else idle++;
        var sL = Math.sin(t), sR = Math.sin(t + Math.PI);
        var _amp = (d.cls === 'spider') ? 0.28 : ((d.cls === 'quad') ? 0.45 : 0.5); /* r129 蜘蛛小幅独立步态 */ /* r127：基础幅度统一，速度缩放交给 mb（避免双重缩放） */
        /* 官方腿: leftLeg.x+=sin(t)*0.5*mb / rightLeg.x+=sin(t+PI)*0.5*mb（四足=同式对角配对） */
        for (var i = 0; i < d.legs.length; i++){
          var L = d.legs[i], s;
          if (L.kind === 'biped') s = (L.n === 'leftLeg') ? sL : sR;
          else if (d.cls === 'spider') s = ((i & 1) === 0) ? sL : sR; /* r129 蜘蛛8足左右交替 */
          else s = (L.sx === L.sz) ? sL : sR;
          L.b.rotation.x = L.rx + s * _amp * mb;
        }
        /* 官方臂: leftArm.x+=sin(t+PI)*0.5*mb / rightArm.x+=sin(t)*0.5*mb + 官方 z 分量 */
        if (d.hum){
          /* r44 原版铁律：官方 web 客户端对 mob 从不播手臂动画；原版 Java 只有僵尸/骷髅系
             行走摆臂(仅绕 x)。此前给全体 biped 摆臂+3.6° z 外倾(skinview3d 玩家皮肤专用)
             =末影人/村民等手臂离开身体——"关节没贴身子"真因，z 分量与 bow 常抬一并废除 */
          if (d.armSwing === undefined) d.armSwing = /zombie|skeleton|husk|drowned|stray|wither|piglin/i.test(String(oe.name || oe.type || ''));
          if (d.armSwing){
            for (var j = 0; j < d.arms.length; j++){
              var A = d.arms[j];
              if (A.n === 'leftArm') A.b.rotation.x = A.rx + sR * 0.5 * mb;
              else A.b.rotation.x = A.rx + sL * 0.5 * mb;
            }
          }
        }
        /* 官方无人形以外步态：触手/翅膀保留小幅独立相位 */
        for (var q = 0; q < d.tents.length; q++){
          var TN = d.tents[q];
          TN.b.rotation.x = TN.rx + Math.sin(d.phS + q * 0.6) * 0.18;
        }
        for (var wi = 0; wi < d.wings.length; wi++){
          var WG = d.wings[wi];
          if (WG.kind === 'bat'){
            var wsign = (WG.n === 'rightwing') ? 1 : -1;
            WG.b.rotation.z = WG.rz + Math.sin(d.phB) * 0.45 * wsign;
          } else {
            WG.b.rotation.z = WG.rz + Math.sin(d.phB * 1.5) * 0.5;
          }
        }
        }
      }
      var __dt = performance.now() - __t0;
      if (__dt > 150){ try{ console.log('[qAnim-perf] slow frame ' + __dt.toFixed(0) + 'ms (rebind=' + __tRB.toFixed(0) + ' loop=' + (__dt - __tRB).toFixed(0) + ' mobs=' + mobs + ' rigQ=' + RBQ.length + ')'); }catch(_){} }
    }catch(e){ err++; W.__qAnim.err = err; if (err <= 2){ try{ console.warn('qAnimErr:', e && e.message); }catch(_){} } }
    W.__qAnim.frames = frames; W.__qAnim.mobs = mobs; W.__qAnim.walk = walk; W.__qAnim.idle = idle;
  }
  /* r72 esmooth v3：实体位置帧间平滑。bundle 把 mesh 位置直接设成 mineflayer 收到的 20Hz 服务端位置，
     60fps 下=「走一段瞬移一段」；打生物的击退也是一次位置瞬跳=「它要跳」。此处在 bundle 写完位置
     之后(onBeforeRender)、画之前，把 mesh 位置向目标做指数平滑(τ=70ms)：小步渐移视觉连续；
     >1.5格(传送/落地修正)或 >250ms 停顿(卡顿恢复)直接贴合不拖影。
     铁律：只改 w.position(渲染)，绝不碰 originalEntity.position(物理/命中判定/qAnim LOD 都用它)。 */
  var ESM = new WeakMap();
  /* r73 击退直通：entity_velocity 包(击退/弹射物必发)后 300ms 内该实体直接贴合服务端位置，
     不做 smoothing => 保留原版"弹开跳一下"手感；走路没有 velocity 包，平滑照常。 */
  var ESMV = {};
  (function(){
    var iv = setInterval(function(){
      try{
        var c = W.bot && W.bot._client;
        if (c && !c.__esmBound){ c.__esmBound = 1; c.on('entity_velocity', function(p){ try{ /* r80：只有击退级速度（与 mobvel 取证同阈值 vy>0.25 或水平>1.5）才直通；兔跳/碰撞小速度包照常平滑（治走路瞬移） */ var _vx=p.velocityX/8000, _vy=p.velocityY/8000, _vz=p.velocityZ/8000; if (_vy < 0.35 && (_vx*_vx + _vz*_vz) < 2.25) return; ESMV[p.entityId] = performance.now(); }catch(e){} }); clearInterval(iv); }
      }catch(e){}
    }, 1000);
    setTimeout(function(){ try{ clearInterval(iv); }catch(e){} }, 300000);
  })();
  function esmooth(){
    if (W.__esmoothOff) return; /* r115: A/B 取证开关 */
    /* r114 v2 根修：平滑目标=服务端权威位置 oe.position。v1 读渲染位置当目标=正反馈回路
       （每帧增益 1/(1-f)≈4.2 倍，指数飞走）→ 生物每秒被服务端包拉回=「隔一秒闪一下」实锤。 */
    var T = emTable();
    if (!T) return;
    var now = performance.now();
    for (var k in T){
      var w = T[k];
      if (!w || !w.originalEntity || !w.position || !w.visible) continue;
      var oe = w.originalEntity;
      if (oe.name === 'player' || oe.type === 'player') continue;
      var op = oe.position;
      if (!op || !isFinite(op.x) || !isFinite(op.y) || !isFinite(op.z)) continue;
      var kv = ESMV[oe.id];
      if (kv && now - kv < 300){ /* r115 恢复 r73 击退直通：击退级速度包后 300ms 直接贴合服务端位置，保留原版"弹开跳一下" */
        var st0 = ESM.get(w);
        if (st0){ st0.x = op.x; st0.y = op.y; st0.z = op.z; st0.t = now; }
        w.position.set(op.x, op.y, op.z);
        continue;
      }
      var st = ESM.get(w);
      if (!st){ ESM.set(w, {x:op.x, y:op.y, z:op.z, t:now}); continue; }
      var dt = now - st.t; st.t = now;
      var dx = op.x - st.x, dy = op.y - st.y, dz = op.z - st.z;
      if (dt > 250 || dx*dx + dy*dy + dz*dz > 2.25){
        st.x = op.x; st.y = op.y; st.z = op.z;
        w.position.set(op.x, op.y, op.z);
        continue;
      }
      var f = 1 - Math.exp(-dt / 70);
      st.x += dx * f; st.y += dy * f; st.z += dz * f;
      w.position.set(st.x, st.y, st.z);
    }
  }
  var boot = setInterval(function(){
    try{
      var w = W.world;
      if (w && w.scene && !w.scene.__qAnimHook){
        w.scene.__qAnimHook = 1;
        /* onBeforeRender：Q.update(renderer 官方加法动画)之后、画之前执行，我们的值=最终像素 */
        var prev = w.scene.onBeforeRender;
        w.scene.onBeforeRender = function(r, s, c, g, m, gr){
          if (typeof prev === 'function'){ try{ prev(r, s, c, g, m, gr); }catch(e){} }
          if (W.__esmoothOn === true) esmooth(); /* r117 退役：默认关闭。bundle 原生 TWEEN 链独立接管位置平滑与击退弧线；
             esmooth 作为第二写者与原生 tween 互搏=打一下"慢慢飞上天"。需要取证时 window.__esmoothOn=true 手动开 */
          tick();
        };
        clearInterval(boot);
      }
    }catch(e){}
  }, 500);
  setTimeout(function(){ clearInterval(boot); }, 150000);
})();
