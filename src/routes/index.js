import { Router } from 'express';
import * as notifications from '../controllers/notification.controller.js';
import { getReady } from '../controllers/health.controller.js';
import { getMe } from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { markReadSchema, notificationsQuerySchema } from '../validators/workspace.validators.js';
import { healthRouter } from './health.routes.js';
import { projectRouter } from './project.routes.js';
import { workspaceRouter } from './workspace.routes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.get('/ready', getReady);
// The link itself is the credential for previewing an invite; accepting still needs a session.
apiRouter.get('/invites/:token', notifications.previewInvite);

// Everything below requires a valid Better Auth session.
apiRouter.use(authenticate);
apiRouter.get('/me', getMe);
apiRouter.post('/invites/:token/accept', notifications.acceptInvite);
apiRouter.get('/notifications', validate(notificationsQuerySchema, 'query'), notifications.list);
apiRouter.post('/notifications/read', validate(markReadSchema), notifications.markRead);
apiRouter.use('/workspaces', workspaceRouter);
apiRouter.use(projectRouter);
