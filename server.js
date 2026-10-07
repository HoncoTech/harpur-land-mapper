
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const proj4 = require('proj4');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const BHU = 'https://bhunaksha.bihar.gov.in';

proj4.defs('EPSG:32645', '+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs +type=crs');

// BhuNaksha hierarchy defaults for this deployment.
// The Add Plot engine resolves Survey -> Map Instance -> Sheet dynamically after Mauza selection.
const DEFAULT_LOCATION = {
  state: '10',
  district: '30',
  subdivision: '01',
  circle: '02',
  mauza: '0230',
  mauzaLabel: '0230 Harpur(199)'
};

function csvLevels(parts){
  return `${parts.map(v=>String(v)).join(',')},`;
}

function parseOptionsFromHtml(html, level){
  const text=String(html||'');
  const selectRe=new RegExp(`<select[^>]*id=["']level_${level}["'][^>]*>([\\s\\S]*?)<\\/select>`,'i');
  const m=text.match(selectRe);
  if(!m) return [];
  const options=[];
  const optionRe=/<option\b([^>]*)value=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/option>/gi;
  let om;
  while((om=optionRe.exec(m[1]))){
    const attrs=`${om[1]} ${om[3]}`;
    const label=om[4].replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
    options.push({
      value: om[2],
      label,
      selected: /\bselected\b/i.test(attrs)
    });
  }
  return options.filter(o=>o.value!=='' || o.label);
}

function nativeBBoxToLatLngBounds(b) {
  const sw = proj4('EPSG:32645', 'EPSG:4326', [b.xmin, b.ymin]);
  const ne = proj4('EPSG:32645', 'EPSG:4326', [b.xmax, b.ymax]);
  const nw = proj4('EPSG:32645', 'EPSG:4326', [b.xmin, b.ymax]);
  const se = proj4('EPSG:32645', 'EPSG:4326', [b.xmax, b.ymin]);

  const lats = [sw[1], ne[1], nw[1], se[1]];
  const lngs = [sw[0], ne[0], nw[0], se[0]];
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    corners: {
      sw: {lat: sw[1], lng: sw[0]},
      ne: {lat: ne[1], lng: ne[0]},
      nw: {lat: nw[1], lng: nw[0]},
      se: {lat: se[1], lng: se[0]}
    }
  };
}

function normalizeMapContext(q={}){
  const state=String(q.state||DEFAULT_LOCATION.state);
  const district=String(q.district||DEFAULT_LOCATION.district);
  const subdivision=String(q.subdivision||DEFAULT_LOCATION.subdivision);
  const circle=String(q.circle||DEFAULT_LOCATION.circle);
  const mauza=String(q.mauza||DEFAULT_LOCATION.mauza);
  const survey=String(q.survey||'').trim();
  const mapInstance=String(q.mapInstance||q.map_instance||'').trim();
  const sheet=String(q.sheet||'').trim();
  const gisCode=String(q.gisCode||q.gis_code||'').trim();
  const levels=String(q.levels||csvLevels([district,subdivision,circle,mauza,survey,mapInstance,sheet]));
  return {state,district,subdivision,circle,mauza,survey,mapInstance,sheet,gisCode,levels};
}


const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'harpur.sqlite');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS plots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey TEXT NOT NULL,
  sheet TEXT NOT NULL,
  gis_code TEXT NOT NULL,
  levels TEXT NOT NULL,
  plot_no TEXT NOT NULL,
  plot_id TEXT,
  pniu TEXT,
  seed_x REAL,
  seed_y REAL,
  xmin REAL,
  ymin REAL,
  xmax REAL,
  ymax REAL,
  owner TEXT DEFAULT '',
  local_name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  center_lat REAL,
  center_lng REAL,
  google_map_url TEXT DEFAULT '',
  geometry_geojson TEXT,
  source TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(survey, sheet, plot_no)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  display_name TEXT,
  relation TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  UNIQUE (family_id, member_name)
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_name TEXT NOT NULL,
  mauza TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (location_name, mauza)
);
CREATE TABLE IF NOT EXISTS plot_coowners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plot_id INTEGER NOT NULL,
  family_member_id INTEGER NOT NULL,
  ownership_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE,
  FOREIGN KEY (family_member_id) REFERENCES family_members(id),
  UNIQUE (plot_id, family_member_id)
);
`);


function ensureColumn(name, definition) {
  const cols = db.prepare(`PRAGMA table_info(plots)`).all().map(c => c.name);
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE plots ADD COLUMN ${name} ${definition}`);
  }
}
ensureColumn('center_lat', 'REAL');
ensureColumn('center_lng', 'REAL');
ensureColumn('google_map_url', "TEXT DEFAULT ''");
ensureColumn('map_instance', 'TEXT');
ensureColumn('mauza', 'TEXT');
ensureColumn('land_type', 'TEXT');
ensureColumn('exact_raiyat_name', 'TEXT');
ensureColumn('ownership_type', 'TEXT');
ensureColumn('family_id', 'INTEGER');
ensureColumn('primary_family_member_id', 'INTEGER');
ensureColumn('location_id', 'INTEGER');
ensureColumn('thana_no', 'TEXT');
ensureColumn('jamabandi_no', 'TEXT');
ensureColumn('part_no', 'TEXT');
ensureColumn('page_no', 'TEXT');
ensureColumn('computerized_jamabandi_no', 'TEXT');
ensureColumn('khata_no', 'TEXT');
ensureColumn('khesra_no', 'TEXT');
ensureColumn('plot_area_decimal', 'REAL');
ensureColumn('jamabandi_total_area_decimal', 'REAL');
ensureColumn('geometry_type', 'TEXT');
ensureColumn('geometry_source', 'TEXT');
ensureColumn('geometry_updated_at', 'TEXT');
ensureColumn('geometry_status', 'TEXT');
ensureColumn('geometry_version', 'INTEGER');
ensureColumn('calculated_area_sqm', 'REAL');
ensureColumn('calculated_area_decimal', 'REAL');
ensureColumn('perimeter_m', 'REAL');
ensureColumn('approx_length_m', 'REAL');
ensureColumn('approx_width_m', 'REAL');
ensureColumn('bbox_width_m', 'REAL');
ensureColumn('bbox_height_m', 'REAL');
ensureColumn('bbox_area_sqm', 'REAL');
ensureColumn('measurement_source', 'TEXT');
ensureColumn('measurement_updated_at', 'TEXT');

