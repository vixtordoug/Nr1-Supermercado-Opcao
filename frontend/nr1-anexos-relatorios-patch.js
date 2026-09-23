const fs = require('fs');
const path = '/home/supermercadoopcao/htdocs/supermercadoopcao.com.br/frontend/nr1.html';
const backup = `${path}.backup-${new Date().toISOString().replace(/[:.]/g,'-')}`;
let s = fs.readFileSync(path, 'utf8');
fs.copyFileSync(path, backup);

function once(from, to, label) {
  if (!s.includes(from)) throw new Error(`Trecho não encontrado: ${label}`);
  s = s.replace(from, to);
}

once(
  '<style id="anonymous-fields-default">',
  `<style id="attachments-and-print-style">\n.attachments-box{margin-top:12px;padding:12px;border:1px solid #e4e7eb;border-radius:10px;background:#fbfcfd}.attachments-box label{margin:0 0 7px}.attachments-box input[type=file]{padding:8px;background:#fff}.attachments-help{display:block;margin-top:5px;color:#7b838c;font-size:10px}.report-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.report-actions .mini{font-size:12px}\n@media print{body>*{display:none!important}#printReport{display:block!important;position:static!important}.no-print{display:none!important}}\n</style>\n<style id="anonymous-fields-default">`,
  'CSS de anexos e impressão'
);

once(
  "const api=async(url,opt={})=>{const r=await fetch(url,{...opt,cache:'no-store',headers:{'Content-Type':'application/json',...(opt.headers||{})}});",
  "const api=async(url,opt={})=>{const headers={...(opt.headers||{})};if(!(opt.body instanceof FormData)&&!headers['Content-Type'])headers['Content-Type']='application/json';const r=await fetch(url,{...opt,cache:'no-store',headers});",
  'função api'
);

once(
  '<textarea id="description" placeholder="O que aconteceu? Onde? Quando? Quem estava envolvido? Há testemunhas?" required></textarea></div>',
  '<textarea id="description" placeholder="O que aconteceu? Onde? Quando? Quem estava envolvido? Há testemunhas?" required></textarea><div class="attachments-box"><label for="reportAttachments">📎 Anexar imagens ou documentos</label><input id="reportAttachments" type="file" name="attachments" multiple accept="image/*,.pdf,.doc,.docx"><small class="attachments-help">Você pode selecionar mais de um arquivo.</small></div></div>',
  'campo de anexos da denúncia'
);

once(
  'anonymous,name,email\n   });',
  'anonymous,name,email,attachments:Array.from($(`${"#reportAttachments"}`).files||[])\n   });',
  'arquivos da denúncia'
);

once(
  "body:JSON.stringify({\n       type:data.type,\n       sector:data.sector,\n       occurrenceDate:data.occurrenceDate,\n       frequency:data.frequency,\n       description:data.description,\n       immediateMeasure:data.immediateMeasure,\n       anonymous:data.anonymous,\n       name:data.anonymous?'':data.name,\n       email:data.anonymous?'':data.email\n     })",
  "body:(()=>{const f=new FormData();f.append('type',data.type);f.append('sector',data.sector);f.append('occurrenceDate',data.occurrenceDate);f.append('frequency',data.frequency);f.append('description',data.description);f.append('immediateMeasure',data.immediateMeasure);f.append('anonymous',String(data.anonymous));f.append('name',data.anonymous?'':data.name);f.append('email',data.anonymous?'':data.email);(data.attachments||[]).forEach(x=>f.append('attachments',x));return f})()",
  'envio multipart da denúncia'
);

once(
  '<textarea id="publicChatInput" placeholder="Digite sua mensagem..." maxlength="2000" required></textarea><button class="btn" type="submit">Enviar</button>',
  '<textarea id="publicChatInput" placeholder="Digite sua mensagem..." maxlength="2000" required></textarea><label class="mini" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer">📎 Anexar<input id="publicChatAttachments" type="file" name="attachments" multiple accept="image/*,.pdf,.doc,.docx" style="display:none"></label><button class="btn" type="submit">Enviar</button>',
  'anexos do chat público'
);

