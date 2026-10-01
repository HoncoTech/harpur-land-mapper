proj4.defs('EPSG:32645','+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs +type=crs');

const $ = id => document.getElementById(id);

let appConfig = null;
let googleLoaded = false;

// Saved Plots state
let savedMap = null;
let savedPlots = [];
let savedMarkers = new Map();
let savedInfoWindow = null;
let activeSavedPlot = null;
let selectedBBoxPolygon = null;
let allBBoxPolygons = new Map();

// Mobile Saved Plots state
let mobileSelectedPlotIds = new Set();
let mobileToolbarTimer = null;
let mobileDrawerOpen = false;
let mobileBoxesEnabled = true;
let mobileBBoxFillOpacity = 0.10;

// Add Plot state
let addMap = null;
let addConfig = null;
let currentSheet = localStorage.getItem('harpurSheet') || '01';
let overlayView = null;
let selectionMarker = null;
let selectedPlot = null;
let selectedPolygon = null;
let addRefreshTimer = null;
let lastOverlaySignature = '';

/* ----------------------------- NAVIGATION ----------------------------- */
function setView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  history.replaceState(null,'',`#${view}`);
  closeMobileMenu();

  // Google Maps needs resize after a previously hidden container becomes visible.
  setTimeout(() => {
    if(view === 'saved' && savedMap){
      google.maps.event.trigger(savedMap,'resize');
      if(isMobileSavedMode()){
        ensureAllMobilePlotsSelected();
        updateMobileSelectedVisibility();
        if(activeSavedPlot) focusSavedPlot(activeSavedPlot, false);
        else fitMobileSelectedPlots();
        showMobileToolbar(true);
      }else{
        if(activeSavedPlot) focusSavedPlot(activeSavedPlot, false);
        else fitAllSavedPlots();
      }
    }
    if(view === 'add' && addMap){
      google.maps.event.trigger(addMap,'resize');
      scheduleAddOverlayRefresh(true);
    }
  }, 50);
}

