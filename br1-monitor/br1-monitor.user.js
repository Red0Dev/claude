// ==UserScript==
// @name         BR1 Monitor de servidores
// @namespace    br1-monitor
// @version      3.0
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
  const API_ATIVAS = '/api/game/killrace/active';
  const API_INFO = uuid => `/api/game/killrace/info/${uuid}`;
  const CHAVE = 'br1-monitor:v3';
  const CHAVE_MIN = 'br1-monitor:minimizado';

  // Se já estiver rodando (colou de novo), desliga o anterior.
  if (window.__br1Monitor) window.__br1Monitor.parar();
  console.info('[BR1 Monitor] iniciado');

  // ------------------------------------------------------------- memória compartilhada entre abas
  // Todas as abas do site enxergam a última lista. Assim só uma aba consulta por vez
  // e você não recebe o mesmo aviso repetido.
  const lerEstado = () => {
    try {
      const e = JSON.parse(localStorage.getItem(CHAVE));
      return e && e.mapa && typeof e.mapa === 'object' ? e : null;
    } catch (e) { return null; }
  };
  const gravarEstado = (mapa, races) => {
    try { localStorage.setItem(CHAVE, JSON.stringify({ mapa, races, ts: Date.now() })); } catch (e) { /* ignora */ }
  };
  // Horário da última tentativa de qualquer aba (mesmo se falhou), para só uma aba consultar por vez.
  const lerTentativa = () => { try { return Number(localStorage.getItem(`${CHAVE}:tentativa`)) || 0; } catch (e) { return 0; } };
  const marcarTentativa = () => { try { localStorage.setItem(`${CHAVE}:tentativa`, String(Date.now())); } catch (e) { /* ignora */ } };
  const lerMin = () => { try { return localStorage.getItem(CHAVE_MIN) === '1'; } catch (e) { return false; } };
  const gravarMin = v => { try { localStorage.setItem(CHAVE_MIN, v ? '1' : '0'); } catch (e) { /* ignora */ } };

  // ------------------------------------------------------------- painel na tela
  const el = (tag, css, texto) => {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const botaoCss = 'background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit';

  const painel = el('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:340px;background:#111;color:#ddd;' +
    'border:1px solid #444;border-radius:8px;padding:8px 10px;font:12px/1.45 Consolas,monospace;box-shadow:0 4px 18px rgba(0,0,0,.6)');
  const topo = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:6px');
  const titulo = el('b', 'color:#00ff90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', 'BR1 Monitor');
  const botoes = el('span', 'display:flex;gap:4px;flex-shrink:0');
  const btnAvisos = el('button', botaoCss + ';border-color:#00ff90;color:#00ff90', 'Ativar avisos');
  const btnMin = el('button', botaoCss, '_');
  const btnFechar = el('button', botaoCss, 'x');
  btnFechar.title = 'Parar o monitor nesta aba';
  botoes.append(btnAvisos, btnMin, btnFechar);
  topo.append(titulo, botoes);
  const corpo = el('div', 'margin-top:6px');
  const status = el('div', 'color:#999;margin-bottom:6px', 'Iniciando...');
  const logBox = el('div', 'max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word');
  corpo.append(status, logBox);
  painel.append(topo, corpo);
  (document.body || document.documentElement).appendChild(painel);

  const aplicarMin = min => {
    corpo.style.display = min ? 'none' : '';
    painel.style.width = min ? 'auto' : '340px';
    btnMin.textContent = min ? '+' : '_';
    btnMin.title = min ? 'Mostrar' : 'Minimizar';
  };
  aplicarMin(lerMin());
  btnMin.onclick = () => { const min = corpo.style.display !== 'none'; gravarMin(min); aplicarMin(min); };

  const hora = (t = Date.now()) => new Date(t).toLocaleTimeString('pt-BR');
  const log = (texto, cor = '#bbb') => {
    logBox.prepend(el('div', `color:${cor}`, `[${hora()}] ${texto}`));
    while (logBox.childElementCount > 200) logBox.lastChild.remove();
  };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const mostrarStatus = (n, races, quando, porOutraAba) => {
    if (n == null) { titulo.textContent = 'BR1 Monitor'; status.textContent = quando; return; }
    titulo.textContent = `BR1 Monitor - ${plural(n, 'servidor', 'servidores')}`;
    status.textContent = `${plural(n, 'servidor aberto', 'servidores abertos')} em ${plural(races, 'kill race ao vivo', 'kill races ao vivo')}` +
      ` - checado às ${hora(quando)}${porOutraAba ? ' (por outra aba)' : ''}`;
  };

  // ------------------------------------------------------------- notificações
  const temNotificacao = 'Notification' in window;
  const atualizarBotao = () => {
    if (!temNotificacao) { btnAvisos.textContent = 'Sem suporte'; btnAvisos.disabled = true; return; }
    if (Notification.permission === 'granted') btnAvisos.style.display = 'none';
    else if (Notification.permission === 'denied') btnAvisos.textContent = 'Avisos bloqueados';
  };
  atualizarBotao();

  btnAvisos.onclick = async () => {
    if (!temNotificacao) return;
    if (Notification.permission === 'denied') {
      aplicarMin(false);
      log('As notificações estão bloqueadas para este site. Clique no cadeado ao lado do endereço, ' +
          'permita "Notificações" e recarregue a página.', '#ffcc00');
      return;
    }
    const r = await Notification.requestPermission();
    atualizarBotao();
    if (r === 'granted') notificar('BR1 Monitor', 'Avisos ativados! Você vai ser avisado quando abrir ou fechar servidor.');
  };

  const tituloOriginal = document.title;
  const notificar = (tituloAviso, texto) => {
    if (temNotificacao && Notification.permission === 'granted') {
      try { new Notification(tituloAviso, { body: texto, tag: `br1-${tituloAviso}` }); } catch (e) { /* ignora */ }
    }
    if (document.hidden) document.title = `(!) ${tituloAviso}`;
  };
  const restaurarTitulo = () => { if (!document.hidden && document.title.startsWith('(!) ')) document.title = tituloOriginal; };
  document.addEventListener('visibilitychange', restaurarTitulo);

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
    const inicio = Date.parse(race.begin);
    const fim = Date.parse(race.end);
    return inicio <= agora && !(fim <= agora);
  };

  const nomesDe = lista => (Array.isArray(lista) ? lista : [])
    .map(s => (typeof s === 'string' ? s : (s && s.name) || JSON.stringify(s)))
    .map(s => String(s).trim())
    .filter(Boolean);

  // Devolve { mapa: { "nome do servidor": ["nome da race", ...] }, races: quantas races ao vivo }
  async function lerServidores() {
    const ativas = await getJson(API_ATIVAS);
    if (!Array.isArray(ativas)) throw new Error('resposta em formato inesperado');
    const mapa = {};
    let races = 0;
    for (const race of ativas) {
      if (!race || typeof race !== 'object' || !aoVivo(race)) continue;
      races++;
      let servidores = race.servers;
      if (!Array.isArray(servidores) && race.uuid) servidores = ((await getJson(API_INFO(race.uuid))) || {}).servers;
      const nomeRace = String(race.name || 'Kill race').trim();
      for (const s of nomesDe(servidores)) {
        mapa[s] = mapa[s] || [];
        if (!mapa[s].includes(nomeRace)) mapa[s].push(nomeRace);
      }
    }
    return { mapa, races };
  }

  const mostrarMudancas = (acao, acaoPlural, lista, mapa, resumo, cor) => {
    if (!lista.length) return;
    lista.forEach(s => log(`${acao} ${s}  [${mapa[s].join(', ')}]`, cor));
    if (lista.length <= 3) lista.forEach(s => notificar(`${acao} ${s}`, `${mapa[s].join(', ')}\n${resumo}`));
    else notificar(`${acaoPlural} ${lista.length} SERVIDORES`, `${lista.join('\n')}\n${resumo}`);
  };

  const mostrarLista = (mapa, extra = '') => {
    const porRace = {};
    Object.keys(mapa).sort().forEach(s => mapa[s].forEach(r => (porRace[r] = porRace[r] || []).push(s)));
    const nomesRaces = Object.keys(porRace);
    if (!nomesRaces.length) { log(`Nenhum servidor aberto em kill race agora${extra}. Vou avisar quando abrir.`, '#5ff'); return; }
    // O log mostra o mais novo em cima, então escrevemos de trás para frente.
    nomesRaces.reverse().forEach(r => {
      porRace[r].slice().reverse().forEach(s => log(`   ${s}`, '#fff'));
      log(`${r} (${plural(porRace[r].length, 'servidor', 'servidores')}):`, '#5ff');
    });
    if (extra) log(`Servidores abertos agora${extra}:`, '#5ff');
  };

  // ------------------------------------------------------------- loop
  let primeiraLeitura = true;
  let falhas = 0;
  let timer = null;
  let parado = false;

  async function checar() {
    if (parado) return;
    const salvo = lerEstado();
    const idade = salvo ? Date.now() - salvo.ts : Infinity;

    if (Date.now() - lerTentativa() < INTERVALO_MS * 0.8) {
      // Outra aba do site acabou de checar; esta só acompanha.
      if (salvo) {
        if (primeiraLeitura) { mostrarLista(salvo.mapa, ' - outra aba do site está checando'); primeiraLeitura = false; }
        mostrarStatus(Object.keys(salvo.mapa).length, salvo.races || 0, salvo.ts, true);
      } else {
        mostrarStatus(null, 0, 'Outra aba do site está checando...');
      }
    } else {
      marcarTentativa();
      try {
        const { mapa, races } = await lerServidores();
        if (parado) return;
        if (falhas >= 3) { log('Conexão com o site voltou.', '#00ff90'); notificar('BR1 Monitor', 'Conexão com o site voltou.'); }
        falhas = 0;

        const atual = Object.keys(mapa).sort();
        const anterior = idade < ESTADO_VALIDO_MS ? salvo.mapa : null;
        if (anterior) {
          const abriram = atual.filter(s => !(s in anterior));
          const fecharam = Object.keys(anterior).sort().filter(s => !(s in mapa));
          const resumo = `${plural(atual.length, 'servidor aberto', 'servidores abertos')} agora - ${hora()}`;
          mostrarMudancas('ABRIU', 'ABRIRAM', abriram, mapa, resumo, '#00ff90');
          mostrarMudancas('FECHOU', 'FECHARAM', fecharam, anterior, resumo, '#ff5f5f');
        }
        if (primeiraLeitura) { mostrarLista(mapa); primeiraLeitura = false; }
        gravarEstado(mapa, races);
        mostrarStatus(atual.length, races, Date.now(), false);
      } catch (e) {
        falhas++;
        console.warn('[BR1 Monitor] erro ao ler as kill races:', e);
        log(`Não consegui ler as kill races (${falhas}): ${e.message}`, '#ffcc00');
        mostrarStatus(null, 0, `Erro na última checagem (${hora()}) - tentando de novo`);
        if (falhas === 3) notificar('BR1 Monitor: sem conexão', 'Não consegui ler as kill races 3 vezes seguidas. Continuo tentando.');
      }
    }
    if (!parado) timer = setTimeout(checar, INTERVALO_MS);
  }

  function parar() {
    parado = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', restaurarTitulo);
    painel.remove();
    delete window.__br1Monitor;
  }
  btnFechar.onclick = parar;
  window.__br1Monitor = { parar };

  log(`Monitor iniciado. Checando as kill races ao vivo a cada ${INTERVALO_MS / 1000} segundos.`, '#5ff');
  checar();
})();
