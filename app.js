/* =========================================================
 ADLI FX INTEL INDICATOR — ENGINE V3.1 PREMIUM
 Twelve Data + Supabase Edge Function + Lightweight Charts
 Educational, rule-based technical analysis. No ML claims.
========================================================= */
(function(){
"use strict";

const CONFIG=window.ADLI_CONFIG;
if(!CONFIG){console.error("ADLI V3.1: config.js missing.");return}

const FUNCTION_URL=String(CONFIG.SUPABASE_URL||"").replace(/\/$/,"")+"/functions/v1/market-data";
const API_KEY=CONFIG.SUPABASE_KEY;
const SYMBOL="XAU/USD";

const TIMEFRAMES={
 "1m":"1min","5m":"5min","15m":"15min","30m":"30min",
 "1h":"1h","4h":"4h","1d":"1day"
};

const MTF_IDS={
 "1m":"mtf1m","5m":"mtf5m","15m":"mtf15m","30m":"mtf30m",
 "1h":"mtf1h","4h":"mtf4h","1d":"mtf1d"
};

const REFRESH_MS=5*60*1000;
const REQUEST_GAP_MS=8000;
const STORAGE_KEY="adli_fx_analysis_history_v3";

let currentTF="5m";
let mode="scalping";
let candles=[];
let chart=null;
let candleSeries=null;
let resizeObserver=null;
let chartLoading=false;
let mtfLoading=false;
let started=false;
let lastRequestTime=0;
let queue=Promise.resolve();
let mtfCache={};
let lastError=null;
let levelLines=[];
let lastHistoryKey="";
let lastAnalysis=null;

const COLORS={
 gold:"#d9b45b",
 green:"#00c087",
 red:"#f6465d",
 muted:"#8492a6"
};

const $=id=>document.getElementById(id);

function text(id,value,color){
 const e=$(id);
 if(!e)return;
 e.textContent=value;
 if(color)e.style.color=color;
}

function sleep(ms){
 return new Promise(resolve=>setTimeout(resolve,ms));
}

function fmt(n){
 return Number.isFinite(n)?Number(n).toFixed(2):"--";
}

function queueRequest(task){
 const run=queue.then(async()=>{
  const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastRequestTime));
  if(wait)await sleep(wait);
  lastRequestTime=Date.now();
  return task();
 });
 queue=run.catch(()=>{});
 return run;
}

function event(status,error){
 window.dispatchEvent(new CustomEvent("adli:market-update",{
  detail:{
   status,
   symbol:SYMBOL,
   price:Market.price,
   candles,
   timeframe:currentTF,
   updatedAt:Market.lastUpdated,
   error:error||null
  }
 }));
}

function setStatusUI(){
 text(
  "goldPrice",
  Market.price==null?"--":fmt(Market.price)
 );

 text(
  "dataStatus",
  Market.status==="ERROR"?"ERROR":Market.status,
  Market.status==="CONNECTED"?COLORS.green:COLORS.gold
 );

 const empty=$("chartEmpty");

 if(empty){
  empty.style.display=candles.length?"none":"flex";
  if(!candles.length){
   empty.textContent=Market.error||"Waiting for market data...";
  }
 }

 if(candles.length>1){
  const a=candles.at(-1).close;
  const b=candles.at(-2).close;

  text(
   "marketTrend",
   a>b?"UP":a<b?"DOWN":"FLAT",
   a>b?COLORS.green:a<b?COLORS.red:COLORS.gold
  );
 }

 event(Market.status,Market.error);
}