// Seed the first family master used by the ownership picker. Existing data is preserved.
function seedFamilyReferenceData(){
  const familyName='Anand Narayan Rai Family';
  let family=db.prepare('SELECT id FROM families WHERE family_name=?').get(familyName);
  if(!family){
    const r=db.prepare('INSERT INTO families(family_name,description,is_active) VALUES(?,?,1)')
      .run(familyName,'Harpur family ownership master');
    family={id:Number(r.lastInsertRowid)};
  }
  const members=[
    ['Anand Narayan Rai','Anand Narayan Rai','Self / Family Head'],
    ['Lal Muni Roy','Lal Muni Roy','Wife'],
    ['Vikash Kumar Rai','Vikash Kumar Rai','Son'],
    ['Vineet Kumar Rai','Vineet Kumar Rai','Son'],
    ['Varun Roy','Varun Roy','Son'],
    ['Ekansh Roy','Ekansh Roy','Grandson']
  ];
  const stmt=db.prepare(`INSERT OR IGNORE INTO family_members(family_id,member_name,display_name,relation,is_active) VALUES(?,?,?,?,1)`);
  for(const m of members) stmt.run(family.id,...m);
  const addLocation=db.prepare('INSERT OR IGNORE INTO locations(location_name,mauza,is_active) VALUES(?,?,1)');
  for(const name of ['Tari','Pariya','Patelwa']) addLocation.run(name,'Harpur(199)');
}
seedFamilyReferenceData();

app.use(express.json({limit:'3mb'}));
app.use(express.static(path.join(__dirname, 'public')));

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function buildVillageMapUrl(cfg, {xmin, ymin, xmax, ymax, width, height}) {
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    LAYERS: 'VILLAGE_MAP',
    transparent: 'true',
    state: cfg.state,
    gis_code: cfg.gisCode,
    overlay_codes: '',
    CRS: cfg.wmsRequestCRS || 'EPSG:3857',
    STYLES: 'VILLAGE_MAP',
    WIDTH: String(width),
    HEIGHT: String(height),
    BBOX: `${xmin},${ymin},${xmax},${ymax}`
  });
  return `${BHU}/WMS?${p.toString()}`;
}

async function proxyPng(url, res, logLabel='BhuNaksha') {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);

      const upstream = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'image/png,image/*;q=0.9,*/*;q=0.8',
          'Referer': `${BHU}/`
        }
      });

      clearTimeout(timer);
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type') || '';

      if (upstream.ok && contentType.includes('image')) {
        res.set('Content-Type', contentType || 'image/png');
        res.set('Cache-Control', 'private, max-age=30');
        res.set('X-BhuNaksha-Attempt', String(attempt));
        return res.send(buf);
      }

      lastError = new Error(
        `${logLabel} upstream HTTP ${upstream.status}, content-type=${contentType}`
      );
      console.warn(
        `${logLabel} attempt ${attempt}/${maxAttempts} failed:`,
        upstream.status,
        contentType,
        buf.toString('utf8').slice(0,160)
      );

      // Retry transient upstream failures. For a definite client-side WMS
      // parameter error, retrying is unlikely to help.
      if (upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) {
        break;
      }
    } catch (err) {
      lastError = err;
      console.warn(`${logLabel} attempt ${attempt}/${maxAttempts} error:`, err.message);
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, attempt * 500));
    }
  }

  console.error(`${logLabel} failed after retries:`, lastError?.message);
  if (!res.headersSent) {
    res.status(502).send(`BhuNaksha PNG temporarily unavailable. ${lastError?.message || ''}`);
  }
}

app.get('/api/app-config', (req,res) => {
  res.json({
    name: 'Harpur Land Mapper',
    version: '7.2.0',
    release: '7.2 Parcel Shapes & Measurements',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
});

app.get('/api/about', (req,res) => {
  res.json({
    name: 'Harpur Land Mapper',
    version: '7.2.0',
    release: '7.2 Parcel Shapes & Measurements',
    survey: 'Dynamic CS / RS',
    village: 'Harpur(199) default; Mauza selectable',
    circle: 'Rajpur',
    district: 'Buxar',
    state: 'Bihar',
    features: [
      'Saved Plots master-detail landing page',
      'Dynamic Add Plot lifecycle: Mauza -> Survey -> Map Instance -> Sheet',
      'Cadastral Survey (CS) and Revisional Survey (RS)',
      'Google Hybrid map with dynamic BhuNaksha WMS refresh on pan/zoom',
      'Click-to-identify parcel using the active survey/sheet',
      'Selection pin with plot number',
      'Save / Update / Delete local plot records',
      'Google Maps center link per saved plot',
      'GeoJSON polygon reconstruction',
      'Mobile-friendly layout'
    ]
  });
});


async function fetchForm(url, params) {
  const body = new URLSearchParams(params);
  const resp = await fetch(url, {
    method:'POST',
    headers:{
      'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':'Mozilla/5.0',
      'Accept':'application/json, text/plain, */*',
      'Referer':`${BHU}/`
    },
    body
  });
  const text = await resp.text();
  if(!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0,300)}`);
  try{return JSON.parse(text)}catch{return text}
}

async function fetchGet(url, params) {
  const u = new URL(url);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  const resp = await fetch(u,{
    headers:{
      'User-Agent':'Mozilla/5.0',
      'Accept':'application/json, text/plain, */*',
      'Referer':`${BHU}/`
    }
  });
  const text=await resp.text();
  if(!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0,300)}`);
  try{return JSON.parse(text)}catch{return text}
}


