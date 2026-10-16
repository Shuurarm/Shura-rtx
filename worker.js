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
const PROFILE = /^(?:https?:\/\/(?:www\.)?tiktok\.com\/)?@([\w.]{2,24})\/?(?:\?.*)?$/i;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const abs = (u) => (!u ? "" : u.startsWith("http") ? u : "https://www.tikwm.com" + u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstUrl = (pa) => {
  if (!pa) return "";
  if (typeof pa === "string") return pa.startsWith("http") ? pa : "";
  const list = pa.UrlList || pa.url_list || pa.urlList || [];
  return list.find((x) => typeof x === "string" && x.startsWith("http")) || "";
};
const REHYDRATE = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

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
  const m = t.match(REHYDRATE);
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
    if (/limit/i.test(e.message)) await sleep(1200);
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
      if (a && a.video) { a.video._info = { aigc: Number(a.aigc_info?.aigc_label_type || 0), ad: !!a.is_ads }; return a.video; }
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------- Análisis profundo del encabezado MP4 (stts / stsz / stsd / ilst) ---------- */
function parseMp4Meta(buf) {
  const out = { fps: null, dur: 0, vfr: null, tiny: null, samples: 0, color: null, brand: "", enc: "", big: false, c2pa: false };
  const C2PA = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const CONT = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "ilst", "meta"]);
    const PARTIAL = new Set(["stts", "stsz", "stsd", "co64", "uuid"]);
    let bestFps = null, bestDur = 0, picked = false;
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
        if (hdr === 16) out.big = true;
        if (!CONT.has(t) && p + sz > end && !PARTIAL.has(t)) break;
        const body = p + hdr, next = Math.min(p + sz, end);
        if (t === "trak") {
          const tc = { isVideo: false, timescale: 0, dur: 0, sttsSamples: 0, sttsDelta: 0, domDelta: 0, domCount: 0, stszSamples: 0, stszRead: 0, tinyCount: 0, vis: null };
          walk(body, next, tc);
          if (tc.isVideo && tc.timescale > 0) {
            if (tc.dur > 0) bestDur = Math.max(bestDur, tc.dur / tc.timescale);
            let fps = 0;
            if (tc.sttsSamples > 0 && tc.sttsDelta > 0) fps = (tc.sttsSamples * tc.timescale) / tc.sttsDelta;
            else if (tc.domDelta > 0) fps = tc.timescale / tc.domDelta;
            else if (tc.dur > 0 && tc.stszSamples > 0) fps = (tc.stszSamples * tc.timescale) / tc.dur;
            const r = Math.round(fps);
            if (r >= 1 && r <= 1000) bestFps = Math.max(bestFps || 0, r);
            if (!picked) {
              picked = true;
              out.samples = tc.stszSamples || tc.sttsSamples;
              if (tc.sttsSamples > 0) out.vfr = tc.domCount / tc.sttsSamples < 0.98;
              if (tc.stszRead > 0) out.tiny = tc.tinyCount / tc.stszRead;
              out.color = tc.vis;
            }
          }
        } else if (t === "ilst") {
          let q = body;
          while (q + 8 <= next) {
            const isz = dv.getUint32(q);
            if (isz < 8) break;
            const itag = tag(q + 4), dp = q + 8;
            if (dp + 16 <= q + isz && tag(dp + 4) === "data" && itag.charCodeAt(0) === 169 && itag.slice(1) === "too") {
              out.enc = new TextDecoder().decode(u8.subarray(dp + 16, Math.min(q + isz, next))).replace(/[^\x20-\x7e]/g, "").slice(0, 40);
            }
            q += isz;
          }
        } else if (t === "meta") {
          walk(body + 4, next, ctx);
        } else if (CONT.has(t)) {
          walk(body, next, ctx);
        } else if (ctx === null) {
          if (t === "ftyp" && body + 4 <= next) out.brand = tag(body);
          else if (t === "uuid" && body + 16 <= u8.byteLength && C2PA.every((b, i) => u8[body + i] === b)) out.c2pa = true;
        } else if (ctx) {
          if (t === "co64") out.big = true;
          else if (t === "vmhd") ctx.isVideo = true;
          else if (t === "hdlr" && body + 12 <= next && tag(body + 8) === "vide") ctx.isVideo = true;
          else if (t === "mdhd" && body + 20 <= next) {
            const ver = u8[body];
            if (ver === 0) { ctx.timescale = dv.getUint32(body + 12); ctx.dur = dv.getUint32(body + 16); }
            else if (ver === 1 && body + 28 <= next) { ctx.timescale = dv.getUint32(body + 20); ctx.dur = Number(dv.getBigUint64(body + 24)); }
          } else if (t === "stts" && body + 8 <= next) {
            const count = dv.getUint32(body + 4);
            let q = body + 8;
            for (let i = 0; i < count && i < 5000 && q + 8 <= next; i++, q += 8) {
              const sc = dv.getUint32(q), sd = dv.getUint32(q + 4);
              if (sc > 0 && sd > 0) {
                ctx.sttsSamples += sc;
                ctx.sttsDelta += sc * sd;
                if (sc > ctx.domCount) { ctx.domCount = sc; ctx.domDelta = sd; }
              }
            }
          } else if (t === "stsz" && body + 12 <= next) {
            const constSize = dv.getUint32(body + 4);
            ctx.stszSamples = dv.getUint32(body + 8);
            if (!constSize) {
              let q = body + 12, n = 0, tiny = 0;
              while (q + 4 <= next && n < ctx.stszSamples && n < 200000) { if (dv.getUint32(q) <= 64) tiny++; q += 4; n++; }
              ctx.stszRead = n; ctx.tinyCount = tiny;
            }
          } else if (t === "stsd" && body + 16 <= next) {
            const es = body + 8, esz = dv.getUint32(es), eend = Math.min(es + esz, next);
            const vis = { tag: tag(es + 4) };
            let c = es + 8 + 78;
            while (c + 8 <= eend) {
              const csz = dv.getUint32(c), ct = tag(c + 4);
              if (csz < 8) break;
              const cb = c + 8, cend = Math.min(c + csz, eend);
              if (ct === "colr" && cb + 11 <= cend && tag(cb) === "nclx") { vis.prim = dv.getUint16(cb + 4); vis.trc = dv.getUint16(cb + 6); vis.mat = dv.getUint16(cb + 8); }
              else if ((ct === "dvcC" || ct === "dvvC") && cb + 4 <= cend) vis.dv = (u8[cb + 2] >> 1) & 0x7f;
              else if (ct === "hvcC" && cb + 19 <= cend) vis.bits = (u8[cb + 17] & 7) + 8;
              else if (ct === "avcC" && cb + 2 <= cend) { const pr = u8[cb + 1]; vis.bits = pr === 110 || pr === 122 || pr === 244 ? 10 : 8; }
              c += csz;
            }
            ctx.vis = vis;
          }
        }
        p += sz;
      }
    };
    walk(0, u8.byteLength, null);
    out.fps = bestFps; out.dur = bestDur;
  } catch {}
  return out;
}

