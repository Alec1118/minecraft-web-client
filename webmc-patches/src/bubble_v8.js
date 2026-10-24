/* bubble-particles v8b：真原版贴图（textures/particle/bubble.png 8x8 data URI，Mojang 官方 PNG）
   + 静水触发：column 上方必须也是 water/bubble_column（活水下柱才冒泡，非静水不触发）
   + Sprite billboard（原版粒子=面向相机 quad），depthWrite=false
   v7 渲染路径保留：独立 bubbleScene + worldRenderer.onRender + sceneOrigin 相对坐标 + frustumCulled=false */
  /* bubble-particles v7：原版气泡柱粒子 + 气泡柱环境音（v5 2026-10-25 挂载修正）
   v4 死因（_diag8 实证 renderer.info.render.calls=2 恒定）：bundle 的 worldRenderer.render()
   是手动调用各子系统 .render()，不走 three scene.traverse —— 直接 sc.add() 的裸 mesh
   永远不进渲染管线（spawned/sphere 计数正常但肉眼不可见）。
   v5：照 waypoints 同款官方路径——独立 bubbleScene + worldRenderer.onRender.push(pass)，
   pass 内 renderer.autoClear=false → renderer.render(bubbleScene, camera) → 恢复。
   （waypoints.render() = renderer.render(waypointScene, camera) 即 bundle 自身用法。）
   保留 v4：depthTest=false 穿透 bundle 不透明水面；粒径 0.12；限流 10。 */
