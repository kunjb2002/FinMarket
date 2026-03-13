let chart = null;
let rsiChart = null;
let volumeChart = null;

let showPrice = true;
let showEMA = true;
let showRSI = false;

let SYMBOL = "SPY";
let TIMEFRAME = "1M";

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

document.addEventListener("DOMContentLoaded", () => {

loadChart(SYMBOL);

document.getElementById("searchBtn").addEventListener("click", () => {

const input = document.getElementById("tickerInput").value.trim().toUpperCase();

if(!input) return;

SYMBOL = input;

document.getElementById("tickerTitle").innerText = SYMBOL;

loadChart(SYMBOL);

});

});

// BUTTON CONTROLS

document.getElementById("btnPrice").addEventListener("click", () => {

showPrice = !showPrice;
toggleActive("btnPrice",showPrice);
loadChart(SYMBOL);

});

document.getElementById("btnEMA").addEventListener("click", () => {

showEMA = !showEMA;
toggleActive("btnEMA",showEMA);
loadChart(SYMBOL);

});

document.getElementById("btnRSI").addEventListener("click", () => {

showRSI = !showRSI;
toggleActive("btnRSI",showRSI);
loadChart(SYMBOL);

});

// TIMEFRAME BUTTONS

document.querySelectorAll(".timeframe-controls button").forEach(btn => {

btn.addEventListener("click", () => {

document.querySelectorAll(".timeframe-controls button")
.forEach(b => b.classList.remove("active"));

btn.classList.add("active");

TIMEFRAME = btn.dataset.time;

loadChart(SYMBOL);

});

});


async function loadChart(symbol){

try{

// CHECK CACHE FIRST
const cachedData = getFromCache(symbol);

if(cachedData){

console.log("Loaded from cache");

processData(cachedData);

return;

}

// CALL API IF CACHE NOT FOUND
const url = `${CONFIG.BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${CONFIG.API_KEY}`;

const response = await fetch(url);

const data = await response.json();

if(data["Time Series (Daily)"]){

saveToCache(symbol,data);

processData(data);

}else{

// API failed → fallback to cache
const fallback = localStorage.getItem(getCacheKey(symbol));

if(fallback){

console.log("Using expired cache");

processData(JSON.parse(fallback).data);

}else{

alert("API limit reached and no cached data available.");

}

}

}catch(err){

console.error(err);

}

}



function renderChart(prices,ema,rsi,volume){

const ctx = document.getElementById("marketChart").getContext("2d");

if(chart) chart.destroy();

let datasets = [];

if(showPrice){

datasets.push({
label:"Price",
data:prices,
borderColor:"#38bdf8",
borderWidth:2,
pointRadius:0
});

}

if(showEMA){

datasets.push({
label:"EMA 20",
data:ema.map((v,i)=>({x:prices[i].x,y:v})),
borderColor:"#facc15",
borderWidth:2,
pointRadius:0
});

}

chart = new Chart(ctx,{

type:'line',

data:{datasets},

options:{

responsive:true,

interaction:{
mode:"index",
intersect:false
},

scales:{

x:{
type:"time",
ticks:{color:"white"},
grid:{color:"rgba(255,255,255,0.05)"}
},

y:{
ticks:{color:"white"},
grid:{color:"rgba(255,255,255,0.05)"}
}

},

plugins:{
legend:{display:false}
}

}

});

renderVolume(volume);
renderRSI(prices,rsi);

}



function updateKPIs(closes, ema, rsi){

const last = closes[closes.length-1];
const prev = closes[closes.length-2];

const change = last-prev;
const pct = ((change/prev)*100).toFixed(2);

document.getElementById("kpiPrice").innerText=`$${last.toFixed(2)}`;

const changeEl = document.getElementById("kpiChange");

changeEl.innerText=`${change.toFixed(2)} (${pct}%)`;

changeEl.style.color = change>=0 ? "#22c55e" : "#ef4444";

document.getElementById("kpiEMA").innerText =
ema[ema.length-1]?.toFixed(2) || "--";

document.getElementById("kpiRSI").innerText =
rsi[rsi.length-1]?.toFixed(2) || "--";

}