async function probeMeta(u, cookie) {
  const empty = { fps: null, dur: 0, samples: 0 };
  if (!u || !u.startsWith("http")) return empty;
  try {
    const isTikwm = /tikwm\.com/i.test(u);
    const headers = {
      "User-Agent": UA,
      "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/",
      "Range": "bytes=0-262143",
    };
    if (!isTikwm && cookie) headers["Cookie"] = cookie;
    const r = await fetch(u, { headers, redirect: "follow", signal: AbortSignal.timeout(3500) });
    if (!r.ok && r.status !== 206) return empty;
    return parseMp4Meta(await r.arrayBuffer());
  } catch { return empty; }
}

function methodVerdict(m) {
  if (!m || !m.samples) return "—";
  let v;
  if (m.tiny != null && m.tiny >= 0.2) v = "Ghost Frames / frame injection (probable)";
  else if (m.fps >= 100) v = `High-FPS container (${m.fps} FPS, possible bypass patch)`;
  else v = "Standard re-encode (no bypass signals)";
  return v + (m.big ? " · 64-bit container" : "") + (m.enc ? ` · ${m.enc}` : "");
}

function colorLabel(c) {
  if (!c) return "—";
  if (c.dv != null || /^dv/i.test(c.tag || "")) return `Dolby Vision${c.dv != null ? ` (profile ${c.dv})` : ""}`;
  let n = "SDR";
  if (c.trc === 16) n = "HDR10 (PQ)"; else if (c.trc === 18) n = "HLG";
  const sp = c.prim === 9 ? "BT.2020" : c.prim === 1 ? "BT.709" : c.prim ? `primaries ${c.prim}` : "";
  return [n, c.bits ? `${c.bits}-bit` : "", sp].filter(Boolean).join(" · ");
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

  // Fotos / carruseles
  const webImgs = (it.imagePost?.images || []).map((i) => firstUrl(i.imageURL || i.imageUrl)).filter(Boolean);
  const images = webImgs.length ? webImgs : (Array.isArray(w.images) ? w.images.filter((x) => typeof x === "string" && x.startsWith("http")) : []);

  // Técnico (MP4) + visibilidad
  const meta = probed.meta || null;
  const maxBytes = Math.max(0, ...streams.map((s) => s.bytes || 0));
  const tech = {
    method: methodVerdict(meta),
    pacing: !meta || meta.vfr == null ? "—" : meta.vfr ? "⚠️ VFR (Variable)" : "CFR (Constant)",
    color: colorLabel(meta?.color),
    c2pa: !meta ? "—" : meta.c2pa ? "Found" : "Not found (header only)",
    weight: maxBytes ? `${(maxBytes / 1048576).toFixed(1)} MB${maxBytes > 100 * 1048576 ? " ⚠️ >100 MB may lag on mid-range phones" : " ✅"}` : "—",
  };
  const flags = {
    known: !!scraped,
    private: !!(it.privateItem || it.secret),
    aigc: Number(mv?._info?.aigc || 0) > 0 || Number(it.aigcLabelType || 0) > 0 || !!(it.AIGCDescription || it.aigcDescription) || it.IsAigc === true || it.isAigc === true,
    commentsOff: Number(it.itemCommentStatus || 0) !== 0,
    duetOff: it.duetEnabled === false,
    stitchOff: it.stitchEnabled === false,
    ad: !!mv?._info?.ad || !!(it.isAd || it.isCommerce || it.commerceInfo?.adAuthorization || Number(it.commerceInfo?.brandedContentType || 0) > 0),
    verified: !!au.verified,
  };

  const d = {
    id: it.id || w.id || videoId(url) || "",
    url,
    author: (au.nickname || w.author?.nickname || "").trim() || au.uniqueId || w.author?.unique_id || "",
    username: au.uniqueId || w.author?.unique_id || "",
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
    categories: cats, tips, streams, images, tech, flags,
    links: {
      hd: hdLink, sd: sdLink, music: musicLink,
      cover: abs(w.origin_cover || w.cover) || v.originCover || v.cover || firstUrl(mv?.origin_cover) || firstUrl(mv?.cover) || images[0] || "",
    },
    ok: { tiktok: !!scraped, tikwm: !!Object.keys(w).length },
  };
  Object.defineProperty(d, "_dlCandidates", {
    value: [...new Set([abs(w.hdplay), abs(w.play), mvHd, mvSd, webHd, webSd, abs(w.wmplay)].filter(Boolean))],
    enumerable: false, writable: true,
  });
  Object.defineProperty(d, "_cookie", { value: it._cookie || "", enumerable: false, writable: true });
  d.report = report(d);
  d.reportHtml = report(d, true);
  d.errors = errs || {};
  return d;
}

