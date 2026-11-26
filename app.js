/* =========================================================
 ADLI FX INTEL V4 PREMIUM ENGINE
 Twelve Data + Supabase Edge Function + Lightweight Charts
 Educational rule-based technical analysis.
========================================================= */
(function(){
"use strict";

const CONFIG=window.ADLI_CONFIG;
if(!CONFIG){console.error("ADLI V4: config.js missing.");return}

const FUNCTION_URL=String(CONFIG.SUPABASE_URL||"").replace(/\/$/,"")+"/functions/v1/market-data";
const API_KEY=CONFIG.SUPABASE_KEY;
const SYMBOL="XAU/USD";
const REFRESH_MS=5*60*1000;
const REQUEST_GAP_MS=8000;
const STORAGE_KEY="adli_fx_analysis_history_v4";

const TF={
 "1m":"1min","5m":"5min","15m":"15min","30m":"30min",
 "1h":"1h","4h":"4h","1d":"1day"
};
const MTF_IDS={"1m":"mtf1m","5m":"mtf5m","15m":"mtf15m","30m":"mtf30m","1h":"mtf1h","4h":"mtf4h","1d":"mtf1d"};
const COLORS={gold:"#d9b45b",green:"#00c087",red:"#f6465d",muted:"#8492a6"};

let currentTF="5m",mode="scalping",candles=[],chart=null,series=null;
let resizeObserver=null,started=false,chartLoading=false,mtfLoading=false;
let lastRequestTime=0,queue=Promise.resolve(),mtfCache={},lastError=null;
let priceLines=[],lastHistoryKey="",lastResult=null;
let language="ms",calendarFilter="today";

const $=id=>document.getElementById(id);
const tx=(id,value,color)=>{const e=$(id);if(e){e.textContent=value;if(color)e.style.color=color}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):"--";

function queued(task){
 const p=queue.then(async()=>{
  const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastRequestTime));
  if(wait)await sleep(wait);
  lastRequestTime=Date.now();
  return task();
 });
 queue=p.catch(()=>{});
 return p;
}

function emit(){
 window.dispatchEvent(new CustomEvent("adli:market-update",{detail:{
  status:Market.status,symbol:SYMBOL,price:Market.price,candles,
  timeframe:currentTF,updatedAt:Market.lastUpdated,error:Market.error
 }}));
}

function setStatus(){
 tx("goldPrice",Market.price==null?"--":fmt(Market.price));
 tx("dataStatus",Market.status,Market.status==="CONNECTED"?COLORS.green:Market.status==="ERROR"?COLORS.red:COLORS.gold);
 const empty=$("chartEmpty");
 if(empty){
  empty.style.display=candles.length?"none":"flex";
  if(!candles.length)empty.textContent=Market.error||"Menunggu data pasaran…";
 }
 if(candles.length>1){
  const a=candles.at(-1).close,b=candles.at(-2).close;
  tx("marketTrend",a>b?"BULLISH":a<b?"BEARISH":"SIDEWAYS",a>b?COLORS.green:a<b?COLORS.red:COLORS.gold);
 }
 emit();
}

