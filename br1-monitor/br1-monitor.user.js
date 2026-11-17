// ==UserScript==
// @name         BR1 Monitor de servidores
// @namespace    br1-monitor
// @version      2.1
// @description  Avisa quando um servidor da Kill Race do BR1 abre ou fecha
// @match        https://www.br1game.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/Red0Dev/claude/claude/keen-cerf-kli3yh/br1-monitor/br1-monitor.user.js
// ==/UserScript==

// Instale no Tampermonkey (ou cole no Console com F12, na página do site).
// Ele roda dentro da aba do site, consulta a lista de servidores a cada 30 s e
// mostra uma notificação do Windows quando um servidor ABRE ou FECHA.
(() => {
  'use strict';

  const RACE_PADRAO = '0074b0b7-a886-4f27-9a15-971052cbc158';
  const INTERVALO_MS = 30 * 1000;
  const ESTADO_VALIDO_MS = 10 * 60 * 1000; // lista guardada há mais tempo que isso é ignorada

  const achado = location.pathname.match(/kill-race\/info\/([0-9a-f-]{36})/i);
  const uuid = achado ? achado[1] : RACE_PADRAO;
  const API = `/api/game/killrace/info/${uuid}`;
  const CHAVE = `br1-monitor:${uuid}`;
  const CHAVE_MIN = 'br1-monitor:minimizado';

  // Se já estiver rodando (colou de novo), desliga o anterior.
  if (window.__br1Monitor) window.__br1Monitor.parar();

  // ------------------------------------------------------------- memória compartilhada entre abas
  // Todas as abas do site enxergam a última lista. Assim só uma aba consulta por vez
  // e você não recebe o mesmo aviso repetido.
  const lerEstado = () => {
    try { const e = JSON.parse(localStorage.getItem(CHAVE)); return e && Array.isArray(e.lista) ? e : null; } catch (e) { return null; }
  };
  const gravarEstado = lista => {
    try { localStorage.setItem(CHAVE, JSON.stringify({ lista, ts: Date.now() })); } catch (e) { /* ignora */ }
  };
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

  const painel = el('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:320px;background:#111;color:#ddd;' +
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
  document.body.appendChild(painel);

  const aplicarMin = min => {
    corpo.style.display = min ? 'none' : '';
    painel.style.width = min ? 'auto' : '320px';
    btnMin.textContent = min ? '+' : '_';
    btnMin.title = min ? 'Mostrar' : 'Minimizar';
  };
  aplicarMin(lerMin());
  btnMin.onclick = () => { const min = corpo.style.display !== 'none'; gravarMin(min); aplicarMin(min); };

  const hora = (t = Date.now()) => new Date(t).toLocaleTimeString('pt-BR');
  const log = (texto, cor = '#bbb') => {
    logBox.prepend(el('div', `color:${cor}`, `[${hora()}] ${texto}`));
    while (logBox.childElementCount > 150) logBox.lastChild.remove();
  };
  const mostrarStatus = (n, texto) => {
    status.textContent = texto;
    titulo.textContent = n == null ? 'BR1 Monitor' : `BR1 Monitor - ${n} servidores`;
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

  // ------------------------------------------------------------- leitura da lista
  async function lerServidores() {
    const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
    const d = await r.json();
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('resposta em formato inesperado');
    // A própria página trata "sem campo servers" como lista vazia (modo Global).
    if (!('servers' in d) && !('begin' in d) && !('prize' in d)) throw new Error('resposta sem lista de servidores');
    const nomes = (Array.isArray(d.servers) ? d.servers : [])
      .map(s => (typeof s === 'string' ? s : (s && s.name) || JSON.stringify(s)))
      .map(s => String(s).trim())
      .filter(Boolean);
    return [...new Set(nomes)].sort();
  }

  const mostrarMudancas = (acao, acaoPlural, lista, resumo, cor) => {
    if (!lista.length) return;
    lista.forEach(s => log(`${acao} ${s}`, cor));
    if (lista.length <= 3) lista.forEach(s => notificar(`${acao} ${s}`, resumo));
    else notificar(`${acaoPlural} ${lista.length} SERVIDORES`, `${lista.join('\n')}\n${resumo}`);
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

    if (idade < INTERVALO_MS * 0.8) {
      // Outra aba do site acabou de checar; esta só acompanha.
      if (primeiraLeitura) {
        salvo.lista.slice().reverse().forEach(s => log(`   ${s}`, '#fff'));
        log(`Servidores abertos agora (${salvo.lista.length}) - outra aba do site está checando:`, '#5ff');
        primeiraLeitura = false;
      }
      mostrarStatus(salvo.lista.length, `${salvo.lista.length} servidores abertos - checado às ${hora(salvo.ts)} (por outra aba)`);
    } else {
      try {
        const atual = await lerServidores();
        if (parado) return;
        if (falhas >= 3) { log('Conexão com o site voltou.', '#00ff90'); notificar('BR1 Monitor', 'Conexão com o site voltou.'); }
        falhas = 0;

        const anterior = idade < ESTADO_VALIDO_MS ? salvo.lista : null;
        if (anterior) {
          const abriram = atual.filter(s => !anterior.includes(s));
          const fecharam = anterior.filter(s => !atual.includes(s));
          const resumo = `${atual.length} servidores abertos agora - ${hora()}`;
          mostrarMudancas('ABRIU', 'ABRIRAM', abriram, resumo, '#00ff90');
          mostrarMudancas('FECHOU', 'FECHARAM', fecharam, resumo, '#ff5f5f');
        }
        if (primeiraLeitura) {
          atual.slice().reverse().forEach(s => log(`   ${s}`, '#fff'));
          log(`Servidores abertos agora (${atual.length}):`, '#5ff');
          primeiraLeitura = false;
        }
        gravarEstado(atual);
        mostrarStatus(atual.length, `${atual.length} servidores abertos - checado às ${hora()}`);
      } catch (e) {
        falhas++;
        log(`Não consegui ler a lista (${falhas}): ${e.message}`, '#ffcc00');
        mostrarStatus(null, `Erro na última checagem (${hora()}) - tentando de novo`);
        if (falhas === 3) notificar('BR1 Monitor: sem conexão', 'Não consegui ler a lista de servidores 3 vezes seguidas. Continuo tentando.');
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

  log(`Monitor iniciado. Checando a cada ${INTERVALO_MS / 1000} segundos.`, '#5ff');
  checar();
})();