function report(d, html = false) {
  const s = d.stats, seg = [], f = d.flags;
  const L = (...x) => seg.push(...x);
  const ce = (icon, id) => `\uE000${id}|${icon}\uE001`;
  const onoff = (off) => (f.known ? (off ? "Off" : "On") : "—");
  const yn = (b) => (f.known ? (b ? "Yes ⚠️" : "No") : "—");
  L(`${ce("📹", "5258077307985207053")} VIDEO • ANALYTICS`, "");
  L(`${ce("🎵", "5258289810082111221")}${ce("📸", "5258205968025525531")} ${d.author}  ${ce("🗓", "5258105663359294787")} ${d.date}`);
  if (d.desc) seg.push({ quote: [d.desc] });
  L(`${ce("🎵", "5258289810082111221")} ${d.music.title} - ${d.music.author} • ${d.music.duration}`, "");
  L("📊 Statistics");
  L(`  • ${ce("👁", "5253959125838090076")} ${num(s.views)} Views`, `  • ${ce("❤️", "5258179403652801593")} ${num(s.likes)} Likes`, `  • ${ce("💬", "5258215846450305872")} ${num(s.comments)} Comments`);
  L(`  • ${ce("⭐️", "5258185631355378853")} ${num(s.favorites)} Favorites`, `  • ${ce("➡️", "5260450573768990626")} ${num(s.shares)} Shares`, `  • ${ce("⬇️", "5258336354642697821")} ${num(s.downloads)} Downloads`);
  L(`  • ${ce("📈", "5258391025281408576")} ER | ${s.er}%`, "");
  L(`${ce("ℹ️", "5258503720928288433")} Information`);
  L(`  • 🗂 ID | ${d.id}`, `  • 🔗 Source | ${d.source}`);
  L(`  • ${ce("📍", "5258509201306557640")} Region | ${d.region.flag} ${d.region.name}`, `  • 👻 Shadow ban | ${d.shadowBan}`, "");
  L(
    `${ce("⭐️", "5258185631355378853")} Quality`,
    `  • 🌐 Browser | ${d.browserRes}`,
    `  • 📱 Phone | ${d.phoneRes}`,
    `  • 📶 Bitrate | ${d.bitrate}`,
    `  • 🎬 Codec | ${d.codec}`,
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
  L(` ┃ Original | ${d.original.w}x${d.original.h}`, ` ┃ VQ Score | ${d.vq ?? "—"}`, "");
  L(
    "🧬 Technical",
    `  • 🧬 Method | ${d.tech.method}`,
    `  • 🎯 Frame Pacing | ${d.tech.pacing}`,
    `  • 🎨 Color | ${d.tech.color}`,
    `  • 📦 Weight | ${d.tech.weight}`,
    "",
    "🛡 Visibility",
    `  • ${ce("👀", "5260341314095947411")} Visibility | ${f.known ? (f.private ? "PRIVATE ⚠️" : "PUBLIC") : "—"}`,
    `  • ${ce("🤖", "5258093637450866522")} AI Label | ${yn(f.aigc)}`,
    `  • 🔏 C2PA | ${d.tech.c2pa}`,
    `  • ${ce("💬", "5258215846450305872")} Comments | ${onoff(f.commentsOff)}`,
    `  • ${ce("🎭", "5258430848218176413")} Duet | ${onoff(f.duetOff)}`,
    `  • ✂️ Stitch | ${onoff(f.stitchOff)}`,
    `  • 📢 Ad / Promo | ${yn(f.ad)}`,
    `  • ☑️ Verified | ${f.known ? (f.verified ? "Yes" : "No") : "—"}`,
    "",
  );
  if (d.categories.length) L(`${ce("🏷", "5296348778012361146")} Categories`, ...d.categories.map((c) => ` ┃ ${c}`), "");
  if (d.tips.length) L(`${ce("💡", "5258216851472654189")} Tips`, ...d.tips.map((c) => ` ┃ ${c}`), "");
  L(`${ce("⚡️", "5258152182150077732")}Shura RTX® | Downloader & Checker`);
  return seg.map((x) => typeof x === "string"
    ? (html ? esc(x) : x)
    : (html ? `<blockquote expandable>${(x.rawHtml ? x.quote : x.quote.map(esc)).join("\n")}</blockquote>` : x.quote.join("\n"))
  ).join("\n").replace(/\uE000(\d+)\|([\s\S]*?)\uE001/g, (_, id, icon) =>
    html ? `<tg-emoji emoji-id="${id}">${icon}</tg-emoji>` : icon
  );
}

async function analyze(rawUrl) {
  const url = await resolveUrl(rawUrl);
  let id = videoId(url);
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
  const probed = { gears: {}, max: null, hd: null, sd: null, pas: null, dur: 0, meta: null };
  const hasMobileFps = (mv?.bit_rate || []).some((x) => x.FPS);

  const cand = [];
  for (const br of (it.video?.bitrateInfo || []).slice(0, 4)) {
    const u = firstUrl(br.PlayAddr);
    if (u && br.GearName) cand.push({ k: "gear", gear: br.GearName, url: u, cookie });
  }
  const pasUrl = firstUrl(it.video?.PlayAddrStruct) || firstUrl(it.video?.playAddr);
  if (pasUrl) cand.push({ k: "pas", url: pasUrl, cookie });
  const hdUrl = abs(w.hdplay), sdUrl = abs(w.play);
  if (hdUrl) cand.push({ k: "hd", url: hdUrl, cookie: "" });
  else if (sdUrl) cand.push({ k: "sd", url: sdUrl, cookie: "" });

  const list = hasMobileFps ? cand.slice(0, 1) : cand;
  const metas = [];
  await Promise.allSettled(list.map(async (cd, i) => {
    const m = await probeMeta(cd.url, cd.cookie);
    if (m.fps) {
      if (cd.k === "gear") probed.gears[cd.gear] = m.fps;
      else if (cd.k === "pas") probed.pas = m.fps;
      else probed[cd.k] = m.fps;
      probed.max = Math.max(probed.max || 0, m.fps);
    }
    if (m.dur > 0) probed.dur = Math.max(probed.dur || 0, m.dur);
    if (m.samples) metas.push({ i, m });
  }));
  metas.sort((x, y) => x.i - y.i);
  probed.meta = metas[0]?.m || null;

  return build(a.value, b.value, url, a.status === "fulfilled", { tiktok: a.reason?.message || null, tikwm: b.reason?.message || null, mobile: c.reason?.message || null }, c.value, probed);
}

/* ---------- Caché 5 min: memoria del isolate + Cache API (solo funciona con dominio propio) ---------- */
const MEM = new Map();
const TTL = 300000;
const memGet = (k) => { const e = MEM.get(k); if (e && Date.now() - e.t < TTL) return e.v; MEM.delete(k); return null; };
const memSet = (k, v) => { MEM.set(k, { t: Date.now(), v }); if (MEM.size > 40) MEM.delete(MEM.keys().next().value); };
const ser = (d) => ({ ...d, _dl: d._dlCandidates, _ck: d._cookie });
const unser = (j) => {
  const { _dl, _ck, ...d } = j;
  Object.defineProperty(d, "_dlCandidates", { value: _dl || [], enumerable: false, writable: true });
  Object.defineProperty(d, "_cookie", { value: _ck || "", enumerable: false, writable: true });
  return d;
};
async function analyzeCached(raw) {
  const url = await resolveUrl(raw);
  const id = videoId(url);
  if (!id) return analyze(url);
  const k = "a:" + id;
  const hit = memGet(k);
  if (hit) return hit;
  const ck = new Request("https://cache.shura.invalid/" + k);
  try {
    const c = await caches.default.match(ck);
    if (c) { const d = unser(await c.json()); memSet(k, d); return d; }
  } catch {}
  const d = await analyze(url);
  memSet(k, d);
  try { await caches.default.put(ck, new Response(JSON.stringify(ser(d)), { headers: { "Cache-Control": "max-age=300" } })); } catch {}
  return d;
}

/* ---------- Salud de cuenta + mejores horas ---------- */
async function scrapeUser(user) {
  const r = await fetch(`https://www.tiktok.com/@${encodeURIComponent(user)}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(6000),
  });
  const m = (await r.text()).match(REHYDRATE);
  if (!m) throw new Error("perfil sin datos");
  const ui = JSON.parse(m[1]).__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
  if (!ui) throw new Error("userInfo no encontrado");
  return ui;
}
const TW_H = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  "Cookie": "current_language=en",
  "Referer": "https://www.tikwm.com/",
};
async function tikwmPosts(params, get = false) {
  const once = async () => {
    const q = new URLSearchParams({ count: "35", cursor: "0", ...params });
    const r = get
      ? await fetch(`https://www.tikwm.com/api/user/posts?${q}`, { headers: TW_H, signal: AbortSignal.timeout(4500) })
      : await fetch("https://www.tikwm.com/api/user/posts", { method: "POST", headers: TW_H, body: q, signal: AbortSignal.timeout(4500) });
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch { throw new Error(t.trim().startsWith("<") ? `TikWM devolvió HTML (HTTP ${r.status})` : "TikWM sin respuesta"); }
    if (j.code !== 0) throw new Error(j.msg || "TikWM error");
    return j.data?.videos || [];
  };
  try { return await once(); }
  catch (e) { if (/limit/i.test(e.message)) { await sleep(1200); return await once(); } throw e; }
}
async function mobilePosts(secUid) {
  const q = new URLSearchParams({
    sec_user_id: secUid, count: "35", max_cursor: "0", iid: "7318518857994389254", device_id: "7318517321748022790",
    channel: "googleplay", app_name: "musical_ly", version_code: "300904", device_platform: "android", device_type: "ASUS_Z01QD", os_version: "9", aid: "1180",
  });
  const r = await fetch(`https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/aweme/post/?${q}`, { headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(4000) });
  let j;
  try { j = JSON.parse(await r.text()); } catch { throw new Error("API móvil sin respuesta"); }
  return (j.aweme_list || []).map((a) => ({
    create_time: a.create_time, play_count: a.statistics?.play_count, digg_count: a.statistics?.digg_count,
    comment_count: a.statistics?.comment_count, share_count: a.statistics?.share_count, collect_count: a.statistics?.collect_count, is_top: a.is_top,
  }));
}

const compact = (n) => {
  n = Number(n || 0);
  const f = (x, u) => x.toFixed(1).replace(/\.0$/, "") + u;
  return n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "K") : String(Math.round(n));
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function bestTimesHtml(user, raw, reason = "") {
  const link = `<a href="https://www.tiktok.com/@${esc(user)}">@${esc(user)}</a>`;
  const head = `<b>Best upload times</b> - ${link}`;
  let vids = (raw || []).map((v) => ({
    t: Number(v.create_time || 0), views: Number(v.play_count || 0), pinned: !!v.is_top,
    eng: Number(v.digg_count || 0) + Number(v.comment_count || 0) + Number(v.share_count || 0) + Number(v.collect_count || 0),
  })).filter((v) => v.t > 0 && v.views > 0);
  const rec = vids.filter((v) => !v.pinned);
  vids = rec.length ? rec : vids;
  if (!vids.length) {
    return `${head}\n\nℹ️ No pude leer las publicaciones recientes${reason ? ` (${esc(reason)})` : ""}. Puede ser una cuenta privada o un bloqueo de la fuente de datos.`;
  }
  const n = vids.length;
  const conf = n >= 30 ? "high" : n >= 15 ? "medium" : "low";
  const slots = new Map();
  for (const v of vids) {
    const d = new Date(v.t * 1000), k = `${d.getUTCDay()}|${d.getUTCHours()}`;
    if (!slots.has(k)) slots.set(k, { day: d.getUTCDay(), hour: d.getUTCHours(), er: [], views: 0 });
    const sl = slots.get(k);
    sl.er.push((v.eng / v.views) * 100);
    sl.views += v.views;
  }
  const ranked = [...slots.values()]
    .map((x) => ({ ...x, avg: x.er.reduce((a, b) => a + b, 0) / x.er.length, n: x.er.length }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n || b.views - a.views)
    .slice(0, 5);
  const hh = (h) => String(h).padStart(2, "0") + ":00";
  const lines = ranked.map((x, i) =>
    `${i + 1}. ${DAYS[x.day]} ${hh(x.hour)}–${hh((x.hour + 1) % 24)} UTC\n   <b>${+x.avg.toFixed(2)}%</b> engagement · ${x.n} post${x.n > 1 ? "s" : ""}`);
  return `${head}\n<i>Based on ${n} recent videos · ${conf} confidence</i>\n\n${lines.join("\n")}\n\n⚡️Shura RTX®`;
}

async function accountBest(user) {
  let ui = null, uerr = "";
  try { ui = await scrapeUser(user); } catch (e) { uerr = e.message; }
  const attempts = [
    () => tikwmPosts({ unique_id: "@" + user }),
    () => tikwmPosts({ unique_id: "@" + user }, true),
    ...(ui?.user?.id ? [() => tikwmPosts({ user_id: ui.user.id })] : []),
    ...(ui?.user?.secUid ? [() => mobilePosts(ui.user.secUid)] : []),
  ];
  let vids = [];
  const errs = [];
  for (const run of attempts) {
    try { vids = await run(); if (vids.length) break; errs.push("sin videos"); }
    catch (e) { errs.push(e.message); }
  }
  const reason = [...new Set(errs)].join(" / ");
  if (!vids.length && !ui && uerr) throw new Error(`perfil: ${uerr} | posts: ${reason}`);
  return bestTimesHtml(user, vids, vids.length ? "" : reason);
}

/* ---------- Telegram ---------- */
const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
const tgForm = (env, method, form) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body: form }).then((r) => r.json());