async function fetchHierarchyOptions(level, selections, state='10'){
  const html=await fetchForm(`${BHU}/ScalarDatahandler`,{
    OP:'2',level:String(level),selections:String(selections),state:String(state)
  });
  return parseOptionsFromHtml(html, level);
}

app.get('/api/bhunaksha/mauzas', async (req,res)=>{
  try{
    const state=String(req.query.state||DEFAULT_LOCATION.state);
    const district=String(req.query.district||DEFAULT_LOCATION.district);
    const subdivision=String(req.query.subdivision||DEFAULT_LOCATION.subdivision);
    const circle=String(req.query.circle||DEFAULT_LOCATION.circle);
    const options=await fetchHierarchyOptions(4,`${district},${subdivision},${circle}`,state);
    res.json({options,defaultValue:DEFAULT_LOCATION.mauza});
  }catch(err){console.error('mauzas:',err);res.status(502).json({error:err.message});}
});

app.get('/api/bhunaksha/surveys', async (req,res)=>{
  try{
    const c=normalizeMapContext(req.query);
    const options=await fetchHierarchyOptions(5,`${c.district},${c.subdivision},${c.circle},${c.mauza}`,c.state);
    // Current app feature scope is CS + RS. Keep engine dynamic while hiding unsupported survey workflows.
    res.json({options:options.filter(o=>['CS','RS'].includes(o.value))});
  }catch(err){console.error('surveys:',err);res.status(502).json({error:err.message});}
});

app.get('/api/bhunaksha/map-instances', async (req,res)=>{
  try{
    const c=normalizeMapContext(req.query);
    if(!c.survey) return res.status(400).json({error:'survey required'});
    const selections=`${c.district},${c.subdivision},${c.circle},${c.mauza},${c.survey}`;
    const options=await fetchHierarchyOptions(6,selections,c.state);
    res.json({options});
  }catch(err){console.error('map-instances:',err);res.status(502).json({error:err.message});}
});

app.get('/api/bhunaksha/sheets', async (req,res)=>{
  try{
    const c=normalizeMapContext(req.query);
    if(!c.survey||!c.mapInstance) return res.status(400).json({error:'survey and mapInstance required'});
    const selections=`${c.district},${c.subdivision},${c.circle},${c.mauza},${c.survey},${c.mapInstance}`;
    const options=await fetchHierarchyOptions(7,selections,c.state);
    res.json({options});
  }catch(err){console.error('sheets:',err);res.status(502).json({error:err.message});}
});

async function pollDerivedLayers(state,gisCode,maxAttempts=5){
  let last=[];
  let lastError=null;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      const result=await fetchForm(`${BHU}/rest/Layers/getLayers`,{
        state,layerType:'TABLE_DERIVED_LAYERS',giscode:gisCode
      });
      last=Array.isArray(result)?result:[];
      lastError=null;
      if(last.length>0) return {layers:last,attempts:attempt,lastError:null};
    }catch(err){
      lastError=err;
      console.warn(`getLayers ${gisCode} attempt ${attempt}/${maxAttempts} failed:`,err.message);
    }
    if(attempt<maxAttempts){
      const delay=attempt===1?500:Math.min(1000,500+attempt*125);
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  return {layers:last,attempts:maxAttempts,lastError};
}

app.get('/api/bhunaksha/map-context', async (req,res)=>{
  try{
    const c=normalizeMapContext(req.query);
    if(!c.survey||!c.mapInstance||!c.sheet)
      return res.status(400).json({error:'survey, mapInstance and sheet are required'});

    const levels=csvLevels([c.district,c.subdivision,c.circle,c.mauza,c.survey,c.mapInstance,c.sheet]);
    const extent=await fetchForm(`${BHU}/rest/MapInfo/getVVVVExtentGeoref`,{
      state:c.state,gisLevels:levels,srs:'0'
    });
    if(!extent || !extent.gisCode) throw new Error('BhuNaksha did not return a GIS code for this sheet');

    const nativeExtent={
      epsg:extent.epsg||'EPSG:32645',
      xmin:Number(extent.xmin),ymin:Number(extent.ymin),
      xmax:Number(extent.xmax),ymax:Number(extent.ymax)
    };
    if(![nativeExtent.xmin,nativeExtent.ymin,nativeExtent.xmax,nativeExtent.ymax].every(Number.isFinite))
      throw new Error('Invalid sheet extent returned by BhuNaksha');

    const polled=await pollDerivedLayers(c.state,extent.gisCode,5);
    if(!polled.layers.length){
      return res.status(503).json({
        error:`BhuNaksha layers are not ready after 5 attempts. Please retry.${polled.lastError?` Last error: ${polled.lastError.message}`:''}`,
        retryable:true,gisCode:extent.gisCode,levels
      });
    }

    res.json({
      ...c,
      levels,
      gisCode:extent.gisCode,
      epsg:nativeExtent.epsg,
      nativeExtent,
      googleBounds:nativeBBoxToLatLngBounds(nativeExtent),
      attribution:extent.attribution||'',
      scaleFactor:extent.scaleFactor??1,
      layers:polled.layers.map(l=>({
        id:l.id,layerCode:l.layerCode,description:l.layerDescription,
        geometryType:l.geometryType,autoShowLayer:l.autoShowLayer
      })),
      layerPollAttempts:polled.attempts,
      wmsRequestCRS:'EPSG:3857'
    });
  }catch(err){console.error('map-context:',err);res.status(502).json({error:err.message});}
});

function contextFromQuery(q){
  const c=normalizeMapContext(q);
  if(!c.gisCode) throw new Error('gisCode required');
  return {...c,wmsRequestCRS:'EPSG:3857'};
}

