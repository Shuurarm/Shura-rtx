
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
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n) => Number(n || 0).toLocaleString("en-US");
const TT = /https?:\/\/(?:[\w-]+\.)?tiktok\.com\/[^\s]+/i;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const abs = (u) => (!u ? "" : u.startsWith("http") ? u : "https://www.tikwm.com" + u);

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
  const t = await r.text();
  const m = t.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("TikTok no devolvió datos embebidos");
  const it = JSON.parse(m[1]).__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!it) throw new Error("itemStruct no encontrado");
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
const videoId = (u) => (String(u).match(/\/(?:video|photo)\/(\d+)/) || [])[1];

async function mobile(id) {
  const q = new URLSearchParams({ aweme_id: id, iid: "7318518857994389254", device_id: "7318517321748022790", channel: "googleplay", app_name: "musical_ly", version_code: "300904", device_platform: "android", device_type: "ASUS_Z01QD", os_version: "9", aid: "1180" });
  const r = await fetch(`https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?${q}`, { headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(3000) });
  const j = await r.json();
  const a = (j.aweme_list || []).find((x) => x.aweme_id === id);
  if (!a || !a.video) throw new Error("API móvil sin datos");
  return a.video;
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

function build(it, w, url, scraped, errs, mv) {
  it = it || {}; w = w || {};
  const v = it.video || {}, st = it.stats || {}, au = it.author || {}, mu = it.music || {};
  const dur = Number(v.duration || 0) || Math.round(Number(mv?.duration || 0) / 1000);

  // Detección ampliada de FPS en las fuentes de TikTok.
  const normalizeFps = (value) => {
    if (value == null || value === "") return null;

    const str = String(value).trim();
    const fraction = str.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    let n;

    if (fraction) {
      const denominator = Number(fraction[2]);
      n = denominator ? Number(fraction[1]) / denominator : NaN;
    } else {
      n = Number(str.replace(/[^\d.]/g, ""));
    }

    return Number.isFinite(n) && n >= 1 && n <= 240
      ? Math.round(n * 100) / 100
      : null;
  };

  const fpsOf = (b) => {
    if (!b) return null;

    const direct = normalizeFps(
      b.FPS ?? b.fps ?? b.frame_rate ?? b.frameRate
    );
    if (direct) return direct;

    for (const raw of [
      b.VideoExtra,
      b.video_extra,
      b.videoExtra,
      b.extra
    ]) {
      if (!raw) continue;

      try {
        const x = typeof raw === "string" ? JSON.parse(raw) : raw;
        const fps = normalizeFps(
          x?.fps ?? x?.FPS ?? x?.frame_rate ?? x?.frameRate ?? x?.video_fps
        );
        if (fps) return fps;
      } catch {}
    }

    return null;
  };

  const fpsMap = {};
  let maxFps = null;

  for (const b of (mv?.bit_rate || [])) {
    const fps = fpsOf(b);
    if (fps) {
      fpsMap[b.gear_name] = fps;
      maxFps = Math.max(maxFps || 0, fps);
    }
  }

  const streams = (v.bitrateInfo || []).map((b) => {
    const pa = b.PlayAddr || {};
    return {
      gear: b.GearName || "", src: "web", quality: b.QualityType ?? null,
      w: pa.Width || 0, h: pa.Height || 0,
      fps: fpsOf(b) || fpsMap[b.GearName] || normalizeFps(v.fps) || maxFps || null,
      bps: b.Bitrate || 0,
      codec: /265|hevc|bytevc1/i.test(b.CodecType || "") ? "hevc" : "h264",
      bytes: Number(pa.DataSize || 0), vq: b.VQScore ?? null,
    };
  });

  const pas = v.PlayAddrStruct;
  if (pas && (pas.DataSize || pas.Width)) {
    const bytes = Number(pas.DataSize || 0);
    streams.push({
      gear: "play_addr", src: "web", quality: null,
      w: pas.Width || v.width || 0, h: pas.Height || v.height || 0,
      fps: normalizeFps(v.fps) || maxFps || null,
      bps: Number(v.bitrate || 0) || (dur ? Math.round((bytes * 8) / dur) : 0),
      codec: /265|hevc/i.test(v.codecType || "") ? "hevc" : "h264", bytes, vq: null,
    });
  }

  if (mv) {
    const mk = (gear, pa, x = {}) => {
      if (!pa || !(pa.width || pa.data_size)) return;
      const bytes = Number(pa.data_size || 0);
      streams.push({
        gear, src: "phone", quality: null, w: pa.width || 0, h: pa.height || 0,
        fps: normalizeFps(x.fps) || maxFps || null,
        bps: x.bps || (dur ? Math.round((bytes * 8) / dur) : 0),
        codec: x.codec || (/bytevc1|265/i.test(gear) ? "hevc" : "h264"), bytes, vq: null,
      });
    };

    mk("play_addr", mv.play_addr, { codec: mv.is_bytevc1 ? "hevc" : "h264" });
    mk("play_addr_h264", mv.play_addr_h264, { codec: "h264" });
    mk("play_addr_bytevc1", mv.play_addr_bytevc1, { codec: "hevc" });

    for (const b of (mv.bit_rate || [])) {
      mk(b.gear_name || "bit_rate", b.play_addr, {
        fps: fpsOf(b),
        bps: Number(b.bit_rate || 0),
        codec: b.is_bytevc1 || b.is_h265 ? "hevc" : "h264"
      });
    }
  }

  streams.sort((a, b) => b.h - a.h || b.bps - a.bps);
  const top = streams[0] || null;
  const webTop = streams.find((s) => s.src === "web") || top;
  const phoneTop = streams.find((s) => s.src === "phone") || top;
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

  const d = {
    id: it.id || w.id || "",
    url,
    author: (au.nickname || w.author?.nickname || "").trim() || au.uniqueId || w.author?.unique_id || "",
    username: au.uniqueId || w.author?.unique_id || "",
    avatar: au.avatarMedium || au.avatarThumb || abs(w.author?.avatar) || "",
    duration: Number(v.duration || w.duration || 0),
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
    browserRes: webTop ? `${Math.min(webTop.w, webTop.h)}p${webTop.fps || ""}` : "—",
    phoneRes: phoneTop ? baseRes(phoneTop) + (phoneTop.fps ? ` ${phoneTop.fps} FPS` : "") : "—",
    top, vq,
    original: { w: v.width || top?.w || 0, h: v.height || top?.h || 0 },
    categories: cats, tips, streams,
    links: {
      hd: abs(w.hdplay), sd: abs(w.play), music: abs(w.music),
      cover: abs(w.origin_cover || w.cover) || v.originCover || v.cover || "",
    },
    ok: { tiktok: !!scraped, tikwm: !!Object.keys(w).length },
  };

  d.report = report(d);
  d.reportHtml = report(d, true);
  d.errors = errs || {};
  return d;
}

function report(d, html = false) {
  const s = d.stats, seg = [];
  const L = (...x) => seg.push(...x);
  L("📹 VIDEO • ANALYTICS", "");
  L(`🎵📸 ${d.author}  🗓 ${d.date}`);
  if (d.desc) L(d.desc);
  L(`🎵 ${d.music.title} - ${d.music.author} • ${d.music.duration}`, "");
  L("📊 Statistics");
  L(`  • 👁 ${num(s.views)} Views`, `  • ❤️ ${num(s.likes)} Likes`, `  • 💬 ${num(s.comments)} Comments`);
  L(`  • ⭐️ ${num(s.favorites)} Favorites`, `  • ➡️ ${num(s.shares)} Shares`, `  • ⬇️ ${num(s.downloads)} Downloads`);
  L(`  • 📈 ER | ${s.er}%`, "");
  L("ℹ️ Information");
  L(`  • 🗂 ID | ${d.id}`, `  • 🔗 Source | ${d.source}`);
  L(`  • 📍 Region | ${d.region.flag} ${d.region.name}`, `  • 👻 Shadow ban | ${d.shadowBan}`, "");
  L("⭐️ Quality", `  • 🌐 Browser | ${d.browserRes}`, `  • 📱 Phone | ${d.phoneRes}`);
  if (d.streams.length) {
    const groups = new Map();
    for (const t of d.streams) {
      const k = `${resLabel(t)}|${(t.bps / 1e6).toFixed(1)}|${t.codec}|${(t.bytes / 1048576).toFixed(1)}`;
      if (!groups.has(k)) groups.set(k, { t, gears: [] });
      groups.get(k).gears.push((t.src === "phone" ? "📱" : "🌐") + (t.gear || "play_addr"));
    }
    const q = [];
    for (const { t, gears } of groups.values()) {
      if (q.length) q.push("");
      q.push([...new Set(gears)].join("  "));
      q.push(`${resLabel(t)} • ${(t.bps / 1e6).toFixed(1)} MBps • ${t.codec} • ${(t.bytes / 1048576).toFixed(1)} MB`);
    }
    seg.push({ quote: q });
  }
  L(` ┃ Original | ${d.original.w}x${d.original.h}`, ` ┃ VQ Score | ${d.vq ?? "—"}`, "");
  if (d.categories.length) L("🏷 Categories", ...d.categories.map((c) => ` ┃ ${c}`), "");
  if (d.tips.length) L("💡 Tips", ...d.tips.map((c) => ` ┃ ${c}`), "");
  L("⚡️Shura RTX® | Downloader & Checker");
  return seg.map((x) => typeof x === "string"
    ? (html ? esc(x) : x)
    : (html ? `<blockquote expandable>${x.quote.map(esc).join("\n")}</blockquote>` : x.quote.join("\n"))
  ).join("\n");
}

async function analyze(rawUrl) {
  const url = await resolveUrl(rawUrl);
  const id = videoId(url);
  const [a, b, c] = await Promise.allSettled([scrape(url), tikwm(url), id ? mobile(id) : Promise.reject(new Error("sin id"))]);
  if (a.status === "rejected" && b.status === "rejected") {
    throw new Error(`TikTok: ${a.reason?.message} | TikWM: ${b.reason?.message}`);
  }
  return build(a.value, b.value, url, a.status === "fulfilled", { tiktok: a.reason?.message || null, tikwm: b.reason?.message || null, mobile: c.reason?.message || null }, c.value);
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
  return `📹 <b>VIDEO</b> · ${mmss(d.duration || 0)}\n\n👤 <b>${esc(d.author)}</b>  🗓 ${esc(d.date)}  📍 ${d.region.flag} ${esc(d.region.name)}\n` +
    (desc ? `<blockquote expandable>${esc(desc)}</blockquote>\n` : "") +
    `👁 ${compact(s.views)}  ❤️ ${compact(s.likes)}  💬 ${compact(s.comments)}  ⭐️ ${compact(s.favorites)}\n\n👇 <b>Choose an action</b>`;
}

function keyboard(d) {
  const rows = [];
  rows.push([{ text: "▶️ Download Original Video", callback_data: `v|${d.id}|${d.username}`.slice(0, 64) }]);
  rows.push([{ text: "📊 Check Stats", callback_data: `s|${d.id}|${d.username}`.slice(0, 64) }]);
  if (d.username) rows.push([{ text: `👤 @${d.username} ↗️`, url: `https://www.tiktok.com/@${d.username}` }]);
  return { inline_keyboard: rows };
}

const tgForm = (env, method, form) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body: form }).then((r) => r.json());