function previewCaption(d, withAction = true) {
  const desc = [...(d.desc || "")].slice(0, 550).join("");
  const s = d.stats;
  const head = d.images?.length
    ? `📸 <b>PHOTOS</b> · ${d.images.length}`
    : `📹 <b>VIDEO</b> · ${mmss(d.duration || 0)}${d.fps ? ` · ${d.fps} FPS` : ""}`;
  return `${head}\n\n👤 <b>${esc(d.author)}</b>  🗓 ${esc(d.date)}  📍 ${d.region.flag} ${esc(d.region.name)}\n` +
    (desc ? `<blockquote expandable>${esc(desc)}</blockquote>\n` : "") +
    `👁 ${compact(s.views)}  ❤️ ${compact(s.likes)}  💬 ${compact(s.comments)}  ⭐️ ${compact(s.favorites)}` +
    (withAction ? "\n\n👇 <b>Choose an action</b>" : "");
}

function keyboard(d) {
  const rows = [];
  if (!d.images?.length) rows.push([{ text: "▶️ Download Original Video", callback_data: `v|${d.id}|${d.username}`.slice(0, 64) }]);
  rows.push([{ text: "📊 Check Stats", callback_data: `s|${d.id}|${d.username}`.slice(0, 64) }]);
  if (d.username) rows.push([{ text: `👤 @${d.username} ↗️`, url: `https://www.tiktok.com/@${d.username}` }]);
  return { inline_keyboard: rows };
}