app.get('/api/bhunaksha-sheet.png', async (req,res)=>{
  try{
    const cfg=contextFromQuery(req.query);
    const xmin=Number(req.query.xmin),ymin=Number(req.query.ymin),
      xmax=Number(req.query.xmax),ymax=Number(req.query.ymax);
    if(![xmin,ymin,xmax,ymax].every(Number.isFinite))
      return res.status(400).send('xmin,ymin,xmax,ymax are required');
    const width=clamp(Math.round(Number(req.query.width)||1502),256,4096);
    const height=clamp(Math.round(Number(req.query.height)||1028),256,4096);
    const url=buildVillageMapUrl(cfg,{xmin,ymin,xmax,ymax,width,height});
    await proxyPng(url,res,`Full sheet ${cfg.survey}/${cfg.sheet}`);
  }catch(err){console.error('Full sheet error:',err);res.status(502).send(err.message);}
});

app.get('/api/viewport-overlay.png', async (req,res)=>{
  try{
    const cfg=contextFromQuery(req.query);
    const xmin=Number(req.query.xmin),ymin=Number(req.query.ymin),
      xmax=Number(req.query.xmax),ymax=Number(req.query.ymax);
    let width=Number(req.query.width),height=Number(req.query.height);
    if(![xmin,ymin,xmax,ymax,width,height].every(Number.isFinite))
      return res.status(400).send('xmin,ymin,xmax,ymax,width,height are required numbers');
    width=clamp(Math.round(width),256,4096);
    height=clamp(Math.round(height),256,4096);
    const url=buildVillageMapUrl(cfg,{xmin,ymin,xmax,ymax,width,height});
    await proxyPng(url,res,`Viewport ${cfg.survey}/${cfg.sheet}`);
  }catch(err){console.error('Viewport overlay error:',err);res.status(502).send(err.message);}
});

app.get('/api/plot-at-xy', async (req,res)=>{
  try {
    const cfg=contextFromQuery(req.query);
    if(!cfg.levels) return res.status(400).json({error:'levels required'});
    const x=req.query.x,y=req.query.y;
    if(!x||!y) return res.status(400).json({error:'x and y required'});

    const hit=await fetchForm(`${BHU}/rest/MapInfo/getPlotAtXY`,{
      state:cfg.state,giscode:cfg.gisCode,x,y
    });

    const scalar=await fetchGet(`${BHU}/ScalarDatahandler`,{
      OP:'4',state:cfg.state,levels:cfg.levels,x,y
    });

    res.json({hit,scalar,config:cfg});
  } catch(err) {
    console.error('plot-at-xy:',err);
    res.status(502).json({error:err.message});
  }
});

function paddedBBox(p,pad=2){
  return {
    xmin:Number(p.xmin)-pad,ymin:Number(p.ymin)-pad,
    xmax:Number(p.xmax)+pad,ymax:Number(p.ymax)+pad
  };
}

