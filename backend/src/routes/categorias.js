import express from 'express';
import { query } from '../lib/db.js';

export const categoriasRouter = express.Router();

categoriasRouter.get('/', async (req, res) => {
  const rows = await query('select id, nombre from categoria where user_id=$1 order by nombre asc', [req.user.id]);
  res.json(rows);
});

categoriasRouter.post('/', async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'missing_nombre' });
  const rows = await query('insert into categoria(nombre, user_id) values($1,$2) on conflict (user_id, nombre) do update set nombre=excluded.nombre returning id, nombre', [nombre, req.user.id]);
  res.status(201).json(rows[0]);
});

categoriasRouter.put('/:id', async (req, res) => {
  const { nombre } = req.body || {};
  const id = Number(req.params.id);
  const rows = await query('update categoria set nombre=$1 where id=$2 and user_id=$3 returning id, nombre', [nombre, id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

categoriasRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('delete from categoria where id=$1 and user_id=$2 returning id', [id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});