const Market={
 status:"WAITING",
 price:null,
 lastUpdated:null,
 error:null,

 initChart(){
  const el=$("priceChart");
  if(!el)return;

  if(!window.LightweightCharts){
   this.status="ERROR";
   this.error="Chart library unavailable";
   setStatusUI();
   return;
  }

  if(chart)return;

  try{
   chart=LightweightCharts.createChart(el,{
    width:Math.max(300,el.clientWidth),
    height:Math.max(250,el.clientHeight),

    layout:{
     background:{color:"#101827"},
     textColor:"#8492a6"
    },

    grid:{
     vertLines:{color:"#1c293a"},
     horzLines:{color:"#1c293a"}
    },

    rightPriceScale:{borderColor:"#263247"},

    timeScale:{
     borderColor:"#263247",
     timeVisible:true,
     secondsVisible:false
    },

    crosshair:{mode:1},
    localization:{priceFormatter:fmt}
   });

   candleSeries=chart.addCandlestickSeries({
    upColor:COLORS.green,
    downColor:COLORS.red,
    borderUpColor:COLORS.green,
    borderDownColor:COLORS.red,
    wickUpColor:COLORS.green,
    wickDownColor:COLORS.red,
    priceLineVisible:true
   });

   if(window.ResizeObserver){
    resizeObserver=new ResizeObserver(()=>this.resizeChart());
    resizeObserver.observe(el);
   }

   window.addEventListener("resize",()=>this.resizeChart());

  }catch(e){
   this.status="ERROR";
   this.error="Chart: "+e.message;
   console.error(e);
   setStatusUI();
  }
 },

 convert(values){
  if(!Array.isArray(values))return[];

  return values.map(x=>{
   const raw=String(x.datetime||"").trim();
   const v=raw.replace(" ","T");
   let ms;

   if(/[zZ]|[+-]\d{2}:\d{2}$/.test(v)){
    ms=Date.parse(v);
   }else{
    ms=Date.parse(v+"Z");
   }

   return{
    time:Math.floor(ms/1000),
    open:+x.open,
    high:+x.high,
    low:+x.low,
    close:+x.close
   };

  }).filter(x=>
   Number.isFinite(x.time)&&
   [x.open,x.high,x.low,x.close].every(Number.isFinite)&&
   x.high>=x.low
  ).sort((a,b)=>a.time-b.time)
   .filter((x,i,a)=>!i||x.time!==a[i-1].time);
 },

 async request(tf){
  if(!TIMEFRAMES[tf]){
   throw Error("Invalid timeframe: "+tf);
  }

  if(CONFIG.MARKET_DATA_ENABLED===false){
   throw Error("Market data disabled in config.js");
  }

  if(!FUNCTION_URL||!API_KEY){
   throw Error("Supabase configuration missing");
  }

  const q=new URLSearchParams({
   symbol:SYMBOL,
   interval:TIMEFRAMES[tf]
  });

  const res=await fetch(FUNCTION_URL+"?"+q.toString(),{
   method:"GET",
   headers:{apikey:API_KEY}
  });

  let data;

  try{
   data=await res.json();
  }catch(e){
   throw Error("Invalid JSON response. HTTP "+res.status);
  }

  if(!res.ok){
   throw Error(
    "HTTP "+res.status+": "+
    (data.error||data.message||"Request failed")
   );
  }

  if(data.success!==true){
   throw Error(
    data.error||data.message||"Provider did not return success"
   );
  }

  const converted=this.convert(data.values);

  if(converted.length<20){
   throw Error(
    "Insufficient candles: "+converted.length+" received; 20 required"
   );
  }

  return converted;
 },

 async fetch(tf=currentTF){
  if(chartLoading)return;

  chartLoading=true;
  this.status=candles.length?"UPDATING":"LOADING";
  this.error=null;
  setStatusUI();

  try{
   const received=await queueRequest(()=>this.request(tf));

   candles=received;
   currentTF=tf;
   this.price=candles.at(-1).close;
   this.lastUpdated=new Date();

   this.status="CONNECTED";
   this.error=null;
   lastError=null;

   if(candleSeries&&chart){
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
   }

   analyseCurrent();
   setStatusUI();

   console.log("ADLI V3.1 market update",{
    tf,
    count:candles.length,
    price:this.price
   });

  }catch(e){
   this.status="ERROR";
   this.error=e.message;
   lastError=e.message;

   clearAnalysis("DATA ERROR — ANALYSIS PAUSED");
   console.error("ADLI MARKET ERROR",e);

  }finally{
   chartLoading=false;
   setStatusUI();
  }
 },

 setTimeframe(tf){
  if(!TIMEFRAMES[tf])return;
  currentTF=tf;
  this.fetch(tf);
 },

 resizeChart(){
  const el=$("priceChart");

  if(chart&&el&&el.clientWidth&&el.clientHeight){
   chart.applyOptions({
    width:el.clientWidth,
    height:el.clientHeight
   });
  }
 },

 getCandles(){return candles},
 getPrice(){return this.price},
 getStatus(){return this.status}
};