const Market={
 status:"WAITING",price:null,lastUpdated:null,error:null,

 initChart(){
  const el=$("priceChart");
  if(!el||chart)return;
  if(!window.LightweightCharts){this.status="ERROR";this.error="Pustaka carta tidak tersedia";setStatus();return}
  try{
   chart=LightweightCharts.createChart(el,{
    width:Math.max(300,el.clientWidth),height:Math.max(250,el.clientHeight),
    layout:{background:{color:"#101827"},textColor:"#8492a6"},
    grid:{vertLines:{color:"#1c293a"},horzLines:{color:"#1c293a"}},
    rightPriceScale:{borderColor:"#263247"},
    timeScale:{borderColor:"#263247",timeVisible:true,secondsVisible:false},
    crosshair:{mode:1},localization:{priceFormatter:fmt}
   });
   series=chart.addCandlestickSeries({
    upColor:COLORS.green,downColor:COLORS.red,
    borderUpColor:COLORS.green,borderDownColor:COLORS.red,
    wickUpColor:COLORS.green,wickDownColor:COLORS.red,priceLineVisible:true
   });
   if(window.ResizeObserver){resizeObserver=new ResizeObserver(()=>this.resize());resizeObserver.observe(el)}
   window.addEventListener("resize",()=>this.resize());
  }catch(e){this.status="ERROR";this.error="Ralat carta: "+e.message;console.error(e);setStatus()}
 },

 convert(values){
  if(!Array.isArray(values))return[];
  return values.map(x=>{
   const raw=String(x.datetime||"").trim(),v=raw.replace(" ","T");
   const ms=Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(v)?v:v+"Z");
   return{time:Math.floor(ms/1000),open:+x.open,high:+x.high,low:+x.low,close:+x.close};
  }).filter(x=>Number.isFinite(x.time)&&[x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.high>=x.low)
   .sort((a,b)=>a.time-b.time).filter((x,i,a)=>!i||x.time!==a[i-1].time);
 },

 async request(tf){
  if(!TF[tf])throw Error("Timeframe tidak sah: "+tf);
  if(CONFIG.MARKET_DATA_ENABLED===false)throw Error("Market data dimatikan dalam config.js");
  if(!FUNCTION_URL||!API_KEY)throw Error("Konfigurasi Supabase tidak lengkap");
  const q=new URLSearchParams({symbol:SYMBOL,interval:TF[tf]});
  const res=await fetch(FUNCTION_URL+"?"+q.toString(),{method:"GET",headers:{apikey:API_KEY}});
  let data;
  try{data=await res.json()}catch(e){throw Error("Respons JSON tidak sah. HTTP "+res.status)}
  if(!res.ok)throw Error("HTTP "+res.status+": "+(data.error||data.message||"Permintaan gagal"));
  if(data.success!==true)throw Error(data.error||data.message||"Provider tidak mengesahkan data");
  const out=this.convert(data.values);
  if(out.length<30)throw Error("Data candle tidak mencukupi: "+out.length+" diterima");
  return out;
 },

 async fetch(tf=currentTF){
  if(chartLoading)return;
  chartLoading=true;this.status=candles.length?"UPDATING":"LOADING";this.error=null;setStatus();
  try{
   const received=await queued(()=>this.request(tf));
   candles=received;currentTF=tf;this.price=candles.at(-1).close;
   this.lastUpdated=new Date();this.status="CONNECTED";this.error=null;lastError=null;
   if(series&&chart){series.setData(candles);chart.timeScale().fitContent()}
   analyse();setStatus();
   console.log("ADLI V4 market update",{tf,count:candles.length,price:this.price});
  }catch(e){
   this.status="ERROR";this.error=e.message;lastError=e.message;
   clearAnalysis("RALAT DATA · ANALISIS DIJEDA");
   console.error("ADLI MARKET ERROR",e);
  }finally{chartLoading=false;setStatus()}
 },

 setTimeframe(tf){if(!TF[tf])return;currentTF=tf;this.fetch(tf)},
 resize(){const el=$("priceChart");if(chart&&el&&el.clientWidth&&el.clientHeight)chart.applyOptions({width:el.clientWidth,height:el.clientHeight})},
 getCandles(){return candles},getPrice(){return this.price},getStatus(){return this.status}
};