once(
  '<textarea id="adminChatInput" placeholder="Digite uma resposta..." maxlength="2000" required></textarea><button class="btn" type="submit">Responder</button>',
  '<textarea id="adminChatInput" placeholder="Digite uma resposta..." maxlength="2000" required></textarea><label class="mini" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer">📎 Anexar<input id="adminChatAttachments" type="file" name="attachments" multiple accept="image/*,.pdf,.doc,.docx" style="display:none"></label><button class="btn" type="submit">Responder</button>',
  'anexos do chat interno'
);

once(
  "body:JSON.stringify({message:msg})});\n  input.value='';",
  "body:(()=>{const f=new FormData();f.append('message',msg);Array.from(document.getElementById('publicChatAttachments')?.files||[]).forEach(x=>f.append('attachments',x));return f})()});\n  input.value='';",
  'envio multipart do chat público'
);

once(
  "try{await api('/api/admin/reports/'+id+'/messages',{method:'POST',body:JSON.stringify({message:msg})});input.value='';",
  "try{await api('/api/admin/reports/'+id+'/messages',{method:'POST',body:(()=>{const f=new FormData();f.append('message',msg);Array.from(document.getElementById('adminChatAttachments')?.files||[]).forEach(x=>f.append('attachments',x));return f})()});input.value='';",
  'envio multipart do chat interno'
);

once(
  '<div class="top"><div><h2>Denúncia ${esc(r.protocol)}</h2><div class="user">${esc(r.type)} • ${esc(r.sector)}</div></div><button class="mini" onclick="closeModal()">Fechar</button></div>',
  '<div class="top"><div><h2>Denúncia ${esc(r.protocol)}</h2><div class="user">${esc(r.type)} • ${esc(r.sector)}</div></div><div class="report-actions"><button class="mini" type="button" onclick="printReport()">🖨️ Imprimir</button><button class="mini" type="button" onclick="printReport()">📄 Baixar PDF</button><button class="mini" onclick="closeModal()">Fechar</button></div></div>',
  'botões do relatório'
);

once(
  ' const r=detail;\n root.insertAdjacentHTML',
  ' const r=detail;\n window.__activeReportDetail=detail;\n root.insertAdjacentHTML',
  'dados ativos do relatório'
);

once(
  'function closeModal(){document.getElementById(\'modal\')?.remove()}',
  `function printReport(){
 const d=window.__activeReportDetail;if(!d)return;
 const w=window.open('','_blank','width=900,height=700');if(!w)return;
 const br=v=>esc(v||'Não informado').replace(/\\n/g,'<br>');
 w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório '+esc(d.protocol)+'</title><style>body{font-family:Arial,sans-serif;color:#20242a;padding:35px;line-height:1.5}h1{font-size:22px;border-bottom:2px solid #b9141b;padding-bottom:10px}h2{font-size:15px;margin-top:24px;color:#b9141b}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f6f7f8;padding:14px;border-radius:8px}.label{font-weight:bold}.text{white-space:normal;border:1px solid #e2e5e8;padding:12px;border-radius:8px}@media print{body{padding:0}}</style></head><body><h1>Relatório da denúncia — '+esc(d.protocol)+'</h1><div class="meta"><div><span class="label">Tipo:</span> '+br(d.type)+'</div><div><span class="label">Setor:</span> '+br(d.sector)+'</div><div><span class="label">Status:</span> '+br(d.status)+'</div><div><span class="label">Prioridade:</span> '+br(d.priority)+'</div><div><span class="label">Responsável:</span> '+br(d.responsible)+'</div><div><span class="label">Recebida em:</span> '+br(d.createdAt)+'</div></div><h2>Descrição</h2><div class="text">'+br(d.description)+'</div><h2>Como espera que a situação seja resolvida?</h2><div class="text">'+br(d.immediate_measure)+'</div><p style="margin-top:30px;color:#666;font-size:11px">Documento gerado pelo Canal de Denúncias NR1.</p></body></html>');w.document.close();w.focus();setTimeout(()=>w.print(),250);
}
function closeModal(){document.getElementById('modal')?.remove()}`,
  'funções de impressão e PDF'
);

fs.writeFileSync(path, s, 'utf8');
console.log(`Arquivo atualizado: ${path}`);
console.log(`Backup criado: ${backup}`);