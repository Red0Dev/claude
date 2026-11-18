// ==UserScript==
// @name         Filtro de candidatos Catho - PudiMarin
// @namespace    filtro-catho-pudimarin
// @version      2.0
// @description  Todo dia confere os candidatos das vagas na Catho, calcula o ônibus até as lojas e dá 👍 em quem mora perto
// @match        https://*.catho.com.br/*
// @match        https://catho.com.br/*
// @run-at       document-start
// @noframes
// @sandbox      JavaScript
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_openInTab
// @connect      routes.googleapis.com
// @updateURL    https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js
// @downloadURL  https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js
// ==/UserScript==

// Como funciona:
// 1. Todo dia, no horário escolhido, se houver uma aba da Catho aberta, o script abre outra aba
//    em "Minhas vagas", entra nos candidatos de Auxiliar de Cozinha e de Atendente de Delivery
//    e lê nome, idade, cidade e bairro de cada um.
// 2. Para cada candidato, pergunta ao Google quanto tempo leva de ônibus (dia útil, 8h) do bairro
//    dele até cada loja da vaga, e fica com a loja mais perto.
// 3. Quem estiver dentro do limite (padrão 45 min) ganha 👍 em "Avalie". O script abre "contatos"
//    para pegar o WhatsApp e avisa com uma notificação. Na primeira vez, ele marca em vermelho
//    os 👍 que daria e espera você conferir antes de clicar.
// 4. Enquanto você navega na Catho, o painel no canto mostra os tempos de ônibus de quem aparece.
(() => {
  'use strict';

  const VERSAO = '2.0';
  const VAGAS = { cozinha: 'Auxiliar de Cozinha', atendente: 'Atendente de Delivery' };
  const UNIDADES = [
    {
      id: 'rudge', nome: 'Rudge Ramos', vaga: 'cozinha',
      endereco: 'Av. Min. Osvaldo Aranha, 232 - Loja 4 - Vila Franca, São Bernardo do Campo - SP, 09626-000',
      rota: 'Av. Ministro Osvaldo Aranha, 232, Vila Franca, São Bernardo do Campo - SP, 09626-000, Brasil',
    },
    {
      id: 'vergueiro', nome: 'Vergueiro', vaga: 'atendente',
      endereco: 'Av. Senador Vergueiro, 2123 - Lj 1 - Rudge Ramos, São Bernardo do Campo - SP, 09726-253',
      rota: 'Av. Senador Vergueiro, 2123, Rudge Ramos, São Bernardo do Campo - SP, 09726-253, Brasil',
    },
    {
      id: 'novapetropolis', nome: 'Nova Petrópolis', vaga: 'atendente',
      endereco: 'Av. Francisco Prestes Maia, 957 - Lj 14 - Centro, São Bernardo do Campo - SP, 09770-000',
      rota: 'Av. Francisco Prestes Maia, 957, Centro, São Bernardo do Campo - SP, 09770-000, Brasil',
    },
  ];
  const unidade = id => UNIDADES.find(u => u.id === id);
  const URL_VAGAS = 'https://www.catho.com.br/area-empresa/minhas-vagas/';

  // pm:worker = andamento da verificação (na aba que verifica); pm:varredura = agenda e último resultado
  const K = { cand: 'pm:candidatos', cfg: 'pm:config', ui: 'pm:ui', worker: 'pm:worker', varredura: 'pm:varredura' };
  const CFG_PADRAO = { chave: '', limite: 45, medida: 'min', vagaPagina: '', diario: true, hora: '09:00', pegarWhats: true, curtirConfirmado: false };
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ------------------------------------------------------------------ utilidades
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const nkey = k => semAcento(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  const digitos = s => String(s ?? '').replace(/\D/g, '');
  const ler = (k, padrao) => { try { const v = GM_getValue(k); return v == null ? padrao : v; } catch (e) { return padrao; } };
  const gravar = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignora */ } };
  const cfg = () => ({ ...CFG_PADRAO, ...ler(K.cfg, {}) });
  const candidatos = () => ler(K.cand, {});
  const salvarCandidatos = m => { gravar(K.cand, m); agendarRender(); };

  // Telefone: devolve "11987654321" (DDD + número) ou null.
  const limparFone = s => {
    let d = digitos(s);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    return d.length === 10 || d.length === 11 ? d : null;
  };
  const ehCelular = d => d && d.length === 11 && d[2] === '9';
  const formatarFone = d => d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

  // Diz a vaga pelo texto: só responde se aparecer UMA das duas.
  const classificar = texto => {
    const t = norm(texto);
    const coz = /cozinh/.test(t);
    const ate = /atendent|delivery|entregas? de balc|balconist/.test(t);
    return coz && !ate ? 'cozinha' : ate && !coz ? 'atendente' : null;
  };
  const vagaDaPagina = () => {
    const c = cfg();
    if (c.vagaPagina) return c.vagaPagina;
    const h = [...document.querySelectorAll('h1, h2')].slice(0, 4).map(e => e.textContent).join(' ');
    return classificar(`${document.title} ${h}`);
  };

  // ------------------------------------------------------------------ leitura dos dados (JSON)
  const RX = {
    nome: /^(nome|name|nomecompleto|fullname|completename|candidatename|nomecandidato|candidatonome|displayname)$/,
    fone: /(phone|telefone|fone|celular|mobile|whats)/,
    ddd: /^(ddd|areacode|codigoarea|codarea|prefixo)$/,
    cep: /(^cep|cep$|zip|postal)/,
    rua: /(logradouro|street|endereco|address|^rua$|addressline)/,
    numero: /^(numero|number|num|nro|streetnumber|addressnumber)$/,
    bairro: /(bairro|neighbo|district|distrito)/,
    cidade: /(cidade|city|municipio)/,
    naoCidade: /(ethnicity|capacity|velocity|electricity|publicity|authenticity)/,
    uf: /^(uf|estado|state|siglaestado|stateabbreviation|stateacronym|siglauf)$/,
    vaga: /(cargo|vaga|job|titulo|title|position|funcao|oportunidade)/,
    // partes do currículo com telefone/endereço de OUTRAS pessoas, empresas ou da própria vaga
    pular: /(experien|empreg|historico|formac|educa|curso|referenc|empresa|company|employer|recrutador|recruiter|anunciante|vaga|job|oportunidade|anuncio|position|cargo)/,
    // chaves que nunca guardam uma pessoa (ex.: { city: { name: "São Bernardo do Campo" } })
    naoPessoa: /(cidade|city|municipio|estado|state|bairro|neighbo|district|vaga|job|empresa|company|recrut|recruit|cargo|position|anunc|oportunidade|country|pais|regiao|region)/,
    contexto: /(candidat|curricul|resume|applicant|cv|inscri|talent|profission)/,
  };
  const ehCidade = nk => RX.cidade.test(nk) && !RX.naoCidade.test(nk);
  const NAO_NOME = /\b(auxiliar|atendente|cozinha|delivery|vaga|vagas|loja|ltda|eireli|empresa|restaurante|sao paulo|sao bernardo|santo andre|sao caetano|diadema|maua|ribeirao pires|rio grande da serra|guarulhos|osasco|brasil)\b/;
  const nomePessoa = v => typeof v === 'string' && /^[A-Za-zÀ-ÿ'´`.\- ]{5,80}$/.test(v.trim()) && v.trim().split(/\s+/).length >= 2 && !NAO_NOME.test(norm(v));
  const textoDe = v => {
    if (v == null) return '';
    if (typeof v !== 'object') return String(v).trim();
    for (const k of ['sigla', 'abbreviation', 'acronym', 'uf', 'nome', 'name', 'descricao', 'description', 'label', 'value']) {
      if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    }
    return '';
  };

  function coletar(obj, prof, acc) {
    if (prof > 4 || obj == null || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.slice(0, 20).forEach(x => coletar(x, prof + 1, acc)); return; }
    const ents = Object.entries(obj);
    let ddd = null, num = null, temRua = false;
    for (const [k, v] of ents) {
      const nk = nkey(k);
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      if (RX.ddd.test(nk)) ddd = String(v);
      else if (/(numero|number|telefone|phone|celular)$/.test(nk)) num = String(v);
      if (RX.rua.test(nk) && !RX.cep.test(nk) && !/(mail|ip|web|url|site|link)/.test(nk) && typeof v === 'string') temRua = true;
    }
    if (ddd && num && digitos(num).length >= 8 && digitos(num).length <= 9) acc.fones.push(ddd + num);
    for (const [k, v] of ents) {
      const nk = nkey(k);
      if (RX.pular.test(nk)) continue;
      if (v && typeof v === 'object') {
        if (!Array.isArray(v)) {
          if (ehCidade(nk) && !acc.cidade) acc.cidade = textoDe(v);
          else if (RX.uf.test(nk) && !acc.uf) acc.uf = textoDe(v);
          else if (RX.bairro.test(nk) && !acc.bairro) acc.bairro = textoDe(v);
        }
        coletar(v, prof + 1, acc);
        continue;
      }
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const s = String(v).trim();
      if (!s) continue;
      if (RX.fone.test(nk)) acc.fones.push(s);
      else if (RX.cep.test(nk)) { if (!acc.cep && digitos(s).length === 8) acc.cep = s; }
      else if (RX.bairro.test(nk)) { if (!acc.bairro) acc.bairro = s; }
      else if (ehCidade(nk)) { if (!acc.cidade) acc.cidade = s; }
      else if (RX.uf.test(nk)) { if (!acc.uf && s.length <= 20) acc.uf = s; }
      else if (RX.rua.test(nk) && !/(mail|ip|web|url|site|link)/.test(nk) && typeof v === 'string' && /[A-Za-zÀ-ÿ]{3}/.test(s) && !/[@/]/.test(s)) { if (!acc.rua) acc.rua = s; }
      else if (temRua && RX.numero.test(nk)) { if (!acc.numero) acc.numero = s; }
    }
  }

  const montarEndereco = a => {
    const rua = a.rua ? (a.numero && !a.rua.includes(a.numero) ? `${a.rua}, ${a.numero}` : a.rua) : '';
    const cid = a.cidade ? (a.uf ? `${a.cidade} - ${a.uf}` : a.cidade) : '';
    const cep = a.cep ? digitos(a.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '';
    return [rua, a.bairro, cid, cep].filter(Boolean).join(', ');
  };
  // Dá para medir? Precisa de CEP, rua ou bairro (só a cidade é pouco).
  const enderecoSuficiente = (end) => /\b\d{5}-?\d{3}\b/.test(end || '') || (end || '').split(',').filter(p => p.trim()).length >= 2;

  // Textos de vaga/cargo dentro do candidato (vaga em que se inscreveu), sem olhar experiências.
  function textoVaga(o, prof) {
    if (prof > 3 || !o || typeof o !== 'object') return '';
    return Object.entries(o).map(([k, v]) => {
      const nk = nkey(k);
      if (/(experien|empreg|historico|formac|educa|curso|referenc|pretend|objetivo|interesse)/.test(nk)) return '';
      if (RX.vaga.test(nk)) return typeof v === 'string' ? v : v && typeof v === 'object' ? textoDe(v) || textoVaga(v, prof + 1) : '';
      return v && typeof v === 'object' ? textoVaga(v, prof + 1) : '';
    }).filter(Boolean).join(' ');
  }

  function procurar(no, ctx, prof, achados) {
    if (prof > 12 || no == null || typeof no !== 'object') return;
    if (Array.isArray(no)) { no.forEach(x => procurar(x, ctx, prof + 1, achados)); return; }
    const chaves = Object.keys(no).map(nkey);
    const podeSerPessoa = !RX.naoPessoa.test(ctx.ultima || '') && !chaves.some(k => /^(cnpj|razaosocial|nomefantasia)$/.test(k));
    const chaveNome = podeSerPessoa && Object.keys(no).find(k => RX.nome.test(nkey(k)) && nomePessoa(no[k]));
    if (chaveNome) {
      const acc = { fones: [] };
      coletar(no, 0, acc);
      const temDados = acc.fones.length || acc.cep || acc.rua || acc.bairro || acc.cidade;
      const temContexto = RX.contexto.test(ctx.chaves) || chaves.some(k => RX.contexto.test(k));
      if (temDados && temContexto) {
        achados.push({ nome: no[chaveNome].trim(), acc, vaga: classificar(ctx.vagaTexto) || ctx.vagaPagina || classificar(textoVaga(no, 0)) });
        return;
      }
    }
    // texto de vaga (título da vaga) que vale para tudo que estiver abaixo deste nível
    const aqui = Object.entries(no).filter(([k, v]) => RX.vaga.test(nkey(k)) && (typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v))))
      .map(([, v]) => typeof v === 'string' ? v : textoDe(v) || Object.values(v).filter(x => typeof x === 'string').join(' ')).join(' ');
    const vagaTexto = classificar(aqui) ? aqui : ctx.vagaTexto;
    for (const [k, v] of Object.entries(no)) {
      if (v && typeof v === 'object') procurar(v, { ...ctx, chaves: `${ctx.chaves} ${nkey(k)}`, ultima: Array.isArray(no) ? ctx.ultima : nkey(k), vagaTexto }, prof + 1, achados);
    }
  }

  function registrar(achados, fonte) {
    if (!achados.length) return;
    const mapa = candidatos();
    let mudou = false;
    for (const a of achados) {
      const id = norm(a.nome);
      const fones = [...new Set(a.acc.fones.map(limparFone).filter(Boolean))];
      const endereco = montarEndereco(a.acc);
      const atual = mapa[id];
      const novo = atual ? { ...atual } : { id, nome: a.nome, fones: [], endereco: '', vagas: [], fonte, capturadoEm: Date.now() };
      novo.fones = [...new Set([...(novo.fones || []), ...fones])];
      if (endereco && endereco !== novo.endereco && (!novo.endereco || endereco.length > novo.endereco.length)) {
        novo.endereco = endereco;
        delete novo.rota;
      }
      if (a.vaga && !novo.vagas.includes(a.vaga)) { novo.vagas = [...novo.vagas, a.vaga]; delete novo.rota; }
      if (JSON.stringify(novo) !== JSON.stringify(atual)) { mapa[id] = novo; mudou = true; }
    }
    if (mudou) { salvarCandidatos(mapa); processarFila(); }
  }

  // ------------------------------------------------------------------ escuta das respostas da Catho
  const diag = { hook: false, respostas: 0, endpoints: {}, capturados: { api: 0, pagina: 0 }, erros: [] };
  function aoReceberJson(url, json) {
    try {
      if (/(google|facebook|hotjar|clarity|segment|datadog|newrelic|sentry|doubleclick|tiktok|linkedin|bing)\./i.test(url || '')) return;
      diag.respostas++;
      const caminho = String(url || '').split('?')[0].replace(/\/\d{3,}(?=\/|$)/g, '/{id}');
      if (!diag.endpoints[caminho] && Object.keys(diag.endpoints).length < 30) diag.endpoints[caminho] = esqueleto(json, 0);
      const achados = [];
      procurar(json, { chaves: nkey(url || ''), ultima: '', vagaTexto: '', vagaPagina: vagaDaPagina() }, 0, achados);
      diag.capturados.api += achados.length;
      registrar(achados, 'api');
    } catch (e) { if (diag.erros.length < 5) diag.erros.push(String(e)); }
  }

  try {
    const fetchOriginal = W.fetch;
    if (typeof fetchOriginal === 'function') {
      W.fetch = function (...args) {
        const p = fetchOriginal.apply(this, args);
        p.then(r => {
          try {
            if (/json/i.test(r.headers.get('content-type') || '')) r.clone().json().then(j => aoReceberJson(r.url, j)).catch(() => {});
          } catch (e) { /* ignora */ }
        }).catch(() => {});
        return p;
      };
    }
    const XHR = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (XHR) {
      const abrir = XHR.open, enviar = XHR.send;
      XHR.open = function (metodo, url) { this.__pmUrl = url; return abrir.apply(this, arguments); };
      XHR.send = function () {
        this.addEventListener('load', () => {
          try {
            if (!/json/i.test(this.getResponseHeader('content-type') || '')) return;
            const j = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            aoReceberJson(this.responseURL || this.__pmUrl, j);
          } catch (e) { /* ignora */ }
        });
        return enviar.apply(this, arguments);
      };
    }
    diag.hook = true;
  } catch (e) { diag.erros.push(`hook: ${e}`); }

  // Dados que vêm embutidos no HTML (sites em Next.js/Nuxt)
  function lerJsonEmbutido() {
    document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__').forEach(s => {
      if (s.__pmLido) return;
      s.__pmLido = true;
      try { aoReceberJson(location.pathname, JSON.parse(s.textContent)); } catch (e) { /* ignora */ }
    });
  }


  // ------------------------------------------------------------------ utilidades de página
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  async function esperar(fn, ms = 20000, passo = 500) {
    const fim = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= fim) return null;
      await dorme(passo);
    }
  }
  const visivel = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const texto = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const nossa = el => el.id === 'pm-filtro-catho' || (el.closest && el.closest('#pm-filtro-catho'));
  const IGNORAR_TAG = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|TITLE|META|LINK)$/;
  // Os menores elementos visíveis cujo texto bate com rx (o texto pode estar quebrado em vários <span>).
  function menores(rx, max = 80, raiz = document.body) {
    if (!raiz) return [];
    const todos = [...raiz.querySelectorAll('*')].filter(e => !IGNORAR_TAG.test(e.tagName) && !nossa(e)
      && (e.textContent || '').length <= max * 3 && texto(e).length <= max && rx.test(texto(e)));
    return todos.filter(e => !todos.some(o => o !== e && e.contains(o)) && visivel(e));
  }
  const CLICAVEL = 'button, a, [role="button"], [role="link"], [role="tab"], input[type="button"], input[type="radio"], label';
  function clicar(el) {
    if (!el) return;
    const alvo = el.closest(CLICAVEL) || el;
    try { alvo.scrollIntoView({ block: 'center' }); } catch (e) { /* ignora */ }
    if (typeof alvo.click === 'function') alvo.click();
    else alvo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  const classeDe = e => !e ? '' : typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '';
  const RX_FONE = /(?:\+?55\s?)?\(?\b\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}\b/g;
  const fonesNaTela = () => [...new Set(((document.body && document.body.innerText) || '').match(RX_FONE) || [])].map(limparFone).filter(Boolean);
  const naAreaEmpresa = () => /\/area-empresa/i.test(location.pathname);

  // ------------------------------------------------------------------ cartões de candidato (lista da vaga)
  // Cada cartão tem: nome (link), "34 anos, Solteiro, São Bernardo do Campo, SP - Jardim da represa",
  // botões "enviar mensagem" e "contatos", e "Avalie" com 👍 e 👎.
  function acharCards() {
    let ancoras = menores(/^avalie:?$/i, 20);
    const porAvalie = ancoras.length > 0;
    if (!porAvalie) ancoras = menores(/^contatos?$/i, 20);
    const cards = [];
    for (const a of ancoras) {
      let el = a;
      while (el.parentElement && el.parentElement !== document.body && ancoras.filter(x => el.parentElement.contains(x)).length === 1) el = el.parentElement;
      const d = dadosDoCard(el);
      if (d.nome && (porAvalie || d.info)) cards.push({ ...d, card: el, ancora: a, id: norm(d.nome) });
    }
    return cards;
  }

  function dadosDoCard(card) {
    const infos = [...card.querySelectorAll('*')].filter(e => !IGNORAR_TAG.test(e.tagName) && (e.textContent || '').length < 300
      && /\b\d{1,2}\s+anos?\b[^]*,\s*[A-Z]{2}\b/.test(texto(e)));
    const info = infos.filter(e => !infos.some(o => o !== e && e.contains(o)))[0] || null;
    const linha = info ? texto(info) : '';
    const m = linha.match(/,\s*([^,]+?)\s*,\s*([A-Z]{2})\b(?:\s*-\s*(.+?))?\s*$/);
    const nomes = [...card.querySelectorAll('a, h1, h2, h3, h4, h5, strong, b, [class*="name" i], [class*="nome" i]')]
      .filter(e => !e.closest('header, nav') && nomePessoa(texto(e)))
      .filter(e => !info || (e.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING));
    const nomeEl = info ? nomes[nomes.length - 1] : nomes[0];
    return { nome: nomeEl ? texto(nomeEl) : null, cidade: m ? m[1] : '', uf: m ? m[2] : '', bairro: m && m[3] ? m[3] : '', info: linha };
  }

  function lerCards(vaga) {
    const cards = acharCards();
    const v = vaga || vagaDaPagina();
    registrar(cards.map(c => ({ nome: c.nome, acc: { fones: [], bairro: c.bairro, cidade: c.cidade, uf: c.uf }, vaga: v })), 'lista');
    diag.capturados.lista = Math.max(diag.capturados.lista || 0, cards.length);
    return cards;
  }

  // 👍 e 👎 que ficam depois de "Avalie"
  const DICA_DOWN = /(dislike|desgost|nao.?gost|negativ|thumbs?.?down|thumb_down|reprov|unlike)/;
  const DICA_UP = /(like|gost|positiv|thumbs?.?up|thumb_up|curti|aprov|joinha)/;
  function botoesAvaliacao(c) {
    const segue = e => c.ancora.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING;
    const pegar = area => {
      let l = [...area.querySelectorAll(CLICAVEL)].filter(e => segue(e) && !c.ancora.contains(e) && visivel(e));
      if (l.length < 2) l = [...area.querySelectorAll('svg, i, img, span')].filter(e => segue(e) && visivel(e) && !e.parentElement.closest('svg') && (e.tagName !== 'SPAN' || !texto(e)));
      return l.filter(e => !l.some(o => o !== e && o.contains(e))).slice(0, 4);
    };
    let lista = [];
    for (let area = c.ancora.parentElement, i = 0; area && i < 4; area = area.parentElement, i++) {
      lista = pegar(area);
      if (lista.length >= 2 || area === c.card) break;
    }
    if (lista.length < 2) return {};
    const dica = e => norm(`${classeDe(e)} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''} ${e.getAttribute('data-testid') || ''} ${e.getAttribute('alt') || ''} ${(e.innerHTML || '').slice(0, 400)}`);
    const down = lista.find(e => DICA_DOWN.test(dica(e)));
    const up = lista.find(e => e !== down && !DICA_DOWN.test(dica(e)) && DICA_UP.test(dica(e)));
    return up && down ? { up, down } : { up: lista[0], down: lista[1] };
  }
  // "Aparência" do botão sem as palavras que diferem entre 👍 e 👎. Se 👍 e 👎 estão iguais,
  // ninguém avaliou ainda. Se diferem, alguém já avaliou (e o script não mexe).
  const limparClasse = s => String(s || '').toLowerCase()
    .replace(/dislike|unlike|like|thumbs?|positiv[eo]?|negativ[eo]?|nao-?gostei|gostei|\bup\b|\bdown\b|-up\b|-down\b|_up\b|_down\b/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
  function aparencia(el) {
    if (!el || !el.isConnected) return 'sumiu';
    const partes = [];
    for (const e of [el, el.querySelector('svg, i, img')].filter(Boolean)) {
      const cs = getComputedStyle(e);
      partes.push(cs.color, cs.backgroundColor, cs.fill, cs.stroke, cs.opacity, cs.borderColor, limparClasse(classeDe(e)),
        e.getAttribute('aria-pressed') || '', e.getAttribute('aria-checked') || '', e.getAttribute('data-state') || '');
      if (e.tagName === 'IMG') partes.push(limparClasse((e.getAttribute('src') || '').replace(/.*\//, '')));
    }
    return partes.join('|');
  }

  async function pegarWhatsapp(card) {
    const btn = [...card.querySelectorAll(CLICAVEL)].find(b => /^contatos?$/i.test(texto(b)));
    if (!btn) return null;
    if (btn.tagName === 'A' && btn.href && !/^javascript|#$/.test(btn.getAttribute('href') || '#')) return null; // abriria outra página
    const antes = new Set(fonesNaTela());
    clicar(btn);
    const novos = await esperar(() => { const f = fonesNaTela().filter(x => !antes.has(x)); return f.length ? f : null; }, 8000, 300);
    fecharJanela();
    await dorme(500);
    return novos ? (novos.find(ehCelular) || novos[0]) : null;
  }
  function fecharJanela() {
    const janelas = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="popover" i]')].filter(visivel).filter(e => !nossa(e));
    for (const j of janelas) {
      const x = [...j.querySelectorAll(`${CLICAVEL}, span, i`)].find(b => /^(×|✕|x|fechar|close|ok|entendi)$/i.test(texto(b))
        || /fechar|close/i.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${classeDe(b)}`));
      if (x) clicar(x);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }

  // ------------------------------------------------------------------ "Minhas vagas"
  function linhasDeVagas() {
    const contagens = menores(/^\d+\s+candidat[oa]s?\b/i, 40);
    return contagens.map(el => {
      let linha = el, titulo = null;
      for (let i = 0; i < 10 && linha.parentElement && !titulo; i++) {
        if (contagens.filter(x => linha.parentElement.contains(x)).length > 1) break;
        linha = linha.parentElement;
        titulo = [...linha.querySelectorAll('a, h1, h2, h3, h4, h5, strong, b')].find(t => texto(t).length < 80 && classificar(texto(t)));
      }
      return titulo ? { el, linha, tituloEl: titulo, titulo: texto(titulo), vaga: classificar(texto(titulo)), qtd: parseInt(texto(el), 10) } : null;
    }).filter(Boolean);
  }
  function acharProxima() {
    const ok = e => visivel(e) && !nossa(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !/disabled|desabilit|inativ/i.test(classeDe(e));
    return [...document.querySelectorAll('a, button, [role="button"]')].find(e => ok(e)
      && (/^(pr[oó]xim[ao]s?|seguinte|›|»|>|carregar mais( candidatos)?|ver mais candidatos)$/i.test(texto(e))
        || /pr[oó]xim|next/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''} ${e.getAttribute('rel') || ''}`))) || null;
  }

  // ------------------------------------------------------------------ leitura de um currículo aberto (texto)
  function lerPagina(manual) {
    if (!manual && acharCards().length > 1) return 0; // lista com vários candidatos: quem lê é lerCards
    const textoTela = document.body ? document.body.innerText : '';
    const fones = [...new Set((textoTela.match(RX_FONE) || []).map(limparFone).filter(Boolean))];
    const celulares = fones.filter(ehCelular);
    if (!manual && celulares.length !== 1) return 0; // nenhum ou vários celulares: parece lista, não um currículo
    const linhas = textoTela.split('\n').map(l => l.trim()).filter(Boolean);
    const rotulo = rx => {
      for (let i = 0; i < linhas.length; i++) {
        const m = linhas[i].match(rx);
        if (m) return (m[1] || linhas[i + 1] || '').trim();
      }
      return '';
    };
    const acc = { fones: celulares.length ? celulares : fones }; // telefone fixo costuma ser de empresa antiga
    acc.cep = (textoTela.match(/\b\d{5}-\d{3}\b/) || [''])[0];
    acc.rua = rotulo(/^(?:endere[cç]o(?: residencial)?|logradouro)\s*:?\s*(.*)$/i)
      || (linhas.find(l => /^(rua|r\.|av\.?|avenida|travessa|tv\.|estrada|alameda|al\.|pra[cç]a|rodovia|viela)\s/i.test(l)) || '');
    acc.bairro = rotulo(/^bairro\s*:?\s*(.*)$/i);
    acc.cidade = rotulo(/^(?:cidade|munic[ií]pio)\s*:?\s*(.*)$/i);
    // "34 anos, Solteiro, São Bernardo do Campo, SP - Jardim da represa"
    const linhaInfo = linhas.find(l => /\b\d{1,2}\s+anos?\b.*,\s*[A-Z]{2}\b/.test(l));
    const mi = linhaInfo && linhaInfo.match(/,\s*([^,]+?)\s*,\s*([A-Z]{2})\b(?:\s*-\s*(.+?))?\s*$/);
    if (mi) { acc.cidade = acc.cidade || mi[1]; acc.uf = mi[2]; acc.bairro = acc.bairro || mi[3] || ''; }
    if (acc.rua.length > 120) acc.rua = '';
    let nome = null;
    for (const sel of ['h1', 'h2', '[class*="nome" i]', '[class*="name" i]', 'h3', 'a']) {
      nome = [...document.querySelectorAll(sel)].filter(e => !e.closest('header, nav') && !nossa(e)).map(texto).find(nomePessoa);
      if (nome) break;
    }
    if (!nome || (!acc.cep && !acc.rua && !acc.bairro)) {
      if (manual) alert('Não achei nome e endereço nesta página. Abra o currículo do candidato e tente de novo.');
      return 0;
    }
    diag.capturados.pagina++;
    registrar([{ nome, acc, vaga: vagaDaPagina() }], 'pagina');
    return 1;
  }

  // ------------------------------------------------------------------ cálculo de ônibus (Google)
  function proximoDiaUtil8h() {
    const H = 3600e3, agoraBR = new Date(Date.now() - 3 * H); // horário de Brasília (sem horário de verão)
    let d = new Date(Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth(), agoraBR.getUTCDate() + 1, 8 + 3));
    while ([0, 6].includes(new Date(d.getTime() - 3 * H).getUTCDay())) d = new Date(d.getTime() + 24 * H);
    return d.toISOString().replace('.000Z', 'Z');
  }

  let ocupado = false, erroGeral = '';
  function processarFila() {
    if (ocupado) return;
    const c = cfg();
    if (!c.chave || erroGeral) return;
    const mapa = candidatos();
    const agora = Date.now();
    // "calculando" evita que duas abas peçam a mesma rota ao mesmo tempo
    const prox = Object.values(mapa).find(x => !x.rota && x.vagas.length && enderecoSuficiente(x.endereco) && !(x.calculando > agora - 60e3));
    if (!prox) return;
    mapa[prox.id] = { ...prox, calculando: agora };
    gravar(K.cand, mapa);
    const destinos = UNIDADES.filter(u => prox.vagas.includes(u.vaga));
    ocupado = true;
    const terminar = (mexer, erro) => {
      ocupado = false;
      const m = candidatos();
      if (m[prox.id]) { delete m[prox.id].calculando; if (mexer) mexer(m[prox.id]); }
      if (erro) erroGeral = erro;
      salvarCandidatos(m);
      if (!erroGeral) setTimeout(processarFila, 250);
    };
    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': c.chave,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition,status',
      },
      data: JSON.stringify({
        origins: [{ waypoint: { address: `${prox.endereco}, Brasil` } }],
        destinations: destinos.map(u => ({ waypoint: { address: u.rota } })),
        travelMode: 'TRANSIT',
        departureTime: proximoDiaUtil8h(),
        languageCode: 'pt-BR',
        regionCode: 'BR',
      }),
      timeout: 30000,
      onload: r => {
        let corpo = null;
        try { corpo = JSON.parse(r.responseText); } catch (e) { /* ignora */ }
        const msgErro = (corpo && corpo.error && corpo.error.message) || '';
        if (r.status === 200 && Array.isArray(corpo)) {
          const porUnidade = [];
          let erroEnd = '';
          for (const el of corpo) {
            const u = destinos[el.destinationIndex || 0];
            if (el.status && el.status.code) { erroEnd = el.status.message || 'endereço não encontrado'; continue; }
            if (el.condition !== 'ROUTE_EXISTS' || !u) continue;
            porUnidade.push({ unidade: u.id, min: Math.round(parseInt(el.duration, 10) / 60), km: Math.round((el.distanceMeters || 0) / 100) / 10 });
          }
          porUnidade.sort((a, b) => a.min - b.min);
          terminar(x => {
            x.rota = porUnidade.length ? { ok: true, porUnidade, melhor: porUnidade[0] }
              : { ok: false, motivo: erroEnd ? `Google não achou o endereço (${erroEnd})` : 'sem rota de ônibus encontrada' };
          });
        } else if (r.status === 400) {
          terminar(x => { x.rota = { ok: false, motivo: `Google recusou o endereço: ${msgErro || r.status}` }; });
        } else {
          terminar(null, msgErro || `erro ${r.status} do Google`);
        }
      },
      onerror: () => terminar(null, 'sem conexão com o Google'),
      ontimeout: () => terminar(null, 'o Google demorou demais para responder'),
    });
  }

  // ------------------------------------------------------------------ situação de cada candidato
  const whats = x => (x.fones || []).find(ehCelular) || null;
  const dentroDoLimite = (m, c = cfg()) => c.medida === 'km' ? m.km <= c.limite : m.min <= c.limite;
  // melhor loja para uma vaga específica (ou para qualquer vaga do candidato)
  const melhorPara = (x, vaga) => x.rota && x.rota.ok ? x.rota.porUnidade.filter(p => !vaga || unidade(p.unidade).vaga === vaga)[0] || null : null;
  function situacao(x, c) {
    if (!x.vagas.length) return { grupo: 'falta', motivo: 'não sei de qual vaga é', semVaga: true };
    if (!enderecoSuficiente(x.endereco)) return { grupo: 'falta', motivo: x.endereco ? `endereço incompleto (${x.endereco})` : 'sem endereço' };
    if (!x.rota) return { grupo: 'falta', motivo: c.chave ? (erroGeral ? 'aguardando o Google' : 'calculando…') : 'falta a chave do Google' };
    if (!x.rota.ok) return { grupo: 'falta', motivo: x.rota.motivo };
    const m = x.rota.melhor;
    return { grupo: dentroDoLimite(m, c) ? 'dentro' : 'longe', melhor: m };
  }
  function mexerCandidato(id, fn) {
    const m = candidatos();
    if (!m[id]) return;
    fn(m[id]);
    salvarCandidatos(m);
  }

  // ------------------------------------------------------------------ verificação diária (aba que verifica)
  const souVerificador = () => window.name === 'pm-worker';
  const estado = () => ler(K.worker, null);
  const salvarEstado = st => { gravar(K.worker, st); agendarRender(); };
  const hhmm = (ts = Date.now()) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ddmm = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  function logar(msg) {
    const st = estado();
    if (!st) return;
    st.log = [...(st.log || []), `${hhmm()} ${msg}`].slice(-40);
    salvarEstado(st);
  }
  function notificar(titulo, corpo) {
    try { GM_notification({ title: titulo, text: corpo || ' ', onclick: () => { try { window.focus(); } catch (e) { /* ignora */ } } }); } catch (e) { /* ignora */ }
  }
  function navegar(url) {
    if (url.split('#')[0] === location.href.split('#')[0]) location.reload();
    else location.href = url;
    return dorme(30000); // a página recarrega e o script continua de onde parou
  }

  function iniciarVerificacao(manual) {
    const c = cfg();
    if (!c.chave) { alert('Antes, cole a chave do Google em ⚙ Ajustes.'); return; }
    const agora = Date.now();
    gravar(K.varredura, { ...ler(K.varredura, {}), rodando: true, desde: agora, ultimaTentativa: agora, erro: '' });
    gravar(K.worker, { inicio: agora, manual, fila: null, vagaAtual: null, urlVagas: null, paginas: 0, abriuAba: false, aprovados: [], log: [], teste: !c.curtirConfirmado, fim: null, erro: null });
    GM_openInTab(`${URL_VAGAS}#pm-varredura`, { active: manual || !c.curtirConfirmado, insert: true, setParent: true });
    agendarRender();
  }

  function concluir() {
    const st = estado();
    st.fim = Date.now();
    salvarEstado(st);
    const n = st.aprovados.length;
    gravar(K.varredura, { ...ler(K.varredura, {}), rodando: false, ultimaOk: Date.now(), erro: '', resumo: { quando: Date.now(), aprovados: st.aprovados } });
    const linhas = st.aprovados.map(a => `${a.nome} — ${VAGAS[a.vaga]} (loja ${unidade(a.unidade).nome}), ${a.min} min${a.whats ? ` — WhatsApp ${formatarFone(a.whats)}` : ''}`);
    if (n) notificar(`Catho: ${n} candidato${n > 1 ? 's' : ''} perto, com 👍`, linhas.join('\n'));
    else if (st.manual) notificar('Catho: verificação concluída', 'Nenhum candidato novo perto das lojas.');
    window.name = '';
    if (!st.manual) setTimeout(() => window.close(), 5000);
    return 'fim';
  }
  function falhar(msg) {
    const st = estado() || {};
    st.fim = Date.now();
    st.erro = msg;
    salvarEstado(st);
    gravar(K.varredura, { ...ler(K.varredura, {}), rodando: false, erro: msg });
    notificar('Catho: a verificação parou', msg);
    window.name = '';
    return 'fim';
  }

  let confirmar = null; // resposta da conferência da 1ª vez (botões do painel)
  async function rodarVerificador() {
    if (location.hash === '#pm-varredura') {
      window.name = 'pm-worker';
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!souVerificador()) return;
    const st0 = estado();
    if (!st0 || st0.fim) { window.name = ''; return; }
    // sinal de vida: enquanto esta aba trabalha, nenhuma outra começa outra verificação
    setInterval(() => { const v = ler(K.varredura, {}); if (v.rodando) gravar(K.varredura, { ...v, desde: Date.now() }); }, 60e3);
    try {
      for (let volta = 0; volta < 80; volta++) {
        const st = estado();
        if (!st || st.fim) return;
        const tipo = await esperar(() => acharCards().length ? 'candidatos' : linhasDeVagas().length ? 'vagas' : null, 20000, 700);
        let r;
        if (tipo === 'vagas') r = await etapaVagas();
        else if (tipo === 'candidatos') r = await etapaCandidatos();
        else if (!st.abriuAba && abrirAbaCandidatos()) { st.abriuAba = true; salvarEstado(st); logar('Abri a aba de candidatos'); }
        else if (/login|entrar|acesso|autentica/i.test(`${location.href} ${document.title}`)) r = falhar('A Catho pediu login. Entre na sua conta e clique em "Verificar agora".');
        else r = falhar('Não reconheci esta página da Catho. Clique em Diagnóstico nesta aba e mande para o Claude.');
        if (r === 'fim') return;
        await dorme(3000);
      }
      falhar('A verificação deu voltas demais e parou por segurança.');
    } catch (e) {
      falhar(String((e && e.message) || e));
    }
  }

  function abrirAbaCandidatos() {
    const aba = menores(/^candidat[oa]s?(\s*\(?\d+\)?)?$/i, 30).find(e => e.closest(CLICAVEL));
    if (!aba) return false;
    clicar(aba);
    return true;
  }

  async function etapaVagas() {
    const st = estado();
    const linhas = linhasDeVagas();
    if (!st.fila) {
      const vistos = new Set();
      st.fila = linhas.filter(l => !vistos.has(norm(l.titulo)) && vistos.add(norm(l.titulo)))
        .map(l => ({ titulo: l.titulo, vaga: l.vaga, qtd: l.qtd, feito: false, tentativas: 0 }));
      st.urlVagas = location.href.split('#')[0];
      salvarEstado(st);
      logar(`Vagas: ${st.fila.map(f => `${f.titulo} (${f.qtd})`).join(', ') || 'nenhuma'}`);
      if (!st.fila.length) return falhar('Não achei as vagas de Auxiliar de Cozinha e Atendente em "Minhas vagas".');
    }
    const prox = st.fila.find(f => !f.feito);
    if (!prox) return concluir();
    const l = linhas.find(x => norm(x.titulo) === norm(prox.titulo));
    prox.tentativas = (prox.tentativas || 0) + 1;
    if (!l || prox.tentativas > 3) {
      prox.feito = true;
      prox.erro = l ? 'não consegui abrir' : 'sumiu da lista';
      salvarEstado(st);
      logar(`Pulei ${prox.titulo}: ${prox.erro}`);
      return;
    }
    st.vagaAtual = prox.titulo;
    st.paginas = 0;
    st.abriuAba = false;
    salvarEstado(st);
    logar(`Abrindo os candidatos de ${prox.titulo}`);
    // 1º: link do "14 candidatos"; 2º: clique nele; 3º: link do título da vaga
    const linkContagem = l.el.closest('a[href]') || l.el.querySelector('a[href]');
    const linkTitulo = l.tituloEl.closest('a[href]') || l.tituloEl.querySelector('a[href]');
    const http = a => a && /^https?:/.test(a.href) ? a.href : null;
    if (prox.tentativas === 1 && http(linkContagem)) return navegar(http(linkContagem));
    if (prox.tentativas <= 2 && l.el.closest(CLICAVEL)) { clicar(l.el); return; }
    if (http(linkTitulo)) return navegar(http(linkTitulo));
    clicar(l.tituloEl);
  }

  async function etapaCandidatos() {
    let st = estado();
    const vagaAtual = st.fila && st.fila.find(f => !f.feito && norm(f.titulo) === norm(st.vagaAtual || ''));
    if (!vagaAtual) {
      if (st.fila && !st.fila.some(f => !f.feito)) return concluir();
      return navegar(st.urlVagas || URL_VAGAS); // começa (ou continua) por "Minhas vagas"
    }
    const vaga = vagaAtual.vaga;
    const c = cfg();
    if (!c.chave) return falhar('Falta a chave do Google (⚙ Ajustes).');
    const cards = lerCards(vaga);
    logar(`${vagaAtual.titulo}, página ${st.paginas + 1}: ${cards.length} candidatos`);
    processarFila();
    const ids = cards.map(k => k.id);
    await esperar(() => erroGeral || ids.every(id => { const x = candidatos()[id]; return !x || x.rota || !enderecoSuficiente(x.endereco); }), 180000, 800);
    if (erroGeral) return falhar(`Google: ${erroGeral}`);

    const perto = [];
    let jaAvaliados = 0;
    for (const k of cards) {
      const x = candidatos()[k.id];
      const m = x && melhorPara(x, vaga);
      if (!m || !dentroDoLimite(m)) continue;
      if (x.curtidas && x.curtidas[vaga]) continue;
      const b = botoesAvaliacao(k);
      if (!b.up) { logar(`Não achei o 👍 de ${x.nome}`); continue; }
      if (aparencia(b.up) !== aparencia(b.down)) {
        jaAvaliados++;
        mexerCandidato(k.id, y => { y.curtidas = { ...(y.curtidas || {}), [vaga]: { em: Date.now(), como: 'já estava avaliado' } }; });
        continue;
      }
      perto.push({ k, m, nome: x.nome });
    }
    if (jaAvaliados) logar(`${jaAvaliados} ${jaAvaliados > 1 ? 'candidatos perto já estavam avaliados' : 'candidato perto já estava avaliado'} (não mexi)`);

    // 1ª vez: marca em vermelho e espera você conferir
    if (perto.length && estado().teste) {
      for (const p of perto) { const b = botoesAvaliacao(p.k); if (b.up) { b.up.style.outline = '3px solid #e5133b'; b.up.style.outlineOffset = '3px'; } }
      try { perto[0].k.card.scrollIntoView({ block: 'center' }); } catch (e) { /* ignora */ }
      st = estado();
      st.conferencia = { nomes: perto.map(p => `${p.nome} (${p.m.min} min)`), jaAvaliados };
      salvarEstado(st);
      try { window.focus(); } catch (e) { /* ignora */ }
      notificar('Catho: confira os 👍', 'Abra a aba da verificação e confirme se os botões marcados em vermelho estão certos.');
      const ok = await new Promise(res => { confirmar = res; });
      confirmar = null;
      for (const p of perto) { const b = botoesAvaliacao(p.k); if (b.up) b.up.style.outline = ''; }
      st = estado();
      delete st.conferencia;
      if (!ok) { salvarEstado(st); return falhar('Você disse que os 👍 marcados estavam errados. Clique em Diagnóstico nesta aba e mande para o Claude.'); }
      st.teste = false;
      salvarEstado(st);
      gravar(K.cfg, { ...cfg(), curtirConfirmado: true });
    }

    for (const p of perto) {
      let w = whats(candidatos()[p.k.id] || {});
      if (!w && c.pegarWhats) {
        const f = await pegarWhatsapp(p.k.card);
        if (f) { mexerCandidato(p.k.id, y => { y.fones = [...new Set([...(y.fones || []), f])]; }); if (ehCelular(f)) w = f; }
      }
      const k2 = acharCards().find(x => x.id === p.k.id) || p.k; // a página pode ter redesenhado o cartão
      const b = botoesAvaliacao(k2);
      if (!b.up || aparencia(b.up) !== aparencia(b.down)) { logar(`Não cliquei no 👍 de ${p.nome} (botão mudou)`); continue; }
      const antes = aparencia(b.up);
      clicar(b.up);
      const confirmado = await esperar(() => aparencia(b.up) !== antes, 4000, 250);
      mexerCandidato(p.k.id, y => { y.curtidas = { ...(y.curtidas || {}), [vaga]: { em: Date.now(), como: confirmado ? 'curtido pelo filtro' : 'clicado, sem confirmação' } }; });
      st = estado();
      st.aprovados.push({ nome: p.nome, vaga, unidade: p.m.unidade, min: p.m.min, km: p.m.km, whats: w });
      salvarEstado(st);
      logar(`👍 ${p.nome} (${p.m.min} min)${confirmado ? '' : ' — a Catho não mostrou mudança no botão'}`);
      await dorme(900);
    }

    // próxima página de candidatos, ou volta para "Minhas vagas"
    st = estado();
    const prox = acharProxima();
    if (prox && st.paginas < 20) {
      st.paginas++;
      salvarEstado(st);
      const antes = ids.join('|');
      const href = prox.tagName === 'A' && /^https?:/.test(prox.href) && prox.href.split('#')[0] !== location.href.split('#')[0] ? prox.href : null;
      if (href) return navegar(href);
      clicar(prox);
      await esperar(() => acharCards().map(k => k.id).join('|') !== antes, 15000, 500);
      return;
    }
    const f = st.fila.find(x => norm(x.titulo) === norm(st.vagaAtual || ''));
    if (f) f.feito = true;
    st.vagaAtual = null;
    salvarEstado(st);
    logar(`${vagaAtual.titulo}: pronto`);
    if (!st.fila.some(x => !x.feito)) return concluir();
    return navegar(st.urlVagas || URL_VAGAS);
  }

  // Em qualquer aba da Catho: começa a verificação do dia no horário marcado.
  function horaDeHoje(h) {
    const [hh, mm] = String(h || '09:00').split(':').map(Number);
    const d = new Date();
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.getTime();
  }
  function verificarAgenda() {
    const c = cfg();
    if (!c.diario || !c.chave || souVerificador()) return;
    const v = ler(K.varredura, {});
    const agora = Date.now(), alvo = horaDeHoje(c.hora);
    if (agora < alvo) return;
    if (v.rodando && agora - (v.desde || 0) < 25 * 60e3) return; // outra aba está verificando
    if ((v.ultimaOk || 0) >= alvo) return; // hoje já foi
    if (agora - (v.ultimaTentativa || 0) < 2 * 3600e3) return; // falhou há pouco: tenta de novo em 2 h
    iniciarVerificacao(false);
  }

  // ------------------------------------------------------------------ painel
  let raiz = null, renderAgendado = false;
  const agendarRender = () => { if (renderAgendado) return; renderAgendado = true; setTimeout(() => { renderAgendado = false; render(); }, 60); };
  const linkRota = (origem, u) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origem)}&destination=${encodeURIComponent(u.rota)}&travelmode=transit`;

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 430px; max-width: calc(100vw - 32px);
      max-height: 78vh; display: flex; flex-direction: column; background: #fff; color: #1f2328; border: 1px solid #d0d7de;
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); font: 13px/1.4 "Segoe UI", Roboto, Arial, sans-serif; }
    .box.min { width: auto; }
    .box.min .corpo { display: none; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #7a2e55; color: #fff; border-radius: 9px 9px 0 0; cursor: pointer; }
    .box.min header { border-radius: 9px; }
    header b { font-size: 13px; }
    header .cont { font-size: 12px; opacity: .9; margin-left: auto; white-space: nowrap; }
    .corpo { display: flex; flex-direction: column; min-height: 0; overflow: auto; }
    .aviso { margin: 8px 10px 0; padding: 6px 8px; border-radius: 6px; background: #fff8c5; border: 1px solid #e9d68b; font-size: 12px; }
    .aviso.erro { background: #ffebe9; border-color: #f3b2ab; }
    .aviso.ok { background: #dafbe1; border-color: #a6e3b4; }
    .aviso.conf { background: #fff1f3; border: 2px solid #e5133b; font-size: 13px; }
    .aviso.conf ul { margin: 6px 0; padding-left: 18px; max-height: 140px; overflow: auto; }
    .aviso.conf li { border: 0; padding: 1px 0; }
    .aviso .acoes { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .status { display: flex; align-items: center; gap: 8px; margin: 8px 10px 0; font-size: 12px; color: #57606a; }
    .status span { flex: 1; }
    .log { margin: 4px 10px 0; font: 11px/1.35 Consolas, monospace; color: #57606a; max-height: 70px; overflow: auto; white-space: pre-wrap; }
    details { margin: 8px 10px 0; }
    summary { cursor: pointer; color: #57606a; font-size: 12px; }
    .cfg { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; margin-top: 6px; font-size: 12px; }
    .cfg input, .cfg select { font: inherit; padding: 3px 6px; border: 1px solid #d0d7de; border-radius: 5px; min-width: 0; }
    .cfg input[type="checkbox"] { justify-self: start; }
    .cfg .lim { display: flex; gap: 6px; align-items: center; } .cfg .lim input[type="number"] { width: 64px; }
    .cfg .nota { grid-column: 1 / -1; color: #57606a; }
    nav { display: flex; gap: 4px; margin: 8px 10px 0; }
    nav button { flex: 1; font: inherit; font-size: 12px; padding: 5px 4px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; cursor: pointer; color: #1f2328; }
    nav button.on { background: #7a2e55; border-color: #7a2e55; color: #fff; }
    ul.lista { list-style: none; margin: 8px 0 0; padding: 0 10px; min-height: 40px; }
    ul.lista > li { padding: 7px 0; border-bottom: 1px solid #eaeef2; }
    ul.lista > li:last-child { border-bottom: 0; }
    .l1 { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .l1 b { font-size: 13px; }
    .tag { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef1f4; color: #424a53; }
    .tag.cozinha { background: #fde8d7; color: #8a3b00; } .tag.atendente { background: #dcecff; color: #0b4a8f; }
    .tag.like { background: #dafbe1; color: #116329; }
    .tempo { margin-left: auto; font-weight: 600; white-space: nowrap; }
    .longe .tempo { color: #9a6700; }
    .l2 { color: #57606a; font-size: 12px; margin-top: 2px; }
    .l2 a { color: #0a6b35; font-weight: 600; text-decoration: none; } .l2 a.maps { color: #0969da; font-weight: 400; }
    button.mini, .acoes button { font: inherit; font-size: 12px; padding: 3px 9px; margin-left: 4px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 5px; cursor: pointer; color: #1f2328; }
    .acoes button { margin-left: 0; padding: 5px 10px; }
    .acoes button.sim { background: #1f883d; border-color: #1f883d; color: #fff; }
    .vazio { color: #57606a; font-size: 12px; padding: 10px 0; }
    footer { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-top: 1px solid #eaeef2; margin-top: 6px; }
    footer button { font: inherit; font-size: 12px; padding: 5px 9px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; cursor: pointer; color: #1f2328; }
    footer button.pri { background: #1f883d; border-color: #1f883d; color: #fff; }
    footer .sp { flex: 1; }
  `;

  function montarPainel() {
    if (raiz || !document.body) return;
    const host = document.createElement('div');
    host.id = 'pm-filtro-catho';
    document.body.appendChild(host);
    raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `<style>${CSS}</style><div class="box"></div>`;
    raiz.addEventListener('click', aoClicar);
    raiz.addEventListener('change', aoMudar);
    render();
  }

  let ajustesAbertos = null;
  function render() {
    if (!raiz) return;
    const foco = raiz.activeElement;
    if (foco && /^(INPUT|SELECT)$/.test(foco.tagName)) { // não apaga o que está sendo digitado
      foco.addEventListener('blur', agendarRender, { once: true });
      return;
    }
    const box = raiz.querySelector('.box');
    const det = box.querySelector('details');
    if (det) ajustesAbertos = det.open;
    const ui = ler(K.ui, { min: false, aba: 'dentro' });
    const c = cfg();
    const st = estado();
    const v = ler(K.varredura, {});
    const lista = Object.values(candidatos()).map(x => ({ x, s: situacao(x, c) }));
    const n = g => lista.filter(i => i.s.grupo === g).length;
    const aba = ui.aba || 'dentro';
    const ordem = id => UNIDADES.findIndex(u => u.id === id);
    const itens = lista.filter(i => i.s.grupo === aba).sort((a, b) =>
      a.s.melhor && b.s.melhor ? ordem(a.s.melhor.unidade) - ordem(b.s.melhor.unidade) || a.s.melhor.min - b.s.melhor.min
        : (b.x.capturadoEm || 0) - (a.x.capturadoEm || 0));
    const limTxt = c.medida === 'km' ? `${c.limite} km` : `${c.limite} min`;

    const linha = ({ x, s }) => {
      const w = whats(x);
      const wHtml = w ? `<a href="https://wa.me/55${w}" target="_blank" rel="noopener">${esc(formatarFone(w))}</a>`
        : x.fones.length ? `${esc(formatarFone(x.fones[0]))} (fixo)` : 'ainda não pego (fica em "contatos")';
      if (s.melhor) {
        const u = unidade(s.melhor.unidade);
        const curtida = x.curtidas && x.curtidas[u.vaga];
        const outras = x.rota.porUnidade.slice(1).map(p => `${unidade(p.unidade).nome}: ${p.min} min`).join(' · ');
        return `<li class="${s.grupo}"><div class="l1"><b>${esc(x.nome)}</b><span class="tag ${u.vaga}">${esc(VAGAS[u.vaga])}</span>
          ${curtida ? (/avaliado/.test(curtida.como) ? '<span class="tag" title="já tinha avaliação na Catho">já avaliado</span>'
            : `<span class="tag like" title="${esc(curtida.como)}">👍 ${esc(ddmm(curtida.em))}</span>`) : ''}
          <span class="tempo">🚌 ${s.melhor.min} min · ${String(s.melhor.km).replace('.', ',')} km</span></div>
          <div class="l2">Loja ${esc(u.nome)} — ${esc(u.endereco)}</div>
          <div class="l2">WhatsApp: ${wHtml} · <a class="maps" href="${esc(linkRota(x.endereco, u))}" target="_blank" rel="noopener">ver rota</a>${outras ? ` · ${esc(outras)}` : ''}</div></li>`;
      }
      const vagaBtns = s.semVaga ? Object.entries(VAGAS).map(([k, val]) => `<button class="mini" data-a="vaga" data-id="${esc(x.id)}" data-v="${k}">${esc(val)}</button>`).join('') : '';
      const tags = x.vagas.map(vg => `<span class="tag ${vg}">${esc(VAGAS[vg])}</span>`).join('');
      return `<li><div class="l1"><b>${esc(x.nome)}</b>${tags}</div>
        <div class="l2">⚠ ${esc(s.motivo)}${vagaBtns}</div>
        <div class="l2">WhatsApp: ${wHtml}${x.endereco ? ` · ${esc(x.endereco)}` : ''}</div></li>`;
    };

    const avisos = [];
    if (!c.chave) avisos.push(`<div class="aviso">Para calcular o ônibus, cole sua chave do Google em ⚙ Ajustes (veja o LEIA-ME).</div>`);
    if (erroGeral) avisos.push(`<div class="aviso erro">Google: ${esc(erroGeral)} <button class="mini" data-a="tentar">tentar de novo</button></div>`);
    if (st && st.conferencia && souVerificador() && confirmar) {
      avisos.push(`<div class="aviso conf"><b>Primeira vez: confira antes de eu clicar.</b><br>
        Marquei em vermelho o 👍 destes candidatos, que moram a até ${esc(limTxt)} de ônibus:
        <ul>${st.conferencia.nomes.map(nm => `<li>${esc(nm)}</li>`).join('')}</ul>
        ${st.conferencia.jaAvaliados ? `${st.conferencia.jaAvaliados > 1 ? `${st.conferencia.jaAvaliados} candidatos já tinham avaliação e ficaram` : '1 candidato já tinha avaliação e ficou'} de fora.<br>` : ''}
        Os botões marcados são mesmo o 👍 desses candidatos?
        <div class="acoes"><button class="sim" data-a="conf-sim">Sim, pode dar 👍 (e nas próximas vezes também)</button><button data-a="conf-nao">Não, está errado</button></div></div>`);
    } else if (st && st.conferencia) {
      avisos.push(`<div class="aviso conf">A verificação está esperando você conferir os 👍 na outra aba da Catho.</div>`);
    }
    if (st && st.erro && st.fim && Date.now() - st.fim < 24 * 3600e3) avisos.push(`<div class="aviso erro">A verificação parou: ${esc(st.erro)}</div>`);
    const rodando = st && !st.fim;
    let statusTxt;
    if (rodando) statusTxt = `⏳ Verificando agora… ${st.aprovados.length} 👍 até aqui`;
    else if (v.ultimaOk) statusTxt = `🔁 ${c.diario ? `Todo dia às ${esc(c.hora)}` : 'Verificação diária desligada'} · última: ${esc(ddmm(v.ultimaOk))} ${esc(hhmm(v.ultimaOk))}${v.resumo ? ` (${v.resumo.aprovados.length} 👍)` : ''}`;
    else statusTxt = c.diario ? `🔁 Todo dia às ${esc(c.hora)} (deixe uma aba da Catho aberta)` : 'Verificação diária desligada';
    const logHtml = st && st.log && st.log.length && (rodando || (st.fim && Date.now() - st.fim < 3600e3))
      ? `<div class="log">${esc(st.log.slice(-6).join('\n'))}</div>` : '';
    const vp = vagaDaPagina();

    box.className = `box${ui.min ? ' min' : ''}`;
    box.innerHTML = `
      <header data-a="min"><b>🍮 Filtro PudiMarin</b><span class="cont">${rodando ? '⏳ ' : ''}${n('dentro')} perto · ${n('longe')} longe · ${n('falta')} pendentes ${ui.min ? '▴' : '▾'}</span></header>
      <div class="corpo">
        ${avisos.join('')}
        <div class="status"><span>${statusTxt}</span>${rodando || souVerificador() ? '' : '<button class="mini" data-a="verificar">Verificar agora</button>'}</div>
        ${logHtml}
        <details ${(ajustesAbertos ?? !c.chave) ? 'open' : ''}><summary>⚙ Ajustes · limite ${esc(limTxt)} de ônibus · vaga desta página: ${esc(vp ? VAGAS[vp] : 'não identificada')}</summary>
          <div class="cfg">
            <label>Chave Google</label><input type="password" data-c="chave" value="${esc(c.chave)}" placeholder="AIza…" autocomplete="off">
            <label>Limite</label><span class="lim"><input type="number" min="1" step="1" data-c="limite" value="${esc(c.limite)}">
              <select data-c="medida"><option value="min" ${c.medida === 'min' ? 'selected' : ''}>minutos de ônibus</option><option value="km" ${c.medida === 'km' ? 'selected' : ''}>km de ônibus</option></select></span>
            <label>Verificar todo dia</label><span class="lim"><input type="checkbox" data-c="diario" ${c.diario ? 'checked' : ''}> às <input type="time" data-c="hora" value="${esc(c.hora)}"></span>
            <label>Pegar WhatsApp</label><span class="lim"><input type="checkbox" data-c="pegarWhats" ${c.pegarWhats ? 'checked' : ''}> abrir "contatos" de quem ganhou 👍</span>
            <label>Vaga desta página</label><select data-c="vagaPagina"><option value="">Automático (pelo título)</option>
              ${Object.entries(VAGAS).map(([k, val]) => `<option value="${k}" ${c.vagaPagina === k ? 'selected' : ''}>${esc(val)}</option>`).join('')}</select>
            <span class="nota">${c.curtirConfirmado ? '👍 automático: conferido por você ✓' : '👍 automático: na 1ª verificação eu marco os botões e espero você conferir.'}</span>
          </div></details>
        <nav>
          <button data-a="aba" data-v="dentro" class="${aba === 'dentro' ? 'on' : ''}">Até ${esc(limTxt)} (${n('dentro')})</button>
          <button data-a="aba" data-v="longe" class="${aba === 'longe' ? 'on' : ''}">Longe (${n('longe')})</button>
          <button data-a="aba" data-v="falta" class="${aba === 'falta' ? 'on' : ''}">Pendentes (${n('falta')})</button>
        </nav>
        <ul class="lista">${itens.length ? itens.map(linha).join('') : `<li class="vazio">${lista.length ? 'Ninguém aqui.' : 'Clique em "Verificar agora" ou abra os candidatos de uma vaga na Catho.'}</li>`}</ul>
        <footer>
          <button class="pri" data-a="copiar">Copiar lista</button>
          <button data-a="csv">Baixar planilha</button>
          <button data-a="capturar" title="Lê o currículo que está aberto na tela">Ler esta página</button>
          <span class="sp"></span>
          <button data-a="diag" title="Copia a estrutura da página, sem os dados pessoais, para ajustar o script">Diagnóstico</button>
          <button data-a="limpar">Limpar</button>
        </footer>
      </div>`;
  }

  function aoMudar(ev) {
    const campo = ev.target.dataset && ev.target.dataset.c;
    if (!campo) return;
    const c = cfg();
    let v = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    if (campo === 'limite') v = Math.max(1, Number(v) || CFG_PADRAO.limite);
    if (campo === 'chave') { v = String(v).trim(); erroGeral = ''; }
    if (campo === 'hora' && !/^\d{2}:\d{2}$/.test(v)) v = CFG_PADRAO.hora;
    gravar(K.cfg, { ...c, [campo]: v });
    ev.target.blur();
    render();
    processarFila();
  }

  function aoClicar(ev) {
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    const ui = ler(K.ui, { min: false, aba: 'dentro' });
    const a = el.dataset.a;
    if (a === 'min') { gravar(K.ui, { ...ui, min: !ui.min }); render(); }
    else if (a === 'aba') { gravar(K.ui, { ...ui, aba: el.dataset.v }); render(); }
    else if (a === 'tentar') { erroGeral = ''; render(); processarFila(); }
    else if (a === 'verificar') iniciarVerificacao(true);
    else if (a === 'conf-sim' && confirmar) confirmar(true);
    else if (a === 'conf-nao' && confirmar) confirmar(false);
    else if (a === 'vaga') {
      mexerCandidato(el.dataset.id, x => { x.vagas = [el.dataset.v]; delete x.rota; });
      processarFila();
    }
    else if (a === 'capturar') { if (lerPagina(true)) flash(el, 'Lido ✓'); }
    else if (a === 'copiar') { GM_setClipboard(textoLista(), 'text'); flash(el, 'Copiado ✓'); }
    else if (a === 'csv') baixarCsv();
    else if (a === 'diag') { GM_setClipboard(JSON.stringify(diagnostico(), null, 1), 'text'); flash(el, 'Copiado ✓'); }
    else if (a === 'limpar') { if (confirm('Apagar todos os candidatos guardados no filtro?')) salvarCandidatos({}); }
  }
  const flash = (el, txt) => { const t = el.textContent; el.textContent = txt; setTimeout(() => { el.textContent = t; }, 1500); };

  // ------------------------------------------------------------------ resultados
  function dentroPorUnidade() {
    const c = cfg();
    const lista = Object.values(candidatos()).map(x => ({ x, s: situacao(x, c) })).filter(i => i.s.grupo === 'dentro');
    return UNIDADES.map(u => ({ u, itens: lista.filter(i => i.s.melhor.unidade === u.id).sort((a, b) => a.s.melhor.min - b.s.melhor.min) }))
      .filter(g => g.itens.length);
  }

  function textoLista() {
    const c = cfg();
    const grupos = dentroPorUnidade();
    if (!grupos.length) return 'Nenhum candidato dentro do limite ainda.';
    const lim = c.medida === 'km' ? `${c.limite} km` : `${c.limite} min`;
    return [`Candidatos até ${lim} de ônibus da loja`, ''].concat(grupos.flatMap(({ u, itens }) => [
      `*${VAGAS[u.vaga]} — Loja ${u.nome}*`,
      u.endereco,
      ...itens.map(({ x }) => {
        const w = whats(x);
        return `• ${x.nome} — ${w ? `WhatsApp ${formatarFone(w)}` : x.fones.length ? `telefone fixo ${formatarFone(x.fones[0])}` : 'WhatsApp não informado'}`;
      }),
      '',
    ])).join('\n').trim();
  }

  function baixarCsv() {
    const c = cfg();
    const cel = v => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
    const linhas = [['Nome', 'Vaga', 'Loja', 'Endereço da loja', 'WhatsApp', 'Ônibus (min)', 'Ônibus (km)', 'Situação', '👍 na Catho', 'Endereço do candidato']];
    for (const x of Object.values(candidatos())) {
      const s = situacao(x, c);
      const u = s.melhor ? unidade(s.melhor.unidade) : null;
      const w = whats(x);
      const curtida = u && x.curtidas && x.curtidas[u.vaga];
      linhas.push([x.nome, u ? VAGAS[u.vaga] : x.vagas.map(vg => VAGAS[vg]).join(' / '), u ? u.nome : '', u ? u.endereco : '',
        w ? formatarFone(w) : x.fones.length ? `${formatarFone(x.fones[0])} (fixo)` : '', s.melhor ? s.melhor.min : '', s.melhor ? String(s.melhor.km).replace('.', ',') : '',
        s.grupo === 'dentro' ? 'dentro do limite' : s.grupo === 'longe' ? 'longe' : s.motivo,
        curtida ? `${ddmm(curtida.em)} (${curtida.como})` : '', x.endereco]);
    }
    const blob = new Blob(['﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `candidatos-pudimarin-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ------------------------------------------------------------------ diagnóstico (sem dados pessoais)
  const MANTER = new Set(('nome endereco bairro cidade estado cep telefone telefones celular whatsapp contato contatos email vaga vagas candidato candidatos '
    + 'curriculo curriculos cargo auxiliar cozinha atendente delivery rua avenida av sp idade anos ver mais perfil dados pessoais residencial '
    + 'localizacao distancia inscritos aprovados triagem selecionados salvar contatar mensagem enviar baixar imprimir pretensao salarial objetivo '
    + 'experiencia formacao sobre de da do e em para com resumo informacoes avalie idioma atualizado publicada minhas proxima anterior pagina '
    + 'solteiro solteira casado casada like dislike thumb thumbs up down icon btn button active selected ativar express salario '
    + 'area empresa empresas minhas detalhe detalhes lista listar page pagina api v1 v2 v3 catho com br www id').split(' '));
  const mascarar = s => String(s).slice(0, 160).replace(/[A-Za-zÀ-ÿ]+/g, w => MANTER.has(norm(w)) ? w : 'x'.repeat(Math.min(w.length, 4))).replace(/\d/g, '9');
  function esqueleto(v, prof) {
    if (prof > 7) return '…';
    if (Array.isArray(v)) return v.length ? [esqueleto(v[0], prof + 1), `(${v.length} itens)`] : [];
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).slice(0, 40).forEach(k => { o[k] = esqueleto(v[k], prof + 1); });
      return o;
    }
    return typeof v === 'string' ? mascarar(v) : typeof v === 'number' ? 9 : v;
  }
  // HTML resumido de um elemento: tags, classes e atributos úteis; textos mascarados
  function esqueletoHtml(el, prof = 0, cota = { n: 0 }) {
    if (!el || cota.n++ > 80 || prof > 12) return '';
    const attrs = ['id', 'class', 'role', 'aria-label', 'aria-pressed', 'title', 'data-testid', 'href', 'type', 'src', 'alt']
      .map(a => { let v = a === 'class' ? classeDe(el) : el.getAttribute && el.getAttribute(a); if (!v) return ''; if (a === 'href' || a === 'src') v = mascarar(String(v).replace(/^https?:\/\/[^/]+/, '')); return ` ${a}="${a === 'aria-label' || a === 'title' || a === 'alt' ? mascarar(v) : v}"`; })
      .join('');
    const proprio = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join(' ').trim();
    const filhos = el.tagName === 'svg' ? '' : [...el.children].map(f => esqueletoHtml(f, prof + 1, cota)).join('');
    return `${' '.repeat(prof)}<${el.tagName.toLowerCase()}${attrs}>${proprio ? ' ' + mascarar(proprio) : ''}\n${filhos}`;
  }
  function estruturaDom() {
    const out = [];
    const andar = (el, prof) => {
      if (out.length > 350 || prof > 30 || nossa(el) || IGNORAR_TAG.test(el.tagName) || /^(SVG|PATH)$/i.test(el.tagName)) return;
      const proprio = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join(' ').trim();
      if (proprio) {
        const cls = classeDe(el).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        out.push(`${' '.repeat(Math.min(prof, 20))}${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}: ${mascarar(proprio)}`);
      }
      [...el.children].forEach(f => andar(f, prof + 1));
    };
    if (document.body) andar(document.body, 0);
    return out;
  }
  function diagnostico() {
    const c = cfg();
    const lista = Object.values(candidatos());
    const cards = acharCards();
    const b = cards[0] ? botoesAvaliacao(cards[0]) : {};
    const st = estado();
    return {
      versao: VERSAO, pagina: location.origin + mascarar(location.pathname), titulo: mascarar(document.title), verificador: souVerificador(),
      leitura: { hook: diag.hook, respostasJson: diag.respostas, candidatosLidos: diag.capturados, erros: diag.erros },
      tela: {
        cartoes: cards.length, comBairro: cards.filter(k => k.bairro).length, vagasNaLista: linhasDeVagas().map(l => `${l.vaga} (${l.qtd})`),
        achouLike: !!b.up, likeIgualDislike: b.up ? aparencia(b.up) === aparencia(b.down) : null, proximaPagina: !!acharProxima(),
        infoExemplo: cards[0] ? mascarar(cards[0].info) : null,
        avalieHtml: cards[0] ? esqueletoHtml(cards[0].ancora.parentElement && cards[0].ancora.parentElement.parentElement) : null,
      },
      guardados: { total: lista.length, comEndereco: lista.filter(x => enderecoSuficiente(x.endereco)).length,
        comCelular: lista.filter(whats).length, comVaga: lista.filter(x => x.vagas.length).length, comRota: lista.filter(x => x.rota && x.rota.ok).length,
        curtidos: lista.filter(x => x.curtidas && Object.keys(x.curtidas).length).length },
      temChave: !!c.chave, erroGoogle: erroGeral, vagaDaPagina: vagaDaPagina(), config: { limite: c.limite, medida: c.medida, diario: c.diario, hora: c.hora, curtirConfirmado: c.curtirConfirmado },
      verificacao: st ? { inicio: st.inicio, fim: st.fim, erro: st.erro, fila: (st.fila || []).map(f => ({ vaga: f.vaga, qtd: f.qtd, feito: f.feito, erro: f.erro })), log: (st.log || []).map(mascarar) } : null,
      endpoints: Object.fromEntries(Object.entries(diag.endpoints).map(([k, v]) => [mascarar(k.replace(/^https?:\/\/[^/]+/, '')), v])), dom: estruturaDom(),
    };
  }

  // ------------------------------------------------------------------ início
  function iniciar() {
    montarPainel();
    lerJsonEmbutido();
    processarFila();
    try { GM_addValueChangeListener(K.cand, (k, velho, novo, remoto) => { if (remoto) agendarRender(); }); } catch (e) { /* ignora */ }
    try { GM_addValueChangeListener(K.cfg, (k, velho, novo, remoto) => { if (remoto) { erroGeral = ''; agendarRender(); processarFila(); } }); } catch (e) { /* ignora */ }
    try { GM_addValueChangeListener(K.worker, (k, velho, novo, remoto) => { if (remoto) agendarRender(); }); } catch (e) { /* ignora */ }
    try { GM_addValueChangeListener(K.varredura, (k, velho, novo, remoto) => { if (remoto) agendarRender(); }); } catch (e) { /* ignora */ }
    const lerTela = () => {
      lerJsonEmbutido();
      if (naAreaEmpresa() && !souVerificador()) lerCards();
      lerPagina(false);
    };
    setTimeout(lerTela, 1500);
    // páginas que trocam de conteúdo sem recarregar: relê quando a tela muda
    let espera = null;
    new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(lerTela, 1200); })
      .observe(document.documentElement, { childList: true, subtree: true });
    rodarVerificador();
    setTimeout(verificarAgenda, 8000);
    setInterval(verificarAgenda, 60e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
