/* Central de Bugs — widget independente, sem dependências. */
(() => {
  'use strict';
  const script = document.currentScript;
  const positions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const imageTypes = /^image\/(png|jpeg|webp|gif|avif)$/i;
  const style = `
    :host { all: initial; font: 14px/1.5 system-ui, sans-serif; color: #202624; }
    * { box-sizing: border-box; } [hidden] { display: none !important; }
    button, input, textarea, select { font: inherit; } button { cursor: pointer; }
    button:disabled { cursor: wait; opacity: .6; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid #ba5039; outline-offset: 3px; }
    .launcher { position: fixed; z-index: 2147483646; display: flex; padding: 5px; gap: 2px; background: #253a32; color: white; border-radius: 16px; box-shadow: 0 5px 24px #0003; user-select: none; }
    .launcher button { border: 0; color: inherit; background: transparent; padding: 10px 12px; border-radius: 10px; }
    .launcher button:hover { background: #ffffff18; } .grip { touch-action: none; cursor: grab; }
    .launch, .restore { touch-action: none; } .launcher .collapse { padding: 10px 8px; }
    .launcher .restore { display: none; } .launcher.collapsed { width: 40px; height: 52px; padding: 0; }
    .launcher.collapsed .grip, .launcher.collapsed .launch, .launcher.collapsed .collapse { display: none; }
    .launcher.collapsed .restore { display: grid; place-items: center; width: 100%; height: 100%; padding: 0; font-size: 22px; cursor: grab; }
    .launcher.collapsed[data-edge="left"] { border-radius: 0 12px 12px 0; }
    .launcher.collapsed[data-edge="right"] { border-radius: 12px 0 0 12px; }
    .launcher.collapsed[data-edge="top"], .launcher.collapsed[data-edge="bottom"] { width: 52px; height: 40px; }
    .launcher.collapsed[data-edge="top"] { border-radius: 0 0 12px 12px; }
    .launcher.collapsed[data-edge="bottom"] { border-radius: 12px 12px 0 0; }
    dialog { font: inherit; color: inherit; padding: 0; border: 1px solid #e2e5df; border-radius: 22px; width: min(540px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; background: #fffefa; box-shadow: 0 24px 100px #0003; }
    dialog::backdrop { background: #14251e66; }
    header { display: flex; align-items: flex-start; justify-content: space-between; padding: 26px 26px 16px; gap: 16px; }
    h2 { font-size: 22px; letter-spacing: -.5px; line-height: 1.2; margin: 5px 0 8px; } p { margin: 0; }
    .eyebrow { font-size: 10px; letter-spacing: 2px; color: #53695c; text-transform: uppercase; font-weight: 700; }
    .muted { color: #6a736d; font-size: 13px; } .icon { border: 0; background: #eef0e9; color: #263d31; border-radius: 50%; width: 34px; height: 34px; flex-shrink: 0; }
    .body { padding: 0 26px 26px; } .choices { display: grid; gap: 10px; margin: 12px 0 24px; }
    .choice { text-align: left; border: 1px solid #dce1d7; background: white; padding: 16px; border-radius: 12px; display: grid; grid-template-columns: 38px 1fr 15px; align-items: center; gap: 12px; color: inherit; }
    .choice:hover { border-color: #55745d; background: #f4f6ee; } .choice strong { display: block; }
    .badge { background: #f8ece6; color: #a74931; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; font-size: 20px; }
    label { display: block; font-weight: 600; margin: 18px 0 6px; } input, textarea, select { width: 100%; background: white; color: #202624; border: 1px solid #d9dfd5; border-radius: 9px; padding: 11px; }
    textarea { resize: vertical; min-height: 120px; } .links { min-height: 66px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .row label { margin: 0; }
    .secondary { border: 1px solid #d9dfd5; border-radius: 9px; padding: 9px 12px; color: #344d3d; background: white; }
    .primary { background: #2f4b3a; color: white; border: 0; padding: 12px 18px; border-radius: 10px; font-weight: 650; }
    .back { border: 0; color: #566d5b; background: none; padding: 0; margin: 0 0 6px; }
    .attachments { display: grid; gap: 8px; margin: 12px 0; }
    .attachment { display: flex; align-items: center; gap: 10px; background: #f1f3ec; border-radius: 9px; padding: 8px; }
    .attachment img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; } .attachment span { flex: 1; overflow-wrap: anywhere; font-size: 12px; }
    .attachment button { border: 0; background: transparent; color: #993d28; padding: 10px; }
    .status { font-size: 13px; margin: 14px 0; color: #8b3322; white-space: pre-wrap; overflow-wrap: anywhere; }
    .status.success { color: #326344; } footer { border-top: 1px solid #e4e7de; margin-top: 20px; padding-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    details { border-top: 1px solid #e4e7de; padding-top: 14px; } summary { cursor: pointer; color: #64725f; font-size: 12px; }
    .preferences { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; } .preferences > div { flex: 1; } .preferences label { font-size: 12px; }
    .crop-dialog { width: min(960px, calc(100vw - 24px)); }
    .crop-stage { position: relative; margin: 16px auto; touch-action: none; user-select: none; overflow: hidden; cursor: crosshair; background: #e4e7de; }
    .crop-stage canvas { display: block; width: 100%; height: auto; }
    .crop-selection { position: absolute; border: 2px solid #fff; outline: 1px solid #253a32; box-shadow: 0 0 0 2000px #14251e88; pointer-events: none; }
    .crop-fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .crop-fields label { font-size: 12px; } .crop-fields input { padding: 8px; }
    @media(max-width: 480px) { header { padding: 22px 20px 12px; } .body { padding: 0 20px 20px; } .launcher button { padding: 8px; } }
  `;

  function init(config = {}) {
    if (typeof config.projectId !== 'string' || !config.projectId.trim()) throw new Error('Informe projectId para identificar o SaaS.');
    if (config.endpoint) {
      const url = new URL(config.endpoint, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('O endpoint deve ser HTTP ou HTTPS.');
    }
    const storageKey = `central-bugs:${config.projectId}:preferences`;
    const initialPosition = positions.includes(config.position) ? config.position : 'bottom-right';
    let preferences = { position: initialPosition, hidden: false, edge: initialPosition.endsWith('right') ? 'right' : 'left', x: initialPosition.endsWith('right') ? 1 : 0, y: initialPosition.startsWith('bottom') ? 1 : 0 };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && positions.includes(saved.position)) preferences = {
        position: saved.position, hidden: saved.hidden === true,
        edge: ['left', 'right', 'top', 'bottom'].includes(saved.edge) ? saved.edge : saved.position.endsWith('right') ? 'right' : 'left',
        x: Number.isFinite(saved.x) ? Math.max(0, Math.min(1, saved.x)) : saved.position.endsWith('right') ? 1 : 0,
        y: Number.isFinite(saved.y) ? Math.max(0, Math.min(1, saved.y)) : saved.position.startsWith('bottom') ? 1 : 0
      };
    } catch { /* Preferências são opcionais em navegadores com armazenamento bloqueado. */ }
    const host = document.createElement('div');
    host.setAttribute('data-central-bugs', config.projectId);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${style}</style>
      <div class="launcher">
        <button class="grip" aria-label="Arrastar botão de feedback" title="Arraste para mover">⠿</button>
        <button class="launch" aria-haspopup="dialog">◎ &nbsp; Dar feedback</button>
        <button class="collapse" aria-label="Recolher botão de feedback" title="Recolher na borda">‹</button>
        <button class="restore" aria-label="Mostrar botão de feedback" title="Clique para expandir; arraste para mover">←</button>
      </div>
      <dialog aria-labelledby="cb-title" aria-describedby="cb-description">
        <header><div><p class="eyebrow">Central de Bugs</p><h2 id="cb-title">Seu feedback faz diferença.</h2><p class="muted" id="cb-description">Conte o que aconteceu ou o que podemos melhorar.</p></div><button class="icon close" aria-label="Fechar">×</button></header>
        <div class="body">
          <div class="choices">
            <button class="choice" data-type="bug"><span class="badge">⌁</span><span><strong>Relatar um bug</strong><span class="muted">Algo não funcionou como esperado.</span></span><span>›</span></button>
            <button class="choice" data-type="melhoria"><span class="badge">✧</span><span><strong>Sugerir uma melhoria</strong><span class="muted">Uma ideia para deixar tudo melhor.</span></span><span>›</span></button>
            <button class="choice" data-type="ajuste"><span class="badge">↗</span><span><strong>Pedir um ajuste</strong><span class="muted">Um detalhe que merece atenção.</span></span><span>›</span></button>
          </div>
          <form hidden>
            <fieldset style="border:0;padding:0;margin:0;min-width:0">
              <button type="button" class="back">← Alterar tipo de relato</button>
              <label for="cb-summary">Título</label><input id="cb-summary" name="title" placeholder="Resuma o que você quer nos contar" required>
              <label for="cb-text">O que aconteceu?</label><textarea id="cb-text" name="description" placeholder="Descreva o problema, o que você esperava ou sua ideia…" required></textarea>
              <label for="cb-links">Links <span class="muted">· opcional</span></label><textarea id="cb-links" name="links" class="links" placeholder="Um link por linha"></textarea>
              <label>Imagens <span class="muted">· opcional</span></label>
              <div class="row"><button type="button" class="secondary upload">＋ Adicionar imagens</button></div>
              <div class="row" style="margin-top:8px"><button type="button" class="secondary capture-area">✂ Selecionar área</button><button type="button" class="secondary capture">▣ Tela inteira</button></div>
              <input class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden aria-label="Selecionar imagens">
              <p class="muted" style="margin-top:8px">Você também pode colar um print neste formulário.</p>
              <div class="attachments" aria-label="Imagens anexadas"></div>
              <footer><span class="muted">Revise antes de enviar.</span><button type="submit" class="primary submit">Enviar relato ↗</button></footer>
            </fieldset>
          </form>
          <p class="status" role="status" aria-live="polite"></p>
          <details><summary>Posição e visibilidade do botão</summary><div class="preferences"><div><label for="cb-position">Posição</label><select id="cb-position"><option value="bottom-right">Embaixo à direita</option><option value="bottom-left">Embaixo à esquerda</option><option value="top-right">Em cima à direita</option><option value="top-left">Em cima à esquerda</option></select></div><button type="button" class="secondary hide">Recolher na borda</button></div><p class="muted" style="margin-top:10px">Arraste para a borda para recolher. Clique na seta para expandir ou arraste a seta para movê-la.</p></details>
        </div>
      </dialog>`;
    (document.body || document.documentElement).append(host);
    const $ = selector => root.querySelector(selector);
    const launcher = $('.launcher'), dialog = $('dialog'), form = $('form'), status = $('.status');
    const cleanup = new AbortController();
    let type = 'bug', attachments = [], busy = false, capturing = false, destroyed = false;
    let draftId = crypto.randomUUID(), submittedDraft;
    let activeStream, pendingRequest, returnFocus;

    function message(text = '', success = false) { status.textContent = text; status.classList.toggle('success', success); }
    function savePreferences() { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Opcional. */ } }
    const clamp = value => Math.max(0, Math.min(1, value));
    const viewport = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
    function placeLauncher() {
      launcher.classList.toggle('collapsed', preferences.hidden);
      launcher.dataset.edge = preferences.edge;
      $('.restore').textContent = { left: '→', right: '←', top: '↓', bottom: '↑' }[preferences.edge];
      const margin = preferences.hidden ? 0 : 20;
      const size = viewport();
      const width = Math.max(0, size.width - launcher.offsetWidth), height = Math.max(0, size.height - launcher.offsetHeight);
      let left = Math.min(margin, width) + preferences.x * Math.max(0, width - margin * 2);
      let top = Math.min(margin, height) + preferences.y * Math.max(0, height - margin * 2);
      if (preferences.hidden) {
        if (preferences.edge === 'left') { left = 0; preferences.x = 0; }
        if (preferences.edge === 'right') { left = width; preferences.x = 1; }
        if (preferences.edge === 'top') { top = 0; preferences.y = 0; }
        if (preferences.edge === 'bottom') { top = height; preferences.y = 1; }
      }
      preferences.position = `${preferences.y < .5 ? 'top' : 'bottom'}-${preferences.x < .5 ? 'left' : 'right'}`;
      Object.assign(launcher.style, { right: 'auto', bottom: 'auto', left: `${left}px`, top: `${top}px` });
      $('#cb-position').value = preferences.position;
    }
    function nearestEdge(rect) {
      const size = viewport();
      return Object.entries({ left: rect.left, right: size.width - rect.right, top: rect.top, bottom: size.height - rect.bottom }).sort((a, b) => a[1] - b[1])[0];
    }
    function setPosition(position) {
      if (!positions.includes(position)) throw new Error('Posição inválida.');
      Object.assign(preferences, { position, edge: position.endsWith('right') ? 'right' : 'left', x: position.endsWith('right') ? 1 : 0, y: position.startsWith('bottom') ? 1 : 0 });
      placeLauncher(); savePreferences();
    }
    function open() {
      if (destroyed || capturing || dialog.open) return;
      returnFocus = document.activeElement;
      dialog.showModal();
    }
    function close() {
      dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    }
    function hide() { preferences.edge = nearestEdge(launcher.getBoundingClientRect())[0]; preferences.hidden = true; placeLauncher(); close(); savePreferences(); $('.restore').focus(); }
    function show() { preferences.hidden = false; placeLauncher(); savePreferences(); }
    function on(target, event, fn) { target.addEventListener(event, fn, { signal: cleanup.signal }); }
    function renderAttachments() {
      $('.attachments').replaceChildren();
      attachments.forEach((item, index) => {
        const row = document.createElement('div'); row.className = 'attachment';
        const img = document.createElement('img'); img.src = item.url; img.alt = '';
        const name = document.createElement('span'); name.textContent = item.file.name;
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remover ${item.file.name}`);
        remove.onclick = () => { if (busy || capturing) return; URL.revokeObjectURL(item.url); attachments.splice(index, 1); renderAttachments(); };
        row.append(img, name, remove); $('.attachments').append(row);
      });
    }
    function addFiles(files) {
      if (busy || destroyed) return;
      let rejected = false;
      for (const file of files) {
        if (!imageTypes.test(file.type)) { rejected = true; continue; }
        attachments.push({ file, url: URL.createObjectURL(file) });
      }
      renderAttachments(); message(rejected ? 'Use imagens PNG, JPEG, WebP, GIF ou AVIF.' : '');
    }
    function clearDraft() {
      for (const item of attachments) URL.revokeObjectURL(item.url);
      attachments = []; form.reset(); renderAttachments(); draftId = crypto.randomUUID(); submittedDraft = undefined;
    }
    function choose(nextType) {
      type = nextType; $('.choices').hidden = true; form.hidden = false;
      $('#cb-title').textContent = { bug: 'Vamos resolver esse bug.', melhoria: 'Qual é a sua ideia?', ajuste: 'Qual detalhe podemos ajustar?' }[type];
      $('#cb-text').previousElementSibling.textContent = type === 'bug' ? 'O que aconteceu?' : 'Conte mais sobre sua sugestão';
      message(); $('#cb-summary').focus();
    }
    let suppressClick = false;
    function draggedClick(event) { const skip = suppressClick && event.detail > 0; suppressClick = false; return skip; }
    on($('.launch'), 'click', event => { if (!draggedClick(event)) open(); });
    on($('.restore'), 'click', event => { if (draggedClick(event)) return; show(); $('.launch').focus(); });
    on($('.collapse'), 'click', hide); on($('.close'), 'click', close); on($('.hide'), 'click', hide);
    on($('#cb-position'), 'change', event => setPosition(event.target.value));
    root.querySelectorAll('[data-type]').forEach(button => on(button, 'click', () => choose(button.dataset.type)));
    on($('.back'), 'click', () => { form.hidden = true; $('.choices').hidden = false; $('#cb-title').textContent = 'Seu feedback faz diferença.'; message(); $('[data-type]').focus(); });
    on($('.upload'), 'click', () => $('.file-input').click());
    on($('.file-input'), 'change', event => { addFiles(event.target.files); event.target.value = ''; });
    on(form, 'paste', event => {
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); addFiles(files); }
    });

    function selectArea(canvas) {
      return new Promise(resolve => {
        const crop = document.createElement('dialog'); crop.className = 'crop-dialog';
        crop.setAttribute('aria-labelledby', 'cb-crop-title');
        crop.setAttribute('aria-describedby', 'cb-crop-help');
        crop.innerHTML = `<header><div><p class="eyebrow">Captura de tela</p><h2 id="cb-crop-title">Selecione a área do erro</h2><p class="muted" id="cb-crop-help">Arraste sobre a imagem para recortar. Para usar o teclado, ajuste as medidas abaixo, em pixels.</p></div><button type="button" class="icon crop-close" aria-label="Cancelar recorte">×</button></header>
          <div class="body"><div class="crop-stage"><div class="crop-selection" hidden></div></div>
            <p class="muted crop-info" role="status" aria-live="polite">Nenhuma área selecionada.</p>
            <details><summary>Ajustar recorte por medidas</summary><div class="crop-fields">
              <div><label for="cb-crop-x">Esquerda (px)</label><input id="cb-crop-x" type="number" min="0" step="1" value="0"></div>
              <div><label for="cb-crop-y">Topo (px)</label><input id="cb-crop-y" type="number" min="0" step="1" value="0"></div>
              <div><label for="cb-crop-width">Largura (px)</label><input id="cb-crop-width" type="number" min="1" step="1" value="${canvas.width}"></div>
              <div><label for="cb-crop-height">Altura (px)</label><input id="cb-crop-height" type="number" min="1" step="1" value="${canvas.height}"></div>
            </div></details>
            <footer><button type="button" class="secondary crop-cancel">Cancelar</button><button type="button" class="primary crop-confirm" disabled>Anexar recorte</button></footer>
          </div>`;
        const stage = crop.querySelector('.crop-stage'), selection = crop.querySelector('.crop-selection');
        const fields = ['x', 'y', 'width', 'height'].map(name => crop.querySelector(`#cb-crop-${name}`));
        stage.style.width = `min(100%, ${canvas.width}px, ${48 * canvas.width / canvas.height}dvh)`;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Prévia da tela capturada para selecionar a região do erro');
        stage.prepend(canvas); root.append(crop);
        let rect, drag;
        const listeners = new AbortController();
        const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: listeners.signal });
        const bounded = (value, max) => Math.max(0, Math.min(max, Math.round(value)));
        function render(announce = true) {
          selection.hidden = !rect || !rect.width || !rect.height;
          crop.querySelector('.crop-confirm').disabled = selection.hidden;
          if (!rect) { crop.querySelector('.crop-info').textContent = 'Nenhuma área selecionada.'; return; }
          Object.assign(selection.style, { left: `${rect.x / canvas.width * 100}%`, top: `${rect.y / canvas.height * 100}%`, width: `${rect.width / canvas.width * 100}%`, height: `${rect.height / canvas.height * 100}%` });
          [rect.x, rect.y, rect.width, rect.height].forEach((value, i) => { fields[i].value = value; });
          fields[0].max = canvas.width - 1; fields[1].max = canvas.height - 1;
          fields[2].max = canvas.width - rect.x; fields[3].max = canvas.height - rect.y;
          if (announce) crop.querySelector('.crop-info').textContent = selection.hidden ? 'Selecione uma área com largura e altura.' : `Área selecionada: ${rect.width} × ${rect.height} px. Somente este recorte será anexado.`;
        }
        function point(event) {
          const bounds = canvas.getBoundingClientRect();
          return { x: bounded((event.clientX - bounds.left) / bounds.width * canvas.width, canvas.width), y: bounded((event.clientY - bounds.top) / bounds.height * canvas.height, canvas.height) };
        }
        function move(event, announce) {
          if (!drag || event.pointerId !== drag.id) return;
          const end = point(event);
          rect = { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y) };
          render(announce);
        }
        function finish(result) {
          cleanup.signal.removeEventListener('abort', cancel);
          listeners.abort(); crop.close(); crop.remove(); resolve(result);
        }
        const cancel = () => finish(null);
        listen(stage, 'pointerdown', event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault(); drag = { ...point(event), id: event.pointerId, previous: rect };
          stage.setPointerCapture(event.pointerId); move(event, false);
        });
        listen(stage, 'pointermove', event => move(event, false));
        listen(stage, 'pointerup', event => {
          if (!drag || event.pointerId !== drag.id) return;
          move(event, true); drag = undefined; stage.releasePointerCapture(event.pointerId);
        });
        listen(stage, 'pointercancel', () => { rect = drag?.previous; drag = undefined; render(); });
        fields.forEach(field => listen(field, 'change', () => {
          const values = fields.map(input => Number(input.value));
          if (fields.some(input => input.value === '') || !values.every(Number.isFinite)) return;
          const x = bounded(values[0], canvas.width - 1), y = bounded(values[1], canvas.height - 1);
          rect = { x, y, width: Math.max(1, bounded(values[2], canvas.width - x)), height: Math.max(1, bounded(values[3], canvas.height - y)) }; render();
        }));
        listen(crop, 'cancel', event => { event.preventDefault(); cancel(); });
        listen(crop.querySelector('.crop-close'), 'click', cancel);
        listen(crop.querySelector('.crop-cancel'), 'click', cancel);
        listen(crop.querySelector('.crop-confirm'), 'click', () => { if (rect?.width && rect?.height) finish(rect); });
        cleanup.signal.addEventListener('abort', cancel, { once: true });
        crop.showModal();
      });
    }

    async function capture(area) {
      if (capturing || busy) return;
      if (!navigator.mediaDevices?.getDisplayMedia) { message('Este navegador não oferece captura de tela. Adicione ou cole um print.'); return; }
      capturing = true; $('fieldset').disabled = true; message();
      const wasOpen = dialog.open; dialog.close(); host.style.visibility = 'hidden';
      try {
        activeStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true });
        if (destroyed) return;
        const video = document.createElement('video'); video.muted = true; video.srcObject = activeStream;
        await video.play();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('capture-timeout')), 10000);
          const finish = () => { clearTimeout(timeout); resolve(); };
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(finish); else setTimeout(finish, 250);
        });
        if (destroyed) return;
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) throw new Error('empty-frame');
        canvas.getContext('2d').drawImage(video, 0, 0);
        activeStream.getTracks().forEach(track => track.stop()); activeStream = undefined; video.srcObject = null;
        let image = canvas;
        if (area) {
          host.style.visibility = '';
          const rect = await selectArea(canvas);
          if (!rect || destroyed) { if (!destroyed) message('Recorte cancelado. Seu relato e os anexos foram mantidos.'); return; }
          image = document.createElement('canvas'); image.width = rect.width; image.height = rect.height;
          image.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        }
        const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('empty-blob');
        addFiles([new File([blob], `${area ? 'recorte' : 'captura'}-${Date.now()}.png`, { type: 'image/png' })]);
      } catch (error) {
        if (!destroyed) message(error.name === 'NotAllowedError' ? 'Captura cancelada. Você pode tentar novamente ou anexar um print.' : 'Não foi possível capturar a tela. Adicione ou cole um print.');
      } finally {
        activeStream?.getTracks().forEach(track => track.stop()); activeStream = undefined;
        capturing = false; $('fieldset').disabled = false; host.style.visibility = '';
        if (!destroyed && wasOpen) { dialog.showModal(); $(area ? '.capture-area' : '.capture').focus(); }
      }
    }
    on($('.capture-area'), 'click', () => capture(true));
    on($('.capture'), 'click', () => capture(false));

    on(form, 'submit', async event => {
      event.preventDefault(); if (busy || capturing) return;
      const title = form.elements.title.value, description = form.elements.description.value;
      if (!title.trim() || !description.trim()) { message('Preencha o título e a descrição.'); return; }
      const links = form.elements.links.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      try { for (const link of links) if (!['https:', 'http:'].includes(new URL(link).protocol)) throw new Error(); }
      catch { message('Confira os links: use URLs completas começando com https:// ou http://.'); return; }
      if (!config.endpoint && typeof config.onSubmit !== 'function') { message('O envio ainda não está configurado. Seu relato continua aqui.'); return; }
      const signature = JSON.stringify({ type, title, description, links, user: config.user });
      const files = attachments.map(item => item.file);
      const unchanged = submittedDraft && submittedDraft.signature === signature && submittedDraft.files.length === files.length && files.every((file,index) => file === submittedDraft.files[index]);
      if (submittedDraft && !unchanged) draftId = crypto.randomUUID();
      const report = unchanged ? submittedDraft.report : {
        schemaVersion: 1, id: draftId, projectId: config.projectId, type, title, description, links,
        createdAt: new Date().toISOString(),
        context: { url: location.href, pageTitle: document.title, language: navigator.language, viewport: { width: innerWidth, height: innerHeight } },
        ...(config.user ? { user: config.user } : {}),
        attachments: attachments.map(({ file }) => ({ name: file.name, type: file.type, size: file.size }))
      };
      submittedDraft = { signature, files, report };
      busy = true; $('fieldset').disabled = true; $('.submit').textContent = 'Enviando…'; message();
      let timeout;
      try {
        pendingRequest = new AbortController();
        async function accessHeaders() {
          if (config.refreshAccess) config.token = (await config.refreshAccess(pendingRequest.signal)).token;
          return config.token ? {Authorization:`Bearer ${config.token}`} : {};
        }
        if (typeof config.onSubmit === 'function') await config.onSubmit({ report, files: attachments.map(item => item.file) });
        else if (config.transport === 'signed-upload') {
          async function requestJSON(value) {
            const headers=await accessHeaders();
            const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json',...headers }, body: JSON.stringify(value), signal: AbortSignal.any([pendingRequest.signal, AbortSignal.timeout(30000)]) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
            return payload;
          }
          const prepared = await requestJSON({ action: 'prepare', report });
          if (!prepared.ready) {
            if (!Array.isArray(prepared.uploads) || prepared.uploads.length !== files.length) throw new Error('A Central retornou uma preparação de envio inválida.');
            for (const [index,slot] of prepared.uploads.entries()) {
              if (slot.uploaded) continue;
              const url = new URL(slot.url);
              if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Endereço de upload inválido.');
              const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': files[index].type, 'x-upsert': 'false' }, body: files[index], signal: AbortSignal.any([pendingRequest.signal, AbortSignal.timeout(120000)]) });
              if (!response.ok) throw new Error(`Não foi possível enviar a imagem ${index + 1}. Tente novamente.`);
            }
            await requestJSON({ action: 'commit', key: prepared.key, receipt: prepared.receipt });
          }
        }
        else {
          const body = new FormData(); body.append('report', JSON.stringify(report));
          attachments.forEach(({ file }) => body.append('attachments', file, file.name));
          const headers=await accessHeaders(); timeout = setTimeout(() => pendingRequest?.abort(), 30000);
          const response = await fetch(config.endpoint, { method: 'POST', body, headers, signal: pendingRequest.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }
        if (!destroyed) { clearDraft(); message(config.successMessage || 'Relato enviado. Obrigado por ajudar a melhorar o sistema!', true); }
      } catch (error) {
        if (!destroyed) message(`${config.transport === 'signed-upload' && error.name === 'Error' ? error.message + '\n' : ''}Não foi possível enviar. Seu texto e suas imagens foram preservados. Tente novamente.`);
      } finally {
        clearTimeout(timeout); pendingRequest = undefined; busy = false; $('fieldset').disabled = false; $('.submit').textContent = 'Enviar relato ↗';
      }
    });

    let drag;
    for (const handle of [$('.grip'), $('.launch'), $('.restore')]) {
      on(handle, 'pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        suppressClick = false;
        const rect = launcher.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
        handle.setPointerCapture(event.pointerId);
      });
      on(handle, 'pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6 && !drag.moved) return;
        drag.moved = true;
        const size = viewport();
        Object.assign(launcher.style, { left: `${Math.max(0, Math.min(size.width - launcher.offsetWidth, event.clientX - drag.x))}px`, top: `${Math.max(0, Math.min(size.height - launcher.offsetHeight, event.clientY - drag.y))}px` });
      });
      on(handle, 'pointerup', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const moved = drag.moved; drag = undefined;
        if (!moved) return;
        suppressClick = true;
        const rect = launcher.getBoundingClientRect(), [edge, distance] = nearestEdge(rect);
        preferences.edge = edge;
        preferences.hidden = preferences.hidden || distance <= 32;
        const margin = preferences.hidden ? 0 : 20;
        const size = viewport();
        preferences.x = clamp((rect.left - margin) / Math.max(1, size.width - rect.width - margin * 2));
        preferences.y = clamp((rect.top - margin) / Math.max(1, size.height - rect.height - margin * 2));
        preferences.position = `${preferences.y < .5 ? 'top' : 'bottom'}-${preferences.x < .5 ? 'left' : 'right'}`;
        placeLauncher(); savePreferences();
      });
      on(handle, 'pointercancel', () => { drag = undefined; suppressClick = false; placeLauncher(); });
    }
    on(window, 'resize', () => { drag = undefined; placeLauncher(); });
    placeLauncher();
    return {
      open, close, hide, show, setPosition,
      destroy() { destroyed = true; cleanup.abort(); pendingRequest?.abort(); activeStream?.getTracks().forEach(track => track.stop()); clearDraft(); dialog.close(); host.remove(); }
    };
  }
  async function connect(config = {}) {
    if (typeof config.accessEndpoint!=='string' || !config.accessEndpoint.trim()) throw new Error('Informe o endpoint de acesso do SaaS.');
    const endpoint=new URL(config.accessEndpoint,location.href);
    if (endpoint.origin!==location.origin) throw new Error('O endpoint de acesso deve pertencer ao próprio SaaS.');
    let instance;
    async function requestAccess(signal) {
      const headers=typeof config.accessHeaders==='function' ? await config.accessHeaders() : config.accessHeaders;
      const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:headers || {},signal:AbortSignal.any([...(signal?[signal]:[]),...(config.signal?[config.signal]:[]),AbortSignal.timeout(15000)])});
      if ([401,403,204].includes(response.status)) { instance?.destroy(); return null; }
      if (!response.ok) throw new Error('Não foi possível autorizar o plugin. Confira a integração do sistema.');
      const access=await response.json();
      if (!access.projectId || !access.token || !access.user?.email || !access.endpoint) throw new Error('Configuração de acesso inválida.');
      return access;
    }
    const access=await requestAccess(config.signal);
    if (!access || config.signal?.aborted) return null;
    instance=init({...access,position:config.position,successMessage:config.successMessage,
      async refreshAccess(signal) {
        const next=await requestAccess(signal);
        if (!next || next.projectId!==access.projectId || next.user.email!==access.user.email || next.endpoint!==access.endpoint || next.transport!==access.transport) {
          instance.destroy(); throw new Error('Sua conta mudou ou perdeu o acesso ao plugin. Entre novamente.');
        }
        return next;
      }});
    config.signal?.addEventListener('abort',()=>instance.destroy(),{once:true});
    return instance;
  }
  window.CentralBugs = { init, connect };
  if (script?.dataset.projectId) {
    const start = () => { window.CentralBugs.instance = init({ projectId: script.dataset.projectId, endpoint: script.dataset.endpoint, position: script.dataset.position, transport: script.dataset.transport }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
