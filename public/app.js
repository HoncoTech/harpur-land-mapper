
proj4.defs('EPSG:32645','+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs +type=crs');

let map, config;
let currentSheet = '01';
let selectionMarker = null;
let overlayView = null;
let selectedPlot = null, selectedPolygon = null;
let saved = [], savedPolygons = [];
let refreshTimer = null;
let lastOverlaySignature = '';

const $ = id => document.getElementById(id);

function createBhuNakshaOverlayClass(){
  if(!window.google?.maps?.OverlayView) {
    throw new Error('Google Maps API is not loaded yet.');
  }

  return class BhuNakshaImageOverlay extends google.maps.OverlayView {
    constructor(url,bounds,opacity=0.9){
      super();
      this.url = url;
      this.bounds = bounds;
      this.opacity = opacity;
      this.div = null;
      this.img = null;
    }

    onAdd(){
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';

      this.img = document.createElement('img');
      this.img.src = this.url;
      this.img.className = 'bhu-sheet';
      this.img.style.position = 'absolute';
      this.img.style.left = '0';
      this.img.style.top = '0';
      this.img.style.width = '100%';
      this.img.style.height = '100%';
      this.img.style.opacity = String(this.opacity);

      this.img.onload = () => {
        $('status').textContent = 'Cadastral PNG refreshed for current zoom/viewport. Zoom or pan again to fetch a sharper image.';
      };
      this.img.onerror = () => {
        $('status').textContent = 'BhuNaksha PNG failed to load.';
      };

      this.div.appendChild(this.img);
      this.getPanes().overlayLayer.appendChild(this.div);
    }

    draw(){
      if(!this.div) return;
      const projection = this.getProjection();
      if(!projection) return;

      const sw = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.south,this.bounds.west));
      const ne = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.bounds.north,this.bounds.east));
      if(!sw || !ne) return;

      this.div.style.left = sw.x + 'px';
      this.div.style.top = ne.y + 'px';
      this.div.style.width = (ne.x - sw.x) + 'px';
      this.div.style.height = (sw.y - ne.y) + 'px';
    }

    onRemove(){
      if(this.div?.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
      this.img = null;
    }

    setOpacity(v){
      this.opacity = v;
      if(this.img) this.img.style.opacity = String(v);
    }

    update(url,bounds){
      this.url = url;
      this.bounds = bounds;
      if(this.img) this.img.src = url;
      this.draw();
    }
  };
}

let BhuNakshaImageOverlay = null;

async function loadConfig(){
  const r = await fetch(`/api/config?sheet=${encodeURIComponent(currentSheet)}`);
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Could not load config');
  config = d;
  if (d.googleMapsApiKey && !$('apiKey').value.trim()) {
    $('apiKey').value = d.googleMapsApiKey;
  }
  return d;
}

function updateRawImageLink(){
  const a=$('rawImageLink'); if(a) a.href=`/api/bhunaksha-sheet.png?sheet=${encodeURIComponent(currentSheet)}`;
}
async function switchSheet(sheet){
  currentSheet=String(sheet||'01').padStart(2,'0'); localStorage.setItem('harpurSheet',currentSheet);
  clearSelectionPin(); clearSelectedPolygon(); selectedPlot=null; $('plotForm').classList.add('hidden'); lastOverlaySignature='';
  if(overlayView){overlayView.setMap(null);overlayView=null;}
  $('status').textContent=`Loading CS Sheet ${currentSheet}...`;
  await loadConfig(); updateRawImageLink();
  if(map){fitSheet();scheduleViewportRefresh(true);redrawSaved();}
  $('status').textContent=`CS Sheet ${currentSheet} loaded. Zoom and click a parcel.`;
}

function fitSheet(){
  if(!map || !config) return;
  const b = config.googleBounds;
  map.fitBounds(new google.maps.LatLngBounds(
    {lat:b.south,lng:b.west},
    {lat:b.north,lng:b.east}
  ), 30);
}

