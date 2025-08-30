import React, { useEffect, useMemo, useState } from 'react';
import logo from './assets/LOGO SORITAWOO.png';

/* ================== Config & Utils ================== */
const STORAGE_KEY = 'artist-alley-inventory-v1';
const SALES_KEY   = 'artist-alley-sales-v1';
const ADJUST_KEY  = 'artist-alley-adjustments-v1'; // devoluciones y anulaciones

function formatCLP(n) {
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  } catch {
    return `$${n ?? 0}`;
  }
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function makeId() {
  return (crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
}

function parseNumber(v) {
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/* ================== Carga / Guardado ================== */
function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeItem) : [];
  } catch { return []; }
}
function saveItems(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
}
function normalizeItem(obj) {
  const out = { ...obj };
  out.id        = out.id ?? makeId();
  out.sku       = String(out.sku ?? '').trim();
  out.nombre    = String(out.nombre ?? '').trim();
  out.precio    = parseNumber(out.precio);
  out.stock     = Math.max(0, parseNumber(out.stock));
  out.notas     = String(out.notas ?? '');

  // categoría y aliases (coma separada)
  out.categoria = String(out.categoria ?? '').trim();
  out.aliases   = String(out.aliases ?? '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
                    .join(',');
  return out;
}

function loadSales() {
  try { return JSON.parse(localStorage.getItem(SALES_KEY) || '[]'); }
  catch { return []; }
}
function saveSales(sales) {
  try { localStorage.setItem(SALES_KEY, JSON.stringify(sales)); } catch {}
}

// ajuste = { id, ts, type: 'DEVOLUCION'|'ANULACION', refSaleId:string, items:[{id, qty}] }
function loadAjustes() {
  try { return JSON.parse(localStorage.getItem(ADJUST_KEY) || '[]'); }
  catch { return []; }
}
function saveAjustes(list) {
  try { localStorage.setItem(ADJUST_KEY, JSON.stringify(list)); } catch {}
}

/* ================== Componente Principal ================== */
export default function App() {
  // inventario
  const [items, setItems] = useState(loadItems);
  const [busqueda, setBusqueda] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);

  // filtros / categorías
  const [categoryFilter, setCategoryFilter] = useState('Todas');

  // POS (ventas)
  const [posOpen, setPosOpen] = useState(false);
  const [skuTerm, setSkuTerm] = useState('');
  // cart: { id: {id, sku, nombre, precio, qty, pay: 'EFECTIVO'|'YAPPY'} }
  const [cart, setCart] = useState({});
  const [sales, setSales] = useState(loadSales);
  const [lastSaleId, setLastSaleId] = useState(null);

  // post-venta
  const [ajustes, setAjustes] = useState(loadAjustes);
  const [historyOpen, setHistoryOpen] = useState(false);

  // selector de candidatos cuando hay varios matches
  const [pickMatches, setPickMatches] = useState(null); // null | [{...item}, ...]

  // devolución parcial
  const [returnFor, setReturnFor] = useState(null); // { saleId, lines: [{id, nombre, qtyVendida, qtyMax, qtyDevolver}] }

  useEffect(() => saveItems(items), [items]);
  useEffect(() => saveSales(sales), [sales]);
  useEffect(() => saveAjustes(ajustes), [ajustes]);

  // Atajos globales
  useEffect(() => {
    function onKey(e){
      if(e.key === 'F2'){ e.preventDefault(); setPosOpen(v => !v); }
      if(e.key === 'Escape'){ setPosOpen(false); setShowModal(false); setPickMatches(null); setReturnFor(null); setHistoryOpen(false); }
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undoLastSale(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lastSaleId, sales]);

  // categorías únicas
  const categorias = useMemo(() => {
    const set = new Set(items.map(i => i.categoria?.trim()).filter(Boolean));
    return ['Todas', ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  }, [items]);

  // listado filtrado
  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return items.filter(i => {
      const matchCat = (categoryFilter==='Todas') || (i.categoria?.trim() === categoryFilter);
      if(!matchCat) return false;

      if(!t) return true;
      const aliases = (i.aliases||'').toLowerCase();
      return (i.sku||'').toLowerCase().includes(t)
          || (i.nombre||'').toLowerCase().includes(t)
          || aliases.includes(t);
    });
  }, [items, busqueda, categoryFilter]);

  // métricas inventario
  const totalSkus = items.length;
  const totalUnidades = items.reduce((a,b)=>a + (b.stock||0), 0);
  const valorInventario = items.reduce((a,b)=>a + (b.stock||0)*(b.precio||0), 0);

  // === Ganancias por método y total (VENTAS OK - DEVOLUCIONES) ===
  const ganancias = useMemo(() => {
    let efectivo = 0, yappy = 0;

    // sumar ventas OK por línea con su método
    const saleMap = new Map(sales.map(s => [s.id, s]));
    for (const s of sales) {
      if (s.status === 'OK') {
        for (const l of s.items) {
          const amt = (l.precio || 0) * (l.qty || 0);
          if ((l.pay || 'EFECTIVO') === 'EFECTIVO') efectivo += amt; else yappy += amt;
        }
      }
    }

    // restar devoluciones (usamos método de la venta original línea por línea)
    for (const aj of ajustes) {
      if (aj.type !== 'DEVOLUCION') continue;
      const sale = saleMap.get(aj.refSaleId);
      if (!sale) continue;
      for (const it of aj.items) {
        const line = sale.items.find(li => li.id === it.id);
        if (!line) continue;
        const amt = (line.precio || 0) * (it.qty || 0);
        if ((line.pay || 'EFECTIVO') === 'EFECTIVO') efectivo -= amt; else yappy -= amt;
      }
    }

    return { efectivo, yappy, total: efectivo + yappy };
  }, [sales, ajustes]);

  /* ------------- CRUD INVENTARIO ------------- */
  function onSubmitItem(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const obj = normalizeItem({
      id: editItem?.id ?? makeId(),
      sku: fd.get('sku'),
      nombre: fd.get('nombre'),
      precio: fd.get('precio'),
      stock: fd.get('stock'),
      notas: fd.get('notas'),
      categoria: fd.get('categoria'),
      aliases: fd.get('aliases'),
    });
    setItems(prev => {
      const exists = prev.some(p => p.id === obj.id);
      const next = exists ? prev.map(p => p.id === obj.id ? obj : p) : [obj, ...prev];
      return next;
    });
    setShowModal(false);
    setEditItem(null);
  }

  function borrarItem(id) {
    if(!confirm('¿Eliminar este producto?')) return;
    setItems(prev => prev.filter(p => p.id !== id));
  }

  function exportarCSV() {
    const headers = ['id','sku','nombre','precio','stock','categoria','aliases','notas'];
    const rows = items.map(i => [i.id,i.sku,i.nombre,i.precio,i.stock,i.categoria||'',i.aliases||'',i.notas||'']);
    const csv = [headers.join(','),
      ...rows.map(r => r.map(v => {
        const t = (v??'').toString().replaceAll('"','""');
        return /[",\n]/.test(t) ? `"${t}"` : t;
      }).join(','))
    ].join('\n');
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    downloadTextFile(`inventario-${ts}.csv`, csv);
  }

  function importarCSV(evt) {
    const file = evt.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
        const cols = head.split(',').map(s => s.trim().toLowerCase());
        const idx = (k) => cols.indexOf(k);
        const next = [];
        for(const line of lines){
          const parts = parseCSVLine(line);
          const obj = normalizeItem({
            id: parts[idx('id')] || makeId(),
            sku: parts[idx('sku')] || '',
            nombre: parts[idx('nombre')] || '',
            precio: parts[idx('precio')] || 0,
            stock: parts[idx('stock')] || 0,
            categoria: parts[idx('categoria')] || '',
            aliases: parts[idx('aliases')] || '',
            notas: parts[idx('notas')] || '',
          });
          next.push(obj);
        }
        if(next.length === 0) { alert('CSV vacío'); return; }
        setItems(next);
        alert(`Importados ${next.length} productos ✓`);
      } catch (err) {
        console.error(err);
        alert('No se pudo importar el CSV');
      } finally {
        evt.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function parseCSVLine(line) {
    // separa respetando comillas
    const out = [];
    let cur = '', inQ = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){
        if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = !inQ;
      } else if(ch === ',' && !inQ){
        out.push(cur); cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /* ------------- POS (ventas) ------------- */
  function pushCart(item){
    setCart(prev => {
      const existing = prev[item.id];
      const nextQty = (existing?.qty || 0) + 1;
      return {
        ...prev,
        [item.id]: {
          id:item.id, sku:item.sku, nombre:item.nombre, precio:item.precio||0,
          qty: nextQty,
          pay: existing?.pay || 'EFECTIVO' // método por línea
        }
      };
    });
  }

  function addToCartByTerm(term){
    const t = term.trim().toLowerCase();
    if(!t) return;

    // 1) match SKU exacto
    let exact = items.find(i => (i.sku||'').toLowerCase() === t);
    if(exact){ pushCart(exact); setSkuTerm(''); return; }

    // 2) por nombre/alias que contengan
    const candidates = items.filter(i => {
      const name = (i.nombre||'').toLowerCase();
      const aliases = (i.aliases||'').toLowerCase();
      return name.includes(t) || aliases.includes(t);
    });

    if(candidates.length === 0){ alert('No se encontró el producto'); return; }
    if(candidates.length === 1){ pushCart(candidates[0]); setSkuTerm(''); return; }

    // 3) varios: dejar elegir (ordenados por categoría)
    setPickMatches(candidates.sort((a,b)=> (a.categoria||'').localeCompare(b.categoria||'')));
  }

  function setQty(itemId, qty){
    const q = Math.max(0, Number(qty)||0);
    setCart(prev => {
      const copy = {...prev};
      if(q <= 0) delete copy[itemId];
      else copy[itemId] = {...copy[itemId], qty:q};
      return copy;
    });
  }

  function setLinePay(itemId, method){
    setCart(prev => ({ ...prev, [itemId]: { ...prev[itemId], pay: method }}));
  }

  function clearCart(){ setCart({}); }

  function cartItems(){
    return Object.values(cart);
  }

  function cartTotal(){
    return cartItems().reduce((a,l)=> a + (l.precio||0)* (l.qty||0), 0);
  }

  function finalizeSale(){
    const lines = cartItems();
    if(lines.length === 0){ alert('Carrito vacío'); return; }

    // validar stock disponible
    const insufficient = [];
    for(const line of lines){
      const prod = items.find(x => x.id === line.id);
      const currentStock = prod?.stock ?? 0;
      if(line.qty > currentStock){
        insufficient.push(`${prod?.nombre || 'Producto'} (stock: ${currentStock}, pedido: ${line.qty})`);
      }
    }
    if(insufficient.length){
      alert('Stock insuficiente en:\n' + insufficient.join('\n'));
      return;
    }

    // rebajar stock
    const newItems = items.map(prod => {
      const line = cart[prod.id];
      if(!line) return prod;
      return { ...prod, stock: Math.max(0, (prod.stock||0) - line.qty) };
    });
    setItems(newItems);

    // registrar venta (líneas incluyen pay)
    const sale = {
      id: makeId(),
      ts: new Date().toISOString(),
      total: cartTotal(),
      items: lines.map(l => ({
        id:l.id, sku:l.sku, nombre:l.nombre, precio:l.precio, qty:l.qty,
        pay: l.pay || 'EFECTIVO',
        subtotal: (l.precio||0)*(l.qty||0)
      })),
      status: 'OK'
    };
    setSales(prev => [sale, ...prev]);
    setLastSaleId(sale.id);

    // reset
    clearCart();
    alert('Venta registrada ✓');
  }

  function undoLastSale(){
    if(!lastSaleId){ return; }
    const sale = sales.find(s => s.id === lastSaleId);
    if(!sale){ return; }

    // devolver stock
    setItems(prev => {
      const map = new Map(prev.map(p => [p.id, {...p}]));
      for(const l of sale.items){
        const p = map.get(l.id);
        if(p){ p.stock = (p.stock||0) + (l.qty||0); map.set(l.id, p); }
      }
      return Array.from(map.values());
    });

    // quitar del log (deshacer rápida)
    setSales(prev => prev.filter(s => s.id !== lastSaleId));
    setLastSaleId(null);
    alert('Última venta deshecha');
  }

  /* ------------- Post-venta: devoluciones / anulaciones ------------- */
  function returnedQtyMapForSale(saleId){
    const map = new Map();
    for(const aj of ajustes){
      if(aj.type==='DEVOLUCION' && aj.refSaleId===saleId){
        for(const l of aj.items){
          map.set(l.id, (map.get(l.id)||0) + (l.qty||0));
        }
      }
    }
    return map; // id -> qty devuelta
  }

  function voidSale(saleId){
    const sale = sales.find(s => s.id===saleId);
    if(!sale) return;
    if(!confirm('¿Anular venta completa? Esto reintegra todo el stock.')) return;

    // devolver todo al stock
    setItems(prev => {
      const map = new Map(prev.map(p => [p.id, {...p}]));
      for(const l of sale.items){
        const p = map.get(l.id);
        if(p){ p.stock = (p.stock||0) + (l.qty||0); map.set(l.id, p); }
      }
      return Array.from(map.values());
    });

    // marcar venta como ANULADA (no la borramos)
    setSales(prev => prev.map(s => s.id===saleId ? {...s, status:'ANULADA'} : s));

    // registrar ajuste
    const aj = { id: makeId(), ts: new Date().toISOString(), type:'ANULACION', refSaleId: saleId, items: sale.items.map(l=>({id:l.id, qty:l.qty})) };
    setAjustes(prev => [aj, ...prev]);

    alert('Venta anulada ✓');
  }

  function startReturn(sale){
    // calcula cuánto queda por poder devolver (vendida - ya devuelta)
    const devMap = returnedQtyMapForSale(sale.id);
    const lines = sale.items.map(l => {
      const yaDev = devMap.get(l.id)||0;
      const max = Math.max(0, (l.qty||0) - yaDev);
      return { id:l.id, nombre:l.nombre, qtyVendida:l.qty, qtyMax:max, qtyDevolver:0 };
    }).filter(x => x.qtyMax>0);

    if(lines.length===0){ alert('Nada por devolver.'); return; }
    setReturnFor({ saleId: sale.id, lines });
  }

  function clampInt(v, min, max){
    const n = Math.max(min, Math.min(max, parseInt(String(v||'0').replace(/[^0-9]/g,''),10) || 0));
    return n;
  }
  function updateReturnQty(index, qty){
    setReturnFor(prev => {
      const copy = {...prev, lines: prev.lines.map((l,i)=> i===index ? {...l, qtyDevolver: qty} : l)};
      return copy;
    });
  }

  function applyReturn(){
    const saleId = returnFor.saleId;
    const lines = returnFor.lines.filter(l => l.qtyDevolver>0);
    if(lines.length===0){ setReturnFor(null); return; }

    // sumar devueltos al stock
    setItems(prev => {
      const map = new Map(prev.map(p => [p.id, {...p}]));
      for(const l of lines){
        const p = map.get(l.id);
        if(p){ p.stock = (p.stock||0) + (l.qtyDevolver||0); map.set(l.id, p); }
      }
      return Array.from(map.values());
    });

    // registrar ajuste
    const aj = {
      id: makeId(),
      ts: new Date().toISOString(),
      type: 'DEVOLUCION',
      refSaleId: saleId,
      items: lines.map(l => ({ id:l.id, qty:l.qtyDevolver })),
    };
    setAjustes(prev => [aj, ...prev]);

    setReturnFor(null);
    alert('Devolución registrada ✓');
  }

  /* ------------- Limpiar historial ------------- */
  function clearSalesHistory() {
    if (!confirm('¿Borrar TODO el historial de ventas y ajustes? Esto pondrá las ganancias en $0.')) return;
    setSales([]);         // borra ventas
    setAjustes([]);       // borra devoluciones/anulaciones
    setLastSaleId(null);  // resetea “deshacer”
    alert('Historial limpiado ✓');
  }

  /* ================== UI ================== */
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src={logo} alt="logo" className="h-8 w-auto" />
          <h1 className="text-lg font-semibold">Inventario — Soritawo</h1>
          <div className="ml-auto flex items-center gap-2 header-actions">
            <button onClick={()=>setShowModal(true)} className="px-3 py-2 rounded-xl bg-black text-white text-sm">+ Producto</button>
            <button onClick={exportarCSV} className="px-3 py-2 rounded-xl border text-sm">Exportar</button>
            <label className="px-3 py-2 rounded-xl border text-sm cursor-pointer">
              Importar
              <input type="file" accept=".csv" className="hidden" onChange={importarCSV}/>
            </label>
            <button onClick={()=>{ if(confirm('¿Limpiar inventario?')) setItems([]); }} className="px-3 py-2 rounded-xl border text-sm">Limpiar</button>
            <button onClick={()=>setPosOpen(true)} className="px-3 py-2 rounded-xl bg-black text-white text-sm">Vender (F2)</button>
          </div>
        </div>
      </header>

      {/* Resumen inventario */}
      <section className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Productos</div>
          <div className="text-2xl font-semibold">{totalSkus}</div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Unidades</div>
          <div className="text-2xl font-semibold">{totalUnidades}</div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Valor inventario</div>
          <div className="text-2xl font-semibold">{formatCLP(valorInventario)}</div>
        </div>
      </section>

      {/* Resumen ganancias */}
      <section className="max-w-6xl mx-auto px-4 -mt-2 pb-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Ganancia Efectivo</div>
          <div className="text-2xl font-semibold">{formatCLP(ganancias.efectivo)}</div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Ganancia Yappy</div>
          <div className="text-2xl font-semibold">{formatCLP(ganancias.yappy)}</div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-xs text-gray-500">Ganancia Total</div>
          <div className="text-2xl font-semibold">{formatCLP(ganancias.total)}</div>
        </div>
      </section>

      {/* Búsqueda */}
      <section className="max-w-6xl mx-auto px-4">
        <div className="flex items-center gap-2">
          <input
            value={busqueda}
            onChange={(e)=>setBusqueda(e.target.value)}
            placeholder="Buscar por SKU, nombre o alias…"
            className="w-full px-3 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-black"
          />
        </div>
      </section>

      {/* Filtro por Categoría */}
      <section className="max-w-6xl mx-auto px-4 mt-2">
        <div className="flex flex-wrap gap-2">
          {categorias.map(cat => (
            <button
              key={cat}
              onClick={()=>setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-full border text-sm ${categoryFilter===cat ? 'bg-black text-white' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Tabla */}
      <section className="max-w-6xl mx-auto px-4 py-4">
        <div className="overflow-auto rounded-2xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2">SKU</th>
                <th className="text-left px-4 py-2">Producto</th>
                <th className="text-left px-4 py-2 hidden sm:table-cell">Categoría</th>
                <th className="text-right px-4 py-2">Precio</th>
                <th className="text-right px-4 py-2">Stock</th>
                <th className="text-left px-4 py-2 hidden sm:table-cell">Notas</th>
                <th className="px-4 py-2 hidden sm:table-cell">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Sin resultados…</td></tr>
              )}
              {filtrados.map(i => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{i.sku || '—'}</td>
                  <td className="px-4 py-2">
                    <div>{i.nombre}</div>
                    {i.aliases && <div className="text-xs text-gray-400">Alias: {i.aliases}</div>}
                  </td>
                  <td className="px-4 py-2 hidden sm:table-cell">{i.categoria || '-'}</td>
                  <td className="px-4 py-2 text-right">{formatCLP(i.precio)}</td>
                  <td className="px-4 py-2 text-right">{i.stock}</td>
                  <td className="px-4 py-2 hidden sm:table-cell">{i.notas}</td>
                  <td className="px-4 py-2 text-right hidden sm:table-cell">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="px-2 py-1 rounded-lg border" onClick={()=>{ setEditItem(i); setShowModal(true); }}>Editar</button>
                      <button className="px-2 py-1 rounded-lg border text-red-600" onClick={()=>borrarItem(i.id)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Crear/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-40" onClick={()=>{ setShowModal(false); setEditItem(null); }}>
          <div className="bg-white w-full max-w-xl rounded-2xl border shadow-xl" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editItem ? 'Editar producto' : 'Nuevo producto'}</h2>
              <button onClick={()=>{ setShowModal(false); setEditItem(null); }} className="px-3 py-1 rounded-xl border">Cerrar</button>
            </div>
            <form className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" onSubmit={onSubmitItem}>
              <div className="grid gap-1">
                <label className="text-xs text-gray-500">SKU</label>
                <input name="sku" defaultValue={editItem?.sku||''} className="px-3 py-2 rounded-xl border" placeholder="Opcional" />
              </div>
              <div className="grid gap-1 sm:col-span-1">
                <label className="text-xs text-gray-500">Nombre</label>
                <input name="nombre" defaultValue={editItem?.nombre||''} required className="px-3 py-2 rounded-xl border" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-gray-500">Precio</label>
                <input name="precio" defaultValue={editItem?.precio??0} type="number" min="0" step="1" className="px-3 py-2 rounded-xl border text-right" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-gray-500">Stock</label>
                <input name="stock" defaultValue={editItem?.stock??0} type="number" min="0" step="1" className="px-3 py-2 rounded-xl border text-right" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-gray-500 hidden sm:table-cell">Categoría</label>
                <input name="categoria" defaultValue={editItem?.categoria||''} className="px-3 py-2 rounded-xl border" placeholder="Ej: Botones" />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <label className="text-xs text-gray-500">Aliases (separados por coma)</label>
                <input name="aliases" defaultValue={editItem?.aliases||''} className="px-3 py-2 rounded-xl border" placeholder="Ej: Coca, Coca-Cola 350, CC350" />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <label className="text-xs text-gray-500 hidden sm:table-cell">Notas</label>
                <textarea name="notas" defaultValue={editItem?.notas||''} rows={3} className="px-3 py-2 rounded-xl border"/>
              </div>
              <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={()=>{ setShowModal(false); setEditItem(null); }} className="px-3 py-2 rounded-xl border">Cancelar</button>
                <button type="submit" className="px-3 py-2 rounded-xl bg-black text-white">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* POS — Bottom-sheet mobile-first */}
      {posOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50"
          onClick={() => setPosOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* Contenedor bottom-sheet en mobile / centrado en desktop */}
          <div
            className="absolute left-0 right-0 bottom-0 md:inset-0 md:m-auto md:h-[80vh] md:max-w-3xl bg-white rounded-t-3xl md:rounded-2xl shadow-xl border pos-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {/* “Handle” de arrastre visual */}
            <div className="flex justify-center py-2 md:hidden">
              <div className="h-1.5 w-12 rounded-full bg-gray-300" />
            </div>

            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="text-base md:text-lg font-semibold">Modo Venta</h2>
              <div className="flex items-center gap-2">
                <button onClick={()=>setHistoryOpen(true)} className="px-3 py-2 rounded-xl border text-sm">Historial</button>
                <button onClick={clearSalesHistory} className="px-3 py-2 rounded-xl border text-sm text-red-600">Limpiar historial</button>
                <button onClick={() => setPosOpen(false)} className="px-3 py-2 rounded-xl border text-sm" aria-label="Cerrar">Cerrar</button>
              </div>
            </div>

            {/* Contenido scrollable (barra Vender sticky incluida adentro) */}
            <div className="px-4 pt-3 pb-4 overflow-y-auto h-full">
              {/* Input rápido SKU/Nombre/Alias */}
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={skuTerm}
                  onChange={(e) => setSkuTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addToCartByTerm(skuTerm);
                    }
                  }}
                  placeholder="Escanea/Escribe SKU, nombre o alias y Enter"
                  className="flex-1 px-3 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-black text-base"
                  inputMode="search"
                />
                <button
                  onClick={() => addToCartByTerm(skuTerm)}
                  className="px-4 py-3 rounded-xl bg-black text-white text-base"
                >
                  Agregar
                </button>
              </div>

              {/* Lista de ítems del carrito (cards en mobile) */}
              <div className="mt-3 space-y-2">
                {Object.values(cart).length === 0 && (
                  <div className="px-3 py-10 text-center text-gray-500">
                    Agrega productos con Enter…
                  </div>
                )}

                {Object.values(cart).map((l) => {
                  const cat = items.find(x=>x.id===l.id)?.categoria;
                  return (
                    <div key={l.id} className="rounded-2xl border p-3 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-500 font-mono truncate">
                          {l.sku || '—'}
                        </div>
                        <div className="text-base font-medium truncate">
                          {l.nombre}
                        </div>
                        {/* Categoría debajo del nombre */}
                        <div className="text-xs text-gray-500">
                          {cat ? `[${cat}]` : ' '}
                        </div>
                        <div className="text-sm text-gray-600">
                          {formatCLP(l.precio)} c/u
                        </div>

                        {/* Método de pago por línea */}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={()=>setLinePay(l.id,'EFECTIVO')}
                            className={`px-3 py-1.5 rounded-lg border text-sm ${l.pay==='EFECTIVO' ? 'bg-black text-white' : ''}`}
                          >
                            Efectivo
                          </button>
                          <button
                            type="button"
                            onClick={()=>setLinePay(l.id,'YAPPY')}
                            className={`px-3 py-1.5 rounded-lg border text-sm ${l.pay==='YAPPY' ? 'bg-black text-white' : ''}`}
                          >
                            Yappy
                          </button>
                        </div>
                      </div>

                      {/* Steppers +/− simples (solo onClick) */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-stepper h-11 w-11 rounded-xl border text-2xl"
                          onClick={() => setQty(l.id, Math.max(0, (l.qty || 0) - 1))}
                          aria-label="Disminuir"
                        >
                          −
                        </button>

                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="w-16 h-11 text-center rounded-xl border text-lg"
                          value={l.qty}
                          onChange={(e) =>
                            setQty(l.id, e.target.value.replace(/[^0-9]/g, ''))
                          }
                        />

                        <button
                          type="button"
                          className="btn-stepper h-11 w-11 rounded-xl border text-2xl"
                          onClick={() => setQty(l.id, (l.qty || 0) + 1)}
                          aria-label="Aumentar"
                        >
                          +
                        </button>
                      </div>

                      <div className="text-right min-w-[88px]">
                        <div className="text-sm text-gray-500">Subtotal</div>
                        <div className="text-base font-semibold">
                          {formatCLP((l.precio || 0) * (l.qty || 0))}
                        </div>
                      </div>

                      <button
                        onClick={() => setQty(l.id, 0)}
                        className="h-11 px-3 rounded-xl border text-red-600"
                      >
                        Quitar
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Barra de acciones (sticky) SIEMPRE visible dentro del sheet */}
              <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t mt-3 pb-safe">
                <div className="py-3 flex items-center justify-between gap-2">
                  <div className="text-lg md:text-xl font-semibold">
                    Total: {formatCLP(cartTotal())}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={clearCart} className="px-4 py-3 rounded-xl border text-base">Vaciar</button>
                    <button onClick={finalizeSale} className="px-5 py-3 rounded-xl bg-black text-white text-base">Vender</button>
                    <button onClick={undoLastSale} className="px-4 py-3 rounded-xl border text-base">Deshacer</button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Selector de candidatos cuando hay varios matches */}
      {Array.isArray(pickMatches) && (
        <div className="fixed inset-0 bg-black/40 z-50" onClick={()=>setPickMatches(null)}>
          <div
            className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl border shadow-xl pos-sheet"
            style={{height:'70vh', maxHeight:'70vh'}}
            onClick={e=>e.stopPropagation()}
          >
            <div className="flex justify-center py-2">
              <div className="h-1.5 w-12 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 pb-3 border-b flex items-center justify-between">
              <h3 className="text-base font-semibold">Elige producto</h3>
              <button className="px-3 py-2 rounded-xl border" onClick={()=>setPickMatches(null)}>Cerrar</button>
            </div>
            <div className="p-3 overflow-y-auto h-full">
              <div className="grid gap-2">
                {pickMatches.map(p => (
                  <button
                    key={p.id}
                    onClick={()=>{ pushCart(p); setPickMatches(null); setSkuTerm(''); }}
                    className="text-left rounded-2xl border p-3 hover:bg-gray-50"
                  >
                    <div className="text-sm text-gray-500 font-mono">{p.sku || '—'}</div>
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-sm text-gray-600">
                      {p.categoria ? `[${p.categoria}] ` : ''}{formatCLP(p.precio)} • Stock: {p.stock}
                    </div>
                    {p.aliases && <div className="text-xs text-gray-400 mt-1">Alias: {p.aliases}</div>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historial de ventas */}
      {historyOpen && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={()=>setHistoryOpen(false)}>
          <div className="bg-white w-full max-w-3xl rounded-2xl border shadow-xl" onClick={e=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Historial de ventas</h3>
              <div className="flex items-center gap-2">
                <button onClick={clearSalesHistory} className="px-3 py-2 rounded-xl border text-sm text-red-600">Limpiar historial</button>
                <button onClick={()=>setHistoryOpen(false)} className="px-3 py-2 rounded-xl border">Cerrar</button>
              </div>
            </div>
            <div className="p-3 max-h-[70vh] overflow-y-auto">
              {sales.length===0 && <div className="text-center text-gray-500 py-8">Sin ventas aún…</div>}
              <div className="grid gap-2">
                {sales.map(s => (
                  <div key={s.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-gray-500">#{s.id.slice(-6)} • {new Date(s.ts).toLocaleString()}</div>
                      <div className="text-sm font-semibold">
                        {formatCLP(s.total)} {s.status==='ANULADA' && <span className="ml-2 px-2 py-0.5 rounded-full text-xs border text-red-600">ANULADA</span>}
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-gray-700">
                      {s.items.map(l => (
                        <div key={l.id} className="flex justify-between">
                          <span>{l.nombre} × {l.qty} <span className="text-gray-500">[{l.pay}]</span></span>
                          <span>{formatCLP(l.subtotal)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="px-3 py-2 rounded-xl border" onClick={()=>startReturn(s)} disabled={s.status==='ANULADA'}>Devolver</button>
                      <button className="px-3 py-2 rounded-xl border text-red-600" onClick={()=>voidSale(s.id)} disabled={s.status==='ANULADA'}>
                        Anular
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal devolución parcial */}
      {returnFor && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={()=>setReturnFor(null)}>
          <div className="bg-white w-full max-w-xl rounded-2xl border shadow-xl" onClick={e=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Devolución</h3>
              <button onClick={()=>setReturnFor(null)} className="px-3 py-2 rounded-xl border">Cerrar</button>
            </div>
            <div className="p-4">
              <div className="text-sm text-gray-600 mb-2">Venta #{returnFor.saleId.slice(-6)}</div>
              <div className="grid gap-2">
                {returnFor.lines.map((l, idx) => (
                  <div key={l.id} className="rounded-xl border p-2">
                    <div className="text-sm">{l.nombre}</div>
                    <div className="text-xs text-gray-500">Vendida: {l.qtyVendida} • Máx. a devolver: {l.qtyMax}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="h-10 w-10 rounded-xl border text-2xl"
                        onClick={()=>updateReturnQty(idx, Math.max(0,(l.qtyDevolver||0)-1))}
                      >−</button>
                      <input
                        className="w-20 h-10 text-center rounded-xl border"
                        inputMode="numeric" pattern="[0-9]*"
                        value={l.qtyDevolver}
                        onChange={e=>updateReturnQty(idx, clampInt(e.target.value, 0, l.qtyMax))}
                      />
                      <button
                        className="h-10 w-10 rounded-xl border text-2xl"
                        onClick={()=>updateReturnQty(idx, Math.min(l.qtyMax,(l.qtyDevolver||0)+1))}
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-2 rounded-xl border" onClick={()=>setReturnFor(null)}>Cancelar</button>
                <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={applyReturn}>Aplicar devolución</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="py-10 text-center text-xs text-gray-500">
        Hecho con 💖 para mi esposa
      </footer>
    </div>
  );
}
