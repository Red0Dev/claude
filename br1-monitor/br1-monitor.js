// ==UserScript==
// @name         BR1 Monitor de servidores
// @namespace    br1-monitor
// @version      2.0
// @description  Avisa quando um servidor da Kill Race do BR1 abre ou fecha
// @match        https://www.br1game.com/*
// @grant        none
// ==/UserScript==

// Cole este código no Console (F12) da página da kill race, ou instale no Tampermonkey.
// Ele roda dentro da aba do site, consulta a lista de servidores a cada 30 s e
// mostra uma notificação do Windows quando um servidor ABRE ou FECHA.
(() => {
  'use strict';

  const RACE_PADRAO = '0074b0b7-a886-4f27-9a15-971052cbc158';
  const INTERVALO_MS = 30 * 1000;

  const achado = location.pathname.match(/kill-race\/info\/([0-9a-f-]{36})/i);
  const uuid = achado ? achado[1] : RACE_PADRAO;
  const API = `/api/game/killrace/info/${uuid}`;

  // Se já estiver rodando (colou de novo), desliga o anterior.
  if (window.__br1Monitor) window.__br1Monitor.parar();

  // ------------------------------------------------------------- painel na tela
  const el = (tag, css, texto) => {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const botaoCss = 'background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit';

  const painel = el('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:320px;background:#111;color:#ddd;' +
    'border:1px solid #444;border-radius:8px;padding:10px;font:12px/1.45 Consolas,monospace;box-shadow:0 4px 18px rgba(0,0,0,.6)');
  const topo = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px');
  const titulo = el('b', 'color:#00ff90', 'BR1 Monitor');
  const botoes = el('span', 'display:flex;gap:4px');
  const btnAvisos = el('button', botaoCss + ';border-color:#00ff90;color:#00ff90', 'Ativar avisos');
  const btnMin = el('button', botaoCss, '_');
  const btnFechar = el('button', botaoCss, 'x');
  btnMin.title = 'Minimizar';
  btnFechar.title = 'Parar o monitor';
  botoes.append(btnAvisos, btnMin, btnFechar);
  topo.append(titulo, botoes);
  const status = el('div', 'color:#999;margin-bottom:6px', 'Iniciando...');
  const logBox = el('div', 'max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word');
  painel.append(topo, status, logBox);
  document.body.appendChild(painel);

  const hora = () => new Date().toLocaleTimeString('pt-BR');
  const log = (texto, cor = '#bbb') => {
    const linha = el('div', `color:${cor}`, `[${hora()}] ${texto}`);
    logBox.prepend(linha);
    while (logBox.childElementCount > 150) logBox.lastChild.remove();
  };

  btnMin.onclick = () => {
    const escondido = logBox.style.display === 'none';
    logBox.style.display = status.style.display = escondido ? '' : 'none';
  };

  // ------------------------------------------------------------- notificações
  const temNotificacao = 'Notification' in window;
  const atualizarBotao = () => {
    if (!temNotificacao) { btnAvisos.textContent = 'Sem suporte'; btnAvisos.disabled = true; return; }
    if (Notification.permission === 'granted') { btnAvisos.style.display = 'none'; }
    else if (Notification.permission === 'denied') { btnAvisos.textContent = 'Avisos bloqueados'; }
  };
  atualizarBotao();

  btnAvisos.onclick = async () => {
    if (!temNotificacao) return;
    if (Notification.permission === 'denied') {
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
  const restaurarTitulo = () => { if (!document.hidden) document.title = tituloOriginal; };
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
  let anterior = null;
  let falhas = 0;
  let timer = null;
  let parado = false;

  async function checar() {
    if (parado) return;
    try {
      const atual = await lerServidores();
      if (falhas >= 3) { log('Conexão com o site voltou.', '#00ff90'); notificar('BR1 Monitor', 'Conexão com o site voltou.'); }
      falhas = 0;

      if (anterior === null) {
        atual.slice().reverse().forEach(s => log(`   ${s}`, '#fff'));
        log(`Servidores abertos agora (${atual.length}):`, '#5ff');
      } else {
        const abriram = atual.filter(s => !anterior.includes(s));
        const fecharam = anterior.filter(s => !atual.includes(s));
        const resumo = `${atual.length} servidores abertos agora - ${hora()}`;
        mostrarMudancas('ABRIU', 'ABRIRAM', abriram, resumo, '#00ff90');
        mostrarMudancas('FECHOU', 'FECHARAM', fecharam, resumo, '#ff5f5f');
      }
      anterior = atual;
      status.textContent = `${atual.length} servidores abertos - checado às ${hora()}`;
    } catch (e) {
      falhas++;
      log(`Não consegui ler a lista (${falhas}): ${e.message}`, '#ffcc00');
      status.textContent = `Erro na última checagem (${hora()}) - tentando de novo`;
      if (falhas === 3) notificar('BR1 Monitor: sem conexão', 'Não consegui ler a lista de servidores 3 vezes seguidas. Continuo tentando.');
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