function nativeBBoxToLatLngBounds(b) {
  const sw = proj4('EPSG:32645','EPSG:4326',[b.xmin,b.ymin]);
  const ne = proj4('EPSG:32645','EPSG:4326',[b.xmax,b.ymax]);
  const nw = proj4('EPSG:32645','EPSG:4326',[b.xmin,b.ymax]);
  const se = proj4('EPSG:32645','EPSG:4326',[b.xmax,b.ymin]);
  const lats = [sw[1],ne[1],nw[1],se[1]];
  const lngs = [sw[0],ne[0],nw[0],se[0]];
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs)
  };
}

function intersectionBBox(a,b){
  const xmin = Math.max(a.xmin,b.xmin);
  const ymin = Math.max(a.ymin,b.ymin);
  const xmax = Math.min(a.xmax,b.xmax);
  const ymax = Math.min(a.ymax,b.ymax);
  if(xmax <= xmin || ymax <= ymin) return null;
  return {xmin,ymin,xmax,ymax};
}

function currentViewportNativeBBox(){
  if(!map || !config) return null;
  const bounds = map.getBounds();
  if(!bounds) return null;

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const nw = new google.maps.LatLng(ne.lat(), sw.lng());
  const se = new google.maps.LatLng(sw.lat(), ne.lng());

  const pts = [ne,nw,se,sw].map(p => proj4('EPSG:4326','EPSG:32645',[p.lng(), p.lat()]));
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);

  const view = {
    xmin: Math.min(...xs),
    ymin: Math.min(...ys),
    xmax: Math.max(...xs),
    ymax: Math.max(...ys)
  };

  return intersectionBBox(view, config.imageBBox);
}

function currentViewportImageSize(){
  const rect = $('map').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    width: Math.max(512, Math.round(rect.width * dpr)),
    height: Math.max(512, Math.round(rect.height * dpr))
  };
}

function overlaySignature(bbox, size){
  return [
    map?.getZoom() || '',
    bbox.xmin.toFixed(2), bbox.ymin.toFixed(2),
    bbox.xmax.toFixed(2), bbox.ymax.toFixed(2),
    size.width, size.height
  ].join('|');
}

function refreshViewportOverlay({force=false} = {}){
  if(!map || !config) return;
  if(!$('showNaksha').checked) {
    if(overlayView){ overlayView.setMap(null); overlayView = null; }
    return;
  }

  const bbox = currentViewportNativeBBox();
  if(!bbox) {
    $('status').textContent = 'Current Google view does not intersect the Harpur sheet.';
    if(overlayView){ overlayView.setMap(null); overlayView = null; }
    return;
  }

  const size = currentViewportImageSize();
  const signature = overlaySignature(bbox, size);
  if(!force && signature === lastOverlaySignature) return;
  lastOverlaySignature = signature;

  const q = new URLSearchParams({
    xmin: bbox.xmin,
    ymin: bbox.ymin,
    xmax: bbox.xmax,
    ymax: bbox.ymax,
    width: size.width,
    height: size.height,
    sheet: currentSheet,
    t: Date.now()
  });

  const url = `/api/viewport-overlay.png?${q.toString()}`;
  const bounds = nativeBBoxToLatLngBounds(bbox);

  if(!BhuNakshaImageOverlay) {
    BhuNakshaImageOverlay = createBhuNakshaOverlayClass();
  }

  if(!overlayView) {
    overlayView = new BhuNakshaImageOverlay(url, bounds, Number($('opacity').value) / 100);
    overlayView.setMap(map);
  } else {
    overlayView.update(url, bounds);
    overlayView.setOpacity(Number($('opacity').value) / 100);
  }

  $('status').textContent = `Refreshing cadastral PNG for zoom ${map.getZoom()}...`;
}

function scheduleViewportRefresh(force=false){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshViewportOverlay({force}), 200);
}


function plotCenterFromBBox(p){
  const x = (Number(p.xmin) + Number(p.xmax)) / 2;
  const y = (Number(p.ymin) + Number(p.ymax)) / 2;
  const [lng,lat] = proj4('EPSG:32645','EPSG:4326',[x,y]);
  return {lat,lng};
}

function googleMapUrl(lat,lng){
  return `https://www.google.com/maps?q=${lat.toFixed(8)},${lng.toFixed(8)}`;
}