async function sendAlbum(env, chat, urls, cap) {
  for (let i = 0; i < urls.length; i += 10) {
    const chunk = urls.slice(i, i + 10);
    if (chunk.length === 1) {
      await tg(env, "sendPhoto", { chat_id: chat, photo: chunk[0], ...(i === 0 ? { caption: cap, parse_mode: "HTML" } : {}) });
      continue;
    }
    const media = chunk.map((u, j) => ({ type: "photo", media: u, ...(i === 0 && j === 0 ? { caption: cap, parse_mode: "HTML" } : {}) }));
    const r = await tg(env, "sendMediaGroup", { chat_id: chat, media });
    if (r.ok) continue;
    const f = new FormData();
    f.append("chat_id", String(chat));
    const att = [];
    for (let j = 0; j < chunk.length; j++) {
      try {
        const x = await fetch(chunk[j], { headers: { "User-Agent": UA, "Referer": "https://www.tiktok.com/" }, signal: AbortSignal.timeout(8000) });
        if (!x.ok) continue;
        f.append(`f${j}`, new Blob([await x.arrayBuffer()], { type: "image/jpeg" }), `p${j}.jpg`);
        att.push({ type: "photo", media: `attach://f${j}`, ...(i === 0 && att.length === 0 ? { caption: cap, parse_mode: "HTML" } : {}) });
      } catch {}
    }
    if (att.length >= 2) { f.append("media", JSON.stringify(att)); await tgForm(env, "sendMediaGroup", f); }
  }
}

