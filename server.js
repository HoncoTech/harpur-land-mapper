
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const proj4 = require('proj4');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const BHU = 'https://bhunaksha.bihar.gov.in';

proj4.defs('EPSG:32645', '+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs +type=crs');

// Harpur CS Sheet 01 config.
// We keep the exact known-working BhuNaksha request model.
const SHEETS = {
  '01': {
    key: 'CS1', survey: 'CS', sheet: '01', state: '10',
    gisCode: 'CS30010202301990601',
    levels: '30,01,02,0230,CS,06,01,',
    wmsRequestCRS: 'EPSG:3857', width: 1502, height: 1028,
    imageBBox: {
      xmin: 189758.96895288327,
      ymin: 2806268.129076574,
      xmax: 193345.53763945174,
      ymax: 2808722.4742816687
    }
  },
  '02': {
    key: 'CS2', survey: 'CS', sheet: '02', state: '10',
    gisCode: 'CS30010202301990602',
    levels: '30,01,02,0230,CS,06,02,',
    wmsRequestCRS: 'EPSG:3857', width: 1502, height: 1028,
    imageBBox: {
      xmin: 189720.5811856323,
      ymin: 2804925.385129284,
      xmax: 193307.14987220077,
      ymax: 2807379.730334379
    },
    nativeExtent: {
      epsg: 'EPSG:32645',
      xmin: 190449.736065251,
      ymin: 2805551.8911005286,
      xmax: 192577.99499258207,
      ymax: 2806753.2243631342
    }
  }
};
function getSheetConfig(sheet='01'){
  const key=String(sheet||'01').padStart(2,'0');
  const cfg=SHEETS[key];
  if(!cfg) throw new Error(`Unsupported sheet ${sheet}`);
  return cfg;
}


const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'harpur.sqlite');
const db = new Database(DB_PATH);
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