const Analysis={
 ema(v,p){
  if(!Array.isArray(v)||v.length<p)return null;
  const k=2/(p+1);let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<v.length;i++)e=(v[i]-e)*k+e;
  return e;
 },
 rsi(v,p=14){
  if(v.length<=p)return null;
  let g=0,l=0;
  for(let i=1;i<=p;i++){const d=v[i]-v[i-1];if(d>0)g+=d;else l-=d}
  g/=p;l/=p;
  for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}
  return l===0?(g===0?50:100):100-100/(1+g/l);
 },
 atr(d,p=14){
  if(d.length<=p)return null;
  const r=[];
  for(let i=1;i<d.length;i++){const c=d[i],b=d[i-1];r.push(Math.max(c.high-c.low,Math.abs(c.high-b.close),Math.abs(c.low-b.close)))}
  return r.slice(-p).reduce((a,b)=>a+b,0)/p;
 },
 analyse(d,selectedMode=mode){
  if(!Array.isArray(d)||d.length<30)return{ready:false,signal:"HOLD",strength:0,reason:"Memerlukan sekurang-kurangnya 30 candle"};
  const c=d.map(x=>x.close),ema9=this.ema(c,9),ema20=this.ema(c,20),ema50=this.ema(c,50),rsi=this.rsi(c),atr=this.atr(d);
  if([ema9,ema20,ema50,rsi,atr].some(x=>x==null||!Number.isFinite(x)))return{ready:false,signal:"HOLD",strength:0,reason:"Pengiraan indikator tidak tersedia"};
  let score=0;
  if(ema9>ema20)score+=2;else if(ema9<ema20)score-=2;
  if(c.at(-1)>ema20)score++;else if(c.at(-1)<ema20)score--;
  if(rsi>54&&rsi<72)score++;else if(rsi<46&&rsi>28)score--;
  if(ema20>ema50)score++;else if(ema20<ema50)score--;
  const threshold=selectedMode==="swing"?4:3;
  const signal=score>=threshold?"BUY":score<=-threshold?"SELL":"HOLD";
  return{ready:true,signal,strength:Math.min(100,Math.round(Math.abs(score)/5*100)),score,ema9,ema20,ema50,rsi,atr,price:c.at(-1),data:d};
 },
 structure(d){
  if(d.length<12)return"DATA TIDAK MENCUKUPI";
  const x=d.slice(-12),h1=Math.max(...x.slice(0,6).map(z=>z.high)),h2=Math.max(...x.slice(6).map(z=>z.high)),l1=Math.min(...x.slice(0,6).map(z=>z.low)),l2=Math.min(...x.slice(6).map(z=>z.low));
  if(h2>h1&&l2>l1)return"HIGHER HIGH / HIGHER LOW";
  if(h2<h1&&l2<l1)return"LOWER HIGH / LOWER LOW";
  return"RANGE / MIXED";
 },
 liquidity(d){
  if(d.length<12)return"DATA TIDAK MENCUKUPI";
  const last=d.at(-1),prev=d.slice(-11,-1),hi=Math.max(...prev.map(x=>x.high)),lo=Math.min(...prev.map(x=>x.low));
  if(last.high>hi&&last.close<hi)return"REJECTION DI ATAS";
  if(last.low<lo&&last.close>lo)return"REJECTION DI BAWAH";
  return"TIADA SWEEP TERKINI";
 },
 fvg(d){
  if(d.length<3)return"DATA TIDAK MENCUKUPI";
  const a=d.at(-3),c=d.at(-1);
  if(c.low>a.high)return"BULLISH GAP · "+fmt(a.high)+" – "+fmt(c.low);
  if(c.high<a.low)return"BEARISH GAP · "+fmt(c.high)+" – "+fmt(a.low);
  return"TIADA GAP 3-CANDLE";
 },
 orderBlock(d){
  if(d.length<5)return"DATA TIDAK MENCUKUPI";
  const a=d.at(-1),b=d.at(-2);
  if(a.close>b.high)return"PENUTUPAN MELEPASI HIGH SEBELUM";
  if(a.close<b.low)return"PENUTUPAN MELEPASI LOW SEBELUM";
  return"TIADA PENGESAHAN BREAK";
 },
 premiumDiscount(d){
  const x=d.slice(-30),hi=Math.max(...x.map(z=>z.high)),lo=Math.min(...x.map(z=>z.low)),mid=(hi+lo)/2,p=d.at(-1).close;
  return{label:p>mid?"PREMIUM":p<mid?"DISCOUNT":"TENGAH JULAT",high:hi,low:lo,mid};
 }
};