async function sendFile(env, chat, d, origin) {
  const candidates = d._dlCandidates?.length ? d._dlCandidates : [d.links.hd, d.links.sd].filter(Boolean);
  const big = `${origin}/dl?url=${encodeURIComponent(d.url)}`;
  const bigKb = { inline_keyboard: [[{ text: "⬇️ Descargar original (sin límite)", url: big }]] };
  const fail = (t) => tg(env, "sendMessage", { chat_id: chat, text: t, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: bigKb });
  if (!candidates.length) return fail("❌ No encontré un enlace de descarga para este video.");
  const MAX = 48 * 1048576;
  let oversizeMb = 0;

  for (const link of candidates) {
    try {
      const isTikwm = /tikwm\.com/i.test(link);
      const headers = { "User-Agent": UA, "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/" };
      if (!isTikwm && d._cookie) headers["Cookie"] = d._cookie;
      const r = await fetch(link, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json") || ct.includes("text/html")) continue;
      const size = Number(r.headers.get("content-length") || 0);
      if (size > MAX) { oversizeMb = Math.max(oversizeMb, Math.round(size / 1048576)); try { r.body?.cancel(); } catch {} continue; }
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX) { oversizeMb = Math.max(oversizeMb, Math.round(buf.byteLength / 1048576)); continue; }
      if (buf.byteLength < 4096) continue;
      const f = new FormData();
      f.append("chat_id", String(chat));
      f.append("video", new Blob([buf], { type: "video/mp4" }), `${d.id || "video"}.mp4`);
      f.append("supports_streaming", "true");
      let cap = "⚡️Shura RTX® | Downloader & Checker";
      if (oversizeMb) {
        cap += `\n⚠️ Versión de ${(buf.byteLength / 1048576).toFixed(0)} MB: la original pesa ${oversizeMb} MB y Telegram limita a 50 MB a los bots.`;
        f.append("reply_markup", JSON.stringify(bigKb));
      }
      f.append("caption", cap);
      const res = await tgForm(env, "sendVideo", f);
      if (res.ok) return res;
    } catch {}
  }

  if (oversizeMb) return fail(`⚠️ El video pesa ${oversizeMb} MB y Telegram no deja que los bots envíen más de 50 MB. Descárgalo con este enlace (sin límite):`);
  for (const link of candidates) {
    try {
      const res = await tg(env, "sendVideo", { chat_id: chat, video: link, supports_streaming: true, caption: "⚡️Shura RTX® | Downloader & Checker" });
      if (res.ok) return res;
    } catch {}
  }
  return fail("❌ No pude enviar el video por Telegram. Descárgalo con este enlace:");
}