function ensureColumn(name, definition) {
  const cols = db.prepare(`PRAGMA table_info(plots)`).all().map(c => c.name);
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE plots ADD COLUMN ${name} ${definition}`);
  }
}
ensureColumn('center_lat', 'REAL');
ensureColumn('center_lng', 'REAL');
ensureColumn('google_map_url', "TEXT DEFAULT ''");

app.use(express.json({limit:'3mb'}));
app.use(express.static(path.join(__dirname, 'public')));

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

async function ensureSheetBBox(cfg){
  // Exact viewer BBOX values are known for both Harpur CS sheets.
  if(!cfg.imageBBox) throw new Error(`Missing BhuNaksha image BBOX for sheet ${cfg.sheet}`);
  return cfg.imageBBox;
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
    CRS: cfg.wmsRequestCRS,
    STYLES: 'VILLAGE_MAP',
    WIDTH: String(width),
    HEIGHT: String(height),
    BBOX: `${xmin},${ymin},${xmax},${ymax}`
  });
  return `${BHU}/WMS?${p.toString()}`;
}

async function proxyPng(url, res, logLabel='BhuNaksha') {
  const upstream = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'image/png,image/*;q=0.9,*/*;q=0.8',
      'Referer': `${BHU}/`
    }
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (!upstream.ok) {
    console.error(`${logLabel} upstream error:`, upstream.status, buf.toString('utf8').slice(0,300));
    res.status(502).send(`BhuNaksha WMS HTTP ${upstream.status}`);
    return;
  }
  res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
}

app.get('/api/config', async (req,res) => {
  try{
    const cfg=getSheetConfig(req.query.sheet||'01'); await ensureSheetBBox(cfg);
    res.json({...cfg,availableSheets:Object.keys(SHEETS),googleBounds:nativeBBoxToLatLngBounds(cfg.imageBBox),googleMapsApiKey:process.env.GOOGLE_MAPS_API_KEY||''});
  }catch(err){res.status(400).json({error:err.message});}
});

app.get('/api/about', (req,res) => {
  res.json({
    name: 'Harpur Land Mapper',
    version: '5.6.1',
    release: '5.6.1',
    survey: 'CS',
    sheet: '01 / 02',
    village: 'Harpur(199)',
    circle: 'Rajpur',
    district: 'Buxar',
    state: 'Bihar',
    features: [
      'Google Satellite base map',
      'Dynamic BhuNaksha cadastral PNG refresh on pan/zoom',
      'Click-to-identify parcel',
      'Selection pin with plot number',
      'Save / Update / Delete local plot records',
      'Google Maps center link per saved plot',
      'GeoJSON polygon reconstruction',
      'Mobile-friendly layout'
    ]
  });
});


// Exact full-sheet image you captured in DevTools.
app.get('/api/bhunaksha-sheet.png', async (req,res) => {
  try{
    const cfg=getSheetConfig(req.query.sheet||'01'); await ensureSheetBBox(cfg);
    const b=cfg.imageBBox; const url=buildVillageMapUrl(cfg,{xmin:b.xmin,ymin:b.ymin,xmax:b.xmax,ymax:b.ymax,width:cfg.width,height:cfg.height});
    console.log(`BhuNaksha full sheet ${cfg.sheet}:`,url); await proxyPng(url,res,`Full sheet ${cfg.sheet}`);
  }catch(err){console.error('Full sheet error:',err);res.status(502).send(err.message);}
});

// Dynamic viewport-aligned cadastral PNG.
// Client sends the current visible native bbox + output image size.
// The app refreshes this whenever map zoom/pan settles (idle).
app.get('/api/viewport-overlay.png', async (req,res) => {
  try {
    const cfg=getSheetConfig(req.query.sheet||'01'); await ensureSheetBBox(cfg);
    const xmin = Number(req.query.xmin);
    const ymin = Number(req.query.ymin);
    const xmax = Number(req.query.xmax);
    const ymax = Number(req.query.ymax);
    let width = Number(req.query.width);
    let height = Number(req.query.height);

    if (![xmin,ymin,xmax,ymax,width,height].every(Number.isFinite)) {
      return res.status(400).send('xmin,ymin,xmax,ymax,width,height are required numbers');
    }

    width = clamp(Math.round(width), 256, 4096);
    height = clamp(Math.round(height), 256, 4096);

    const url = buildVillageMapUrl(cfg,{xmin, ymin, xmax, ymax, width, height});
    console.log('BhuNaksha viewport overlay:', url);
    await proxyPng(url, res, 'Viewport overlay');
  } catch(err) {
    console.error('Viewport overlay error:', err);
    res.status(502).send(err.message);
  }
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

app.get('/api/plot-at-xy', async (req,res)=>{
  try {
    const cfg=getSheetConfig(req.query.sheet||'01');
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
function isBoundary(mask,w,h,x,y){
  if(!mask[y*w+x])return false;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,ny=y+dy;
    if(nx<0||ny<0||nx>=w||ny>=h||!mask[ny*w+nx])return true;
  }
  return false;
}
function traceBoundary(mask,w,h){
  let sx=-1,sy=-1;
  outer:
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(isBoundary(mask,w,h,x,y)){sx=x;sy=y;break outer;}
  if(sx<0)return[];
  const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  let x=sx,y=sy,prev=4;const pts=[];
  for(let step=0;step<w*h*4;step++){
    pts.push([x,y]);let found=false;const start=(prev+6)%8;
    for(let i=0;i<8;i++){
      const d=(start+i)%8,nx=x+dirs[d][0],ny=y+dirs[d][1];
      if(nx>=0&&ny>=0&&nx<w&&ny<h&&mask[ny*w+nx]){x=nx;y=ny;prev=d;found=true;break;}
    }
    if(!found)break;
    if(x===sx&&y===sy&&pts.length>10)break;
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

async function reconstructPolygon({plotId,bbox,cfg}){
  const width=1600,height=2000;
  const p=new URLSearchParams({
    SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',
    FORMAT:'image/png',TRANSPARENT:'true',transparent:'true',
    LAYERS:'PLOT_LIST',state:cfg.state,gis_code:cfg.gisCode,
    plot_id:plotId,STYLES:'PLOT_SELECTION',CRS:'EPSG:32645',
    WIDTH:String(width),HEIGHT:String(height),
    BBOX:`${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`
  });
  const upstream=await fetch(`${BHU}/WMS?${p.toString()}`,{
    headers:{'User-Agent':'Mozilla/5.0','Accept':'image/png,image/*','Referer':`${BHU}/`}
  });
  if(!upstream.ok)throw new Error(`Plot WMS HTTP ${upstream.status}`);
  const buf=Buffer.from(await upstream.arrayBuffer());
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height,ch=info.channels,mask=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)mask[i]=data[i*ch+3]>20?1:0;
  const traced=traceBoundary(mask,w,h);
  if(traced.length<4)throw new Error('Could not trace selected plot boundary');
  let simp=rdp(traced,2.0);
  if(simp.length<4)simp=traced.filter((_,i)=>i%Math.max(1,Math.floor(traced.length/25))===0);
  if(simp[0][0]!==simp[simp.length-1][0]||simp[0][1]!==simp[simp.length-1][1])simp.push(simp[0]);
  const coords=simp.map(([px,py])=>{
    const [x,y]=pixelToNative(px,py,bbox,w,h);
    return proj4('EPSG:32645','EPSG:4326',[x,y]);
  });
  return{type:'Polygon',coordinates:[coords]};
}

app.post('/api/reconstruct',async(req,res)=>{
  try{
    const p=req.body||{};
    const cfg=getSheetConfig(p.sheet||'01');
    if(!p.plot_id||p.xmin==null||p.ymin==null||p.xmax==null||p.ymax==null)
      return res.status(400).json({error:'plot_id and bbox required'});
    const geometry=await reconstructPolygon({plotId:p.plot_id,bbox:paddedBBox(p,2),cfg});
    res.json({
      type:'Feature',
      properties:{
        plotNo:String(p.plot_no||''),owner:p.owner||'',localName:p.local_name||'',
        survey:'CS',sheet:cfg.sheet,gisCode:cfg.gisCode,plotId:p.plot_id,pniu:p.pniu||'',
        source:'Reconstructed from BhuNaksha WMS PLOT_LIST raster'
      },
      geometry
    });
  }catch(err){console.error('reconstruct:',err);res.status(502).json({error:err.message});}
});

app.get('/api/plots',(req,res)=>{
  const rows=db.prepare('SELECT * FROM plots ORDER BY CAST(plot_no AS INTEGER),plot_no').all();
  res.json(rows.map(r=>({...r,geometry:r.geometry_geojson?JSON.parse(r.geometry_geojson):null})));
});

app.post('/api/plots',(req,res)=>{
  const p=req.body||{};
  const cfg=getSheetConfig(p.sheet||'01');
  const record={
    survey:'CS',sheet:cfg.sheet,gis_code:cfg.gisCode,levels:cfg.levels,
    plot_no:p.plot_no||'',plot_id:p.plot_id||'',pniu:p.pniu||'',
    seed_x:p.seed_x??null,seed_y:p.seed_y??null,
    xmin:p.xmin??null,ymin:p.ymin??null,xmax:p.xmax??null,ymax:p.ymax??null,
    owner:p.owner||'',local_name:p.local_name||'',notes:p.notes||'',
    center_lat:p.center_lat??null,center_lng:p.center_lng??null,
    google_map_url:p.google_map_url||'',
    geometry_geojson:p.geometry?JSON.stringify(p.geometry):null,
    source:p.source||(p.geometry?'Reconstructed from BhuNaksha WMS PLOT_LIST raster':'')
  };
  if(!record.plot_no)return res.status(400).json({error:'plot_no required'});

  db.prepare(`
    INSERT INTO plots(
      survey,sheet,gis_code,levels,plot_no,plot_id,pniu,seed_x,seed_y,
      xmin,ymin,xmax,ymax,owner,local_name,notes,center_lat,center_lng,google_map_url,
      geometry_geojson,source,updated_at
    ) VALUES(
      @survey,@sheet,@gis_code,@levels,@plot_no,@plot_id,@pniu,@seed_x,@seed_y,
      @xmin,@ymin,@xmax,@ymax,@owner,@local_name,@notes,@center_lat,@center_lng,@google_map_url,
      @geometry_geojson,@source,CURRENT_TIMESTAMP
    )
    ON CONFLICT(survey,sheet,plot_no) DO UPDATE SET
      plot_id=excluded.plot_id,pniu=excluded.pniu,seed_x=excluded.seed_x,seed_y=excluded.seed_y,
      xmin=excluded.xmin,ymin=excluded.ymin,xmax=excluded.xmax,ymax=excluded.ymax,
      owner=excluded.owner,local_name=excluded.local_name,notes=excluded.notes,
      center_lat=excluded.center_lat,center_lng=excluded.center_lng,google_map_url=excluded.google_map_url,
      geometry_geojson=excluded.geometry_geojson,source=excluded.source,updated_at=CURRENT_TIMESTAMP
  `).run(record);

  const r=db.prepare('SELECT * FROM plots WHERE survey=? AND sheet=? AND plot_no=?')
    .get('CS',record.sheet,record.plot_no);
  res.json({...r,geometry:r.geometry_geojson?JSON.parse(r.geometry_geojson):null});
});


app.delete('/api/plots/:survey/:sheet/:plotNo', (req,res) => {
  try {
    const { survey, sheet, plotNo } = req.params;
    const existing = db.prepare(
      'SELECT * FROM plots WHERE survey=? AND sheet=? AND plot_no=?'
    ).get(survey, sheet, plotNo);

    if (!existing) {
      return res.status(404).json({ error: 'Plot not found in local database' });
    }

    db.prepare(
      'DELETE FROM plots WHERE survey=? AND sheet=? AND plot_no=?'
    ).run(survey, sheet, plotNo);

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

app.listen(PORT,()=>console.log(`Harpur Land Mapper V5.6.1: http://localhost:${PORT}`));
