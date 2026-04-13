const express = require('express');
const Database = require('better-sqlite3');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database Setup ──
const DB_PATH = process.env.DB_PATH || './data/bookapp.db';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY, pass TEXT NOT NULL, name TEXT NOT NULL,
    district TEXT NOT NULL, status TEXT DEFAULT 'active',
    delivery_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, name TEXT NOT NULL,
    phone TEXT NOT NULL, address TEXT DEFAULT '', rank TEXT NOT NULL,
    books INTEGER DEFAULT 1, sub_year INTEGER NOT NULL,
    status TEXT DEFAULT 'active', unsub_reason TEXT DEFAULT '',
    renewed_year INTEGER, amount INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (unit_id) REFERENCES units(id)
  );
  CREATE TABLE IF NOT EXISTS admin (id TEXT PRIMARY KEY, pass TEXT NOT NULL);
`);

if (!db.prepare('SELECT id FROM admin WHERE id=?').get('admin')) {
  db.prepare('INSERT INTO admin (id,pass) VALUES (?,?)').run('admin','admin123');
}
console.log('✅ Database ready');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bookapp_secret_2024',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const requireAdmin = (req,res,next) => req.session.role==='admin' ? next() : res.status(401).json({error:'Admin login అవ్వాలి'});
const requireAuth  = (req,res,next) => req.session.role ? next() : res.status(401).json({error:'Login అవ్వాలి'});
const requireUnit  = (req,res,next) => (req.session.role==='unit'||req.session.role==='admin') ? next() : res.status(401).json({error:'Unit login అవ్వాలి'});
const PC_RANKS = ['PC','HC'];
const getPrice = r => PC_RANKS.includes(r) ? 300 : 380;
const CUR_YEAR = () => new Date().getFullYear();

// AUTH
app.post('/api/login', (req,res) => {
  const {id,pass,type} = req.body;
  if (type==='admin') {
    const admin = db.prepare('SELECT * FROM admin WHERE id=?').get(id);
    if (admin && admin.pass===pass) { req.session.role='admin'; req.session.userId=id; return res.json({success:true,role:'admin',name:'Administrator'}); }
  } else {
    const unit = db.prepare('SELECT * FROM units WHERE id=?').get(id);
    if (unit && unit.pass===pass) {
      if (unit.status==='inactive') return res.json({success:false,inactive:true});
      req.session.role='unit'; req.session.userId=id; req.session.unitName=unit.name;
      return res.json({success:true,role:'unit',name:unit.name,unitId:id});
    }
  }
  res.json({success:false});
});
app.post('/api/logout', (req,res) => { req.session.destroy(); res.json({success:true}); });
app.get('/api/me', (req,res) => {
  if (!req.session.role) return res.json({loggedIn:false});
  res.json({loggedIn:true,role:req.session.role,userId:req.session.userId,name:req.session.unitName||'Administrator'});
});

// UNITS
app.get('/api/units', requireAdmin, (req,res) => {
  const units = db.prepare('SELECT * FROM units ORDER BY created_at DESC').all();
  const result = units.map(u => ({
    ...u,
    totalMembers: db.prepare('SELECT COUNT(*) as c FROM members WHERE unit_id=?').get(u.id).c,
    activeMembers: db.prepare("SELECT COUNT(*) as c FROM members WHERE unit_id=? AND status='active'").get(u.id).c
  }));
  res.json(result);
});
app.get('/api/units/:id', requireAuth, (req,res) => {
  if (req.session.role==='unit' && req.session.userId!==req.params.id) return res.status(403).json({error:'Access denied'});
  const unit = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!unit) return res.status(404).json({error:'Unit కనుగొనబడలేదు'});
  res.json(unit);
});
app.post('/api/units', requireAdmin, (req,res) => {
  const {id,pass,name,district} = req.body;
  if (!id||!pass||!name||!district) return res.status(400).json({error:'అన్ని fields అవసరం'});
  if (db.prepare('SELECT id FROM units WHERE id=?').get(id)) return res.status(400).json({error:'ఈ ID ఇప్పటికే ఉంది'});
  db.prepare('INSERT INTO units (id,pass,name,district) VALUES (?,?,?,?)').run(id,pass,name,district);
  res.json({success:true});
});
app.put('/api/units/:id', requireAdmin, (req,res) => {
  const {name,district,pass,status,delivery_status} = req.body;
  const u = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({error:'Not found'});
  db.prepare('UPDATE units SET name=?,district=?,pass=?,status=?,delivery_status=? WHERE id=?')
    .run(name||u.name, district||u.district, pass||u.pass, status||u.status, delivery_status||u.delivery_status, req.params.id);
  res.json({success:true});
});
app.patch('/api/units/:id/toggle', requireAdmin, (req,res) => {
  const unit = db.prepare('SELECT status FROM units WHERE id=?').get(req.params.id);
  if (!unit) return res.status(404).json({error:'Not found'});
  const newStatus = unit.status==='active'?'inactive':'active';
  db.prepare('UPDATE units SET status=? WHERE id=?').run(newStatus, req.params.id);
  res.json({success:true, status:newStatus});
});

// MEMBERS
app.get('/api/members', requireAdmin, (req,res) => {
  const {search,rank,status} = req.query;
  let q = 'SELECT m.*,u.name as unit_name FROM members m JOIN units u ON m.unit_id=u.id WHERE 1=1';
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
  res.json(db.prepare(q).all(...p));
});
app.get('/api/units/:uid/members', requireAuth, (req,res) => {
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
  res.json(db.prepare(q).all(...p));
});
app.post('/api/units/:uid/members', requireUnit, (req,res) => {
  if (req.session.role==='unit' && req.session.userId!==req.params.uid) return res.status(403).json({error:'Access denied'});
  const {name,phone,address,rank,books,sub_year} = req.body;
  if (!name||!phone||!rank) return res.status(400).json({error:'పేరు, ఫోన్, Rank అవసరం'});
  const uid = req.params.uid;
  const count = db.prepare('SELECT COUNT(*) as c FROM members WHERE unit_id=?').get(uid).c;
  const memberId = `${uid}_M${String(count+1).padStart(4,'0')}`;
  const amount = (books||1)*getPrice(rank);
  const subYear = sub_year||CUR_YEAR();
  const renewedYear = subYear===CUR_YEAR()?CUR_YEAR():null;
  db.prepare('INSERT INTO members (id,unit_id,name,phone,address,rank,books,sub_year,amount,renewed_year) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(memberId,uid,name,phone,address||'',rank,books||1,subYear,amount,renewedYear);
  res.json({success:true,id:memberId,amount,message:`${name} విజయవంతంగా జోడించబడ్డారు`});
});
app.put('/api/members/:id', requireUnit, (req,res) => {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({error:'Not found'});
  if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
  const {name,phone,address,rank,books,sub_year} = req.body;
  const newRank=rank||m.rank; const newBooks=books||m.books;
  const amount=newBooks*getPrice(newRank);
  db.prepare('UPDATE members SET name=?,phone=?,address=?,rank=?,books=?,sub_year=?,amount=? WHERE id=?')
    .run(name||m.name,phone||m.phone,address??m.address,newRank,newBooks,sub_year||m.sub_year,amount,req.params.id);
  res.json({success:true,amount});
});
app.patch('/api/members/:id/renew', requireUnit, (req,res) => {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({error:'Not found'});
  if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
  const {books,rank} = req.body;
  const newRank=rank||m.rank; const newBooks=books||m.books;
  const amount=newBooks*getPrice(newRank); const yr=CUR_YEAR();
  db.prepare('UPDATE members SET books=?,rank=?,amount=?,renewed_year=?,sub_year=? WHERE id=?')
    .run(newBooks,newRank,amount,yr,yr,req.params.id);
  res.json({success:true,amount,renewedYear:yr});
});
app.patch('/api/members/:id/unsubscribe', requireUnit, (req,res) => {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({error:'Not found'});
  if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
  const {reason} = req.body;
  if (!reason) return res.status(400).json({error:'Reason అవసరం'});
  db.prepare("UPDATE members SET status='unsubscribed',unsub_reason=? WHERE id=?").run(reason,req.params.id);
  res.json({success:true});
});
app.patch('/api/members/:id/reactivate', requireUnit, (req,res) => {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({error:'Not found'});
  if (req.session.role==='unit' && req.session.userId!==m.unit_id) return res.status(403).json({error:'Access denied'});
  db.prepare("UPDATE members SET status='active',unsub_reason='' WHERE id=?").run(req.params.id);
  res.json({success:true});
});

// REPORTS
app.get('/api/reports', requireAdmin, (req,res) => {
  const yr = CUR_YEAR();
  const byRank = db.prepare(`SELECT rank,COUNT(*) as count,SUM(books) as total_books,SUM(amount) as total_amount FROM members WHERE status='active' GROUP BY rank`).all();
  const byUnit = db.prepare(`SELECT u.id,u.name,u.district,COUNT(m.id) as total,SUM(CASE WHEN m.status='active' THEN 1 ELSE 0 END) as active,SUM(CASE WHEN m.status='active' AND m.renewed_year=? THEN 1 ELSE 0 END) as renewed,SUM(CASE WHEN m.status='unsubscribed' THEN 1 ELSE 0 END) as unsub,SUM(CASE WHEN m.status='active' THEN m.amount ELSE 0 END) as amount FROM units u LEFT JOIN members m ON u.id=m.unit_id GROUP BY u.id ORDER BY u.name`).all(yr);
  const byReason = db.prepare(`SELECT unsub_reason as reason,COUNT(*) as count FROM members WHERE status='unsubscribed' AND unsub_reason!='' GROUP BY unsub_reason ORDER BY count DESC`).all();
  const summary = db.prepare(`SELECT COUNT(*) as total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsub,SUM(CASE WHEN status='active' AND renewed_year=? THEN 1 ELSE 0 END) as renewed,SUM(CASE WHEN status='active' THEN amount ELSE 0 END) as total_amount FROM members`).get(yr);
  res.json({byRank,byUnit,byReason,summary});
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, () => { console.log(`✅ Server → http://localhost:${PORT}`); });
