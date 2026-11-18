// ==UserScript==
// @name         Filtro de candidatos Catho - PudiMarin
// @namespace    filtro-catho-pudimarin
// @version      1.0
// @description  Lê os candidatos que você abre na Catho e mostra quem mora mais perto das lojas, de ônibus
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
// @connect      routes.googleapis.com
// @updateURL    https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js
// @downloadURL  https://raw.githubusercontent.com/Red0Dev/claude/claude/sleepy-cray-34k3es/filtro-curriculos/filtro-catho.user.js
// ==/UserScript==

// Como funciona:
// 1. Enquanto você navega pelos candidatos das vagas na Catho, o script lê os dados que a
//    própria página recebe (nome, endereço, telefone). Ele não clica em nada e não abre
//    currículos sozinho, então não gasta visualizações do seu plano.
// 2. Para cada candidato, pergunta ao Google quanto tempo leva de ônibus (dia útil, 8h)
//    da casa dele até cada loja da vaga, e escolhe a loja mais perto.
// 3. O painel no canto da tela separa quem está dentro do limite, quem mora longe e quem
//    está com dados faltando. "Copiar lista" copia nome, vaga, endereço da loja e WhatsApp.
(() => {
  'use strict';

  const VERSAO = '1.0';
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

  const K = { cand: 'pm:candidatos', cfg: 'pm:config', ui: 'pm:ui' };
  const CFG_PADRAO = { chave: '', limite: 45, medida: 'min', vagaPagina: '' };
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ------------------------------------------------------------------ utilidades
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
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

  // ------------------------------------------------------------------ leitura da página (texto)
  // Usado quando um currículo está aberto na tela e os dados não vieram pela leitura acima.
  function lerPagina(manual) {
    const texto = document.body ? document.body.innerText : '';
    const fones = [...new Set((texto.match(/(?:\+?55\s?)?\(?\b\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}\b/g) || []).map(limparFone).filter(Boolean))];
    const celulares = fones.filter(ehCelular);
    if (!manual && celulares.length !== 1) return 0; // nenhum ou vários celulares: parece lista, não um currículo
    const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    const rotulo = (rx) => {
      for (let i = 0; i < linhas.length; i++) {
        const m = linhas[i].match(rx);
        if (m) return (m[1] || linhas[i + 1] || '').trim();
      }
      return '';
    };
    const acc = { fones: celulares.length ? celulares : fones }; // telefone fixo costuma ser de empresa antiga
    acc.cep = (texto.match(/\b\d{5}-\d{3}\b/) || [''])[0];
    acc.rua = rotulo(/^(?:endere[cç]o(?: residencial)?|logradouro)\s*:?\s*(.*)$/i)
      || (linhas.find(l => /^(rua|r\.|av\.?|avenida|travessa|tv\.|estrada|alameda|al\.|pra[cç]a|rodovia|viela)\s/i.test(l)) || '');
    acc.bairro = rotulo(/^bairro\s*:?\s*(.*)$/i);
    acc.cidade = rotulo(/^(?:cidade|munic[ií]pio)\s*:?\s*(.*)$/i)
      || ((texto.match(/\b([A-ZÀ-Ú][a-zà-ú]+(?:\s(?:d[aeo]s?\s)?[A-ZÀ-Ú][a-zà-ú]+)*)\s*[-/]\s*SP\b/) || [])[1] || '');
    if (acc.rua.length > 120) acc.rua = '';
    let nome = null;
    for (const sel of ['h1', 'h2', '[class*="nome" i]', '[class*="name" i]', 'h3']) {
      nome = [...document.querySelectorAll(sel)].filter(e => !e.closest('header, nav')).map(e => e.textContent.trim()).find(nomePessoa);
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
    const prox = Object.values(mapa).find(x => !x.rota && x.vagas.length && enderecoSuficiente(x.endereco));
    if (!prox) return;
    const destinos = UNIDADES.filter(u => prox.vagas.includes(u.vaga));
    ocupado = true;
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
        const m = candidatos();
        const alvo = m[prox.id];
        if (r.status === 200 && Array.isArray(corpo)) {
          const porUnidade = [];
          let erroEnd = '';
          for (const el of corpo) {
            const u = destinos[el.destinationIndex || 0];
            if (el.status && el.status.code) { erroEnd = el.status.message || 'endereço não encontrado'; continue; }
            if (el.condition !== 'ROUTE_EXISTS') continue;
            porUnidade.push({ unidade: u.id, min: Math.round(parseInt(el.duration, 10) / 60), km: Math.round((el.distanceMeters || 0) / 100) / 10 });
          }
          porUnidade.sort((a, b) => a.min - b.min);
          if (alvo) alvo.rota = porUnidade.length ? { ok: true, porUnidade, melhor: porUnidade[0] }
            : { ok: false, motivo: erroEnd ? `Google não achou o endereço (${erroEnd})` : 'sem rota de ônibus encontrada' };
        } else if (r.status === 400 && alvo) {
          alvo.rota = { ok: false, motivo: `Google recusou o endereço: ${(corpo && corpo.error && corpo.error.message) || r.status}` };
        } else if (r.status !== 400) {
          erroGeral = (corpo && corpo.error && corpo.error.message) || `erro ${r.status} do Google`;
        }
        if (alvo) m[prox.id] = alvo;
        ocupado = false;
        salvarCandidatos(m);
        if (!erroGeral) setTimeout(processarFila, 250);
      },
      onerror: () => { ocupado = false; erroGeral = 'sem conexão com o Google'; agendarRender(); },
      ontimeout: () => { ocupado = false; erroGeral = 'o Google demorou demais para responder'; agendarRender(); },
    });
  }

  // ------------------------------------------------------------------ situação de cada candidato
  const whats = x => (x.fones || []).find(ehCelular) || null;
  function situacao(x, c) {
    if (!x.vagas.length) return { grupo: 'falta', motivo: 'não sei de qual vaga é', semVaga: true };
    if (!enderecoSuficiente(x.endereco)) return { grupo: 'falta', motivo: x.endereco ? `endereço incompleto (${x.endereco})` : 'sem endereço' };
    if (!x.rota) return { grupo: 'falta', motivo: c.chave ? (erroGeral ? 'aguardando o Google' : 'calculando…') : 'falta a chave do Google' };
    if (!x.rota.ok) return { grupo: 'falta', motivo: x.rota.motivo };
    const m = x.rota.melhor;
    const dentro = c.medida === 'km' ? m.km <= c.limite : m.min <= c.limite;
    return { grupo: dentro ? 'dentro' : 'longe', melhor: m };
  }

  // ------------------------------------------------------------------ painel
  let raiz = null, renderAgendado = false;
  const agendarRender = () => { if (renderAgendado) return; renderAgendado = true; setTimeout(() => { renderAgendado = false; render(); }, 60); };
  const linkRota = (origem, u) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origem)}&destination=${encodeURIComponent(u.rota)}&travelmode=transit`;

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 420px; max-width: calc(100vw - 32px);
      max-height: 75vh; display: flex; flex-direction: column; background: #fff; color: #1f2328; border: 1px solid #d0d7de;
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); font: 13px/1.4 "Segoe UI", Roboto, Arial, sans-serif; }
    .box.min { width: auto; }
    .box.min .corpo { display: none; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #7a2e55; color: #fff; border-radius: 9px 9px 0 0; cursor: pointer; }
    .box.min header { border-radius: 9px; }
    header b { font-size: 13px; }
    header .cont { font-size: 12px; opacity: .9; margin-left: auto; white-space: nowrap; }
    .corpo { display: flex; flex-direction: column; min-height: 0; }
    .aviso { margin: 8px 10px 0; padding: 6px 8px; border-radius: 6px; background: #fff8c5; border: 1px solid #e9d68b; font-size: 12px; }
    .aviso.erro { background: #ffebe9; border-color: #f3b2ab; }
    details { margin: 8px 10px 0; }
    summary { cursor: pointer; color: #57606a; font-size: 12px; }
    .cfg { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; margin-top: 6px; font-size: 12px; }
    .cfg input, .cfg select { font: inherit; padding: 3px 6px; border: 1px solid #d0d7de; border-radius: 5px; min-width: 0; }
    .cfg .lim { display: flex; gap: 6px; } .cfg .lim input { width: 64px; }
    nav { display: flex; gap: 4px; margin: 8px 10px 0; }
    nav button { flex: 1; font: inherit; font-size: 12px; padding: 5px 4px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; cursor: pointer; color: #1f2328; }
    nav button.on { background: #7a2e55; border-color: #7a2e55; color: #fff; }
    ul { list-style: none; margin: 8px 0 0; padding: 0 10px; overflow: auto; min-height: 40px; }
    li { padding: 7px 0; border-bottom: 1px solid #eaeef2; }
    li:last-child { border-bottom: 0; }
    .l1 { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .l1 b { font-size: 13px; }
    .tag { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef1f4; color: #424a53; }
    .tag.cozinha { background: #fde8d7; color: #8a3b00; } .tag.atendente { background: #dcecff; color: #0b4a8f; }
    .tempo { margin-left: auto; font-weight: 600; white-space: nowrap; }
    .longe .tempo { color: #9a6700; }
    .l2 { color: #57606a; font-size: 12px; margin-top: 2px; }
    .l2 a { color: #0a6b35; font-weight: 600; text-decoration: none; } .l2 a.maps { color: #0969da; font-weight: 400; }
    .mini { font: inherit; font-size: 11px; padding: 1px 7px; margin-left: 4px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 5px; cursor: pointer; }
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
        : x.fones.length ? `${esc(formatarFone(x.fones[0]))} (fixo)` : 'sem telefone';
      if (s.melhor) {
        const u = unidade(s.melhor.unidade);
        const outras = x.rota.porUnidade.slice(1).map(p => `${unidade(p.unidade).nome}: ${p.min} min`).join(' · ');
        return `<li class="${s.grupo}"><div class="l1"><b>${esc(x.nome)}</b><span class="tag ${u.vaga}">${esc(VAGAS[u.vaga])}</span>
          <span class="tempo">🚌 ${s.melhor.min} min · ${String(s.melhor.km).replace('.', ',')} km</span></div>
          <div class="l2">Loja ${esc(u.nome)} — ${esc(u.endereco)}</div>
          <div class="l2">WhatsApp: ${wHtml} · <a class="maps" href="${esc(linkRota(x.endereco, u))}" target="_blank" rel="noopener">ver rota</a>${outras ? ` · ${esc(outras)}` : ''}</div></li>`;
      }
      const vagaBtns = s.semVaga ? Object.entries(VAGAS).map(([k, v]) => `<button class="mini" data-a="vaga" data-id="${esc(x.id)}" data-v="${k}">${esc(v)}</button>`).join('') : '';
      const tags = x.vagas.map(v => `<span class="tag ${v}">${esc(VAGAS[v])}</span>`).join('');
      return `<li><div class="l1"><b>${esc(x.nome)}</b>${tags}</div>
        <div class="l2">⚠ ${esc(s.motivo)}${vagaBtns}</div>
        <div class="l2">WhatsApp: ${wHtml}${x.endereco ? ` · ${esc(x.endereco)}` : ''}</div></li>`;
    };

    const avisos = [];
    if (!c.chave) avisos.push(`<div class="aviso">Para calcular o ônibus, cole sua chave do Google em ⚙ Ajustes (veja o LEIA-ME).</div>`);
    if (erroGeral) avisos.push(`<div class="aviso erro">Google: ${esc(erroGeral)} <button class="mini" data-a="tentar">tentar de novo</button></div>`);
    const vp = vagaDaPagina();

    box.className = `box${ui.min ? ' min' : ''}`;
    box.innerHTML = `
      <header data-a="min"><b>🍮 Filtro PudiMarin</b><span class="cont">${n('dentro')} perto · ${n('longe')} longe · ${n('falta')} pendentes ${ui.min ? '▴' : '▾'}</span></header>
      <div class="corpo">
        ${avisos.join('')}
        <details ${(ajustesAbertos ?? !c.chave) ? 'open' : ''}><summary>⚙ Ajustes · limite ${esc(limTxt)} de ônibus · vaga desta página: ${esc(vp ? VAGAS[vp] : 'não identificada')}</summary>
          <div class="cfg">
            <label>Chave Google</label><input type="password" data-c="chave" value="${esc(c.chave)}" placeholder="AIza…" autocomplete="off">
            <label>Limite</label><span class="lim"><input type="number" min="1" step="1" data-c="limite" value="${esc(c.limite)}">
              <select data-c="medida"><option value="min" ${c.medida === 'min' ? 'selected' : ''}>minutos de ônibus</option><option value="km" ${c.medida === 'km' ? 'selected' : ''}>km de ônibus</option></select></span>
            <label>Vaga desta página</label><select data-c="vagaPagina"><option value="">Automático (pelo título)</option>
              ${Object.entries(VAGAS).map(([k, v]) => `<option value="${k}" ${c.vagaPagina === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          </div></details>
        <nav>
          <button data-a="aba" data-v="dentro" class="${aba === 'dentro' ? 'on' : ''}">Até ${esc(limTxt)} (${n('dentro')})</button>
          <button data-a="aba" data-v="longe" class="${aba === 'longe' ? 'on' : ''}">Longe (${n('longe')})</button>
          <button data-a="aba" data-v="falta" class="${aba === 'falta' ? 'on' : ''}">Pendentes (${n('falta')})</button>
        </nav>
        <ul>${itens.length ? itens.map(linha).join('') : `<li class="vazio">${lista.length ? 'Ninguém aqui.' : 'Abra a lista de candidatos ou os currículos de uma vaga na Catho. Os candidatos vão aparecendo aqui.'}</li>`}</ul>
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
    let v = ev.target.value;
    if (campo === 'limite') v = Math.max(1, Number(v) || CFG_PADRAO.limite);
    if (campo === 'chave') { v = v.trim(); erroGeral = ''; }
    gravar(K.cfg, { ...c, [campo]: v });
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
    else if (a === 'vaga') {
      const m = candidatos();
      const x = m[el.dataset.id];
      if (x) { x.vagas = [el.dataset.v]; delete x.rota; salvarCandidatos(m); processarFila(); }
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
      ...itens.map(({ x }) => { const w = whats(x); return `• ${x.nome} — WhatsApp ${w ? formatarFone(w) : 'não informado'}`; }),
      '',
    ])).join('\n').trim();
  }

  function baixarCsv() {
    const c = cfg();
    const cel = v => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
    const linhas = [['Nome', 'Vaga', 'Loja', 'Endereço da loja', 'WhatsApp', 'Ônibus (min)', 'Ônibus (km)', 'Situação', 'Endereço do candidato']];
    for (const x of Object.values(candidatos())) {
      const s = situacao(x, c);
      const u = s.melhor ? unidade(s.melhor.unidade) : null;
      const w = whats(x);
      linhas.push([x.nome, u ? VAGAS[u.vaga] : x.vagas.map(v => VAGAS[v]).join(' / '), u ? u.nome : '', u ? u.endereco : '',
        w ? formatarFone(w) : '', s.melhor ? s.melhor.min : '', s.melhor ? String(s.melhor.km).replace('.', ',') : '',
        s.grupo === 'dentro' ? 'dentro do limite' : s.grupo === 'longe' ? 'longe' : s.motivo, x.endereco]);
    }
    const blob = new Blob(['﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `candidatos-pudimarin-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ------------------------------------------------------------------ diagnóstico (sem dados pessoais)
  const MANTER = new Set(('nome endereco bairro cidade estado cep telefone telefones celular whatsapp contato email vaga vagas candidato candidatos '
    + 'curriculo curriculos cargo auxiliar cozinha atendente delivery rua avenida av sp idade anos ver mais perfil dados pessoais residencial '
    + 'localizacao distancia inscritos aprovados triagem selecionados salvar contatar mensagem baixar imprimir pretensao salarial objetivo '
    + 'experiencia formacao sobre de da do e em para com resumo informacoes').split(' '));
  const mascarar = s => String(s).slice(0, 80).replace(/[A-Za-zÀ-ÿ]+/g, w => MANTER.has(norm(w)) ? w : 'x'.repeat(Math.min(w.length, 4))).replace(/\d/g, '9');
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
  function estruturaDom() {
    const out = [];
    const andar = (el, prof) => {
      if (out.length > 350 || prof > 30 || el.id === 'pm-filtro-catho' || /^(SCRIPT|STYLE|SVG|NOSCRIPT|PATH)$/i.test(el.tagName)) return;
      const proprio = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
      if (proprio) {
        const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        out.push(`${' '.repeat(Math.min(prof, 20))}${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}: ${mascarar(proprio)}`);
      }
      [...el.children].forEach(c => andar(c, prof + 1));
    };
    if (document.body) andar(document.body, 0);
    return out;
  }
  function diagnostico() {
    const c = cfg();
    const lista = Object.values(candidatos());
    return {
      versao: VERSAO, pagina: location.origin + location.pathname.replace(/\d{3,}/g, '{id}'), titulo: mascarar(document.title),
      leitura: { hook: diag.hook, respostasJson: diag.respostas, candidatosLidos: diag.capturados, erros: diag.erros },
      guardados: { total: lista.length, comEndereco: lista.filter(x => enderecoSuficiente(x.endereco)).length,
        comCelular: lista.filter(whats).length, comVaga: lista.filter(x => x.vagas.length).length, comRota: lista.filter(x => x.rota && x.rota.ok).length },
      temChave: !!c.chave, erroGoogle: erroGeral, vagaDaPagina: vagaDaPagina(),
      endpoints: diag.endpoints, dom: estruturaDom(),
    };
  }

  // ------------------------------------------------------------------ início
  function iniciar() {
    montarPainel();
    lerJsonEmbutido();
    setTimeout(() => lerPagina(false), 1500);
    processarFila();
    try { GM_addValueChangeListener(K.cand, (k, velho, novo, remoto) => { if (remoto) agendarRender(); }); } catch (e) { /* ignora */ }
    try { GM_addValueChangeListener(K.cfg, (k, velho, novo, remoto) => { if (remoto) { erroGeral = ''; agendarRender(); processarFila(); } }); } catch (e) { /* ignora */ }
    // páginas que trocam de conteúdo sem recarregar: relê quando a tela muda
    let ultimaUrl = location.href, espera = null;
    new MutationObserver(() => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        lerJsonEmbutido();
        if (location.href !== ultimaUrl) { ultimaUrl = location.href; agendarRender(); }
        lerPagina(false);
      }, 1200);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