function calculateEMA(data,period){

const k = 2/(period+1);

let ema=data[0];
let result=[ema];

for(let i=1;i<data.length;i++){

ema=data[i]*k + ema*(1-k);

result.push(ema);

}

return result;

}



function calculateRSI(data,period){

let gains=[];
let losses=[];

for(let i=1;i<data.length;i++){

let diff=data[i]-data[i-1];

gains.push(diff>0?diff:0);
losses.push(diff<0?-diff:0);

}

let avgGain=average(gains.slice(0,period));
let avgLoss=average(losses.slice(0,period));

let rsi=[];

for(let i=period;i<gains.length;i++){

avgGain=(avgGain*(period-1)+gains[i])/period;
avgLoss=(avgLoss*(period-1)+losses[i])/period;

let rs=avgLoss===0?100:avgGain/avgLoss;

rsi.push(100-(100/(1+rs)));

}

return Array(period).fill(null).concat(rsi);

}

function average(arr){
return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function toggleActive(id,state){

const btn = document.getElementById(id);

if(state){
btn.classList.add("active");
}else{
btn.classList.remove("active");
}

}

function renderRSI(prices,rsi){

const canvas = document.getElementById("rsiChart");

if(!showRSI){

canvas.style.display="none";

if(rsiChart) rsiChart.destroy();

return;

}

canvas.style.display="block";

const ctx = canvas.getContext("2d");

if(rsiChart) rsiChart.destroy();

rsiChart = new Chart(ctx,{

type:'line',

data:{

datasets:[

{
label:"RSI 14",
data:rsi.map((v,i)=>({x:prices[i].x,y:v})),
borderColor:"#a855f7",
borderWidth:2,
pointRadius:0
}

]

},

options:{

responsive:true,

scales:{

x:{
type:"time",
display:false
},

y:{
min:0,
max:100,
ticks:{color:"white"},
grid:{color:"rgba(255,255,255,0.05)"}
}

},

plugins:{
legend:{display:false}
}

}

});

}

function getCacheKey(symbol) {
    return `stock_${symbol}`;
}

function saveToCache(symbol, data) {
    const cacheData = {
        timestamp: Date.now(),
        data: data
    };

    localStorage.setItem(getCacheKey(symbol), JSON.stringify(cacheData));
    console.log("Saved to cache:", symbol);
}

function getFromCache(symbol) {
    const cached = localStorage.getItem(getCacheKey(symbol));

    if (!cached) return null;

    const parsed = JSON.parse(cached);

    const age = Date.now() - parsed.timestamp;

    if (age > CACHE_DURATION) {
        return null;
    }

    return parsed.data;
}

function processData(data){

const timeSeries = data["Time Series (Daily)"];

let dates = Object.keys(timeSeries).reverse();

if(TIMEFRAME === "1D"){
dates = dates.slice(-1);
}
else if(TIMEFRAME === "1W"){
dates = dates.slice(-5);
}
else if(TIMEFRAME === "1M"){
dates = dates.slice(-22);
}
else if(TIMEFRAME === "1Y"){
dates = dates.slice(-252);
}

const prices = dates.map(date => ({
x:new Date(date),
y:Number(timeSeries[date]["4. close"])
}));

const volume = dates.map(date => ({
x:new Date(date),
y:Number(timeSeries[date]["5. volume"])
}));

const closes = prices.map(p => p.y);

const ema20 = calculateEMA(closes,20);

const rsi14 = calculateRSI(closes,14);

updateKPIs(closes,ema20,rsi14);

renderChart(prices,ema20,rsi14,volume);

}

function renderVolume(volume){

const ctx = document.getElementById("volumeChart").getContext("2d");

if(volumeChart) volumeChart.destroy();

volumeChart = new Chart(ctx,{

type:'bar',

data:{
datasets:[{
label:"Volume",
data:volume,
backgroundColor:"#64748b",
borderWidth:0
}]
},

options:{

responsive:true,

scales:{

x:{
type:"time",
display:false
},

y:{
ticks:{color:"white"},
grid:{color:"rgba(255,255,255,0.05)"}
}

},

plugins:{
legend:{display:false}
}

}

});

}