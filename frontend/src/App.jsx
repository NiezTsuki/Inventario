import React, { useEffect, useMemo, useRef, useState } from 'react';
import logo from './assets/LOGO SORITAWOO.png';

const API = import.meta.env.VITE_API_URL || null; // si se define, podemos integrar login y API luego
const STORAGE_KEY = 'artist-alley-inventory-v1';


function formatUSD(n) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `$${n}`;
  }
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function toCSV(items) {
  const headers = ['id','sku','nombre','categoria','precio','stock','ubicacion','notas'];
  const esc = v => { v = (v??'').toString().replaceAll('"','""'); return /[\n,"]/.test(v) ? `"${v}"` : v; };
  const rows = items.map(it => headers.map(h => esc(it[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}
function parseCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',');
  const items = lines.slice(1).map(line => {
    const cells = line.split(','); // simple
    const obj = {}; headers.forEach((h,i) => obj[h] = cells[i] ?? '');
    obj.id = obj.id || crypto.randomUUID();
    obj.precio = Number(obj.precio||0); obj.stock = Number(obj.stock||0);
    return obj;
  });
  return items;
}

export default function App() {
  const [items, setItems] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : demoData;
  });
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState(10);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }, [items]);

  const categorias = useMemo(() => Array.from(new Set(items.map(i => i.categoria).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter(i => {
      const text = `${i.sku} ${i.nombre} ${i.categoria} ${i.ubicacion} ${i.notas}`.toLowerCase();
      const passText = !term || text.includes(term);
      const passCat = categoria === 'todas' || i.categoria === categoria;
      const passLow = !lowStockOnly || (i.stock ?? 0) <= lowStockThreshold;
      return passText && passCat && passLow;
    });
  }, [items, q, categoria, lowStockOnly, lowStockThreshold]);

  const valorTotal = useMemo(() => filtered.reduce((acc,i)=>acc+(i.precio||0)*(i.stock||0),0), [filtered]);

  function resetForm(){ setEditing({ id:null, sku:'', nombre:'', categoria:'', precio:0, stock:0, ubicacion:'', notas:'' }); setShowModal(true); }
  function editItem(it){ setEditing({...it}); setShowModal(true); }
  function saveItem(e){
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      id: editing?.id || crypto.randomUUID(),
      sku: String(fd.get('sku')||'').trim(),
      nombre: String(fd.get('nombre')||'').trim(),
      categoria: String(fd.get('categoria')||'').trim(),
      precio: Number(fd.get('precio')||0),
      stock: Number(fd.get('stock')||0),
      ubicacion: String(fd.get('ubicacion')||'').trim(),
      notas: String(fd.get('notas')||'').trim(),
    };
    if(!data.nombre){ alert('El nombre es obligatorio'); return; }
    setItems(prev => prev.some(p=>p.id===data.id) ? prev.map(p=>p.id===data.id?data:p) : [data, ...prev]);
    setShowModal(false);
  }
  function removeItem(id){ if(!confirm('¿Eliminar este producto?')) return; setItems(prev => prev.filter(p=>p.id!==id)); }
  function exportCSV(){ const csv = toCSV(items); const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); downloadTextFile(`inventario-artistalley-${ts}.csv`, csv); }
  function onImportFile(e){
    const file = e.target.files?.[0]; if(!file) return;
    const r = new FileReader(); r.onload = () => { try { const parsed = parseCSV(String(r.result||'')); if(!parsed.length){ alert('CSV vacío'); return; } setItems(parsed); alert('Inventario importado'); } catch { alert('Error al importar CSV'); } };
    r.readAsText(file, 'utf-8'); e.target.value='';
  }
  function clearAll(){ if(!confirm('¿Borrar todo?')) return; setItems([]); }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
  src={logo}
  alt="Soritawo"
  className="w-10 h-10 rounded-full object-cover ring-1 ring-black/10"
