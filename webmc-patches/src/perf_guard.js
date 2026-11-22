/* perf-guard v1：低配自动降档（Alec 10-25："整体卡，优化客户端/网络/服务端，别优化我电脑"）
   ① WebGL 软件渲染检测（SwiftShader/llvmpipe/软件光栅）→ 立即降有效渲染距离 + 降像素比
      （动态分辨率：软件渲染下片段开销减半以上；DOM UI 不受影响）
   ② 帧时看门狗：2s 窗均帧 >45ms 且当前有效距离 >3 → 逐级降（0.7 步进，下限 3），只降不升
   ③ 与 bundle 原生 autoLowerRenderDistance（25ms/0.8 步进）互补：同一字段，双方都只写小值
   ④ 纯 console 诊断，零 UI（webmc 铁律 0）；window.__perf 可手动查询 */
(function(){
  var P = window.__perf = { v:1, soft:0, rd:0, base:0, fps:0, drops:0, pxr:0, err:0, ready:0 };
  function log(){ try{ console.log.apply(console, arguments); }catch(e){} }
  function wr(){ try{ var av=window.appViewer; return av&&av.backend&&av.backend.soundSystem&&av.backend.soundSystem.worldRenderer||null; }catch(e){ return null; } }
  function cmm(){ var w=wr(); return w&&w.chunkMeshManager||null; }
  function effRd(){ var c=cmm(); if(!c) return 0; return c.performanceOverrideDistance||w_viewDistance(); }
  function w_viewDistance(){ var w=wr(); return (w&&w.viewDistance)||10; }

  /* ---- ① 软件渲染检测：优先复用现存上下文，失败才开一次性画布 ---- */
  function glInfo(){
    try{
      var av=window.appViewer, r=null;
      if(av&&av.renderer&&typeof av.renderer.getContext==='function') r=av.renderer;
      var w=wr(); if(!r&&w&&w.renderer&&typeof w.renderer.getContext==='function') r=w.renderer;
      var gl=r?r.getContext():null;
      if(!gl){ var cv=document.createElement('canvas'); gl=cv.getContext('webgl2')||cv.getContext('webgl'); }
      if(!gl) return null;
      var ext=null; try{ ext=gl.getExtension('WEBGL_debug_renderer_info'); }catch(e){}
      var s=ext?(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||''):(gl.getParameter(gl.RENDERER)||'');
      return String(s);
    }catch(e){ P.err++; return null; }
  }
  function isSoft(s){ return /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(s||''); }

  function applyOverride(v, why){
    var c=cmm(); if(!c) return;
    var cur=c.performanceOverrideDistance||w_viewDistance();
    if(v>=cur) return;                       // 只降不升
    c.performanceOverrideDistance=v;
    P.drops++; P.rd=v;
    log('[perf] render distance %d -> %d (%s)', cur, v, why);
  }

  var boot=setInterval(function(){
    var c=cmm(); if(!c) return;
    clearInterval(boot); P.ready=1; P.base=w_viewDistance(); P.rd=effRd();
    var info=glInfo();
    log('[perf] GL renderer: '+(info||'unknown')+' | viewDistance='+P.base+' | eff='+P.rd);
    if(info&&isSoft(info)){
      P.soft=1;
      var target=Math.max(4, Math.min(5, P.base-4));
      applyOverride(target, 'software GL');
      /* 动态分辨率：找得到 THREE renderer 才降像素比 */
      try{
        var av=window.appViewer, r=(av&&av.renderer&&typeof av.renderer.setPixelRatio==='function')?av.renderer:null;
        var w=wr(); if(!r&&w&&w.renderer&&typeof w.renderer.setPixelRatio==='function') r=w.renderer;
        if(r){
          var cur=typeof r.getPixelRatio==='function'?r.getPixelRatio():1;
          if(cur>0.7){ r.setPixelRatio(0.7); P.pxr=0.7; log('[perf] pixelRatio %.2f -> 0.70 (software GL dynamic res)', cur);
            window.addEventListener('resize', function(){ try{ if(P.soft&&typeof r.getPixelRatio==='function'&&r.getPixelRatio()>0.7) r.setPixelRatio(0.7); }catch(e){} }); }
        }
      }catch(e){ P.err++; }
    }
  },1000);
  setTimeout(function(){ clearInterval(boot); },120000);

  /* ---- ② 帧时看门狗 ---- */
  var last=performance.now(), acc=0, n=0, chk=performance.now(), bad=0;
  function frame(){
    requestAnimationFrame(frame);
    try{
      var now=performance.now(), dt=now-last; last=now;
      if(dt>0&&dt<2000){ acc+=dt; n++; }
      if(now-chk>=2000){
        if(n){ P.fps=Math.round(1000/(acc/n)); }
        var avg=n?acc/n:0;
        if(avg>45){ bad++; } else { bad=0; }
        if(bad>=3){                            // 连续 6s 都 >45ms（<22fps）
          var cur=effRd();
          if(cur>3){ applyOverride(Math.max(3, Math.floor(cur*0.7)), 'sustained '+Math.round(avg)+'ms frames'); }
          bad=0;
        }
        acc=0; n=0; chk=now;
      }
    }catch(e){ P.err++; }
  }
  requestAnimationFrame(frame);
  log('[perf] guard v1 armed (auto software-detect + frame watchdog)');
})();
