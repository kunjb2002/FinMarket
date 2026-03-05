document.addEventListener("DOMContentLoaded", function () {

  const API_KEY = "S8FWB5CS0SYIZDT5";
  let SYMBOL = "SPY";

  let chart = null;
  let currentFunction = "TIME_SERIES_DAILY";

  loadChart(currentFunction);

  //Search Logic
  document.getElementById("searchBtn").addEventListener("click", () => {

    const input = document.getElementById("tickerInput").value.trim().toUpperCase();
    if (!input) return;
    SYMBOL = input;
    loadChart(currentFunction);

  });

  document.getElementById("tickerInput")
  .addEventListener("keypress", function(e){

    if(e.key === "Enter"){
      document.getElementById("searchBtn").click();
    }

  });

  document.getElementById("tickerTitle").innerText = SYMBOL;

  // Timeframe buttons
  document.querySelectorAll(".timeframe-controls button")
    .forEach(btn => {
      btn.addEventListener("click", function () {

        document.querySelectorAll(".timeframe-controls button")
          .forEach(b => b.classList.remove("active"));

        this.classList.add("active");

        const tf = this.dataset.time;

        if (tf === "DAILY") currentFunction = "TIME_SERIES_DAILY";
        if (tf === "WEEKLY") currentFunction = "TIME_SERIES_WEEKLY";
        if (tf === "MONTHLY") currentFunction = "TIME_SERIES_MONTHLY";

        loadChart(currentFunction);
      });
    });


  function loadChart(timeFunction) {

    fetch(`https://www.alphavantage.co/query?function=${timeFunction}&symbol=${SYMBOL}&apikey=${API_KEY}`)
      .then(res => res.json())
      .then(data => {

        const seriesKey = Object.keys(data).find(key =>
          key.includes("Time Series")
        );

        if (!seriesKey) {
          console.log(data);
          alert("API limit hit or invalid response.");
          return;
        }

        const timeSeries = data[seriesKey];

        const dates = Object.keys(timeSeries).slice(0, 100).reverse();

        const candleData = dates.map(date => ({
          x: new Date(date),
          o: parseFloat(timeSeries[date]["1. open"]),
          h: parseFloat(timeSeries[date]["2. high"]),
          l: parseFloat(timeSeries[date]["3. low"]),
          c: parseFloat(timeSeries[date]["4. close"])
        }));

        const closes = candleData.map(d => d.c);

        const ema20 = calculateEMA(closes, 20);
        const rsi14 = calculateRSI(closes, 14);

        updateKPIs(closes, ema20, rsi14);

        renderChart(candleData, ema20, rsi14);

      })
      .catch(err => console.error("Error fetching data:", err));
  }


  function updateKPIs(closes, ema, rsi) {

    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];

    const dailyChange = lastClose - prevClose;
    const dailyPercent = ((dailyChange / prevClose) * 100).toFixed(2);

    document.getElementById("kpiPrice").innerText = `$${lastClose.toFixed(2)}`;

    const changeElement = document.getElementById("kpiChange");
    changeElement.innerText = `${dailyChange.toFixed(2)} (${dailyPercent}%)`;

    changeElement.style.color = dailyChange >= 0 ? "#22c55e" : "#ef4444";

    document.getElementById("kpiEMA").innerText =
      ema[ema.length - 1]?.toFixed(2) || "--";

    document.getElementById("kpiRSI").innerText =
      rsi[rsi.length - 1]?.toFixed(2) || "--";
  }


  function renderChart(candleData, ema20, rsi14) {

    const ctx = document.getElementById("marketChart").getContext("2d");

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
      type: "candlestick",
      data: {
        datasets: [
          {
            label: "SPY",
            data: candleData,
            yAxisID: "y"
          },
          {
            type: "line",
            label: "20 EMA",
            data: ema20.map((val, i) => ({
              x: candleData[i].x,
              y: val
            })),
            borderColor: "#facc15",
            borderWidth: 2,
            hidden: false,
            yAxisID: "y"
          },
          {
            type: "line",
            label: "RSI (14)",
            data: rsi14.map((val, i) => ({
              x: candleData[i].x,
              y: val
            })),
            borderColor: "#ef4444",
            borderWidth: 2,
            hidden: true,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "time",
            ticks: { color: "white" }
          },
          y: {
            position: "right",
            ticks: { color: "white" }
          },
          y1: {
            position: "left",
            min: 0,
            max: 100,
            display: false,
            ticks: { color: "white" }
          }
        },
        plugins: {
          legend: {
            labels: { color: "white" }
          }
        }
      }
    });


    document.getElementById("toggleEMA").addEventListener("click", function () {
      this.classList.toggle("active");

      chart.data.datasets[1].hidden = !chart.data.datasets[1].hidden;
      chart.update();
    });

    document.getElementById("toggleRSI").addEventListener("click", function () {
      this.classList.toggle("active");

      chart.data.datasets[2].hidden = !chart.data.datasets[2].hidden;
      chart.options.scales.y1.display = !chart.options.scales.y1.display;
      chart.update();
    });

  }

});


// EMA
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0];
  let emaArray = [ema];

  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}


// RSI
function calculateRSI(data, period) {
  let gains = [];
  let losses = [];

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = average(gains.slice(0, period));
  let avgLoss = average(losses.slice(0, period));

  let rsi = [];

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }

  return Array(period).fill(null).concat(rsi);
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}