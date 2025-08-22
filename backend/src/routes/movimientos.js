import express from 'express';
import { query } from '../lib/db.js';

export const movimientosRouter = express.Router();

movimientosRouter.get('/', async (req, res) => {
  const { producto_id } = req.query;
  const params = [req.user.id];
  let where = 'where m.user_id=$1';
  if (producto_id) { params.push(Number(producto_id)); where += ` and m.producto_id=$${params.length}`; }
  const rows = await query(`
    select m.id, m.producto_id, p.nombre as producto, m.tipo, m.cantidad, m.motivo, m.created_at
    from movimiento m
    join producto p on p.id=m.producto_id
    ${where}
    order by m.created_at desc
  `, params);
  res.json(rows);
});

movimientosRouter.post('/', async (req, res) => {
  const { producto_id, tipo, cantidad, motivo } = req.body || {};
  if (!producto_id || !tipo || !cantidad) return res.status(400).json({ error: 'missing_fields' });
  if (!['IN','OUT'].includes(tipo)) return res.status(400).json({ error: 'invalid_tipo' });
  const qty = Number(cantidad);
  if (!(qty > 0)) return res.status(400).json({ error: 'invalid_cantidad' });

  // transacción
  const client = await (await import('../lib/db.js')).pool.connect();
  try {
    await client.query('begin');
    const result = await client.query('select stock from producto where id=$1 and user_id=$2 for update', [producto_id, req.user.id]);
    if (!result.rows.length) { await client.query('rollback'); return res.status(404).json({ error: 'producto_not_found' }); }
    const current = Number(result.rows[0].stock || 0);
    const newStock = tipo === 'IN' ? current + qty : current - qty;
    if (newStock < 0) { await client.query('rollback'); return res.status(400).json({ error: 'stock_negative' }); }
    await client.query('update producto set stock=$1, updated_at=now() where id=$2 and user_id=$3', [newStock, producto_id, req.user.id]);
    const ins = await client.query('insert into movimiento(producto_id, tipo, cantidad, motivo, user_id) values($1,$2,$3,$4,$5) returning *',
      [producto_id, tipo, qty, motivo || null, req.user.id]);
    await client.query('commit');
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
});
