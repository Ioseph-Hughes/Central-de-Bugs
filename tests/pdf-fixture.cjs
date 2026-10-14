// PDF de uma página, independente de bibliotecas e de documentos do usuário.
const stream = 'BT /F1 12 Tf 40 100 Td (Anexo de teste) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let source = '%PDF-1.4\n';
const offsets = objects.map((object, index) => {
  const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset;
});
const xref = source.length;
source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
module.exports = Buffer.from(source);
