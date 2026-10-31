import mongoose from 'mongoose';
import { NotificationType, Priority, Role, TaskStatus } from '../config/constants.js';

// Every JSON response exposes `id` instead of `_id`/`__v`.
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/** Better Auth user ids are strings (the ObjectId hex of the `user` document). */
const memberSchema = new Schema(
  {
    userId: { type: String, required: true },
    role: { type: String, enum: Object.values(Role), default: Role.MEMBER },
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: null },
    favorites: { type: [ObjectId], default: [] },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    createdBy: { type: String, required: true },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true },
);
workspaceSchema.index({ 'members.userId': 1 });

const projectSchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    key: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 5 },
    color: { type: String, default: '#5E6AD2' },
    counter: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
projectSchema.index({ workspace: 1, key: 1 }, { unique: true });

const subtaskSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  done: { type: Boolean, default: false },
});

const taskSchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    project: { type: ObjectId, ref: 'Project', required: true },
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    status: { type: String, enum: Object.values(TaskStatus), default: TaskStatus.TODO },
    priority: { type: String, enum: Object.values(Priority), default: Priority.MEDIUM },
    assignee: { type: String, default: null },
    dueDate: { type: Date, default: null },
    labels: { type: [String], default: [] },
    subtasks: { type: [subtaskSchema], default: [] },
    commentCount: { type: Number, default: 0 },
    /** Fractional position within a column: a move rewrites one document. */
    order: { type: Number, default: 1024 },
    completedAt: { type: Date, default: null },
    cycle: { type: ObjectId, ref: 'Cycle', default: null },
    createdBy: { type: String, required: true },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
taskSchema.index({ project: 1, status: 1, order: 1 });
taskSchema.index({ workspace: 1, assignee: 1 });
taskSchema.index({ project: 1, updatedAt: 1 });
taskSchema.index({ title: 'text', labels: 'text' });

const commentSchema = new Schema(
  {
    task: { type: ObjectId, ref: 'Task', required: true, index: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    author: { type: String, required: true },
    body: { type: String, required: true, maxlength: 5000 },
    mentions: { type: [String], default: [] },
    /** emoji -> user ids */
    reactions: { type: Map, of: [String], default: {} },
  },
  { timestamps: true },
);

const activitySchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    project: { type: ObjectId, ref: 'Project' },
    task: { type: ObjectId, ref: 'Task' },
    actor: { type: String, required: true },
    type: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
activitySchema.index({ workspace: 1, createdAt: -1 });
activitySchema.index({ task: 1, createdAt: 1 });

const notificationSchema = new Schema(
  {
    user: { type: String, required: true },
    workspace: { type: ObjectId, ref: 'Workspace' },
    type: { type: String, enum: Object.values(NotificationType), required: true },
    title: { type: String, required: true },
    link: { type: String },
    actor: { type: String },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

const inviteSchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    /** When set, only this email can accept. */
    email: { type: String, lowercase: true, trim: true, default: null },
    role: { type: String, enum: Object.values(Role), default: Role.MEMBER },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
inviteSchema.index({ workspace: 1, status: 1 });

/** Saved board/list views (filters + grouping) per user. */
const viewSchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    project: { type: ObjectId, ref: 'Project', required: true },
    user: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
viewSchema.index({ project: 1, user: 1 });

const cycleSchema = new Schema(
  {
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    project: { type: ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);
cycleSchema.index({ project: 1, startsAt: -1 });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
export const Project = mongoose.model('Project', projectSchema);
export const Task = mongoose.model('Task', taskSchema);
export const Comment = mongoose.model('Comment', commentSchema);
export const Activity = mongoose.model('Activity', activitySchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const Invite = mongoose.model('Invite', inviteSchema);
export const View = mongoose.model('View', viewSchema);
export const Cycle = mongoose.model('Cycle', cycleSchema);

/** Read-only view of Better Auth's `user` collection (Better Auth owns writes). */
export const AuthUser = mongoose.model(
  'AuthUser',
  new Schema({}, { strict: false, collection: 'user' }),
);

/** Models whose collections are created and indexed at startup (AuthUser is Better Auth's). */
export const appModels = [
  Workspace,
  Project,
  Task,
  Comment,
  Activity,
  Notification,
  Invite,
  View,
  Cycle,
];