async function handleCallback(cq, env, origin) {
  const chat = cq.message?.chat?.id;
  const [k, id, user] = (cq.data || "").split("|");
  if (!["s", "v", "b"].includes(k) || !chat || !id) return tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  const txt = k === "v" ? "Descargando video…" : k === "b" ? "Calculando mejores horas…" : "Analizando…";
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: txt });
  try {
    if (k === "b") {
      return await tg(env, "sendMessage", { chat_id: chat, text: await accountBest(id), parse_mode: "HTML", disable_web_page_preview: true });
    }
    if (k === "v") await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video" });
    const d = await analyzeCached(`https://www.tiktok.com/@${user || "_"}/video/${id}`);
    if (k === "v") return await sendFile(env, chat, d, origin);
    const rows = [];
    if (!d.images?.length) rows.push([{ text: "▶️ Download Original Video", callback_data: `v|${d.id}|${d.username}`.slice(0, 64) }]);
    if (d.username) rows.push([{ text: "⏰ Check Your Best Upload Times", callback_data: `b|${d.username}`.slice(0, 64) }]);
    await tg(env, "sendMessage", {
      chat_id: chat, text: d.reportHtml, parse_mode: "HTML", disable_web_page_preview: true,
      reply_to_message_id: cq.message.message_id, allow_sending_without_reply: true,
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    });
  } catch (e) {
    await tg(env, "sendMessage", { chat_id: chat, text: "❌ " + esc(e.message), parse_mode: "HTML" });
  }
}

async function handleInline(iq, env, origin) {
  const empty = () => tg(env, "answerInlineQuery", { inline_query_id: iq.id, results: [], cache_time: 1 });
  const m = (iq.query || "").match(TT);
  if (!m) return empty();
  try {
    const d = await analyzeCached(m[0]);
    const kb = { inline_keyboard: [
      ...(d.images?.length ? [] : [[{ text: "▶️ Download", url: `${origin}/dl?url=${encodeURIComponent(d.url)}` }]]),
      ...(d.username ? [[{ text: `👤 @${d.username} ↗️`, url: `https://www.tiktok.com/@${d.username}` }]] : []),
    ] };
    const th = d.links.cover && d.links.cover.startsWith("http") ? { thumbnail_url: d.links.cover } : {};
    const desc = `👁 ${compact(d.stats.views)} · ❤️ ${compact(d.stats.likes)} · ${d.region.flag} ${d.region.name}`;
    await tg(env, "answerInlineQuery", {
      inline_query_id: iq.id, cache_time: 60,
      results: [
        { type: "article", id: "p" + d.id, title: `📹 ${d.author}`, description: desc, ...th,
          input_message_content: { message_text: previewCaption(d, false), parse_mode: "HTML" }, reply_markup: kb },
        { type: "article", id: "s" + d.id, title: "📊 Full report", description: "Shura RTX® analytics", ...th,
          input_message_content: { message_text: d.reportHtml, parse_mode: "HTML", disable_web_page_preview: true } },
      ],
    });
  } catch { await empty(); }
}

