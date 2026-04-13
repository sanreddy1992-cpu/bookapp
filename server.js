const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database Setup ──
const DB_PATH = process.env.DB_PATH || './data/bookapp.db';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// Promise wrappers
const dbRun = (sql, params=[]) => new Promise((res,rej) => db.run(sql, params, function(err){ err ? rej(err) : res(this); }));
const dbGet = (sql, params=[]) => new Promise((res,rej) => db.get(sql, params, (err,row) => err ? rej(err) : res(row)));
const dbAll = (sql, params=[]) => new Promise((res,rej) => db.all(sql, params, (err,rows) => err ? rej(err) : res(rows)));
const dbExec = (sql) => new Promise((res,rej) => db.exec(sql, err => err ? rej(err) : res()));

// Create tables
dbExec(`
  CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    pass TEXT NOT NULL,
    name TEXT NOT NULL,
    district TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    activated INTEGER DEFAULT 0,
    delivery_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT DEFAULT '',
    rank TEXT NOT NULL,
    books INTEGER DEFAULT 1,
    sub_year INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    unsub_reason TEXT DEFAULT '',
    renewed_year INTEGER,
    amount INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (unit_id) REFERENCES units(id)
  );
  CREATE TABLE IF NOT EXISTS admin (
    id TEXT PRIMARY KEY,
    pass TEXT NOT NULL
  );
`).then(async () => {
  const admin = await dbGet('SELECT id FROM admin WHERE id = ?', ['admin']);
  if (!admin) await dbRun('INSERT INTO admin (id, pass) VALUES (?, ?)', ['admin', 'admin123']);
  console.log('✅ Database ready');
}).catch(err => console.error('DB Error:', err));

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bookapp_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Auth Middleware ──
const requireAdmin = (req,res,next) => req.session.role==='admin' ? next() : res.status(401).json({error:'Admin login అవ్వాలి'});
const requireAuth  = (req,res,next) => req.session.role ? next() : res.status(401).json({error:'Login అవ్వాలి'});
const requireUnit  = (req,res,next) => (req.session.role==='unit'||req.session.role==='admin') ? next() : res.status(401).json({error:'Unit login అవ్వాలి'});

const PC_RANKS = ['PC','HC'];
const getPrice = r => PC_RANKS.includes(r) ? 300 : 380;
const CUR_YEAR = () => new Date().getFullYear();

