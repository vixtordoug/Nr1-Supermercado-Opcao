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
