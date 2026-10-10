/* Central local: todos os widgets enviam ao mesmo receptor. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const preview = document.documentElement.dataset.centralMode === 'preview';
  const cloud = document.documentElement.dataset.centralMode === 'cloud';
  const names = { 'radar-contratual': 'Radar Contratual', 'central-demo': 'Central · Testes' };
  const types = { bug: 'Bug / erro', melhoria: 'Melhoria', ajuste: 'Ajuste' };
  const states = { novo: 'Bugs novos', 'em-analise': 'Em análise', 'em-correcao': 'Em processamento', resolvido: 'Terminados' };
  const icons = { bug: '⌁', melhoria: '✧', ajuste: '↗' };
  let projects = [], editingSystem = null, deleting = false, deletionRecords = [], revision = 0;
  let records = [], stats = [], selectedSystem = '', loading = false, fingerprint = '', active = !cloud, epoch = 0;
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
    if (cloud) return CentralCloud.api(url, options);
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    const payload=await response.json();
    if (!response.ok) throw new Error(payload.error || `A Central respondeu com erro ${response.status}.`);
    return payload;
  }
  async function saveStatus(key, status) {
    const current = epoch;
    const previous = records.find(record => record.key === key);
    const saved = await api(`/api/reports/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (current !== epoch) throw new Error('Sessão encerrada.');
    if (cloud && previous && previous.status !== saved.status) {
      const count = stats.find(item => item.project_id === previous.report.projectId);
      const group = state => state === 'novo' ? 'new_count' : state === 'resolvido' ? 'resolved_count' : 'progress_count';
      if (count) { count[group(previous.status)]--; count[group(saved.status)]++; }
    }
    revision++; records = records.map(record => record.key === key ? saved : record);
    fingerprint = ''; render(); return saved;
  }
  async function refresh() {
    if (loading || !active) return;
    const current = epoch, version = revision;
    loading = true; $('#refresh').disabled = true;
    try {
      const search = $('#search').value.trim();
      const payload = await api(`/api/reports${cloud && search ? '?search=' + encodeURIComponent(search) : ''}`);
      if (current !== epoch) return;
      if (version !== revision) { setTimeout(refresh,0); return; }
      if (cloud && search !== $('#search').value.trim()) { setTimeout(refresh,0); return; }
      projects=payload.projects || [];
      for (const project of projects) names[project.id] = project.name;
      const next = JSON.stringify([payload.reports,payload.stats,projects]); stats = payload.stats || [];
      if (next !== fingerprint) { records = payload.reports; fingerprint = next; render(); }
      $('#sync').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · a cada ${cloud ? 15 : 3} s`;
      if (payload.limited) $('#sync').textContent += ` · histórico parcial: ${payload.reports.length} mais recentes`;
      showError('');
    } catch (error) { if (current === epoch) { showError(cloud ? error.message : 'Não foi possível atualizar. Confira se a Central está rodando e clique em Atualizar.'); $('#sync').textContent = 'Conexão indisponível'; } }
    finally { if (current === epoch) { loading = false; $('#refresh').disabled = false; } }
  }
  function render() {
    const ids = [...new Set([...Object.keys(names), ...records.map(item => item.report.projectId)])];
    const systems = $('#systems'); systems.replaceChildren();
    for (const id of ['', ...ids]) {
      const button = element('button', undefined, 'system-button'); button.setAttribute('aria-current', String(id === selectedSystem));
      const title = id ? systemName(id) : 'Todos os sistemas';
      button.append(element('span', id ? title.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).slice(0, 2).map(word => word[0]).join('').toUpperCase() : '▦', 'system-icon'),
        element('span', title, 'system-name'), element('span', String(cloud ? stats.filter(item => !id || item.project_id === id).reduce((sum,item) => sum + item.total,0) : records.filter(item => !id || item.report.projectId === id).length), 'count'));
      button.onclick = () => { selectedSystem = id; switchView('reports'); };  systems.append(button);
    }
    $('#page-title').textContent = selectedSystem ? systemName(selectedSystem) : 'Todos os sistemas';
    const current = records.filter(item => !selectedSystem || item.report.projectId === selectedSystem);
    $('#total').textContent = current.length;
    $('#new-count').textContent = current.filter(item => item.status === 'novo').length;
    $('#resolved-count').textContent = current.filter(item => item.status === 'resolvido').length;
    $('#progress-count').textContent = current.filter(item => ['em-analise', 'em-correcao'].includes(item.status)).length;
    if (cloud) {
      const counts = stats.filter(item => !selectedSystem || item.project_id === selectedSystem);
      for (const [id,key] of [['total','total'],['new-count','new_count'],['resolved-count','resolved_count'],['progress-count','progress_count']]) $( '#' + id ).textContent = counts.reduce((sum,item) => sum + item[key],0);
    }
    const term = $('#search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = current.filter(item => (!$('#type').value || item.report.type === $('#type').value) &&
      (!$('#status-filter').value || item.status === $('#status-filter').value) &&
      (cloud || !term || [item.report.title, item.report.description, item.report.projectId, systemName(item.report.projectId),companyName(item.report.projectId)].join(' ').toLocaleLowerCase('pt-BR').includes(term)));
    $('#visible-count').textContent = filtered.length;
    const list = $('#reports'); list.replaceChildren();
    if (!filtered.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('strong', preview ? 'Conecte o armazenamento da Central.' : current.length ? 'Nenhuma ocorrência com estes filtros.' : 'Tudo começa com o primeiro relato.'),
        element('span', preview ? 'Esta prévia ainda não recebe relatos. Os sistemas aparecerão com suas ocorrências após configurar o serviço online.' : current.length ? 'Altere a busca, o tipo ou o status para ver outros resultados.' : 'Os relatos enviados pelo plugin aparecerão aqui, separados por sistema.'));
      list.append(empty);
    }
    const companyNames=[...new Set(ids.filter(id=>!selectedSystem || id===selectedSystem).map(companyName))];
    for (const company of companyNames) {
      const items=filtered.filter(item=>companyName(item.report.projectId)===company);
      const companyProjects=ids.filter(id=>companyName(id)===company && (!selectedSystem || id===selectedSystem));
      if (!items.length && !companyProjects.some(id=>records.some(item=>item.report.projectId===id) || projects.find(project=>project.id===id)?.restricted)) continue;
      const section=element('section',undefined,'system-group'), heading=element('div',undefined,'group-head');
      heading.append(element('h3',company),element('span',`${items.length} ocorrência${items.length===1?'':'s'}`,'count'));
      section.append(heading,element('p',companyProjects.map(systemName).join(' · '),'muted company-systems'));
      const board=element('div',undefined,'status-board');
      for (const [status,label] of Object.entries(states)) {
        const column=element('section',undefined,'status-column '+status); column.dataset.status=status;
        const stage=items.filter(item=>item.status===status), title=element('div',undefined,'column-heading');
        title.append(element('h4',label),element('span',String(stage.length),'count')); column.append(title);
        const rows=element('div',undefined,'occurrences');
        if (!stage.length) rows.append(element('p','Nenhuma ocorrência nesta etapa.','column-empty'));
        for (const item of stage) rows.append(occurrenceCard(item));
        column.append(rows); board.append(column);
      }
      section.append(board); list.append(section);
    }
    renderRegistry();
  }
  const companyName=id=>projects.find(project=>project.id===id)?.company || systemName(id);
  function occurrenceCard(item) {
    const report=item.report, row=element('button',undefined,'occurrence'), content=element('span'); row.dataset.key=item.key; row.setAttribute('aria-label',`Abrir ocorrência: ${report.title}`);
    const meta=element('span',undefined,'row-meta');
    meta.append(element('span',types[report.type],`badge ${report.type}`),element('span',systemName(report.projectId)),element('span',date(item.receivedAt)),
      element('span',`${item.attachmentCount ?? item.attachments.length} imagem(ns) · ${item.linkCount ?? report.links.length} link(s)`));
    content.append(element('strong',report.title),element('span',report.description,'excerpt'),meta);
    row.append(element('span',icons[report.type],'type-icon'),content); row.onclick=()=>openDetail(item.key);
    const wrapper=element('article',undefined,'occurrence-row'), actions=element('div',undefined,'card-actions');
    const next={'novo':'em-analise','em-analise':'em-correcao','em-correcao':'resolvido'}[item.status];
    if (next && next!=='resolvido') {
      const advance=element('button',next==='em-analise'?'Analisar':'Processar','button advance');
      advance.setAttribute('aria-label',`${advance.textContent} ocorrência: ${report.title}`);
      advance.onclick=async()=>{advance.disabled=true;try{await saveStatus(item.key,next);showError('');}catch(error){advance.disabled=false;showError(error.message);}};
      actions.append(advance);
    }
    const resolve=element('button',item.status==='resolvido'?'✓ Resolvido':'Resolver','button resolve');
    resolve.disabled=item.status==='resolvido'; resolve.setAttribute('aria-label',`${resolve.disabled?'Ocorrência resolvida':'Resolver ocorrência'}: ${report.title}`);
    resolve.onclick=async()=>{resolve.disabled=true;resolve.textContent='Salvando…';try{await saveStatus(item.key,'resolvido');showError('');$('#sync').textContent='Ocorrência marcada como resolvida.';}catch{resolve.disabled=false;resolve.textContent='Resolver';showError('Não foi possível resolver esta ocorrência. Tente novamente.');}};
    const remove=element('button','Apagar','button danger'); remove.setAttribute('aria-label',`Apagar ocorrência: ${report.title}`);
    remove.onclick=()=>deleteOne(item,remove); actions.append(resolve,remove); wrapper.append(row,actions); return wrapper;
  }

  async function openDetail(key) {
    let item = records.find(record => record.key === key); if (!item) return;
    if (cloud) {
      const current = epoch;
      try { item = await api(`/api/reports/${key}`); if (current !== epoch || !active) return; }
      catch (error) { if (current === epoch) showError(error.message); return; }
    }
    const report = item.report, container = $('#detail-content'); container.replaceChildren();
    const title = element('h2', report.title); title.id = 'detail-title';
    const meta = element('div', undefined, 'detail-meta');
    meta.append(element('span', types[report.type], `badge ${report.type}`), element('span', systemName(report.projectId)), element('span', `Recebido em ${date(item.receivedAt)}`));
    container.append(meta, title);
    const remove=element('button','Apagar ocorrência e anexos','button danger'); remove.onclick=()=>deleteOne(item,remove); container.append(remove);
    if (item.recoveryNote) container.append(element('p', item.recoveryNote, 'detail-note'));
    const statusRow = element('div', undefined, 'detail-status'), label = element('label', 'Status da ocorrência'), select = element('select');
    select.id = 'occurrence-status'; label.htmlFor = select.id;
    for (const [value, text] of Object.entries(states)) { const option = element('option', text); option.value = value; select.append(option); }
    select.value = item.status;
    const statusMessage = element('span', '', 'muted'); statusMessage.setAttribute('role', 'status');
    select.onchange = async () => {
      select.disabled = true; statusMessage.textContent = 'Salvando…';
      try {
        const saved = await saveStatus(key, select.value);
        item.status = saved.status; statusMessage.textContent = 'Status salvo.';
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
    const details = [ ['Empresa',companyName(report.projectId)], ['Sistema', `${systemName(report.projectId)} (${report.projectId})`], ['Página de origem', safeLink(report.context?.url)],
      ['Título da página', report.context?.pageTitle || 'Não informado'], ['Enviado em', date(report.createdAt)],
      ['Resolução', report.context?.viewport ? `${report.context.viewport.width} × ${report.context.viewport.height}` : 'Não informada'],
      ['Idioma', report.context?.language || 'Não informado'], ['Usuário', report.user ? JSON.stringify(report.user) : 'Não identificado pelo sistema'],
      ['Identificador', report.id] ];
    if (item.updatedAt) details.push(['Status atualizado', date(item.updatedAt)]);
    for (const [name, value] of details) { const dd = element('dd'); if (value instanceof Node) dd.append(value); else dd.textContent = value; dl.append(element('dt', name), dd); }
    context.append(dl);
    if (!$('#detail').open) $('#detail').showModal();
  }
  function switchView(next) {
    $('#reports-view').hidden=next!=='reports'; $('#registry-view').hidden=next!=='registry';
    $('#view-name').textContent=next==='registry'?'Central de Sistemas':'Ocorrências';
    $('#nav-reports').setAttribute('aria-current',next==='reports'?'page':'false'); $('#nav-registry').setAttribute('aria-current',next==='registry'?'page':'false'); render();
  }
  function renderRegistry() {
    const list=$('#registry-list'); list.replaceChildren();
    const registered=projects.filter(project=>project.id!=='central-demo');
    if (!registered.length) list.append(element('div','Cadastre seu primeiro sistema para gerar um ID de integração.','empty'));
    for (const project of registered) {
      const card=element('article',undefined,'registry-card'), heading=element('div',undefined,'group-head');
      heading.append(element('h2',project.name),element('span',project.restricted ? project.connectedAt ? 'Conectado' : 'Aguardando integração' : 'Integração anterior','badge'));
      card.append(heading,element('p',project.company || project.name,'muted'));
      const accounts=element('ul',undefined,'authorized-accounts');
      for (const account of project.allowedEmails || []) accounts.append(element('li',account));
      card.append(element('strong','Contas principais autorizadas'),accounts);
      if (!project.restricted) card.append(element('p','As contas desta instalação ainda são controladas pelo código do SaaS. Configure o cadastro para usar o novo ID.','muted'));
      card.append(element('p',project.origins.length ? project.origins.join(' · ') : 'Domínio será cadastrado na primeira conexão.','muted'));
      if (project.connectedAt) card.append(element('p',`Última autorização: ${date(project.connectedAt)}`,'muted'));
      const edit=element('button','Editar contas e integração','button'); edit.setAttribute('aria-label',`Editar sistema: ${project.name}`); edit.onclick=()=>systemForm(project); card.append(edit); list.append(card);
    }
    $('#new-system').disabled=preview;
  }
  function systemForm(project=null) {
    editingSystem=project; const form=$('#system-form'); form.reset();
    form.elements.company.value=project?.company || project?.name || ''; form.elements.name.value=project?.name || '';
    form.elements.emails.value=(project?.allowedEmails || []).join('\n'); form.elements.origins.value=(project?.origins || []).join('\n');
    $('#system-dialog-title').textContent=project?'Editar sistema':'Cadastrar sistema'; $('.rotate-id').hidden=!project?.restricted;
    $('#system-warning').hidden=!project || project.restricted; $('#system-error').textContent='';
    $('#save-system').textContent=project?'Salvar alterações':'Salvar e gerar ID'; $('#save-system').disabled=false; $('#system-dialog').showModal();
  }
  $('#system-form').onsubmit=async event=>{
    event.preventDefault(); const form=event.currentTarget, current=epoch, id=editingSystem?.id;
    const lines=value=>value.split(/[\n,;]+/).map(item=>item.trim()).filter(Boolean);
    const input={name:form.elements.name.value,company:form.elements.company.value,allowedEmails:lines(form.elements.emails.value),origins:lines(form.elements.origins.value),...(id?{id,rotateId:$('#rotate-id').checked}:{})};
    $('#save-system').disabled=true; $('#system-error').textContent='';
    try {
      const saved=await api('/api/reports?systems=1',{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      if (current!==epoch) return;
      revision++; projects=[...projects.filter(project=>project.id!==saved.project.id),saved.project]; names[saved.project.id]=saved.project.name; fingerprint=''; render(); $('#system-dialog').close();
      if (saved.accessId) {
        const instructions=`Integre a Central de Bugs no sistema ${saved.project.name}, da empresa ${saved.project.company}.\n\nCentral: ${location.origin}\nID de acesso (somente no servidor): ${saved.accessId}\nContas autorizadas: ${saved.project.allowedEmails.join(', ')}\n\nLeia e siga o guia completo antes de alterar o SaaS:\nhttps://github.com/Ioseph-Hughes/Central-de-Bugs/blob/main/INTEGRACAO-PARA-IA.md\n\nConfirme a conta no servidor usando a autenticação existente. Não aceite e-mail informado pelo navegador e não exponha o ID em código público. Use CentralBugs.connect, remova o widget ao sair ou trocar de conta e teste uma conta permitida e outra não permitida.`;
        $('#access-id').textContent=saved.accessId; $('#integration-instructions').textContent=instructions; $('#copy-message').textContent=''; $('#integration-dialog').showModal();
      } else $('#sync').textContent='Cadastro atualizado. As contas removidas deixam de ser autorizadas nos próximos envios.';
    } catch(error) { if(current===epoch) $('#system-error').textContent=error.message; }
    finally { if(current===epoch) $('#save-system').disabled=false; }
  };
  async function removeRecord(item) {
    const current=epoch; await api(`/api/reports/${item.key}`,{method:'DELETE'});
    if (current!==epoch) throw new Error('Sessão encerrada.');
    const count=stats.find(value=>value.project_id===item.report.projectId);
    if (count) { count.total--; count[item.status==='novo'?'new_count':item.status==='resolvido'?'resolved_count':'progress_count']--; }
    revision++; records=records.filter(value=>value.key!==item.key); deletionRecords=deletionRecords.filter(value=>value.key!==item.key); fingerprint=''; render();
  }
  async function deleteOne(item,button) {
    if (deleting || !confirm(`Apagar “${item.report.title}” e todos os seus textos, links e imagens? Esta ação não pode ser desfeita.`)) return;
    deleting=true; button.disabled=true;
    try { await removeRecord(item); $('#detail').close(); showError(''); $('#sync').textContent='Ocorrência e anexos apagados.'; }
    catch(error) { if(active) { showError(error.message); button.disabled=false; } }
    finally { deleting=false; }
  }
  function deleteOptions() {
    const list=$('#delete-options'); list.replaceChildren();
    const before=$('#delete-before').value;
    const candidates=deletionRecords.filter(item=>item.status==='resolvido' && (!selectedSystem || item.report.projectId===selectedSystem) && before && new Date(item.receivedAt)<new Date(before+'T00:00:00'));
    for (const item of candidates) {
      const label=element('label',undefined,'delete-option'), input=element('input'); input.type='checkbox'; input.value=item.key; input.checked=true;
      label.append(input,element('span',`${item.report.title} · ${systemName(item.report.projectId)} · ${date(item.receivedAt)}`)); list.append(label);
    }
    if (!candidates.length) list.append(element('p','Nenhuma ocorrência terminada antes desta data.','muted'));
    $('#delete-scope').textContent=`${selectedSystem?systemName(selectedSystem):'Todos os sistemas'} · ${candidates.length} ocorrência(s). A seleção usa o histórico carregado no painel, até 1.000 ocorrências online.`;
    $('#confirm-delete-old').disabled=!candidates.length;
  }
  $('#confirm-delete-old').onclick=async()=>{
    const chosen=[...$('#delete-options').querySelectorAll('input:checked')].map(input=>deletionRecords.find(item=>item.key===input.value)).filter(Boolean);
    if (deleting || !chosen.length || !confirm(`Apagar definitivamente ${chosen.length} ocorrência(s) e todos os seus anexos?`)) return;
    const current=epoch; deleting=true; $('#confirm-delete-old').disabled=true; $('#delete-before').disabled=true;
    try {
      let count=0;
      for (const item of chosen) { await removeRecord(item); count++; $('#delete-message').textContent=`Apagadas ${count} de ${chosen.length}.`; }
      if(current===epoch) { deleteOptions(); showError(''); }
    } catch(error) { if(current===epoch) { deleteOptions(); $('#delete-message').textContent=`A exclusão parou: ${error.message} As ocorrências restantes podem ser selecionadas novamente.`; } }
    finally { deleting=false; if(current===epoch) $('#delete-before').disabled=false; }
  };
  $('#nav-reports').onclick=()=>switchView('reports'); $('#nav-registry').onclick=()=>switchView('registry'); $('#new-system').onclick=()=>systemForm();
  $('#close-system').onclick=()=>$('#system-dialog').close(); $('#close-integration').onclick=()=>$('#integration-dialog').close();
  $('#integration-dialog').addEventListener('close',()=>{ $('#access-id').textContent=''; $('#integration-instructions').textContent=''; });
  $('#copy-integration').onclick=async()=>{try{await navigator.clipboard.writeText($('#integration-instructions').textContent);$('#copy-message').textContent='Instruções copiadas. Guarde o ID em local seguro.';}catch{$('#copy-message').textContent='Selecione e copie as instruções abaixo manualmente.';}};
  $('#delete-old').onclick=async()=>{
    if(deleting)return; const current=epoch; $('#delete-old').disabled=true;
    try {
      deletionRecords=(await api('/api/reports')).reports; if(current!==epoch)return;
      const today=new Date(); $('#delete-before').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      $('#delete-message').textContent=''; deleteOptions(); $('#delete-dialog').showModal();
    } catch(error) {if(current===epoch)showError(error.message);}
    finally {if(current===epoch)$('#delete-old').disabled=false;}
  };
  $('#delete-before').onchange=deleteOptions; $('#close-delete').onclick=()=>$('#delete-dialog').close();
  function themeButton() { const dark = document.documentElement.dataset.theme === 'dark'; $('#theme').textContent = dark ? '☀ Modo claro' : '☾ Modo escuro'; $('#theme').setAttribute('aria-pressed', String(dark)); }
  $('#theme').onclick = () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('central-theme', document.documentElement.dataset.theme); } catch {} themeButton(); };
  $('#refresh').onclick = refresh;
  let searchTimer;
  $('#search').oninput = () => { if (cloud) { clearTimeout(searchTimer); searchTimer = setTimeout(refresh,300); } else render(); }; $('#type').onchange = render; $('#status-filter').onchange = render;
  $('#close-detail').onclick = () => $('#detail').close();
  themeButton(); render();
  if (preview) {
    const footer = $('.sidebar-footer'); footer.replaceChildren(element('span', 'Prévia online'), element('small', 'Armazenamento aguardando configuração'));
    $('#open').disabled = true; $('#open').textContent = 'Envio ainda não configurado';
    $('#refresh').disabled = true;
    $('#delete-old').disabled = true;
    $('#sync').textContent = 'Prévia · sem conexão ao armazenamento';
    showError('O painel foi publicado. Para receber e acompanhar relatos, falta conectar o armazenamento online e configurar o acesso.');
    return; // A prévia não inicia o widget nem faz requisições a uma API inexistente.
  }
  function start() {
    active = true;
    window.feedback = CentralBugs.init({ projectId: 'central-demo', endpoint: '/api/reports', ...(cloud ? {transport:'signed-upload'} : {}), successMessage: 'Relato salvo na Central! Ele aparecerá na caixa de entrada.' });
    $('#open').onclick = () => feedback.open(); refresh();
  }
  if (cloud) {
    $('.sidebar-footer').replaceChildren(element('span','Central online'),element('small','Relatos privados · Supabase'));
    CentralCloud.start(start,() => { active = false; loading = false; epoch++; fingerprint = ''; records = []; stats = []; projects=[]; for (const id of Object.keys(names)) if (!['central-demo','radar-contratual'].includes(id)) delete names[id]; selectedSystem = ''; $('#system-dialog').close(); $('#integration-dialog').close(); $('#delete-dialog').close(); $('#access-id').textContent=''; $('#integration-instructions').textContent=''; deletionRecords=[]; revision++; $('#delete-before').disabled=false; $('#delete-old').disabled=false; switchView('reports'); window.feedback?.destroy(); window.feedback = undefined; $('#detail').close(); render(); showError(''); });
  } else start();
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, cloud ? 15000 : 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