function placeSelectionPin(latLng, label=''){
  if(!map) return;

  if(selectionMarker){
    selectionMarker.setMap(null);
    selectionMarker = null;
  }

  selectionMarker = new google.maps.Marker({
    position: latLng,
    map,
    title: label ? `Selected plot ${label}` : 'Selected location',
    label: label ? {
      text: String(label),
      fontWeight: '700'
    } : undefined,
    animation: google.maps.Animation.DROP,
    zIndex: 999
  });
}

function clearSelectionPin(){
  if(selectionMarker){
    selectionMarker.setMap(null);
    selectionMarker = null;
  }
}

async function lookupPlot(latLng){
  placeSelectionPin(latLng);
  const [x,y] = proj4('EPSG:4326','EPSG:32645',[latLng.lng(),latLng.lat()]);
  $('status').textContent = 'Identifying BhuNaksha plot...';
  const q = new URLSearchParams({x:String(x),y:String(y),sheet:currentSheet});
  const r = await fetch(`/api/plot-at-xy?${q.toString()}`);
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || 'Plot lookup failed');
  const s = data.scalar;
  if(!s || s.has_data !== 'Y') throw new Error('No BhuNaksha plot found at this click.');

  selectedPlot = {
    survey:'CS',sheet:currentSheet,state:'10',
    gis_code:config.gisCode,levels:config.levels,
    plot_no:String(s.plotNo || data.hit?.kide || ''),
    plot_id:String(s.ID || data.hit?.id || ''),
    pniu:String(s.PNIU || ''),
    seed_x:x,seed_y:y,
    xmin:s.xmin,ymin:s.ymin,xmax:s.xmax,ymax:s.ymax,
    geometry:null,source:''
  };

  const center = plotCenterFromBBox(selectedPlot);
  selectedPlot.center_lat = center.lat;
  selectedPlot.center_lng = center.lng;
  selectedPlot.google_map_url = googleMapUrl(center.lat, center.lng);

  placeSelectionPin(latLng, selectedPlot.plot_no);
  clearSelectedPolygon();
  showSelected();
}

function showSelected(){
  const p = selectedPlot;
  if(!p) return;
  $('plotForm').classList.remove('hidden');
  $('plotNo').textContent = p.plot_no;
  $('pniu').textContent = p.pniu || '—';
  $('plotId').textContent = p.plot_id || '—';
  $('nativeXY').textContent = `${p.seed_x.toFixed(3)}, ${p.seed_y.toFixed(3)}`;

  let centerLat = p.center_lat, centerLng = p.center_lng;
  if (!Number.isFinite(Number(centerLat)) || !Number.isFinite(Number(centerLng))) {
    const center = plotCenterFromBBox(p);
    centerLat = center.lat;
    centerLng = center.lng;
    p.center_lat = centerLat;
    p.center_lng = centerLng;
    p.google_map_url = googleMapUrl(centerLat, centerLng);
  }
  $('centerLatLng').textContent = `${Number(centerLat).toFixed(8)}, ${Number(centerLng).toFixed(8)}`;
  const gLink = $('googleMapLink');
  gLink.href = p.google_map_url || googleMapUrl(Number(centerLat), Number(centerLng));
  gLink.classList.remove('hidden');

  const m = saved.find(x => String(x.plot_no) === String(p.plot_no) && x.survey === 'CS' && x.sheet === p.sheet);
  $('deletePlot').disabled = !m;
  $('owner').value = m?.owner || '';
  $('localName').value = m?.local_name || '';
  $('notes').value = m?.notes || '';
  if(m?.geometry && !p.geometry){
    p.geometry = m.geometry;
    p.source = m.source || '';
    selectedPolygon = drawGeometry(p.geometry,true);
  }
  $('status').textContent = `Selected CS plot ${p.plot_no}${p.geometry ? ' • polygon ready' : ''}`;
}

function drawGeometry(geometry,selected=false){
  if(!geometry?.coordinates?.[0]) return null;
  return new google.maps.Polygon({
    paths:geometry.coordinates[0].map(([lng,lat])=>({lat,lng})),
    map,
    strokeWeight:selected?4:2,
    fillOpacity:selected?.28:.10,
    clickable:false
  });
}
function clearSelectedPolygon(){ if(selectedPolygon) selectedPolygon.setMap(null); selectedPolygon = null; }