function openMobileMenu(){
  $('mobileMenu').classList.add('open');
  $('mobileBackdrop').classList.remove('hidden');
}
function closeMobileMenu(){
  $('mobileMenu').classList.remove('open');
  $('mobileBackdrop').classList.add('hidden');
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('hamburger').onclick = openMobileMenu;
$('closeMenu').onclick = closeMobileMenu;
$('mobileBackdrop').onclick = closeMobileMenu;

/* ----------------------------- GOOGLE SETUP ----------------------------- */
async function loadAppConfig(){
  const r = await fetch('/api/app-config');
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Could not load app config');
  appConfig = d;
  return d;
}

function injectGoogle(key){
  if(window.google?.maps){
    initGoogleMaps();
    return;
  }
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=initGoogleMaps`;
  s.async = true;
  s.defer = true;
  s.onerror = () => {
    $('keyModal').classList.remove('hidden');
    alert('Google Maps JavaScript API failed to load. Check the API key and allowed website restrictions.');
  };
  document.head.appendChild(s);
}

async function bootstrap(){
  try{
    await loadAppConfig();
    const stored = localStorage.getItem('harpurGoogleKey') || '';
    const key = appConfig.googleMapsApiKey || stored;

    if(key){
      $('apiKey').value = key;
      injectGoogle(key);
    }else{
      $('keyModal').classList.remove('hidden');
    }

    const hash = location.hash.replace('#','');
    if(['saved','add','about'].includes(hash)) setView(hash);
    else setView('saved');
  }catch(err){
    alert(err.message);
  }
}

$('loadGoogle').onclick = () => {
  const key = $('apiKey').value.trim();
  if(!key) return alert('Enter a Google Maps API key.');
  localStorage.setItem('harpurGoogleKey', key);
  $('keyModal').classList.add('hidden');
  injectGoogle(key);
};

window.initGoogleMaps = async function(){
  googleLoaded = true;
  $('keyModal').classList.add('hidden');

  initSavedMap();
  initAddMap();

  await loadSavedPlots();
  await loadAddSheetConfig(currentSheet);
};


function isMobileSavedMode(){
  return window.matchMedia('(max-width: 900px)').matches;
}

function showMobileToolbar(autoHide=true){
  if(!isMobileSavedMode() || mobileDrawerOpen) return;
  const bar=$('mobileSavedToolbar');
  if(!bar) return;
  bar.classList.remove('hidden','toolbar-hidden');
  clearTimeout(mobileToolbarTimer);
  if(autoHide){
    mobileToolbarTimer=setTimeout(()=>{
      if(!mobileDrawerOpen && !$('mobileBoxesPanel')?.classList.contains('hidden')===false){
        bar.classList.add('toolbar-hidden');
      }else if(!mobileDrawerOpen && $('mobileBoxesPanel')?.classList.contains('hidden')){
        bar.classList.add('toolbar-hidden');
      }
    },5000);
  }
}

function restartMobileToolbarTimer(){
  showMobileToolbar(true);
}

function hideMobileToolbarImmediately(){
  if(!isMobileSavedMode()) return;
  clearTimeout(mobileToolbarTimer);
  $('mobileSavedToolbar')?.classList.add('toolbar-hidden');
}

function openMobilePlotsDrawer(){
  if(!isMobileSavedMode()) return;
  mobileDrawerOpen=true;
  clearTimeout(mobileToolbarTimer);
  hideMobileBoxesPanel();
  hideMobilePlotPopup();
  renderMobileSavedList();
  $('mobilePlotsDrawer')?.classList.add('open');
  $('mobileSavedToolbar')?.classList.add('toolbar-hidden');
}

function closeMobilePlotsDrawer(){
  mobileDrawerOpen=false;
  $('mobilePlotsDrawer')?.classList.remove('open');

  // Wait for the full-screen plot list close animation to finish, then
  // force Google Maps to recalculate its viewport and redraw selected pins.
  setTimeout(()=>{
    if(!savedMap) return;

    google.maps.event.trigger(savedMap,'resize');
    updateMobileSelectedVisibility();

    if(activeSavedPlot && mobileSelectedPlotIds.has(activeSavedPlot.id) && validCenter(activeSavedPlot)){
      savedMap.panTo({
        lat:Number(activeSavedPlot.center_lat),
        lng:Number(activeSavedPlot.center_lng)
      });
      showSelectedBBox(activeSavedPlot);
    }else{
      fitMobileSelectedPlots();
    }

    showMobileToolbar(true);
  },260);
}

function filteredMobilePlots(){
  const q=($('mobileSavedSearch')?.value||'').trim().toLowerCase();
  const sheet=$('mobileSheetFilter')?.value||'';
  const owner=$('mobileOwnerFilter')?.value||'';

  return savedPlots.filter(p=>{
    if(sheet && String(p.sheet)!==sheet) return false;
    if(owner && (p.owner||'')!==owner) return false;
    if(q){
      const hay=`${p.plot_no} ${p.owner||''} ${p.local_name||''} ${p.notes||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=>{
    const an=Number(a.plot_no),bn=Number(b.plot_no);
    if(Number.isFinite(an)&&Number.isFinite(bn)) return an-bn;
    return String(a.plot_no).localeCompare(String(b.plot_no));
  });
}

function resetMobileSelectionToAll(){
  mobileSelectedPlotIds.clear();
  savedPlots.filter(validCenter).forEach(p=>mobileSelectedPlotIds.add(p.id));
}

function ensureAllMobilePlotsSelected(){
  if(savedPlots.length && mobileSelectedPlotIds.size===0){
    resetMobileSelectionToAll();
  }
}

function syncMobileOwnerFilter(){
  const select=$('mobileOwnerFilter');
  if(!select) return;
  const current=select.value;
  const owners=[...new Set(savedPlots.map(p=>(p.owner||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
  select.innerHTML='<option value="">All owners</option>';
  owners.forEach(owner=>{
    const opt=document.createElement('option');
    opt.value=owner;
    opt.textContent=owner;
    select.appendChild(opt);
  });
  select.value=owners.includes(current)?current:'';
}

function renderMobileSavedList(){
  const box=$('mobileSavedList');
  if(!box) return;

  syncMobileOwnerFilter();
  const rows=filteredMobilePlots();

  $('mobileDrawerCount').textContent=`${rows.length} of ${savedPlots.length} plots`;
  $('mobileSelectAll').checked=rows.length>0 && rows.every(p=>mobileSelectedPlotIds.has(p.id));
  $('mobileSelectedCount').textContent=`${mobileSelectedPlotIds.size} selected`;

  box.innerHTML='';
  rows.forEach(p=>{
    const row=document.createElement('div');
    row.className='mobile-plot-row'+(activeSavedPlot?.id===p.id?' active':'');

    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=mobileSelectedPlotIds.has(p.id);
    cb.setAttribute('aria-label',`Select Plot ${p.plot_no}`);
    cb.onclick=e=>e.stopPropagation();
    cb.onchange=()=>{
      if(cb.checked) mobileSelectedPlotIds.add(p.id);
      else mobileSelectedPlotIds.delete(p.id);
      updateMobileSelectedVisibility();
      renderMobileSavedList();
    };

    const main=document.createElement('div');
    main.className='mobile-row-main';
    main.innerHTML=`<div class="mobile-row-title">Plot ${escapeHtml(p.plot_no)}</div>
      <div class="mobile-row-sub">${escapeHtml(p.owner||'Owner not entered')} • Sheet ${escapeHtml(p.sheet)}</div>`;
    main.onclick=()=>{
      if(!mobileSelectedPlotIds.has(p.id)) mobileSelectedPlotIds.add(p.id);
      closeMobilePlotsDrawer();
      focusSavedPlot(p,true);
    };

    row.append(cb,main);
    box.appendChild(row);
  });

  if(!rows.length){
    box.innerHTML='<div class="muted" style="padding:16px 4px">No saved plots match the current search/filter.</div>';
  }
}

function updateMobileSelectedVisibility(){
  if(!isMobileSavedMode()) return;
  savedMarkers.forEach((marker,id)=>marker.setVisible(mobileSelectedPlotIds.has(id)));
  renderMobileSelectedBBoxes();

  if(activeSavedPlot && !mobileSelectedPlotIds.has(activeSavedPlot.id)){
    hideMobilePlotPopup();
    clearSelectedBBox();
    activeSavedPlot=null;
  }
}

function fitMobileSelectedPlots(){
  if(!savedMap) return;
  const rows=savedPlots.filter(p=>mobileSelectedPlotIds.has(p.id) && validCenter(p));
  if(!rows.length) return;

  const bounds=new google.maps.LatLngBounds();
  rows.forEach(p=>bounds.extend({lat:Number(p.center_lat),lng:Number(p.center_lng)}));
  savedMap.fitBounds(bounds,50);
  if(rows.length===1) savedMap.setZoom(19);
  restartMobileToolbarTimer();
}

function renderMobileSelectedBBoxes(){
  if(!isMobileSavedMode()) return;
  clearAllBBoxes();

  if(mobileBoxesEnabled){
    savedPlots
      .filter(p=>mobileSelectedPlotIds.has(p.id) && validBBox(p))
      .forEach(p=>{
        if(activeSavedPlot?.id===p.id) return;
        const poly=drawBBoxPolygon(p,{selected:false,fillOpacity:mobileBBoxFillOpacity});
        if(poly) allBBoxPolygons.set(p.id,poly);
      });
  }

  if(activeSavedPlot && validBBox(activeSavedPlot)){
    showSelectedBBox(activeSavedPlot);
  }
}

function openMobileBoxesPanel(){
  if(!isMobileSavedMode()) return;
  const panel=$('mobileBoxesPanel');
  const opening=panel.classList.contains('hidden');
  if(opening){
    panel.classList.remove('hidden');
    $('mobileSavedToolbar')?.classList.remove('toolbar-hidden');
    clearTimeout(mobileToolbarTimer);
  }else{
    hideMobileBoxesPanel();
    restartMobileToolbarTimer();
  }
}

function hideMobileBoxesPanel(){
  $('mobileBoxesPanel')?.classList.add('hidden');
}

function setMobileBoxesEnabled(enabled){
  mobileBoxesEnabled=!!enabled;
  if($('mobileShowBoxes')) $('mobileShowBoxes').checked=mobileBoxesEnabled;
  $('mobileBoxesBtn')?.classList.toggle('active',mobileBoxesEnabled);
  renderMobileSelectedBBoxes();
}

function setMobileBBoxOpacity(percent){
  const n=Math.max(0,Math.min(100,Number(percent)||0));
  mobileBBoxFillOpacity=n/100;
  if($('mobileBBoxOpacity')) $('mobileBBoxOpacity').value=String(n);
  if($('mobileBBoxOpacityValue')) $('mobileBBoxOpacityValue').textContent=`${n}%`;
  renderMobileSelectedBBoxes();
}

function showMobilePlotPopup(p){
  if(!isMobileSavedMode()) return;
  $('mobilePopupTitle').textContent=`Plot ${p.plot_no}`;
  $('mobilePopupMeta').textContent=`${p.owner||'Owner not entered'} • Sheet ${p.sheet}`;
  $('mobilePopupDirections').onclick=()=>openDirections(p);
  $('mobilePopupDetails').onclick=()=>openDetails(p);
  $('mobilePlotPopup').classList.remove('hidden');
}

function hideMobilePlotPopup(){
  $('mobilePlotPopup')?.classList.add('hidden');
}

/* ----------------------------- SAVED PLOTS ----------------------------- */
function initSavedMap(){
  savedMap = new google.maps.Map($('savedMap'), {
    center:{lat:25.3525,lng:83.9380},
    zoom:15,
    mapTypeId:'hybrid',
    tilt:0,
    streetViewControl:false,
    fullscreenControl:true,
    mapTypeControl:!isMobileSavedMode()
  });

  savedInfoWindow = new google.maps.InfoWindow();

  savedMap.addListener('dragstart',()=>{
    if(isMobileSavedMode()){
      hideMobileToolbarImmediately();
      hideMobileBoxesPanel();
    }
  });

  savedMap.addListener('zoom_changed',()=>{
    if(isMobileSavedMode()){
      hideMobileToolbarImmediately();
      hideMobileBoxesPanel();
    }
  });

  savedMap.addListener('idle',()=>{
    if(isMobileSavedMode() && !mobileDrawerOpen){
      showMobileToolbar(true);
    }
  });

  savedMap.addListener('click',()=>{
    if(isMobileSavedMode()){
      hideMobilePlotPopup();
      hideMobileBoxesPanel();
      showMobileToolbar(true);
    }
  });
}

async function loadSavedPlots(){
  const r = await fetch('/api/plots');
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || 'Could not load saved plots');
  savedPlots = Array.isArray(data) ? data : [];

  populateOwnerFilter();

  if(isMobileSavedMode()){
    // Mobile starts with every saved plot selected and visible.
    resetMobileSelectionToAll();
  }

  renderSavedList();
  renderSavedMarkers();

  if(isMobileSavedMode()){
    renderMobileSavedList();
    if($('mobileShowBoxes')) $('mobileShowBoxes').checked = mobileBoxesEnabled;
    if($('mobileBBoxOpacity')) $('mobileBBoxOpacity').value = String(Math.round(mobileBBoxFillOpacity*100));
    if($('mobileBBoxOpacityValue')) $('mobileBBoxOpacityValue').textContent = `${Math.round(mobileBBoxFillOpacity*100)}%`;
    $('mobileBoxesBtn')?.classList.toggle('active', mobileBoxesEnabled);
    updateMobileSelectedVisibility();

    // Give Google Maps one frame to lay out the full-screen container before fitting.
    setTimeout(()=>{
      google.maps.event.trigger(savedMap,'resize');
      updateMobileSelectedVisibility();
      fitMobileSelectedPlots();
      showMobileToolbar(true);
    },120);
  }else{
    fitAllSavedPlots();
  }
}

function populateOwnerFilter(){
  const select = $('savedOwnerFilter');
  const current = select.value;
  const owners = [...new Set(savedPlots.map(p => (p.owner || '').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));

  select.innerHTML = '<option value="">All owners</option>';
  owners.forEach(owner => {
    const o = document.createElement('option');
    o.value = owner;
    o.textContent = owner;
    select.appendChild(o);
  });
  select.value = owners.includes(current) ? current : '';
}

function filteredSavedPlots(){
  const q = $('savedSearch').value.trim().toLowerCase();
  const sheet = $('savedSheetFilter').value;
  const owner = $('savedOwnerFilter').value;

  return savedPlots.filter(p => {
    if(sheet && p.sheet !== sheet) return false;
    if(owner && (p.owner || '') !== owner) return false;
    if(q){
      const hay = `${p.plot_no} ${p.owner || ''} ${p.local_name || ''} ${p.notes || ''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=>{
    const an = Number(a.plot_no), bn = Number(b.plot_no);
    if(Number.isFinite(an) && Number.isFinite(bn)) return an-bn;
    return String(a.plot_no).localeCompare(String(b.plot_no));
  });
}

function renderSavedList(){
  const rows = filteredSavedPlots();
  $('savedCount').textContent = `${rows.length} of ${savedPlots.length} plots`;
  const box = $('savedList');
  box.innerHTML = '';

  rows.forEach(p => {
    const item = document.createElement('div');
    item.className = 'plot-row' + (activeSavedPlot?.id === p.id ? ' active' : '');
    item.dataset.id = p.id;

    const head = document.createElement('div');
    head.className = 'plot-row-head';
    head.innerHTML = `<span class="plot-no">Plot ${escapeHtml(p.plot_no)}</span><span class="plot-sheet">Sheet ${escapeHtml(p.sheet)}</span>`;

    const owner = document.createElement('div');
    owner.className = 'plot-owner';
    owner.textContent = p.owner || 'Owner not entered';

    item.appendChild(head);
    item.appendChild(owner);

    const secondary = (p.local_name || p.notes || '').trim();
    if(secondary){
      const note = document.createElement('div');
      note.className = 'plot-note';
      note.textContent = secondary;
      item.appendChild(note);
    }

    item.onclick = () => focusSavedPlot(p, true);
    box.appendChild(item);
  });

  syncSavedMarkerVisibility(rows);
}

function syncSavedMarkerVisibility(rows){
  if(isMobileSavedMode()){
    ensureAllMobilePlotsSelected();
    savedMarkers.forEach((marker,id)=>marker.setVisible(mobileSelectedPlotIds.has(id)));
    renderMobileSelectedBBoxes();
  }else{
    const visible=new Set(rows.map(p=>p.id));
    savedMarkers.forEach((marker,id)=>marker.setVisible(visible.has(id)));
    renderAllBBoxes();
  }
}

function validCenter(p){
  return Number.isFinite(Number(p.center_lat)) && Number.isFinite(Number(p.center_lng));
}

function renderSavedMarkers(){
  savedMarkers.forEach(m=>m.setMap(null));
  savedMarkers.clear();
  clearAllBBoxes();
  clearSelectedBBox();

  savedPlots.filter(validCenter).forEach(p=>{
    const marker=new google.maps.Marker({
      position:{lat:Number(p.center_lat),lng:Number(p.center_lng)},
      map:savedMap,
      title:`Plot ${p.plot_no}`,
      label:{
        text:String(p.plot_no),
        fontWeight:'700',
        fontSize:'11px'
      }
    });

    marker.addListener('click',()=>{
      activeSavedPlot=p;
      renderSavedList();
      showSelectedBBox(p);

      if(isMobileSavedMode()){
        if(!mobileSelectedPlotIds.has(p.id)) mobileSelectedPlotIds.add(p.id);
        showMobilePlotPopup(p);
        restartMobileToolbarTimer();
      }else{
        openSavedInfoWindow(p,marker);
        showSavedSummary(p);
      }
    });

    savedMarkers.set(p.id,marker);
  });

  if(isMobileSavedMode()){
    updateMobileSelectedVisibility();
  }else{
    renderAllBBoxes();
    if(activeSavedPlot) showSelectedBBox(activeSavedPlot);
  }
}

function validBBox(p){
  return [p.xmin,p.ymin,p.xmax,p.ymax].every(v => Number.isFinite(Number(v))) &&
         Number(p.xmax) > Number(p.xmin) &&
         Number(p.ymax) > Number(p.ymin);
}
function bboxPath(p){
  if(!validBBox(p)) return null;
  return [
    [Number(p.xmin),Number(p.ymin)],
    [Number(p.xmin),Number(p.ymax)],
    [Number(p.xmax),Number(p.ymax)],
    [Number(p.xmax),Number(p.ymin)]
  ].map(([x,y])=>{
    const [lng,lat]=proj4('EPSG:32645','EPSG:4326',[x,y]);
    return {lat,lng};
  });
}
function drawBBoxPolygon(p,{selected=false,fillOpacity=null}={}){
  const path=bboxPath(p);
  if(!path||!savedMap) return null;

  const requestedFill = fillOpacity == null
    ? (selected ? Math.max(0.12,mobileBBoxFillOpacity) : mobileBBoxFillOpacity)
    : fillOpacity;

  return new google.maps.Polygon({
    paths:path,
    map:savedMap,
    strokeColor:'#ff1f0f',
    strokeOpacity:1,
    strokeWeight:selected?5:2,
    fillColor:'#ff1f0f',
    fillOpacity:requestedFill,
    clickable:false,
    zIndex:selected?1000:100
  });
}
function clearSelectedBBox(){
  if(selectedBBoxPolygon){selectedBBoxPolygon.setMap(null);selectedBBoxPolygon=null;}
}
function showSelectedBBox(p){
  clearSelectedBBox();
  selectedBBoxPolygon=drawBBoxPolygon(p,{selected:true});
}
function clearAllBBoxes(){
  allBBoxPolygons.forEach(poly=>poly.setMap(null));
  allBBoxPolygons.clear();
}
function renderAllBBoxes(){
  clearAllBBoxes();
  if(!$('showAllBBoxes')?.checked||!savedMap) return;
  filteredSavedPlots().filter(validBBox).forEach(p=>{
    const poly=drawBBoxPolygon(p,{selected:false});
    if(poly) allBBoxPolygons.set(p.id,poly);
  });
  if(activeSavedPlot) showSelectedBBox(activeSavedPlot);
}

function fitAllSavedPlots(){
  if(!savedMap) return;
  const rows = filteredSavedPlots().filter(validCenter);
  if(!rows.length) return;

  const bounds = new google.maps.LatLngBounds();
  rows.forEach(p => bounds.extend({lat:Number(p.center_lat),lng:Number(p.center_lng)}));
  savedMap.fitBounds(bounds, 50);

  if(rows.length === 1){
    savedMap.setZoom(19);
  }
}

function focusSavedPlot(p, zoom=true){
  if(!validCenter(p)) return alert(`Plot ${p.plot_no} does not have saved center coordinates.`);

  activeSavedPlot=p;
  renderSavedList();

  const pos={lat:Number(p.center_lat),lng:Number(p.center_lng)};
  savedMap.panTo(pos);

  if(zoom){
    if(validBBox(p)){
      const path=bboxPath(p);
      const bounds=new google.maps.LatLngBounds();
      path.forEach(pt=>bounds.extend(pt));
      savedMap.fitBounds(bounds,80);
      google.maps.event.addListenerOnce(savedMap,'idle',()=>{
        if(savedMap.getZoom()>20) savedMap.setZoom(20);
      });
    }else{
      savedMap.setZoom(19);
    }
  }

  showSelectedBBox(p);
  const marker=savedMarkers.get(p.id);

  if(isMobileSavedMode()){
    if(!mobileSelectedPlotIds.has(p.id)) mobileSelectedPlotIds.add(p.id);
    updateMobileSelectedVisibility();
    showMobilePlotPopup(p);
    restartMobileToolbarTimer();
  }else{
    if(marker) openSavedInfoWindow(p,marker);
    showSavedSummary(p);
  }
}

function buildDirectionsUrl(p){
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(p.center_lat).toFixed(8)},${Number(p.center_lng).toFixed(8)}&travelmode=driving`;
}
function buildMapUrl(p){
  return p.google_map_url || `https://www.google.com/maps?q=${Number(p.center_lat).toFixed(8)},${Number(p.center_lng).toFixed(8)}`;
}
function openDirections(p){
  window.open(buildDirectionsUrl(p),'_blank','noopener');
}

function openSavedInfoWindow(p, marker){
  if(isMobileSavedMode()) return;
  const root = document.createElement('div');
  root.className = 'gm-info';

  const title = document.createElement('div');
  title.className = 'gm-info-title';
  title.textContent = `Plot ${p.plot_no}`;

  const meta = document.createElement('div');
  meta.className = 'gm-info-meta';
  meta.textContent = `${p.owner || 'Owner not entered'} • Sheet ${p.sheet}`;

  const actions = document.createElement('div');
  actions.className = 'gm-info-actions';

  const dir = document.createElement('button');
  dir.className = 'dir';
  dir.textContent = 'Directions';
  dir.onclick = () => openDirections(p);

  const details = document.createElement('button');
  details.textContent = 'Details';
  details.onclick = () => openDetails(p);

  actions.append(dir,details);
  root.append(title,meta,actions);

  savedInfoWindow.setContent(root);
  savedInfoWindow.open({map:savedMap,anchor:marker});
}

function showSavedSummary(p){
  $('selectedSummary').classList.remove('hidden');
  $('summaryPlot').textContent = `Plot ${p.plot_no}`;
  $('summaryMeta').textContent = ` • ${p.owner || 'Owner not entered'} • Sheet ${p.sheet}`;
  $('summaryDirections').onclick = () => openDirections(p);
  $('summaryDetails').onclick = () => openDetails(p);
}

function openDetails(p){
  activeSavedPlot = p;
  $('detailTitle').textContent = `Plot ${p.plot_no}`;
  $('detailSubtitle').textContent = `${p.owner || 'Owner not entered'} • CS Sheet ${p.sheet}`;
  $('detailOwner').value = p.owner || '';
  $('detailLocalName').value = p.local_name || '';
  $('detailNotes').value = p.notes || '';

  $('detailSurvey').textContent = p.survey || '';
  $('detailSheet').textContent = p.sheet || '';
  $('detailPniu').textContent = p.pniu || '—';
  $('detailPlotId').textContent = p.plot_id || '—';
  $('detailGisCode').textContent = p.gis_code || '—';
  $('detailCenter').textContent = validCenter(p) ? `${Number(p.center_lat).toFixed(8)}, ${Number(p.center_lng).toFixed(8)}` : '—';
  $('detailXY').textContent = (p.seed_x != null && p.seed_y != null) ? `${p.seed_x}, ${p.seed_y}` : '—';
  $('detailBBox').textContent = [p.xmin,p.ymin,p.xmax,p.ymax].every(v=>v!=null)
    ? `${p.xmin}, ${p.ymin}, ${p.xmax}, ${p.ymax}` : '—';

  $('detailDirections').onclick = () => openDirections(p);
  $('detailGoogle').onclick = () => window.open(buildMapUrl(p),'_blank','noopener');
  $('detailsModal').classList.remove('hidden');
}
function closeDetails(){
  $('detailsModal').classList.add('hidden');
}
$('closeDetails').onclick = closeDetails;
$('detailsModal').addEventListener('click', e => { if(e.target === $('detailsModal')) closeDetails(); });

$('detailSave').onclick = async () => {
  if(!activeSavedPlot) return;
  const p = activeSavedPlot;
  const body = {
    ...p,
    owner:$('detailOwner').value.trim(),
    local_name:$('detailLocalName').value.trim(),
    notes:$('detailNotes').value.trim(),
    geometry:p.geometry || null
  };
  const r = await fetch('/api/plots',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const d = await r.json();
  if(!r.ok) return alert(d.error || 'Save failed');

  const idx = savedPlots.findIndex(x=>x.id===p.id);
  if(idx>=0) savedPlots[idx] = d;
  activeSavedPlot = d;

  populateOwnerFilter();
  renderSavedList();
  renderSavedMarkers();
  focusSavedPlot(d,false);
  openDetails(d);
};

$('detailDelete').onclick = async () => {
  if(!activeSavedPlot) return;
  const p = activeSavedPlot;
  if(!confirm(`Delete Plot ${p.plot_no} from our database?\n\nThis does not change BhuNaksha.`)) return;

  const url = `/api/plots/${encodeURIComponent(p.survey)}/${encodeURIComponent(p.sheet)}/${encodeURIComponent(p.plot_no)}`;
  const r = await fetch(url,{method:'DELETE'});
  const d = await r.json();
  if(!r.ok) return alert(d.error || 'Delete failed');

  closeDetails();
  savedInfoWindow.close();
  $('selectedSummary').classList.add('hidden');
  clearSelectedBBox();
  hideMobilePlotPopup();
  mobileSelectedPlotIds.delete(p.id);
  activeSavedPlot = null;
  await loadSavedPlots();
};

$('savedSearch').oninput = renderSavedList;
$('savedSheetFilter').onchange = renderSavedList;
$('savedOwnerFilter').onchange = renderSavedList;
$('showAllBBoxes').onchange = renderAllBBoxes;
$('fitAllSaved').onclick = fitAllSavedPlots;

$('mobilePlotsBtn').onclick=openMobilePlotsDrawer;
$('mobileFitBtn').onclick=fitMobileSelectedPlots;
$('mobileBoxesBtn').onclick=openMobileBoxesPanel;
$('mobileShowBoxes').onchange=e=>setMobileBoxesEnabled(e.target.checked);
$('mobileBBoxOpacity').oninput=e=>setMobileBBoxOpacity(e.target.value);
$('mobilePopupClose').onclick=hideMobilePlotPopup;
$('mobileDrawerClose').onclick=closeMobilePlotsDrawer;
$('mobileSavedSearch').oninput=renderMobileSavedList;
$('mobileSheetFilter').onchange=renderMobileSavedList;
$('mobileOwnerFilter').onchange=renderMobileSavedList;

$('mobileSelectAll').onchange=e=>{
  const rows=filteredMobilePlots();
  if(e.target.checked) rows.forEach(p=>mobileSelectedPlotIds.add(p.id));
  else rows.forEach(p=>mobileSelectedPlotIds.delete(p.id));
  updateMobileSelectedVisibility();
  renderMobileSavedList();
};

window.addEventListener('resize',()=>{
  if(!savedMap) return;

  savedMap.setOptions({mapTypeControl:!isMobileSavedMode()});
  google.maps.event.trigger(savedMap,'resize');

  if(isMobileSavedMode()){
    ensureAllMobilePlotsSelected();
    renderMobileSavedList();
    updateMobileSelectedVisibility();
    showMobileToolbar(true);
  }else{
    hideMobilePlotPopup();
    hideMobileBoxesPanel();
    if(mobileDrawerOpen) closeMobilePlotsDrawer();
    renderSavedList();
    renderSavedMarkers();
  }
});

/* ----------------------------- ADD PLOT ----------------------------- */
function initAddMap(){
  addMap = new google.maps.Map($('addMap'), {
    center:{lat:25.3501,lng:83.9334},
    zoom:15,
    mapTypeId:'hybrid',
    tilt:0,
    streetViewControl:false,
    fullscreenControl:true,
    mapTypeControl:true
  });

  addMap.addListener('click', async e => {
    try{ await lookupAddPlot(e.latLng); }
    catch(err){ $('addStatus').textContent = err.message; }
  });

  addMap.addListener('idle', () => scheduleAddOverlayRefresh(false));
}

async function loadAddSheetConfig(sheet){
  currentSheet = String(sheet || '01').padStart(2,'0');
  $('sheetSelect').value = currentSheet;
  localStorage.setItem('harpurSheet', currentSheet);

  const r = await fetch(`/api/config?sheet=${encodeURIComponent(currentSheet)}`);
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || `Could not load Sheet ${currentSheet}`);
  addConfig = d;
  $('rawImageLink').href = `/api/bhunaksha-sheet.png?sheet=${encodeURIComponent(currentSheet)}`;

  if(addMap){
    fitAddSheet();
    scheduleAddOverlayRefresh(true);
  }
}

async function switchAddSheet(sheet){
  clearAddSelection();
  lastOverlaySignature = '';
  if(overlayView){ overlayView.setMap(null); overlayView = null; }
  $('addStatus').textContent = `Loading CS Sheet ${sheet}…`;
  await loadAddSheetConfig(sheet);
  $('addStatus').textContent = `CS Sheet ${currentSheet} loaded. Zoom and click a parcel.`;
}

function clearAddSelection(){
  if(selectionMarker){ selectionMarker.setMap(null); selectionMarker = null; }
  if(selectedPolygon){ selectedPolygon.setMap(null); selectedPolygon = null; }
  selectedPlot = null;
  $('plotForm').classList.add('hidden');
}

function fitAddSheet(){
  if(!addMap || !addConfig) return;
  const b = addConfig.googleBounds;
  addMap.fitBounds(new google.maps.LatLngBounds(
    {lat:b.south,lng:b.west},
    {lat:b.north,lng:b.east}
  ),30);
}

function createBhuNakshaOverlayClass(){
  return class BhuNakshaImageOverlay extends google.maps.OverlayView{
    constructor(url,bounds,opacity=.9){
      super();this.url=url;this.bounds=bounds;this.opacity=opacity;this.div=null;this.img=null;this.loadSeq=0;
    }
    onAdd(){
      this.div=document.createElement('div');this.div.style.position='absolute';
      this.img=document.createElement('img');this.img.src=this.url;this.img.className='bhu-sheet';
      this.img.style.cssText=`position:absolute;left:0;top:0;width:100%;height:100%;opacity:${this.opacity}`;
      this.img.onload=()=>{$('addStatus').textContent=`Cadastral PNG loaded for Sheet ${currentSheet}.`;};
      this.img.onerror=()=>{$('addStatus').textContent='BhuNaksha PNG temporarily unavailable. Use Refresh PNG or move/zoom slightly.';};
      this.div.appendChild(this.img);this.getPanes().overlayLayer.appendChild(this.div);
    }
    draw(){
      if(!this.div)return;const p=this.getProjection();if(!p)return;
      const sw=p.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.south,this.bounds.west));
      const ne=p.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.north,this.bounds.east));
      if(!sw||!ne)return;
      this.div.style.left=sw.x+'px';this.div.style.top=ne.y+'px';
      this.div.style.width=(ne.x-sw.x)+'px';this.div.style.height=(sw.y-ne.y)+'px';
    }
    onRemove(){if(this.div?.parentNode)this.div.parentNode.removeChild(this.div);this.div=null;this.img=null;}
    setOpacity(v){this.opacity=v;if(this.img)this.img.style.opacity=String(v);}
    update(url,bounds){
      const seq=++this.loadSeq;const candidate=new Image();
      candidate.className='bhu-sheet';
      candidate.style.cssText=`position:absolute;left:0;top:0;width:100%;height:100%;opacity:${this.opacity}`;
      candidate.onload=()=>{
        if(seq!==this.loadSeq||!this.div)return;
        const old=this.img;this.url=url;this.bounds=bounds;this.img=candidate;
        if(old&&old.parentNode===this.div)this.div.replaceChild(candidate,old);else this.div.appendChild(candidate);
        this.draw();$('addStatus').textContent=`Cadastral PNG refreshed for Sheet ${currentSheet}, zoom ${addMap?.getZoom()??''}.`;
      };
      candidate.onerror=()=>{
        if(seq!==this.loadSeq)return;
        $('addStatus').textContent='Cadastral refresh failed temporarily — keeping the previous BhuNaksha image.';
      };
      candidate.src=url;
    }
  }
}
let BhuNakshaImageOverlay = null;

function nativeBBoxToLatLngBounds(b){
  const corners=[[b.xmin,b.ymin],[b.xmax,b.ymax],[b.xmin,b.ymax],[b.xmax,b.ymin]]
    .map(c=>proj4('EPSG:32645','EPSG:4326',c));
  const lats=corners.map(c=>c[1]),lngs=corners.map(c=>c[0]);
  return{south:Math.min(...lats),north:Math.max(...lats),west:Math.min(...lngs),east:Math.max(...lngs)};
}
function intersectBBox(a,b){
  const r={xmin:Math.max(a.xmin,b.xmin),ymin:Math.max(a.ymin,b.ymin),xmax:Math.min(a.xmax,b.xmax),ymax:Math.min(a.ymax,b.ymax)};
  return r.xmax>r.xmin&&r.ymax>r.ymin?r:null;
}
function currentAddViewportNativeBBox(){
  const bounds=addMap?.getBounds();if(!bounds||!addConfig)return null;
  const ne=bounds.getNorthEast(),sw=bounds.getSouthWest();
  const pts=[
    [ne.lng(),ne.lat()],[sw.lng(),sw.lat()],[sw.lng(),ne.lat()],[ne.lng(),sw.lat()]
  ].map(p=>proj4('EPSG:4326','EPSG:32645',p));
  const view={xmin:Math.min(...pts.map(p=>p[0])),ymin:Math.min(...pts.map(p=>p[1])),xmax:Math.max(...pts.map(p=>p[0])),ymax:Math.max(...pts.map(p=>p[1]))};
  return intersectBBox(view,addConfig.imageBBox);
}
function currentAddImageSize(){
  const rect=$('addMap').getBoundingClientRect();const dpr=Math.min(window.devicePixelRatio||1,1.5);
  return{width:Math.min(2200,Math.max(512,Math.round(rect.width*dpr))),height:Math.min(2200,Math.max(512,Math.round(rect.height*dpr)))};
}
function addOverlaySignature(b,s){
  return[addMap?.getZoom()||'',currentSheet,b.xmin.toFixed(2),b.ymin.toFixed(2),b.xmax.toFixed(2),b.ymax.toFixed(2),s.width,s.height].join('|');
}
function refreshAddOverlay(force=false){
  if(!addMap||!addConfig)return;
  if(!$('showNaksha').checked){if(overlayView){overlayView.setMap(null);overlayView=null;}return;}

  const bbox=currentAddViewportNativeBBox();
  if(!bbox)return;

  const size=currentAddImageSize(), sig=addOverlaySignature(bbox,size);
  if(!force&&sig===lastOverlaySignature)return;
  lastOverlaySignature=sig;

  const q=new URLSearchParams({...bbox,width:size.width,height:size.height,sheet:currentSheet,t:Date.now()});
  const url=`/api/viewport-overlay.png?${q}`;
  const bounds=nativeBBoxToLatLngBounds(bbox);

  if(!BhuNakshaImageOverlay)BhuNakshaImageOverlay=createBhuNakshaOverlayClass();
  if(!overlayView){
    overlayView=new BhuNakshaImageOverlay(url,bounds,Number($('opacity').value)/100);
    overlayView.setMap(addMap);
  }else{
    overlayView.update(url,bounds);overlayView.setOpacity(Number($('opacity').value)/100);
  }
  $('addStatus').textContent=`Refreshing cadastral PNG for Sheet ${currentSheet}…`;
}
function scheduleAddOverlayRefresh(force=false){
  clearTimeout(addRefreshTimer);
  addRefreshTimer=setTimeout(()=>refreshAddOverlay(force),650);
}

function placeAddPin(latLng,label=''){
  if(selectionMarker){selectionMarker.setMap(null);selectionMarker=null;}
  selectionMarker=new google.maps.Marker({
    position:latLng,map:addMap,title:label?`Selected plot ${label}`:'Selected location',
    label:label?{text:String(label),fontWeight:'700'}:undefined,
    animation:google.maps.Animation.DROP,zIndex:999
  });
}

async function lookupAddPlot(latLng){
  placeAddPin(latLng);
  const [x,y]=proj4('EPSG:4326','EPSG:32645',[latLng.lng(),latLng.lat()]);
  $('addStatus').textContent='Identifying BhuNaksha plot…';

  const q=new URLSearchParams({x:String(x),y:String(y),sheet:currentSheet});
  const r=await fetch(`/api/plot-at-xy?${q}`);
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'Plot lookup failed');
  const s=data.scalar;
  if(!s||s.has_data!=='Y')throw new Error('No BhuNaksha plot found at this click.');

  selectedPlot={
    survey:'CS',sheet:currentSheet,state:'10',gis_code:addConfig.gisCode,levels:addConfig.levels,
    plot_no:String(s.plotNo||data.hit?.kide||''),plot_id:String(s.ID||data.hit?.id||''),
    pniu:String(s.PNIU||''),seed_x:x,seed_y:y,xmin:s.xmin,ymin:s.ymin,xmax:s.xmax,ymax:s.ymax,
    geometry:null,source:''
  };

  const center=plotCenterFromBBox(selectedPlot);
  selectedPlot.center_lat=center.lat;selectedPlot.center_lng=center.lng;
  selectedPlot.google_map_url=mapUrl(center.lat,center.lng);

  placeAddPin(latLng,selectedPlot.plot_no);
  showAddSelected();
}

function plotCenterFromBBox(p){
  const x=(Number(p.xmin)+Number(p.xmax))/2,y=(Number(p.ymin)+Number(p.ymax))/2;
  const [lng,lat]=proj4('EPSG:32645','EPSG:4326',[x,y]);
  return{lat,lng};
}
function mapUrl(lat,lng){return`https://www.google.com/maps?q=${lat.toFixed(8)},${lng.toFixed(8)}`;}

function showAddSelected(){
  const p=selectedPlot;if(!p)return;
  $('plotForm').classList.remove('hidden');
  $('plotNo').textContent=p.plot_no;$('plotSheet').textContent=p.sheet;$('pniu').textContent=p.pniu||'—';
  $('plotId').textContent=p.plot_id||'—';$('nativeXY').textContent=`${p.seed_x.toFixed(3)}, ${p.seed_y.toFixed(3)}`;
  $('centerLatLng').textContent=`${Number(p.center_lat).toFixed(8)}, ${Number(p.center_lng).toFixed(8)}`;
  $('googleMapLink').href=p.google_map_url;$('googleMapLink').classList.remove('hidden');

  const existing=savedPlots.find(x=>String(x.plot_no)===String(p.plot_no)&&x.survey==='CS'&&x.sheet===p.sheet);
  $('owner').value=existing?.owner||'';$('localName').value=existing?.local_name||'';$('notes').value=existing?.notes||'';
  $('deletePlot').disabled=!existing;

  if(existing?.geometry){
    p.geometry=existing.geometry;p.source=existing.source||'';
    drawSelectedGeometry(p.geometry);
  }
  $('addStatus').textContent=`Selected CS Sheet ${p.sheet}, Plot ${p.plot_no}.`;
}
function drawSelectedGeometry(geometry){
  if(selectedPolygon){selectedPolygon.setMap(null);selectedPolygon=null;}
  if(!geometry?.coordinates?.[0])return;
  selectedPolygon=new google.maps.Polygon({
    paths:geometry.coordinates[0].map(([lng,lat])=>({lat,lng})),map:addMap,
    strokeWeight:4,fillOpacity:.28,clickable:false
  });
}

$('reconstruct').onclick=async()=>{
  if(!selectedPlot)return;
  $('addStatus').textContent=`Reconstructing Plot ${selectedPlot.plot_no}…`;
  const r=await fetch('/api/reconstruct',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...selectedPlot,owner:$('owner').value.trim(),local_name:$('localName').value.trim()})
  });
  const f=await r.json();if(!r.ok)return alert(f.error||'Reconstruction failed');
  selectedPlot.geometry=f.geometry;selectedPlot.source=f.properties.source;drawSelectedGeometry(f.geometry);
  $('addStatus').textContent=`Plot ${selectedPlot.plot_no} polygon reconstructed.`;
};

