#!/usr/bin/env bash
set -Eeuo pipefail

APP="/home/supermercadoopcao/htdocs/supermercadoopcao.com.br"
BACKUP_ROOT="/home/supermercadoopcao/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_ROOT/protegenr1-$STAMP"

fail() {
  echo "ERRO: $1" >&2
  echo "Nenhuma reinicialização foi executada." >&2
  exit 1
}

[ -d "$APP" ] || fail "Projeto não encontrado em $APP"
[ -f "$APP/backend/src/server.js" ] || fail "backend/src/server.js não encontrado"
[ -f "$APP/frontend/nr1.html" ] || fail "frontend/nr1.html não encontrado"
[ -f "$APP/backend/database/protege_nr1.sqlite" ] || fail "Banco sql.js não encontrado"

auto_backup() {
  mkdir -p "$BACKUP"
  cp -a "$APP/backend/src" "$BACKUP/backend-src"
  cp -a "$APP/frontend" "$BACKUP/frontend"
  cp -a "$APP/package.json" "$BACKUP/package.json"
  [ ! -f "$APP/package-lock.json" ] || cp -a "$APP/package-lock.json" "$BACKUP/package-lock.json"
  cp -a "$APP/backend/database/protege_nr1.sqlite" "$BACKUP/protege_nr1.sqlite"
  echo "Backup criado em: $BACKUP"
}

cd "$APP"
auto_backup

npm install multer --save
mkdir -p backend/storage/attachments/reports backend/storage/attachments/messages
chmod 750 backend/storage backend/storage/attachments backend/storage/attachments/reports backend/storage/attachments/messages

DB_FILE="$APP/backend/database/protege_nr1.sqlite" node <<'NODE'
const fs = require('fs');
const path = require('path');
const initSqlJs = require('./node_modules/sql.js');
const dbFile = process.env.DB_FILE;
(async () => {
  const SQL = await initSqlJs({
    locateFile: file => path.join(process.cwd(), 'node_modules/sql.js/dist', file)
  });
  const db = new SQL.Database(fs.readFileSync(dbFile));
  db.run(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS report_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(message_id) REFERENCES report_messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_report_attachments_report ON report_attachments(report_id);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
  `);
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
  db.close();
  console.log('Migração sql.js concluída.');
})().catch(error => { console.error(error); process.exit(1); });
NODE

cat > backend/src/attachments.js <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

function createAttachments({ db, rows, saveDb, now, baseDir }) {
  const root = path.join(baseDir, 'storage', 'attachments');
  const reportDir = path.join(root, 'reports');
  const messageDir = path.join(root, 'messages');
  for (const dir of [reportDir, messageDir]) fs.mkdirSync(dir, { recursive: true, mode: 0o750 });

  const mime = new Set([
    'image/jpeg','image/png','image/webp','video/mp4','video/quicktime',
    'audio/mpeg','audio/wav','audio/x-wav','application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet'
  ]);
  const ext = new Set(['jpg','jpeg','png','webp','mp4','mov','mp3','wav','pdf','doc','docx','xls','xlsx','odt','ods']);
  const maxFile = 100 * 1024 * 1024;
  const maxRequest = 500 * 1024 * 1024;

  const clean = value => path.basename(String(value || 'arquivo')).replace(/[\\/\r\n"']/g, '_').slice(0, 180);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const remove = files => (files || []).forEach(file => { try { fs.unlinkSync(file.path); } catch (_) {} });
  const total = files => {
    const value = (files || []).reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (value > maxRequest) { const e = new Error('Tamanho total acima de 500 MB'); e.status = 413; throw e; }
    return value;
  };

  function uploader(context) {
    const storage = multer.diskStorage({
      destination: (_, __, cb) => cb(null, context === 'message' ? messageDir : reportDir),
      filename: (_, file, cb) => cb(null, crypto.randomBytes(24).toString('hex') + path.extname(file.originalname || '').toLowerCase())
    });
    return multer({
      storage,
      limits: { fileSize: maxFile, files: 50 },
      fileFilter: (_, file, cb) => {
        const extension = path.extname(file.originalname || '').slice(1).toLowerCase();
        cb(null, ext.has(extension) && mime.has(file.mimetype));
      }
    }).array('attachments', 50);
  }

  function insert(table, companyId, parentId, files) {
    total(files);
    for (const file of files || []) db.run(`INSERT INTO ${table}
      (company_id, ${table === 'report_attachments' ? 'report_id' : 'message_id'}, original_name,
       stored_name, storage_path, mime_type, size_bytes, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [companyId, parentId, clean(file.originalname), file.filename,
      path.relative(root, file.path), file.mimetype, file.size, hash(file.path), now()]);
    saveDb();
  }

  function list(table, column, id) {
    return rows(`SELECT id, original_name AS originalName, mime_type AS mimeType,
      size_bytes AS sizeBytes, created_at AS createdAt FROM ${table} WHERE ${column} = ? ORDER BY id`, [id]);
  }

  function resolve(table, column, id, parentId) {
    const item = rows(`SELECT * FROM ${table} WHERE id = ? AND ${column} = ?`, [Number(id), Number(parentId)])[0];
    if (!item) return null;
    const fullPath = path.resolve(root, item.storage_path);
    if (!fullPath.startsWith(path.resolve(root) + path.sep)) return null;
    return { ...item, fullPath };
  }

  return {
    uploader,
    insertReportFiles: (companyId, reportId, files) => insert('report_attachments', companyId, reportId, files),
    insertMessageFiles: (companyId, messageId, files) => insert('message_attachments', companyId, messageId, files),
    reportFiles: reportId => list('report_attachments', 'report_id', reportId),
    messageFiles: messageId => list('message_attachments', 'message_id', messageId),
    resolveReportFile: (id, reportId) => resolve('report_attachments', 'report_id', id, reportId),
    resolveMessageFile: (id, messageId) => resolve('message_attachments', 'message_id', id, messageId),
    remove
  };
}
module.exports = { createAttachments };
NODE

node --check backend/src/attachments.js
node --check backend/src/server.js

cat > backend/REPORTS_ATTACHMENTS_INTEGRATION.txt <<'TXT'
Módulo instalado e banco migrado.

Nomes reais encontrados no server.js:
- autenticação administrativa: auth, adminOnly
- autenticação pública: checkPublicAccess(req, protocol, key)

Integração necessária no server.js:
1. require('./attachments')
2. criar createAttachments depois de db/rows/saveDb/now
3. adicionar attachments.uploader('report') na rota pública de denúncia
4. adicionar attachments.uploader('message') nas duas rotas de mensagens
5. chamar insertReportFiles/insertMessageFiles após criar os IDs
6. usar auth, adminOnly nos endpoints administrativos
7. usar checkPublicAccess nas rotas públicas

O instalador para antes de modificar server.js e nr1.html para evitar substituição incorreta de código existente.
TXT

printf '\nInstalação base concluída. Backup: %s\n' "$BACKUP"
printf 'Não reinicie o PM2 automaticamente. Leia backend/REPORTS_ATTACHMENTS_INTEGRATION.txt.\n'