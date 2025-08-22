import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fileUpload from 'express-fileupload';
import { authRouter } from './routes/auth.js';
import { categoriasRouter } from './routes/categorias.js';
import { productosRouter } from './routes/productos.js';
import { movimientosRouter } from './routes/movimientos.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed'), false);
  },
  credentials: true
}));

app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(fileUpload());

app.get('/', (_, res) => res.json({ ok: true, service: 'artist-alley-backend' }));

app.use('/api/auth', authRouter);
app.use('/api/categorias', requireAuth, categoriasRouter);
app.use('/api/productos', requireAuth, productosRouter);
app.use('/api/movimientos', requireAuth, movimientosRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', detail: err.message });
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