const Analysis={

 ema(v,p){
  if(!Array.isArray(v)||v.length<p)return null;

  const k=2/(p+1);
  let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p;

  for(let i=p;i<v.length;i++){
   e=(v[i]-e)*k+e;
  }

  return e;
 },

 rsi(v,p=14){
  if(v.length<=p)return null;

  let g=0,l=0;

  for(let i=1;i<=p;i++){
   const d=v[i]-v[i-1];
   if(d>0)g+=d;
   else l-=d;
  }

  g/=p;
  l/=p;

  for(let i=p+1;i<v.length;i++){
   const d=v[i]-v[i-1];
   g=(g*(p-1)+Math.max(d,0))/p;
   l=(l*(p-1)+Math.max(-d,0))/p;
  }

  return l===0?(g===0?50:100):100-100/(1+g/l);
 },

 atr(d,p=14){
  if(d.length<=p)return null;

  const r=[];

  for(let i=1;i<d.length;i++){
   const c=d[i];
   const b=d[i-1];

   r.push(Math.max(
    c.high-c.low,
    Math.abs(c.high-b.close),
    Math.abs(c.low-b.close)
   ));
  }

  return r.slice(-p).reduce((a,b)=>a+b,0)/p;
 },

 analyse(d,selectedMode=mode){
  if(!Array.isArray(d)||d.length<30){
   return{
    ready:false,
    signal:"WAIT",
    strength:0,
    reason:"Need at least 30 candles"
   };
  }

  const c=d.map(x=>x.close);
  const ema9=this.ema(c,9);
  const ema20=this.ema(c,20);
  const ema50=this.ema(c,Math.min(50,d.length-1));
  const rsi=this.rsi(c);
  const atr=this.atr(d);

  if([ema9,ema20,rsi,atr].some(x=>
   x==null||!Number.isFinite(x)
  )){
   return{
    ready:false,
    signal:"WAIT",
    strength:0,
    reason:"Indicator calculation unavailable"
   };
  }

  let score=0;

  if(ema9>ema20)score+=2;
  else if(ema9<ema20)score-=2;

  if(c.at(-1)>ema20)score++;
  else if(c.at(-1)<ema20)score--;

  if(rsi>54&&rsi<72)score++;
  else if(rsi<46&&rsi>28)score--;

  if(ema20>ema50)score++;
  else if(ema20<ema50)score--;

  const threshold=
   selectedMode==="scalping"?3:
   selectedMode==="intraday"?3:4;

  const signal=
   score>=threshold?"UPWARD BIAS":
   score<=-threshold?"DOWNWARD BIAS":
   "NEUTRAL";

  return{
   ready:true,
   signal,
   strength:Math.min(100,Math.round(Math.abs(score)/5*100)),
   score,
   ema9,
   ema20,
   ema50,
   rsi,
   atr,
   price:c.at(-1),
   data:d
  };
 },

 structure(d){
  if(d.length<12)return"INSUFFICIENT DATA";

  const x=d.slice(-12);

  const h1=Math.max(...x.slice(0,6).map(z=>z.high));
  const h2=Math.max(...x.slice(6).map(z=>z.high));
  const l1=Math.min(...x.slice(0,6).map(z=>z.low));
  const l2=Math.min(...x.slice(6).map(z=>z.low));

  if(h2>h1&&l2>l1)return"HIGHER HIGH / HIGHER LOW";
  if(h2<h1&&l2<l1)return"LOWER HIGH / LOWER LOW";

  return"RANGE / MIXED";
 },

 liquidity(d){
  if(d.length<12)return"INSUFFICIENT DATA";

  const last=d.at(-1);
  const prev=d.slice(-11,-1);

  const hi=Math.max(...prev.map(x=>x.high));
  const lo=Math.min(...prev.map(x=>x.low));

  if(last.high>hi&&last.close<hi){
   return"UPPER LIQUIDITY REJECTION";
  }

  if(last.low<lo&&last.close>lo){
   return"LOWER LIQUIDITY REJECTION";
  }

  return"NO RECENT SWEEP DETECTED";
 },

 fvg(d){
  if(d.length<3)return"INSUFFICIENT DATA";

  const a=d.at(-3);
  const c=d.at(-1);

  if(c.low>a.high){
   return"BULLISH GAP · "+fmt(a.high)+"–"+fmt(c.low);
  }

  if(c.high<a.low){
   return"BEARISH GAP · "+fmt(c.high)+"–"+fmt(a.low);
  }

  return"NO 3-CANDLE GAP";
 },

 orderBlock(d){
  if(d.length<5)return"INSUFFICIENT DATA";

  const last=d.at(-1);
  const prev=d.at(-2);

  if(last.close>prev.high)return"BULLISH BREAK PROXY";
  if(last.close<prev.low)return"BEARISH BREAK PROXY";

  return"NO BREAK CONFIRMATION";
 },

 premiumDiscount(d){
  const x=d.slice(-30);

  const hi=Math.max(...x.map(z=>z.high));
  const lo=Math.min(...x.map(z=>z.low));
  const mid=(hi+lo)/2;
  const p=d.at(-1).close;

  return{
   label:p>mid?"PREMIUM HALF":
         p<mid?"DISCOUNT HALF":"RANGE MIDPOINT",
   high:hi,
   low:lo,
   mid
  };
 }
};

