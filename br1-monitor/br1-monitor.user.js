// ==UserScript==
// @name         BR1 Monitor de servidores
// @namespace    br1-monitor
// @version      4.1
// @description  Avisa quando um servidor das Kill Races do BR1 abre ou fecha
// @match        https://www.br1game.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.user.js
// ==/UserScript==

// Instale no Tampermonkey (ou cole no Console com F12, na página do site).
// Ele roda dentro da aba do site e, a cada 30 s, confere os servidores de todas as
// kill races ao vivo. Mostra uma notificação do Windows quando um servidor ABRE ou FECHA.
(() => {
  'use strict';

  const INTERVALO_MS = 30 * 1000;
  const ESTADO_VALIDO_MS = 10 * 60 * 1000; // lista guardada há mais tempo que isso é ignorada
  const NOVO_MS = 10 * 60 * 1000;          // por quanto tempo um servidor aparece como "NOVO"
  const MAX_EVENTOS = 60;
  const API_ATIVAS = '/api/game/killrace/active';
  const API_INFO = uuid => `/api/game/killrace/info/${uuid}`;

  const CHAVE = 'br1-monitor:v3';
  const K = {
    tentativa: `${CHAVE}:tentativa`,
    eventos: `${CHAVE}:eventos`,
    erro: `${CHAVE}:erro`,
    visto: `${CHAVE}:visto`,
    mudo: 'br1-monitor:mudo',
    min: 'br1-monitor:minimizado',
    aba: 'br1-monitor:aba',
  };

  // Se já estiver rodando (colou de novo), desliga o anterior.
  if (window.__br1Monitor) window.__br1Monitor.parar();
  console.info('[BR1 Monitor] iniciado');

  // ------------------------------------------------------------- memória compartilhada entre abas
  // Todas as abas do site enxergam a última lista, o histórico e os erros. Assim só uma aba
  // consulta por vez e você não recebe o mesmo aviso repetido.
  const ler = (k, padrao) => {
    try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ } };
  const lerEstado = () => { const e = ler(CHAVE, null); return e && e.mapa && typeof e.mapa === 'object' ? e : null; };
  const lerEventos = () => { const e = ler(K.eventos, []); return Array.isArray(e) ? e : []; };
  const adicionarEventos = novos => gravar(K.eventos, [...novos, ...lerEventos()].slice(0, MAX_EVENTOS));
  const erroAtual = () => { const e = ler(K.erro, null); return e && Date.now() - e.ts < INTERVALO_MS * 2.5 ? e : null; };

  // ------------------------------------------------------------- utilidades de texto
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const haQuanto = ts => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return 'agora';
    if (s < 60) return `há ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `há ${h}h` : new Date(ts).toLocaleDateString('pt-BR');
  };
  const horaCurta = ts => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m} min`;
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const duracao = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h${String(m).padStart(2, '0')}`;
    return m ? `${m} min` : `${s}s`;
  };
  // "SA #1 - MilitaryBase $0.25" -> região "SA #1", mapa "MilitaryBase", taxa "$0.25"
  const partes = nome => {
    const m = nome.match(/^(.+?)\s+-\s+(.+?)(?:\s+(\$\s?[\d.,]+))?$/);
    return m ? { reg: m[1], mapa: m[2], taxa: m[3] || '' } : { reg: '', mapa: nome, taxa: '' };
  };
  // Cada região tem uma cor, para dar para reconhecer de relance (US azul, EU roxo, SA amarelo...).
  const CORES_REGIAO = {
    US: '#4DA3FF', NA: '#4DA3FF', EU: '#B794FF', SA: '#FFC233', BR: '#2DD4BF',
    SEA: '#FF7AB6', ASIA: '#FF9F43', AS: '#FF9F43', OCE: '#FF6B6B', AU: '#FF6B6B', ME: '#F5D547',
  };
  const etiqueta = reg => {
    const m = reg.match(/^([A-Za-z]+)\s*(.*)$/);
    const cod = m ? m[1].toUpperCase() : reg;
    const resto = m ? m[2] : '';
    const cor = CORES_REGIAO[cod] || '#03CEFF';
    return `<span class="reg" style="--c:${cor}"><span>${esc(cod)}</span>${resto ? `<i>${esc(resto)}</i>` : ''}</span>`;
  };

  // ------------------------------------------------------------- visual
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    sino: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    sinoMudo: svg('<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>'),
    baixo: svg('<path d="m6 9 6 6 6-6"/>'),
    subiu: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
    desceu: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
    alerta: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    ok: svg('<path d="M20 6 9 17l-5-5"/>'),
  };
  const notch = n => `polygon(0 0, calc(100% - ${n}px) 0, 100% ${n}px, 100% 100%, ${n}px 100%, 0 calc(100% - ${n}px))`;
  const TITULO = '"Monument Extended", "Segoe UI", system-ui, sans-serif';
  const DISPLAY = 'Promo, "Monument Extended", "Segoe UI", system-ui, sans-serif';
  const LEGIVEL = '"Segoe UI", Inter, system-ui, sans-serif';

  const CSS = `
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }
    .root { font: 13px/1.45 Inter, "Segoe UI", system-ui, sans-serif; color: #e9e9ee; -webkit-font-smoothing: antialiased;
            filter: drop-shadow(0 14px 30px rgba(0,0,0,.65)); }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
    button:focus-visible { outline: 2px solid #03CEFF; outline-offset: 2px; }

    .frame { padding: 1px; background: rgba(255,255,255,.14); clip-path: ${notch(14)}; transition: background .4s; }
    .frame.ok  { background: linear-gradient(140deg, rgba(0,255,144,.65), rgba(3,206,255,.28) 45%, rgba(255,255,255,.1)); }
    .frame.err { background: linear-gradient(140deg, rgba(234,179,8,.75), rgba(255,255,255,.1) 55%); }

    .card { position: relative; width: 344px; max-width: calc(100vw - 32px); background: #08080b; clip-path: ${notch(13)}; }
    .pill { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 16px 10px 13px;
            background: #08080b; clip-path: ${notch(13)}; }
    .card::after, .pill::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0; }
    .flash-open .card::after, .flash-open .pill::after {
      background: radial-gradient(120% 90% at 85% 0%, rgba(0,255,144,.3), transparent 65%); animation: brilho 2.2s ease-out; }
    .flash-close .card::after, .flash-close .pill::after {
      background: radial-gradient(120% 90% at 85% 0%, rgba(255,77,94,.3), transparent 65%); animation: brilho 2.2s ease-out; }
    @keyframes brilho { from { opacity: 1; } to { opacity: 0; } }

    .dot { position: relative; flex: none; width: 7px; height: 7px; border-radius: 50%; background: #5b5b66; }
    .dot.ok { background: #00FF90; }
    .dot.ok::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #00FF90;
                     animation: ping 1.8s cubic-bezier(0,0,.2,1) infinite; }
    .dot.err { background: #eab308; }
    @keyframes ping { 0% { transform: scale(1); opacity: .7; } 75%, 100% { transform: scale(2.6); opacity: 0; } }

    .head { display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 0 14px; }
    .brand { display: flex; align-items: center; gap: 9px; font: 700 9.5px/1 ${TITULO}; letter-spacing: .24em;
             text-transform: uppercase; color: rgba(255,255,255,.55); }
    .actions { display: flex; gap: 2px; }
    .icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: rgba(255,255,255,.5);
            transition: background .15s, color .15s; }
    .icon:hover { background: rgba(255,255,255,.08); color: #fff; }
    .icon.mudo { color: #eab308; }

    .hero { display: grid; grid-template-columns: auto 1fr; align-items: end; column-gap: 12px; row-gap: 12px; padding: 8px 14px 12px; }
    .num { font: 400 46px/.86 ${DISPLAY}; color: #00FF90; text-shadow: 0 0 26px rgba(0,255,144,.35); font-variant-numeric: tabular-nums; }
    .num.zero { color: rgba(255,255,255,.3); text-shadow: none; }
    .lbl { padding-bottom: 2px; font: 700 10px/1.3 ${TITULO}; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.7); }
    .lbl small { display: block; margin-top: 5px; font: 500 11px/1.35 Inter, "Segoe UI", system-ui, sans-serif; letter-spacing: 0;
                 text-transform: none; color: rgba(255,255,255,.42); }
    .bar { grid-column: 1 / -1; height: 2px; background: rgba(255,255,255,.07); overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #03CEFF, #00FF90); transition: width 1s linear; }
    .err-on .bar i { background: #eab308; }

    .banner { display: flex; align-items: center; gap: 10px; margin: 0 14px 12px; padding: 10px 12px; font-size: 12px; line-height: 1.4;
              color: rgba(255,255,255,.78); background: rgba(3,206,255,.07); box-shadow: inset 2px 0 0 #03CEFF; }
    .banner > svg { flex: none; color: #03CEFF; }
    .banner.warn { background: rgba(234,179,8,.08); box-shadow: inset 2px 0 0 #eab308; }
    .banner.warn > svg { color: #eab308; }
    .btn { flex: none; margin-left: auto; padding: 8px 12px; font: 700 8.5px/1 ${TITULO}; letter-spacing: .18em; text-transform: uppercase;
           color: #03140c; background: #00FF90; clip-path: ${notch(6)}; transition: filter .15s; }
    .btn:hover { filter: brightness(1.15); }

    .tabs { display: flex; gap: 20px; padding: 0 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
    .tab { position: relative; display: flex; align-items: center; gap: 7px; padding: 9px 0 10px; font: 700 9.5px/1 ${TITULO};
           letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.4); transition: color .15s; }
    .tab:hover { color: rgba(255,255,255,.8); }
    .tab.on { color: #fff; }
    .tab.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #03CEFF;
                     box-shadow: 0 0 10px rgba(3,206,255,.7); }
    .badge { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
             font: 700 10px/1 Inter, "Segoe UI", system-ui, sans-serif; letter-spacing: 0; color: #03140c; background: #00FF90; }

    .list { max-height: min(46vh, 360px); overflow-y: auto; padding: 4px 8px 10px; scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,.15) transparent; }
    .race { position: sticky; top: -4px; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
            padding: 12px 6px 7px; background: #08080b; }
    .race-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 700 10.5px/1.3 ${TITULO}; color: #fff; letter-spacing: .06em;
              text-transform: uppercase; }
    .race-t { flex: none; font-size: 11px; color: rgba(255,255,255,.4); font-variant-numeric: tabular-nums; }
    .srv { display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 3px; transition: background .15s; }
    .srv:hover { background: rgba(255,255,255,.04); }
    .srv.novo { background: linear-gradient(90deg, rgba(0,255,144,.13), transparent 75%); box-shadow: inset 2px 0 0 #00FF90; }
    .reg { flex: none; display: inline-flex; align-items: baseline; justify-content: center; gap: 4px; min-width: 68px; padding: 4px 8px;
           white-space: nowrap; font: 800 12.5px/1.15 ${LEGIVEL}; color: var(--c); background: color-mix(in srgb, var(--c) 15%, transparent);
           box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 40%, transparent); clip-path: ${notch(5)}; }
    .reg i { font-style: normal; font-weight: 600; font-size: 11.5px; color: rgba(255,255,255,.85); }
    .map { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.78); }
    .tag { flex: none; padding: 3px 5px; font: 700 8px/1 ${TITULO}; letter-spacing: .16em; text-transform: uppercase;
           color: #03140c; background: #00FF90; }
    .fee { flex: none; font-weight: 700; color: #00FF90; font-variant-numeric: tabular-nums; }

    .ev { display: grid; grid-template-columns: 24px 1fr auto; align-items: start; gap: 10px; padding: 9px 6px; }
    .ev + .ev { border-top: 1px solid rgba(255,255,255,.05); }
    .ev.fresh { animation: entra .4s ease-out; }
    @keyframes entra { from { opacity: 0; transform: translateY(-6px); } }
    .ev-ic { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; }
    .ev-ic svg { width: 13px; height: 13px; }
    .ev.abriu  .ev-ic { color: #00FF90; background: rgba(0,255,144,.12); }
    .ev.fechou .ev-ic { color: #ff4d5e; background: rgba(255,77,94,.12); }
    .ev.erro   .ev-ic { color: #eab308; background: rgba(234,179,8,.12); }
    .ev.ok     .ev-ic { color: #03CEFF; background: rgba(3,206,255,.12); }
    .ev-t { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12.5px; color: #fff; overflow-wrap: anywhere; }
    .ev-t b { font: 700 9px/1 ${TITULO}; letter-spacing: .16em; text-transform: uppercase; }
    .ev-t .fee { font-size: 12px; }
    .ev.abriu .ev-t b { color: #00FF90; }
    .ev.fechou .ev-t b { color: #ff4d5e; }
    .ev-s { margin-top: 4px; font-size: 11px; color: rgba(255,255,255,.4); }
    .ev-time { padding-top: 3px; white-space: nowrap; font-size: 11px; color: rgba(255,255,255,.35); font-variant-numeric: tabular-nums; }

    .vazio { padding: 26px 16px 22px; text-align: center; font-size: 12px; color: rgba(255,255,255,.45); }
    .vazio b { display: block; margin-bottom: 6px; font: 700 9px/1.4 ${TITULO}; letter-spacing: .22em; text-transform: uppercase;
               color: rgba(255,255,255,.75); }
    .sk { height: 32px; margin: 8px 6px; border-radius: 3px;
          background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04)) 0 0 / 200% 100%;
          animation: sk 1.3s linear infinite; }
    @keyframes sk { to { background-position: -200% 0; } }

    .pill-n { font: 400 21px/1 ${DISPLAY}; color: #00FF90; font-variant-numeric: tabular-nums; }
    .pill-n.zero { color: rgba(255,255,255,.4); }
    .pill-l { font: 700 9px/1 ${TITULO}; letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.65); transition: color .15s; }
    .pill:hover .pill-l { color: #fff; }
    .pill-mudo { display: grid; color: #eab308; }

    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  `;

  const HTML = `
    <div class="root">
      <div class="frame" id="frame">
        <div class="card" id="card" role="region" aria-label="BR1 Monitor de servidores">
          <header class="head">
            <div class="brand"><span class="dot" id="dot"></span>Server Monitor</div>
            <div class="actions">
              <button class="icon" id="btnMudo"></button>
              <button class="icon" id="btnMin" title="Minimizar" aria-label="Minimizar">${IC.baixo}</button>
            </div>
          </header>
          <section class="hero">
            <span class="num zero" id="num">–</span>
            <div class="lbl"><span id="numLbl">Servidores abertos</span><small id="sub">Conectando ao site…</small></div>
            <div class="bar"><i id="barra"></i></div>
          </section>
          <div class="banner warn" id="bannerErro" hidden></div>
          <div class="banner" id="bannerPerm" hidden></div>
          <nav class="tabs" role="tablist">
            <button class="tab" data-aba="vivo" role="tab">Ao vivo</button>
            <button class="tab" data-aba="feed" role="tab">Atividade <span class="badge" id="badgeAba" hidden></span></button>
          </nav>
          <div class="list" id="vivo" role="tabpanel"></div>
          <div class="list" id="feed" role="tabpanel"></div>
        </div>
        <button class="pill" id="pill" aria-label="Abrir BR1 Monitor">
          <span class="dot" id="pillDot"></span><span class="pill-n zero" id="pillN">–</span><span class="pill-l" id="pillL">Servidores</span>
          <span class="badge" id="badgePill" hidden></span><span class="pill-mudo" id="pillMudo" title="Avisos silenciados" hidden>${IC.sinoMudo}</span>
        </button>
      </div>
    </div>`;

  const host = document.createElement('div');
  host.id = 'br1-monitor';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const raiz = host.attachShadow({ mode: 'open' });
  raiz.innerHTML = `<style>${CSS}</style>${HTML}`;
  (document.body || document.documentElement).appendChild(host);
  const $ = id => raiz.getElementById(id);

  // ------------------------------------------------------------- notificações do Windows
  const temNotificacao = 'Notification' in window;
  const iconeSite = (document.querySelector('link[rel~="icon"]') || {}).href;
  const tituloOriginal = document.title;
  const notificar = (titulo, texto, forcar = false) => {
    if (ler(K.mudo, false) && !forcar) return;
    if (document.hidden) document.title = `(!) ${titulo}`;
    if (!temNotificacao || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(titulo, { body: texto, tag: `br1-${titulo}`, icon: iconeSite });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* ignora */ }
  };
  const restaurarTitulo = () => { if (!document.hidden && document.title.startsWith('(!) ')) document.title = tituloOriginal; };

  const avisarMudancas = (abriram, fecharam, mapa, anterior) => {
    const resumo = `${plural(Object.keys(mapa).length, 'servidor aberto', 'servidores abertos')} agora`;
    const enviar = (acao, acaoPlural, lista, origem) => {
      if (lista.length <= 3) lista.forEach(s => notificar(`${acao} ${s}`, `${origem[s].join(', ')} • ${resumo}`));
      else notificar(`${acaoPlural} ${lista.length} SERVIDORES`, `${lista.join(', ')} • ${resumo}`);
    };
    enviar('ABRIU', 'ABRIRAM', abriram, mapa);
    enviar('FECHOU', 'FECHARAM', fecharam, anterior);
  };

  // ------------------------------------------------------------- leitura das kill races
  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
    return r.json();
  }

  // Mesma regra da página: usa a fase informada pelo site ou, se não houver, o horário de início e fim.
  const aoVivo = race => {
    if (['Live', 'Upcoming', 'Completed', 'Disabled'].includes(race.phase)) return race.phase === 'Live';
    const agora = Date.now();
    return Date.parse(race.begin) <= agora && !(Date.parse(race.end) <= agora);
  };

  const nomesDe = lista => (Array.isArray(lista) ? lista : [])
    .map(s => (typeof s === 'string' ? s : (s && s.name) || JSON.stringify(s)))
    .map(s => String(s).trim())
    .filter(Boolean);

  // mapa: { "nome do servidor": ["nome da race", ...] }   racesInfo: [{ nome, fim }]
  async function lerServidores() {
    const ativas = await getJson(API_ATIVAS);
    if (!Array.isArray(ativas)) throw new Error('resposta em formato inesperado');
    const mapa = {};
    const racesInfo = [];
    for (const race of ativas) {
      if (!race || typeof race !== 'object' || !aoVivo(race)) continue;
      const nome = String(race.name || 'Kill race').trim();
      racesInfo.push({ nome, fim: race.end || null });
      let servidores = race.servers;
      if (!Array.isArray(servidores) && race.uuid) servidores = ((await getJson(API_INFO(race.uuid))) || {}).servers;
      for (const s of nomesDe(servidores)) {
        mapa[s] = mapa[s] || [];
        if (!mapa[s].includes(nome)) mapa[s].push(nome);
      }
    }
    return { mapa, racesInfo };
  }

  // ------------------------------------------------------------- desenho do painel
  let estado = lerEstado();
  let ultimoBrilho = Math.max(0, ...lerEventos().map(e => e.ts || 0));
  let brilhoTimer = null;
  let ultimaBarra = 0;

  const minimizado = () => !!ler(K.min, false);
  const abaAtual = () => (ler(K.aba, 'vivo') === 'feed' ? 'feed' : 'vivo');

  function desenharResumo() {
    const n = estado ? Object.keys(estado.mapa).length : null;
    const erro = erroAtual();
    const classe = erro ? 'err' : n ? 'ok' : '';
    $('frame').className = `frame ${classe}`;
    $('card').classList.toggle('err-on', !!erro);
    $('dot').className = `dot ${classe}`;
    $('pillDot').className = `dot ${classe}`;
    $('num').textContent = n == null ? '–' : n;
    $('num').classList.toggle('zero', !n);
    $('numLbl').textContent = n === 1 ? 'Servidor aberto' : 'Servidores abertos';
    $('pillN').textContent = n == null ? '–' : n;
    $('pillN').classList.toggle('zero', !n);
    $('pillL').textContent = erro ? 'Sem conexão' : n === 1 ? 'Servidor' : 'Servidores';

    const mudo = !!ler(K.mudo, false);
    const btnMudo = $('btnMudo');
    btnMudo.innerHTML = mudo ? IC.sinoMudo : IC.sino;
    btnMudo.classList.toggle('mudo', mudo);
    btnMudo.title = mudo ? 'Avisos silenciados - clique para ligar' : 'Silenciar avisos';
    btnMudo.setAttribute('aria-label', btnMudo.title);
    $('pillMudo').hidden = !mudo;

    const min = minimizado();
    $('card').hidden = min;
    $('pill').hidden = !min;

    const aba = abaAtual();
    raiz.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.aba === aba;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on);
    });
    $('vivo').hidden = aba !== 'vivo';
    $('feed').hidden = aba !== 'feed';
    const eventos = lerEventos();
    let visto = ler(K.visto, 0) || 0;
    // Só grava quando há algo novo, para duas janelas abertas não ficarem se atualizando sem parar.
    if (!min && aba === 'feed' && !document.hidden && eventos.some(e => e.ts > visto)) {
      visto = Date.now();
      gravar(K.visto, visto);
    }
    const naoVistos = eventos.filter(e => (e.tipo === 'abriu' || e.tipo === 'fechou') && e.ts > visto).length;
    for (const id of ['badgeAba', 'badgePill']) {
      $(id).hidden = !naoVistos;
      $(id).textContent = naoVistos > 9 ? '9+' : naoVistos;
    }
  }

  function desenharAvisos() {
    const erro = erroAtual();
    const bErro = $('bannerErro');
    bErro.hidden = !erro;
    if (erro) {
      bErro.innerHTML = `${IC.alerta}<span>Sem resposta do site (${plural(erro.falhas, 'tentativa', 'tentativas')}). ` +
        `Tentando de novo a cada ${INTERVALO_MS / 1000}s.</span>`;
    }
    const bPerm = $('bannerPerm');
    const perm = temNotificacao ? Notification.permission : 'granted';
    bPerm.hidden = perm === 'granted';
    bPerm.classList.toggle('warn', perm === 'denied');
    if (perm === 'default') {
      bPerm.innerHTML = `${IC.sino}<span>Ative as notificações para ser avisado mesmo com o site em segundo plano.</span>` +
        '<button class="btn" id="btnAtivar">Ativar</button>';
    } else if (perm === 'denied') {
      bPerm.innerHTML = `${IC.alerta}<span>Notificações bloqueadas. Clique no cadeado ao lado do endereço, ` +
        'permita <b>Notificações</b> e recarregue a página.</span>';
    }
  }

  function desenharVivo() {
    const box = $('vivo');
    const rolagem = box.scrollTop;
    if (!estado) {
      box.innerHTML = '<div class="sk"></div><div class="sk"></div><div class="sk"></div>';
      return;
    }
    const porRace = {};
    for (const [s, rs] of Object.entries(estado.mapa)) for (const r of rs) (porRace[r] = porRace[r] || []).push(s);
    const nomes = Object.keys(porRace).sort();
    if (!nomes.length) {
      const motivo = estado.racesInfo && estado.racesInfo.length ? 'A kill race ao vivo ainda não tem servidores.' : 'Nenhuma kill race ao vivo agora.';
      box.innerHTML = `<div class="vazio"><b>Nenhum servidor aberto</b>${motivo} Você é avisado assim que abrir um.</div>`;
      return;
    }
    const fins = {};
    (estado.racesInfo || []).forEach(r => { fins[r.nome] = Date.parse(r.fim); });
    const abertoEm = {};
    lerEventos().forEach(e => { if (e.tipo === 'abriu' && !(e.s in abertoEm)) abertoEm[e.s] = e.ts; });

    box.innerHTML = nomes.map(r => {
      const fim = fins[r];
      const cab = `<div class="race"><span class="race-n" title="${esc(r)}">${esc(r)}</span>` +
        (fim > 0 ? `<span class="race-t" data-fim="${fim}"></span>` : '') + '</div>';
      return cab + porRace[r].sort().map(s => {
        const p = partes(s);
        const novo = Date.now() - (abertoEm[s] || 0) < NOVO_MS;
        return `<div class="srv${novo ? ' novo' : ''}" title="${esc(s)}">` +
          (p.reg ? etiqueta(p.reg) : '') +
          `<span class="map">${esc(p.mapa)}</span>` +
          (novo ? '<span class="tag">Novo</span>' : '') +
          (p.taxa ? `<span class="fee">${esc(p.taxa)}</span>` : '') + '</div>';
      }).join('');
    }).join('');
    box.scrollTop = rolagem;
  }

  const descricao = nome => {
    const p = partes(nome);
    if (!p.reg) return esc(nome);
    return `${etiqueta(p.reg)}${p.taxa ? `<span class="fee">${esc(p.taxa)}</span>` : ''}`;
  };

  function desenharAtividade(limiarNovos) {
    const box = $('feed');
    const rolagem = box.scrollTop;
    const eventos = lerEventos();
    if (!eventos.length) {
      box.innerHTML = '<div class="vazio"><b>Nada mudou ainda</b>Quando um servidor abrir ou fechar, aparece aqui.</div>';
      return;
    }
    box.innerHTML = eventos.map(e => {
      const fresco = e.ts > limiarNovos ? ' fresh' : '';
      const hora = `<span class="ev-time" data-ts="${e.ts}" title="${esc(new Date(e.ts).toLocaleString('pt-BR'))}"></span>`;
      if (e.tipo === 'abriu' || e.tipo === 'fechou') {
        const abriu = e.tipo === 'abriu';
        return `<div class="ev ${e.tipo}${fresco}"><span class="ev-ic">${abriu ? IC.subiu : IC.desceu}</span>` +
          `<div><div class="ev-t"><b>${abriu ? 'Abriu' : 'Fechou'}</b>${descricao(e.s)}</div>` +
          `<div class="ev-s">${esc([partes(e.s).reg ? partes(e.s).mapa : '', (e.r || []).join(', ')].filter(Boolean).join(' · '))}</div></div>${hora}</div>`;
      }
      const erro = e.tipo === 'erro';
      return `<div class="ev ${erro ? 'erro' : 'ok'}${fresco}"><span class="ev-ic">${erro ? IC.alerta : IC.ok}</span>` +
        `<div><div class="ev-t">${erro ? 'Sem conexão com o site' : 'Conexão com o site voltou'}</div></div>${hora}</div>`;
    }).join('');
    box.scrollTop = rolagem;
  }

  function relogio() {
    const sub = $('sub');
    if (estado) {
      const n = (estado.racesInfo || []).length;
      const races = n ? plural(n, 'kill race ao vivo', 'kill races ao vivo') : 'Nenhuma kill race ao vivo';
      sub.textContent = `${races} · atualizado ${haQuanto(estado.ts)}`;
    }
    const pct = Math.min(100, Math.max(0, ((Date.now() - (ler(K.tentativa, 0) || 0)) / INTERVALO_MS) * 100));
    const barra = $('barra');
    if (pct < ultimaBarra) { barra.style.transition = 'none'; barra.style.width = `${pct}%`; void barra.offsetWidth; barra.style.transition = ''; }
    else barra.style.width = `${pct}%`;
    ultimaBarra = pct;
    raiz.querySelectorAll('[data-fim]').forEach(el => {
      const falta = Number(el.dataset.fim) - Date.now();
      el.textContent = falta > 0 ? `acaba em ${duracao(falta)}` : 'encerrando…';
    });
    raiz.querySelectorAll('[data-ts]').forEach(el => { el.textContent = horaCurta(Number(el.dataset.ts)); });
  }

  function desenharTudo() {
    const eventos = lerEventos();
    const maisNovo = Math.max(0, ...eventos.filter(e => e.tipo === 'abriu' || e.tipo === 'fechou').map(e => e.ts));
    const limiar = ultimoBrilho;
    if (maisNovo > ultimoBrilho) {
      const abriu = eventos.some(e => e.ts === maisNovo && e.tipo === 'abriu');
      const frame = $('frame');
      frame.classList.remove('flash-open', 'flash-close');
      void frame.offsetWidth;
      frame.classList.add(abriu ? 'flash-open' : 'flash-close');
      clearTimeout(brilhoTimer);
      brilhoTimer = setTimeout(() => frame.classList.remove('flash-open', 'flash-close'), 2300);
      ultimoBrilho = maisNovo;
    }
    desenharResumo();
    desenharAvisos();
    desenharVivo();
    desenharAtividade(limiar);
    relogio();
  }

  // ------------------------------------------------------------- interações
  $('btnMin').onclick = () => { gravar(K.min, true); desenharTudo(); };
  $('pill').onclick = () => { gravar(K.min, false); desenharTudo(); };
  $('btnMudo').onclick = () => { gravar(K.mudo, !ler(K.mudo, false)); desenharResumo(); };
  raiz.querySelectorAll('.tab').forEach(t => { t.onclick = () => { gravar(K.aba, t.dataset.aba); desenharTudo(); }; });
  raiz.addEventListener('click', async ev => {
    if (!ev.target.closest('#btnAtivar') || !temNotificacao) return;
    const r = await Notification.requestPermission();
    desenharAvisos();
    if (r === 'granted') notificar('BR1 Monitor', 'Avisos ativados! Você vai ser avisado quando abrir ou fechar servidor.', true);
  });
  raiz.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !minimizado()) { gravar(K.min, true); desenharTudo(); } });

  const aoMudarStorage = ev => {
    if (!ev.key || !ev.key.startsWith('br1-monitor')) return;
    estado = lerEstado();
    desenharTudo();
  };
  const aoMudarVisibilidade = () => { restaurarTitulo(); if (!document.hidden) desenharResumo(); };
  window.addEventListener('storage', aoMudarStorage);
  document.addEventListener('visibilitychange', aoMudarVisibilidade);

  // ------------------------------------------------------------- loop de checagem
  let falhas = 0;
  let timer = null;
  let parado = false;

  async function checar() {
    if (parado) return;
    if (Date.now() - (ler(K.tentativa, 0) || 0) < INTERVALO_MS * 0.8) {
      // Outra aba do site acabou de checar; esta só acompanha.
      estado = lerEstado();
    } else {
      gravar(K.tentativa, Date.now());
      const salvo = lerEstado();
      const idade = salvo ? Date.now() - salvo.ts : Infinity;
      try {
        const { mapa, racesInfo } = await lerServidores();
        if (parado) return;
        const agora = Date.now();
        const novos = [];
        if (falhas >= 3) {
          novos.push({ tipo: 'ok', ts: agora });
          notificar('BR1 Monitor', 'Conexão com o site voltou.');
        }
        falhas = 0;
        gravar(K.erro, null);

        const anterior = idade < ESTADO_VALIDO_MS ? salvo.mapa : null;
        if (anterior) {
          const abriram = Object.keys(mapa).sort().filter(s => !(s in anterior));
          const fecharam = Object.keys(anterior).sort().filter(s => !(s in mapa));
          abriram.forEach(s => novos.push({ tipo: 'abriu', s, r: mapa[s], ts: agora }));
          fecharam.forEach(s => novos.push({ tipo: 'fechou', s, r: anterior[s], ts: agora }));
          avisarMudancas(abriram, fecharam, mapa, anterior);
        }
        estado = { mapa, racesInfo, races: racesInfo.length, ts: agora };
        gravar(CHAVE, estado);
        if (novos.length) adicionarEventos(novos);
      } catch (e) {
        falhas++;
        console.warn('[BR1 Monitor] erro ao ler as kill races:', e);
        gravar(K.erro, { falhas, msg: e.message, ts: Date.now() });
        if (falhas === 3) {
          adicionarEventos([{ tipo: 'erro', ts: Date.now() }]);
          notificar('BR1 Monitor: sem conexão', 'Não consegui ler as kill races 3 vezes seguidas. Continuo tentando.');
        }
      }
    }
    desenharTudo();
    if (!parado) timer = setTimeout(checar, INTERVALO_MS);
  }

  const relogioTimer = setInterval(relogio, 1000);

  function parar() {
    parado = true;
    clearTimeout(timer);
    clearTimeout(brilhoTimer);
    clearInterval(relogioTimer);
    window.removeEventListener('storage', aoMudarStorage);
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    host.remove();
    delete window.__br1Monitor;
  }
  window.__br1Monitor = { parar };

  desenharTudo();
  checar();
})();