function clearLines(){
 if(!series)return;
 priceLines.forEach(x=>{try{series.removePriceLine(x)}catch(e){}});
 priceLines=[];
}
function addLine(price,title,color){
 if(!series||!Number.isFinite(price))return;
 priceLines.push(series.createPriceLine({price,title,color,lineWidth:1,lineStyle:2,axisLabelVisible:true}));
}
function clearAnalysis(reason){
 tx("aiSignal","HOLD",COLORS.gold);tx("signalStrength",reason||"MENUNGGU",COLORS.gold);
 ["signalEMA","signalRSI","entry","stopLoss","tp1","tp2","tp3","structure","liquidity","fvg","orderBlock","premiumDiscount","buyZone","sellZone","buyZoneStatus","sellZoneStatus"].forEach(id=>tx(id,"--"));
 tx("signalTF",currentTF.toUpperCase());tx("signalUpdated","DIJEDA");
 const m=$("signalMeterFill");if(m)m.style.width="0%";
 clearLines();lastResult=null;
}

function zoneStatus(price,low,high,side){
 if(price>=low&&price<=high)return"TOUCHED";
 if(side==="BUY"&&price<low)return"INVALIDATED";
 if(side==="SELL"&&price>high)return"INVALIDATED";
 return"ACTIVE";
}
function renderLevels(r){
 clearLines();
 const p=r.price,a=r.atr,up=r.signal==="BUY";
 const sl=up?p-a*1.5:p+a*1.5;
 const t1=up?p+a:p-a,t2=up?p+a*2:p-a*2,t3=up?p+a*3:p-a*3;
 const buyLow=p-a*.65,buyHigh=p-a*.15,sellLow=p+a*.15,sellHigh=p+a*.65;
 const buyStatus=zoneStatus(p,buyLow,buyHigh,"BUY"),sellStatus=zoneStatus(p,sellLow,sellHigh,"SELL");
 tx("entry",fmt(p));tx("stopLoss",fmt(sl),COLORS.red);
 tx("tp1",fmt(t1),COLORS.green);tx("tp2",fmt(t2),COLORS.green);tx("tp3",fmt(t3),COLORS.green);
 tx("buyZone",fmt(buyLow)+" – "+fmt(buyHigh),COLORS.green);
 tx("buyZoneStatus",buyStatus,buyStatus==="INVALIDATED"?COLORS.red:buyStatus==="TOUCHED"?COLORS.gold:COLORS.green);
 tx("sellZone",fmt(sellLow)+" – "+fmt(sellHigh),COLORS.red);
 tx("sellZoneStatus",sellStatus,sellStatus==="INVALIDATED"?COLORS.red:sellStatus==="TOUCHED"?COLORS.gold:COLORS.green);
 addLine(p,"ENTRY RUJUKAN",COLORS.gold);
 addLine(sl,"SL ILUSTRASI",COLORS.red);
 addLine(t1,"TP1",COLORS.green);addLine(t2,"TP2",COLORS.green);addLine(t3,"TP3",COLORS.green);
 addLine((buyLow+buyHigh)/2,"BUY RE-ENTRY ZONE",COLORS.green);
 addLine((sellLow+sellHigh)/2,"SELL RE-ENTRY ZONE",COLORS.red);
}

function historyRead(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");return Array.isArray(v)?v:[]}catch(e){return[]}}
function saveHistory(r){
 const key=[currentTF,mode,r.signal,Math.round(r.price*100),candles.at(-1).time].join("|");
 if(key===lastHistoryKey)return;lastHistoryKey=key;
 const rows=historyRead();rows.unshift({time:new Date().toISOString(),mode,tf:currentTF,signal:r.signal,strength:r.strength,price:r.price});
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(rows.slice(0,100)))}catch(e){console.warn("History storage unavailable",e)}
 renderHistory();
}
function renderHistory(){
 const body=$("historyBody");if(!body)return;
 const rows=historyRead();
 if(!rows.length){body.innerHTML='<tr><td colspan="6" class="empty">Belum ada rekod.</td></tr>';return}
 body.innerHTML=rows.map(x=>"<tr><td>"+new Date(x.time).toLocaleString()+"</td><td>"+String(x.mode).toUpperCase()+"</td><td>"+String(x.tf).toUpperCase()+"</td><td>"+String(x.signal)+"</td><td>"+Number(x.strength)+"%</td><td>"+fmt(Number(x.price))+"</td></tr>").join("");
}

