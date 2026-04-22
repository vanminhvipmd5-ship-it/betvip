const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

/* =========================
CACHE + HISTORY + STATS
========================= */
let cacheTX = null;
let cacheMD5 = null;
let history = [];
let countdown = 30;

let stats = { win: 0, lose: 0, total: 0 };
let lastPhien = null;

/* =========================
TIỆN ÍCH
========================= */
function entropyHex(h) {
  const freq = {};
  for (let c of h) freq[c] = (freq[c] || 0) + 1;
  const n = h.length;
  let e = 0;
  for (let k in freq) {
    let p = freq[k] / n;
    e -= p * Math.log2(p);
  }
  return e;
}

function bitDensity(md5) {
  const bits = BigInt("0x" + md5).toString(2).padStart(128, "0");
  return bits.split("1").length - 1;
}

function hexEnergy(md5) {
  return md5.split("").reduce((a, c) => a + parseInt(c, 16), 0);
}

function vote(v) {
  return Math.abs(parseInt(v)) % 2 === 0 ? "TAI" : "XIU";
}

/* =========================
FORMULA
========================= */
function f2(md5) {
  let a = parseInt(md5.slice(0, 8), 16);
  let b = parseInt(md5.slice(8, 16), 16);
  let c = parseInt(md5.slice(16, 24), 16);
  let d = parseInt(md5.slice(24), 16);
  return ((a ^ b) + (c & d) - (a | d)) ^ ((b + c) << (a & 3));
}

function f3(md5) {
  let x = parseInt(md5.slice(0, 16), 16);
  let y = parseInt(md5.slice(16), 16);
  return (x * y + (x ^ y)) & 0xffffffff;
}

function f4(md5) {
  let h = crypto.createHash("sha256").update(md5).digest("hex");
  return parseInt(h.slice(0, 16), 16);
}

function f5(md5) {
  let h = crypto.createHash("sha1").update(md5).digest("hex");
  return parseInt(h.slice(0, 12), 16);
}

function f6(md5) {
  return (
    parseInt(md5.slice(0, 8), 16) +
    parseInt(md5.slice(8, 16), 16)
  ) ^
  (
    parseInt(md5.slice(16, 24), 16) +
    parseInt(md5.slice(24), 16)
  );
}

function f7(md5) {
  return md5.split("").reduce((a, c) => a + Math.pow(parseInt(c,16),2), 0);
}

/* =========================
AI + CONFIDENCE
========================= */
function confidence(taiPct, xiuPct) {
  const diff = Math.abs(taiPct - xiuPct);
  if (diff < 5) return "LOW";
  if (diff < 15) return "MEDIUM";
  return "HIGH";
}

function predict(md5) {
  let tai = 0, xiu = 0;

  const formulas = [f2, f3, f4, f5, f6, f7];
  const algos = [
    entropyHex(md5)*100,
    bitDensity(md5),
    hexEnergy(md5)
  ];

  formulas.forEach(f=>{
    vote(f(md5)) === "TAI" ? tai+=2 : xiu+=2;
  });

  algos.forEach(a=>{
    vote(a) === "TAI" ? tai+=1 : xiu+=1;
  });

  let total = tai + xiu;
  let taiPct = ((tai/total)*100).toFixed(1);
  let xiuPct = (100 - taiPct).toFixed(1);
  let side = taiPct > xiuPct ? "TAI" : "XIU";
  let conf = confidence(taiPct, xiuPct);

  return {side, taiPct, xiuPct, conf};
}

/* =========================
TREND + WARNING
========================= */
function detectTrend(history) {
  if (history.length < 6) return "UNKNOWN";

  let last6 = history.slice(0,6).map(h=>h.ketqua);

  if (last6.every(v => v === last6[0])) return "CAU_BET";

  let zigzag = true;
  for (let i = 1; i < last6.length; i++) {
    if (last6[i] === last6[i-1]) zigzag = false;
  }

  if (zigzag) return "CAU_DAO";

  return "NORMAL";
}