function erodeMask(mask,w,h,iterations=1){
  let cur=mask;
  for(let iter=0;iter<iterations;iter++){
    const next=new Uint8Array(w*h);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;if(!cur[i])continue;
      let keep=1;
      for(let dy=-1;dy<=1&&keep;dy++)for(let dx=-1;dx<=1;dx++){
        if(!cur[(y+dy)*w+(x+dx)]){keep=0;break;}
      }
      if(keep)next[i]=1;
    }
    cur=next;
  }
  return cur;
}
function percentPaddedBBox(p,pct=0.03,minPad=0.5){
  const xmin=Number(p.xmin),ymin=Number(p.ymin),xmax=Number(p.xmax),ymax=Number(p.ymax);
  const bw=Math.max(0.01,xmax-xmin),bh=Math.max(0.01,ymax-ymin);
  const px=Math.max(minPad,bw*pct),py=Math.max(minPad,bh*pct);
  return {xmin:xmin-px,ymin:ymin-py,xmax:xmax+px,ymax:ymax+py};
}
function isBoundary(mask,w,h,x,y){
  if(!mask[y*w+x])return false;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,ny=y+dy;
    if(nx<0||ny<0||nx>=w||ny>=h||!mask[ny*w+nx])return true;
  }
  return false;
}
function largestConnectedComponent(mask,w,h){
  const n=w*h,seen=new Uint8Array(n);
  let best=[];
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let i=0;i<n;i++){
    if(!mask[i]||seen[i])continue;
    const q=[i],comp=[];seen[i]=1;
    for(let qi=0;qi<q.length;qi++){
      const idx=q[qi];comp.push(idx);
      const x=idx%w,y=(idx/w)|0;
      for(const [dx,dy] of dirs){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const ni=ny*w+nx;
        if(mask[ni]&&!seen[ni]){seen[ni]=1;q.push(ni);}
      }
    }
    if(comp.length>best.length)best=comp;
  }
  const out=new Uint8Array(n);
  for(const idx of best)out[idx]=1;
  return {mask:out,size:best.length};
}
function boundaryMask(component,w,h){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!component[i])continue;
    if(isBoundary(component,w,h,x,y))out[i]=1;
  }
  return out;
}
function traceBoundary(mask,w,h){
  const b=boundaryMask(mask,w,h);
  let sx=-1,sy=-1;
  outer: for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(b[y*w+x]){sx=x;sy=y;break outer;}
  if(sx<0)return[];
  const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  let x=sx,y=sy,prev=4;const pts=[];
  for(let step=0;step<w*h*2;step++){
    pts.push([x,y]);let found=false;
    const start=(prev+5)%8;
    for(let i=0;i<8;i++){
      const d=(start+i)%8,nx=x+dirs[d][0],ny=y+dirs[d][1];
      if(nx>=0&&ny>=0&&nx<w&&ny<h&&b[ny*w+nx]){x=nx;y=ny;prev=d;found=true;break;}
    }
    if(!found)break;
    if(x===sx&&y===sy&&pts.length>12)break;
  }
  return pts;
}
function pointLineDistance(p,a,b){
  const [x,y]=p,[x1,y1]=a,[x2,y2]=b,dx=x2-x1,dy=y2-y1;
  if(!dx&&!dy)return Math.hypot(x-x1,y-y1);
  const t=((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy),tt=Math.max(0,Math.min(1,t));
  const px=x1+tt*dx,py=y1+tt*dy;return Math.hypot(x-px,y-py);
}
function rdp(points,eps){
  if(points.length<3)return points;
  let maxD=0,idx=0;
  for(let i=1;i<points.length-1;i++){
    const d=pointLineDistance(points[i],points[0],points[points.length-1]);
    if(d>maxD){maxD=d;idx=i;}
  }
  if(maxD>eps){
    const l=rdp(points.slice(0,idx+1),eps),r=rdp(points.slice(idx),eps);
    return l.slice(0,-1).concat(r);
  }
  return [points[0],points[points.length-1]];
}
function pixelToNative(px,py,bbox,w,h){
  return [
    bbox.xmin+(px/w)*(bbox.xmax-bbox.xmin),
    bbox.ymax-(py/h)*(bbox.ymax-bbox.ymin)
  ];
}


function polygonMeasurementsNative(coords, bbox){
  const pts=coords.length>1 && coords[0][0]===coords[coords.length-1][0] && coords[0][1]===coords[coords.length-1][1]
    ? coords.slice(0,-1) : coords.slice();
  if(pts.length<3) return null;

  let twiceArea=0, perimeter=0;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    twiceArea += a[0]*b[1]-b[0]*a[1];
    perimeter += Math.hypot(b[0]-a[0],b[1]-a[1]);
  }
  const areaSqm=Math.abs(twiceArea)/2;

  // Farthest vertex pair is a stable, useful "longest dimension" for an irregular parcel.
  let maxLength=0;
  for(let i=0;i<pts.length;i++){
    for(let j=i+1;j<pts.length;j++){
      const d=Math.hypot(pts[j][0]-pts[i][0],pts[j][1]-pts[i][1]);
      if(d>maxLength) maxLength=d;
    }
  }
  const approxWidth=maxLength>0 ? areaSqm/maxLength : null;
  const bboxWidth=Math.max(0,Number(bbox.xmax)-Number(bbox.xmin));
  const bboxHeight=Math.max(0,Number(bbox.ymax)-Number(bbox.ymin));
  return {
    calculated_area_sqm:areaSqm,
    calculated_area_decimal:areaSqm/40.468603387248,
    calculated_area_bigha:(areaSqm/40.468603387248)/62,
    perimeter_m:perimeter,
    approx_length_m:maxLength,
    approx_width_m:approxWidth,
    bbox_width_m:bboxWidth,
    bbox_height_m:bboxHeight,
    bbox_area_sqm:bboxWidth*bboxHeight,
    measurement_source:'Derived from reconstructed BhuNaksha PLOT_LIST raster polygon'
  };
}

function validateReconstructedGeometry(nativeCoords,plotBBox,measurements){
  if(!Array.isArray(nativeCoords)||nativeCoords.length<4||!measurements)throw new Error('Invalid reconstructed geometry');
  const pts=nativeCoords.slice(0,-1);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  const gw=Math.max(...xs)-Math.min(...xs),gh=Math.max(...ys)-Math.min(...ys);
  const bw=Number(plotBBox.xmax)-Number(plotBBox.xmin),bh=Number(plotBBox.ymax)-Number(plotBBox.ymin);
  if(!(bw>0&&bh>0&&gw>0&&gh>0))throw new Error('Invalid parcel dimensions');
  const wr=gw/bw,hr=gh/bh;
  if(wr<0.35||wr>1.25||hr<0.35||hr>1.25)throw new Error(`Geometry validation failed: parcel span does not match BBox (${wr.toFixed(2)} × ${hr.toFixed(2)})`);
  if(!(measurements.calculated_area_sqm>1))throw new Error('Geometry validation failed: calculated parcel area is too small');
  if(!(measurements.perimeter_m>4))throw new Error('Geometry validation failed: parcel perimeter is too small');
  if(!(measurements.approx_length_m>Math.max(2,Math.max(bw,bh)*0.30)))throw new Error('Geometry validation failed: parcel length is implausible');
  if(measurements.calculated_area_sqm>bw*bh*1.15)throw new Error('Geometry validation failed: parcel area exceeds its BBox');
  return {width_m:gw,height_m:gh,width_ratio:wr,height_ratio:hr};
}

