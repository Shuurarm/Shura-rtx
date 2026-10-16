import HTML from "./index.html";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json;charset=utf-8" } });
const page = (b, s = 200) => new Response(b, { status: s, headers: { "Content-Type": "text/html;charset=utf-8" } });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => Number(n || 0).toLocaleString("en-US");
const TT = /https?:\/\/(?:[\w-]+\.)?tiktok\.com\/[^\s]+/i;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const abs = (u) => (!u ? "" : u.startsWith("http") ? u : "https://www.tikwm.com" + u);
const firstUrl = (pa) => {
  if (!pa) return "";
  if (typeof pa === "string") return pa.startsWith("http") ? pa : "";
  const list = pa.UrlList || pa.url_list || pa.urlList || [];
  return list.find((x) => typeof x === "string" && x.startsWith("http")) || "";
};

// IDs verificados de tgmacicons_ids.json (paquete: tgmacicons)
const TG_ICONS = {
  video:      ["5258077307985207053", "📹"],
  music:      ["5258289810082111221", "🎵"],
  camera:     ["5258205968025525531", "📸"],
  calendar:   ["5258105663359294787", "🗓"],
  views:      ["5253959125838090076", "👁"],
  likes:      ["5258179403652801593", "❤️"],
  comments:   ["5258215846450305872", "💬"],
  favorites:  ["5258185631355378853", "⭐️"],
  shares:     ["5260450573768990626", "➡️"],
  downloads:  ["5258336354642697821", "⬇️"],
  er:         ["5258391025281408576", "📈"],
  info:       ["5258503720928288433", "ℹ️"],
  id:         ["5258514780469075716", "🗂"],
  source:     ["5260730055880876557", "🔗"],
  region:     ["5258509201306557640", "📍"],
  quality:    ["5260412365739925015", "⭐️"],
  technical:  ["5258096772776991776", "⚙"],
  package:    ["5258134813302332906", "📦"],
  timer:      ["5258258882022612173", "⏲"],
  color:      ["5258450450448915742", "🎨"],
  visibility: ["5260341314095947411", "👀"],
  lock:       ["5258476306152038031", "🔒"],
  verified:   ["5260726538302660868", "✅"],
  bot:        ["5258093637450866522", "🤖"],
  ad:         ["5260268501515377807", "📣"],
  tag:        ["5296348778012361146", "🏷"],
  tips:       ["5258216851472654189", "💡"],
  bolt:       ["5258152182150077732", "⚡️"],
  user:       ["5258362837411045098", "👤"],
  users:      ["5258513401784573443", "👥"],
  photo:      ["5258050709252743821", "🖼"],
  search:     ["5429571366384842791", "🔎"],
  clock:      ["5258419835922030550", "🕔"],
};

const ce = (key, html = true) => {
  const item = TG_ICONS[key];
  if (!item) return "";
  return html ? `<tg-emoji emoji-id="${item[0]}">${item[1]}</tg-emoji>` : item[1];
};

const MEM_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  if (!key) return null;
  const hit = MEM_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    MEM_CACHE.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(d) {
  const now = Date.now();
  if (d?.id) MEM_CACHE.set(`id:${d.id}`, { ts: now, data: d });
  if (d?.url) MEM_CACHE.set(`url:${d.url}`, { ts: now, data: d });
}

async function resolveUrl(u) {
  if (/\/(video|photo)\/\d+/.test(u)) return u;
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(4000) });
    return r.url || u;
  } catch { return u; }
}

async function scrape(u) {
  const r = await fetch(u, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(6000),
  });
  const cookie = (r.headers.get("set-cookie") || "").split(/,(?=[^;]+=[^;]+)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const t = await r.text();
  const m = t.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("TikTok no devolvió datos embebidos");
  const it = JSON.parse(m[1]).__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!it) throw new Error("itemStruct no encontrado");
  if (cookie) it._cookie = cookie;
  return it;
}

