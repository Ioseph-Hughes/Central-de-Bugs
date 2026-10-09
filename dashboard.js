/* Central local: todos os widgets enviam ao mesmo receptor. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const names = { 'radar-contratual': 'Radar Contratual', 'central-demo': 'Central · Testes' };
  const types = { bug: 'Bug / erro', melhoria: 'Melhoria', ajuste: 'Ajuste' };
  const states = { novo: 'Novo', 'em-analise': 'Em análise', 'em-correcao': 'Em correção', resolvido: 'Resolvido' };
  const icons = { bug: '⌁', melhoria: '✧', ajuste: '↗' };
  let records = [], selectedSystem = '', loading = false, fingerprint = '';
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const systemName = id => names[id] || id;
  const date = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  function safeLink(value, label = value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return element('span', label);
      const link = element('a', label); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
    } catch { return element('span', label || 'Não informado'); }
  }
  function showError(message) { $('#error').textContent = message; $('#error').hidden = !message; }
  async function api(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`A Central respondeu com erro ${response.status}.`);
    return response.json();
  }
  async function refresh() {
    if (loading) return;
    loading = true; $('#refresh').disabled = true;
    try {
      const payload = await api('/api/reports');
      const next = JSON.stringify(payload.reports);
      if (next !== fingerprint) { records = payload.reports; fingerprint = next; render(); }
      $('#sync').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · a cada 3 s`;
      showError('');
    } catch { showError('Não foi possível atualizar. Confira se a Central está rodando e clique em Atualizar.'); $('#sync').textContent = 'Conexão indisponível'; }
    finally { loading = false; $('#refresh').disabled = false; }
  }
  function render() {
    const ids = [...new Set(['radar-contratual', 'central-demo', ...records.map(item => item.report.projectId)])];
    const systems = $('#systems'); systems.replaceChildren();
    for (const id of ['', ...ids]) {
      const button = element('button', undefined, 'system-button'); button.setAttribute('aria-current', String(id === selectedSystem));
      const title = id ? systemName(id) : 'Todos os sistemas';
      button.append(element('span', id ? title.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).slice(0, 2).map(word => word[0]).join('').toUpperCase() : '▦', 'system-icon'),
        element('span', title, 'system-name'), element('span', String(records.filter(item => !id || item.report.projectId === id).length), 'count'));
      button.onclick = () => { selectedSystem = id; render(); }; systems.append(button);
    }
    $('#page-title').textContent = selectedSystem ? systemName(selectedSystem) : 'Todos os sistemas';
    const current = records.filter(item => !selectedSystem || item.report.projectId === selectedSystem);
    $('#total').textContent = current.length;
    $('#new-count').textContent = current.filter(item => item.status === 'novo').length;
    $('#resolved-count').textContent = current.filter(item => item.status === 'resolvido').length;
    $('#progress-count').textContent = current.filter(item => ['em-analise', 'em-correcao'].includes(item.status)).length;
    const term = $('#search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = current.filter(item => (!$('#type').value || item.report.type === $('#type').value) &&
      (!$('#status-filter').value || item.status === $('#status-filter').value) &&
      (!term || [item.report.title, item.report.description, item.report.projectId, systemName(item.report.projectId)].join(' ').toLocaleLowerCase('pt-BR').includes(term)));
    $('#visible-count').textContent = filtered.length;
    const list = $('#reports'); list.replaceChildren();
    if (!filtered.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('strong', current.length ? 'Nenhuma ocorrência com estes filtros.' : 'Tudo começa com o primeiro relato.'),
        element('span', current.length ? 'Altere a busca, o tipo ou o status para ver outros resultados.' : 'Os relatos enviados pelo plugin aparecerão aqui, separados por sistema.'));
      list.append(empty);
    }
    for (const id of ids) {
      const items = filtered.filter(item => item.report.projectId === id);
      if (!items.length) continue;
      const section = element('section', undefined, 'system-group'), heading = element('div', undefined, 'group-head');
      heading.append(element('h3', systemName(id)), element('span', `${items.length} ocorrência${items.length === 1 ? '' : 's'}`, 'count'));
      const rows = element('div', undefined, 'occurrences');
      for (const item of items) {
        const report = item.report, row = element('button', undefined, 'occurrence'), content = element('span');
        row.dataset.key = item.key;
        const meta = element('span', undefined, 'row-meta');
        meta.append(element('span', types[report.type], `badge ${report.type}`), element('span', date(item.receivedAt)),
          element('span', `${item.attachments.length} imagem(ns) · ${report.links.length} link(s)`));
        content.append(element('strong', report.title), element('span', report.description, 'excerpt'), meta);
        row.append(element('span', icons[report.type], 'type-icon'), content, element('span', states[item.status], `badge status-badge ${item.status}`));
        row.onclick = () => openDetail(item.key); rows.append(row);
      }
      section.append(heading, rows); list.append(section);
    }
  }
  function openDetail(key) {
    const item = records.find(record => record.key === key); if (!item) return;
    const report = item.report, container = $('#detail-content'); container.replaceChildren();
    const title = element('h2', report.title); title.id = 'detail-title';
    const meta = element('div', undefined, 'detail-meta');
    meta.append(element('span', types[report.type], `badge ${report.type}`), element('span', systemName(report.projectId)), element('span', `Recebido em ${date(item.receivedAt)}`));
    container.append(meta, title);
    if (item.recoveryNote) container.append(element('p', item.recoveryNote, 'detail-note'));
    const statusRow = element('div', undefined, 'detail-status'), label = element('label', 'Status da ocorrência'), select = element('select');
    select.id = 'occurrence-status'; label.htmlFor = select.id;
    for (const [value, text] of Object.entries(states)) { const option = element('option', text); option.value = value; select.append(option); }
    select.value = item.status;
    const statusMessage = element('span', '', 'muted'); statusMessage.setAttribute('role', 'status');
    select.onchange = async () => {
      select.disabled = true; statusMessage.textContent = 'Salvando…';
      try {
        const saved = await api(`/api/reports/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value }) });
        records = records.map(record => record.key === key ? saved : record);
        item.status = saved.status; fingerprint = ''; render(); statusMessage.textContent = 'Status salvo.';
      } catch { select.value = item.status; statusMessage.textContent = 'Falha ao salvar. Tente novamente.'; }
      finally { select.disabled = false; }
    };
    statusRow.append(label, select, statusMessage); container.append(statusRow);
    function section(title) { const section = element('section', undefined, 'detail-section'); section.append(element('h3', title)); container.append(section); return section; }
    section('Descrição completa').append(element('p', report.description, 'description'));
    const images = section(`Imagens e capturas (${item.attachments.length})`), gallery = element('div', undefined, 'gallery');
    if (!item.attachments.length) images.append(element('p', 'Nenhuma imagem anexada.', 'muted'));
    for (const file of item.attachments) {
      const figure = element('figure');
      if (file.unavailable) figure.append(element('div', 'O receptor antigo não guardou o arquivo desta imagem.', 'unavailable'));
      else {
        const link = element('a'); link.href = file.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const img = element('img'); img.src = file.url; img.alt = file.name; img.loading = 'lazy'; link.append(img); figure.append(link);
      }
      figure.append(element('figcaption', `${file.name} · ${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`)); gallery.append(figure);
    }
    images.append(gallery);
    const links = section(`Links enviados (${report.links.length})`);
    if (!report.links.length) links.append(element('p', 'Nenhum link informado.', 'muted'));
    else { const ul = element('ul', undefined, 'detail-links'); for (const url of report.links) { const li = element('li'); li.append(safeLink(url)); ul.append(li); } links.append(ul); }
    const context = section('Contexto do envio'), dl = element('dl');
    const details = [ ['Sistema', `${systemName(report.projectId)} (${report.projectId})`], ['Página de origem', safeLink(report.context?.url)],
      ['Título da página', report.context?.pageTitle || 'Não informado'], ['Enviado em', date(report.createdAt)],
      ['Resolução', report.context?.viewport ? `${report.context.viewport.width} × ${report.context.viewport.height}` : 'Não informada'],
      ['Idioma', report.context?.language || 'Não informado'], ['Usuário', report.user ? JSON.stringify(report.user) : 'Não identificado pelo sistema'],
      ['Identificador', report.id] ];
    if (item.updatedAt) details.push(['Status atualizado', date(item.updatedAt)]);
    for (const [name, value] of details) { const dd = element('dd'); if (value instanceof Node) dd.append(value); else dd.textContent = value; dl.append(element('dt', name), dd); }
    context.append(dl);
    if (!$('#detail').open) $('#detail').showModal();
  }
  function themeButton() { const dark = document.documentElement.dataset.theme === 'dark'; $('#theme').textContent = dark ? '☀ Modo claro' : '☾ Modo escuro'; $('#theme').setAttribute('aria-pressed', String(dark)); }
  $('#theme').onclick = () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('central-theme', document.documentElement.dataset.theme); } catch {} themeButton(); };
  $('#refresh').onclick = refresh;
  $('#search').oninput = render; $('#type').onchange = render; $('#status-filter').onchange = render;
  $('#close-detail').onclick = () => $('#detail').close();
  window.feedback = CentralBugs.init({ projectId: 'central-demo', endpoint: '/api/reports', successMessage: 'Relato salvo na Central! Ele aparecerá na caixa de entrada.' });
  $('#open').onclick = () => feedback.open();
  themeButton(); render(); refresh();
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
