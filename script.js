const DEV_MODE = true;

document.addEventListener("DOMContentLoaded", () => {

let SYMBOL = "SPY";
let chart;

const tickerTitle = document.getElementById("tickerTitle");
tickerTitle.innerText = SYMBOL;

// INITIAL LOAD
loadChart();

// SEARCH
document.getElementById("searchBtn").addEventListener("click", () => {

    const input = document.getElementById("tickerInput").value.trim().toUpperCase();
    if(!input) return;

    SYMBOL = input;
    tickerTitle.innerText = SYMBOL;

    loadChart();

});

document.getElementById("tickerInput").addEventListener("keypress", (e)=>{
    if(e.key === "Enter"){
        document.getElementById("searchBtn").click();
    }
});


async function loadChart(){

try{

let data;

if(DEV_MODE){

    const ticker = SYMBOL.toLowerCase();

    const response = await fetch(`data/${ticker}_daily.json`);

    if(!response.ok){
        alert("Mock data not found for this ticker");
        return;
    }

    data = await response.json();

}else{

    alert("API mode disabled for now");
    return;

}


// FIND TIME SERIES
const seriesKey = Object.keys(data).find(k => k.includes("Time Series"));

if(!seriesKey){
    console.log(data);
    alert("Invalid JSON structure");
    return;
}

const timeSeries = data[seriesKey];


// FORMAT DATA FOR CANDLESTICK
const dates = Object.keys(timeSeries).slice(0,100).reverse();

const candleData = dates.map(date => ({
    x: new Date(date),
    o: Number(timeSeries[date]["1. open"]),
    h: Number(timeSeries[date]["2. high"]),
    l: Number(timeSeries[date]["3. low"]),
    c: Number(timeSeries[date]["4. close"])
}));


const closes = candleData.map(d => d.c);


// INDICATORS
const ema20 = calculateEMA(closes,20);
const rsi14 = calculateRSI(closes,14);


// KPI UPDATE
updateKPIs(closes, ema20, rsi14);


// RENDER CHART
renderChart(candleData, ema20, rsi14);


}catch(err){

console.error("Chart load error:",err);

}

}


function renderChart(candleData, ema20, rsi14){

const ctx = document.getElementById("marketChart").getContext("2d");

if(chart) chart.destroy();

chart = new Chart(ctx,{
type:'candlestick',

data:{
datasets:[
{
label:SYMBOL,
data:candleData,
color:{
up:"#22c55e",
down:"#ef4444",
unchanged:"#999"
}
},
{
type:'line',
label:"EMA 20",
data:ema20.map((v,i)=>({x:candleData[i].x,y:v})),
borderColor:"#facc15",
borderWidth:2,
pointRadius:0
}
]
},

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
position:"right",
ticks:{color:"white"},
grid:{color:"rgba(255,255,255,0.05)"}
}
},

plugins:{
legend:{
labels:{color:"white"}
}
}

}

});

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



// EMA
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


// RSI
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