function modeInfo(){
 const descriptions={
  scalping:"Scalping view: short-horizon indicator weighting. This is an educational reading, not a trade instruction.",
  intraday:"Intraday view: trend alignment and momentum are weighted for a broader session view.",
  swing:"Swing view: stricter trend alignment is required; consider switching to H1 or H4 for study."
 };

 text("modeDescription",descriptions[mode]);
}

function clearLines(){
 if(!candleSeries)return;

 levelLines.forEach(line=>{
  try{candleSeries.removePriceLine(line)}catch(e){}
 });

 levelLines=[];
}

function drawLevels(r){
 clearLines();

 if(!candleSeries||!r||!r.ready)return;

 const pd=Analysis.premiumDiscount(candles);

 const values=[
  {price:r.price,title:"Reference",color:COLORS.gold},
  {price:r.price-r.atr*1.5,title:"Lower study band",color:COLORS.red},
  {price:r.price+r.atr,title:"Study +1 ATR",color:COLORS.green},
  {price:r.price+r.atr*2,title:"Study +2 ATR",color:COLORS.green},
  {price:pd.mid,title:"Range midpoint",color:"#8092aa"}
 ];

 values.forEach(v=>{
  if(!Number.isFinite(v.price))return;

  levelLines.push(
   candleSeries.createPriceLine({
    price:v.price,
    color:v.color,
    lineWidth:1,
    lineStyle:2,
    axisLabelVisible:true,
    title:v.title
   })
  );
 });
}

function historyRead(){
 try{
  const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
  return Array.isArray(v)?v:[];
 }catch(e){
  return[];
 }
}

function saveHistory(r){
 if(!r||!r.ready)return;

 const key=[
  currentTF,
  mode,
  r.signal,
  Math.round(r.price*100),
  candles.at(-1).time
 ].join("|");

 if(key===lastHistoryKey)return;

 lastHistoryKey=key;

 const rows=historyRead();

 rows.unshift({
  time:new Date().toISOString(),
  mode,
  tf:currentTF,
  signal:r.signal,
  strength:r.strength,
  price:r.price
 });

 try{
  localStorage.setItem(
   STORAGE_KEY,
   JSON.stringify(rows.slice(0,100))
  );
 }catch(e){
  console.warn("History storage unavailable",e);
 }

 renderHistory();
}

function renderHistory(){
 const body=$("historyBody");
 if(!body)return;

 const rows=historyRead();

 if(!rows.length){
  body.innerHTML='<tr><td colspan="6" class="empty">No analysis records yet.</td></tr>';
  return;
 }

 body.innerHTML=rows.map(x=>{
  const d=new Date(x.time);

  return"<tr>"+
   "<td>"+d.toLocaleString()+"</td>"+
   "<td>"+String(x.mode).toUpperCase()+"</td>"+
   "<td>"+String(x.tf).toUpperCase()+"</td>"+
   "<td>"+String(x.signal)+"</td>"+
   "<td>"+Number(x.strength)+"%</td>"+
   "<td>"+fmt(Number(x.price))+"</td>"+
   "</tr>";
 }).join("");
}