async function tikwmOnce(u, get) {
  const r = get
    ? await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`, { headers: { "User-Agent": UA, "Referer": "https://www.tikwm.com/" }, signal: AbortSignal.timeout(5000) })
    : await fetch("https://www.tikwm.com/api/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Referer": "https://www.tikwm.com/" },
        body: new URLSearchParams({ url: u, hd: "1" }),
        signal: AbortSignal.timeout(5000),
      });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || "TikWM error");
  return j.data;
}
async function tikwm(u) {
  try { return await tikwmOnce(u, false); }
  catch (e) {
    if (/limit/i.test(e.message)) await new Promise((r) => setTimeout(r, 1200));
    return await tikwmOnce(u, true);
  }
}

const baseRes = (s) => { const r = Math.min(s.w, s.h); return r >= 2160 ? "4K" : r >= 1440 ? "2K" : r + "p"; };
const resLabel = (s) => baseRes(s) + (s.fps || "");

const MOBILE_UA = "com.zhiliaoapp.musically/2023009040 (Linux; U; Android 9; en_US; ASUS_Z01QD; Build/PI; tt-ok/3.12.13.4-tiktok)";
const videoId = (u) => (String(u).match(/\/(?:video|photo|v)\/(\d+)/) || String(u).match(/[?&]item_id=(\d+)/) || [])[1];
async function mobile(id) {
  const hosts = [
    "https://api16-normal-c-useast1a.tiktokv.com",
    "https://api22-normal-c-alisg.tiktokv.com",
    "https://api16-normal-c-alisg.tiktokv.com",
    "https://api16-normal-useast5.us.tiktokv.com",
  ];
  const q = new URLSearchParams({
    aweme_id: id, iid: "7318518857994389254", device_id: "7318517321748022790",
    channel: "googleplay", app_name: "musical_ly", version_code: "300904",
    device_platform: "android", device_type: "ASUS_Z01QD", os_version: "9", aid: "1180",
  });
  let lastErr = new Error("API móvil sin datos");
  for (const h of hosts) {
    try {
      const r = await fetch(`${h}/aweme/v1/feed/?${q}`, { headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      const a = (j.aweme_list || []).find((x) => String(x.aweme_id) === String(id));
      if (a && a.video) return a.video;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function parseMp4Meta(buf) {
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
    let bestFps = null, bestDur = 0, ghostFrames = false, vfr = false, color = "SDR (8-bit)";
    const walk = (start, end, ctx) => {
      let p = start;
      while (p + 8 <= end) {
        let sz = dv.getUint32(p);
        const t = tag(p + 4);
        let hdr = 8;
        if (sz === 1) {
          if (p + 16 > end) break;
          sz = Number(dv.getBigUint64(p + 8));
          hdr = 16;
        } else if (sz === 0) {
          sz = end - p;
        }
        if (sz < hdr) break;
        const isCont = t === "trak" || containers.has(t);
        if (!isCont && p + sz > end) break;
        const body = p + hdr, next = Math.min(p + sz, end);
        if (t === "trak") {
          const tc = {
            isVideo: false, timescale: 0, dur: 0,
            sttsSamples: 0, sttsDelta: 0, domDelta: 0, domCount: 0,
            sttsEntries: 0, nonDomSamples: 0, stszSamples: 0, tinySamples: 0,
          };
          walk(body, next, tc);
          if (tc.isVideo && tc.timescale > 0) {
            if (tc.dur > 0) bestDur = Math.max(bestDur, tc.dur / tc.timescale);
            let rawFps = 0;
            if (tc.sttsSamples > 0 && tc.sttsDelta > 0) rawFps = (tc.sttsSamples * tc.timescale) / tc.sttsDelta;
            else if (tc.domDelta > 0) rawFps = tc.timescale / tc.domDelta;
            else if (tc.dur > 0 && tc.stszSamples > 0) rawFps = (tc.stszSamples * tc.timescale) / tc.dur;

            if (tc.tinySamples > 10 || rawFps > 130) {
              ghostFrames = true;
              if (tc.domDelta > 0) {
                const domFps = Math.round(tc.timescale / tc.domDelta);
                if (domFps >= 1 && domFps <= 120) rawFps = domFps;
              }
            }
            if (tc.sttsEntries > 3 && tc.sttsSamples > 0 && (tc.nonDomSamples / tc.sttsSamples) > 0.15 && !ghostFrames) {
              vfr = true;
            }
            const r = Math.round(rawFps);
            if (r >= 1 && r <= 240) bestFps = Math.max(bestFps || 0, r);
          }
        } else if (containers.has(t)) {
          walk(body, next, ctx);
        } else if (ctx) {
          if (t === "vmhd") ctx.isVideo = true;
          else if (t === "hdlr" && body + 12 <= next && tag(body + 8) === "vide") ctx.isVideo = true;
          else if (t === "mdhd" && body + 20 <= next) {
            const ver = u8[body];
            if (ver === 0 && body + 20 <= next) { ctx.timescale = dv.getUint32(body + 12); ctx.dur = dv.getUint32(body + 16); }
            else if (ver === 1 && body + 28 <= next) { ctx.timescale = dv.getUint32(body + 20); ctx.dur = Number(dv.getBigUint64(body + 24)); }
          } else if (t === "stts" && body + 8 <= next) {
            const count = dv.getUint32(body + 4);
            ctx.sttsEntries = count;
            let q = body + 8;
            const deltas = [];
            for (let i = 0; i < count && i < 5000 && q + 8 <= next; i++, q += 8) {
              const sc = dv.getUint32(q), sd = dv.getUint32(q + 4);
              if (sc > 0 && sd > 0) {
                ctx.sttsSamples += sc;
                ctx.sttsDelta += sc * sd;
                deltas.push([sc, sd]);
                if (sc > ctx.domCount) { ctx.domCount = sc; ctx.domDelta = sd; }
              }
            }
            for (const [sc, sd] of deltas) {
              if (Math.abs(sd - ctx.domDelta) > 1) ctx.nonDomSamples += sc;
            }
          } else if (t === "stsz" && body + 12 <= next) {
            const sampleSize = dv.getUint32(body + 4);
            const count = dv.getUint32(body + 8);
            ctx.stszSamples = count;
            if (sampleSize === 0) {
              let q = body + 12;
              for (let i = 0; i < count && i < 5000 && q + 4 <= next; i++, q += 4) {
                if (dv.getUint32(q) <= 16) ctx.tinySamples++;
              }
            }
          } else if (t === "stsd" && body + 16 <= next) {
            const raw = String.fromCharCode(...u8.subarray(body, Math.min(next, body + 512)));
            if (/dvcC|dvvC|dvh1|dvhe/.test(raw)) color = "Dolby Vision";
            else if (/smpte2084|arib-std-b67|bt2020/i.test(raw)) color = "HDR10 (10-bit)";
          }
        }
        p += sz;
      }
    };
    walk(0, u8.byteLength, null);
    return { fps: bestFps, dur: bestDur, ghostFrames, vfr, color };
  } catch { return { fps: null, dur: 0, ghostFrames: false, vfr: false, color: "SDR (8-bit)" }; }
}

async function probeMeta(u, cookie) {
  if (!u || !u.startsWith("http")) return { fps: null, dur: 0, ghostFrames: false, vfr: false, color: "SDR (8-bit)" };
  try {
    const isTikwm = /tikwm\.com/i.test(u);
    const headers = {
      "User-Agent": UA,
      "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/",
      "Range": "bytes=0-262143",
    };
    if (!isTikwm && cookie) headers["Cookie"] = cookie;
    const r = await fetch(u, { headers, redirect: "follow", signal: AbortSignal.timeout(3500) });
    if (!r.ok && r.status !== 206) return { fps: null, dur: 0, ghostFrames: false, vfr: false, color: "SDR (8-bit)" };
    const buf = await r.arrayBuffer();
    return parseMp4Meta(buf);
  } catch { return { fps: null, dur: 0, ghostFrames: false, vfr: false, color: "SDR (8-bit)" }; }
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts) * 1000), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function regionInfo(cc) {
  if (!cc || cc.length !== 2) return { code: cc || "", flag: "🌍", name: cc || "Unknown" };
  const flag = [...cc.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
  let name = cc;
  try { name = new Intl.DisplayNames(["en"], { type: "region" }).of(cc.toUpperCase()) || cc; } catch {}
  return { code: cc.toUpperCase(), flag, name };
}

function build(it, w, url, scraped, errs, mv, probed = {}) {
  it = it || {}; w = w || {};
  const v = it.video || {}, st = it.stats || {}, au = it.author || {}, mu = it.music || {};
  const dur = Number(v.duration || 0) || Math.round(Number(mv?.duration || 0) / 1000) || Number(w.duration || 0);
  const exactDur = (mv?.duration ? Number(mv.duration) / 1000 : 0) || probed.dur || dur;
  const fpsMap = { ...(probed.gears || {}) };
  let maxFps = probed.max || Number(v.fps || v.FPS || v.videoMeta?.fps || w.fps || 0) || null;
  for (const b of (mv?.bit_rate || [])) if (b.FPS) { fpsMap[b.gear_name] = Number(b.FPS); maxFps = Math.max(maxFps || 0, Number(b.FPS)); }
  const fpsOf = (b) => {
    if (b?.FPS || b?.fps || b?._fps) return Number(b.FPS || b.fps || b._fps);
    try { const x = JSON.parse(b.VideoExtra); return Number(x.fps || x.FPS || x.real_fps || x.out_fps) || null; } catch { return null; }
  };
  const streams = [];
  const pas = v.PlayAddrStruct;
  const br0 = (v.bitrateInfo || [])[0];
  const pasBytes = Number(pas?.DataSize || 0);
  const br0Bytes = Number(br0?.PlayAddr?.DataSize || 0);

  if (pas && (pas.DataSize || pas.Width)) {
    const bytes = pasBytes;
    streams.push({
      gear: "play_addr", src: "web", quality: null, w: pas.Width || v.width || 0, h: pas.Height || v.height || 0, fps: Number(v.fps || 0) || probed.pas || maxFps || null,
      bps: Number(br0?.Bitrate || v.bitrate || 0) || (exactDur ? Math.round((bytes * 8) / exactDur) : 0),
      codec: /265|hevc|bytevc1/i.test(`${v.codecType || ""} ${br0?.CodecType || ""}`) ? "hevc" : "h264", bytes, vq: null,
      url: firstUrl(pas) || firstUrl(v.playAddr),
    });
  }

  if (mv) {
    const mk = (gear, pa, x = {}) => {
      if (!pa || !(pa.width || pa.data_size)) return;
      const bytes = Number(pa.data_size || 0);
      streams.push({
        gear, src: "phone", quality: null, w: pa.width || 0, h: pa.height || 0, fps: x.fps || maxFps || null,
        bps: x.bps || (exactDur ? Math.round((bytes * 8) / exactDur) : 0),
        codec: x.codec || (/bytevc1|265/i.test(gear) ? "hevc" : "h264"), bytes, vq: null,
        url: firstUrl(pa),
      });
    };
    const topMvBr = (mv.bit_rate || [])[0];
    const sameBr = (mv.bit_rate || []).find((b) => Number(b.play_addr?.data_size || 0) === Number(mv.play_addr?.data_size || 0));
    const mvPaBytes = Number(mv.play_addr?.data_size || 0);
    const sameAsBr0 = br0Bytes && mvPaBytes === br0Bytes;
    mk("play_addr", mv.play_addr, {
      fps: sameBr?.FPS || topMvBr?.FPS || maxFps,
      bps: sameAsBr0 ? Number(br0?.Bitrate || sameBr?.bit_rate || 0) : (Number(sameBr?.bit_rate || 0) || (exactDur ? Math.round((mvPaBytes * 8) / exactDur) : 0)),
      codec: (mv.is_bytevc1 || sameAsBr0 || /265|hevc|bytevc1/i.test(mv.play_addr?.url_key || "")) ? "hevc" : "h264",
    });
    mk("play_addr_h264", mv.play_addr_h264, { codec: "h264" });
    mk("play_addr_bytevc1", mv.play_addr_bytevc1, { codec: "hevc" });
    for (const b of (mv.bit_rate || [])) {
      mk(b.gear_name || "bit_rate", b.play_addr, {
        fps: b.FPS, bps: Number(b.bit_rate || 0),
        codec: b.is_bytevc1 || b.is_h265 ? "hevc" : "h264",
      });
    }
  } else if (pas && pasBytes && br0Bytes && pasBytes !== br0Bytes) {
    const pBps = exactDur ? Math.round((pasBytes * 8) / exactDur) : Number(v.bitrate || 0);
    const pw = pas.Width || v.width || 0, ph = pas.Height || v.height || 0;
    const pasUrl = firstUrl(pas) || firstUrl(v.playAddr);
    const normGear = `normal_${Math.min(pw, ph)}_0`;
    streams.push({ gear: "play_addr", src: "phone", quality: null, w: pw, h: ph, fps: maxFps, bps: pBps, codec: "h264", bytes: pasBytes, vq: null, url: pasUrl });
    streams.push({ gear: normGear, src: "phone", quality: null, w: pw, h: ph, fps: maxFps, bps: pBps, codec: "h264", bytes: pasBytes, vq: null, url: pasUrl });
  }

  for (const b of (v.bitrateInfo || [])) {
    const pa = b.PlayAddr || {};
    const f = fpsOf(b) || fpsMap[b.GearName] || Number(v.fps || 0) || maxFps || null;
    if (f) maxFps = Math.max(maxFps || 0, f);
    streams.push({
      gear: b.GearName || "", src: "web", quality: b.QualityType ?? null,
      w: pa.Width || 0, h: pa.Height || 0, fps: f,
      bps: b.Bitrate || 0,
      codec: /265|hevc|bytevc1/i.test(b.CodecType || "") ? "hevc" : "h264",
      bytes: Number(pa.DataSize || 0), vq: b.VQScore ?? null,
      url: firstUrl(pa),
    });
  }

  if (!mv && pas && pasBytes && (!br0Bytes || pasBytes === br0Bytes)) {
    const webPas = streams.find((s) => s.src === "web" && s.gear === "play_addr");
    const webOrig = streams.find((s) => s.src === "web" && /^original_/i.test(s.gear));
    if (webPas) streams.push({ ...webPas, src: "phone" });
    if (webOrig) streams.push({ ...webOrig, src: "phone", codec: "h264" });
  }

  if (maxFps) {
    for (const s of streams) if (!s.fps) s.fps = maxFps;
  }
  streams.sort((a, b) => b.h - a.h || b.bytes - a.bytes);
  const top = streams[0] || null;
  const webTop = streams.find((s) => s.src === "web") || top;
  const phoneTop = streams.find((s) => s.src === "phone") || top;
  const mainStream = streams.find((s) => s.src === "web" && s.gear && s.gear !== "play_addr") || streams.find((s) => s.gear && s.gear !== "play_addr") || top;
  const fps = top?.fps || maxFps || probed.hd || probed.sd || null;
  const bitrate = mainStream?.bps ? `${(mainStream.bps / 1e6).toFixed(1)} MBps` : "—";
  const codec = mainStream?.codec ? mainStream.codec.toUpperCase() : "—";
  const vq = v.VQScore ?? v.vqScore ?? top?.vq ?? null;
  const views = Number(st.playCount ?? w.play_count ?? 0);
  const likes = Number(st.diggCount ?? w.digg_count ?? 0);
  const comments = Number(st.commentCount ?? w.comment_count ?? 0);
  const favs = Number(st.collectCount ?? w.collect_count ?? 0);
  const shares = Number(st.shareCount ?? w.share_count ?? 0);
  const downloads = Number(w.download_count ?? 0);
  const er = views ? (((likes + comments + shares + favs) / views) * 100).toFixed(2) : "0.00";
  const cats = [...new Set([
    ...(it.diversificationLabels || []),
    ...(it.classify ? [].concat(it.classify) : []),
  ].filter(Boolean))];
  const tips = [...new Set((it.suggestedWords || []).filter(Boolean))];
  const mdur = Number(mu.duration ?? w.music_info?.duration ?? 0);

  const mvSorted = [...(mv?.bit_rate || [])].sort((a, b) => (b.play_addr?.height || 0) - (a.play_addr?.height || 0) || (b.bit_rate || 0) - (a.bit_rate || 0));
  const mvHd = firstUrl(mvSorted[0]?.play_addr) || firstUrl(mv?.play_addr_bytevc1) || firstUrl(mv?.play_addr) || firstUrl(mv?.download_addr);
  const mvSd = firstUrl(mv?.play_addr_h264) || firstUrl(mv?.play_addr) || mvHd;
  const webSorted = [...(v.bitrateInfo || [])].sort((a, b) => (b.PlayAddr?.Height || 0) - (a.PlayAddr?.Height || 0) || (b.Bitrate || 0) - (a.Bitrate || 0));
  const webHd = firstUrl(webSorted[0]?.PlayAddr) || firstUrl(v.PlayAddrStruct) || firstUrl(v.playAddr) || firstUrl(v.downloadAddr);
  const webSd = firstUrl(v.PlayAddrStruct) || firstUrl(v.playAddr) || firstUrl(webSorted[webSorted.length - 1]?.PlayAddr) || webHd;

  const hdLink = abs(w.hdplay) || abs(w.play) || mvHd || webHd || "";
  const sdLink = abs(w.play) || abs(w.wmplay) || mvSd || webSd || hdLink || "";
  const musicLink = abs(w.music || w.music_info?.play) || firstUrl(mu.playUrl) || firstUrl(mu.play_url) || "";

  const images = [
    ...(Array.isArray(w.images) ? w.images.map(abs) : []),
    ...((it.imagePost?.images || []).map((img) => firstUrl(img.imageURL)).filter(Boolean)),
  ].filter((x, i, a) => x && a.indexOf(x) === i);

  const hasOriginalGear = streams.some((s) => /^original_/i.test(s.gear));
  const maxBytes = Math.max(...streams.map((s) => s.bytes || 0), 0);
  const method = probed.ghostFrames
    ? "Bypass (Ghost Frames)"
    : hasOriginalGear || (Math.min(top?.w || 0, top?.h || 0) >= 1080 && (fps || 0) >= 60)
      ? "Direct Original (Uncompressed)"
      : "Standard TikTok Transcode";
  const framePacing = probed.vfr ? "VFR (Variable)" : "CFR (Constant)";
  const colorSpace = probed.color || (/hevc/i.test(codec) && Math.min(top?.w || 0, top?.h || 0) >= 2160 ? "HDR / 10-bit capable" : "SDR (8-bit)");
  const playback = maxBytes > 100 * 1048576 ? `Heavy (${(maxBytes / 1048576).toFixed(1)} MB · Lag risk)` : "Optimal (<100 MB)";

  const verified = Boolean(au.verified || w.author?.verified);
  const aigc = Boolean(it.aigcLabelType || it.isAigc || it.aigcDescription || w.is_aigc);
  const isAd = Boolean(it.isAd || it.isCommerce || w.is_ad || w.commerce_info?.adv_promotable);
  const status = it.privateItem ? "Private" : "Public (Everyone)";
  const duetOk = it.duetEnabled !== false && it.duetDisplay !== 3;
  const stitchOk = it.stitchEnabled !== false && it.stitchDisplay !== 3;
  const commentOk = it.commentStatus !== 3 && it.comments !== false;
  const permissions = `Comments ${commentOk ? "✓" : "✕"} · Duet ${duetOk ? "✓" : "✕"} · Stitch ${stitchOk ? "✓" : "✕"}`;

  const d = {
    id: it.id || w.id || videoId(url) || "",
    url,
    author: (au.nickname || w.author?.nickname || "").trim() || au.uniqueId || w.author?.unique_id || "",
    username: au.uniqueId || w.author?.unique_id || "",
    verified,
    avatar: au.avatarMedium || au.avatarThumb || abs(w.author?.avatar) || "",
    duration: dur,
    fps,
    bitrate,
    codec,
    date: fmtDate(it.createTime || w.create_time),
    desc: it.desc || w.title || "",
    music: {
      title: mu.title || w.music_info?.title || "",
      author: mu.authorName || w.music_info?.author || "",
      duration: `${Math.floor(mdur / 60)}:${String(mdur % 60).padStart(2, "0")}`,
    },
    stats: { views, likes, comments, favorites: favs, shares, downloads, er },
    source: scraped ? "Browser" : "Mobile",
    region: regionInfo(it.locationCreated || w.region || ""),
    shadowBan: it.privateItem || it.shadowBan ? "Yes" : "No",
    browserRes: webTop ? `${Math.min(webTop.w, webTop.h)}p${webTop.fps || fps || ""}` : (fps ? `${fps} FPS` : "—"),
    phoneRes: phoneTop ? baseRes(phoneTop) + ((phoneTop.fps || fps) ? ` ${phoneTop.fps || fps} FPS` : "") : (fps ? `${fps} FPS` : "—"),
    top, vq,
    original: { w: v.width || top?.w || 0, h: v.height || top?.h || 0, fps },
    technical: { method, framePacing, color: colorSpace, playback },
    visibility: {
      status,
      verified: verified ? "Yes" : "No",
      aigc: aigc ? "Yes" : "No",
      ad: isAd ? "Yes" : "No",
      permissions,
    },
    categories: cats, tips, streams, images,
    links: {
      hd: hdLink, sd: sdLink, music: musicLink,
      cover: abs(w.origin_cover || w.cover) || v.originCover || v.cover || firstUrl(mv?.origin_cover) || firstUrl(mv?.cover) || images[0] || "",
    },
    ok: { tiktok: !!scraped, tikwm: !!Object.keys(w).length },
  };
  Object.defineProperty(d, "_dlCandidates", {
    value: [...new Set([abs(w.hdplay), abs(w.play), mvHd, mvSd, webHd, webSd, abs(w.wmplay)].filter(Boolean))],
    enumerable: false,
  });
  Object.defineProperty(d, "_cookie", { value: it._cookie || "", enumerable: false });
  d.report = report(d, false);
  d.reportHtml = report(d, true);
  d.errors = errs || {};
  return d;
}

function report(d, html = false) {
  const s = d.stats, seg = [];
  const T = (v) => (html ? esc(v) : String(v ?? ""));
  const E = (k) => ce(k, html);
  const L = (...x) => seg.push(...x);

  L(`${E("video")} VIDEO • ANALYTICS`, "");
  L(`${E("music")}${E("camera")} ${T(d.author)}${d.verified ? ` ${E("verified")}` : ""}  ${E("calendar")} ${T(d.date)}`);
  if (d.desc) seg.push({ quote: [d.desc] });
  L(`${E("music")} ${T(d.music.title)} - ${T(d.music.author)} • ${T(d.music.duration)}`, "");
  L("📊 Statistics");
  L(`  • ${E("views")} ${num(s.views)} Views`, `  • ${E("likes")} ${num(s.likes)} Likes`, `  • ${E("comments")} ${num(s.comments)} Comments`);
  L(`  • ${E("favorites")} ${num(s.favorites)} Favorites`, `  • ${E("shares")} ${num(s.shares)} Shares`, `  • ${E("downloads")} ${num(s.downloads)} Downloads`);
  L(`  • ${E("er")} ER | ${T(s.er)}%`, "");
  L(`${E("info")} Information`);
  L(`  • ${E("id")} ID | ${T(d.id)}`, `  • ${E("source")} Source | ${T(d.source)}`);
  L(`  • ${E("region")} Region | ${T(d.region.flag)} ${T(d.region.name)}`, `  • 👻 Shadow ban | ${T(d.shadowBan)}`, "");
  L(
    `${E("quality")} Quality`,
    `  • 🌐 Browser | ${T(d.browserRes)}`,
    `  • 📱 Phone | ${T(d.phoneRes)}`,
    `  • 📶 Bitrate | ${T(d.bitrate)}`,
    `  • 🎬 Codec | ${T(d.codec)}`,
  );
  if (d.streams.length) {
    const groups = new Map();
    for (const t of d.streams) {
      const k = `${resLabel(t)}|${(t.bps / 1e6).toFixed(1)}|${t.codec}|${(t.bytes / 1048576).toFixed(1)}`;
      if (!groups.has(k)) groups.set(k, { t, byGear: new Map() });
      const gName = t.gear || "play_addr";
      const gMap = groups.get(k).byGear;
      if (!gMap.has(gName)) gMap.set(gName, { icons: new Set(), url: t.url || d.links?.hd || "" });
      const entry = gMap.get(gName);
      entry.icons.add(t.src === "phone" ? "📱" : "🌐");
      if (!entry.url && t.url) entry.url = t.url;
    }
    const q = [];
    for (const { t, byGear } of groups.values()) {
      if (q.length) q.push("");
      const labels = [];
      for (const [gName, info] of byGear.entries()) {
        const ic = [...info.icons].join(" ");
        if (html) {
          const link = info.url ? `<a href="${esc(info.url)}">${esc(gName)}</a>` : esc(gName);
          labels.push(`${ic} ${link}`);
        } else {
          labels.push(`${ic} ${gName}`);
        }
      }
      q.push(labels.join("  "));
      const specLine = `${resLabel(t)} • ${(t.bps / 1e6).toFixed(1)} MBps • ${t.codec} • ${(t.bytes / 1048576).toFixed(1)} MB`;
      q.push(html ? esc(specLine) : specLine);
    }
    seg.push({ quote: q, rawHtml: true });
  }
  L(` ┃ Original | ${T(d.original.w)}x${T(d.original.h)}`, ` ┃ VQ Score | ${T(d.vq ?? "—")}`, "");
  if (d.technical) {
    L(
      `${E("technical")} Technical`,
      `  • ${E("package")} Method | ${T(d.technical.method)}`,
      `  • ${E("timer")} Frame Pacing | ${T(d.technical.framePacing)}`,
      `  • ${E("color")} Color | ${T(d.technical.color)}`,
      `  • ${E("bolt")} Playback | ${T(d.technical.playback)}`,
      "",
    );
  }
  if (d.visibility) {
    L(
      `${E("visibility")} Visibility`,
      `  • ${E("lock")} Status | ${T(d.visibility.status)}`,
      `  • ${E("verified")} Verified | ${T(d.visibility.verified)}`,
      `  • ${E("bot")} AI Label | ${T(d.visibility.aigc)}`,
      `  • ${E("ad")} Ad / Promo | ${T(d.visibility.ad)}`,
      `  • ${E("comments")} Permissions | ${T(d.visibility.permissions)}`,
      "",
    );
  }
  if (d.categories.length) L(`${E("tag")} Categories`, ...d.categories.map((c) => ` ┃ ${T(c)}`), "");
  if (d.tips.length) L(`${E("tips")} Tips`, ...d.tips.map((c) => ` ┃ ${T(c)}`), "");
  L(`${E("bolt")}Shura RTX® | Downloader & Checker`);
  return seg.map((x) => typeof x === "string"
    ? x
    : (html ? `<blockquote expandable>${(x.rawHtml ? x.quote : x.quote.map(esc)).join("\n")}</blockquote>` : x.quote.join("\n"))
  ).join("\n");
}

async function analyze(rawUrl) {
  const preId = videoId(rawUrl);
  const cachedById = preId ? getCached(`id:${preId}`) : getCached(`url:${rawUrl}`);
  if (cachedById) return cachedById;

  const url = await resolveUrl(rawUrl);
  let id = videoId(url);
  const cachedResolved = (id && getCached(`id:${id}`)) || getCached(`url:${url}`);
  if (cachedResolved) return cachedResolved;

  let [a, b, c] = await Promise.allSettled([scrape(url), tikwm(url), id ? mobile(id) : Promise.reject(new Error("sin id"))]);
  if (a.status === "rejected" && b.status === "rejected" && c.status === "rejected") {
    throw new Error(`TikTok: ${a.reason?.message} | TikWM: ${b.reason?.message}`);
  }
  if (c.status === "rejected") {
    const fallbackId = id || a.value?.id || b.value?.id;
    if (fallbackId && fallbackId !== id) {
      id = fallbackId;
      const [c2] = await Promise.allSettled([mobile(id)]);
      if (c2.status === "fulfilled") c = c2;
    }
  }
  const it = a.value || {}, w = b.value || {}, mv = c.value || null;
  const cookie = it._cookie || "";
  const probed = { gears: {}, max: null, hd: null, sd: null, pas: null, dur: 0, ghostFrames: false, vfr: false, color: "SDR (8-bit)" };
  const applyMeta = (meta, gear) => {
    if (!meta) return;
    if (meta.fps) {
      if (gear) probed.gears[gear] = meta.fps;
      probed.max = Math.max(probed.max || 0, meta.fps);
    }
    if (meta.dur > 0) probed.dur = Math.max(probed.dur || 0, meta.dur);
    if (meta.ghostFrames) probed.ghostFrames = true;
    if (meta.vfr) probed.vfr = true;
    if (meta.color && meta.color !== "SDR (8-bit)") probed.color = meta.color;
  };
  const hasMobileFps = (mv?.bit_rate || []).some((x) => x.FPS);
  const tasks = [];
  const bitrates = it.video?.bitrateInfo || [];
  for (const br of bitrates.slice(0, hasMobileFps ? 1 : 4)) {
    const u = firstUrl(br.PlayAddr);
    if (u && br.GearName) {
      tasks.push(probeMeta(u, cookie).then((m) => applyMeta(m, br.GearName)));
    }
  }
  const pasUrl = firstUrl(it.video?.PlayAddrStruct) || firstUrl(it.video?.playAddr);
  if (pasUrl) {
    tasks.push(probeMeta(pasUrl, cookie).then((m) => {
      if (m.fps) probed.pas = m.fps;
      applyMeta(m, null);
    }));
  }
  const hdUrl = abs(w.hdplay);
  const sdUrl = abs(w.play);
  if (hdUrl && !tasks.length) tasks.push(probeMeta(hdUrl, "").then((m) => { if (m.fps) probed.hd = m.fps; applyMeta(m, null); }));
  else if (sdUrl && !tasks.length) tasks.push(probeMeta(sdUrl, "").then((m) => { if (m.fps) probed.sd = m.fps; applyMeta(m, null); }));
  if (tasks.length) await Promise.allSettled(tasks);

  const res = build(a.value, b.value, url, a.status === "fulfilled", { tiktok: a.reason?.message || null, tikwm: b.reason?.message || null, mobile: c.reason?.message || null }, c.value, probed);
  setCached(res);
  return res;
}

async function analyzeUser(rawHandle) {
  const handle = String(rawHandle || "").replace(/^.*tiktok\.com\/@/, "").replace(/^@/, "").split(/[/?#&\s]/)[0].trim();
  if (!handle) throw new Error("Usuario de TikTok inválido");
  const [infoRes, postsRes] = await Promise.allSettled([
    fetch(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`, { headers: { "User-Agent": UA, "Referer": "https://www.tikwm.com/" }, signal: AbortSignal.timeout(6000) }).then((r) => r.json()),
    fetch(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=20`, { headers: { "User-Agent": UA, "Referer": "https://www.tikwm.com/" }, signal: AbortSignal.timeout(6000) }).then((r) => r.json()),
  ]);
  const uData = infoRes.status === "fulfilled" && infoRes.value?.code === 0 ? infoRes.value.data : null;
  const pData = postsRes.status === "fulfilled" && postsRes.value?.code === 0 ? (postsRes.value.data?.videos || []) : [];
  if (!uData && !pData.length) throw new Error("No se pudo obtener información del perfil @" + handle);

  const user = uData?.user || pData[0]?.author || { uniqueId: handle, nickname: handle };
  const stats = uData?.stats || {};
  const followers = Number(stats.followerCount || 0);
  const following = Number(stats.followingCount || 0);
  const hearts = Number(stats.heartCount || stats.heart || 0);
  const videoCount = Number(stats.videoCount || pData.length || 0);

  let avgViews = 0, avgEr = "0.00", bestHours = "—", health = "Good";
  if (pData.length) {
    let totalV = 0, totalEng = 0;
    const hourBuckets = new Map();
    for (const v of pData) {
      const vw = Number(v.play_count || 0);
      const eg = Number(v.digg_count || 0) + Number(v.comment_count || 0) + Number(v.share_count || 0) + Number(v.collect_count || 0);
      totalV += vw;
      totalEng += eg;
      if (v.create_time) {
        const hr = new Date(Number(v.create_time) * 1000).getUTCHours();
        const cur = hourBuckets.get(hr) || { sum: 0, count: 0 };
        cur.sum += vw;
        cur.count += 1;
        hourBuckets.set(hr, cur);
      }
    }
    avgViews = Math.round(totalV / pData.length);
    const erNum = totalV ? (totalEng / totalV) * 100 : 0;
    avgEr = erNum.toFixed(2);
    health = erNum >= 8 ? "Excellent (High FYP Reach)" : erNum >= 3 ? "Healthy (Normal Reach)" : avgViews < 100 && followers > 1000 ? "Low Reach (Possible Shadowban)" : "Moderate";
    const sortedHours = [...hourBuckets.entries()]
      .map(([hr, o]) => ({ hr, avg: o.sum / o.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map((x) => `${String(x.hr).padStart(2, "0")}:00 UTC`);
    if (sortedHours.length) bestHours = sortedHours.join(", ");
  }

  return {
    handle: user.uniqueId || user.unique_id || handle,
    nickname: user.nickname || handle,
    verified: Boolean(user.verified),
    region: regionInfo(user.region || ""),
    followers, following, hearts, videoCount,
    avgViews, avgEr, bestHours, health,
  };
}

function userReportHtml(u) {
  const E = (k) => ce(k, true);
  return [
    `${E("user")} <b>PROFILE • ANALYTICS</b>`,
    "",
    `${E("camera")} <b>${esc(u.nickname)}</b> (@${esc(u.handle)}) ${u.verified ? E("verified") : ""}`,
    `${E("region")} Region | ${esc(u.region.flag)} ${esc(u.region.name)}`,
    "",
    `📊 <b>Account Statistics</b>`,
    `  • ${E("users")} ${num(u.followers)} Followers`,
    `  • ${E("likes")} ${num(u.hearts)} Total Likes`,
    `  • ${E("video")} ${num(u.videoCount)} Videos`,
    `  • ${E("views")} ${num(u.avgViews)} Avg. Views (recent)`,
    `  • ${E("er")} Avg. ER | ${esc(u.avgEr)}%`,
    "",
    `${E("visibility")} <b>Account Health &amp; Timing</b>`,
    `  • ${E("verified")} Health | ${esc(u.health)}`,
    `  • ${E("clock")} Best Upload Times | ${esc(u.bestHours)}`,
    "",
    `${E("bolt")}Shura RTX® | Downloader &amp; Checker`,
  ].join("\n");
}

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

const compact = (n) => {
  n = Number(n || 0);
  const f = (x, u) => x.toFixed(1).replace(/\.0$/, "") + u;
  return n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "K") : String(n);
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function previewCaption(d) {
  const desc = [...(d.desc || "")].slice(0, 550).join("");
  const s = d.stats;
  const E = (k) => ce(k, true);
  const kind = d.images?.length ? `${E("photo")} <b>PHOTO MODE</b> · ${d.images.length} photos` : `${E("video")} <b>VIDEO</b> · ${mmss(d.duration || 0)}${d.fps ? ` · ${d.fps} FPS` : ""}`;
  return `${kind}\n\n${E("user")} <b>${esc(d.author)}</b>${d.verified ? ` ${E("verified")}` : ""}  ${E("calendar")} ${esc(d.date)}  ${E("region")} ${d.region.flag} ${esc(d.region.name)}\n` +
    (desc ? `<blockquote expandable>${esc(desc)}</blockquote>\n` : "") +
    `${E("views")} ${compact(s.views)}  ${E("likes")} ${compact(s.likes)}  ${E("comments")} ${compact(s.comments)}  ${E("favorites")} ${compact(s.favorites)}\n\n👇 <b>Choose an action</b>`;
}

function keyboard(d) {
  const rows = [];
  rows.push([{ text: d.images?.length ? "🖼 Download Photos" : "▶️ Download Original Video", callback_data: `v|${d.id}|${d.username}`.slice(0, 64) }]);
  rows.push([{ text: "📊 Check Stats", callback_data: `s|${d.id}|${d.username}`.slice(0, 64) }]);
  if (d.username) rows.push([{ text: `👤 @${d.username} ↗️`, url: `https://www.tiktok.com/@${d.username}` }]);
  return { inline_keyboard: rows };
}