(function(){
  var TEX_URI='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAANUlEQVR42mMgCShu/f8fhrFKovMxOJ/+//8PxHCJ8ptQNkIBhMauAA4wFcAVYZVEFwRhZEkAFkw8ZCraQW4AAAAASUVORK5CYII=';
  var items=[], geo=null, mat=null, MAX=220, err=0, cols=0;
  window.__bubble={v:8, n:0, spawned:0, cols:0, err:0, inCol:0, colType:'', sndN:0, fbN:0};
  function ensure(){
    if(mat||!globalThis.THREE) return !!mat;
    try{
      var img=new Image();
      img.onload=function(){
        try{
          var cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
          cv.getContext('2d').drawImage(img,0,0);
          var tx=new THREE.CanvasTexture(cv);
          tx.magFilter=THREE.NearestFilter; tx.minFilter=THREE.NearestFilter;   // 原版像素风
          mat=new THREE.SpriteMaterial({map:tx, transparent:true, depthWrite:false, opacity:0.95});
          matReady=1;
        }catch(e2){}
      };
      img.src=TEX_URI;
    }catch(e){}
    return !!matReady;
  }
  var matReady=0;
  function wr(){ try{ return window.appViewer&&window.appViewer.backend&&window.appViewer.backend.soundSystem&&window.appViewer.backend.soundSystem.worldRenderer||null; }catch(e){ return null; } }
  function bscene(){
    try{
      var W=wr(); if(!W) return null;
      if(!W.__bubbleScene){ W.__bubbleScene=new (globalThis.THREE.Scene)(); }
      return W.__bubbleScene;
    }catch(e){ return null; }
  }
  function spawn(x,y,z,up,dist){
    try{
      if(!ensure()) return; if(!mat) return;
      var sc=bscene(); if(!sc) return;
      if(items.length>=MAX){ var old=items.shift(); if(old.m.parent) old.m.parent.remove(old.m); }
      if(!mat) return;              // 贴图未就绪
      var m=new THREE.Sprite(mat);
      m.scale.set(0.24,0.24,1);     // 原版 bubble 视觉尺寸
      m.renderOrder=999;
      m.frustumCulled=false;          // v7：气泡柱必现，防相机矩阵/朝向边缘情况被剔除
      sc.add(m);
      var life=Math.max(700, dist/1.2*1000*1.25+250)+Math.random()*300;
      items.push({m:m, ax:x+(Math.random()-0.5)*0.25, ay:y, az:z+(Math.random()-0.5)*0.25, vy:up?1.2:-1.2, born:performance.now(), life:life});
      window.__bubble.spawned++;
    }catch(e){ err++; }
  }
  function blockAtSafe(b, base, x, y, z){ try { return b.blockAt ? b.blockAt(new base(x,y,z)) : null; } catch(e){ return null; } }
  /* 柱型：'up'=涌流(灵魂沙,气泡上升) / 'down'=涡流(岩浆块,气泡下沉)。
     优先 blockstate.drag（drag=true 即向下拖），取不到则向下走 14 格找源头块。 */
  function colType(b, base, x, y, z, prDrag){
    if(prDrag!=null) return prDrag?'down':'up';
    for(var i=0;i<14;i++){
      var blk=blockAtSafe(b, base, x, y-i, z);
      if(!blk) break;
      if(blk.name==='bubble_column') continue;
      if(blk.name==='magma_block') return 'down';
      if(blk.name==='soul_sand') return 'up';
      break;
    }
    return 'up';
  }
  /* 原版主路：方块柱扫描（覆盖站在柱内/柱旁/柱上水面） */
  function scanColumns(){
    try{
      var b=globalThis.bot; if(!b||!b.entity||!b.entity.position) return;
      var bp=b.entity.position, base=bp.constructor||null;
      var blockAt=b.blockAt?b.blockAt.bind(b):(b.world&&b.world.getBlock?b.world.getBlock.bind(b.world):null);
      if(!blockAt||!base) return;
      cols=0; var made=0;
      var px=Math.floor(bp.x), py=Math.floor(bp.y), pz=Math.floor(bp.z);
      for(var dx=-6;dx<=6&&made<10;dx++)for(var dz=-6;dz<=6&&made<10;dz++){
        var cx=px+dx, cz=pz+dz, found=-1, prDrag=null, hasCol=false;
        for(var yy=py+1;yy>=py-5;yy--){
          var blk=blockAtSafe(b, base, cx, yy, cz);
          if(blk&&blk.name==='bubble_column'){
            found=yy; hasCol=true;
            try{ var pr=blk.getProperties?blk.getProperties():{}; if(pr&&pr.drag!=null) prDrag=!!pr.drag; }catch(e){}
            break;
          }
        }
        if(!hasCol) continue;
        // v8b 静水触发语义：bubble_column 块的有效性由服务端每 tick 校验
        // （流动水/水源不足时服务端自动移除该块）——客户端扫到柱=服务端已判静水有效。
        cols++;
        var up=(colType(b, base, cx, found, cz, prDrag)==='up');
        var top=found+1, guard=0;
        while(guard++<16){
          var ab=blockAtSafe(b, base, cx, top, cz);
          if(!ab||(ab.name!=='water'&&ab.name!=='bubble_column')) break;
          top++;
        }
        if(Math.random()<0.6){
          var h=up?(found+0.1+Math.random()*Math.max(0.3,top-found-0.2))
                  :(found+0.2+Math.random()*Math.min(3,Math.max(0.5,top-found-0.3)));
          var dist=up?(top-h):(h-found);
          spawn(cx+0.5, h, cz+0.5, up, dist);
          made++;
        }
      }
      window.__bubble.cols=cols;
    }catch(e){ err++; }
  }
  setInterval(scanColumns, 450);
  /* 辅路：服务端 bubble 包（字段：position/offset 为 Vec3，id 可为字符串或数字） */
  function hook(b){
    if(b.__bubbleHooked) return; b.__bubbleHooked=1;
    b.on('particle', function(p){
      try{
        if(!p) return;
        var pid=p.id;
        var isBub=(typeof pid==='string'&&pid.indexOf('bubble')!==-1)||(p.name&&String(p.name).indexOf('bubble')!==-1);
        if(!isBub) return;
        var pos=p.position||p, off=p.offset||{};
        var up=((off.y!=null?off.y:0)>=0);
        var n=Math.min(6, p.count||4);
        for(var i=0;i<n;i++) spawn(pos.x, pos.y+Math.random()*0.25, pos.z, up, 1.5);
      }catch(e){ err++; }
    });
  }
  var t=setInterval(function(){ if(window.bot){ clearInterval(t); hook(window.bot); } },500);
  setTimeout(function(){ clearInterval(t); },120000);

  /* ===== v5 渲染 pass：挂 worldRenderer.onRender（waypoints 同款官方路径） ===== */
  var lastT=performance.now(), passOn=0;
  function pass(){
    try{
      var W2=wr();
      var now=performance.now(), dt=Math.min(0.1,(now-lastT)/1000); lastT=now;
      var so=W2&&W2.sceneOrigin;
      for(var i=items.length-1;i>=0;i--){
        var it=items[i];
        if(so&&so.toSceneX){
          it.m.position.set(so.toSceneX(it.ax), so.toSceneY(it.ay), so.toSceneZ(it.az));
        }
        it.m.position.y+=it.vy*dt;
        it.m.position.x+=Math.sin(now/700+it.born)*0.04*dt*10;   // 极慢横向漂移
        if(now-it.born>it.life){ if(it.m.parent) it.m.parent.remove(it.m); items.splice(i,1); }
      }
      window.__bubble.n=items.length; window.__bubble.err=err;
      if(items.length){
        if(!W2||!W2.renderer||!W2.camera) return;
        var sc=W2.__bubbleScene; if(!sc) return;
        var ac=W2.renderer.autoClear;
        try{ W2.camera.updateMatrixWorld(); }catch(e){}
        W2.renderer.autoClear=false;
        W2.renderer.render(sc, W2.camera);
        W2.renderer.autoClear=ac;
      }
    }catch(e){ err++; window.__bubble.err=err; }
  }
  var boot=setInterval(function(){
    var W=wr();
    if(W&&W.onRender&&!passOn){
      passOn=1;
      W.onRender.push(pass);
      clearInterval(boot);
    }
  },500);
  setTimeout(function(){ clearInterval(boot); },150000);

  /* ===== 气泡柱原版环境音（仅轴内触发；上浮/下沉不同） ===== */
  var S={cur:'',lastAmb:0};
  function sndPlay(name, vol){
    try{
      var SB=window.__soundBridge;
      if(SB&&SB.playAt){ if(SB.playAt(name, null, vol, 0.9+Math.random()*0.2)){ window.__bubble.sndN++; return true; } }
    }catch(e){}
    try{
      var f=name.replace(/^minecraft:/,'').replace(/\./g,'/');
      if(/ambient$/.test(f)){ var mx=(f.indexOf('whirlpool')!==-1)?3:5; f+=(1+Math.floor(Math.random()*mx)); }
      var a=new Audio('/sounds/minecraft/sounds/'+f+'.mp3');
      a.volume=Math.min(0.7, vol||0.4);
      a.playbackRate=0.9+Math.random()*0.2;
      var pr=a.play(); if(pr&&pr.catch)pr.catch(function(){});
      window.__bubble.fbN++;
    }catch(e2){}
    return false;
  }
  function inColumn(){
    try{
      var b=globalThis.bot; if(!b||!b.entity||!b.entity.position) return null;
      var bp=b.entity.position, base=bp.constructor||null;
      if(!b.blockAt||!base) return null;
      var px=Math.floor(bp.x), py=Math.floor(bp.y), pz=Math.floor(bp.z);
      for(var dy=0;dy<=1;dy++){
        var blk=blockAtSafe(b, base, px, py+dy, pz);
        if(blk&&blk.name==='bubble_column'){
          var prDrag=null;
          try{ var pr=blk.getProperties?blk.getProperties():{}; if(pr&&pr.drag!=null) prDrag=!!pr.drag; }catch(e){}
          return colType(b, base, px, py+dy, pz, prDrag);
        }
      }
      return null;
    }catch(e){ return null; }
  }
  setInterval(function(){
    try{
      var t2=inColumn(), now=Date.now();
      if(t2){
        window.__bubble.inCol=1; window.__bubble.colType=t2;
        if(S.cur!==t2){ S.cur=t2; sndPlay(t2==='up'?'minecraft:block.bubble_column.upwards_inside':'minecraft:block.bubble_column.whirlpool_inside', 0.7); }
        else if(now-(S.lastAmb||0)>2200+Math.random()*1800){
          S.lastAmb=now;
          sndPlay(t2==='up'?'minecraft:block.bubble_column.upwards_ambient':'minecraft:block.bubble_column.whirlpool_ambient', 0.32);
        }
      }else{
        window.__bubble.inCol=0; window.__bubble.colType='';
        if(S.cur){ S.cur=''; S.lastAmb=0; }
      }
    }catch(e){ err++; }
  },400);
})();
</script>