function clearAnalysis(reason){
 text("aiSignal","WAIT",COLORS.gold);
 text("signalStrength",reason||"WAITING",COLORS.gold);

 [
  "signalEMA","signalRSI","entry","stopLoss",
  "tp1","tp2","tp3","structure","liquidity",
  "fvg","orderBlock","premiumDiscount"
 ].forEach(id=>text(id,"--"));

 text("signalTF",currentTF.toUpperCase());
 text("signalUpdated","PAUSED");

 const m=$("signalMeterFill");

 if(m)m.style.width="0%";

 clearLines();
 lastAnalysis=null;
}

function analyseCurrent(){
 const r=Analysis.analyse(candles,mode);

 if(!r.ready){
  clearAnalysis(r.reason);
  return;
 }

 lastAnalysis=r;

 const color=
  r.signal==="UPWARD BIAS"?COLORS.green:
  r.signal==="DOWNWARD BIAS"?COLORS.red:
  COLORS.gold;

 text("aiSignal",r.signal,color);
 text("signalStrength",r.strength+"% score",color);

 text(
  "signalEMA",
  r.ema9>r.ema20?"EMA9 ABOVE EMA20":"EMA9 BELOW EMA20",
  r.ema9>r.ema20?COLORS.green:COLORS.red
 );

 text("signalRSI",r.rsi.toFixed(2));
 text("signalTF",currentTF.toUpperCase());

 text(
  "signalUpdated",
  "UPDATED "+new Date().toLocaleTimeString()
 );

 const m=$("signalMeterFill");

 if(m){
  m.style.width=r.strength+"%";
  m.style.background=color;
 }

 text("structure",Analysis.structure(candles));
 text("liquidity",Analysis.liquidity(candles));
 text("fvg",Analysis.fvg(candles));
 text("orderBlock",Analysis.orderBlock(candles));

 const pd=Analysis.premiumDiscount(candles);

 text("premiumDiscount",pd.label);
 text("bosChoch",Analysis.structure(candles));
 text("fvgDetail",Analysis.fvg(candles));
 text("obDetail",Analysis.orderBlock(candles));
 text("liqDetail",Analysis.liquidity(candles));
 text("pdDetail",pd.label+" · midpoint "+fmt(pd.mid));
 text("atrDetail",fmt(r.atr));

 text("entry",fmt(r.price));
 text("stopLoss",fmt(r.price-r.atr*1.5),COLORS.red);
 text("tp1",fmt(r.price+r.atr),COLORS.green);
 text("tp2",fmt(r.price+r.atr*2),COLORS.green);
 text("tp3",fmt(r.price+r.atr*3),COLORS.green);

 drawLevels(r);
 saveHistory(r);
}

function updateMtf(tf,r,age){
 const el=$(MTF_IDS[tf]);
 if(!el)return;

 if(!r||!r.ready){
  el.textContent="NO DATA";
  el.style.color=COLORS.gold;
  return;
 }

 el.textContent=
  r.signal+" · "+r.strength+"%"+(age?" · "+age:"");

 el.style.color=
  r.signal==="UPWARD BIAS"?COLORS.green:
  r.signal==="DOWNWARD BIAS"?COLORS.red:
  COLORS.gold;
}

async function refreshMTF(){
 if(mtfLoading)return;

 mtfLoading=true;
 text("mtfUpdated","FETCHING · 7 REQUESTS",COLORS.gold);

 let ok=0;

 try{
  for(const tf of Object.keys(TIMEFRAMES)){
   try{
    const d=await queueRequest(()=>Market.request(tf));
    const r=Analysis.analyse(d,mode);

    mtfCache[tf]={
     result:r,
     updatedAt:Date.now()
    };

    updateMtf(tf,r);
    ok++;

   }catch(e){
    const c=mtfCache[tf];

    updateMtf(
     tf,
     c&&c.result,
     c?Math.round((Date.now()-c.updatedAt)/60000)+"m old":""
    );

    console.warn("ADLI MTF "+tf+" error:",e.message);
   }
  }

  text(
   "mtfUpdated",
   ok+"/7 UPDATED · "+new Date().toLocaleTimeString()
  );

 }finally{
  mtfLoading=false;
 }
}