function analyse(){
 const r=Analysis.analyse(candles,mode);
 if(!r.ready){clearAnalysis(r.reason);return}
 lastResult=r;
 const color=r.signal==="BUY"?COLORS.green:r.signal==="SELL"?COLORS.red:COLORS.gold;
 tx("aiSignal",r.signal,color);tx("signalStrength",r.strength+"% skor",color);
 tx("signalEMA",r.ema9>r.ema20?"EMA9 DI ATAS EMA20":"EMA9 DI BAWAH EMA20",r.ema9>r.ema20?COLORS.green:COLORS.red);
 tx("signalRSI",r.rsi.toFixed(2));tx("signalTF",currentTF.toUpperCase());
 tx("signalUpdated","KEMAS KINI "+new Date().toLocaleTimeString());
 const meter=$("signalMeterFill");if(meter){meter.style.width=r.strength+"%";meter.style.background=color}
 tx("structure",Analysis.structure(candles));tx("liquidity",Analysis.liquidity(candles));tx("fvg",Analysis.fvg(candles));tx("orderBlock",Analysis.orderBlock(candles));
 tx("premiumDiscount",Analysis.premiumDiscount(candles).label);
 tx("bosChoch",Analysis.structure(candles));tx("fvgDetail",Analysis.fvg(candles));tx("obDetail",Analysis.orderBlock(candles));tx("liqDetail",Analysis.liquidity(candles));
 const pd=Analysis.premiumDiscount(candles);
 tx("pdDetail",pd.label+" · titik tengah "+fmt(pd.mid));tx("atrDetail",fmt(r.atr));
 renderLevels(r);saveHistory(r);
}

function updateMtf(tf,r,age){
 const el=$(MTF_IDS[tf]);if(!el)return;
 if(!r||!r.ready){el.textContent="TIADA DATA";el.style.color=COLORS.gold;return}
 el.textContent=r.signal+" · "+r.strength+"%"+(age?" · "+age:"");
 el.style.color=r.signal==="BUY"?COLORS.green:r.signal==="SELL"?COLORS.red:COLORS.gold;
}
async function refreshMTF(){
 if(mtfLoading)return;mtfLoading=true;tx("mtfUpdated","SEDANG MENGAMBIL 7 DATA",COLORS.gold);let ok=0;
 try{
  for(const tf of Object.keys(TF)){
   try{const d=await queued(()=>Market.request(tf)),r=Analysis.analyse(d,mode);mtfCache[tf]={result:r,updatedAt:Date.now()};updateMtf(tf,r);ok++}
   catch(e){const c=mtfCache[tf];updateMtf(tf,c&&c.result,c?Math.round((Date.now()-c.updatedAt)/60000)+"m lalu":"");console.warn("MTF "+tf,e.message)}
  }
  tx("mtfUpdated",ok+"/7 DIKEMAS KINI · "+new Date().toLocaleTimeString());
 }finally{mtfLoading=false}
}

