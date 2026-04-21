const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

// ====== CONFIG ======
const API_TX = "https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=9a4e64db2025423328fee4224ac389ff";
const API_MD5 = "https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=9a4e64db2025423328fee4224ac389ff";

// ====== ENGINE ======
let history = [];

// ====== BET STATE ======
let betState = {
  mode: "martingale", // "flat" | "martingale"
  base: 1,
  step: 0,
  current: 1,
  lastResult: null
};

// ====== CORE ======
function vote(v){
  return Math.abs(parseInt(v)) % 2 === 0 ? "TAI" : "XIU";
}

function predict(md5){
  const num = parseInt(md5.slice(0,8),16);
  const val = num ^ (num >> 3);

  let result = vote(val);

  let tai = history.filter(x=>x==="TAI").length;
  let xiu = history.filter(x=>x==="XIU").length;

  if(tai > xiu + 5) result = "XIU";
  if(xiu > tai + 5) result = "TAI";

  history.push(result);
  if(history.length > 40) history.shift();

  return result;
}

// ====== TREND ======
function detectTrend(list){
  let streak = 1, maxStreak = 1;
  let last = list[0];

  for(let i=1;i<list.length;i++){
    if(list[i] === list[i-1]){
      streak++;
      if(streak > maxStreak) maxStreak = streak;
    } else streak = 1;
  }

  return {
    cau_bet: maxStreak >= 4,
    do_dai: maxStreak,
    last: last
  };
}

// ====== REVERSE ======
function detectReverse(list){
  let streak = 1;

  for(let i=1;i<list.length;i++){
    if(list[i] === list[i-1]) streak++;
    else break;
  }

  if(streak >= 4){
    return {
      dao: true,
      goi_y: list[0] === "TAI" ? "XIU" : "TAI",
      do_dai: streak
    };
  }

  return { dao: false };
}

// ====== CONFIDENCE ======
function confidence(tai, xiu){
  let diff = Math.abs(tai - xiu);
  return Math.min(95, 50 + diff * 5);
}

// ====== BET ======
function calcBet(goi_y){
  if(betState.mode === "flat"){
    return {
      loai: "flat",
      muc_cuoc: betState.base,
      goi_y: goi_y
    };
  }

  if(betState.lastResult === "lose"){
    betState.step++;
    betState.current = betState.base * Math.pow(2, betState.step);
  } else {
    betState.step = 0;
    betState.current = betState.base;
  }

  // chống cháy
  if(betState.current > 64){
    betState.step = 0;
    betState.current = betState.base;
  }

  return {
    loai: "gap_thep",
    muc_cuoc: betState.current,
    step: betState.step,
    goi_y: goi_y
  };
}

// ====== API ======

app.get("/taixiu", async (req,res)=>{
  try{
    const {data} = await axios.get(API_TX);

    const list = data.list.map(i=>i.resultTruyenThong);
    const latest = data.list[0];

    const trend = detectTrend(list);
    const reverse = detectReverse(list);

    const finalSuggest = reverse.dao ? reverse.goi_y : trend.last;
    const bet = calcBet(finalSuggest);

    res.json({
      status: "ok",
      "@": "@vanminh2603",
      nguon: "TAI XIU THUONG",

      phien: latest.id,
      phien_raw: latest._id,

      ket_qua_moi_nhat: latest.resultTruyenThong,
      xuc_xac: latest.dices,
      tong: latest.point,

      ket_qua_gan_nhat: list.slice(0,10),

      thong_ke: data.typeStat,

      cau: trend.cau_bet ? `⚠️ Bệt ${trend.last} (${trend.do_dai})` : "Bình thường",

      cau_dao: reverse.dao 
        ? `🔁 Đảo → ${reverse.goi_y}` 
        : "Chưa có",

      goi_y: finalSuggest,
      goi_y_tien: bet,

      thang_thua: 0
    });

  }catch(e){
    res.json({error: "API lỗi"});
  }
});

app.get("/taixiumd5", async (req,res)=>{
  try{
    const {data} = await axios.get(API_MD5);

    let tai=0, xiu=0;
    let predictList = [];

    data.list.forEach(i=>{
      const md5 = crypto.createHash("md5")
        .update(i._id)
        .digest("hex");

      const kq = predict(md5);
      predictList.push(kq);

      if(kq==="TAI") tai++;
      else xiu++;
    });

    const latest = data.list[0];
    const md5_latest = crypto.createHash("md5")
      .update(latest._id)
      .digest("hex");

    const reverse = detectReverse(predictList);
    const side = tai > xiu ? "TAI" : "XIU";
    const finalSuggest = reverse.dao ? reverse.goi_y : side;

    const bet = calcBet(finalSuggest);

    res.json({
      status: "ok",
      "@": "@vanminh2603",
      nguon: "TAI XIU MD5",

      phien: latest.id,
      phien_raw: latest._id,
      md5: md5_latest,

      ket_qua_moi_nhat: latest.resultTruyenThong,
      tong: latest.point,

      du_doan: side,

      ti_le: {
        tai: tai,
        xiu: xiu
      },

      do_tin_cay: confidence(tai,xiu) + "%",

      cau_dao: reverse.dao 
        ? `🔁 Đảo → ${reverse.goi_y}` 
        : "Chưa có",

      goi_y: finalSuggest,
      goi_y_tien: bet,

      canh_bao: Math.abs(tai-xiu) > 5 
        ? "🔥 Lệch mạnh" 
        : "An toàn",

      thang_thua: 0
    });

  }catch(e){
    res.json({error: "API lỗi"});
  }
});

// ====== ROOT ======
app.get("/", (req,res)=>{
  res.json({
    api: ["/taixiu","/taixiumd5"],
    note: "API by @vanminh2603"
  });
});

app.listen(PORT, ()=>{
  console.log("🔥 Server chạy tại http://localhost:" + PORT);
});