async function handleUpdate(update, env, origin) {
  if (update.callback_query) return handleCallback(update.callback_query, env, origin);
  if (update.inline_query) return handleInline(update.inline_query, env, origin);
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  const chat = msg.chat.id;
  const send = (text, extra = {}) =>
    tg(env, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

  if (/^\/start/.test(msg.text)) {
    return send("⚡️ <b>Shura RTX® | Downloader &amp; Checker</b>\n\nEnvíame un enlace de TikTok (video o fotos) y te devuelvo la vista previa, el análisis completo y la descarga sin marca de agua. También puedes enviar <code>@usuario</code> para ver sus mejores horas para publicar.");
  }
  const pm = msg.text.trim().match(PROFILE);
  if (pm) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
    try { return await send(await accountBest(pm[1])); }
    catch (e) { return send("❌ No pude analizar esa cuenta: " + esc(e.message)); }
  }
  const m = msg.text.match(TT);
  if (!m) return send("Envía un enlace válido de TikTok (tiktok.com o vm.tiktok.com).");

  await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video" });
  try {
    const d = await analyzeCached(m[0]);
    const kb = keyboard(d);
    if (d.images?.length) {
      await sendAlbum(env, chat, d.images, previewCaption(d, false));
      return await send("👇 <b>Choose an action</b>", { reply_markup: kb });
    }
    const cap = previewCaption(d);
    let r = { ok: false };
    if (d.links.cover && d.links.cover.startsWith("http")) {
      r = await tg(env, "sendPhoto", { chat_id: chat, photo: d.links.cover, caption: cap, parse_mode: "HTML", reply_markup: kb });
    }
    if (!r.ok) await send(cap, { reply_markup: kb });
  } catch (e) {
    await send("❌ No pude analizar ese enlace: " + esc(e.message));
  }
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (u.pathname === "/api") {
      const target = u.searchParams.get("url") || "";
      if (!TT.test(target)) return json({ ok: false, error: "Enlace de TikTok inválido" }, 400);
      try { return json({ ok: true, ...(await analyzeCached(target.match(TT)[0])) }); }
      catch (e) { return json({ ok: false, error: e.message }, 502); }
    }

    if (u.pathname === "/dl") {
      const target = u.searchParams.get("url") || "";
      if (!target) return json({ ok: false, error: "Falta parámetro url" }, 400);
      try {
        let dlUrl = target, cookie = "", id = "video";
        if (TT.test(target)) {
          const d = await analyzeCached(target.match(TT)[0]);
          dlUrl = d.links.hd || d.links.sd || d._dlCandidates?.[0] || "";
          cookie = d._cookie || "";
          id = d.id || "video";
        }
        if (!dlUrl || !dlUrl.startsWith("http")) return json({ ok: false, error: "No se encontró enlace de video" }, 404);
        const isTikwm = /tikwm\.com/i.test(dlUrl);
        const headers = { "User-Agent": UA, "Referer": isTikwm ? "https://www.tikwm.com/" : "https://www.tiktok.com/" };
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
        webFlags: a.status === "fulfilled" ? cut({ aigcLabelType: a.value.aigcLabelType, AIGCDescription: a.value.AIGCDescription, itemCommentStatus: a.value.itemCommentStatus, duetEnabled: a.value.duetEnabled, stitchEnabled: a.value.stitchEnabled, isAd: a.value.isAd, commerceInfo: a.value.commerceInfo, verified: a.value.author?.verified }) : null,
        mobile: b.status === "fulfilled" ? cut(b.value) : String(b.reason?.message),
      });
    }

    if (u.pathname === "/webhook" && req.method === "POST") {
      let update;
      try { update = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
      ctx.waitUntil(handleUpdate(update, env, u.origin).catch(() => {}));
      return new Response("ok");
    }

    if (u.pathname === "/setup") {
      if (!env.BOT_TOKEN) return page("<h2>❌ Falta la variable BOT_TOKEN en Cloudflare</h2>", 500);
      const set = await tg(env, "setWebhook", {
        url: `${u.origin}/webhook`, allowed_updates: ["message", "edited_message", "callback_query", "inline_query"], drop_pending_updates: true,
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
