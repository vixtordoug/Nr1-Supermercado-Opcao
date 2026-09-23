const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(process.cwd(), 'backend', 'database', 'protege_nr1.sqlite');
const DATA_KEY_FILE = path.join(process.cwd(), 'backend', '.data_key');

const ADMIN_CPF = '07066345436';

function normalizeCpf(value){ return String(value||'').replace(/\D/g,''); }

function validCPF(value){
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\\d)\\1{10}$/.test(cpf)) return false;
  let sum=0; for(let i=0;i<9;i++) sum+=Number(cpf[i])*(10-i);
  let d1=(sum*10)%11; if(d1===10) d1=0; if(d1!==Number(cpf[9])) return false;
  sum=0; for(let i=0;i<10;i++) sum+=Number(cpf[i])*(11-i);
  let d2=(sum*10)%11; if(d2===10) d2=0;
  return d2===Number(cpf[10]);
}

function askPassword(){
  return new Promise((resolve, reject)=>{
    const rl = readline.createInterface({input:process.stdin, output:process.stdout});
    rl.question('Digite a NOVA senha temporária do Admin (min 12 chars): ', ans=>{
      rl.close();
      if(!ans || ans.length < 12) return reject(new Error('Senha muito curta.'));
      resolve(ans);
    });
  });
}

function loadDataKey(){
  const raw = fs.readFileSync(DATA_KEY_FILE,'utf8').trim();
  if(!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Chave de dados inválida.');
  return Buffer.from(raw,'hex');
}

function lookupHash(value, dataKey){
  return crypto.createHmac('sha256', dataKey).update(String(value||''), 'utf8').digest('hex');
}

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

(async()=>{
  if(!fs.existsSync(DB_FILE)) throw new Error('Banco não encontrado.');
  if(!fs.existsSync(DATA_KEY_FILE)) throw new Error('backend/.data_key não encontrado.');

  if(!validCPF(ADMIN_CPF)) throw new Error('CPF inválido na configuração.');

  const password = await askPassword();
  const dataKey = loadDataKey();

  const backupFile = `${DB_FILE}.antes-fix-senha-${new Date().toISOString().replace(/[:.]/g,'-')}.bak`;
  fs.copyFileSync(DB_FILE, backupFile);

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_FILE));

  const cpfHash = lookupHash(ADMIN_CPF, dataKey);

  const rows = db.exec('SELECT id FROM users WHERE cpf_lookup_hash=?', [cpfHash]);
  const userId = rows[0]?.values?.[0]?.[0];
  if(!userId) throw new Error('Admin não encontrado pelo CPF (cpf_lookup_hash).');

  const newHash = hashPassword(password);
  db.run('UPDATE users SET password_hash=? WHERE id=?', [newHash, userId]);

  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  console.log('Senha do admin atualizada com sucesso.');
  console.log('Backup preservado em:', backupFile);
})().catch(e=>{
  console.error('Falha:', e.message);
  process.exitCode = 1;
});
