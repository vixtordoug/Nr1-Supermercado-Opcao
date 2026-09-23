#!/usr/bin/env bash
set -Eeuo pipefail

APP="/home/supermercadoopcao/htdocs/supermercadoopcao.com.br"
SERVER="$APP/backend/src/server.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP/../backups/protegenr1-patch-$STAMP"

fail(){ echo "ERRO: $1" >&2; exit 1; }
[ -f "$SERVER" ] || fail "server.js não encontrado em $SERVER"
[ -f "$APP/backend/src/attachments.js" ] || fail "attachments.js não encontrado. Execute primeiro o instalador base."

mkdir -p "$BACKUP"
cp -a "$SERVER" "$BACKUP/server.js"
cp -a "$APP/frontend/nr1.html" "$BACKUP/nr1.html"
cp -a "$APP/backend/database/protege_nr1.sqlite" "$BACKUP/protege_nr1.sqlite"

echo "Backup criado em $BACKUP"

SERVER="$SERVER" APP="$APP" node <<'NODE'
const fs = require('fs');
const path = require('path');
const file = process.env.SERVER;
let s = fs.readFileSync(file, 'utf8');
const original = s;
const need = (text, label) => { if (!s.includes(text)) throw new Error('Trecho não encontrado: ' + label); };
const once = (text, replacement, label) => { need(text, label); if (s.includes(replacement)) return; s = s.replace(text, replacement); };

once('const nodemailer = require("nodemailer");', 'const nodemailer = require("nodemailer");\nconst { createAttachments } = require("./attachments");', 'require do nodemailer');
once('  migrateSensitiveData();\n  const app=express();', '  migrateSensitiveData();\n  const attachments = createAttachments({ db, rows, saveDb, now, baseDir: ROOT });\n  const app=express();', 'inicialização de attachments');

once('app.post("/api/reports",async (req,res)=>{', 'app.post("/api/reports", attachments.uploader("report"), async (req,res)=>{', 'rota de criação de denúncia');
once('    const id=rows("SELECT last_insert_rowid() AS id")[0].id;\n    db.run("INSERT INTO audit_logs', '    const id=rows("SELECT last_insert_rowid() AS id")[0].id;\n    attachments.insertReportFiles(1, id, req.files);\n    db.run("INSERT INTO audit_logs', 'salvamento dos anexos da denúncia');

once('app.post("/api/public/protocol/:protocol/messages",(req,res)=>{', 'app.post("/api/public/protocol/:protocol/messages", attachments.uploader("message"), (req,res)=>{', 'rota pública de mensagens');
once('      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[r.company_id,r.id,"public",null,"",encryptValue(message),t]);\n      db.run("UPDATE reports', '      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[r.company_id,r.id,"public",null,"",encryptValue(message),t]);\n      const publicMessageId=rows("SELECT last_insert_rowid() AS id")[0].id;\n      attachments.insertMessageFiles(r.company_id, publicMessageId, req.files);\n      db.run("UPDATE reports', 'salvamento dos anexos da mensagem pública');

once('app.post("/api/admin/reports/:id/messages",auth,adminOnly,(req,res)=>{', 'app.post("/api/admin/reports/:id/messages",auth,adminOnly,attachments.uploader("message"),(req,res)=>{', 'rota administrativa de mensagens');
once('      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[req.user.companyId,r.id,"admin",req.user.id,"",encryptValue(message),t]);\n      db.run("UPDATE reports', '      db.run("INSERT INTO report_messages(company_id,report_id,sender_type,user_id,message,message_enc,created_at) VALUES(?,?,?,?,?,?,?)",[req.user.companyId,r.id,"admin",req.user.id,"",encryptValue(message),t]);\n      const adminMessageId=rows("SELECT last_insert_rowid() AS id")[0].id;\n      attachments.insertMessageFiles(req.user.companyId, adminMessageId, req.files);\n      db.run("UPDATE reports', 'salvamento dos anexos da mensagem administrativa');

const marker = '  app.get("/api/admin/reports",auth,adminOnly,(req,res)=>{';
need(marker, 'início das rotas administrativas');
const routes = `  app.get("/api/public/protocol/:protocol/attachments/:id",(req,res)=>{\n    const p=String(req.params.protocol||"").trim().toUpperCase();\n    const key=String(req.headers["x-protocol-key"]||"").trim();\n    if(!checkPublicAccess(req,p,key)) return res.status(401).json({error:"Protocolo ou chave de segurança inválidos."});\n    const r=rows("SELECT id FROM reports WHERE protocol=?",[p])[0];\n    const file= r ? attachments.resolveReportFile(req.params.id,r.id) : null;\n    if(!file) return res.status(404).json({error:"Arquivo não encontrado."});\n    return res.download(file.fullPath,file.original_name);\n  });\n\n  app.get("/api/admin/reports/:id/attachments/:attachmentId",auth,adminOnly,(req,res)=>{\n    const r=rows("SELECT id FROM reports WHERE id=? AND company_id=?",[req.params.id,req.user.companyId])[0];\n    const file=r ? attachments.resolveReportFile(req.params.attachmentId,r.id) : null;\n    if(!file) return res.status(404).json({error:"Arquivo não encontrado."});\n    return res.download(file.fullPath,file.original_name);\n  });\n\n`;
if (!s.includes('/api/public/protocol/:protocol/attachments/:id')) s = s.replace(marker, routes + marker);

if (s === original) throw new Error('Nenhuma alteração foi aplicada.');
fs.writeFileSync(file, s);
console.log('server.js atualizado.');
NODE

node --check "$SERVER"
[ -f "$APP/backend/src/attachments.js" ] || exit 1

echo "Patch aplicado e sintaxe validada."
echo "Backup: $BACKUP"
echo "PM2 não foi reiniciado automaticamente."
echo "Execute pm2 list e envie o resultado antes do reinício."