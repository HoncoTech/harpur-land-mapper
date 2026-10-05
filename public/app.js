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
let detailCoOwnerIds = new Set();
let selectedBBoxPolygon = null;
let selectedShapePolygon = null;
let allBBoxPolygons = new Map();
let allShapePolygons = new Map();
let savedShowShapes = true;
let savedShowBBoxes = true;
let savedShowPins = true;
let savedSurvey = localStorage.getItem('harpurSavedSurvey') || '';
let familyContextName = 'Family';

// Mobile Saved Plots state
let mobileSelectedPlotIds = new Set();
let mobileToolbarTimer = null;
let mobileDrawerOpen = false;
let mobileBoxesEnabled = true;
let mobileShapesEnabled = true;
let mobilePinsEnabled = true;
let mobileBBoxFillOpacity = 0.10;

// Add Plot state (V7 dynamic Mauza → Survey → Map Instance → Sheet lifecycle)
let addMap = null;
let addConfig = null;
let addReferenceData = {families:[], members:[], locations:[]};
let addWorkflowInitialized = false;
let addWorkflowInitializing = false;
let selectedCoOwnerIds = new Set();
let currentMauza = localStorage.getItem('harpurMauza') || '0230';
let currentSurvey = '';
let currentMapInstance = '';
let currentSheet = '';
let overlayView = null;
let selectionMarker = null;
let selectedPlot = null;
let selectedPolygon = null;
let addRefreshTimer = null;
let lastOverlaySignature = '';
let addReconstructSeq = 0;

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
    if(view === 'add'){
      if(googleLoaded && !addWorkflowInitialized && !addWorkflowInitializing){
        initAddWorkflow();
      }else if(addMap){
        google.maps.event.trigger(addMap,'resize');
        scheduleAddOverlayRefresh(true);
      }
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

async function loadFamilyContext(){
  try{
    const r=await fetch('/api/reference-data');
    const d=await r.json();
    if(r.ok && Array.isArray(d.families) && d.families.length){
      familyContextName=d.families[0].family_name || 'Family';
      document.querySelectorAll('[data-family-context]').forEach(el=>el.textContent=familyContextName);
    }
  }catch(_){ /* informational context only */ }
}

async function bootstrap(){
  try{
    await loadAppConfig();
    await loadFamilyContext();
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
  await loadSavedPlots();
  if(document.getElementById('view-add')?.classList.contains('active')) await initAddWorkflow();
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

function sortSavedRows(rows, mobile=false){
  const mode=(mobile?$('mobileSavedSort')?.value:$('savedSort')?.value)||'plot-asc';
  return rows.sort((a,b)=>{
    const area=x=>Number(x.plot_area_decimal)||Number(x.calculated_area_decimal)||0;
    if(mode==='area-desc')return area(b)-area(a);
    if(mode==='area-asc')return area(a)-area(b);
    if(mode==='owner-asc')return String(a.owner||'').localeCompare(String(b.owner||''));
    const an=Number(a.plot_no),bn=Number(b.plot_no);
    if(Number.isFinite(an)&&Number.isFinite(bn))return mode==='plot-desc'?bn-an:an-bn;
    const c=String(a.plot_no).localeCompare(String(b.plot_no));
    return mode==='plot-desc'?-c:c;
  });
}

function filteredMobilePlots(){
  const q=($('mobileSavedSearch')?.value||'').trim().toLowerCase();
  const sheet=$('mobileSheetFilter')?.value||'';
  const owner=$('mobileOwnerFilter')?.value||'';
  const rows=savedPlots.filter(p=>{
    if(savedSurvey && String(p.survey)!==savedSurvey) return false;
    if(sheet && String(p.sheet)!==sheet) return false;
    if(owner && (p.owner||'')!==owner) return false;
    if(q){
      const hay=`${p.plot_no} ${p.khesra_no||''} ${p.khata_no||''} ${p.jamabandi_no||''} ${p.computerized_jamabandi_no||''} ${p.exact_raiyat_name||''} ${p.owner||''} ${p.local_name||''} ${p.notes||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  return sortSavedRows(rows,true);
}

function resetMobileSelectionToAll(){
  mobileSelectedPlotIds.clear();
  savedPlots.filter(p=>(!savedSurvey||String(p.survey)===savedSurvey)&&validCenter(p)).forEach(p=>mobileSelectedPlotIds.add(p.id));
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
  const owners=[...new Set(savedPlots.filter(p=>!savedSurvey||String(p.survey)===savedSurvey).map(p=>(p.owner||'').trim()).filter(Boolean))]
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

  $('mobileDrawerCount').textContent=`${rows.length} ${savedSurvey||''} plots`;
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
      <div class="mobile-row-sub">${escapeHtml(p.survey||'')} • Sheet ${escapeHtml(p.sheet)} • ${validGeometry(p)?'Shape':'Box'}<br>${escapeHtml(p.owner||'Owner not entered')}</div>`;
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
  savedMarkers.forEach((marker,id)=>marker.setVisible(mobilePinsEnabled && mobileSelectedPlotIds.has(id)));
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
  clearAllShapes();

  savedPlots
    .filter(p=>(!savedSurvey||String(p.survey)===savedSurvey) && mobileSelectedPlotIds.has(p.id))
    .forEach(p=>{
      if(activeSavedPlot?.id===p.id) return;
      if(mobileShapesEnabled && validGeometry(p)){
        const shape=drawShapePolygon(p,{selected:false,fillOpacity:mobileBBoxFillOpacity});
        if(shape) allShapePolygons.set(p.id,shape);
      }
      if(mobileBoxesEnabled && validBBox(p)){
        const box=drawBBoxOnly(p,{selected:false});
        if(box) allBBoxPolygons.set(p.id,box);
      }
    });

  if(activeSavedPlot && (validGeometry(activeSavedPlot)||validBBox(activeSavedPlot))){
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
  savedShowBBoxes=mobileBoxesEnabled;
  if($('mobileShowBoxes')) $('mobileShowBoxes').checked=mobileBoxesEnabled;
  if($('showAllBBoxes')) $('showAllBBoxes').checked=mobileBoxesEnabled;
  $('mobileBoxesBtn')?.classList.toggle('active',mobileBoxesEnabled||mobileShapesEnabled);
  renderMobileSelectedBBoxes();
}
function setMobileShapesEnabled(enabled){
  mobileShapesEnabled=!!enabled;
  savedShowShapes=mobileShapesEnabled;
  if($('mobileShowShapes')) $('mobileShowShapes').checked=mobileShapesEnabled;
  if($('showParcelShapes')) $('showParcelShapes').checked=mobileShapesEnabled;
  $('mobileBoxesBtn')?.classList.toggle('active',mobileBoxesEnabled||mobileShapesEnabled);
  renderMobileSelectedBBoxes();
}
function setMobilePinsEnabled(enabled){
  mobilePinsEnabled=!!enabled;
  savedShowPins=mobilePinsEnabled;
  if($('mobileShowPins')) $('mobileShowPins').checked=mobilePinsEnabled;
  if($('showSavedPins')) $('showSavedPins').checked=mobilePinsEnabled;
  updateMobileSelectedVisibility();
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
  $('mobilePopupMeta').textContent=`${p.owner||'Owner not entered'} • ${p.survey||''} Sheet ${p.sheet}${Number.isFinite(Number(p.calculated_area_decimal)) ? ` • Map ${Number(p.calculated_area_decimal).toFixed(2)} dec • ${Number(p.approx_length_m).toFixed(1)} m longest` : ''}`;
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

function availableSavedSurveys(){
  const out=['RS','CS'];savedPlots.forEach(p=>{const v=String(p.survey||'').trim();if(v&&!out.includes(v))out.push(v);});return out;
}
function renderSurveySegments(){
  const surveys=availableSavedSurveys();if(!savedSurvey||!surveys.includes(savedSurvey)){const firstWithData=surveys.find(v=>savedPlots.some(p=>String(p.survey)===v));savedSurvey=firstWithData||surveys[0]||'';}
  for(const id of ['savedSurveyFilter','mobileSurveyFilter']){const box=$(id);if(!box)continue;box.innerHTML='';surveys.forEach(v=>{const b=document.createElement('button');b.type='button';b.textContent=v;b.className='survey-segment-btn'+(v===savedSurvey?' active':'');b.setAttribute('role','radio');b.setAttribute('aria-checked',v===savedSurvey?'true':'false');b.onclick=()=>setSavedSurvey(v);box.appendChild(b);});}
}
function refreshSavedSheetOptions(){
  const sheets=[...new Set(savedPlots.filter(p=>!savedSurvey||String(p.survey)===savedSurvey).map(p=>String(p.sheet||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  for(const id of ['savedSheetFilter','mobileSheetFilter']){const sel=$(id);if(!sel)continue;const cur=sel.value;sel.innerHTML='<option value="">All sheets</option>'+sheets.map(x=>`<option value="${escapeHtml(x)}">Sheet ${escapeHtml(x)}</option>`).join('');sel.value=sheets.includes(cur)?cur:'';}
}
function setSavedSurvey(v){
  if(!v||v===savedSurvey)return;savedSurvey=v;localStorage.setItem('harpurSavedSurvey',savedSurvey);activeSavedPlot=null;clearSelectedBBox();savedInfoWindow?.close();hideMobilePlotPopup();renderSurveySegments();refreshSavedSheetOptions();populateOwnerFilter();syncMobileOwnerFilter();if($('savedSheetFilter'))$('savedSheetFilter').value='';if($('mobileSheetFilter'))$('mobileSheetFilter').value='';if($('savedOwnerFilter'))$('savedOwnerFilter').value='';if($('mobileOwnerFilter'))$('mobileOwnerFilter').value='';if(isMobileSavedMode())resetMobileSelectionToAll();renderSavedList();renderSavedMarkers();if(isMobileSavedMode()){renderMobileSavedList();updateMobileSelectedVisibility();fitMobileSelectedPlots();}else fitAllSavedPlots();
}

async function loadSavedPlots(){
  const r = await fetch('/api/plots');
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || 'Could not load saved plots');
  savedPlots = Array.isArray(data) ? data : [];
  renderSurveySegments();
  refreshSavedSheetOptions();
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
    if($('mobileShowShapes')) $('mobileShowShapes').checked = mobileShapesEnabled;
    if($('mobileShowPins')) $('mobileShowPins').checked = mobilePinsEnabled;
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
  const owners = [...new Set(savedPlots.filter(p=>!savedSurvey||String(p.survey)===savedSurvey).map(p => (p.owner || '').trim()).filter(Boolean))]
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
  const q=$('savedSearch').value.trim().toLowerCase(),sheet=$('savedSheetFilter').value,owner=$('savedOwnerFilter').value;
  const rows=savedPlots.filter(p=>{if(savedSurvey&&String(p.survey)!==savedSurvey)return false;if(sheet&&p.sheet!==sheet)return false;if(owner&&(p.owner||'')!==owner)return false;if(q){const hay=`${p.plot_no} ${p.khesra_no||''} ${p.khata_no||''} ${p.jamabandi_no||''} ${p.computerized_jamabandi_no||''} ${p.exact_raiyat_name||''} ${p.owner||''} ${p.local_name||''} ${p.notes||''}`.toLowerCase();if(!hay.includes(q))return false;}return true;});
  return sortSavedRows(rows,false);
}

function renderSavedList(){
  const rows = filteredSavedPlots();
  $('savedCount').textContent = `${rows.length} ${savedSurvey||''} plots`;
  const box = $('savedList');
  box.innerHTML = '';

  rows.forEach(p => {
    const item = document.createElement('div');
    item.className = 'plot-row' + (activeSavedPlot?.id === p.id ? ' active' : '');
    item.dataset.id = p.id;

    const head = document.createElement('div');
    head.className = 'plot-row-head';
    head.innerHTML = `<span class="plot-no">Plot ${escapeHtml(p.plot_no)}</span><span class="plot-sheet">${escapeHtml(p.survey||'')} • Sheet ${escapeHtml(p.sheet)}</span>`;

    const owner = document.createElement('div');
    owner.className = 'plot-owner';
    owner.textContent = p.owner || 'Owner not entered';

    item.appendChild(head);
    item.appendChild(owner);

    if(Number.isFinite(Number(p.calculated_area_decimal))){
      const measure=document.createElement('div');measure.className='plot-note';
      measure.textContent=`Map ${Number(p.calculated_area_decimal).toFixed(2)} Decimal • ${(Number(p.calculated_area_decimal)/DECIMAL_PER_BIGHA).toFixed(3)} Bigha`;
      item.appendChild(measure);
    }
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
    savedMarkers.forEach((marker,id)=>{marker.setMap(savedShowPins&&visible.has(id)?savedMap:null);marker.setVisible(savedShowPins&&visible.has(id));});
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
  clearAllShapes();
  clearSelectedBBox();

  savedPlots.filter(p=>(!savedSurvey||String(p.survey)===savedSurvey)&&validCenter(p)).forEach(p=>{
    const marker=new google.maps.Marker({
      position:{lat:Number(p.center_lat),lng:Number(p.center_lng)},
      map:savedShowPins?savedMap:null,
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
function validGeometry(p){
  const g=p?.geometry?.type==='Feature'?p.geometry.geometry:p?.geometry,ring=g?.type==='Polygon'&&Array.isArray(g.coordinates?.[0])?g.coordinates[0]:null;if(!ring||ring.length<4)return false;
  try{const native=ring.map(([lng,lat])=>proj4('EPSG:4326','EPSG:32645',[Number(lng),Number(lat)])).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));if(native.length<4)return false;const xs=native.map(v=>v[0]),ys=native.map(v=>v[1]),gw=Math.max(...xs)-Math.min(...xs),gh=Math.max(...ys)-Math.min(...ys);if(gw<1||gh<1)return false;if(validBBox(p)){const bw=Number(p.xmax)-Number(p.xmin),bh=Number(p.ymax)-Number(p.ymin),wr=gw/bw,hr=gh/bh;if(wr<0.35||wr>1.25||hr<0.35||hr>1.25)return false;}return true;}catch(_){return false;}
}

function geometryPath(p){
  const g=p?.geometry?.type==='Feature'?p.geometry.geometry:p?.geometry;
  if(!g?.coordinates?.[0]) return null;
  return g.coordinates[0].map(([lng,lat])=>({lat:Number(lat),lng:Number(lng)}))
    .filter(pt=>Number.isFinite(pt.lat)&&Number.isFinite(pt.lng));
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
function parcelPath(p){
  return validGeometry(p) ? geometryPath(p) : bboxPath(p);
}
function drawShapePolygon(p,{selected=false,fillOpacity=null}={}){
  const path=validGeometry(p)?geometryPath(p):null;
  if(!path||!savedMap) return null;
  const fill=fillOpacity==null?(selected?Math.max(0.18,mobileBBoxFillOpacity):mobileBBoxFillOpacity):fillOpacity;
  return new google.maps.Polygon({
    paths:path,map:savedMap,
    strokeColor:selected?'#ff1f0f':'#e53935',strokeOpacity:1,strokeWeight:selected?5:3,
    fillColor:selected?'#6b4fb3':'#e53935',fillOpacity:fill,clickable:false,zIndex:selected?1100:120
  });
}
function drawBBoxOnly(p,{selected=false}={}){
  const path=bboxPath(p);
  if(!path||!savedMap) return null;
  return new google.maps.Polygon({
    paths:path,map:savedMap,
    strokeColor:selected?'#ffffff':'#ffd54f',strokeOpacity:selected?0.95:0.9,strokeWeight:selected?3:2,
    fillOpacity:0,clickable:false,zIndex:selected?1090:110
  });
}
// Backward-compatible helper used by older call sites: prefer irregular shape, otherwise BBox.
function drawBBoxPolygon(p,{selected=false,fillOpacity=null}={}){
  return validGeometry(p)?drawShapePolygon(p,{selected,fillOpacity}):drawBBoxOnly(p,{selected});
}
function clearSelectedBBox(){
  if(selectedBBoxPolygon){selectedBBoxPolygon.setMap(null);selectedBBoxPolygon=null;}
  if(selectedShapePolygon){selectedShapePolygon.setMap(null);selectedShapePolygon=null;}
}
function showSelectedBBox(p){
  clearSelectedBBox();
  const showShape=isMobileSavedMode()?mobileShapesEnabled:savedShowShapes;
  const showBox=isMobileSavedMode()?mobileBoxesEnabled:savedShowBBoxes;
  if(showShape&&validGeometry(p)) selectedShapePolygon=drawShapePolygon(p,{selected:true});
  if(showBox&&validBBox(p)) selectedBBoxPolygon=drawBBoxOnly(p,{selected:true});
  // If both display layers are off, still keep a selected outline visible for orientation.
  if(!selectedShapePolygon&&!selectedBBoxPolygon){
    if(validGeometry(p)) selectedShapePolygon=drawShapePolygon(p,{selected:true,fillOpacity:.12});
    else if(validBBox(p)) selectedBBoxPolygon=drawBBoxOnly(p,{selected:true});
  }
}
function clearAllBBoxes(){
  allBBoxPolygons.forEach(poly=>poly.setMap(null));
  allBBoxPolygons.clear();
}
function clearAllShapes(){
  allShapePolygons.forEach(poly=>poly.setMap(null));
  allShapePolygons.clear();
}
function renderAllBBoxes(){
  clearAllBBoxes();
  clearAllShapes();
  if(!savedMap) return;
  filteredSavedPlots().forEach(p=>{
    if(savedShowShapes&&validGeometry(p)){
      const shape=drawShapePolygon(p,{selected:false,fillOpacity:mobileBBoxFillOpacity});
      if(shape) allShapePolygons.set(p.id,shape);
    }
    if(savedShowBBoxes&&validBBox(p)){
      const box=drawBBoxOnly(p,{selected:false});
      if(box) allBBoxPolygons.set(p.id,box);
    }
  });
  savedMarkers.forEach((marker,id)=>{
    const visible=filteredSavedPlots().some(p=>p.id===id);
    marker.setMap(savedShowPins&&visible?savedMap:null);
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
    if(validGeometry(p)||validBBox(p)){
      const path=parcelPath(p);
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
  meta.textContent = `${p.owner || 'Owner not entered'} • ${p.survey||''} Sheet ${p.sheet}${Number.isFinite(Number(p.calculated_area_decimal)) ? ` • ${Number(p.calculated_area_decimal).toFixed(2)} dec map` : ''}`;

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
  $('summaryMeta').textContent = ` • ${p.owner || 'Owner not entered'} • ${p.survey||''} Sheet ${p.sheet}${Number.isFinite(Number(p.calculated_area_decimal)) ? ` • Map ${Number(p.calculated_area_decimal).toFixed(2)} dec` : ''}`;
  $('summaryDirections').onclick = () => openDirections(p);
  $('summaryDetails').onclick = () => openDetails(p);
}

function detailFamilyMembers(){
  const fid=Number($('detailFamilySelect')?.value||0);
  return addReferenceData.members.filter(m=>!fid||Number(m.family_id)===fid);
}
function populateDetailReferenceControls(){
  if(!$('detailFamilySelect')) return;
  const familySel=$('detailFamilySelect'), locationSel=$('detailLocationSelect');
  const oldFamily=familySel.value, oldLocation=locationSel.value;
  familySel.innerHTML='<option value="">Select family…</option>'+addReferenceData.families.map(f=>`<option value="${f.id}">${escapeHtml(f.family_name)}</option>`).join('');
  locationSel.innerHTML='<option value="">Select location…</option>'+addReferenceData.locations.map(l=>`<option value="${l.id}">${escapeHtml(l.location_name||l.name||'Location')}</option>`).join('');
  if([...familySel.options].some(o=>o.value===oldFamily)) familySel.value=oldFamily;
  if([...locationSel.options].some(o=>o.value===oldLocation)) locationSel.value=oldLocation;
  populateDetailOwnerControls();
}
function populateDetailOwnerControls(){
  const members=detailFamilyMembers(),sel=$('detailPrimaryOwnerSelect'),old=sel.value;
  sel.innerHTML='<option value="">Select owner…</option>'+members.map(m=>`<option value="${m.id}">${escapeHtml(m.display_name||m.member_name)}${m.relation?` — ${escapeHtml(m.relation)}`:''}</option>`).join('');
  if([...sel.options].some(o=>o.value===old)) sel.value=old;
  renderDetailCoOwnerList(); renderDetailCoOwnerChips();
}
function setDetailOwnershipType(type){
  $('detailOwnershipType').value=type;
  $('detailOwnershipIndividual').classList.toggle('active',type==='Individual');
  $('detailOwnershipJoint').classList.toggle('active',type==='Joint');
  $('detailIndividualOwnerWrap').classList.toggle('hidden',type!=='Individual');
  $('detailJointOwnersWrap').classList.toggle('hidden',type!=='Joint');
  if(type==='Individual') detailCoOwnerIds.clear(); else $('detailPrimaryOwnerSelect').value='';
  renderDetailCoOwnerList(); renderDetailCoOwnerChips();
}
function renderDetailCoOwnerList(){
  if(!$('detailCoOwnerList')) return;
  const q=($('detailCoOwnerSearch')?.value||'').trim().toLowerCase();
  const members=detailFamilyMembers().filter(m=>`${m.member_name} ${m.display_name||''} ${m.relation||''}`.toLowerCase().includes(q));
  $('detailCoOwnerList').innerHTML=members.map(m=>`<label class="co-owner-row"><input type="checkbox" value="${m.id}" ${detailCoOwnerIds.has(Number(m.id))?'checked':''}/><span><b>${escapeHtml(m.display_name||m.member_name)}</b>${m.relation?`<small>${escapeHtml(m.relation)}</small>`:''}</span></label>`).join('')||'<div class="muted empty-picker">No family members found.</div>';
  $('detailCoOwnerList').querySelectorAll('input').forEach(cb=>cb.onchange=()=>{const id=Number(cb.value);if(cb.checked)detailCoOwnerIds.add(id);else detailCoOwnerIds.delete(id);renderDetailCoOwnerChips();});
}
function renderDetailCoOwnerChips(){
  if(!$('detailCoOwnerChips')) return;
  const byId=new Map(addReferenceData.members.map(m=>[Number(m.id),m]));
  $('detailCoOwnerChips').innerHTML=[...detailCoOwnerIds].map(id=>{const m=byId.get(id);return m?`<span class="owner-chip">${escapeHtml(m.display_name||m.member_name)} <button type="button" data-id="${id}">×</button></span>`:'';}).join('');
  $('detailCoOwnerChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{detailCoOwnerIds.delete(Number(b.dataset.id));renderDetailCoOwnerChips();renderDetailCoOwnerList();});
  $('openDetailCoOwnerPicker').textContent=detailCoOwnerIds.size?`${detailCoOwnerIds.size} owner${detailCoOwnerIds.size===1?'':'s'} selected`:'Select owners';
}
function updateDetailBigha(){const d=Number($('detailPlotAreaDecimal').value);$('detailPlotAreaBigha').value=Number.isFinite(d)&&d>0?(d/DECIMAL_PER_BIGHA).toFixed(4):'';}
function detailOwnerPayload(){
  const type=$('detailOwnershipType').value,familyId=Number($('detailFamilySelect').value||0)||null;
  if(type==='Individual'){
    const id=Number($('detailPrimaryOwnerSelect').value||0)||null;
    if(!id) throw new Error('Select one Owner for Individual ownership.');
    const m=addReferenceData.members.find(x=>Number(x.id)===id);
    return{ownership_type:type,family_id:familyId,primary_family_member_id:id,coowner_ids:[],owner:m?.display_name||m?.member_name||''};
  }
  const ids=[...detailCoOwnerIds];
  if(ids.length<2) throw new Error('Joint ownership requires at least two Owners.');
  const names=ids.map(id=>addReferenceData.members.find(m=>Number(m.id)===id)).filter(Boolean).map(m=>m.display_name||m.member_name);
  return{ownership_type:type,family_id:familyId,primary_family_member_id:null,coowner_ids:ids,owner:names.join('; ')};
}
async function openDetails(p){
  activeSavedPlot = p;
  if(!addReferenceData.families.length){ try{ await loadReferenceData(); }catch(e){ console.warn(e); } }
  populateDetailReferenceControls();
  $('detailTitle').textContent = `Plot ${p.plot_no}`;
  $('detailSubtitle').textContent = `${p.owner || 'Owner not entered'} • ${p.survey || "?"} Sheet ${p.sheet}`;
  $('detailExactRaiyatName').value=p.exact_raiyat_name||'';
  $('detailLandType').value=p.land_type||'';
  $('detailKhesraNo').value=p.khesra_no||p.plot_no||'';
  $('detailMauza').value=p.mauza||p.village_name||'Harpur(199)';
  $('detailThanaNo').value=p.thana_no||'';
  $('detailJamabandiNo').value=p.jamabandi_no||'';
  $('detailPartNo').value=p.part_no||'';
  $('detailPageNo').value=p.page_no||'';
  $('detailComputerizedJamabandiNo').value=p.computerized_jamabandi_no||'';
  $('detailKhataNo').value=p.khata_no||'';
  $('detailPlotAreaDecimal').value=p.plot_area_decimal??'';
  $('detailJamabandiTotalAreaDecimal').value=p.jamabandi_total_area_decimal??'';
  $('detailLocalName').value=p.local_name||'';
  $('detailNotes').value=p.notes||'';
  if(p.family_id) $('detailFamilySelect').value=String(p.family_id);
  populateDetailOwnerControls();
  setDetailOwnershipType(p.ownership_type||'Individual');
  if(p.primary_family_member_id) $('detailPrimaryOwnerSelect').value=String(p.primary_family_member_id);
  detailCoOwnerIds=new Set((p.coowner_ids||[]).map(Number));
  renderDetailCoOwnerList(); renderDetailCoOwnerChips();
  if(p.location_id) $('detailLocationSelect').value=String(p.location_id);
  updateDetailBigha();

  $('detailSurvey').textContent = p.survey || '';
  $('detailMapInstance').textContent = p.map_instance || '—';
  $('detailSheet').textContent = p.sheet || '';
  $('detailPniu').textContent = p.pniu || '—';
  $('detailPlotId').textContent = p.plot_id || '—';
  $('detailGisCode').textContent = p.gis_code || '—';
  $('detailCenter').textContent = validCenter(p) ? `${Number(p.center_lat).toFixed(8)}, ${Number(p.center_lng).toFixed(8)}` : '—';
  $('detailXY').textContent = (p.seed_x != null && p.seed_y != null) ? `${p.seed_x}, ${p.seed_y}` : '—';
  $('detailBBox').textContent = [p.xmin,p.ymin,p.xmax,p.ymax].every(v=>v!=null) ? `${p.xmin}, ${p.ymin}, ${p.xmax}, ${p.ymax}` : '—';
  $('detailGeometry').textContent = validGeometry(p) ? 'Irregular parcel polygon' : (validBBox(p) ? 'BBox fallback • revisit in Add Family Plot to refresh shape' : '—');
  $('detailMapArea').textContent = Number.isFinite(Number(p.calculated_area_decimal)) ? `${Number(p.calculated_area_decimal).toFixed(2)} Decimal / ${(Number(p.calculated_area_decimal)/DECIMAL_PER_BIGHA).toFixed(3)} Bigha` : '—';
  $('detailPerimeter').textContent = Number.isFinite(Number(p.perimeter_m)) ? `${Number(p.perimeter_m).toFixed(1)} m` : '—';
  $('detailLongest').textContent = Number.isFinite(Number(p.approx_length_m)) ? `${Number(p.approx_length_m).toFixed(1)} m` : '—';
  $('detailApproxWidth').textContent = Number.isFinite(Number(p.approx_width_m)) ? `${Number(p.approx_width_m).toFixed(1)} m` : '—';

  $('detailDirections').onclick = () => openDirections(p);
  $('detailGoogle').onclick = () => window.open(buildMapUrl(p),'_blank','noopener');
  document.querySelectorAll('#detailForm details').forEach((d,i)=>d.open=i===0);
  $('detailsModal').classList.remove('hidden');
}
function closeDetails(){ $('detailsModal').classList.add('hidden'); }
$('closeDetails').onclick = closeDetails;
$('detailsModal').addEventListener('click', e => { if(e.target === $('detailsModal')) closeDetails(); });

$('detailSave').onclick = async () => {
  if(!activeSavedPlot) return;
  try{
    const p = activeSavedPlot, ownership=detailOwnerPayload();
    const body = {
      ...p,...ownership,
      exact_raiyat_name:$('detailExactRaiyatName').value.trim(),
      land_type:$('detailLandType').value,
      khesra_no:$('detailKhesraNo').value.trim()||p.plot_no,
      thana_no:$('detailThanaNo').value.trim(),
      jamabandi_no:$('detailJamabandiNo').value.trim(),
      part_no:$('detailPartNo').value.trim(),
      page_no:$('detailPageNo').value.trim(),
      computerized_jamabandi_no:$('detailComputerizedJamabandiNo').value.trim(),
      khata_no:$('detailKhataNo').value.trim(),
      plot_area_decimal:$('detailPlotAreaDecimal').value===''?null:Number($('detailPlotAreaDecimal').value),
      jamabandi_total_area_decimal:$('detailJamabandiTotalAreaDecimal').value===''?null:Number($('detailJamabandiTotalAreaDecimal').value),
      location_id:Number($('detailLocationSelect').value||0)||null,
      local_name:$('detailLocalName').value.trim(),
      notes:$('detailNotes').value.trim(),
      geometry:p.geometry || null
    };
    const r = await fetch('/api/plots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Save failed');
    const idx = savedPlots.findIndex(x=>x.id===p.id);
    if(idx>=0) savedPlots[idx] = d;
    activeSavedPlot = d;
    populateOwnerFilter(); renderSavedList(); renderSavedMarkers(); focusSavedPlot(d,false); await openDetails(d);
  }catch(err){ alert(err.message); }
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


$('detailOwnershipIndividual').onclick=()=>setDetailOwnershipType('Individual');
$('detailOwnershipJoint').onclick=()=>setDetailOwnershipType('Joint');
$('detailFamilySelect').onchange=()=>{detailCoOwnerIds.clear();populateDetailOwnerControls();};
$('detailPlotAreaDecimal').oninput=updateDetailBigha;
$('openDetailCoOwnerPicker').onclick=()=>{$('detailCoOwnerPicker').classList.remove('hidden');renderDetailCoOwnerList();};
$('closeDetailCoOwnerPicker').onclick=()=>$('detailCoOwnerPicker').classList.add('hidden');
$('detailCoOwnerDone').onclick=()=>$('detailCoOwnerPicker').classList.add('hidden');
$('detailCoOwnerSearch').oninput=renderDetailCoOwnerList;

// Saved detail accordion UX: Plot Identity is always open. Desktop allows two
// additional sections; mobile keeps one additional section open at a time.
(() => {
  const details=[...document.querySelectorAll('#detailForm details')];
  let order=[];
  details.forEach(d=>d.addEventListener('toggle',()=>{
    if(!d.open){order=order.filter(x=>x!==d);return;}
    order=order.filter(x=>x!==d);order.push(d);
    const max=window.matchMedia('(max-width:900px)').matches?1:2;
    while(order.filter(x=>x.open).length>max){const oldest=order.shift();if(oldest&&oldest!==d)oldest.open=false;}
  }));
})();

$('savedSearch').oninput = renderSavedList;
$('savedSheetFilter').onchange = renderSavedList;
$('savedOwnerFilter').onchange = renderSavedList;
$('savedSort').onchange = renderSavedList;
$('showParcelShapes').onchange=e=>{savedShowShapes=e.target.checked;mobileShapesEnabled=savedShowShapes;if($('mobileShowShapes'))$('mobileShowShapes').checked=savedShowShapes;renderAllBBoxes();};
$('showAllBBoxes').onchange=e=>{savedShowBBoxes=e.target.checked;mobileBoxesEnabled=savedShowBBoxes;if($('mobileShowBoxes'))$('mobileShowBoxes').checked=savedShowBBoxes;renderAllBBoxes();};
$('showSavedPins').onchange=e=>{savedShowPins=e.target.checked;mobilePinsEnabled=savedShowPins;if($('mobileShowPins'))$('mobileShowPins').checked=savedShowPins;renderAllBBoxes();};
$('fitAllSaved').onclick = fitAllSavedPlots;

$('mobilePlotsBtn').onclick=openMobilePlotsDrawer;
$('mobileFitBtn').onclick=fitMobileSelectedPlots;
$('mobileBoxesBtn').onclick=openMobileBoxesPanel;
$('mobileShowShapes').onchange=e=>setMobileShapesEnabled(e.target.checked);
$('mobileShowBoxes').onchange=e=>setMobileBoxesEnabled(e.target.checked);
$('mobileShowPins').onchange=e=>setMobilePinsEnabled(e.target.checked);
$('mobileBBoxOpacity').oninput=e=>setMobileBBoxOpacity(e.target.value);
$('mobilePopupClose').onclick=hideMobilePlotPopup;
$('mobileDrawerClose').onclick=closeMobilePlotsDrawer;
$('mobileSavedSearch').oninput=renderMobileSavedList;
$('mobileSheetFilter').onchange=renderMobileSavedList;
$('mobileOwnerFilter').onchange=renderMobileSavedList;
$('mobileSavedSort').onchange=renderMobileSavedList;

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
const ADD_BASE = {state:'10',district:'30',subdivision:'01',circle:'02'};
const DECIMAL_PER_BIGHA = 62;

function resetSelect(id, placeholder, disabled=true){
  const el=$(id); if(!el) return;
  el.innerHTML='';
  const o=document.createElement('option'); o.value='';o.textContent=placeholder;
  el.appendChild(o); el.value=''; el.disabled=disabled;
  syncMobileMapControls();
}

function fillSelect(id, options, placeholder, selectedValue=''){
  const el=$(id); if(!el) return;
  el.innerHTML='';
  const first=document.createElement('option'); first.value='';first.textContent=placeholder;
  el.appendChild(first);
  (options||[]).forEach(item=>{
    const o=document.createElement('option'); o.value=String(item.value); o.textContent=item.label || item.value; el.appendChild(o);
  });
  el.disabled=false;
  if(selectedValue && [...el.options].some(o=>o.value===String(selectedValue))){
    el.value=String(selectedValue);
  }else if((options||[]).length){
    // Map-first UX: choose the first live BhuNaksha option automatically.
    el.value=String(options[0].value);
  }else{
    el.value='';
  }
  syncMobileMapControls();
}

function activeContextParams(extra={}){
  return {...ADD_BASE,mauza:currentMauza,survey:currentSurvey,mapInstance:currentMapInstance,sheet:currentSheet,
    ...(addConfig?.gisCode?{gisCode:addConfig.gisCode}:{}),...(addConfig?.levels?{levels:addConfig.levels}:{}),...extra};
}
function setLifecycleHint(text){ if($('mapLifecycleHint')) $('mapLifecycleHint').textContent=text; }
function setMapLoading(show,text='Loading survey map…'){
  const card=$('mapLoadingCard'); if(!card) return;
  card.classList.toggle('hidden',!show);
  if(show && text){ const span=card.querySelector('span'); if(span) span.textContent=text; }
}

async function fetchOptions(url){
  const r=await fetch(url); const d=await r.json();
  if(!r.ok) throw new Error(d.error||'BhuNaksha hierarchy request failed');
  return d.options||[];
}

function syncSelectMirror(sourceId, mirrorId){
  const src=$(sourceId), mirror=$(mirrorId); if(!src||!mirror) return;
  mirror.innerHTML=[...src.options].map(o=>`<option value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</option>`).join('');
  mirror.value=src.value; mirror.disabled=src.disabled;
}
function syncMobileMapControls(){
  syncSelectMirror('mauzaSelect','mobileMauzaMirror');
  syncSelectMirror('surveySelect','mobileSurveyMirror');
  syncSelectMirror('mapInstanceSelect','mobileMapMirror');
  syncSelectMirror('sheetSelect','mobileSheetMirror');
  const m=$('mauzaSelect')?.selectedOptions?.[0]?.textContent||'Mauza';
  const s=$('surveySelect')?.selectedOptions?.[0]?.textContent||'Survey';
  const sh=$('sheetSelect')?.value||'—';
  if($('mobileMapSettingsBtn')) $('mobileMapSettingsBtn').innerHTML=`${escapeHtml(m)} • ${escapeHtml(s)} • Sheet ${escapeHtml(sh)} <span>Change</span>`;
}

async function loadMauzas(preferred='0230'){
  resetSelect('mauzaSelect','Loading Mauzas…',true); setMapLoading(true,'Loading Rajpur Mauzas…');
  setLifecycleHint('Loading Rajpur Mauzas from BhuNaksha…');
  const q=new URLSearchParams(ADD_BASE), options=await fetchOptions(`/api/bhunaksha/mauzas?${q}`);
  fillSelect('mauzaSelect',options,'Select Mauza…',preferred);
  currentMauza=$('mauzaSelect').value||'';
  if(currentMauza){localStorage.setItem('harpurMauza',currentMauza);await loadSurveys();}
  else{resetSelect('surveySelect','Select survey…',true);setLifecycleHint('Select a Mauza to load Survey Types.');setMapLoading(false);}
}
async function loadSurveys(preferred=''){
  clearMapContextAndSelection(true); resetSelect('surveySelect','Loading surveys…',true); resetSelect('mapInstanceSelect','Select map…',true); resetSelect('sheetSelect','Select sheet…',true);
  if(!currentMauza)return;
  setMapLoading(true,'Loading survey types…');
  const requestedMauza=currentMauza,q=new URLSearchParams({...ADD_BASE,mauza:requestedMauza});
  const options=await fetchOptions(`/api/bhunaksha/surveys?${q}`); if(currentMauza!==requestedMauza)return;
  fillSelect('surveySelect',options,'Select survey…',preferred); currentSurvey=$('surveySelect').value||'';
  if(currentSurvey)await loadMapInstances(); else{setLifecycleHint('Select a Survey Type.');setMapLoading(false);}
}
async function loadMapInstances(preferred=''){
  clearMapContextAndSelection(true); resetSelect('mapInstanceSelect','Loading maps…',true); resetSelect('sheetSelect','Select sheet…',true);
  if(!currentMauza||!currentSurvey)return;
  setMapLoading(true,`Loading ${currentSurvey} map instances…`);
  const requested={mauza:currentMauza,survey:currentSurvey},q=new URLSearchParams({...ADD_BASE,...requested});
  const options=await fetchOptions(`/api/bhunaksha/map-instances?${q}`);
  if(currentMauza!==requested.mauza||currentSurvey!==requested.survey)return;
  fillSelect('mapInstanceSelect',options,'Select map…',preferred);currentMapInstance=$('mapInstanceSelect').value||'';
  if(currentMapInstance)await loadSheets(); else{setLifecycleHint(`Select a ${currentSurvey} Map Instance.`);setMapLoading(false);}
}
async function loadSheets(preferred=''){
  clearMapContextAndSelection(true); resetSelect('sheetSelect','Loading sheets…',true);
  if(!currentMauza||!currentSurvey||!currentMapInstance)return;
  setMapLoading(true,'Loading map sheets…');
  const requested={mauza:currentMauza,survey:currentSurvey,mapInstance:currentMapInstance},q=new URLSearchParams({...ADD_BASE,...requested});
  const options=await fetchOptions(`/api/bhunaksha/sheets?${q}`);
  if(currentMauza!==requested.mauza||currentSurvey!==requested.survey||currentMapInstance!==requested.mapInstance)return;
  fillSelect('sheetSelect',options,'Select sheet…',preferred);currentSheet=$('sheetSelect').value||'';
  if(currentSheet)await loadSelectedMapContext();else{setLifecycleHint(`Select a Sheet for ${currentSurvey}.`);setMapLoading(false);}
}

function initAddMap(){
  if(addMap)return;
  addMap=new google.maps.Map($('addMap'),{center:{lat:25.3501,lng:83.9334},zoom:15,mapTypeId:'hybrid',tilt:0,streetViewControl:false,fullscreenControl:true,mapTypeControl:true});
  addMap.addListener('click',async e=>{if(!addConfig){$('addStatus').textContent='Survey map is still loading.';return;}try{await lookupAddPlot(e.latLng);}catch(err){$('addStatus').textContent=err.message;}});
  addMap.addListener('idle',()=>{if(addConfig)scheduleAddOverlayRefresh(false);});
}
function clearMapContextAndSelection(removeOverlay=false){clearAddSelection();addConfig=null;lastOverlaySignature='';if(removeOverlay&&overlayView){overlayView.setMap(null);overlayView=null;}}
async function loadSelectedMapContext(){
  if(!currentMauza||!currentSurvey||!currentMapInstance||!currentSheet)return;
  clearMapContextAndSelection(true);setMapLoading(true,`Loading ${currentSurvey} Sheet ${currentSheet}…`);
  setLifecycleHint(`Loading ${currentSurvey} Sheet ${currentSheet}: extent → layers → WMS…`);$('addStatus').textContent=`Loading ${currentSurvey} Sheet ${currentSheet}…`;
  const requested={mauza:currentMauza,survey:currentSurvey,mapInstance:currentMapInstance,sheet:currentSheet},q=new URLSearchParams({...ADD_BASE,...requested});
  const r=await fetch(`/api/bhunaksha/map-context?${q}`),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not initialize BhuNaksha map context');
  if(currentMauza!==requested.mauza||currentSurvey!==requested.survey||currentMapInstance!==requested.mapInstance||currentSheet!==requested.sheet)return;
  addConfig=d;initAddMap();updateRawImageLink();fitAddSheet();scheduleAddOverlayRefresh(true);syncMobileMapControls();setMapLoading(false);
  setLifecycleHint(`${currentSurvey} • ${$('mapInstanceSelect').selectedOptions[0]?.textContent||currentMapInstance} • Sheet ${currentSheet}`);
  $('addStatus').textContent=`${currentSurvey} Sheet ${currentSheet} ready • tap a parcel to select.`;
}
function updateRawImageLink(){if(!addConfig?.nativeExtent)return;const b=addConfig.nativeExtent,q=new URLSearchParams(activeContextParams({xmin:b.xmin,ymin:b.ymin,xmax:b.xmax,ymax:b.ymax,width:1502,height:1028}));$('rawImageLink').href=`/api/bhunaksha-sheet.png?${q}`;}
function clearAddSelection(){
  addReconstructSeq++;
  if(selectionMarker){selectionMarker.setMap(null);selectionMarker=null;}if(selectedPolygon){selectedPolygon.setMap(null);selectedPolygon=null;}selectedPlot=null;selectedCoOwnerIds.clear();
  $('plotSelectionCard')?.classList.add('hidden');$('plotDetailsPanel')?.classList.add('hidden');$('saveSuccessCard')?.classList.add('hidden');
}
function fitAddSheet(){if(!addMap||!addConfig?.googleBounds)return;const b=addConfig.googleBounds;addMap.fitBounds(new google.maps.LatLngBounds({lat:b.south,lng:b.west},{lat:b.north,lng:b.east}),30);}
function createBhuNakshaOverlayClass(){return class BhuNakshaImageOverlay extends google.maps.OverlayView{constructor(url,bounds,opacity=.9){super();this.url=url;this.bounds=bounds;this.opacity=opacity;this.div=null;this.img=null;this.loadSeq=0;}onAdd(){this.div=document.createElement('div');this.div.style.position='absolute';this.img=document.createElement('img');this.img.src=this.url;this.img.className='bhu-sheet';this.img.style.cssText=`position:absolute;left:0;top:0;width:100%;height:100%;opacity:${this.opacity}`;this.img.onload=()=>{$('addStatus').textContent=`${currentSurvey} Sheet ${currentSheet} ready • tap a parcel to select.`;};this.img.onerror=()=>{$('addStatus').textContent='BhuNaksha image temporarily unavailable — use Refresh.';};this.div.appendChild(this.img);this.getPanes().overlayLayer.appendChild(this.div);}draw(){if(!this.div)return;const p=this.getProjection();if(!p)return;const sw=p.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.south,this.bounds.west)),ne=p.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.north,this.bounds.east));if(!sw||!ne)return;this.div.style.left=sw.x+'px';this.div.style.top=ne.y+'px';this.div.style.width=(ne.x-sw.x)+'px';this.div.style.height=(sw.y-ne.y)+'px';}onRemove(){if(this.div?.parentNode)this.div.parentNode.removeChild(this.div);this.div=null;this.img=null;}setOpacity(v){this.opacity=v;if(this.img)this.img.style.opacity=String(v);}update(url,bounds){const seq=++this.loadSeq,candidate=new Image();candidate.className='bhu-sheet';candidate.style.cssText=`position:absolute;left:0;top:0;width:100%;height:100%;opacity:${this.opacity}`;candidate.onload=()=>{if(seq!==this.loadSeq||!this.div)return;const old=this.img;this.url=url;this.bounds=bounds;this.img=candidate;if(old&&old.parentNode===this.div)this.div.replaceChild(candidate,old);else this.div.appendChild(candidate);this.draw();$('addStatus').textContent=`${currentSurvey} Sheet ${currentSheet} ready • tap a parcel to select.`;};candidate.onerror=()=>{if(seq!==this.loadSeq)return;$('addStatus').textContent='Refresh failed — keeping the previous BhuNaksha image.';};candidate.src=url;}}}
let BhuNakshaImageOverlay=null;
function nativeBBoxToLatLngBounds(b){const corners=[[b.xmin,b.ymin],[b.xmax,b.ymax],[b.xmin,b.ymax],[b.xmax,b.ymin]].map(c=>proj4('EPSG:32645','EPSG:4326',c)),lats=corners.map(c=>c[1]),lngs=corners.map(c=>c[0]);return{south:Math.min(...lats),north:Math.max(...lats),west:Math.min(...lngs),east:Math.max(...lngs)};}
function currentAddViewportNativeBBox(){const bounds=addMap?.getBounds();if(!bounds||!addConfig)return null;const ne=bounds.getNorthEast(),sw=bounds.getSouthWest(),pts=[[ne.lng(),ne.lat()],[sw.lng(),sw.lat()],[sw.lng(),ne.lat()],[ne.lng(),sw.lat()]].map(p=>proj4('EPSG:4326','EPSG:32645',p));return{xmin:Math.min(...pts.map(p=>p[0])),ymin:Math.min(...pts.map(p=>p[1])),xmax:Math.max(...pts.map(p=>p[0])),ymax:Math.max(...pts.map(p=>p[1]))};}
function currentAddImageSize(){const rect=$('addMap').getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);return{width:Math.min(2200,Math.max(512,Math.round(rect.width*dpr))),height:Math.min(2200,Math.max(512,Math.round(rect.height*dpr)))};}
function addOverlaySignature(b,s){return[addMap?.getZoom()||'',currentMauza,currentSurvey,currentMapInstance,currentSheet,b.xmin.toFixed(2),b.ymin.toFixed(2),b.xmax.toFixed(2),b.ymax.toFixed(2),s.width,s.height].join('|');}
function refreshAddOverlay(force=false){if(!addMap||!addConfig)return;if(!$('showNaksha').checked){if(overlayView){overlayView.setMap(null);overlayView=null;}return;}const bbox=currentAddViewportNativeBBox();if(!bbox)return;const size=currentAddImageSize(),sig=addOverlaySignature(bbox,size);if(!force&&sig===lastOverlaySignature)return;lastOverlaySignature=sig;const q=new URLSearchParams(activeContextParams({...bbox,width:size.width,height:size.height,t:Date.now()})),url=`/api/viewport-overlay.png?${q}`,bounds=nativeBBoxToLatLngBounds(bbox);if(!BhuNakshaImageOverlay)BhuNakshaImageOverlay=createBhuNakshaOverlayClass();if(!overlayView){overlayView=new BhuNakshaImageOverlay(url,bounds,Number($('opacity').value)/100);overlayView.setMap(addMap);}else{overlayView.update(url,bounds);overlayView.setOpacity(Number($('opacity').value)/100);}$('addStatus').textContent=`Refreshing ${currentSurvey} Sheet ${currentSheet}…`;}
function scheduleAddOverlayRefresh(force=false){clearTimeout(addRefreshTimer);addRefreshTimer=setTimeout(()=>refreshAddOverlay(force),650);}
function placeAddPin(latLng,label=''){if(selectionMarker){selectionMarker.setMap(null);selectionMarker=null;}selectionMarker=new google.maps.Marker({position:latLng,map:addMap,title:label?`Selected plot ${label}`:'Selected location',label:label?{text:String(label),fontWeight:'700'}:undefined,animation:google.maps.Animation.DROP,zIndex:999});}


function formatMeasure(v,digits=1){
  const n=Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
function applyMeasurements(target, measurements){
  if(!target||!measurements)return target;
  target.measurements={...measurements};
  Object.assign(target,measurements);
  return target;
}
function measurementSummary(p){
  if(!p)return '';
  const dec=Number(p.calculated_area_decimal);
  const bigha=Number.isFinite(dec)?dec/DECIMAL_PER_BIGHA:null;
  if(!Number.isFinite(dec))return '';
  return `Map area ${dec.toFixed(2)} Decimal • ${bigha.toFixed(3)} Bigha • Longest ${formatMeasure(p.approx_length_m)} m`;
}
async function reconstructPlotShape(p,{persist=false}={}){
  if(!p?.plot_id||!validBBox(p))throw new Error('Plot ID/BBox not available for shape reconstruction.');
  const r=await fetch('/api/reconstruct',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(p)
  });
  const f=await r.json();
  if(!r.ok)throw new Error(f.error||'Shape reconstruction failed');
  p.geometry=f.geometry;
  p.source=f.properties?.source||p.source||'';
  p.geometry_source=p.source;
  p.geometry_status=f.properties?.geometryStatus||'VALID';
  p.geometry_version=f.properties?.geometryVersion||2;
  applyMeasurements(p,f.properties?.measurements||{});
  if(persist && p.id){
    const save=await fetch('/api/plots',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...p,measurements:p.measurements||null})
    });
    const d=await save.json();
    if(!save.ok)throw new Error(d.error||'Could not cache parcel shape');
    Object.assign(p,d);
  }
  return p;
}
async function lookupAddPlot(latLng){
  if(!addConfig)throw new Error('Survey map is still loading.');placeAddPin(latLng);const [x,y]=proj4('EPSG:4326','EPSG:32645',[latLng.lng(),latLng.lat()]);$('addStatus').textContent=`Identifying ${currentSurvey} plot…`;
  const q=new URLSearchParams(activeContextParams({x:String(x),y:String(y)})),r=await fetch(`/api/plot-at-xy?${q}`),data=await r.json();if(!r.ok)throw new Error(data.error||'Plot lookup failed');const sc=data.scalar;if(!sc||sc.has_data!=='Y')throw new Error(`No ${currentSurvey} BhuNaksha plot found at this click.`);
  const mauzaLabel=$('mauzaSelect').selectedOptions[0]?.textContent||currentMauza;
  selectedPlot={survey:currentSurvey,map_instance:currentMapInstance,sheet:currentSheet,state:ADD_BASE.state,mauza:mauzaLabel,gis_code:addConfig.gisCode,levels:addConfig.levels,plot_no:String(sc.plotNo||data.hit?.kide||''),plot_id:String(sc.ID||data.hit?.id||''),pniu:String(sc.PNIU||''),seed_x:x,seed_y:y,xmin:sc.xmin,ymin:sc.ymin,xmax:sc.xmax,ymax:sc.ymax,geometry:null,source:''};
  const center=plotCenterFromBBox(selectedPlot);selectedPlot.center_lat=center.lat;selectedPlot.center_lng=center.lng;selectedPlot.google_map_url=mapUrl(center.lat,center.lng);placeAddPin(latLng,selectedPlot.plot_no);showPlotSelectionCard();
  const seq=++addReconstructSeq;
  $('addStatus').textContent=`Plot ${selectedPlot.plot_no} selected • tracing parcel shape…`;
  $('selectionMeasure').textContent='Tracing irregular parcel shape…';
  try{
    const target=selectedPlot;
    await reconstructPlotShape(target);
    if(seq!==addReconstructSeq||selectedPlot!==target)return;
    drawSelectedGeometry(target.geometry);
    $('selectionMeasure').textContent=measurementSummary(target)||'Parcel shape reconstructed.';
    {const ex=savedPlots.find(x=>String(x.plot_no)===String(target.plot_no)&&String(x.gis_code||'')===String(target.gis_code||''));$('addStatus').textContent=ex?`Plot ${target.plot_no} exists • fresh parcel shape captured. Existing information loaded for update.`:`Plot ${target.plot_no} shape ready. Confirm to add details.`;$('addThisPlot').textContent=ex?'Open / Update Plot':'Add This Plot';if(ex)openDetailsForSelected();}
  }catch(err){
    if(seq!==addReconstructSeq)return;
    $('selectionMeasure').textContent='Shape unavailable now • BBox will remain as fallback.';
    {const ex=savedPlots.find(x=>String(x.plot_no)===String(selectedPlot.plot_no)&&String(x.gis_code||'')===String(selectedPlot.gis_code||''));$('addStatus').textContent=ex?`Plot ${selectedPlot.plot_no} exists • shape capture failed, BBox fallback retained. Existing information loaded.`:`Plot ${selectedPlot.plot_no} selected • shape trace unavailable; you can still continue.`;if(ex)openDetailsForSelected();}
  }
}
function plotCenterFromBBox(p){const x=(Number(p.xmin)+Number(p.xmax))/2,y=(Number(p.ymin)+Number(p.ymax))/2,[lng,lat]=proj4('EPSG:32645','EPSG:4326',[x,y]);return{lat,lng};}
function mapUrl(lat,lng){return`https://www.google.com/maps?q=${lat.toFixed(8)},${lng.toFixed(8)}`;}
function showPlotSelectionCard(){
  const p=selectedPlot;if(!p)return;const existing=savedPlots.find(x=>String(x.plot_no)===String(p.plot_no)&&String(x.gis_code||'')===String(p.gis_code||''));$('saveSuccessCard').classList.add('hidden');$('plotDetailsPanel').classList.add('hidden');$('selectionPlotNo').textContent=p.plot_no;$('selectionMeta').textContent=`${p.survey} • ${$('mapInstanceSelect').selectedOptions[0]?.textContent||p.map_instance} • Sheet ${p.sheet}${existing?' • Already saved':''}`;$('selectionPniu').textContent=p.pniu?`PNIU ${p.pniu}`:'PNIU not returned';$('selectionMeasure').textContent=measurementSummary(p)||'Preparing parcel shape…';$('plotSelectionCard').classList.remove('hidden');$('addThisPlot').textContent=existing?'Open / Update Plot':'Add This Plot';$('addStatus').textContent=existing?`Plot ${p.plot_no} already exists. Fresh geometry will be captured from this visible survey selection.`:`Plot ${p.plot_no} selected. Confirm to add details.`;
}

function drawSelectedGeometry(geometry){if(selectedPolygon){selectedPolygon.setMap(null);selectedPolygon=null;}if(!geometry)return;const geom=geometry.type==='Feature'?geometry.geometry:geometry;if(geom?.type==='Polygon'&&geom.coordinates?.[0])selectedPolygon=new google.maps.Polygon({paths:geom.coordinates[0].map(([lng,lat])=>({lat,lng})),map:addMap,strokeWeight:4,fillOpacity:.28,clickable:false});}

async function loadReferenceData(){
  const r=await fetch('/api/reference-data'),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load family/reference data');addReferenceData=d;
  const fs=$('familySelect');fs.innerHTML='<option value="">Select family…</option>'+d.families.map(f=>`<option value="${f.id}">${escapeHtml(f.family_name)}</option>`).join('');if(d.families.length===1)fs.value=String(d.families[0].id);
  const ls=$('locationSelect');ls.innerHTML='<option value="">Select location…</option>'+d.locations.map(l=>`<option value="${l.id}">${escapeHtml(l.location_name||l.name)}</option>`).join('');
  populateOwnerControls();
}
function familyMembers(){const fid=Number($('familySelect').value||0);return addReferenceData.members.filter(m=>!fid||Number(m.family_id)===fid);}
function populateOwnerControls(){
  const members=familyMembers(),sel=$('primaryOwnerSelect'),old=sel.value;sel.innerHTML='<option value="">Select owner…</option>'+members.map(m=>`<option value="${m.id}">${escapeHtml(m.display_name||m.member_name)}${m.relation?` — ${escapeHtml(m.relation)}`:''}</option>`).join('');if([...sel.options].some(o=>o.value===old))sel.value=old;
  renderCoOwnerList();renderCoOwnerChips();
}
function setOwnershipType(type){
  $('ownershipType').value=type;$('ownershipIndividual').classList.toggle('active',type==='Individual');$('ownershipJoint').classList.toggle('active',type==='Joint');$('individualOwnerWrap').classList.toggle('hidden',type!=='Individual');$('jointOwnersWrap').classList.toggle('hidden',type!=='Joint');
  if(type==='Individual')selectedCoOwnerIds.clear();else $('primaryOwnerSelect').value='';renderCoOwnerList();renderCoOwnerChips();
}
function renderCoOwnerList(){
  const q=($('coOwnerSearch')?.value||'').trim().toLowerCase(),members=familyMembers().filter(m=>`${m.member_name} ${m.display_name||''} ${m.relation||''}`.toLowerCase().includes(q));
  $('coOwnerList').innerHTML=members.map(m=>`<label class="co-owner-row"><input type="checkbox" value="${m.id}" ${selectedCoOwnerIds.has(Number(m.id))?'checked':''}/><span><b>${escapeHtml(m.display_name||m.member_name)}</b>${m.relation?`<small>${escapeHtml(m.relation)}</small>`:''}</span></label>`).join('')||'<div class="muted empty-picker">No family members found.</div>';
  $('coOwnerList').querySelectorAll('input').forEach(cb=>cb.onchange=()=>{const id=Number(cb.value);if(cb.checked)selectedCoOwnerIds.add(id);else selectedCoOwnerIds.delete(id);renderCoOwnerChips();});
}
function renderCoOwnerChips(){const byId=new Map(addReferenceData.members.map(m=>[Number(m.id),m]));$('coOwnerChips').innerHTML=[...selectedCoOwnerIds].map(id=>{const m=byId.get(id);return m?`<span class="owner-chip">${escapeHtml(m.display_name||m.member_name)} <button type="button" data-id="${id}">×</button></span>`:'';}).join('');$('coOwnerChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedCoOwnerIds.delete(Number(b.dataset.id));renderCoOwnerChips();renderCoOwnerList();});$('openCoOwnerPicker').textContent=selectedCoOwnerIds.size?`${selectedCoOwnerIds.size} owner${selectedCoOwnerIds.size===1?'':'s'} selected`:'Select owners';}

function updateTechnicalMeasurements(p){
  const set=(id,val)=>{const el=$(id);if(el)el.textContent=val;};
  set('mapCalcArea',Number.isFinite(Number(p?.calculated_area_decimal)) ? `${Number(p.calculated_area_decimal).toFixed(2)} Decimal / ${(Number(p.calculated_area_decimal)/DECIMAL_PER_BIGHA).toFixed(3)} Bigha` : '—');
  set('mapPerimeter',Number.isFinite(Number(p?.perimeter_m)) ? `${Number(p.perimeter_m).toFixed(1)} m` : '—');
  set('mapLongest',Number.isFinite(Number(p?.approx_length_m)) ? `${Number(p.approx_length_m).toFixed(1)} m` : '—');
  set('mapApproxWidth',Number.isFinite(Number(p?.approx_width_m)) ? `${Number(p.approx_width_m).toFixed(1)} m` : '—');
}
function openDetailsForSelected(){
  const p=selectedPlot;if(!p)return;$('plotSelectionCard').classList.add('hidden');$('plotDetailsPanel').classList.remove('hidden');$('plotNo').textContent=p.plot_no;$('plotPanelSubtitle').textContent=`${p.survey} • ${$('mapInstanceSelect').selectedOptions[0]?.textContent||p.map_instance} • Sheet ${p.sheet}`;$('plotSurvey').textContent=p.survey||'—';$('plotMapInstance').textContent=p.map_instance||'—';$('plotSheet').textContent=p.sheet;$('pniu').textContent=p.pniu||'—';$('plotId').textContent=p.plot_id||'—';$('nativeXY').textContent=(p.seed_x!=null&&p.seed_y!=null)?`${Number(p.seed_x).toFixed(3)}, ${Number(p.seed_y).toFixed(3)}`:'—';$('centerLatLng').textContent=`${Number(p.center_lat).toFixed(8)}, ${Number(p.center_lng).toFixed(8)}`;$('googleMapLink').href=p.google_map_url||mapUrl(Number(p.center_lat),Number(p.center_lng));$('googleMapLink').classList.remove('hidden');
  const existing=savedPlots.find(x=>String(x.plot_no)===String(p.plot_no)&&String(x.gis_code||'')===String(p.gis_code||''));
  const src=existing||p;$('exactRaiyatName').value=src.exact_raiyat_name||'';$('landType').value=src.land_type||'';$('khesraNo').value=src.khesra_no||p.plot_no;$('mauzaField').value=p.mauza||'';$('thanaNo').value=src.thana_no||'';$('jamabandiNo').value=src.jamabandi_no||'';$('partNo').value=src.part_no||'';$('pageNo').value=src.page_no||'';$('computerizedJamabandiNo').value=src.computerized_jamabandi_no||'';$('khataNo').value=src.khata_no||'';$('plotAreaDecimal').value=src.plot_area_decimal??'';$('jamabandiTotalAreaDecimal').value=src.jamabandi_total_area_decimal??'';$('localName').value=src.local_name||'';$('notes').value=src.notes||'';$('locationSelect').value=src.location_id?String(src.location_id):'';
  if(src.family_id)$('familySelect').value=String(src.family_id);populateOwnerControls();setOwnershipType(src.ownership_type||'Individual');if(src.primary_family_member_id)$('primaryOwnerSelect').value=String(src.primary_family_member_id);selectedCoOwnerIds=new Set((src.coowner_ids||[]).map(Number));renderCoOwnerList();renderCoOwnerChips();updateBigha();$('deletePlot').classList.toggle('hidden',!existing);
  const freshGeometry=validGeometry(p)?p.geometry:null,fallbackGeometry=existing&&validGeometry(existing)?existing.geometry:null,geometry=freshGeometry||fallbackGeometry;if(geometry){p.geometry=geometry;p.source=freshGeometry?p.source:(existing?.source||p.source||'');drawSelectedGeometry(geometry);}else{p.geometry=null;drawSelectedGeometry(null);}if(!freshGeometry&&fallbackGeometry)applyMeasurements(p,existing);else if(!freshGeometry&&!fallbackGeometry){['calculated_area_sqm','calculated_area_decimal','perimeter_m','approx_length_m','approx_width_m','bbox_width_m','bbox_height_m','bbox_area_sqm'].forEach(k=>{p[k]=null;});p.measurements=null;p.geometry_status='INVALID';}updateTechnicalMeasurements(p);$('savePlot').textContent=existing?'Update Plot':'Save Plot';if($('plotPanelMode'))$('plotPanelMode').textContent=existing?'Existing family plot • update':'New family plot';setTimeout(()=>{google.maps.event.trigger(addMap,'resize');},40);
}
function updateBigha(){const d=Number($('plotAreaDecimal').value);$('plotAreaBigha').value=Number.isFinite(d)&&d>0?(d/DECIMAL_PER_BIGHA).toFixed(4):'';}
function selectedOwnerPayload(){
  const type=$('ownershipType').value,familyId=Number($('familySelect').value||0)||null;
  if(type==='Individual'){const id=Number($('primaryOwnerSelect').value||0)||null;if(!id)throw new Error('Select one Owner for Individual ownership.');const m=addReferenceData.members.find(x=>Number(x.id)===id);return{ownership_type:type,family_id:familyId,primary_family_member_id:id,coowner_ids:[],owner:m?.display_name||m?.member_name||''};}
  const ids=[...selectedCoOwnerIds];if(ids.length<2)throw new Error('Joint ownership requires at least two Owners.');const names=ids.map(id=>addReferenceData.members.find(m=>Number(m.id)===id)).filter(Boolean).map(m=>m.display_name||m.member_name);return{ownership_type:type,family_id:familyId,primary_family_member_id:null,coowner_ids:ids,owner:names.join('; ')};
}
function buildPlotSaveBody(){
  const ownership=selectedOwnerPayload();return{...selectedPlot,...ownership,exact_raiyat_name:$('exactRaiyatName').value.trim(),land_type:$('landType').value,khesra_no:$('khesraNo').value.trim()||selectedPlot.plot_no,thana_no:$('thanaNo').value.trim(),jamabandi_no:$('jamabandiNo').value.trim(),part_no:$('partNo').value.trim(),page_no:$('pageNo').value.trim(),computerized_jamabandi_no:$('computerizedJamabandiNo').value.trim(),khata_no:$('khataNo').value.trim(),plot_area_decimal:$('plotAreaDecimal').value===''?null:Number($('plotAreaDecimal').value),jamabandi_total_area_decimal:$('jamabandiTotalAreaDecimal').value===''?null:Number($('jamabandiTotalAreaDecimal').value),location_id:Number($('locationSelect').value||0)||null,local_name:$('localName').value.trim(),notes:$('notes').value.trim()};
}
async function initAddWorkflow(){
  if(addWorkflowInitialized||addWorkflowInitializing)return;
  addWorkflowInitializing=true;
  resetSelect('surveySelect','Loading surveys…',true);resetSelect('mapInstanceSelect','Loading maps…',true);resetSelect('sheetSelect','Loading sheets…',true);
  try{
    await loadReferenceData();
    await loadMauzas(currentMauza||'0230');
    addWorkflowInitialized=true;
  }catch(err){
    setLifecycleHint(`Could not load map: ${err.message}`);$('addStatus').textContent=err.message;setMapLoading(false);
  }finally{addWorkflowInitializing=false;}
}

$('reconstruct').onclick=async()=>{if(!selectedPlot)return;try{$('addStatus').textContent=`Reconstructing ${selectedPlot.survey} Plot ${selectedPlot.plot_no}…`;await reconstructPlotShape(selectedPlot);drawSelectedGeometry(selectedPlot.geometry);updateTechnicalMeasurements(selectedPlot);$('selectionMeasure').textContent=measurementSummary(selectedPlot)||'Parcel shape reconstructed.';$('addStatus').textContent=`Plot ${selectedPlot.plot_no} polygon reconstructed.`;}catch(err){alert(err.message);}};
$('savePlot').onclick=async()=>{if(!selectedPlot)return;try{const body=buildPlotSaveBody(),r=await fetch('/api/plots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Save failed');selectedPlot={...d,geometry:d.geometry||selectedPlot.geometry};$('plotDetailsPanel').classList.add('hidden');$('savedPlotNo').textContent=body.plot_no;$('saveSuccessCard').classList.remove('hidden');$('addStatus').textContent=`${body.survey} Plot ${body.plot_no} saved / updated.`;await loadSavedPlots();}catch(err){alert(err.message);}};
$('deletePlot').onclick=async()=>{if(!selectedPlot)return;const existing=savedPlots.find(x=>String(x.plot_no)===String(selectedPlot.plot_no)&&String(x.gis_code||'')===String(selectedPlot.gis_code||''));if(!existing)return;if(!confirm(`Delete ${selectedPlot.survey} Plot ${selectedPlot.plot_no} from our database?`))return;const url=`/api/plots/${encodeURIComponent(selectedPlot.survey)}/${encodeURIComponent(selectedPlot.sheet)}/${encodeURIComponent(selectedPlot.plot_no)}`,r=await fetch(url,{method:'DELETE'}),d=await r.json();if(!r.ok)return alert(d.error||'Delete failed');clearAddSelection();await loadSavedPlots();$('addStatus').textContent=`Plot ${existing.plot_no} deleted.`;};

$('mauzaSelect').onchange=async e=>{currentMauza=e.target.value;localStorage.setItem('harpurMauza',currentMauza);currentSurvey='';currentMapInstance='';currentSheet='';try{await loadSurveys();}catch(err){alert(err.message);}};
$('surveySelect').onchange=async e=>{currentSurvey=e.target.value;currentMapInstance='';currentSheet='';try{await loadMapInstances();}catch(err){alert(err.message);}};
$('mapInstanceSelect').onchange=async e=>{currentMapInstance=e.target.value;currentSheet='';try{await loadSheets();}catch(err){alert(err.message);}};
$('sheetSelect').onchange=async e=>{currentSheet=e.target.value;if(!currentSheet){clearMapContextAndSelection(true);return;}try{await loadSelectedMapContext();}catch(err){alert(err.message);setLifecycleHint(err.message);setMapLoading(false);}};
$('showNaksha').onchange=()=>scheduleAddOverlayRefresh(true);$('opacity').oninput=e=>{$('opacityValue').textContent=`${e.target.value}%`;overlayView?.setOpacity(Number(e.target.value)/100);};$('fitSheet').onclick=fitAddSheet;$('reloadSheet').onclick=()=>scheduleAddOverlayRefresh(true);
$('addThisPlot').onclick=openDetailsForSelected;$('clearPlotSelection').onclick=()=>{clearAddSelection();$('addStatus').textContent='Tap a parcel to select.';};$('closePlotSelection').onclick=()=>{clearAddSelection();$('addStatus').textContent=`${currentSurvey} Sheet ${currentSheet} ready • tap a parcel to select.`;};$('closePlotDetails').onclick=()=>{$('plotDetailsPanel').classList.add('hidden');showPlotSelectionCard();};$('cancelPlotDetails').onclick=()=>{$('plotDetailsPanel').classList.add('hidden');showPlotSelectionCard();};
$('ownershipIndividual').onclick=()=>setOwnershipType('Individual');$('ownershipJoint').onclick=()=>setOwnershipType('Joint');$('familySelect').onchange=()=>{selectedCoOwnerIds.clear();populateOwnerControls();};$('plotAreaDecimal').oninput=updateBigha;
$('openCoOwnerPicker').onclick=()=>{$('coOwnerPicker').classList.remove('hidden');renderCoOwnerList();};$('closeCoOwnerPicker').onclick=()=>{$('coOwnerPicker').classList.add('hidden');};$('coOwnerDone').onclick=()=>{$('coOwnerPicker').classList.add('hidden');};$('coOwnerSearch').oninput=renderCoOwnerList;
$('mobileMapSettingsBtn').onclick=()=>{$('mobileMapSettings').classList.remove('hidden');syncMobileMapControls();};$('closeMobileMapSettings').onclick=()=>$('mobileMapSettings').classList.add('hidden');$('mobileSettingsDone').onclick=()=>$('mobileMapSettings').classList.add('hidden');$('mobileFitSheet').onclick=fitAddSheet;$('mobileRefreshSheet').onclick=()=>scheduleAddOverlayRefresh(true);
[['mobileMauzaMirror','mauzaSelect'],['mobileSurveyMirror','surveySelect'],['mobileMapMirror','mapInstanceSelect'],['mobileSheetMirror','sheetSelect']].forEach(([mirror,source])=>{$(mirror).onchange=()=>{const src=$(source);src.value=$(mirror).value;src.dispatchEvent(new Event('change'));};});
$('addAnotherPlot').onclick=()=>{clearAddSelection();$('addStatus').textContent=`${currentSurvey} Sheet ${currentSheet} ready • tap another parcel.`;};$('viewSavedPlot').onclick=()=>{const p=selectedPlot;setView('saved');if(p){const saved=savedPlots.find(x=>String(x.gis_code)===String(p.gis_code)&&String(x.plot_no)===String(p.plot_no));if(saved)focusSavedPlot(saved,true);}};


/* Add Plot accordion UX: Plot Identity is always visible.
   Desktop allows two other sections open; mobile allows one. */
function setupPlotDetailsAccordions(){
  const details=[...document.querySelectorAll('#plotForm details')];
  let openOrder=details.filter(d=>d.open);
  const limit=()=>window.matchMedia('(max-width:900px)').matches?1:2;
  const enforce=(opened)=>{
    if(!opened.open)return;
    openOrder=openOrder.filter(d=>d!==opened && d.open);
    openOrder.push(opened);
    while(openOrder.length>limit()){
      const oldest=openOrder.shift();
      if(oldest && oldest!==opened)oldest.open=false;
    }
  };
  details.forEach(d=>d.addEventListener('toggle',()=>enforce(d)));
  window.addEventListener('resize',()=>{
    openOrder=openOrder.filter(d=>d.open);
    while(openOrder.length>limit()){
      const oldest=openOrder.shift();
      if(oldest)oldest.open=false;
    }
  });
}
setupPlotDetailsAccordions();

/* ----------------------------- UTIL ----------------------------- */
function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

bootstrap();
