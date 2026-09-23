const fs=require('fs');
const path='/home/supermercadoopcao/htdocs/supermercadoopcao.com.br/frontend/nr1.html';
const backup=`${path}.backup-${new Date().toISOString().replace(/[:.]/g,'-')}`;
let s=fs.readFileSync(path,'utf8');
fs.copyFileSync(path,backup);
function must(repl,label){const before=s;s=repl(before);if(s===before)throw new Error('Não foi possível localizar: '+label)}

must(x=>x.replace('</head>',`<style id="attachments-print-v2">
.attachments-box{margin:14px 0;padding:12px;border:1px solid #e4e7eb;border-radius:10px;background:#fbfcfd}.attachments-box label{margin:0 0 7px}.attachments-box input{background:#fff}.attachments-help{display:block;color:#7b838c;font-size:10px;margin-top:5px}.report-actions{display:flex;gap:8px;flex-wrap:wrap}.report-actions button{white-space:nowrap}@media print{body>*{display:none!important}#printReport{display:block!important;position:static!important}}
</style></head>`),'CSS de anexos e impressão');

must(x=>x.replace('<div id="identityNotice"></div>',`<div class="full attachments-box"><label for="reportAttachments">📎 Anexar imagens ou documentos</label><input id="reportAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx"><small class="attachments-help">Selecione um ou mais arquivos para enviar junto da denúncia.</small></div><div id="identityNotice"></div>`),'campo de anexos da denúncia');

must(x=>x.replace("headers:{'Content-Type':'application/json',...(opt.headers||{})}","headers:{...(!(opt.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}"),'envio FormData');

must(x=>x.replace(/anonymous,name,email\n\s*\}\);/,"anonymous,name,email,attachments:Array.from(document.getElementById('reportAttachments')?.files||[])\n });"),'arquivos no submitReport');

must(x=>x.replace(`body:JSON.stringify({
       type:data.type,
       sector:data.sector,
       occurrenceDate:data.occurrenceDate,
       frequency:data.frequency,
       description:data.description,
       immediateMeasure:data.immediateMeasure,
       anonymous:data.anonymous,
       name:data.anonymous?'':data.name,
       email:data.anonymous?'':data.email
     })`,`body:(()=>{const f=new FormData();f.append('type',data.type);f.append('sector',data.sector);f.append('occurrenceDate',data.occurrenceDate);f.append('frequency',data.frequency);f.append('description',data.description);f.append('immediateMeasure',data.immediateMeasure);f.append('anonymous',String(data.anonymous));f.append('name',data.anonymous?'':data.name);f.append('email',data.anonymous?'':data.email);(data.attachments||[]).forEach(file=>f.append('attachments',file));return f})()`),'FormData da denúncia');

must(x=>x.replace('<textarea id="publicChatInput" placeholder="Digite sua mensagem..." maxlength="2000" required></textarea><button class="btn" type="submit">Enviar</button>','<textarea id="publicChatInput" placeholder="Digite sua mensagem..." maxlength="2000" required></textarea><label class="mini" style="cursor:pointer">📎 Anexar<input id="publicChatAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx" style="display:none"></label><button class="btn" type="submit">Enviar</button>'),'anexo do chat público');

must(x=>x.replace('<textarea id="adminChatInput" placeholder="Digite uma resposta..." maxlength="2000" required></textarea><button class="btn" type="submit">Responder</button>','<textarea id="adminChatInput" placeholder="Digite uma resposta..." maxlength="2000" required></textarea><label class="mini" style="cursor:pointer">📎 Anexar<input id="adminChatAttachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx" style="display:none"></label><button class="btn" type="submit">Responder</button>'),'anexo do chat interno');

must(x=>x.replace("body:JSON.stringify({message:msg})","body:(()=>{const f=new FormData();f.append('message',msg);Array.from(document.getElementById('publicChatAttachments')?.files||[]).forEach(file=>f.append('attachments',file));return f})()"),'FormData do chat público');
must(x=>x.replace("body:JSON.stringify({message:msg})","body:(()=>{const f=new FormData();f.append('message',msg);Array.from(document.getElementById('adminChatAttachments')?.files||[]).forEach(file=>f.append('attachments',file));return f})()"),'FormData do chat interno');

must(x=>x.replace('<div class="top"><div><h2>Denúncia ${esc(r.protocol)}</h2><div class="user">${esc(r.type)} • ${esc(r.sector)}</div></div><button class="mini" onclick="closeModal()">Fechar</button></div>','<div class="top"><div><h2>Denúncia ${esc(r.protocol)}</h2><div class="user">${esc(r.type)} • ${esc(r.sector)}</div></div><div class="report-actions"><button class="mini" type="button" onclick="printReport()">🖨️ Imprimir</button><button class="mini" type="button" onclick="printReport()">📄 Baixar PDF</button><button class="mini" onclick="closeModal()">Fechar</button></div></div>'),'botões do modal');

must(x=>x.replace(' const r=detail;\n root.insertAdjacentHTML',' const r=detail;\n window.__activeReportDetail=detail;\n root.insertAdjacentHTML'),'dados do relatório ativo');

must(x=>x.replace("function closeModal(){document.getElementById('modal')?.remove()}",`function printReport(){
 const d=window.__activeReportDetail;if(!d)return;
 const w=window.open('','_blank','width=900,height=700');if(!w)return;
 const clean=v=>esc(v||'Não informado').replace(/\\n/g,'<br>');
 w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório '+esc(d.protocol)+'</title><style>body{font-family:Arial,sans-serif;color:#20242a;padding:35px;line-height:1.5}h1{font-size:22px;border-bottom:2px solid #b9141b;padding-bottom:10px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f6f7f8;padding:14px;border-radius:8px}.text{border:1px solid #e2e5e8;padding:12px;border-radius:8px}h2{font-size:15px;color:#b9141b;margin-top:24px}</style></head><body><h1>Relatório da denúncia — '+esc(d.protocol)+'</h1><div class="meta"><div><b>Tipo:</b> '+clean(d.type)+'</div><div><b>Setor:</b> '+clean(d.sector)+'</div><div><b>Status:</b> '+clean(d.status)+'</div><div><b>Prioridade:</b> '+clean(d.priority)+'</div><div><b>Responsável:</b> '+clean(d.responsible)+'</div><div><b>Recebida em:</b> '+clean(d.createdAt)+'</div></div><h2>Descrição</h2><div class="text">'+clean(d.description)+'</div><h2>Como você espera que a situação seja resolvida?</h2><div class="text">'+clean(d.immediate_measure)+'</div><p style="margin-top:30px;color:#666;font-size:11px">Documento gerado pelo Canal de Denúncias NR1.</p></body></html>');w.document.close();w.focus();setTimeout(()=>w.print(),250);
}
function closeModal(){document.getElementById('modal')?.remove()}`),'função de impressão');

fs.writeFileSync(path,s,'utf8');
console.log('Arquivo atualizado com sucesso.');
console.log('Backup criado em: '+backup);