import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import { signToken } from '../middleware/auth.js';

export const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  const exists = await query('select id from app_user where email=$1', [email]);
  if (exists.length) return res.status(409).json({ error: 'email_in_use' });
  const hash = await bcrypt.hash(password, 10);
  const rows = await query('insert into app_user(name,email,password_hash) values($1,$2,$3) returning id,name,email', [name, email, hash]);
  const user = rows[0];
  const token = signToken({ id: user.id, email: user.email, name: user.name });
  res.json({ user, token });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const rows = await query('select id,name,email,password_hash from app_user where email=$1', [email]);
  if (!rows.length) return res.status(401).json({ error: 'invalid_credentials' });
  const u = rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = signToken({ id: u.id, email: u.email, name: u.name });
  res.json({ user: { id: u.id, name: u.name, email: u.email }, token });
});
