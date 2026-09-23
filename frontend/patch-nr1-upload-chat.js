const fs = require('fs');
const path = require('path');

const dir = __dirname;
const file = path.join(dir, 'nr1.html');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${file}.bak-before-upload-${stamp}`;

if (!fs.existsSync(file)) {
  console.error('ERRO: nr1.html nao foi encontrado na mesma pasta deste script.');
  process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');
fs.copyFileSync(file, backup);
console.log(`Backup criado: ${path.basename(backup)}`);

let changes = [];

function replaceOnce(label, regex, replacement) {
  const before = html;
  html = html.replace(regex, replacement);
  if (html !== before) changes.push(label);
}

// Permite JSON normalmente e FormData quando houver anexos.
replaceOnce(
  'helper api para aceitar FormData',
  /const api=async\(url,opt=\{\}\)=>\{[\s\S]*?\};/,
  "const api=async(url,opt={})=>{const headers={...(opt.headers||{})};if(!(opt.body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(url,{...opt,cache:'no-store',headers});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Erro na operacao');return d};"
);

// Campo de anexos da nova denuncia.
if (!html.includes('id="reportAttachments"')) {
  replaceOnce(
    'campo de anexos da nova denuncia',
    /(<div id="identityNotice">)/,
    '<div class="full"><label>Anexos (opcional)</label><input id="reportAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style="width:100%;border:1px solid #dfe2e7;border-radius:9px;padding:10px;background:#fbfcfd"><div class="small">Voce pode selecionar mais de um arquivo.</div></div>$1'
  );
}

// Campo de anexos do chat publico.
if (!html.includes('id="publicChatAttachments"')) {
  replaceOnce(
    'campo de anexos do chat publico',
    /(<textarea id="publicChatInput"[\s\S]*?<\/textarea>)(<button[^>]*>Enviar<\/button>)/,
    '$1<input id="publicChatAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style="max-width:220px;border:1px solid #dfe2e7;border-radius:9px;padding:8px;background:#fbfcfd">$2'
  );
}

// Campo de anexos do chat administrativo.
if (!html.includes('id="adminChatAttachments"')) {
  replaceOnce(
    'campo de anexos do chat administrativo',
    /(<textarea id="adminChatInput"[\s\S]*?<\/textarea>)(<button[^>]*>Responder<\/button>)/,
    '$1<input id="adminChatAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style="max-width:220px;border:1px solid #dfe2e7;border-radius:9px;padding:8px;background:#fbfcfd">$2'
  );
}

// Nova denuncia: substitui o envio JSON por FormData.
replaceOnce(
  'envio da nova denuncia com FormData',
  /const d=await api\('\/api\/reports',[\s\S]*?\);/,
  "const body=new FormData();Object.entries(data).forEach(([key,value])=>{if(value!==undefined&&value!==null)body.append(key,String(value));});const reportFiles=document.getElementById('reportAttachments')?.files||[];Array.from(reportFiles).forEach(file=>body.append('attachments',file));const d=await api('/api/reports',{method:'POST',body});"
);

// Chat publico: substitui o envio JSON por FormData.
replaceOnce(
  'envio do chat publico com FormData',
  /const result=await api\('\/api\/public\/protocol\/'\+encodeURIComponent\(protocol\)\+'\/messages',[\s\S]*?\);/,
  "const body=new FormData();body.append('message',msg);const files=document.getElementById('publicChatAttachments')?.files||[];Array.from(files).forEach(file=>body.append('attachments',file));const result=await api('/api/public/protocol/'+encodeURIComponent(protocol)+'/messages',{method:'POST',headers:{'X-Protocol-Key':protocolKey},body});"
);

// Chat administrativo: substitui o envio JSON por FormData.
replaceOnce(
  'envio do chat administrativo com FormData',
  /await api\('\/api\/admin\/reports\/'\+id\+'\/messages',[\s\S]*?\);/,
  "const body=new FormData();body.append('message',msg);const files=document.getElementById('adminChatAttachments')?.files||[];Array.from(files).forEach(file=>body.append('attachments',file));await api('/api/admin/reports/'+id+'/messages',{method:'POST',body});"
);

const required = [
  'helper api para aceitar FormData',
  'campo de anexos da nova denuncia',
  'campo de anexos do chat publico',
  'campo de anexos do chat administrativo',
  'envio da nova denuncia com FormData',
  'envio do chat publico com FormData',
  'envio do chat administrativo com FormData'
];
const missing = required.filter(item => !changes.includes(item));

if (missing.length) {
  fs.copyFileSync(backup, file);
  console.error('NENHUMA alteracao foi mantida porque estes trechos nao foram encontrados:');
  missing.forEach(item => console.error(`- ${item}`));
  console.error(`O arquivo original foi restaurado. Backup: ${path.basename(backup)}`);
  process.exit(2);
}

fs.writeFileSync(file, html, 'utf8');
console.log('Correcao aplicada com sucesso.');
console.log('Alteracoes:');
changes.forEach(item => console.log(`- ${item}`));
console.log(`Backup preservado em: ${path.basename(backup)}`);
console.log('Agora abra o site e pressione Ctrl+F5.');