async function reconstruct(){
  if(!selectedPlot) return;
  $('status').textContent = `Reconstructing plot ${selectedPlot.plot_no}...`;
  const body = {...selectedPlot,owner:$('owner').value.trim(),local_name:$('localName').value.trim()};
  const r = await fetch('/api/reconstruct',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const f = await r.json();
  if(!r.ok) throw new Error(f.error || 'Reconstruction failed');
  selectedPlot.geometry = f.geometry;
  selectedPlot.source = f.properties.source;
  clearSelectedPolygon();
  selectedPolygon = drawGeometry(f.geometry,true);
  $('status').textContent = `Plot ${selectedPlot.plot_no} polygon reconstructed (${f.geometry.coordinates[0].length} points).`;
}

async function savePlot(){
  if(!selectedPlot) return;
  const body = {...selectedPlot,owner:$('owner').value.trim(),local_name:$('localName').value.trim(),notes:$('notes').value.trim()};
  const r = await fetch('/api/plots',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Save failed');
  await loadSaved();
  $('deletePlot').disabled = false;
  $('status').textContent = `Plot ${body.plot_no} saved/updated${body.geometry ? ' with polygon' : ''}.`;
}


async function deletePlot(){
  if(!selectedPlot) return;

  const match = saved.find(x =>
    String(x.plot_no) === String(selectedPlot.plot_no) &&
    x.survey === selectedPlot.survey &&
    x.sheet === selectedPlot.sheet
  );

  if(!match){
    alert(`Plot ${selectedPlot.plot_no} is not saved in our database yet.`);
    return;
  }

  const ok = confirm(
    `Delete Plot ${selectedPlot.plot_no} from our database?\n\n` +
    `This will remove its saved owner, local name, notes, Google link and reconstructed polygon.\n` +
    `It does NOT change anything in BhuNaksha.`
  );
  if(!ok) return;

  const url = `/api/plots/${encodeURIComponent(selectedPlot.survey)}/${encodeURIComponent(selectedPlot.sheet)}/${encodeURIComponent(selectedPlot.plot_no)}`;
  const r = await fetch(url, { method:'DELETE' });
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Delete failed');

  if(selectedPolygon){
    selectedPolygon.setMap(null);
    selectedPolygon = null;
  }

  selectedPlot.geometry = null;
  selectedPlot.source = '';

  await loadSaved();

  $('owner').value = '';
  $('localName').value = '';
  $('notes').value = '';
  $('deletePlot').disabled = true;

  clearSelectionPin();
  const deletedPlotNo = selectedPlot.plot_no;
  selectedPlot = null;
  $('plotForm').classList.add('hidden');

  $('status').textContent = `Plot ${deletedPlotNo} deleted from our database. Selection cleared.`;
}

async function loadSaved(){
  const r = await fetch('/api/plots');
  saved = await r.json();
  renderSaved();
  redrawSaved();
}
function redrawSaved(){
  savedPolygons.forEach(p=>p.setMap(null));
  savedPolygons = [];
  if(!map) return;
  for(const p of saved){
    if(p.geometry){
      const poly = drawGeometry(p.geometry,false);
      if(poly) savedPolygons.push(poly);
    }
  }
}
function renderSaved(){
  const f = $('filter').value.toLowerCase(), box = $('savedPlots');
  box.innerHTML = '';
  saved.filter(p => `${p.plot_no} ${p.owner} ${p.local_name}`.toLowerCase().includes(f))
    .forEach(p => {
      const el = document.createElement('div');
      el.className = 'saved';
      el.innerHTML = `<div class="saved-title">Plot ${p.plot_no}</div>
      <div class="saved-sub">${p.owner || 'No owner'}${p.local_name ? ' • ' + p.local_name : ''}${p.geometry ? ' • polygon saved' : ''}${p.google_map_url ? ' • Google link' : ''}</div>`;
      el.onclick = () => selectSaved(p).catch(err=>alert(err.message));
      box.appendChild(el);
    });
}
async function selectSaved(p){
  if(p.sheet && p.sheet!==currentSheet){$('sheetSelect').value=p.sheet;await switchSheet(p.sheet);}
  selectedPlot = {
    survey:p.survey,sheet:p.sheet,state:'10',gis_code:p.gis_code,levels:p.levels,
    plot_no:p.plot_no,plot_id:p.plot_id,pniu:p.pniu,seed_x:p.seed_x,seed_y:p.seed_y,
    xmin:p.xmin,ymin:p.ymin,xmax:p.xmax,ymax:p.ymax,
    center_lat:p.center_lat,center_lng:p.center_lng,google_map_url:p.google_map_url,
    geometry:p.geometry,source:p.source
  };
  const sw = proj4('EPSG:32645','EPSG:4326',[p.xmin,p.ymin]);
  const ne = proj4('EPSG:32645','EPSG:4326',[p.xmax,p.ymax]);
  map.fitBounds(new google.maps.LatLngBounds({lat:sw[1],lng:sw[0]},{lat:ne[1],lng:ne[0]}),80);

  const centerLat = Number(p.center_lat);
  const centerLng = Number(p.center_lng);
  if(Number.isFinite(centerLat) && Number.isFinite(centerLng)){
    placeSelectionPin({lat:centerLat,lng:centerLng}, p.plot_no);
  } else {
    const center = plotCenterFromBBox(p);
    placeSelectionPin(center, p.plot_no);
  }

  clearSelectedPolygon();
  if(p.geometry) selectedPolygon = drawGeometry(p.geometry,true);
  showSelected();
}

async function loadGoogleMaps(){
  $('status').textContent = 'Loading Google Maps...';
  if (!config) {
    try { await loadConfig(); } catch(err) { $('status').textContent = err.message; return; }
  }
  const key = $('apiKey').value.trim();
  if(!key) return alert('Paste Google Maps JavaScript API key first.');
  localStorage.setItem('harpurGoogleKey',key);
  if(window.google?.maps) return initMap();
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=initMap`;
  s.async = true;
  s.defer = true;
  s.onerror = () => { $('status').textContent = 'Google Maps JavaScript API failed to load. Check API key / billing / Maps JavaScript API enablement.'; };
  document.head.appendChild(s);
}

window.initMap = async function(){
  try{
    currentSheet=localStorage.getItem('harpurSheet')||'01'; $('sheetSelect').value=currentSheet;
    await loadConfig(); updateRawImageLink();
    map = new google.maps.Map($('map'),{
      center:{lat:25.3501,lng:83.9334},
      zoom:15,
      mapTypeId:'satellite',
      tilt:0,
      streetViewControl:false,
      fullscreenControl:true,
      mapTypeControl:true
    });

    map.addListener('click', async e => {
      try { await lookupPlot(e.latLng); }
      catch(err) { $('status').textContent = err.message; }
    });

    map.addListener('idle', () => scheduleViewportRefresh(false));

    fitSheet();
    scheduleViewportRefresh(true);
    redrawSaved();
  }catch(err){
    $('status').textContent = err.message;
  }
};

$('loadGoogle').onclick = loadGoogleMaps;
$('fitSheet').onclick = () => { fitSheet(); scheduleViewportRefresh(true); };
$('reloadSheet').onclick = () => scheduleViewportRefresh(true);
$('showNaksha').onchange = () => scheduleViewportRefresh(true);
$('sheetSelect').onchange = e => switchSheet(e.target.value).catch(err=>{ $('status').textContent=err.message; alert(err.message); });
$('opacity').oninput = e => {
  $('opacityValue').textContent = `${e.target.value}%`;
  overlayView?.setOpacity(Number(e.target.value) / 100);
};
$('reconstruct').onclick = () => reconstruct().catch(err=>alert(err.message));
$('savePlot').onclick = () => savePlot().catch(err=>alert(err.message));
$('deletePlot').onclick = () => deletePlot().catch(err=>alert(err.message));
$('filter').oninput = renderSaved;
$('apiKey').value = localStorage.getItem('harpurGoogleKey') || '';
currentSheet=localStorage.getItem('harpurSheet')||'01'; $('sheetSelect').value=currentSheet; updateRawImageLink();
loadSaved().catch(console.error);


async function loadAboutVersion(){
  try{
    const r = await fetch('/api/about');
    const d = await r.json();
    if(r.ok && d.version){
      const el = document.getElementById('appVersion');
      if(el) el.textContent = `Version ${d.release || d.version}`;
    }
  }catch(_){}
}
loadAboutVersion();
