import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { isValidSessionId, validateCompileRequest } from './server/compilerUtils';
import {
  attachSessionStream,
  compileAndStartSession,
  sendSessionEof,
  shutdownAllSessions,
  stopSession,
  writeSessionStdin,
} from './server/sessionManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/run', async (req, res) => {
    const validated = validateCompileRequest(req.body);
    if (!validated.ok) {
      res.status(400).json({
        ok: false,
        stage: 'validation',
        diagnostics: [],
        rawCompilerOutput: '',
        compileTimeMs: 0,
        error: validated.error,
      });
      return;
    }

    try {
      const { status, payload } = await compileAndStartSession(
        validated.data.language,
        validated.data.standard,
        validated.data.code
      );
      res.status(status).json(payload);
    } catch {
      res.status(500).json({
        ok: false,
        stage: 'server',
        diagnostics: [],
        rawCompilerOutput: '',
        compileTimeMs: 0,
        error: 'Внутренняя ошибка компиляции.',
      });
    }
  });

  app.get('/api/sessions/:id/stream', (req, res) => {
    const { id } = req.params;
    if (!isValidSessionId(id)) {
      res.status(400).json({ ok: false, error: 'Некорректный идентификатор сессии.' });
      return;
    }

    const attached = attachSessionStream(id, res);
    if (!attached) {
      res.status(404).json({ ok: false, error: 'Сессия не найдена или истекла.' });
    }
  });

  app.post('/api/sessions/:id/stdin', (req, res) => {
    const { id } = req.params;
    if (!isValidSessionId(id)) {
      res.status(400).json({ ok: false, error: 'Некорректный идентификатор сессии.' });
      return;
    }

    const input = req.body?.input;
    if (typeof input !== 'string') {
      res.status(400).json({ ok: false, error: 'Поле input должно быть строкой.' });
      return;
    }

    const result = writeSessionStdin(id, input);
    res.status(result.status).json({ ok: result.ok, error: result.error });
  });

  app.post('/api/sessions/:id/eof', (req, res) => {
    const { id } = req.params;
    if (!isValidSessionId(id)) {
      res.status(400).json({ ok: false, error: 'Некорректный идентификатор сессии.' });
      return;
    }

    const result = sendSessionEof(id);
    res.status(result.status).json({ ok: result.ok });
  });

  app.post('/api/sessions/:id/stop', (req, res) => {
    const { id } = req.params;
    if (!isValidSessionId(id)) {
      res.status(400).json({ ok: false, error: 'Некорректный идентификатор сессии.' });
      return;
    }

    const result = stopSession(id);
    res.status(result.status).json({ ok: result.ok });
  });

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`C++ & C Studio listening on http://0.0.0.0:${PORT}`);
  });

  const handleShutdown = () => {
    shutdownAllSessions();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

void startServer();
