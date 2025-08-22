import express from 'express';
import { query } from '../lib/db.js';

export const productosRouter = express.Router();

productosRouter.get('/', async (req, res) => {
  const { q, categoria_id, low_stock, threshold } = req.query;
  const params = [req.user.id];
  let where = 'where p.user_id=$1';
  if (q) { params.push(`%${q}%`); where += ` and (p.sku ilike $${params.length} or p.nombre ilike $${params.length} or coalesce(p.notas,'') ilike $${params.length})`; }
  if (categoria_id) { params.push(Number(categoria_id)); where += ` and p.categoria_id=$${params.length}`; }
  if (low_stock === 'true') { params.push(Number(threshold || 10)); where += ` and p.stock <= $${params.length}`; }
  const rows = await query(`
    select p.id, p.sku, p.nombre, p.categoria_id, c.nombre as categoria, p.precio, p.stock, p.ubicacion, p.notas, p.created_at, p.updated_at
    from producto p
    left join categoria c on c.id=p.categoria_id
    ${where}
    order by p.updated_at desc
  `, params);
  res.json(rows);
});

productosRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(`
    select p.id, p.sku, p.nombre, p.categoria_id, c.nombre as categoria, p.precio, p.stock, p.ubicacion, p.notas, p.created_at, p.updated_at
    from producto p
    left join categoria c on c.id=p.categoria_id
    where p.id=$1 and p.user_id=$2
  `, [id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

productosRouter.post('/', async (req, res) => {
  const { sku, nombre, categoria_id, precio, stock, ubicacion, notas } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'missing_nombre' });
  const rows = await query(`
    insert into producto(sku, nombre, categoria_id, precio, stock, ubicacion, notas, user_id)
    values($1,$2,$3,$4,$5,$6,$7,$8)
    returning id, sku, nombre, categoria_id, precio, stock, ubicacion, notas, created_at, updated_at
  `, [sku || null, nombre, categoria_id || null, Number(precio||0), Number(stock||0), ubicacion || null, notas || null, req.user.id]);
  res.status(201).json(rows[0]);
});

productosRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { sku, nombre, categoria_id, precio, stock, ubicacion, notas } = req.body || {};
  const rows = await query(`
    update producto set
      sku=$1, nombre=$2, categoria_id=$3, precio=$4, stock=$5, ubicacion=$6, notas=$7, updated_at=now()
    where id=$8 and user_id=$9
    returning id, sku, nombre, categoria_id, precio, stock, ubicacion, notas, created_at, updated_at
  `, [sku || null, nombre, categoria_id || null, Number(precio||0), Number(stock||0), ubicacion || null, notas || null, id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

productosRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('delete from producto where id=$1 and user_id=$2 returning id', [id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Export CSV
productosRouter.get('/export/csv', async (req, res) => {
  const rows = await query(`
    select p.id, coalesce(p.sku,'') as sku, p.nombre, coalesce(c.nombre,'') as categoria, p.precio, p.stock, coalesce(p.ubicacion,'') as ubicacion, coalesce(p.notas,'') as notas
    from producto p left join categoria c on c.id=p.categoria_id
    where p.user_id=$1
    order by p.updated_at desc
  `, [req.user.id]);
  const headers = ['id','sku','nombre','categoria','precio','stock','ubicacion','notas'];
  const esc = v => {
    v = (v ?? '').toString().replace(/"/g, '""');
    return /[\n,"]/.test(v) ? `"${v}"` : v;
  };
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inventario.csv"');
  res.send(csv);
});

// Import CSV (multipart/form-data, field: file)
productosRouter.post('/import', async (req, res) => {
  const f = req.files?.file;
  if (!f) return res.status(400).json({ error: 'missing_file' });
  const text = f.data.toString('utf-8');
  const lines = text.replace(/\r/g,'').split('\n').filter(Boolean);
  const headers = lines.shift().split(',');
  const idx = (k)=>headers.findIndex(h=>h.trim()===k);
  const col = { id: idx('id'), sku: idx('sku'), nombre: idx('nombre'), categoria: idx('categoria'), precio: idx('precio'), stock: idx('stock'), ubicacion: idx('ubicacion'), notas: idx('notas') };
  let count = 0;
  for (const line of lines) {
    // simple split; si tu CSV tiene comas entrecomilladas, usa un parser robusto
    const cells = line.split(',');
    const nombre = cells[col.nombre];
    if (!nombre) continue;
    const categoriaNombre = cells[col.categoria] || null;
    let categoria_id = null;
    if (categoriaNombre) {
      const c = await query('insert into categoria(nombre, user_id) values($1,$2) on conflict (user_id, nombre) do update set nombre=excluded.nombre returning id', [categoriaNombre, req.user.id]);
      categoria_id = c[0]?.id;
    }
    const sku = cells[col.sku] || null;
    const precio = Number(cells[col.precio] || 0);
    const stock = Number(cells[col.stock] || 0);
    const ubicacion = cells[col.ubicacion] || null;
    const notas = cells[col.notas] || null;
    await query(`
      insert into producto(sku, nombre, categoria_id, precio, stock, ubicacion, notas, user_id)
      values($1,$2,$3,$4,$5,$6,$7,$8)
    `, [sku, nombre, categoria_id, precio, stock, ubicacion, notas, req.user.id]);
    count++;
  }
  res.json({ ok: true, imported: count });
});