async function reconstructPolygon({plotId,bbox,cfg,plotBBox=bbox}){
  const bw=Math.max(0.01,bbox.xmax-bbox.xmin),bh=Math.max(0.01,bbox.ymax-bbox.ymin),aspect=bw/bh;
  // Geometry capture uses a dedicated high-resolution raster, independent of the visible browser viewport.
  // Keep the long side large and the short side sufficiently detailed for long/narrow parcels.
  const longSide=3000,minSide=1200;
  let width,height;
  if(aspect>=1){width=longSide;height=Math.max(minSide,Math.round(longSide/aspect));}
  else{height=longSide;width=Math.max(minSide,Math.round(longSide*aspect));}
  width=Math.min(3200,width);height=Math.min(3200,height);
  const p=new URLSearchParams({
    SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',FORMAT:'image/png',TRANSPARENT:'true',transparent:'true',
    LAYERS:'PLOT_LIST',state:cfg.state,gis_code:cfg.gisCode,plot_id:plotId,STYLES:'PLOT_SELECTION',
    CRS:cfg.wmsRequestCRS || 'EPSG:3857',WIDTH:String(width),HEIGHT:String(height),
    BBOX:`${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`
  });
  const upstream=await fetch(`${BHU}/WMS?${p.toString()}`,{
    headers:{'User-Agent':'Mozilla/5.0','Accept':'image/png,image/*','Referer':`${BHU}/`}
  });
  if(!upstream.ok)throw new Error(`Plot WMS HTTP ${upstream.status}`);
  const buf=Buffer.from(await upstream.arrayBuffer());
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height,ch=info.channels,rawMask=new Uint8Array(w*h);
  // A higher alpha threshold rejects anti-aliased fringe pixels from the rendered selection stroke.
  for(let i=0;i<w*h;i++)rawMask[i]=data[i*ch+3]>=96?1:0;
  let component=largestConnectedComponent(rawMask,w,h);
  if(component.size<100)throw new Error('Could not isolate selected parcel in BhuNaksha selection image');
  // One-pixel erosion traces closer to the parcel fill instead of the outside edge of the WMS highlight stroke.
  const eroded=erodeMask(component.mask,w,h,1);
  const erodedComponent=largestConnectedComponent(eroded,w,h);
  if(erodedComponent.size>=Math.max(100,component.size*0.70))component=erodedComponent;
  const traced=traceBoundary(component.mask,w,h);
  if(traced.length<16)throw new Error('Could not trace selected plot boundary');
  // Preserve visible cadastral bends/notches. Stored geometry gets only light raster-noise simplification.
  let simp=rdp(traced,0.65);
  if(simp.length<8)simp=rdp(traced,0.35);
  if(simp.length<6)simp=traced.filter((_,i)=>i%Math.max(1,Math.floor(traced.length/120))===0);
  if(simp[0][0]!==simp[simp.length-1][0]||simp[0][1]!==simp[simp.length-1][1])simp.push(simp[0]);
  const nativeCoords=simp.map(([px,py])=>pixelToNative(px,py,bbox,w,h));
  const measurements=polygonMeasurementsNative(nativeCoords,plotBBox);
  const validation=validateReconstructedGeometry(nativeCoords,plotBBox,measurements);
  const coords=nativeCoords.map(([x,y])=>proj4('EPSG:32645','EPSG:4326',[x,y]));
  return{geometry:{type:'Polygon',coordinates:[coords]},measurements,validation,componentPixels:component.size,raster:{width:w,height:h}};
}
app.post('/api/reconstruct',async(req,res)=>{
  try{
    const p=req.body||{};
    const cfg={
      state:String(p.state||'10'), survey:String(p.survey||''), sheet:String(p.sheet||''),
      mapInstance:String(p.map_instance||p.mapInstance||''), gisCode:String(p.gis_code||p.gisCode||''),
      levels:String(p.levels||''), wmsRequestCRS:'EPSG:3857'
    };
    if(!cfg.survey||!cfg.sheet||!cfg.gisCode) return res.status(400).json({error:'survey, sheet and gis_code required'});
    if(!p.plot_id||p.xmin==null||p.ymin==null||p.xmax==null||p.ymax==null)
      return res.status(400).json({error:'plot_id and bbox required'});
    const plotBBox={xmin:Number(p.xmin),ymin:Number(p.ymin),xmax:Number(p.xmax),ymax:Number(p.ymax)};
    const reconstructed=await reconstructPolygon({plotId:p.plot_id,bbox:percentPaddedBBox(p,0.03,0.5),plotBBox,cfg});
    res.json({
      type:'Feature',
      properties:{
        plotNo:String(p.plot_no||''),owner:p.owner||'',localName:p.local_name||'',
        survey:cfg.survey,sheet:cfg.sheet,gisCode:cfg.gisCode,plotId:p.plot_id,pniu:p.pniu||'',
        source:'Reconstructed from BhuNaksha WMS PLOT_LIST raster',
        measurements:reconstructed.measurements,
        validation:{...reconstructed.validation,raster:reconstructed.raster}, geometryVersion:3, geometryStatus:'VALID'
      },
      geometry:reconstructed.geometry
    });
  }catch(err){
    console.error('reconstruct:',err);
    // Parcel geometry is an enhancement. If tracing/rendering fails but the
    // caller supplied valid parcel metadata, return a non-fatal warning so
    // Add/Update can continue using the parcel BBox as the fallback geometry.
    res.json({
      type:'Feature',
      properties:{
        plotNo:String(req.body?.plot_no||''),
        survey:String(req.body?.survey||''),
        sheet:String(req.body?.sheet||''),
        gisCode:String(req.body?.gis_code||req.body?.gisCode||''),
        plotId:String(req.body?.plot_id||''),
        pniu:String(req.body?.pniu||''),
        source:'',
        measurements:null,
        validation:null,
        geometryVersion:3,
        geometryStatus:'INVALID',
        warning:err.message||'Parcel shape reconstruction failed'
      },
      geometry:null,
      warning:err.message||'Parcel shape reconstruction failed'
    });
  }
});

app.get('/api/reference-data',(req,res)=>{
  try{
    const families=db.prepare('SELECT * FROM families WHERE is_active=1 ORDER BY family_name').all();
    const members=db.prepare('SELECT * FROM family_members WHERE is_active=1 ORDER BY family_id, member_name').all();
    const locations=db.prepare('SELECT * FROM locations WHERE is_active=1 ORDER BY location_name').all();
    res.json({families,members,locations,decimalPerBigha:62});
  }catch(err){
    console.error('reference data:',err);
    res.status(500).json({error:err.message});
  }
});

app.get('/api/plots',(req,res)=>{
  const rows=db.prepare('SELECT * FROM plots ORDER BY CAST(plot_no AS INTEGER),plot_no').all();
  const coStmt=db.prepare('SELECT family_member_id FROM plot_coowners WHERE plot_id=? ORDER BY id');
  res.json(rows.map(r=>({...r,
    geometry:r.geometry_geojson?JSON.parse(r.geometry_geojson):null,
    coowner_ids:coStmt.all(r.id).map(x=>x.family_member_id)
  })));
});

