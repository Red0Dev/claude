// ==UserScript==
// @name         Respostas PudiMarin - WhatsApp Web
// @namespace    respostas-whatsapp-pudimarin
// @version      1.0
// @description  Sugere e coloca na caixa de mensagem as respostas prontas das vagas (você confere e aperta Enter)
// @match        https://web.whatsapp.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/respostas-whatsapp/respostas-whatsapp.user.js
// @downloadURL  https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/respostas-whatsapp/respostas-whatsapp.user.js
// ==/UserScript==

// Como funciona:
// - Ao abrir uma conversa no WhatsApp Web, aparece o quadro "PudiMarin · respostas" acima da caixa de mensagem.
// - Pela conversa, ele vê de que é o contato: candidato da Catho (você já mandou a mensagem da vaga, e ele
//   identifica a vaga e a loja por ela) ou interessado no freelancer.
// - Pela última mensagem recebida, sugere a resposta. Um clique coloca o texto na caixa de mensagem.
// - Quem envia é sempre você (Enter). O script nunca envia nada sozinho, para não arriscar o número.
(() => {
  'use strict';

  const VERSAO = '1.0';
  const K = { respostas: 'pmz:respostas', ui: 'pmz:ui' };

  // ------------------------------------------------------------------ utilidades
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ler = (k, padrao) => { try { const v = GM_getValue(k); return v == null ? padrao : v; } catch (e) { return padrao; } };
  const gravar = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignora */ } };
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const visivel = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const texto = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const primeiroNome = n => {
    const p = String(n || '').replace(/^~\s*/, '').trim().split(/\s+/)[0] || '';
    return p && /^[A-Za-zÀ-ÿ'-]{2,}$/.test(p) ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
  };

  // ------------------------------------------------------------------ textos
  const MSG_COZINHA = [
    'Oi! Tudo bem? Aqui é da PudiMarin.',
    'Você se cadastrou em nossa vaga de Auxiliar de Cozinha na Catho',
    '',
    'As principais atividades da função são:',
    '• Pesagem de ingredientes',
    '• Preparação de massas e recheios (cookies e pudins)',
    '• Assar os produtos',
    '• Limpeza e organização da cozinha',
    '',
    'Modelo de contratação: CLT (5x2)',
    '',
    'Horário:',
    'Segunda a quinta das 8h00 às 18h00',
    'Sexta-feira das 8h00 às 17h00',
    '',
    'Salário: R$ 1.981,04',
    'VA no cartão multibenefícios: R$ 332,40',
    'Vale-Transporte',
    '',
    'Endereço: Avenida Ministro Osvaldo Aranha, 232, Rudge Ramos, São Bernardo do Campo',
    '',
    'Gostaríamos de confirmar se você tem interesse nessas condições',
    '',
    'Se estiver de acordo, seguimos para a próxima etapa do processo seletivo',
    '',
    'Fico no aguardo da sua resposta',
  ].join('\n');
  const msgAtendente = endereco => [
    'Oi! Tudo bem? Aqui é da PudiMarin.',
    'Você se cadastrou em nossa vaga de Atendente na Catho',
    '',
    'As principais atividades da função são:',
    '• Atendimento ao cliente e caixa',
    '• Receber pedidos via aplicativo',
    '• Preparar os pedidos de forma ágil e organizada',
    '• Organizar e conferir os pedidos antes da entrega',
    '• Controlar o estoque',
    '• Responder os clientes via WhatsApp',
    '',
    'Modelo de contratação: CLT (6x1)',
    'Horário:',
    '6x na semana com uma folga fixa e 2 domingos no mês, das 11h30 às 20h30',
    '',
    'Salário: R$ 2.076,97',
    'VA no cartão multibenefícios: R$ 400,00',
    'Vale transporte',
    '',
    `Endereço: ${endereco}`,
    '',
    'Gostaríamos de confirmar se você tem interesse nessas condições.',
    'Se estiver de acordo, seguimos para a próxima etapa do processo seletivo.',
    '',
    'Fico no aguardo da sua resposta',
  ].join('\n');
  const FREELA_VAGA = [
    '{saudacao}, tudo bem? No momento temos uma vaga de atendente de delivery.',
    '',
    '*Unidade de Nova Petrópolis*',
    'As principais atividades da função são:',
    '• Atendimento ao cliente e caixa',
    '• Receber pedidos via aplicativo',
    '• Preparar os pedidos de forma ágil e organizada',
    '• Organizar e conferir os pedidos antes da entrega',
    '• Controlar o estoque',
    '• Responder os clientes via WhatsApp',
    '',
    'Freelancer FIXO de domingo, segunda ou terça das 11h30 as 20h30, valor R$ 120 + 11,90 de transporte na segunda e terça e 160 + 11,90 dia de domingo.',
    'Endereço: Av. Francisco Prestes Maia, 957 - Centro, São Bernardo do Campo',
    '',
  ].join('\n');

  const RESPOSTAS = [
    { id: 'interessado', grupo: 'Vaga CLT (Catho)', titulo: 'Tem interesse → próxima etapa',
      texto: 'Que ótimo, {nome}! Vou repassar para o responsável e já te retorno com os próximos passos do processo seletivo.' },
    { id: 'sem-interesse', grupo: 'Vaga CLT (Catho)', titulo: 'Sem interesse → agradecer',
      texto: 'Tudo bem, {nome}, obrigada pelo retorno! Se surgir outra oportunidade, entramos em contato.' },
    { id: 'vaga-cozinha', grupo: 'Vaga CLT (Catho)', titulo: 'Mensagem da vaga — Auxiliar de Cozinha (Rudge Ramos)', texto: MSG_COZINHA },
    { id: 'vaga-vergueiro', grupo: 'Vaga CLT (Catho)', titulo: 'Mensagem da vaga — Atendente (Vergueiro)',
      texto: msgAtendente('Av. Senador Vergueiro, 2123 - Rudge Ramos, São Bernardo do Campo') },
    { id: 'vaga-petropolis', grupo: 'Vaga CLT (Catho)', titulo: 'Mensagem da vaga — Atendente (Nova Petrópolis)',
      texto: msgAtendente('Av. Francisco Prestes Maia, 957 - Centro, São Bernardo do Campo') },
    { id: 'freela-cv', grupo: 'Freelancer', titulo: 'Vaga disponível → pedir currículo',
      texto: `${FREELA_VAGA}\nCaso te interesse peço que envie o currículo para eu repassar ao responsável` },
    { id: 'freela-disp', grupo: 'Freelancer', titulo: 'Vaga disponível → pedir disponibilidade',
      texto: `${FREELA_VAGA}\nCaso te interesse peço que me informe a sua disponibilidade para eu repassar ao responsável` },
    { id: 'qual-dia', grupo: 'Freelancer', titulo: 'Qual dia? (dom, seg ou ter)',
      texto: '{saudacao}, tudo bem? Pode me informar para qual dia seria, por favor? Estamos com vaga para domingo, segunda e terça. Obrigada!' },
    { id: 'freela-ok', grupo: 'Freelancer', titulo: 'Está disponível → deixar currículo',
      texto: 'Está sim, pode deixar o seu currículo que eu repasso para o responsável' },
    { id: 'recebi-cv', grupo: 'Freelancer', titulo: 'Recebi o currículo',
      texto: 'Obrigada pelo interesse, vou repassar seu currículo para o responsável e já te retorno' },
    { id: 'bairro', grupo: 'Geral', titulo: 'Pedir o bairro',
      texto: '{saudacao}, tudo bem? Pode me informar o seu bairro, por favor? Há apenas [cidade] no currículo.' },
  ];
  const textoResposta = id => { const r = RESPOSTAS.find(x => x.id === id); return (ler(K.respostas, {}) || {})[id] ?? (r ? r.texto : ''); };
  const saudacao = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'; };
  function preencher(t, nome) {
    t = String(t || '').replace(/\{saudacao\}/gi, saudacao());
    return nome ? t.replace(/\{nome\}/gi, nome) : t.replace(/,?[ \t]*\{nome\}/gi, '');
  }

  // ------------------------------------------------------------------ leitura da conversa aberta
  function conversaAberta() {
    const main = document.querySelector('#main');
    if (!main) return null;
    const header = main.querySelector('header');
    const tituloEl = header && (header.querySelector('span[dir="auto"]') || header);
    const titulo = tituloEl ? texto(tituloEl) : '';
    const msgs = [...main.querySelectorAll('.message-in, .message-out')].slice(-30).map(m => {
      const corpo = m.querySelector('.copyable-text') || m;
      return {
        entrada: m.classList.contains('message-in'),
        texto: (corpo.innerText || '').trim(),
        pdf: /\.pdf\b/i.test(m.innerText || '') || !!m.querySelector('[data-icon*="document" i], [data-icon*="pdf" i], [title$=".pdf" i]'),
      };
    });
    return { main, titulo, msgs };
  }
  // Nome: do contato salvo; senão do "~Nome" do perfil; senão de "me chamo …" na mensagem.
  function nomeDaPessoa(c) {
    if (c.titulo && !/\d{5}/.test(c.titulo)) return primeiroNome(c.titulo);
    const til = [...c.main.querySelectorAll('span')].slice(0, 400).map(e => (e.children.length ? '' : (e.textContent || '').trim())).find(t => /^~\s?[A-Za-zÀ-ÿ]/.test(t));
    if (til) return primeiroNome(til);
    const m = c.msgs.filter(x => x.entrada).map(x => x.texto).join('\n').match(/(?:me chamo|meu nome (?:é|e))\s+([A-Za-zÀ-ÿ]+)/i);
    return m ? primeiroNome(m[1]) : '';
  }
  // De que é a conversa, pelas mensagens que você mandou.
  function assunto(c) {
    const nossas = c.msgs.filter(m => !m.entrada).map(m => m.texto).join('\n');
    if (/vaga de Auxiliar de Cozinha na Catho/i.test(nossas)) return { catho: true, rotulo: 'Candidato da Catho — Auxiliar de Cozinha · Loja Rudge Ramos' };
    if (/vaga de Atendente na Catho/i.test(nossas)) {
      const loja = /Vergueiro/i.test(nossas) ? 'Vergueiro' : /Prestes Maia/i.test(nossas) ? 'Nova Petrópolis' : '';
      return { catho: true, rotulo: `Candidato da Catho — Atendente${loja ? ` · Loja ${loja}` : ''}` };
    }
    const tudo = norm(c.msgs.map(m => m.texto).join(' '));
    if (/freela|freelancer fixo/.test(tudo)) return { catho: false, rotulo: 'Interessado no freelancer' };
    return { catho: false, rotulo: c.msgs.length ? 'Conversa sem a mensagem da vaga' : 'Conversa nova' };
  }
  // Sugestão pela última mensagem recebida (depois da última que você mandou).
  function sugerir(c, catho) {
    const msgs = c.msgs;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].entrada) i--;
    const novas = msgs.slice(i + 1).filter(m => m.entrada);
    if (!novas.length) return null; // a última mensagem é sua
    const t = norm(novas.map(m => m.texto).join(' '));
    const pdf = novas.some(m => m.pdf);
    const dia = /(domingo|segunda|terca|\bdom\b|\bseg\b|\bter\b)/.test(t);
    if (/(nao tenho (mais )?interesse|sem interesse|nao (vou|posso|consigo)|ja (estou|consegui|arrumei)|desist)/.test(t)) return 'sem-interesse';
    if (catho) return /(interess|aceito|topo|quero|de acordo|\bsim\b|pode ser|claro)/.test(t) ? 'interessado' : null;
    if (pdf || /curriculo/.test(t)) return dia ? 'recebi-cv' : 'qual-dia';
    if (/freela/.test(t)) return dia ? 'freela-ok' : 'qual-dia';
    if (/(vaga|saber mais|candidat|disponivel|interess|trabalh)/.test(t)) return 'freela-cv';
    return null;
  }

  // ------------------------------------------------------------------ caixa de mensagem
  function caixaDeMensagem() {
    const main = document.querySelector('#main');
    if (!main) return null;
    const eds = [...main.querySelectorAll('[contenteditable="true"]')].filter(visivel);
    return eds.find(e => e.closest('footer')) || eds[eds.length - 1] || null;
  }
  // Coloca o texto na caixa (não envia). Se a página não aceitar, copia para colar com Ctrl+V.
  async function colocarNaCaixa(txt) {
    const el = caixaDeMensagem();
    const inicio = norm(txt).slice(0, 25);
    const entrou = () => el && norm(el.innerText || '').includes(inicio);
    if (el) {
      el.focus();
      try { document.execCommand('selectAll', false, null); } catch (e) { /* ignora */ }
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) { /* ignora */ }
      await dorme(200);
      if (!entrou()) { try { document.execCommand('insertText', false, txt); } catch (e) { /* ignora */ } await dorme(200); }
    }
    if (entrou()) return true;
    GM_setClipboard(txt, 'text');
    return false;
  }

  // ------------------------------------------------------------------ quadro
  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 18px; bottom: 86px; z-index: 2147483646; width: 340px; max-height: 62vh; display: flex; flex-direction: column;
      background: #ffffff; color: #111b21; border: 1px solid #d1d7db; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25);
      font: 13px/1.4 "Segoe UI", Roboto, Arial, sans-serif; }
    .box.escuro { background: #1f2c34; color: #e9edef; border-color: #2a3942; }
    .box.min { width: auto; } .box.min .corpo { display: none; }
    header { display: flex; gap: 8px; align-items: center; padding: 7px 10px; background: #7a2e55; color: #fff; border-radius: 9px 9px 0 0; cursor: pointer; }
    .box.min header { border-radius: 9px; }
    header .sp { flex: 1; }
    .corpo { overflow: auto; padding: 8px 10px 10px; display: grid; gap: 8px; }
    .quem b { font-size: 13.5px; }
    .muted { opacity: .75; font-size: 12px; }
    .sug { padding: 6px 8px; border-radius: 7px; background: #fff8c5; color: #3b2f00; border: 1px solid #e9d68b; }
    .grupo { display: grid; gap: 4px; }
    .grupo > span { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
    button { font: inherit; font-size: 12.5px; text-align: left; padding: 5px 9px; border-radius: 6px; border: 1px solid #aebac1; background: transparent; color: inherit; cursor: pointer; }
    button:hover { background: rgba(127,127,127,.12); }
    button.pri { background: #1f883d; border-color: #1f883d; color: #fff; text-align: center; }
    button.destaque { border-color: #e5a50a; box-shadow: inset 3px 0 0 #e5a50a; }
    .aviso { padding: 6px 8px; border-radius: 7px; background: #dafbe1; color: #0f3d1c; border: 1px solid #a6e3b4; font-size: 12px; }
    .aviso.copia { background: #ddf4ff; color: #0b3a66; border-color: #9cd0f5; }
    footer { display: flex; gap: 6px; justify-content: space-between; }
    footer button { font-size: 12px; padding: 3px 8px; }
    textarea { font: 12.5px/1.4 "Segoe UI", Roboto, Arial, sans-serif; width: 100%; box-sizing: border-box; padding: 6px; border-radius: 6px;
      border: 1px solid #aebac1; background: transparent; color: inherit; resize: vertical; }
    label.ed { display: grid; gap: 3px; font-size: 12px; }
    .linha { display: flex; gap: 6px; flex-wrap: wrap; }
  `;
  let raiz = null, aviso = null, editor = false, ultimoHtml = '', conversa = '';

  function htmlQuadro() {
    const ui = ler(K.ui, { min: false });
    const c = conversaAberta();
    const chave = c ? c.titulo : '';
    if (chave !== conversa) { conversa = chave; aviso = null; editor = false; } // trocou de conversa
    const cls = `box${document.body && /\bdark\b/.test(document.body.className) ? ' escuro' : ''}${ui.min ? ' min' : ''}`;
    const topo = `<header data-a="min">🍮 <b>PudiMarin</b> · respostas<span class="sp"></span>${ui.min ? '▴' : '▾'}</header>`;
    if (!c) return { cls, html: `${topo}<div class="corpo"><div class="muted">Abra uma conversa.</div></div>` };
    const a = assunto(c);
    const nome = nomeDaPessoa(c);
    const sug = sugerir(c, a.catho);
    const titulo = id => (RESPOSTAS.find(r => r.id === id) || {}).titulo || id;
    const quem = `<div class="quem"><b>${esc(nome || c.titulo)}</b><div class="muted">${esc(a.rotulo)}</div></div>`;
    const sugHtml = sug ? `<div class="sug">Sugestão: <b>${esc(titulo(sug))}</b> <button class="pri" data-r="${sug}">Usar</button></div>` : '';
    const avisoHtml = aviso ? `<div class="aviso${aviso.copia ? ' copia' : ''}">${esc(aviso.txt)}</div>` : '';
    const botoes = [...new Set(RESPOSTAS.map(r => r.grupo))].map(g => `<div class="grupo"><span>${esc(g)}</span>
        ${RESPOSTAS.filter(r => r.grupo === g).map(r => `<button data-r="${r.id}" class="${r.id === sug ? 'destaque' : ''}">${esc(r.titulo)}</button>`).join('')}</div>`).join('');
    const edicao = `<div class="grupo"><span>Editar respostas</span>
        <div class="muted">Pode usar {saudacao} (bom dia / boa tarde / boa noite) e {nome} (primeiro nome da pessoa).</div>
        ${RESPOSTAS.map(r => `<label class="ed"><b>${esc(r.titulo)}</b><textarea data-msg="${r.id}" rows="${Math.min(12, textoResposta(r.id).split('\n').length + 1)}">${esc(textoResposta(r.id))}</textarea></label>`).join('')}
        <div class="linha"><button class="pri" data-a="salvar">Salvar</button><button data-a="padrao">Voltar ao original</button><button data-a="editor">Fechar</button></div></div>`;
    return {
      cls,
      html: `${topo}<div class="corpo">${quem}${avisoHtml}${sugHtml}${editor ? edicao : botoes}
        <footer><button data-a="editor">✏️ Editar respostas</button><button data-a="diag">Diagnóstico</button></footer></div>`,
    };
  }
  function desenhar(forcar) {
    if (!raiz) return;
    const foco = raiz.activeElement;
    if (foco && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) return; // não atrapalha quem está digitando
    if (aviso && Date.now() - aviso.em > 8000) aviso = null;
    const { cls, html } = htmlQuadro();
    if (!forcar && html === ultimoHtml) return;
    ultimoHtml = html;
    const box = raiz.querySelector('.box');
    box.className = cls;
    box.innerHTML = html;
  }

  // Diagnóstico: só a estrutura da página, com letras e números trocados por x e 9.
  const mascarar = s => String(s).slice(0, 120).replace(/[A-Za-zÀ-ÿ]+/g, w => 'x'.repeat(Math.min(w.length, 4))).replace(/\d/g, '9');
  function esqueleto(el, prof = 0, cota = { n: 0 }) {
    if (!el || cota.n++ > 60 || prof > 10) return '';
    const attrs = ['id', 'class', 'role', 'data-icon', 'data-tab', 'contenteditable', 'data-id', 'aria-label', 'aria-placeholder', 'title']
      .map(a => { const v = el.getAttribute && el.getAttribute(a); return v ? ` ${a}="${/^(class|role|data-icon|data-tab|contenteditable|id)$/.test(a) ? String(v).slice(0, 80) : mascarar(v)}"` : ''; }).join('');
    const proprio = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join(' ').trim();
    return `${' '.repeat(prof)}<${el.tagName.toLowerCase()}${attrs}>${proprio ? ' ' + mascarar(proprio) : ''}\n${el.tagName === 'svg' ? '' : [...el.children].map(f => esqueleto(f, prof + 1, cota)).join('')}`;
  }

  async function aoClicar(ev) {
    const el = ev.target.closest('[data-a], [data-r]');
    if (!el) return;
    const c = conversaAberta();
    if (el.dataset.r) {
      const ok = await colocarNaCaixa(preencher(textoResposta(el.dataset.r), c ? nomeDaPessoa(c) : ''));
      aviso = { em: Date.now(), copia: !ok, txt: ok ? 'Pronto: a resposta está na caixa de mensagem. Confira e aperte Enter.'
        : 'Copiei a resposta. Clique na caixa de mensagem e aperte Ctrl+V.' };
      desenhar(true);
      return;
    }
    const a = el.dataset.a;
    if (a === 'min') { const ui = ler(K.ui, { min: false }); gravar(K.ui, { ...ui, min: !ui.min }); desenhar(true); }
    else if (a === 'editor') { editor = !editor; desenhar(true); }
    else if (a === 'salvar') {
      const novas = {};
      raiz.querySelectorAll('textarea[data-msg]').forEach(t => { novas[t.dataset.msg] = t.value.replace(/\r/g, ''); });
      gravar(K.respostas, novas);
      editor = false;
      aviso = { em: Date.now(), txt: 'Respostas salvas.' };
      desenhar(true);
    }
    else if (a === 'padrao') { if (confirm('Voltar todas as respostas para o texto original?')) { gravar(K.respostas, {}); desenhar(true); } }
    else if (a === 'diag') {
      const cx = caixaDeMensagem();
      GM_setClipboard(JSON.stringify({
        versao: VERSAO, conversaAberta: !!c, titulo: c ? mascarar(c.titulo) : null,
        mensagens: c ? { recebidas: c.msgs.filter(m => m.entrada).length, enviadas: c.msgs.filter(m => !m.entrada).length } : null,
        assunto: c ? assunto(c).rotulo : null, sugestao: c ? sugerir(c, assunto(c).catho) : null, achouNome: !!(c && nomeDaPessoa(c)),
        cabecalho: c && c.main.querySelector('header') ? esqueleto(c.main.querySelector('header')) : null,
        caixaDeMensagem: cx ? esqueleto(cx) : null,
        ultimasMensagens: c ? [...c.main.querySelectorAll('.message-in, .message-out')].slice(-2).map(m => esqueleto(m)) : [],
      }, null, 1), 'text');
      aviso = { em: Date.now(), copia: true, txt: 'Diagnóstico copiado (sem os textos das conversas). Cole no chat com o Claude.' };
      desenhar(true);
    }
  }

  function iniciar() {
    if (!document.body || document.getElementById('pmz-respostas')) return;
    const host = document.createElement('div');
    host.id = 'pmz-respostas';
    document.body.appendChild(host);
    raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `<style>${CSS}</style><div class="box"></div>`;
    raiz.addEventListener('click', aoClicar);
    let espera = null;
    new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(() => desenhar(false), 500); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => desenhar(false), 4000); // apaga avisos antigos
    desenhar(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