const tgForm = (env, method, form) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body: form }).then((r) => r.json());

async function sendFile(env, chat, d, threadId) {
  const extraThread = threadId ? { message_thread_id: threadId } : {};
  if (d.images?.length) {
    const media = d.images.slice(0, 10).map((u, i) => ({
      type: "photo",
      media: u,
      ...(i === 0 ? { caption: `${ce("bolt", true)}Shura RTX® | Downloader &amp; Checker`, parse_mode: "HTML" } : {}),
    }));
    const res = await tg(env, "sendMediaGroup", { chat_id: chat, media, ...extraThread });
    if (res.ok) return res;
  }

  const candidates = d._dlCandidates?.length ? d._dlCandidates : [d.links.hd, d.links.sd].filter(Boolean);
  const primaryLink = d.links.hd || d.links.sd || candidates[0] || "";
  const fail = (t) => tg(env, "sendMessage", {
    chat_id: chat, text: t, parse_mode: "HTML", disable_web_page_preview: true, ...extraThread,
    ...(primaryLink ? { reply_markup: { inline_keyboard: [[{ text: "🔗 Enlace directo HD", url: primaryLink }]] } } : {}),
  });
  if (!candidates.length) return fail("❌ No encontré un enlace de descarga para este video.");
  const MAX = 48 * 1048576;
  let oversizeMb = 0;

  for (const link of candidates) {
    try {
      const isTikwm = /tikwm\.com/i.test(link);
      const headers = {
        "User-Agent": UA,
        "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/",
      };
      if (!isTikwm && d._cookie) headers["Cookie"] = d._cookie;
      const r = await fetch(link, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json") || ct.includes("text/html")) continue;
      const size = Number(r.headers.get("content-length") || 0);
      if (size > MAX) { oversizeMb = Math.max(oversizeMb, Math.round(size / 1048576)); continue; }
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX) { oversizeMb = Math.max(oversizeMb, Math.round(buf.byteLength / 1048576)); continue; }
      if (buf.byteLength < 4096) continue;
      const f = new FormData();
      f.append("chat_id", String(chat));
      if (threadId) f.append("message_thread_id", String(threadId));
      f.append("video", new Blob([buf], { type: "video/mp4" }), `${d.id || "video"}.mp4`);
      f.append("supports_streaming", "true");
      f.append("caption", "⚡️Shura RTX® | Downloader & Checker");
      const res = await tgForm(env, "sendVideo", f);
      if (res.ok) return res;
    } catch {}
  }

  for (const link of candidates) {
    try {
      const res = await tg(env, "sendVideo", {
        chat_id: chat, video: link, supports_streaming: true, caption: "⚡️Shura RTX® | Downloader & Checker", ...extraThread,
      });
      if (res.ok) return res;
    } catch {}
  }

  if (oversizeMb) return fail(`⚠️ El video pesa ${oversizeMb} MB y Telegram no deja que los bots envíen más de 50 MB. Usa el enlace directo:`);
  return fail("❌ No pude bajar el video. Usa el enlace directo:");
}