function modeDescription(){
 const m={
  scalping:"Mod scalping: bacaan jangka pendek berdasarkan trend dan momentum. Untuk pembelajaran carta sahaja.",
  intraday:"Mod intraday: memberi penekanan kepada penjajaran trend dan momentum sesi.",
  swing:"Mod swing: memerlukan penjajaran trend yang lebih ketat. H1/H4 sesuai untuk kajian timeframe lebih luas."
 };
 tx("modeDescription",m[mode]);
}
function between(h,s,e){return s<e?h>=s&&h<e:h>=s||h<e}
function updateSessions(){
 const now=new Date();
 const parts=(zone,opts)=>new Intl.DateTimeFormat("en-GB",{timeZone:zone,...opts}).format(now);
 const kl=parts("Asia/Kuala_Lumpur",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const kh=Number(parts("Asia/Kuala_Lumpur",{hour:"2-digit",hourCycle:"h23"}));
 const lh=Number(parts("Europe/London",{hour:"2-digit",hourCycle:"h23"}));
 const nh=Number(parts("America/New_York",{hour:"2-digit",hourCycle:"h23"}));
 const asia=between(kh,8,17),london=between(lh,8,17),ny=between(nh,8,17);
 tx("klTime",kl+" MYT");
 [["sessionAsia",asia],["newsAsia",asia],["sessionLondon",london],["newsLondon",london],["sessionNewYork",ny],["newsNY",ny]].forEach(([id,on])=>tx(id,on?"AKTIF":"DI LUAR WAKTU",on?COLORS.green:COLORS.muted));
}

function setupLanguage(){
 const translations={
  ms:{logout:"LOG KELUAR",refresh:"MUAT SEMULA",today:"Hari ini",tomorrow:"Esok",week:"Minggu ini",language:"Bahasa Melayu"},
  en:{logout:"LOGOUT",refresh:"REFRESH",today:"Today",tomorrow:"Tomorrow",week:"This week",language:"English"}
 };
 const apply=()=>{
  document.documentElement.lang=language==="en"?"en":"ms";
  document.querySelectorAll(".nav-btn").forEach(b=>{b.textContent=b.dataset[language]||b.dataset.ms});
  const active=document.querySelector(".nav-btn.active");
  if(active)tx("pageTitle",(active.dataset[language]||active.dataset.ms).replace(/^[◈⌁▣▤◉⚙]\s*/,""));
  tx("logoutButton",translations[language].logout);
  tx("refreshButton",translations[language].refresh);
  tx("languageStatus",translations[language].language);
  document.querySelectorAll("[data-calendar-filter]").forEach(b=>{
   const k=b.dataset.calendarFilter;b.textContent=translations[language][k]||k;
  });
  const btn=$("languageButton");if(btn)btn.textContent=language==="ms"?"EN":"BM";
 };
 $("languageButton")?.addEventListener("click",()=>{language=language==="ms"?"en":"ms";window.ADLI_LANG=language;apply()});
 apply();
}

function setupCalendar(){
 const date=new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",day:"2-digit",month:"short",year:"numeric"}).format(new Date());
 tx("calendarToday",date);tx("calendarCount","--");tx("calendarHigh","--");tx("calendarUpdated","--");
 document.querySelectorAll("[data-calendar-filter]").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("[data-calendar-filter]").forEach(x=>x.classList.toggle("active",x===b));
  calendarFilter=b.dataset.calendarFilter;
  tx("calendarMessage","Sumber kalendar ekonomi belum disambungkan. Penapis "+calendarFilter+" akan digunakan apabila feed kalendar sebenar disediakan.");
 }));
}

function setupControls(){
 document.querySelectorAll("[data-tf]").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("[data-tf]").forEach(x=>x.classList.toggle("active",x===b));
  Market.setTimeframe(b.dataset.tf);
 }));
 document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x===b));
  mode=b.dataset.mode;modeDescription();if(candles.length)analyse();
 }));
 $("refreshButton")?.addEventListener("click",()=>Market.fetch(currentTF));
 $("mtfRefresh")?.addEventListener("click",refreshMTF);
 $("clearHistory")?.addEventListener("click",()=>{
  if(confirm("Padam sejarah bacaan pada peranti ini?")){localStorage.removeItem(STORAGE_KEY);lastHistoryKey="";renderHistory()}
 });
}

function start(){
 if(started)return;started=true;
 Market.initChart();setupControls();setupLanguage();setupCalendar();modeDescription();renderHistory();updateSessions();
 setInterval(updateSessions,30000);
 Market.fetch(currentTF);
 setInterval(()=>Market.fetch(currentTF),REFRESH_MS);
 console.log("ADLI FX INTEL V4 PREMIUM READY");
}
window.ADLI_MARKET=Market;
window.ADLI_ANALYSIS=Analysis;
window.ADLI_APP={
 resizeChart:()=>Market.resize(),refresh:()=>Market.fetch(currentTF),refreshMTF,
 getTimeframe:()=>currentTF,getMode:()=>mode,getCandles:()=>Market.getCandles(),
 getPrice:()=>Market.getPrice(),getStatus:()=>Market.getStatus(),getError:()=>lastError,
 getMtfCache:()=>mtfCache
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
