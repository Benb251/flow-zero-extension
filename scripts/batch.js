/*
 * FlowZero Batch Download V1 - opt-in, manual selection only.
 * Never crawls a project or automatically retries uncertain downloads.
 */
(() => {
  if (window.__flowZeroBatchInjected) return;
  window.__flowZeroBatchInjected = true;
  const CARD_SELECTOR = ".tile-image-container, [data-test-id='media-tile'], [data-tile-id], flow-tile-container, flow-video-tile, flow-image-tile";
  const LIMIT = 20, STORE = "flowzero_batch_snapshot_v1";
  const selected = new Map();
  const ephemeral = new WeakMap();
  let serial = 0, mode = false, enabled = true, queue = null;
  let running = false, pauseRequested = false, toolbar = null, panel = null;
  let imageQuality = "2k";
  let observer = null, repaintScheduled = false;
  const project = () => location.origin + location.pathname + location.search;
  const bridge = () => window.__flowZeroBatchBridge;
  const uuid = () => "batch_" + crypto.randomUUID();
  const send = (message) => new Promise(resolve => chrome.runtime.sendMessage(message, result =>
    resolve(chrome.runtime.lastError ? {ok:false,error:chrome.runtime.lastError.message} : result || {ok:false,error:"No response"})));
  const save = async () => chrome.storage.local.set({[STORE]:queue});
  const cardKind = card => card.querySelector("video, [aria-label='Play'], [aria-label='Play video']") ? "video" : "image";
  function canonical(el) { return bridge()?.canonical?.(el) || null; }
  function identity(card) {
    const stable = card.getAttribute("data-tile-id") || card.querySelector("[data-tile-id]")?.getAttribute("data-tile-id");
    if (stable) return "tile:" + stable;
    if (!ephemeral.has(card)) ephemeral.set(card, "dom:" + (++serial));
    return ephemeral.get(card);
  }
  function resolve(item) {
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR))
      .map(canonical).filter(Boolean);
    const matches = [...new Set(cards)].filter(c => identity(c) === item.id && c.isConnected);
    return matches.length === 1 ? matches[0] : null;
  }
  function css() {
    const style = document.createElement("style"); style.id="flowzero-batch-css";
    style.textContent = `
      .flowzero-batch-checkbox { position:absolute; bottom:10px; left:10px; z-index:2147483646;
        width:29px; height:29px; border-radius:8px; border:2px solid white;
        background:rgba(13,20,31,.87); color:white; cursor:pointer; display:flex;
        align-items:center; justify-content:center; font-size:18px; box-shadow:0 1px 8px #0008; }
      .flowzero-batch-checkbox[aria-pressed="true"] {background:#2563eb;}
      #flowzero-batch-toolbar {position:fixed; bottom:16px; left:16px; z-index:2147483645;
        display:flex; gap:7px; align-items:center; flex-wrap:wrap; max-width:min(560px,calc(100vw - 32px));
        color:#fff; background:#111827; border:1px solid #475569; border-radius:12px;
        padding:10px; font:13px system-ui; box-shadow:0 4px 24px #0008;}
      #flowzero-batch-toolbar button, #flowzero-batch-panel button {padding:7px 10px; color:#fff;
        background:#334155; border:1px solid #64748b; border-radius:7px; cursor:pointer; font:inherit;}
      #flowzero-batch-toolbar button:disabled, #flowzero-batch-panel button:disabled {opacity:.4;cursor:not-allowed;}
      #flowzero-batch-panel {position:fixed; left:16px; bottom:76px; z-index:2147483645;
        background:#0f172a; color:#fff; border:1px solid #475569; border-radius:12px;
        padding:12px; width:min(420px,calc(100vw - 32px)); max-height:55vh; overflow-y:auto;
        font:13px system-ui; box-shadow:0 8px 30px #0009;}
      #flowzero-batch-panel h3 {margin:0 0 8px; font-size:15px;}
      #flowzero-batch-panel .fz-item {padding:6px 0; border-top:1px solid #334155; overflow-wrap:anywhere;}
      #flowzero-batch-panel .fz-warning {color:#fbbf24;}
    `;
    document.head.appendChild(style);
  }
  function node(tag, text, handler, parent, disabled=false) {
    const el=document.createElement(tag); el.textContent=text;
    if(tag==="button"){el.type="button";el.disabled=disabled; if(handler)el.addEventListener("click",handler);}
    parent.appendChild(el);return el;
  }
  function stopEvent(ev){ev.stopPropagation();ev.preventDefault();}
  function renderSelection() {
    document.querySelectorAll(".flowzero-batch-checkbox").forEach(btn=> {
      if(!mode || !enabled || running || !btn.parentElement?.isConnected) btn.remove();
    });
    if(!mode || !enabled || running) return;
    const cards = new Set(Array.from(document.querySelectorAll(CARD_SELECTOR)).map(canonical).filter(Boolean));
    for(const card of cards) {
      if(!card.isConnected || card.getBoundingClientRect().width < 80) continue;
      if(!bridge()?.source?.(card)) continue;
      const id=identity(card), existing=Array.from(card.children).find(c=>c.classList?.contains("flowzero-batch-checkbox"));
      if(existing){
        const checked=selected.has(id), label=checked?"✓":"+";
        if(existing.textContent!==label)existing.textContent=label;
        if(existing.getAttribute("aria-pressed")!==String(checked))existing.setAttribute("aria-pressed",String(checked));
        continue;
      }
      const btn=document.createElement("button");btn.type="button";btn.className="flowzero-batch-checkbox";
      btn.setAttribute("aria-label","Chọn media cho Batch Download");
      btn.setAttribute("aria-pressed",String(selected.has(id)));btn.textContent=selected.has(id)?"✓":"+";
      for(const type of ["pointerdown","pointerup","mousedown","mouseup","touchstart","click"])
        btn.addEventListener(type,ev=>{ev.stopPropagation();if(type==="click"){ev.preventDefault();toggle(card);}});
      if(getComputedStyle(card).position==="static") card.style.position="relative";
      card.appendChild(btn);
    }
  }
  function toggle(card) {
    if(running || queue?.items?.some(i=>["resolving","native_triggered","download_started"].includes(i.status)))return;
    const id=identity(card);
    if(selected.has(id)) selected.delete(id);
    else {
      if(selected.size>=LIMIT) {alert("Batch V1 tối đa 20 file.");return;}
      selected.set(id,{id,kind:cardKind(card),project:project()});
    }
    renderSelection();renderToolbar();
  }
  function selectVisible() {
    for(const card of new Set(Array.from(document.querySelectorAll(CARD_SELECTOR)).map(canonical).filter(Boolean))){
      if(selected.size>=LIMIT)break;
      if(card.getBoundingClientRect().width<80 || !bridge()?.source?.(card))continue;
      const id=identity(card);
      if(!selected.has(id))selected.set(id,{id,kind:cardKind(card),project:project()});
    }
    renderSelection();renderToolbar();
  }
  function renderToolbar(){
    if(!toolbar){toolbar=node("div","",null,document.body);toolbar.id="flowzero-batch-toolbar";}
    toolbar.replaceChildren();
    node("button",mode?"Thoát Batch Mode":"Batch Download",()=>{if(running)return;
      mode=!mode; if(!mode)selected.clear();
      chrome.storage.local.set({flowzero_batch_mode_v1:mode});renderSelection();renderToolbar();
    },toolbar,running);
    if(!mode && !queue){toolbar.hidden=!enabled;return;}
    toolbar.hidden=!enabled;
    if(mode) {
      node("span",selected.size+" / "+LIMIT+" đã chọn",null,toolbar);
      node("button","Chọn đang hiển thị",selectVisible,toolbar,running);
      node("button","Bỏ chọn",()=>{selected.clear();renderSelection();renderToolbar();},toolbar,running);
      const quality=document.createElement("select");
      quality.setAttribute("aria-label","Chất lượng ảnh hàng loạt");
      for(const opt of ["1k","2k","4k"]){
        const option=document.createElement("option"); option.value=opt;option.textContent="Ảnh "+opt.toUpperCase();
        option.selected=imageQuality===opt;quality.appendChild(option);
      }
      quality.style.cssText="background:#334155;color:#fff;border-radius:6px;padding:7px";
      quality.disabled=running||!!queue;
      quality.addEventListener("change",()=>{imageQuality=quality.value;});
      toolbar.appendChild(quality);
      node("button","Tải file đã chọn",start,toolbar,running||selected.size===0||!!queue);
    }
    if(queue) node("button", "Hàng đợi",()=>renderPanel(true),toolbar);
  }
  function renderPanel(show=false) {
    if(!panel){panel=node("div","",null,document.body);panel.id="flowzero-batch-panel";}
    if(!queue){panel.hidden=true;return;}
    if(!show && panel.hidden)return;
    panel.hidden=false;panel.replaceChildren();
    node("h3","Batch Download — "+queue.items.filter(x=>x.status==="completed").length+"/"+queue.items.length+" hoàn tất",null,panel);
    node("div","Mỗi file chỉ chuyển tiếp sau khi Chrome xác nhận đã lưu xong.",null,panel);
    if(running)node("button",pauseRequested?"Đang dừng…":"Dừng sau file hiện tại",
      ()=>{pauseRequested=true;queue.paused=true;save();renderPanel(true);},panel,pauseRequested);
    if(!running && queue.paused && queue.items.some(x=>x.status==="queued") &&
      !queue.items.some(x=>x.status==="needs_review"))
      node("button","Tiếp tục file đang chờ",resume,panel);
    if(!running) node("button","Đóng hàng đợi / chọn lại",async()=>{
      if(queue.items.some(i=>i.status==="needs_review") &&
         !confirm("Có tác vụ chưa rõ kết quả. Hãy kiểm tra Chrome Downloads trước khi đóng hàng đợi. Bạn đã kiểm tra?"))return;
      await send({action:"batchRelease",batchId:queue.id}); queue=null;selected.clear();
      await save();renderPanel();renderToolbar();renderSelection();
    },panel);
    for(const item of queue.items) {
      const line=node("div",item.kind+" · "+item.quality+" · "+item.status+
        (item.error?" — "+item.error:""),null,panel);
      line.className="fz-item"+(item.status==="needs_review"?" fz-warning":"");
    }
  }
  async function start(){
    if(running||queue||!enabled||!mode||!selected.size)return;
    const items=[...selected.values()];
    if(items.some(x=>x.project!==project())){alert("Project đã thay đổi, hãy chọn lại.");return;}
    // No URL or raw media data persisted. Card identity must be revalidated before each action.
    const id=uuid();
    queue={id,project:project(),paused:false,items:items.map(x=>({
      ...x,quality:x.kind==="video"?"720p":imageQuality,status:"queued",attemptId:null,downloadId:null,error:null
    }))};
    await save();renderToolbar();renderPanel(true);await run();
  }
  async function resume(){
    if(!queue || queue.items.some(x=>x.status==="needs_review"))return;
    queue.paused=false;await save();run();
  }
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  async function waitForResult(promise,timeout) {
    let timer;try {
      return await Promise.race([promise,new Promise(resolve=>timer=setTimeout(()=>resolve({
        success:false,uncertain:true,error:"Native download result unknown"}),timeout))]);
    } finally {clearTimeout(timer);}
  }
  async function waitForChromeDownload(downloadId) {
    const deadline=Date.now()+10*60*1000;
    while(Date.now()<deadline){
      const response=await send({action:"batchDownloadStatus",downloadId});
      if(response.ok&&response.state==="complete")return {status:"completed"};
      if(response.ok&&response.state==="interrupted")return {status:"failed",error:response.error||"Chrome download interrupted"};
      if(!response.ok)return {status:"needs_review",error:response.error||"Download status unavailable"};
      await sleep(650);
    }
    return {status:"needs_review",error:"Chrome download completion not confirmed"};
  }
  async function run() {
    if(running||!queue||!enabled)return;
    running=true;pauseRequested=false;renderToolbar();renderPanel(true);renderSelection();
    let acquired=false;
    try {
      const lease=await send({action:"batchAcquire",batchId:queue.id});
      if(!lease?.ok)throw new Error(lease?.error||"Cannot acquire batch lock");
      acquired=true;
      for(const item of queue.items){
        if(queue.paused||pauseRequested||!enabled||project()!==queue.project)break;
        if(item.status!=="queued")continue;
        const refreshed=await send({action:"batchAcquire",batchId:queue.id});
        if(!refreshed?.ok) {
          queue.paused=true;
          item.error=refreshed?.error||"Batch lease expired";
          await save();break;
        }
        const card=resolve(item);
        if(!card||cardKind(card)!==item.kind||!bridge()?.source?.(card)){
          item.status="skipped";item.error="Selected card missing or changed";await save();renderPanel(true);continue;
        }
        item.status="resolving";item.attemptId=uuid();await save();renderPanel(true);
        let initiated;
        try {
          initiated=await bridge().trigger(card,item.kind,item.quality,queue.id,item.attemptId);
          item.status="native_triggered";await save();renderPanel(true);
          if(!initiated.triggered){
            item.status="failed";item.error="Could not select native download";await save();continue;
          }
          const result=await waitForResult(initiated.result,90000);
          bridge()?.finish(queue.id,item.attemptId);
          if(result.uncertain){
            item.status="needs_review";item.error=result.error;queue.paused=true;await save();break;
          }
          if(!result.success || !Number.isInteger(result.downloadId)){
            item.status="failed";item.error=result.error||"Verified cleaned file unavailable";await save();continue;
          }
          item.downloadId=result.downloadId;item.status="download_started";await save();renderPanel(true);
          const verified=await waitForChromeDownload(result.downloadId);
          item.status=verified.status;item.error=verified.error||null;await save();renderPanel(true);
          if(verified.status==="needs_review"){queue.paused=true;break;}
        } catch(err) {
          item.status="needs_review";item.error=err.message||"Unknown attempt state";
          queue.paused=true;await save();break;
        } finally {bridge()?.finish(queue.id,item.attemptId);}
      }
    }catch(err){
      queue.paused=true;
      const first=queue.items.find(x=>x.status==="queued");
      if(first){first.error=err.message||"Cannot start batch";}
      await save();
    }finally{
      running=false;
      if(!queue.items.some(x=>x.status==="needs_review") && acquired)await send({action:"batchRelease",batchId:queue.id});
      if(!queue.items.some(x=>x.status==="queued") && !queue.items.some(x=>x.status==="needs_review"))
        queue.paused=true;
      await save();renderPanel(true);renderToolbar();renderSelection();
    }
  }
  async function init(){
    css();
    const stored=await chrome.storage.local.get(["flowzero_batch_mode_v1","flowzero_enabled",STORE]);
    mode=stored.flowzero_batch_mode_v1===true;
    enabled=stored.flowzero_enabled!==false;
    if(stored[STORE]?.items?.length){
      queue=stored[STORE];
      queue.paused=true;
      // In-flight work might have completed before the browser/tab restarted.
      // Never retry automatically without reconciliation.
      for(const item of queue.items) {
        if(["resolving","native_triggered","intercepted","processing","download_started"].includes(item.status)) {
          item.status="needs_review";item.error="Interrupted: check Chrome Downloads before restarting";
        }
      }
      await save();
    }
    renderToolbar();if(queue)renderPanel(true);
    if(mode)renderSelection();
    observer=new MutationObserver(()=>{
      if(repaintScheduled)return;repaintScheduled=true;
      requestAnimationFrame(()=>{repaintScheduled=false;renderSelection();});
    });
    observer.observe(document.body,{childList:true,subtree:true});
    chrome.storage.onChanged.addListener((changes,area)=>{
      if(area==="local"&&changes.flowzero_enabled){
        enabled=changes.flowzero_enabled.newValue!==false;
        if(!enabled && queue){queue.paused=true;pauseRequested=true;save();}
        renderToolbar();renderSelection();if(queue)renderPanel(true);
      }
    });
    window.addEventListener("popstate",()=>{if(queue){queue.paused=true;save();} selected.clear();renderSelection();renderToolbar();});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();