// ═══ AUTH ═══
app.post('/api/login', async (req,res) => {
  const {id, pass, type} = req.body;
  try {
    if (type === 'admin') {
      const admin = await dbGet('SELECT * FROM admin WHERE id = ?', [id]);
      if (admin && admin.pass === pass) {
        req.session.role='admin'; req.session.userId=id;
        return res.json({success:true, role:'admin', name:'Administrator'});
      }
    } else {
      const unit = await dbGet('SELECT * FROM units WHERE id = ?', [id]);
      if (unit && unit.pass === pass) {
        if (unit.status === 'inactive') return res.json({success:false, inactive:true});
        req.session.role='unit'; req.session.userId=id; req.session.unitName=unit.name;
        return res.json({success:true, role:'unit', name:unit.name, unitId:id});
      }
    }
    res.json({success:false});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/logout', (req,res) => { req.session.destroy(); res.json({success:true}); });

app.get('/api/me', (req,res) => {
  if (!req.session.role) return res.json({loggedIn:false});
  res.json({loggedIn:true, role:req.session.role, userId:req.session.userId, name:req.session.unitName||'Administrator'});
});

// ═══ UNITS ═══
app.get('/api/units', requireAdmin, async (req,res) => {
  try {
    const units = await dbAll('SELECT * FROM units ORDER BY created_at DESC');
    const result = await Promise.all(units.map(async u => {
      const total = await dbGet('SELECT COUNT(*) as c FROM members WHERE unit_id = ?', [u.id]);
      const active = await dbGet("SELECT COUNT(*) as c FROM members WHERE unit_id = ? AND status = 'active'", [u.id]);
      return {...u, totalMembers:total.c, activeMembers:active.c};
    }));
    res.json(result);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/units/:id', requireAuth, async (req,res) => {
  if (req.session.role==='unit' && req.session.userId!==req.params.id) return res.status(403).json({error:'Access denied'});
  try {
    const unit = await dbGet('SELECT * FROM units WHERE id = ?', [req.params.id]);
    if (!unit) return res.status(404).json({error:'Unit కనుగొనబడలేదు'});
    res.json(unit);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/units', requireAdmin, async (req,res) => {
  const {id,pass,name,district} = req.body;
  if (!id||!pass||!name||!district) return res.status(400).json({error:'అన్ని fields అవసరం'});
  try {
    const exists = await dbGet('SELECT id FROM units WHERE id = ?', [id]);
    if (exists) return res.status(400).json({error:'ఈ ID ఇప్పటికే ఉంది'});
    await dbRun('INSERT INTO units (id,pass,name,district) VALUES (?,?,?,?)', [id,pass,name,district]);
    res.json({success:true, message:`${name} విజయవంతంగా జోడించబడింది`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/units/:id', requireAdmin, async (req,res) => {
  const {name,district,pass,status,delivery_status} = req.body;
  try {
    if (delivery_status) await dbRun('UPDATE units SET delivery_status=? WHERE id=?', [delivery_status, req.params.id]);
    if (name||district||pass||status) {
      const u = await dbGet('SELECT * FROM units WHERE id=?', [req.params.id]);
      await dbRun('UPDATE units SET name=?,district=?,pass=?,status=? WHERE id=?',
        [name||u.name, district||u.district, pass||u.pass, status||u.status, req.params.id]);
    }
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.patch('/api/units/:id/toggle', requireAdmin, async (req,res) => {
  try {
    const unit = await dbGet('SELECT status FROM units WHERE id=?', [req.params.id]);
    if (!unit) return res.status(404).json({error:'Unit కనుగొనబడలేదు'});
    const newStatus = unit.status==='active' ? 'inactive' : 'active';
    await dbRun('UPDATE units SET status=? WHERE id=?', [newStatus, req.params.id]);
    res.json({success:true, status:newStatus});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══ MEMBERS ═══
app.get('/api/members', requireAdmin, async (req,res) => {
  const {search,rank,status} = req.query;
  let q = 'SELECT m.*, u.name as unit_name FROM members m JOIN units u ON m.unit_id=u.id WHERE 1=1';
  const p = [];
  if (search) { q+=' AND (m.name LIKE ? OR m.phone LIKE ? OR m.id LIKE ?)'; const s=`%${search}%`; p.push(s,s,s); }
  if (rank==='pc') q+=` AND m.rank IN ('PC','HC')`;
  else if (rank==='officer') q+=` AND m.rank NOT IN ('PC','HC')`;
  else if (rank&&rank!=='all') { q+=' AND m.rank=?'; p.push(rank); }
  if (status==='active') q+=` AND m.status='active'`;
  else if (status==='unsub') q+=` AND m.status='unsubscribed'`;
  else if (status==='renewed') q+=` AND m.status='active' AND m.renewed_year=${CUR_YEAR()}`;
  else if (status==='pending') q+=` AND m.status='active' AND (m.renewed_year IS NULL OR m.renewed_year!=${CUR_YEAR()})`;
  q+=' ORDER BY m.created_at DESC';
  try { res.json(await dbAll(q, p)); } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/units/:uid/members', requireAuth, async (req,res) => {
  if (req.session.role==='unit' && req.session.userId!==req.params.uid) return res.status(403).json({error:'Access denied'});
  const {search,rank,status} = req.query;
  let q = 'SELECT * FROM members WHERE unit_id=?';
  const p = [req.params.uid];
  if (search) { q+=' AND (name LIKE ? OR phone LIKE ? OR id LIKE ?)'; const s=`%${search}%`; p.push(s,s,s); }
  if (rank==='pc') q+=` AND rank IN ('PC','HC')`;
  else if (rank==='officer') q+=` AND rank NOT IN ('PC','HC')`;
  else if (rank&&rank!=='all') { q+=' AND rank=?'; p.push(rank); }
  if (status==='active') q+=` AND status='active'`;
  else if (status==='unsub') q+=` AND status='unsubscribed'`;
  else if (status==='renewed') q+=` AND status='active' AND renewed_year=${CUR_YEAR()}`;
  else if (status==='pending') q+=` AND status='active' AND (renewed_year IS NULL OR renewed_year!=${CUR_YEAR()})`;
  q+=' ORDER BY created_at DESC';
  try { res.json(await dbAll(q, p)); } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/units/:uid/members', requireUnit, async (req,res) => {
  if (req.session.role==='unit' && req.session.userId!==req.params.uid) return res.status(403).json({error:'Access denied'});
  const {name,phone,address,rank,books,sub_year} = req.body;
  if (!name||!phone||!rank) return res.status(400).json({error:'పేరు, ఫోన్, Rank అవసరం'});
  try {
    const uid = req.params.uid;
    const count = await dbGet('SELECT COUNT(*) as c FROM members WHERE unit_id=?', [uid]);
    const memberId = `${uid}_M${String(count.c+1).padStart(4,'0')}`;
    const amount = (books||1) * getPrice(rank);
    const subYear = sub_year || CUR_YEAR();
    const renewedYear = subYear===CUR_YEAR() ? CUR_YEAR() : null;
    await dbRun('INSERT INTO members (id,unit_id,name,phone,address,rank,books,sub_year,amount,renewed_year) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [memberId,uid,name,phone,address||'',rank,books||1,subYear,amount,renewedYear]);
    res.json({success:true, id:memberId, amount, message:`${name} విజయవంతంగా జోడించబడ్డారు`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/members/:id', requireUnit, async (req,res) => {
  try {
    const m = await dbGet('SELECT * FROM members WHERE id=?', [req.params.id]);
    if (!m) return res.status(404).json({error:'Member కనుగొనబడలేదు'});
    if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
    const {name,phone,address,rank,books,sub_year} = req.body;
    const newRank = rank||m.rank;
    const newBooks = books||m.books;
    const amount = newBooks * getPrice(newRank);
    await dbRun('UPDATE members SET name=?,phone=?,address=?,rank=?,books=?,sub_year=?,amount=? WHERE id=?',
      [name||m.name, phone||m.phone, address??m.address, newRank, newBooks, sub_year||m.sub_year, amount, req.params.id]);
    res.json({success:true, amount});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.patch('/api/members/:id/renew', requireUnit, async (req,res) => {
  try {
    const m = await dbGet('SELECT * FROM members WHERE id=?', [req.params.id]);
    if (!m) return res.status(404).json({error:'Member కనుగొనబడలేదు'});
    if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
    const {books,rank} = req.body;
    const newRank = rank||m.rank;
    const newBooks = books||m.books;
    const amount = newBooks * getPrice(newRank);
    const yr = CUR_YEAR();
    await dbRun('UPDATE members SET books=?,rank=?,amount=?,renewed_year=?,sub_year=? WHERE id=?',
      [newBooks, newRank, amount, yr, yr, req.params.id]);
    res.json({success:true, amount, renewedYear:yr});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.patch('/api/members/:id/unsubscribe', requireUnit, async (req,res) => {
  try {
    const m = await dbGet('SELECT * FROM members WHERE id=?', [req.params.id]);
    if (!m) return res.status(404).json({error:'Member కనుగొనబడలేదు'});
    if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
    const {reason} = req.body;
    if (!reason) return res.status(400).json({error:'Reason అవసరం'});
    await dbRun("UPDATE members SET status='unsubscribed',unsub_reason=? WHERE id=?", [reason, req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.patch('/api/members/:id/reactivate', requireUnit, async (req,res) => {
  try {
    const m = await dbGet('SELECT * FROM members WHERE id=?', [req.params.id]);
    if (!m) return res.status(404).json({error:'Member కనుగొనబడలేదు'});
    if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
    await dbRun("UPDATE members SET status='active',unsub_reason='' WHERE id=?", [req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══ REPORTS ═══
app.get('/api/reports', requireAdmin, async (req,res) => {
  try {
    const yr = CUR_YEAR();
    const byRank = await dbAll(`SELECT rank, COUNT(*) as count, SUM(books) as total_books, SUM(amount) as total_amount FROM members WHERE status='active' GROUP BY rank`);
    const byUnit = await dbAll(`SELECT u.id,u.name,u.district, COUNT(m.id) as total, SUM(CASE WHEN m.status='active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN m.status='active' AND m.renewed_year=? THEN 1 ELSE 0 END) as renewed, SUM(CASE WHEN m.status='unsubscribed' THEN 1 ELSE 0 END) as unsub, SUM(CASE WHEN m.status='active' THEN m.amount ELSE 0 END) as amount FROM units u LEFT JOIN members m ON u.id=m.unit_id GROUP BY u.id ORDER BY u.name`, [yr]);
    const byReason = await dbAll(`SELECT unsub_reason as reason, COUNT(*) as count FROM members WHERE status='unsubscribed' AND unsub_reason!='' GROUP BY unsub_reason ORDER BY count DESC`);
    const summary = await dbGet(`SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsub, SUM(CASE WHEN status='active' AND renewed_year=? THEN 1 ELSE 0 END) as renewed, SUM(CASE WHEN status='active' THEN amount ELSE 0 END) as total_amount FROM members`, [yr]);
    res.json({byRank,byUnit,byReason,summary});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
  console.log(`📖 పుస్తక చందా వ్యవస్థ started!`);
});