function setupControls(){
 document.querySelectorAll("[data-tf]").forEach(b=>{
  b.addEventListener("click",()=>{
   document.querySelectorAll("[data-tf]").forEach(x=>{
    x.classList.toggle("active",x===b);
   });

   Market.setTimeframe(b.dataset.tf);
  });
 });

 document.querySelectorAll("[data-mode]").forEach(b=>{
  b.addEventListener("click",()=>{
   document.querySelectorAll("[data-mode]").forEach(x=>{
    x.classList.toggle("active",x===b);
   });

   mode=b.dataset.mode;
   modeInfo();

   if(candles.length)analyseCurrent();
  });
 });

 $("refreshButton")?.addEventListener("click",()=>{
  Market.fetch(currentTF);
 });

 $("mtfRefresh")?.addEventListener("click",refreshMTF);

 $("clearHistory")?.addEventListener("click",()=>{
  if(confirm("Clear analysis history stored on this device?")){
   localStorage.removeItem(STORAGE_KEY);
   lastHistoryKey="";
   renderHistory();
  }
 });
}

function isBetween(h,start,end){
 return start<end?
  h>=start&&h<end:
  h>=start||h<end;
}

function updateSessions(){
 const now=new Date();

 const parts=new Intl.DateTimeFormat("en-GB",{
  timeZone:"Asia/Kuala_Lumpur",
  hour:"2-digit",
  minute:"2-digit",
  hourCycle:"h23"
 }).format(now);

 const kHour=Number(new Intl.DateTimeFormat("en-GB",{
  timeZone:"Asia/Kuala_Lumpur",
  hour:"2-digit",
  hourCycle:"h23"
 }).format(now));

 const londonParts=new Intl.DateTimeFormat("en-GB",{
  timeZone:"Europe/London",
  hour:"2-digit",
  hourCycle:"h23"
 }).format(now);

 const nyParts=new Intl.DateTimeFormat("en-GB",{
  timeZone:"America/New_York",
  hour:"2-digit",
  hourCycle:"h23"
 }).format(now);

 const lh=Number(londonParts);
 const nh=Number(nyParts);

 const asia=isBetween(kHour,8,17);
 const london=isBetween(lh,8,17);
 const ny=isBetween(nh,8,17);

 text("klTime",parts+" MYT");

 text(
  "sessionAsia",
  asia?"ACTIVE":"OUTSIDE WINDOW",
  asia?COLORS.green:COLORS.muted
 );

 text(
  "sessionLondon",
  london?"ACTIVE":"OUTSIDE WINDOW",
  london?COLORS.green:COLORS.muted
 );

 text(
  "sessionNewYork",
  ny?"ACTIVE":"OUTSIDE WINDOW",
  ny?COLORS.green:COLORS.muted
 );

 text("newsAsia",asia?"ACTIVE":"INACTIVE",asia?COLORS.green:COLORS.muted);
 text("newsLondon",london?"ACTIVE":"INACTIVE",london?COLORS.green:COLORS.muted);
 text("newsNY",ny?"ACTIVE":"INACTIVE",ny?COLORS.green:COLORS.muted);
}

function start(){
 if(started)return;

 started=true;

 Market.initChart();
 setupControls();
 modeInfo();
 renderHistory();
 updateSessions();

 setInterval(updateSessions,30000);

 Market.fetch(currentTF);

 setInterval(()=>{
  Market.fetch(currentTF);
 },REFRESH_MS);

 console.log("ADLI FX INTEL ENGINE V3.1 PREMIUM READY");
}

window.ADLI_MARKET=Market;
window.ADLI_ANALYSIS=Analysis;

window.ADLI_APP={
 resizeChart:()=>Market.resizeChart(),
 refresh:()=>Market.fetch(currentTF),
 refreshMTF,
 getTimeframe:()=>currentTF,
 getMode:()=>mode,
 getCandles:()=>Market.getCandles(),
 getPrice:()=>Market.getPrice(),
 getStatus:()=>Market.getStatus(),
 getError:()=>lastError,
 getMtfCache:()=>mtfCache
};

if(document.readyState==="loading"){
 document.addEventListener("DOMContentLoaded",start,{once:true});
}else{
 start();
}

})();
