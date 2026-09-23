#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import re
import shutil
import sys

TARGET = Path('/home/supermercadoopcao/htdocs/supermercadoopcao.com.br/frontend/nr1.html')

if not TARGET.exists():
    print(f'Arquivo não encontrado: {TARGET}')
    sys.exit(1)

html = TARGET.read_text(encoding='utf-8')

if 'id="typePicker"' in html:
    print('A lista personalizada já está instalada. Nenhuma alteração foi feita.')
    sys.exit(0)

select_pattern = re.compile(r'<select\s+id=["\']type["\'][^>]*>.*?</select>', re.IGNORECASE | re.DOTALL)

replacement = '''<div class="custom-type-field">
<label>Tipo de ocorrência</label>
<input type="hidden" id="type" required>
<button type="button" id="typePicker" class="type-picker" onclick="toggleTypeOptions()">Selecione</button>
<div id="typeOptions" class="type-options hidden">
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Assédio moral"><strong>Assédio moral</strong><span class="type-description">Condutas repetitivas que humilham, constrangem, intimidam ou desrespeitam uma pessoa no ambiente de trabalho.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Assédio sexual"><strong>Assédio sexual</strong><span class="type-description">Comportamentos de natureza sexual indesejados, como propostas, insinuações, mensagens ou contatos físicos.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Discriminação"><strong>Discriminação</strong><span class="type-description">Tratamento desigual, ofensivo ou prejudicial baseado em características pessoais ou condições individuais.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Risco ou fator psicossocial"><strong>Risco ou fator psicossocial</strong><span class="type-description">Situação relacionada à organização ou às relações de trabalho que possa causar estresse, adoecimento ou prejuízo ao bem-estar do trabalhador.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Conflito no ambiente de trabalho"><strong>Conflito no ambiente de trabalho</strong><span class="type-description">Desentendimentos ou dificuldades de relacionamento entre pessoas que estejam prejudicando o ambiente ou as atividades de trabalho.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Condição insegura"><strong>Condição insegura</strong><span class="type-description">Situação, equipamento, ambiente ou prática que possa colocar em risco a saúde ou a segurança das pessoas.</span></button>
<button type="button" class="type-option" onclick="selectOccurrenceType(this)" data-value="Outro"><strong>Outro</strong><span class="type-description">Situação que não se enquadra nas opções anteriores.</span></button>
</div>
</div>'''

match = select_pattern.search(html)
if not match:
    print('O select original do campo "Tipo de ocorrência" não foi localizado. Nenhuma alteração foi feita.')
    sys.exit(1)

updated = html[:match.start()] + replacement + html[match.end():]

css = '''\n<style id="custom-occurrence-type-style">\n.custom-type-field{position:relative}.type-picker{width:100%;text-align:left;border:1px solid #dfe2e7;border-radius:9px;background:#fbfcfd;padding:11px 12px;color:#30353b;cursor:pointer}.type-options{position:absolute;z-index:20;width:100%;margin-top:5px;background:#fff;border:1px solid #dfe2e7;border-radius:9px;box-shadow:0 10px 25px rgba(28,34,42,.14);overflow:hidden}.type-option{display:block;width:100%;border:0;border-bottom:1px solid #edf0f2;background:#fff;padding:11px 12px;text-align:left;cursor:pointer;color:#30353b}.type-option:last-child{border-bottom:0}.type-option:hover{background:#fff5f5}.type-description{display:none;margin-top:5px;color:#68717b;font-size:12px;line-height:1.4;font-weight:400}.type-option:hover .type-description{display:block}.hidden{display:none!important}\n</style>\n'''

if '</head>' not in updated:
    print('A tag </head> não foi encontrada. Nenhuma alteração foi feita.')
    sys.exit(1)
updated = updated.replace('</head>', css + '</head>', 1)

js = '''\n<script id="custom-occurrence-type-script">\nfunction toggleTypeOptions(){const options=document.getElementById('typeOptions');if(options)options.classList.toggle('hidden')}\nfunction selectOccurrenceType(option){const value=option.getAttribute('data-value');const type=document.getElementById('type');const picker=document.getElementById('typePicker');const options=document.getElementById('typeOptions');if(type)type.value=value;if(picker)picker.textContent=value;if(options)options.classList.add('hidden')}\ndocument.addEventListener('click',function(event){const field=document.querySelector('.custom-type-field');if(field&&!field.contains(event.target)){document.getElementById('typeOptions')?.classList.add('hidden')}})\n</script>\n'''

if '</body>' not in updated:
    print('A tag </body> não foi encontrada. Nenhuma alteração foi feita.')
    sys.exit(1)
updated = updated.replace('</body>', js + '</body>', 1)

backup = TARGET.with_name(TARGET.name + '.backup-before-custom-type-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(TARGET, backup)
TARGET.write_text(updated, encoding='utf-8')

print('Alteração concluída com sucesso.')
print(f'Arquivo atualizado: {TARGET}')
print(f'Backup criado: {backup}')
print('Recarregue a página limpando o cache do navegador para testar.')