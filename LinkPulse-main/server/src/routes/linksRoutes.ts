import { Router } from 'express';
import { LinksController } from '../controllers/linksController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { creationRateLimiter } from '../middleware/rateLimit.ts';

export const linksRoutes = Router();

// Public alias availability check
linksRoutes.get('/check-alias', LinksController.checkAlias);

linksRoutes.use(requireAuth);

linksRoutes.get('/', LinksController.getLinks);
linksRoutes.post('/', creationRateLimiter, LinksController.createLink);
linksRoutes.get('/code/:code', LinksController.getLinkByCode);
linksRoutes.post('/bulk-delete', LinksController.bulkDeleteLinks);
linksRoutes.post('/bulk-status', LinksController.bulkSetStatus);
linksRoutes.get('/:id', LinksController.getLink);
linksRoutes.patch('/:id', LinksController.updateLink);
linksRoutes.post('/:id/disable', (req, res) => {
  req.body = { ...req.body, isActive: false };
  return LinksController.updateLink(req as any, res);
});
linksRoutes.post('/:id/enable', (req, res) => {
  req.body = { ...req.body, isActive: true };
  return LinksController.updateLink(req as any, res);
});
linksRoutes.delete('/:id', LinksController.deleteLink);
