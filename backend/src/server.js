const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const initSqlJs = require('sql.js');


require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const nodemailer = require("nodemailer");
const { createAttachments } = require("./attachments");

const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendReportNotification(data) {
  return emailTransporter.sendMail({
    from: `"ProtegeNR1" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `Nova denúncia registrada - ${data.protocol}`,
    text: `Uma nova denúncia foi registrada no PortalNR1.

Protocolo: ${data.protocol}
Tipo: ${data.type}
Setor: ${data.sector}
Data da ocorrência: ${data.occurrenceDate || "Não informado"}
Frequência: ${data.frequency || "Não informado"}
Anônima: ${data.anonymous ? "Sim" : "Não"}

Descrição:
${data.description}`
  });
}



const DATA_KEY_FILE = path.join(__dirname, "..", ".data_key");
let DATA_KEY;
function loadDataKey(){
  let raw=String(process.env.DATA_ENCRYPTION_KEY||"").trim();
  if(!/^[0-9a-fA-F]{64}$/.test(raw) && fs.existsSync(DATA_KEY_FILE)) raw=fs.readFileSync(DATA_KEY_FILE,"utf8").trim();
  if(!/^[0-9a-fA-F]{64}$/.test(raw)){ raw=crypto.randomBytes(32).toString("hex"); fs.mkdirSync(path.dirname(DATA_KEY_FILE),{recursive:true}); fs.writeFileSync(DATA_KEY_FILE,raw,{mode:0o600}); }
  return Buffer.from(raw,"hex");
}
function encryptValue(value){ if(value===null||value===undefined||value==="") return ""; const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",DATA_KEY,iv); const ct=Buffer.concat([c.update(String(value),"utf8"),c.final()]); return `v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`; }
function decryptValue(value){ if(value===null||value===undefined||value==="") return ""; const s=String(value); if(!s.startsWith("v1:")) return s; try{const [,iv,tag,ct]=s.split(":"); const d=crypto.createDecipheriv("aes-256-gcm",DATA_KEY,Buffer.from(iv,"base64url")); d.setAuthTag(Buffer.from(tag,"base64url")); return Buffer.concat([d.update(Buffer.from(ct,"base64url")),d.final()]).toString("utf8");}catch{return "";} }
function lookupHash(value){return crypto.createHmac("sha256",DATA_KEY).update(String(value||""),"utf8").digest("hex");}
function decrypted(row,enc,plain){return decryptValue(row?.[enc]||row?.[plain]||"");}

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..", "..");
const DB_DIR = path.join(ROOT, "backend", "database");
const DB_FILE = path.join(DB_DIR, "protege_nr1.sqlite");
const SESSION_COOKIE = "protege_session";
const sessions = new Map();
const publicAccessAttempts = new Map();
const PUBLIC_MAX_ATTEMPTS = 5;
const PUBLIC_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_BLOCK_MS = 15 * 60 * 1000;
const KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
fs.mkdirSync(DB_DIR, { recursive: true });
DATA_KEY=loadDataKey();
try{fs.chmodSync(DATA_KEY_FILE,0o600)}catch{}

let db;
const now = () => new Date().toISOString();
const protocol = () => `NR1-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const normalizeCpf = v => String(v || "").replace(/\D/g, "");
function validCPF(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i=0;i<9;i++) sum += Number(cpf[i]) * (10-i);
  let d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i=0;i<10;i++) sum += Number(cpf[i]) * (11-i);
  let d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}
const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(String(password), salt, 64).toString("hex")}`;
const generateSecurityKey = () => {
  let out="";
  const bytes=crypto.randomBytes(16);
  for(let i=0;i<16;i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out.slice(0,4)+"-"+out.slice(4,8)+"-"+out.slice(8,12)+"-"+out.slice(12,16);
};
const hashSecurityKey = (key, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(String(key).replace(/-/g,"").toUpperCase(), salt, 64).toString("hex")}`;
const verifySecurityKey = (key, stored) => {
  if(!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual=crypto.scryptSync(String(key).replace(/-/g,"").toUpperCase(),salt,64).toString("hex");
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
};
const clientIp = req => String(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").split(",")[0].trim();
function checkPublicAccess(req, protocolValue, key){
  const nowMs=Date.now(), ip=clientIp(req), id=`${ip}|${String(protocolValue).toUpperCase()}`;
  let rec=publicAccessAttempts.get(id);
  if(!rec || nowMs-rec.startedAt>PUBLIC_WINDOW_MS) rec={startedAt:nowMs,failures:0,blockedUntil:0};
  if(rec.blockedUntil>nowMs){publicAccessAttempts.set(id,rec);return false;}
  const r=rows("SELECT security_key_hash FROM reports WHERE protocol=?",[String(protocolValue).toUpperCase()])[0];
  const ok=!!r && verifySecurityKey(key,r.security_key_hash);
  if(!ok){rec.failures++; if(rec.failures>=PUBLIC_MAX_ATTEMPTS) rec.blockedUntil=nowMs+PUBLIC_BLOCK_MS; publicAccessAttempts.set(id,rec); return false;}
  publicAccessAttempts.delete(id); return true;
}
const verifyPassword = (password, stored) => {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a=Buffer.from(actual), b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
};
function saveDb(){fs.writeFileSync(DB_FILE, Buffer.from(db.export()));}
function rows(sql,params=[]){
  const result=db.exec(sql,params)[0]; if(!result)return [];
  return result.values.map(v=>Object.fromEntries(v.map((x,i)=>[result.columns[i],x])));
}
function initSchema(){
  db.run(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,document TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sectors(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,name TEXT NOT NULL,cpf TEXT UNIQUE NOT NULL,email TEXT,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',active INTEGER NOT NULL DEFAULT 1,sector TEXT,created_at TEXT NOT NULL,FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,protocol TEXT UNIQUE NOT NULL,type TEXT NOT NULL,sector TEXT NOT NULL,occurrence_date TEXT,frequency TEXT,description TEXT NOT NULL,immediate_measure TEXT,anonymous INTEGER NOT NULL DEFAULT 1,name TEXT,email TEXT,status TEXT NOT NULL DEFAULT 'Recebida',priority TEXT NOT NULL DEFAULT 'Média',responsible TEXT,security_key_hash TEXT,security_key_created_at TEXT,security_setup_token_hash TEXT,security_setup_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS risk_register(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,sector TEXT NOT NULL,factor TEXT NOT NULL,category TEXT NOT NULL,probability INTEGER NOT NULL DEFAULT 1,severity INTEGER NOT NULL DEFAULT 1,priority TEXT NOT NULL DEFAULT 'Baixa',controls TEXT,responsible TEXT,due_date TEXT,status TEXT NOT NULL DEFAULT 'Aberto',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS action_plans(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,report_id INTEGER,risk_id INTEGER,title TEXT NOT NULL,responsible TEXT,due_date TEXT,status TEXT NOT NULL DEFAULT 'Pendente',notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,report_id INTEGER,user_id INTEGER,action TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS report_messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    report_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('public','admin')),
    user_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(report_id) REFERENCES reports(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  `);
  const reportCols=rows("PRAGMA table_info(reports)");
  if(!reportCols.some(x=>x.name==="security_key_hash")) db.run("ALTER TABLE reports ADD COLUMN security_key_hash TEXT");
  if(!reportCols.some(x=>x.name==="security_key_created_at")) db.run("ALTER TABLE reports ADD COLUMN security_key_created_at TEXT");
  if(!reportCols.some(x=>x.name==="security_setup_token_hash")) db.run("ALTER TABLE reports ADD COLUMN security_setup_token_hash TEXT");
  if(!reportCols.some(x=>x.name==="security_setup_expires_at")) db.run("ALTER TABLE reports ADD COLUMN security_setup_expires_at TEXT");
  const userCols=rows("PRAGMA table_info(users)");
  if(!userCols.some(x=>x.name==="sector")) db.run("ALTER TABLE users ADD COLUMN sector TEXT");
  const addColumn=(table,col,type)=>{const cols=rows(`PRAGMA table_info(${table})`);if(!cols.some(x=>x.name===col))db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)};
  addColumn("users","cpf_lookup_hash","TEXT"); addColumn("users","name_enc","TEXT"); addColumn("users","email_enc","TEXT");
  addColumn("reports","description_enc","TEXT"); addColumn("reports","immediate_measure_enc","TEXT"); addColumn("reports","name_enc","TEXT"); addColumn("reports","email_enc","TEXT"); addColumn("reports","responsible_enc","TEXT");
  addColumn("report_messages","message_enc","TEXT"); addColumn("audit_logs","details_enc","TEXT"); addColumn("companies","document_enc","TEXT");
  addColumn("action_plans","responsible_enc","TEXT"); addColumn("action_plans","notes_enc","TEXT"); addColumn("risk_register","controls_enc","TEXT"); addColumn("risk_register","responsible_enc","TEXT");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cpf_lookup_hash ON users(cpf_lookup_hash)");

  let c=rows("SELECT id FROM companies ORDER BY id LIMIT 1")[0];
  if(!c){
    db.run("INSERT INTO companies(name,document,created_at) VALUES(?,?,?)",["Empresa Demonstração","",now()]);
    c=rows("SELECT id FROM companies ORDER BY id LIMIT 1")[0];
    ["Administrativo","Produção","Recursos Humanos"].forEach(n=>db.run("INSERT INTO sectors(company_id,name) VALUES(?,?)",[c.id,n]));
  }
  if(!rows("SELECT id FROM users LIMIT 1")[0]){
    db.run("INSERT INTO users(company_id,name,cpf,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)",
      [c.id,"Administrador","00000000000","admin@protegenr1.local",hashPassword("123456"),"admin",now()]);
  }
  saveDb();
}
function migrateSensitiveData(){
  for(const u of rows("SELECT id,name,cpf,email,name_enc,email_enc,cpf_lookup_hash FROM users")){ const cpf=normalizeCpf(decryptValue(u.cpf)); if(cpf&&!u.cpf_lookup_hash) db.run("UPDATE users SET cpf_lookup_hash=? WHERE id=?",[lookupHash(cpf),u.id]); if(u.name&&!String(u.name).startsWith("v1:")) db.run("UPDATE users SET name=?,name_enc=? WHERE id=?",[encryptValue(u.name),encryptValue(u.name),u.id]); if(u.email&&!String(u.email).startsWith("v1:")) db.run("UPDATE users SET email=?,email_enc=? WHERE id=?",[encryptValue(u.email),encryptValue(u.email),u.id]); if(u.cpf&&!String(u.cpf).startsWith("v1:")) db.run("UPDATE users SET cpf=? WHERE id=?",[encryptValue(cpf),u.id]); }
  for(const r of rows("SELECT id,description,immediate_measure,name,email,responsible FROM reports")) db.run("UPDATE reports SET description_enc=?,immediate_measure_enc=?,name_enc=?,email_enc=?,responsible_enc=?,description='',immediate_measure='',name='',email='',responsible='' WHERE id=?",[encryptValue(r.description),encryptValue(r.immediate_measure),encryptValue(r.name),encryptValue(r.email),encryptValue(r.responsible),r.id]);
  for(const m of rows("SELECT id,message FROM report_messages")) db.run("UPDATE report_messages SET message_enc=?,message='' WHERE id=?",[encryptValue(m.message),m.id]);
  for(const a of rows("SELECT id,details FROM audit_logs")) db.run("UPDATE audit_logs SET details_enc=?,details='' WHERE id=?",[encryptValue(a.details),a.id]);
  for(const c of rows("SELECT id,document FROM companies")) db.run("UPDATE companies SET document_enc=?,document='' WHERE id=?",[encryptValue(c.document),c.id]);
  for(const a of rows("SELECT id,responsible,notes FROM action_plans")) db.run("UPDATE action_plans SET responsible_enc=?,notes_enc=?,responsible='',notes='' WHERE id=?",[encryptValue(a.responsible),encryptValue(a.notes),a.id]);
  for(const r of rows("SELECT id,controls,responsible FROM risk_register")) db.run("UPDATE risk_register SET controls_enc=?,responsible_enc=?,controls='',responsible='' WHERE id=?",[encryptValue(r.controls),encryptValue(r.responsible),r.id]);
  saveDb();
}

function parseCookies(req,_,next){
  req.cookies={};
  (req.headers.cookie||"").split(";").forEach(pair=>{const i=pair.indexOf("=");if(i>-1)req.cookies[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim())});
  next();
}
function auth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"")||req.cookies?.[SESSION_COOKIE];
  const session=token&&sessions.get(token);
  if(!session)return res.status(401).json({error:"Não autenticado."});
  req.user=session; next();
}
function adminOnly(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Acesso restrito ao administrador."});next();}

async function main(){
  const SQL=await initSqlJs({locateFile:file=>path.join(ROOT,"node_modules","sql.js","dist",file)});
  db=fs.existsSync(DB_FILE)?new SQL.Database(fs.readFileSync(DB_FILE)):new SQL.Database();
  initSchema();
  migrateSensitiveData();
  const attachments = createAttachments({ db, rows, saveDb, now, baseDir: ROOT });
  const app=express();
  app.set("trust proxy",1); app.use(express.json({limit:"10mb"})); app.use(parseCookies); app.use(express.static(path.join(ROOT,"frontend")));

  app.get("/api/health",(_,res)=>res.json({ok:true,database:"SQLite",version:"5.0.0"}));
  app.post("/api/auth/login",(req,res)=>{
    const cpf=normalizeCpf(req.body?.cpf), password=req.body?.password||"";
    const u=rows("SELECT id,company_id,name,cpf,email,password_hash,role,active,sector,name_enc,email_enc,cpf_lookup_hash FROM users WHERE cpf_lookup_hash=?",[lookupHash(cpf)])[0];
    if(!u||!u.active||!verifyPassword(password,u.password_hash))return res.status(401).json({error:"CPF ou senha inválidos."});
    const token=crypto.randomBytes(32).toString("hex");
    sessions.set(token,{id:u.id,companyId:u.company_id,name:decrypted(u,"name_enc","name")||"Administrador",sector:u.sector||"Não informado",role:u.role});
    res.setHeader("Set-Cookie",`${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`);
    res.json({ok:true,user:{id:u.id,name:decrypted(u,"name_enc","name")||"Administrador",sector:u.sector||"Não informado",role:u.role}});
  });
  app.post("/api/auth/logout",(req,res)=>{
    const t=req.headers.authorization?.replace(/^Bearer\s+/i,"")||req.cookies?.[SESSION_COOKIE]; if(t)sessions.delete(t);
    res.setHeader("Set-Cookie",`${SESSION_COOKIE}=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/`); res.json({ok:true});
  });
  app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));

  app.get("/api/company",auth,(req,res)=>{const c=rows("SELECT id,name,document,document_enc,created_at AS createdAt FROM companies WHERE id=?",[req.user.companyId])[0]||{};c.document=decryptValue(c.document_enc||c.document);delete c.document_enc;res.json(c)});
  app.get("/api/sectors",(_,res)=>res.json(rows("SELECT id,name,active FROM sectors WHERE active=1 ORDER BY name")));

 app.post("/api/reports", attachments.uploader("report"), async (req,res)=>{
    const b=req.body||{};
    if(!b.type||!b.sector||!b.description)return res.status(400).json({error:"Tipo, setor e descrição são obrigatórios."});
    const p=protocol(),setupToken=crypto.randomBytes(32).toString("hex"),setupHash=hashSecurityKey(setupToken),t=now(),anonymous=b.anonymous!==false;
    db.run(`INSERT INTO reports(company_id,protocol,type,sector,occurrence_date,frequency,description,immediate_measure,anonymous,name,email,status,priority,responsible,security_key_hash,security_key_created_at,security_setup_token_hash,security_setup_expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [1,p,b.type,b.sector,b.occurrenceDate||"",b.frequency||"","","",anonymous?1:0,"","","Recebida","Média","",null,null,setupHash,new Date(Date.now()+10*60*1000).toISOString(),t,t]);
    db.run("UPDATE reports SET description_enc=?,immediate_measure_enc=?,name_enc=?,email_enc=?,responsible_enc=? WHERE protocol=?",[encryptValue(b.description),encryptValue(b.immediateMeasure||""),encryptValue(anonymous?"":(b.name||"")),encryptValue(anonymous?"":(b.email||"")),encryptValue(""),p]);
    const id=rows("SELECT last_insert_rowid() AS id")[0].id;
    attachments.insertReportFiles(1, id, req.files);
    db.run("INSERT INTO audit_logs(company_id,report_id,action,details,details_enc,created_at) VALUES(?,?,?,?,?,?)",[1,id,"Denúncia registrada","",encryptValue("Canal público"),t]);
    saveDb();

try {
  await sendReportNotification({
    protocol: p,
    type: b.type,
    sector: b.sector,
    occurrenceDate: b.occurrenceDate,
    frequency: b.frequency,
    anonymous,
    description: b.description
  });
} catch (error) {
  console.error("Falha ao enviar notificação por e-mail:", error.message);
}

res.status(201).json({protocol:p,setupToken,status:"Recebida"});
  });

  app.post("/api/public/protocol/:protocol/security-key",(req,res)=>{
    const p=String(req.params.protocol||"").trim().toUpperCase();
    const setupToken=String(req.body?.setupToken||"").trim();
    const key=String(req.body?.securityKey||"");
    if(key.length<6||!/\d/.test(key)) return res.status(400).json({error:"A chave deve ter no mínimo 6 caracteres e conter pelo menos 1 número."});
    const r=rows("SELECT id,security_setup_token_hash,security_setup_expires_at,security_key_hash FROM reports WHERE protocol=?",[p])[0];
    if(!r||!r.security_setup_token_hash||r.security_key_hash) return res.status(401).json({error:"Não foi possível definir a chave de segurança."});
    if(r.security_setup_expires_at && new Date(r.security_setup_expires_at).getTime()<Date.now()) return res.status(401).json({error:"O tempo para definir a chave expirou. Envie uma nova denúncia para gerar um novo acesso."});
    if(!verifySecurityKey(setupToken,r.security_setup_token_hash)) return res.status(401).json({error:"Não foi possível definir a chave de segurança."});
    const t=now();
    db.run("UPDATE reports SET security_key_hash=?,security_key_created_at=?,security_setup_token_hash=NULL,security_setup_expires_at=NULL,updated_at=? WHERE protocol=?",[hashSecurityKey(key),t,t,p]);
    saveDb(); res.json({ok:true});
  });

  app.get("/api/public/protocol/:protocol",(req,res)=>{
    const p=String(req.params.protocol).trim().toUpperCase();
    const key=String(req.headers["x-protocol-key"]||"").trim();
    if(!checkPublicAccess(req,p,key)) return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const r=rows(`SELECT id,protocol,type,sector,occurrence_date AS occurrenceDate,frequency,status,priority,created_at AS createdAt,updated_at AS updatedAt FROM reports WHERE protocol=?`,[p])[0];
    if(!r)return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    r.attachments=attachments.reportFiles(r.id);
    res.json(r);
  });

  app.get("/api/public/protocol/:protocol/messages",(req,res)=>{
    const p=String(req.params.protocol).trim().toUpperCase();
    const key=String(req.headers["x-protocol-key"]||"").trim();
    if(!checkPublicAccess(req,p,key)) return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const r=rows("SELECT id FROM reports WHERE protocol=?",[p])[0];
    if(!r)return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const msgs=rows(`SELECT id,sender_type AS senderType,message,message_enc,created_at AS createdAt FROM report_messages WHERE report_id=? ORDER BY id ASC`,[r.id]); res.json(msgs.map(m=>({...m,message:decryptValue(m.message_enc||m.message)})));
  });
  app.post("/api/public/protocol/:protocol/messages", attachments.uploader("message"), (req,res)=>{
    const message=String(req.body?.message||"").trim();
    if(!message)return res.status(400).json({error:"A mensagem não pode ficar vazia."});
    if(message.length>2000)return res.status(400).json({error:"A mensagem deve ter no máximo 2000 caracteres."});
    const p=String(req.params.protocol).trim().toUpperCase();
    const key=String(req.headers["x-protocol-key"]||"").trim();
    if(!checkPublicAccess(req,p,key)) return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const r=rows("SELECT id,company_id FROM reports WHERE protocol=?",[p])[0];
    if(!r)return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const t=now();
      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[r.company_id,r.id,"public",null,"",encryptValue(message),t]);
      const publicMessageId=rows("SELECT last_insert_rowid() AS id")[0].id;
      attachments.insertMessageFiles(r.company_id, publicMessageId, req.files);
      db.run("UPDATE reports SET updated_at=? WHERE id=?",[t,r.id]);
    db.run("INSERT INTO audit_logs(company_id,report_id,action,details,details_enc,created_at) VALUES(?,?,?,?,?,?)",[r.company_id,r.id,"Mensagem recebida no protocolo","",encryptValue("Mensagem enviada pelo canal público"),t]);
    saveDb();
    res.status(201).json({ok:true});
  });

  app.get("/api/admin/reports/:id/messages",auth,adminOnly,(req,res)=>{
    const r=rows("SELECT id FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];
    if(!r)return res.status(404).json({error:"Denúncia não encontrada."});
    const msgs=rows(`SELECT m.id,m.message,m.message_enc,m.sender_type AS senderType,m.created_at AS createdAt,u.name AS senderName,u.name_enc AS senderNameEnc FROM report_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.report_id=? ORDER BY m.id ASC`,[r.id]); res.json(msgs.map(m=>({...m,message:decryptValue(m.message_enc||m.message),senderName:decryptValue(m.senderNameEnc||m.senderName)})));
  });
  app.post("/api/admin/reports/:id/messages",auth,adminOnly,attachments.uploader("message"),(req,res)=>{
    const message=String(req.body?.message||"").trim();
    if(!message)return res.status(400).json({error:"A mensagem não pode ficar vazia."});
    if(message.length>2000)return res.status(400).json({error:"A mensagem deve ter no máximo 2000 caracteres."});
    const r=rows("SELECT id FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];
    if(!r)return res.status(404).json({error:"Denúncia não encontrada."});
    const t=now();
      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[req.user.companyId,r.id,"admin",req.user.id,"",encryptValue(message),t]);
      const adminMessageId=rows("SELECT last_insert_rowid() AS id")[0].id;
      attachments.insertMessageFiles(req.user.companyId, adminMessageId, req.files);
      db.run("UPDATE reports SET updated_at=? WHERE id=? AND company_id=?",[t,r.id,req.user.companyId]);
    db.run("INSERT INTO audit_logs(company_id,report_id,user_id,action,details,details_enc,created_at) VALUES(?,?,?,?,?,?,?)",[req.user.companyId,r.id,req.user.id,"Resposta enviada no protocolo","",encryptValue("Mensagem enviada pela administração"),t]);
    saveDb();
    res.status(201).json({ok:true});
  });

  app.get("/api/public/protocol/:protocol/attachments/:id",(req,res)=>{
    const p=String(req.params.protocol||"").trim().toUpperCase();
    const key=String(req.headers["x-protocol-key"]||"").trim();
    if(!checkPublicAccess(req,p,key)) return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});
    const r=rows("SELECT id FROM reports WHERE protocol=?",[p])[0];
    const file= r ? attachments.resolveReportFile(req.params.id,r.id) : null;
    if(!file) return res.status(404).json({error:"Arquivo não encontrado."});
    return res.download(file.fullPath,file.original_name);
  });

  app.get("/api/admin/reports/:id/attachments/:attachmentId",auth,adminOnly,(req,res)=>{
    const r=rows("SELECT id FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];
    const file=r ? attachments.resolveReportFile(req.params.attachmentId,r.id) : null;
    if(!file) return res.status(404).json({error:"Arquivo não encontrado."});
    return res.download(file.fullPath,file.original_name);
  });

  app.get("/api/admin/reports",auth,adminOnly,(req,res)=>{
    let sql=`SELECT id,protocol,type,sector,status,priority,responsible,anonymous,created_at AS createdAt FROM reports WHERE company_id=?`,p=[req.user.companyId];
    if(req.query.status){sql+=" AND status=?";p.push(req.query.status)} if(req.query.type){sql+=" AND type=?";p.push(req.query.type)} if(req.query.sector){sql+=" AND sector=?";p.push(req.query.sector)}
    sql+=" ORDER BY id DESC";
    res.json(rows(sql,p).map(report=>({...report,attachments:attachments.reportFiles(report.id)})));
  });
  app.get("/api/admin/reports/:id",auth,adminOnly,(req,res)=>{
    const r=rows("SELECT * FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];
    if(!r)return res.status(404).json({error:"Denúncia não encontrada."});
    r.description=decrypted(r,"description_enc","description"); r.immediate_measure=decrypted(r,"immediate_measure_enc","immediate_measure"); r.name=decrypted(r,"name_enc","name"); r.email=decrypted(r,"email_enc","email"); r.responsible=decrypted(r,"responsible_enc","responsible"); r.attachments=attachments.reportFiles(r.id);
    res.json(r);
  });
  app.patch("/api/admin/reports/:id",auth,adminOnly,(req,res)=>{
    const allowed=["Recebida","Em análise","Em investigação","Aguardando ação","Concluída","Arquivada"];
    const {status,priority,responsible}=req.body||{};
    if(status&&!allowed.includes(status))return res.status(400).json({error:"Status inválido."});
    const r=rows("SELECT id FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];
    if(!r)return res.status(404).json({error:"Denúncia não encontrada."});
    const t=now();

    db.run(
      "UPDATE reports SET status=COALESCE(?,status),priority=COALESCE(?,priority),responsible=COALESCE(?,responsible),updated_at=? WHERE id=? AND company_id=?",
      [status||null,priority||null,responsible??null,t,req.params.id,req.user.companyId],
      function(err){
        if(err)return res.status(500).json({error:"Não foi possível salvar a denúncia."});

        db.run(
          "INSERT INTO audit_logs(company_id,report_id,user_id,action,details,details_enc,created_at) VALUES(?,?,?,?,?,?,?)",
          [req.user.companyId,req.params.id,req.user.id,"Denúncia atualizada","",encryptValue(JSON.stringify({status,priority,responsible})),t],
          function(err2){
            if(err2)return res.status(500).json({error:"Não foi possível registrar a alteração."});
            saveDb();
            res.json({ok:true});
          }
        );
      }
    );
  });

  app.get("/api/admin/users",auth,adminOnly,(req,res)=>{ const list=rows("SELECT id,name,cpf,sector,email,role,active,created_at AS createdAt,name_enc,email_enc FROM users WHERE company_id=? ORDER BY id DESC",[req.user.companyId]); res.json(list.map(u=>{const out={...u,name:decrypted(u,"name_enc","name"),cpf:decryptValue(u.cpf),email:decrypted(u,"email_enc","email")};delete out.name_enc;delete out.email_enc;delete out.cpf_lookup_hash;return out;})); });
  app.post("/api/admin/users",auth,adminOnly,(req,res)=>{
    const b=req.body||{},cpf=normalizeCpf(b.cpf);
    if(!b.name||!cpf||!b.password)return res.status(400).json({error:"Nome, CPF e senha são obrigatórios."});
    if(!validCPF(cpf))return res.status(400).json({error:"CPF inválido. Informe um CPF válido."});
    if(String(b.password).length<6)return res.status(400).json({error:"A senha deve ter pelo menos 6 caracteres."});
    const role=["admin","gestor","rh","sst"].includes(b.role)?b.role:"gestor";
    try{
      db.run("INSERT INTO users(company_id,name,cpf,email,password_hash,role,active,sector,created_at,cpf_lookup_hash,name_enc,email_enc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[req.user.companyId,encryptValue(b.name),encryptValue(cpf),encryptValue(b.email||""),hashPassword(b.password),role,1,b.sector||"",now(),lookupHash(cpf),encryptValue(b.name),encryptValue(b.email||"")]);
      db.run("INSERT INTO audit_logs(company_id,user_id,action,details,details_enc,created_at) VALUES(?,?,?,?,?,?)",[req.user.companyId,req.user.id,"Usuário criado","",encryptValue("Novo usuário cadastrado"),now()]);
      saveDb();res.status(201).json({ok:true});
    }catch(e){res.status(400).json({error:"Não foi possível criar o usuário. O CPF pode já estar cadastrado."})}
  });
  app.patch("/api/admin/users/:id",auth,adminOnly,(req,res)=>{
    const b=req.body||{},id=Number(req.params.id);
    const u=rows("SELECT id FROM users WHERE id=? AND company_id=?",[id,req.user.companyId])[0];
    if(!u)return res.status(404).json({error:"Usuário não encontrado."});
    if(b.cpf!==undefined&&!validCPF(b.cpf))return res.status(400).json({error:"CPF inválido."});
    if(b.password!==undefined&&String(b.password).length<6)return res.status(400).json({error:"A senha deve ter pelo menos 6 caracteres."});
    try{
      const set=[]; const vals=[]; if(b.name!==undefined){set.push("name=?","name_enc=?");vals.push(encryptValue(b.name),encryptValue(b.name));} if(b.cpf!==undefined){const nc=normalizeCpf(b.cpf);set.push("cpf=?","cpf_lookup_hash=?");vals.push(encryptValue(nc),lookupHash(nc));} if(b.email!==undefined){set.push("email=?","email_enc=?");vals.push(encryptValue(b.email),encryptValue(b.email));} if(b.sector!==undefined){set.push("sector=?");vals.push(b.sector);} if(b.role!==undefined){set.push("role=?");vals.push(b.role);} if(b.active!==undefined){set.push("active=?");vals.push(b.active?1:0);} if(b.password){set.push("password_hash=?");vals.push(hashPassword(b.password));} if(set.length) db.run(`UPDATE users SET ${set.join(",")} WHERE id=? AND company_id=?`,[...vals,id,req.user.companyId]);
      saveDb();res.json({ok:true});
    }catch(e){res.status(400).json({error:"Não foi possível atualizar o usuário."})}
  });

  app.get("/api/admin/dashboard",auth,adminOnly,(req,res)=>{
    const cid=req.user.companyId,total=rows("SELECT COUNT(*) AS value FROM reports WHERE company_id=?",[cid])[0]?.value||0;
    const open=rows("SELECT COUNT(*) AS value FROM reports WHERE company_id=? AND status NOT IN ('Concluída','Arquivada')",[cid])[0]?.value||0;
    const anonymous=rows("SELECT COUNT(*) AS value FROM reports WHERE company_id=? AND anonymous=1",[cid])[0]?.value||0;
    const risks=rows("SELECT COUNT(*) AS value FROM risk_register WHERE company_id=? AND status <> 'Concluído'",[cid])[0]?.value||0;
    res.json({total,open,anonymous,risks});
  });
  app.get("/api/admin/risks",auth,adminOnly,(req,res)=>{const list=rows(`SELECT id,sector,factor,category,probability,severity,priority,controls,controls_enc,responsible,responsible_enc,due_date AS dueDate,status FROM risk_register WHERE company_id=? ORDER BY id DESC`,[req.user.companyId]);res.json(list.map(x=>({...x,controls:decryptValue(x.controls_enc||x.controls),responsible:decryptValue(x.responsible_enc||x.responsible)})));});
  app.get("/api/admin/actions",auth,adminOnly,(req,res)=>{const list=rows(`SELECT id,title,responsible,responsible_enc,due_date AS dueDate,status,notes,notes_enc,report_id AS reportId,risk_id AS riskId FROM action_plans WHERE company_id=? ORDER BY id DESC`,[req.user.companyId]);res.json(list.map(x=>({...x,responsible:decryptValue(x.responsible_enc||x.responsible),notes:decryptValue(x.notes_enc||x.notes)})));});
  app.get("/api/admin/audit",auth,adminOnly,(req,res)=>{const list=rows(`SELECT id,report_id AS reportId,user_id AS userId,action,details,details_enc,created_at AS createdAt FROM audit_logs WHERE company_id=? ORDER BY id DESC LIMIT 300`,[req.user.companyId]);res.json(list.map(x=>({...x,details:decryptValue(x.details_enc||x.details)})));});

  app.listen(PORT,()=>console.log(`ProtegeNR1 v6.0 seguro funcionando em http://localhost:${PORT}`));
}
main().catch(err=>{console.error("Falha ao iniciar ProtegeNR1:",err);process.exit(1)});