/>
            <div>
              <h1 className="text-xl font-semibold">Inventario — Soritawo</h1>
              <p className="text-xs text-gray-500">Gestión rápida • Guardado local</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetForm} className="px-3 py-2 rounded-xl bg-black text-white text-sm hover:opacity-90">+ Producto</button>
            <button onClick={exportCSV} className="px-3 py-2 rounded-xl border text-sm">Exportar CSV</button>
            <button onClick={()=>fileRef.current?.click()} className="px-3 py-2 rounded-xl border text-sm">Importar CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile}/>
            <button onClick={clearAll} className="px-3 py-2 rounded-xl border text-sm text-red-600">Limpiar</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid md:grid-cols-4 gap-3 mb-4">
          <div className="md:col-span-2">
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por SKU, nombre, notas…" className="w-full px-3 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-black"/>
          </div>
          <div>
            <select value={categoria} onChange={e=>setCategoria(e.target.value)} className="w-full px-3 py-2 rounded-xl border">
              <option value="todas">Todas las categorías</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input id="low" type="checkbox" checked={lowStockOnly} onChange={e=>setLowStockOnly(e.target.checked)} />
            <label htmlFor="low" className="text-sm">Solo stock ≤</label>
            <input type="number" min={0} value={lowStockThreshold} onChange={e=>setLowStockThreshold(Number(e.target.value)||0)} className="w-20 px-2 py-1 rounded-lg border"/>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <div className="p-4 rounded-2xl bg-white border">
            <p className="text-xs text-gray-500">Productos visibles</p>
            <p className="text-2xl font-semibold">{filtered.length}</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border">
            <p className="text-xs text-gray-500">Unidades totales (vista)</p>
            <p className="text-2xl font-semibold">{filtered.reduce((a,b)=>a+(b.stock||0),0)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-white border">
            <p className="text-xs text-gray-500">Valor inventario (vista)</p>
            <p className="text-2xl font-semibold">{formatUSD(valorTotal)}</p>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="text-left px-4 py-3">SKU</th>
                <th className="text-left px-4 py-3">Producto</th>
                <th className="text-left px-4 py-3">Categoría</th>
                <th className="text-right px-4 py-3">Precio</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Ubicación</th>
                <th className="text-left px-4 py-3">Notas</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No hay productos que coincidan.</td></tr>
              )}
              {filtered.map(it => {
                const low = (it.stock ?? 0) <= lowStockThreshold;
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{it.sku}</td>
                    <td className="px-4 py-3">{it.nombre}</td>
                    <td className="px-4 py-3">{it.categoria}</td>
                    <td className="px-4 py-3 text-right">{formatUSD(it.precio)}</td>
                    <td className={"px-4 py-3 text-right " + (low ? "text-red-600 font-semibold" : "")}>{it.stock}</td>
                    <td className="px-4 py-3">{it.ubicacion}</td>
                    <td className="px-4 py-3 max-w-[28ch] truncate" title={it.notas}>{it.notas}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={()=>editItem(it)} className="px-2 py-1 rounded-lg border">Editar</button>
                        <button onClick={()=>removeItem(it.id)} className="px-2 py-1 rounded-lg border text-red-600">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4" onClick={()=>setShowModal(false)}>
          <div className="bg-white w-full max-w-2xl rounded-2xl border shadow-xl" onClick={e=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing?.id ? "Editar producto" : "Nuevo producto"}</h2>
              <button onClick={()=>setShowModal(false)} className="px-3 py-1 rounded-xl border">Cerrar</button>
            </div>
            <form onSubmit={saveItem} className="p-4 grid sm:grid-cols-2 gap-4">
              <div className="grid gap-1"><label className="text-xs text-gray-600">SKU</label><input name="sku" defaultValue={editing?.sku||''} className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1"><label className="text-xs text-gray-600">Nombre*</label><input name="nombre" defaultValue={editing?.nombre||''} required className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1"><label className="text-xs text-gray-600">Categoría</label><input name="categoria" defaultValue={editing?.categoria||''} className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1"><label className="text-xs text-gray-600">Precio (USD)</label><input name="precio" type="number" min={0} step={0.01} defaultValue={editing?.precio??0} className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1"><label className="text-xs text-gray-600">Stock</label><input name="stock" type="number" min={0} step={1} defaultValue={editing?.stock??0} className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1"><label className="text-xs text-gray-600">Ubicación</label><input name="ubicacion" defaultValue={editing?.ubicacion||''} className="px-3 py-2 rounded-xl border"/></div>
              <div className="grid gap-1 sm:col-span-2"><label className="text-xs text-gray-600">Notas</label><textarea name="notas" defaultValue={editing?.notas||''} rows={3} className="px-3 py-2 rounded-xl border"/></div>
              <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={()=>setShowModal(false)} className="px-3 py-2 rounded-xl border">Cancelar</button>
                <button type="submit" className="px-3 py-2 rounded-xl bg-black text-white">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="py-10 text-center text-xs text-gray-500">Hecho con 💖 para mi esposa</footer>
    </div>
  );
}