// Descarga el video y lo entrega directamente en el chat.
async function sendFile(env, chat, d) {
  const links = [
    ...new Set(
      [d.links.hd, d.links.sd].filter(
        (x) => typeof x === "string" && /^https?:\/\//i.test(x)
      )
    )
  ];

  const link = links[0] || "";

  const fail = (message) => tg(env, "sendMessage", {
    chat_id: chat,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(link ? {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Enlace directo de descarga", url: link }]
        ]
      }
    } : {}),
  });

  if (!links.length) {
    return fail("❌ No encontré un enlace de descarga para este video.");
  }

  const MAX = 48 * 1048576;
  let lastError = "No se pudo descargar el archivo";

  for (const candidate of links) {
    try {
      const r = await fetch(candidate, {
        headers: {
          "User-Agent": UA,
          "Referer": "https://www.tikwm.com/"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(25000)
      });

      if (!r.ok) {
        lastError = `El servidor de descarga respondió ${r.status}`;
        continue;
      }

      const size = Number(r.headers.get("content-length") || 0);

      if (size > MAX) {
        await r.body?.cancel();
        return fail(
          `⚠️ El video pesa ${(size / 1048576).toFixed(1)} MB y supera el límite de envío directo del bot. Usa el enlace de descarga.`
        );
      }

      const buf = await r.arrayBuffer();

      if (!buf.byteLength) {
        lastError = "El enlace devolvió un archivo vacío";
        continue;
      }

      if (buf.byteLength > MAX) {
        return fail(
          `⚠️ El video pesa ${(buf.byteLength / 1048576).toFixed(1)} MB y supera el límite de envío directo configurado. Usa el enlace de descarga.`
        );
      }

      const type = (r.headers.get("content-type") || "").toLowerCase();

      if (type.includes("text/html") || type.includes("application/json")) {
        lastError = "El proveedor devolvió una página de error en lugar del video";
        continue;
      }

      const f = new FormData();
      f.append("chat_id", String(chat));
      f.append(
        "video",
        new Blob([buf], { type: "video/mp4" }),
        `${d.id || "tiktok"}.mp4`
      );
      f.append("supports_streaming", "true");
      f.append("caption", "⚡️Shura RTX® | Downloader & Checker");

      const res = await tgForm(env, "sendVideo", f);

      if (res.ok) return;

      lastError = res.description || "Telegram rechazó el archivo";
    } catch (e) {
      lastError = e?.message || lastError;
    }
  }

  return fail(
    `❌ No pude entregar el video en Telegram. Motivo: ${esc(lastError)}. Puedes usar el enlace directo.`
  );
}