async function handleCallback(cq, env) {
  const chat = cq.message?.chat?.id;
  const threadId = cq.message?.message_thread_id;
  const extraThread = threadId ? { message_thread_id: threadId } : {};
  const [k, id, user] = (cq.data || "").split("|");
  if ((k !== "s" && k !== "v") || !chat || !id) return tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: k === "v" ? "Descargando video…" : "Analizando…" });
  try {
    if (k === "v") await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video", ...extraThread });
    const d = await analyze(`https://www.tiktok.com/@${user || "_"}/video/${id}`);
    if (k === "v") return await sendFile(env, chat, d, threadId);
    const rows = [
      [{ text: d.images?.length ? "🖼 Download Photos" : "▶️ Download Original Video", callback_data: `v|${d.id}|${d.username}`.slice(0, 64) }],
    ];
    await tg(env, "sendMessage", {
      chat_id: chat, text: d.reportHtml, parse_mode: "HTML", disable_web_page_preview: true,
      reply_to_message_id: cq.message.message_id, allow_sending_without_reply: true, ...extraThread,
      reply_markup: { inline_keyboard: rows },
    });
  } catch (e) {
    await tg(env, "sendMessage", { chat_id: chat, text: "❌ " + esc(e.message), parse_mode: "HTML", ...extraThread });
  }
}

