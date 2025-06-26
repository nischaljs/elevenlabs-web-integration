import { Request, Response, NextFunction } from 'express';

const AGENT_KEYS = (process.env.AGENT_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

export function apiKeyAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
     res.status(403).json({ error: 'Unauthorized' });
     return
  }
  const token = auth.slice('Bearer '.length);
  if (!AGENT_KEYS.includes(token)) {
     res.status(403).json({ error: 'Unauthorized' });
     return
  }
  next();
} 