async function handleCallback(cq, env) {
  const chat = cq.message?.chat?.id;
  const [k, id, user] = (cq.data || "").split("|");
  if ((k !== "s" && k !== "v") || !chat || !id) return tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: k === "v" ? "Descargando video…" : "Analizando…" });
  try {
    if (k === "v") await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video" });
    const d = await analyze(`https://www.tiktok.com/@${user || "_"}/video/${id}`);
    if (k === "v") return await sendFile(env, chat, d);
    const rows = [];
    if (d.links.hd) rows.push([{ text: "⬇️ Video HD / 4K", url: d.links.hd }]);
    if (d.links.music) rows.push([{ text: "🎵 Audio MP3", url: d.links.music }]);
    await tg(env, "sendMessage", {
      chat_id: chat, text: d.reportHtml, parse_mode: "HTML", disable_web_page_preview: true,
      reply_to_message_id: cq.message.message_id, allow_sending_without_reply: true,
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    });
  } catch (e) {
    await tg(env, "sendMessage", { chat_id: chat, text: "❌ " + esc(e.message), parse_mode: "HTML" });
  }
}

async function handleUpdate(update, env) {
  if (update.callback_query) return handleCallback(update.callback_query, env);
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  const chat = msg.chat.id;
  const send = (text, extra = {}) =>
    tg(env, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

  if (/^\/start/.test(msg.text)) {
    return send("⚡️ <b>Shura RTX® | Downloader &amp; Checker</b>\n\nEnvíame un enlace de TikTok y te devuelvo la vista previa del video, el análisis completo y la descarga sin marca de agua.");
  }

  const m = msg.text.match(TT);
  if (!m) return send("Envía un enlace válido de TikTok (tiktok.com o vm.tiktok.com).");

  await tg(env, "sendChatAction", { chat_id: chat, action: "upload_video" });
  try {
    const d = await analyze(m[0]);
    const cap = previewCaption(d), kb = keyboard(d);
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
      try { return json({ ok: true, ...(await analyze(target.match(TT)[0])) }); }
      catch (e) { return json({ ok: false, error: e.message }, 502); }
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
        url: `${u.origin}/webhook`, allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: true,
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