$('savePlot').onclick=async()=>{
  if(!selectedPlot)return;
  const body={...selectedPlot,owner:$('owner').value.trim(),local_name:$('localName').value.trim(),notes:$('notes').value.trim()};
  const r=await fetch('/api/plots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)return alert(d.error||'Save failed');
  $('deletePlot').disabled=false;
  $('addStatus').textContent=`Plot ${body.plot_no} saved/updated.`;
  await loadSavedPlots();
};

$('deletePlot').onclick=async()=>{
  if(!selectedPlot)return;
  const existing=savedPlots.find(x=>String(x.plot_no)===String(selectedPlot.plot_no)&&x.survey===selectedPlot.survey&&x.sheet===selectedPlot.sheet);
  if(!existing)return alert(`Plot ${selectedPlot.plot_no} is not saved yet.`);
  if(!confirm(`Delete Plot ${selectedPlot.plot_no} from our database?\n\nThis does not change BhuNaksha.`))return;

  const url=`/api/plots/${encodeURIComponent(selectedPlot.survey)}/${encodeURIComponent(selectedPlot.sheet)}/${encodeURIComponent(selectedPlot.plot_no)}`;
  const r=await fetch(url,{method:'DELETE'});const d=await r.json();if(!r.ok)return alert(d.error||'Delete failed');
  clearAddSelection();$('addStatus').textContent=`Plot ${existing.plot_no} deleted from database.`;
  await loadSavedPlots();
};

$('sheetSelect').value=currentSheet;
$('sheetSelect').onchange=e=>switchAddSheet(e.target.value).catch(err=>alert(err.message));
$('showNaksha').onchange=()=>scheduleAddOverlayRefresh(true);
$('opacity').oninput=e=>{$('opacityValue').textContent=`${e.target.value}%`;overlayView?.setOpacity(Number(e.target.value)/100);};
$('fitSheet').onclick=fitAddSheet;
$('reloadSheet').onclick=()=>scheduleAddOverlayRefresh(true);

/* ----------------------------- UTIL ----------------------------- */
function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

bootstrap();