function detectBreak(history, predictSide) {
  if (history.length < 3) return false;

  let last = history[0].ketqua;
  let prev = history[1].ketqua;

  if (last === prev && predictSide !== last) return true;

  return false;
}

/* =========================
BET SUGGEST
========================= */
function betSuggestion(conf, trend) {
  if (conf === "LOW") return "KHÔNG NÊN CHƠI";
  if (trend === "CAU_BET") return "ĐI NHẸ 1-2%";
  if (trend === "CAU_DAO") return "ĐI ĐỀU 2-3%";
  if (conf === "HIGH") return "CÓ THỂ TĂNG 3-5%";
  return "ĐI NHẸ";
}

/* =========================
AUTO FETCH
========================= */
setInterval(async () => {
  try {
    const tx = await axios.get("https://wtx.macminim6.online/v1/tx/lite-sessions");
    const md5 = await axios.get("https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions");

    cacheTX = tx.data;
    cacheMD5 = md5.data;

    let last = md5.data.list[0];

    let md5hash = crypto.createHash("md5")
      .update(last._id)
      .digest("hex");

    let kq = predict(md5hash);

    // history
    history.unshift({
      phien: last.id,
      md5: md5hash,
      du_doan: kq.side,
      ketqua: last.resultTruyenThong
    });

    if (history.length > 20) history.pop();

    // tránh đếm trùng
    if (last.id !== lastPhien) {
      lastPhien = last.id;

      const real = last.resultTruyenThong;
      const pred = kq.side;

      if (real && pred) {
        stats.total++;
        if (real === pred) stats.win++;
        else stats.lose++;
      }
    }

  } catch(e) {
    console.log("Fetch lỗi API");
  }
}, 1500);

/* =========================
COUNTDOWN
========================= */
setInterval(()=>{
  countdown--;
  if(countdown <= 0) countdown = 30;
},1000);

/* =========================
API
========================= */

// full
app.get("/all", (req, res) => {
  if (!cacheTX || !cacheMD5) {
    return res.json({ status: "loading" });
  }

  const thuong = cacheTX.list?.[0];
  const md5Last = cacheMD5.list?.[0];

  const md5hash = crypto.createHash("md5")
    .update(md5Last._id)
    .digest("hex");

  const kq = predict(md5hash);

  const trend = detectTrend(history);
  const breakCau = detectBreak(history, kq.side);
  const goiY = betSuggestion(kq.conf, trend);

  let rate = stats.total > 0
    ? ((stats.win / stats.total) * 100).toFixed(1)
    : 0;

  res.json({
    status: "ok",

    ban_thuong: {
      phien: thuong?.id,
      ketqua: thuong?.resultTruyenThong
    },

    ban_md5: {
      phien: md5Last?.id,
      md5: md5hash,
      ketqua_truoc: md5Last?.resultTruyenThong,
      du_doan: kq.side,
      tai: kq.taiPct + "%",
      xiu: kq.xiuPct + "%",
      do_tin_cay: kq.conf
    },

    canh_bao: {
      cau: trend,
      gay_cau: breakCau
    },

    goi_y: goiY,

    thong_ke: {
      win: stats.win,
      lose: stats.lose,
      total: stats.total,
      winrate: rate + "%"
    },

    countdown,
    history
  });
});

// stats riêng
app.get("/stats", (req,res)=>{
  let rate = stats.total > 0
    ? ((stats.win / stats.total) * 100).toFixed(1)
    : 0;

  res.json({
    win: stats.win,
    lose: stats.lose,
    total: stats.total,
    winrate: rate + "%"
  });
});

// reset stats
app.post("/reset-stats",(req,res)=>{
  stats = {win:0, lose:0, total:0};
  res.json({status:"reset ok"});
});

/* ========================= */
app.listen(PORT, ()=>{
  console.log("Server chạy tại http://localhost:" + PORT);
});
