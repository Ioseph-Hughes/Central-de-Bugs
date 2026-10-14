import pdfMake from 'pdfmake/build/pdfmake';
import fonts from 'pdfmake/build/vfs_fonts';
pdfMake.addVirtualFileSystem(fonts);

const date = value => value ? new Date(value).toLocaleString('pt-BR') : 'Não informado';
const heading = text => ({ text, fontSize: 14, bold: true, color: '#27634f', margin: [0, 18, 0, 8] });
const field = (label, value) => ({
  stack: [{ text: label, bold: true, color: '#687484', fontSize: 9, margin: [0, 0, 0, 3] }, { text: String(value ?? 'Não informado') }],
  margin: [0, 0, 0, 9]
});
function link(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return { text: value, link: url.href, color: '#27634f' };
  } catch {}
  return { text: value || 'Não informado' };
}
window.CentralReportPDF = async (item, labels, signal, progress) => {
  const report = item.report, context = report.context || {};
  const extraContext = Object.fromEntries(Object.entries(context).filter(([key]) => !['url', 'pageTitle', 'language', 'viewport'].includes(key)));
  const extra = Object.fromEntries(Object.entries(report).filter(([key]) => !['schemaVersion','id','projectId','type','title','description','links','createdAt','context','attachments','user'].includes(key)));
  const content = [
    { text: 'CENTRAL DE BUGS', color: '#27634f', bold: true, fontSize: 10, margin: [0, 0, 0, 12] },
    { text: report.title, bold: true, fontSize: 23, margin: [0, 0, 0, 18] },
    field('Tipo / status', `${labels.type} / ${labels.status}`),
    field('Empresa', labels.company), field('Sistema', `${labels.system} (${report.projectId})`),
    field('Enviado em', date(report.createdAt)), field('Recebido em', date(item.receivedAt)),
    ...(item.updatedAt ? [field('Status atualizado em', date(item.updatedAt))] : []),
    heading('Descrição completa'), { text: report.description },
    ...(item.recoveryNote ? [heading('Observação sobre recuperação'), { text: item.recoveryNote }] : []),
    heading('Links enviados'),
    ...(report.links.length ? report.links.map(url => ({ ...link(url), margin: [0, 0, 0, 5] })) : [{ text: 'Nenhum link informado.' }]),
    heading('Contexto do envio'), { text: 'Página de origem', bold: true, fontSize: 9 }, link(context.url),
    field('Título da página', context.pageTitle),
    field('Idioma', context.language),
    field('Dimensões da janela', context.viewport ? JSON.stringify(context.viewport) : 'Não informadas'),
    field('Usuário', report.user ? JSON.stringify(report.user) : 'Não identificado pelo sistema'),
    ...(Object.keys(extraContext).length ? [field('Contexto adicional', JSON.stringify(extraContext))] : []),
    field('Identificador da ocorrência', report.id), field('Identificador na Central', item.key),
    field('Versão do formato', report.schemaVersion),
    ...(Object.keys(extra).length ? [heading('Dados adicionais'), { text: JSON.stringify(extra, null, 2) }] : []),
    heading(`Anexos (${item.attachments.length})`),
    ...(item.attachments.length ? item.attachments.map(file => ({
      text: `${file.name} - ${file.type} - ${file.size.toLocaleString('pt-BR')} bytes\n${file.unavailable ? 'Indisponível: o arquivo original não foi preservado.' : file.type.startsWith('image/') ? 'Imagem incluída nas páginas seguintes.' : 'Arquivo original disponível para baixar separadamente na janela de geração.'}`,
      margin: [0, 0, 0, 10]
    })) : [{ text: 'Nenhum arquivo anexado.' }])
  ];
  for (const file of item.attachments.filter(file => file.type.startsWith('image/') && !file.unavailable)) {
    signal.throwIfAborted(); progress(`Incluindo imagem: ${file.name}`);
    const response = await fetch(file.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
    if (!response.ok) throw new Error(`Não foi possível carregar a imagem “${file.name}”. Tente gerar novamente.`);
    const url = URL.createObjectURL(await response.blob()), image = new Image();
    try {
      image.src = url; await image.decode(); signal.throwIfAborted();
      const landscape = image.naturalWidth / image.naturalHeight >= 1.3;
      const width = landscape ? 769 : 523, maxHeight = landscape ? 435 : 680;
      const maxSliceHeight = Math.max(1, Math.floor(maxHeight * image.naturalWidth / width));
      const parts = Math.ceil(image.naturalHeight / maxSliceHeight), sliceHeight = Math.ceil(image.naturalHeight / parts);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      for (let part = 0; part < parts; part++) {
        signal.throwIfAborted();
        canvas.height = Math.min(sliceHeight, image.naturalHeight - part * sliceHeight);
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.drawImage(image, 0, part * sliceHeight, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        content.push({
          pageBreak: 'before', pageOrientation: landscape ? 'landscape' : 'portrait',
          stack: [
            { text: `Imagem: ${file.name}`, bold: true, fontSize: 13, margin: [0, 0, 0, 6] },
            { text: parts > 1 ? `Parte ${part + 1} de ${parts}` : 'Imagem em tamanho ampliado', color: '#687484', fontSize: 9, margin: [0, 0, 0, 12] },
            { image: canvas.toDataURL('image/png'), width }
          ]
        });
      }
      canvas.width = canvas.height = 0;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`Não foi possível incluir a imagem “${file.name}”. Tente gerar novamente.`);
    } finally { URL.revokeObjectURL(url); }
  }
  signal.throwIfAborted(); progress('Finalizando o PDF…');
  const blob = await pdfMake.createPdf({
    info: { title: report.title, author: 'Central de Bugs' },
    pageSize: 'A4', pageMargins: [36, 36, 36, 42],
    defaultStyle: { font: 'Roboto', fontSize: 11, color: '#202936', lineHeight: 1.2 },
    footer: (page, total) => ({ text: `Central de Bugs | ${page} / ${total}`, alignment: 'center', color: '#687484', fontSize: 9, margin: [0, 12, 0, 0] }),
    content
  }).getBlob();
  signal.throwIfAborted(); return blob;
};
