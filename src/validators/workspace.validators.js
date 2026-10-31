import { z } from 'zod';
import { Priority, Role, TaskStatus } from '../config/constants.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
const role = z.enum(Object.values(Role));
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const REACTION_EMOJIS = ['👍', '🎉', '❤️', '👀'];

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
});

export const addMemberSchema = z.object({ email, role: role.default(Role.MEMBER) });

export const changeRoleSchema = z.object({ role });

export const createInviteSchema = z.object({
  email: email.nullable().optional(),
  role: role.default(Role.MEMBER),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, 'Key must be 2-5 letters')
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const label = z.string().trim().min(1).max(30);

const subtasks = z
  .array(
    z.object({
      id: objectId.optional(),
      title: z.string().trim().min(1).max(200),
      done: z.boolean().default(false),
    }),
  )
  .max(50)
  .transform((list) => list.map(({ id, ...rest }) => (id ? { _id: id, ...rest } : rest)));

const taskFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000),
  status: z.enum(Object.values(TaskStatus)),
  priority: z.enum(Object.values(Priority)),
  assignee: z.string().nullable(),
  dueDate: z.coerce.date().nullable(),
  labels: z.array(label).max(10),
  subtasks,
};

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  assignee: taskFields.assignee.optional(),
  dueDate: taskFields.dueDate.optional(),
  labels: taskFields.labels.optional(),
});

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field' });

/** `afterId` is the card that will sit directly above, `beforeId` directly below. */
export const moveTaskSchema = z.object({
  status: z.enum(Object.values(TaskStatus)),
  afterId: objectId.nullable().optional(),
  beforeId: objectId.nullable().optional(),
});

export const listTasksQuerySchema = z.object({ since: z.coerce.date().optional() });

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000),
  mentions: z.array(z.string()).max(20).default([]),
});

export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJIS) });

export const searchSchema = z.object({ q: z.string().trim().min(1).max(100) });

export const notificationsQuerySchema = z.object({
  unread: z.enum(['1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const markReadSchema = z.object({
  ids: z.array(objectId).max(100).optional(),
  all: z.boolean().optional(),
});

export const resolveSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/),
  number: z.coerce.number().int().positive(),
});
