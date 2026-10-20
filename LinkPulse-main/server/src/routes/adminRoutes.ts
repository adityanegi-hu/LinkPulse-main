import { Router } from 'express';
import { AdminController } from '../controllers/adminController.ts';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireAdmin);

adminRoutes.get('/overview', AdminController.getOverview);
adminRoutes.get('/users', AdminController.getUsers);
adminRoutes.patch('/users/:id/role', AdminController.updateUserRole);
adminRoutes.get('/links', AdminController.getAllLinks);
adminRoutes.post('/links/:id/toggle', AdminController.toggleLink);
adminRoutes.get('/blocklist', AdminController.getBlocklist);
adminRoutes.post('/blocklist', AdminController.addBlocklistDomain);
adminRoutes.delete('/blocklist/:id', AdminController.removeBlocklistDomain);