async function handleInline(iq, env) {
  const q = (iq.query || "").trim();
  const m = q.match(TT);
  if (!m) {
    return tg(env, "answerInlineQuery", {
      inline_query_id: iq.id,
      results: [],
      cache_time: 5,
      button: { text: "Pega un enlace de TikTok", start_parameter: "inline" },
    });
  }
  try {
    const d = await analyze(m[0]);
    const kb = keyboard(d);
    const results = [
      {
        type: "article",
        id: `stats_${d.id || Date.now()}`,
        title: `📊 Analytics: ${d.author} (${d.browserRes})`,
        description: `👁 ${compact(d.stats.views)} · ❤️ ${compact(d.stats.likes)} · ER ${d.stats.er}% · ${d.bitrate} ${d.codec}`,
         ...(d.links.cover ? { thumbnail_url: d.links.cover } : {}),
        input_message_content: {
          message_text: d.reportHtml,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        reply_markup: kb,
      },
      {
        type: "article",
        id: `prev_${d.id || Date.now()}`,
        title: `📹 Preview: ${d.author}`,
        description: d.desc || "Enviar vista previa con botones de descarga y estadísticas",
        ...(d.links.cover ? { thumbnail_url: d.links.cover } : {}),
        input_message_content: {
          message_text: previewCaption(d),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        reply_markup: kb,
      },
    ];
    return tg(env, "answerInlineQuery", { inline_query_id: iq.id, results, cache_time: 60 });
  } catch {
    return tg(env, "answerInlineQuery", { inline_query_id: iq.id, results: [], cache_time: 5 });
  }
}

async function handleUpdate(update, env) {
  if (update.callback_query) return handleCallback(update.callback_query, env);
  if (update.inline_query) return handleInline(update.inline_query, env);
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  const chat = msg.chat.id;
  const threadId = msg.message_thread_id;
  const extraThread = threadId ? { message_thread_id: threadId } : {};
  const send = (text, extra = {}) =>
    tg(env, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extraThread, ...extra });

  if (/^\/start/.test(msg.text)) {
    return send(`${ce("bolt", true)} <b>Shura RTX® | Downloader &amp; Checker</b>\n\nEnvíame un enlace de TikTok y te devuelvo la vista previa del video, el análisis completo y la descarga sin marca de agua.\n\n• Usa <code>/user @usuario</code> para analizar la salud y mejores horarios de un perfil.`);
  }

  const userCmd = msg.text.match(/^\/user\s+@?([\w.-]+)/i) || (/^@[\w.-]{2,32}$/.test(msg.text.trim()) ? [null, msg.text.trim().slice(1)] : null);
  if (userCmd) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing", ...extraThread });
    try {
      const uInfo = await analyzeUser(userCmd[1]);
      return await send(userReportHtml(uInfo), {
        reply_markup: { inline_keyboard: [[{ text: `👤 @${uInfo.handle} ↗️`, url: `https://www.tiktok.com/@${uInfo.handle}` }]] },
      });
    } catch (e) {
      return await send("❌ " + esc(e.message));
    }
  }

  const links = [...msg.text.matchAll(new RegExp(TT.source, "gi"))].map((x) => x[0]).slice(0, 5);
  if (!links.length) return send("Envía un enlace válido de TikTok (tiktok.com o vm.tiktok.com) o usa /user @usuario.");

  for (const link of links) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video", ...extraThread });
    try {
      const d = await analyze(link);
      const cap = previewCaption(d), kb = keyboard(d);
      let r = { ok: false };
      if (d.links.cover && d.links.cover.startsWith("http")) {
        r = await tg(env, "sendPhoto", { chat_id: chat, photo: d.links.cover, caption: cap, parse_mode: "HTML", reply_markup: kb, ...extraThread });
      }
      if (!r.ok) await send(cap, { reply_markup: kb });
    } catch (e) {
      await send("❌ No pude analizar ese enlace: " + esc(e.message));
    }
  }
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api") {
      const target = u.searchParams.get("url") || "";
      if (!TT.test(target)) return json({ ok: false, error: "Enlace de TikTok inválido" }, 400);
      try { return json({ ok: true, ...(await analyze(target.match(TT)[0])) }); }
      catch (e) { return json({ ok: false, error: e.message }, 502); }
    }

    if (u.pathname === "/dl") {
      const target = u.searchParams.get("url") || "";
      if (!target) return json({ ok: false, error: "Falta parámetro url" }, 400);
      try {
        let dlUrl = target, cookie = "", id = "video";
        if (TT.test(target)) {
          const d = await analyze(target.match(TT)[0]);
          dlUrl = d.links.hd || d.links.sd || d._dlCandidates?.[0] || "";
          cookie = d._cookie || "";
          id = d.id || "video";
        }
        if (!dlUrl || !dlUrl.startsWith("http")) return json({ ok: false, error: "No se encontró enlace de video" }, 404);
        const isTikwm = /tikwm\.com/i.test(dlUrl);
        const headers = {
          "User-Agent": UA,
          "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/",
        };
        if (req.headers.get("Range")) headers["Range"] = req.headers.get("Range");
        if (!isTikwm && cookie) headers["Cookie"] = cookie;
        const r = await fetch(dlUrl, { headers, redirect: "follow" });
        const respHeaders = new Headers(CORS);
        respHeaders.set("Content-Type", r.headers.get("Content-Type") || "video/mp4");
        respHeaders.set("Content-Disposition", `attachment; filename="tiktok-${id}.mp4"`);
        if (r.headers.get("Content-Length")) respHeaders.set("Content-Length", r.headers.get("Content-Length"));
        if (r.headers.get("Content-Range")) respHeaders.set("Content-Range", r.headers.get("Content-Range"));
        return new Response(r.body, { status: r.status, headers: respHeaders });
      } catch (e) { return json({ ok: false, error: e.message }, 502); }
    }

    if (u.pathname === "/debug") {
      const url = await resolveUrl(u.searchParams.get("url") || "");
      const id = videoId(url);
      const [a, b] = await Promise.allSettled([scrape(url), id ? mobile(id) : Promise.reject(new Error("sin id"))]);
      const cut = (o) => JSON.parse(JSON.stringify(o ?? null, (k, x) =>
        k === "UrlList" || k === "url_list" || k === "urlList" ? undefined : typeof x === "string" && x.length > 90 ? x.slice(0, 60) + "…" : x));
      return json({
        web: a.status === "fulfilled" ? cut(a.value.video) : String(a.reason?.message),
        mobile: b.status === "fulfilled" ? cut(b.value) : String(b.reason?.message),
      });
    }

    if (u.pathname === "/webhook" && req.method === "POST") {
      let update;
      try { update = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
      ctx.waitUntil(handleUpdate(update, env).catch(() => {}));
      return new Response("ok");
    }

    if (u.pathname === "/setup") {
      if (!env.BOT_TOKEN) return page("<h2>❌ Falta la variable BOT_TOKEN en Cloudflare</h2>", 500);
      const set = await tg(env, "setWebhook", {
        url: `${u.origin}/webhook`,
        allowed_updates: ["message", "edited_message", "callback_query", "inline_query"],
        drop_pending_updates: true,
      });
      const info = await tg(env, "getWebhookInfo", {});
      const ok = set.ok && info.result?.url === `${u.origin}/webhook`;
      return page(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="background:#07080d;color:#e6f7ff;font-family:system-ui;padding:24px">
<h2>${ok ? "✅ Webhook activo" : "⚠️ Revisa el diagnóstico"} — Shura RTX®</h2>
<pre style="white-space:pre-wrap;background:#10131c;padding:16px;border-radius:12px;border:1px solid #00f2fe55">${esc(JSON.stringify({ setWebhook: set, getWebhookInfo: info.result }, null, 2))}</pre></body>`);
    }

    if (u.pathname === "/") return page(HTML);
    return json({ ok: false, error: "Not found" }, 404);
  },
};