app.post('/api/plots',(req,res)=>{
  try{
    const p=req.body||{};
    const record={
      survey:String(p.survey||'').trim(),
      map_instance:String(p.map_instance||p.mapInstance||'').trim(),
      sheet:String(p.sheet||'').trim(),
      gis_code:String(p.gis_code||p.gisCode||'').trim(),
      levels:String(p.levels||'').trim(),
      mauza:String(p.mauza||'').trim(),
      plot_no:p.plot_no||'',plot_id:p.plot_id||'',pniu:p.pniu||'',
      seed_x:p.seed_x??null,seed_y:p.seed_y??null,
      xmin:p.xmin??null,ymin:p.ymin??null,xmax:p.xmax??null,ymax:p.ymax??null,
      owner:p.owner||'',local_name:p.local_name||'',notes:p.notes||'',
      center_lat:p.center_lat??null,center_lng:p.center_lng??null,
      google_map_url:p.google_map_url||'',
      geometry_geojson:p.geometry?JSON.stringify(p.geometry):null,
      source:p.source||(p.geometry?'Reconstructed from BhuNaksha WMS PLOT_LIST raster':''),
      land_type:String(p.land_type||'').trim(),
      exact_raiyat_name:String(p.exact_raiyat_name||'').trim(),
      ownership_type:String(p.ownership_type||'').trim(),
      family_id:p.family_id??null,
      primary_family_member_id:p.primary_family_member_id??null,
      location_id:p.location_id??null,
      thana_no:String(p.thana_no||'').trim(),
      jamabandi_no:String(p.jamabandi_no||'').trim(),
      part_no:String(p.part_no||'').trim(),
      page_no:String(p.page_no||'').trim(),
      computerized_jamabandi_no:String(p.computerized_jamabandi_no||'').trim(),
      khata_no:String(p.khata_no||'').trim(),
      khesra_no:String(p.khesra_no||p.plot_no||'').trim(),
      plot_area_decimal:p.plot_area_decimal??null,
      jamabandi_total_area_decimal:p.jamabandi_total_area_decimal??null,
      geometry_type:p.geometry ? ((p.geometry.type==='Feature' ? p.geometry.geometry?.type : p.geometry.type) || 'Polygon') : (p.geometry_type||null),
      geometry_source:String(p.geometry_source||p.source||(p.geometry?'Reconstructed from BhuNaksha WMS PLOT_LIST raster':'')).trim(),
      geometry_updated_at:p.geometry ? new Date().toISOString() : (p.geometry_updated_at||null),
      geometry_status:p.geometry ? String(p.geometry_status||'VALID') : (p.geometry_status||null),
      geometry_version:p.geometry ? Number(p.geometry_version||2) : (p.geometry_version||null),
      calculated_area_sqm:p.calculated_area_sqm??p.measurements?.calculated_area_sqm??null,
      calculated_area_decimal:p.calculated_area_decimal??p.measurements?.calculated_area_decimal??null,
      perimeter_m:p.perimeter_m??p.measurements?.perimeter_m??null,
      approx_length_m:p.approx_length_m??p.measurements?.approx_length_m??null,
      approx_width_m:p.approx_width_m??p.measurements?.approx_width_m??null,
      bbox_width_m:p.bbox_width_m??p.measurements?.bbox_width_m??null,
      bbox_height_m:p.bbox_height_m??p.measurements?.bbox_height_m??null,
      bbox_area_sqm:p.bbox_area_sqm??p.measurements?.bbox_area_sqm??null,
      measurement_source:String(p.measurement_source||p.measurements?.measurement_source||'').trim(),
      measurement_updated_at:(p.measurements||p.calculated_area_sqm!=null) ? new Date().toISOString() : (p.measurement_updated_at||null)
    };
    const coownerIds=[...new Set((Array.isArray(p.coowner_ids)?p.coowner_ids:[]).map(Number).filter(Number.isInteger))];
    if(record.ownership_type==='Individual' && !record.primary_family_member_id)
      return res.status(400).json({error:'Individual ownership requires one owner.'});
    if(record.ownership_type==='Joint' && coownerIds.length<2)
      return res.status(400).json({error:'Joint ownership requires at least two owners.'});
    if(!record.survey||!record.sheet||!record.gis_code||!record.levels)
      return res.status(400).json({error:'survey, sheet, gis_code and levels are required'});
    if(!record.plot_no)return res.status(400).json({error:'plot_no required'});

    // For the current Harpur workflow, a saved parcel is identified by Survey + Plot No.
    // Map/sheet/GIS metadata may be refreshed when the parcel is reselected on BhuNaksha.
    const exact=db.prepare('SELECT * FROM plots WHERE survey=? AND plot_no=? ORDER BY id LIMIT 1')
      .get(record.survey,record.plot_no);

    if(exact){
      db.prepare(`
        UPDATE plots SET
          survey=@survey,map_instance=@map_instance,sheet=@sheet,gis_code=@gis_code,levels=@levels,mauza=@mauza,
          plot_id=@plot_id,pniu=@pniu,seed_x=@seed_x,seed_y=@seed_y,
          xmin=@xmin,ymin=@ymin,xmax=@xmax,ymax=@ymax,
          owner=@owner,local_name=@local_name,notes=@notes,
          center_lat=@center_lat,center_lng=@center_lng,google_map_url=@google_map_url,
          geometry_geojson=@geometry_geojson,source=@source,
          land_type=@land_type,exact_raiyat_name=@exact_raiyat_name,ownership_type=@ownership_type,
          family_id=@family_id,primary_family_member_id=@primary_family_member_id,location_id=@location_id,
          thana_no=@thana_no,jamabandi_no=@jamabandi_no,part_no=@part_no,page_no=@page_no,
          computerized_jamabandi_no=@computerized_jamabandi_no,khata_no=@khata_no,khesra_no=@khesra_no,
          plot_area_decimal=@plot_area_decimal,jamabandi_total_area_decimal=@jamabandi_total_area_decimal,
          geometry_type=@geometry_type,geometry_source=@geometry_source,geometry_updated_at=@geometry_updated_at,
          geometry_status=@geometry_status,geometry_version=@geometry_version,
          calculated_area_sqm=@calculated_area_sqm,calculated_area_decimal=@calculated_area_decimal,
          perimeter_m=@perimeter_m,approx_length_m=@approx_length_m,approx_width_m=@approx_width_m,
          bbox_width_m=@bbox_width_m,bbox_height_m=@bbox_height_m,bbox_area_sqm=@bbox_area_sqm,
          measurement_source=@measurement_source,measurement_updated_at=@measurement_updated_at,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=@id
      `).run({...record,id:exact.id});
      db.prepare('DELETE FROM plot_coowners WHERE plot_id=?').run(exact.id);
      if(record.ownership_type==='Joint'){
        const addCo=db.prepare('INSERT OR IGNORE INTO plot_coowners(plot_id,family_member_id) VALUES(?,?)');
        for(const memberId of coownerIds) addCo.run(exact.id,memberId);
      }
    }else{
      // Schema V2 retained the legacy UNIQUE(survey,sheet,plot_no) for backward
      // compatibility. Never overwrite a plot from another GIS context because of it.
      const legacyCollision=db.prepare(
        'SELECT * FROM plots WHERE survey=? AND sheet=? AND plot_no=?'
      ).get(record.survey,record.sheet,record.plot_no);
      if(legacyCollision && legacyCollision.gis_code!==record.gis_code){
        return res.status(409).json({
          error:'A different Mauza/map already has the same survey, sheet and plot number. The current backward-compatible database cannot safely save this second parcel yet.',
          code:'LEGACY_UNIQUE_COLLISION',
          existingGisCode:legacyCollision.gis_code,
          requestedGisCode:record.gis_code
        });
      }

      db.prepare(`
        INSERT INTO plots(
          survey,map_instance,sheet,gis_code,levels,mauza,plot_no,plot_id,pniu,seed_x,seed_y,
          xmin,ymin,xmax,ymax,owner,local_name,notes,center_lat,center_lng,google_map_url,
          geometry_geojson,source,land_type,exact_raiyat_name,ownership_type,family_id,primary_family_member_id,
          location_id,thana_no,jamabandi_no,part_no,page_no,computerized_jamabandi_no,khata_no,khesra_no,
          plot_area_decimal,jamabandi_total_area_decimal,
          geometry_type,geometry_source,geometry_updated_at,geometry_status,geometry_version,
          calculated_area_sqm,calculated_area_decimal,perimeter_m,approx_length_m,approx_width_m,
          bbox_width_m,bbox_height_m,bbox_area_sqm,measurement_source,measurement_updated_at,updated_at
        ) VALUES(
          @survey,@map_instance,@sheet,@gis_code,@levels,@mauza,@plot_no,@plot_id,@pniu,@seed_x,@seed_y,
          @xmin,@ymin,@xmax,@ymax,@owner,@local_name,@notes,@center_lat,@center_lng,@google_map_url,
          @geometry_geojson,@source,@land_type,@exact_raiyat_name,@ownership_type,@family_id,@primary_family_member_id,
          @location_id,@thana_no,@jamabandi_no,@part_no,@page_no,@computerized_jamabandi_no,@khata_no,@khesra_no,
          @plot_area_decimal,@jamabandi_total_area_decimal,
          @geometry_type,@geometry_source,@geometry_updated_at,@geometry_status,@geometry_version,
          @calculated_area_sqm,@calculated_area_decimal,@perimeter_m,@approx_length_m,@approx_width_m,
          @bbox_width_m,@bbox_height_m,@bbox_area_sqm,@measurement_source,@measurement_updated_at,CURRENT_TIMESTAMP
        )
      `).run(record);
      const inserted=db.prepare('SELECT id FROM plots WHERE survey=? AND plot_no=? ORDER BY id DESC LIMIT 1').get(record.survey,record.plot_no);
      if(inserted && record.ownership_type==='Joint'){
        const addCo=db.prepare('INSERT OR IGNORE INTO plot_coowners(plot_id,family_member_id) VALUES(?,?)');
        for(const memberId of coownerIds) addCo.run(inserted.id,memberId);
      }
    }

    const r=db.prepare('SELECT * FROM plots WHERE survey=? AND plot_no=? ORDER BY id LIMIT 1')
      .get(record.survey,record.plot_no);
    const savedCoowners=db.prepare('SELECT family_member_id FROM plot_coowners WHERE plot_id=? ORDER BY id').all(r.id).map(x=>x.family_member_id);
    res.json({...r,geometry:r.geometry_geojson?JSON.parse(r.geometry_geojson):null,coowner_ids:savedCoowners});
  }catch(err){
    console.error('save plot:',err);
    res.status(500).json({error:err.message});
  }
});


app.delete('/api/plots/:survey/:sheet/:plotNo', (req,res) => {
  try {
    const { survey, sheet, plotNo } = req.params;
    const existing = db.prepare(
      'SELECT * FROM plots WHERE survey=? AND plot_no=? ORDER BY id LIMIT 1'
    ).get(survey, plotNo);

    if (!existing) {
      return res.status(404).json({ error: 'Plot not found in local database' });
    }

    db.prepare('DELETE FROM plots WHERE id=?').run(existing.id);

    res.json({
      deleted: true,
      survey,
      sheet,
      plotNo
    });
  } catch (err) {
    console.error('delete plot:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT,()=>console.log(`Harpur Land Mapper V7.7 Reconstruct Fallback: http://localhost:${PORT}`));
