import { Router } from 'express';

// User management routes — placeholder for future user CRUD module
const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
});

export default router;
