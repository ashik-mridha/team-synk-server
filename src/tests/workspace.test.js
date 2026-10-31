import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signUp, startTestApp } from './helpers.js';

let ctx;
let app;
let owner;
let admin;
let member;
let outsider;
let workspaceId;
let ids;

const call = (method, path, cookie, body) => {
  const req = request(app)[method](`/api/v1${path}`).set('Cookie', cookie);
  return body ? req.send(body) : req;
};
const rolePath = (userId) => `/workspaces/${workspaceId}/members/${userId}/role`;
const memberPath = (userId) => `/workspaces/${workspaceId}/members/${userId}`;

beforeAll(async () => {
  ctx = await startTestApp();
  app = ctx.app;
});
afterAll(() => ctx.stop());

beforeEach(async () => {
  await ctx.reset();
  owner = (await signUp(app, 'Olivia Owner', 'owner@example.com')).cookie;
  admin = (await signUp(app, 'Adam Admin', 'admin@example.com')).cookie;
  member = (await signUp(app, 'Mia Member', 'member@example.com')).cookie;
  outsider = (await signUp(app, 'Otto Outsider', 'outsider@example.com')).cookie;

  const created = await call('post', '/workspaces', owner, { name: 'Acme Studio' });
  workspaceId = created.body.data.workspace.id;
  await call('post', `/workspaces/${workspaceId}/members`, owner, {
    email: 'admin@example.com',
    role: 'admin',
  });
  const added = await call('post', `/workspaces/${workspaceId}/members`, owner, {
    email: 'member@example.com',
    role: 'member',
  });
  ids = Object.fromEntries(added.body.data.members.map((m) => [m.email, m.userId]));
});

describe('workspace creation', () => {
  it('makes the creator the owner', async () => {
    const res = await call('get', `/workspaces/${workspaceId}/members`, owner);

    expect(res.body.data.members.find((m) => m.email === 'owner@example.com').role).toBe('owner');
    const doc = await ctx.db.collection('workspaces').findOne({});
    expect(doc.members.find((m) => m.role === 'owner')).toBeTruthy();
  });

  it('hides the workspace from non-members', async () => {
    const res = await call('get', `/workspaces/${workspaceId}`, outsider);

    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/workspaces');

    expect(res.status).toBe(401);
  });
});

describe('role changes', () => {
  it('forbids a member from changing roles (403)', async () => {
    const res = await call('patch', rolePath(ids['admin@example.com']), member, { role: 'member' });

    expect(res.status).toBe(403);
  });

  it('forbids an admin from promoting to owner or admin (403)', async () => {
    const toOwner = await call('patch', rolePath(ids['member@example.com']), admin, {
      role: 'owner',
    });
    const toAdmin = await call('patch', rolePath(ids['member@example.com']), admin, {
      role: 'admin',
    });

    expect(toOwner.status).toBe(403);
    expect(toAdmin.status).toBe(403);
  });

  it('forbids changing your own role, even for the only owner (403)', async () => {
    const res = await call('patch', rolePath(ids['owner@example.com']), owner, { role: 'member' });

    expect(res.status).toBe(403);
  });

  it('lets the owner change roles and persists it in the database', async () => {
    const res = await call('patch', rolePath(ids['member@example.com']), owner, { role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.members.find((m) => m.email === 'member@example.com').role).toBe('admin');
    const doc = await ctx.db.collection('workspaces').findOne({});
    expect(doc.members.find((m) => m.userId === ids['member@example.com']).role).toBe('admin');
  });

  it('transfers ownership: promote another owner, who may then demote the first', async () => {
    await call('patch', rolePath(ids['admin@example.com']), owner, { role: 'owner' });
    const stepDown = await call('patch', rolePath(ids['owner@example.com']), admin, {
      role: 'admin',
    });

    expect(stepDown.status).toBe(200);
  });

  it('rejects an invalid role (422)', async () => {
    const res = await call('patch', rolePath(ids['member@example.com']), owner, { role: 'god' });

    expect(res.status).toBe(422);
  });
});

describe('removing members', () => {
  it('lets an admin remove a member but not an owner', async () => {
    const removeOwner = await call('delete', memberPath(ids['owner@example.com']), admin);
    const removeMember = await call('delete', memberPath(ids['member@example.com']), admin);

    expect(removeOwner.status).toBe(403);
    expect(removeMember.status).toBe(200);
  });

  it('refuses to remove the last owner (409)', async () => {
    const res = await call('delete', memberPath(ids['owner@example.com']), owner);

    expect(res.status).toBe(409);
  });
});

describe('projects and tasks', () => {
  const createProject = async (cookie, name) =>
    (await call('post', `/workspaces/${workspaceId}/projects`, cookie, { name })).body.data.project;

  it('creates a project and tasks, and moves a task between columns', async () => {
    const project = await createProject(member, 'Website Redesign');
    expect(project.key).toBe('WR');

    const created = await call('post', `/projects/${project.id}/tasks`, member, {
      title: 'Hero section',
    });
    const task = created.body.data.task;
    expect(task).toMatchObject({ number: 1, status: 'todo', title: 'Hero section' });

    const moved = await call('patch', `/tasks/${task.id}`, member, { status: 'done' });
    expect(moved.body.data.task.status).toBe('done');

    const list = await call('get', `/projects/${project.id}/tasks`, owner);
    expect(list.body.data.tasks).toHaveLength(1);
  });

  it('rejects an assignee who is not a workspace member', async () => {
    const project = await createProject(owner, 'Mobile App');
    const res = await call('post', `/projects/${project.id}/tasks`, owner, {
      title: 'Ship it',
      assignee: '64b7f0f0f0f0f0f0f0f0f0f0',
    });

    expect(res.status).toBe(400);
  });

  it('hides projects from non-members', async () => {
    const project = await createProject(owner, 'Secret');

    expect((await call('get', `/projects/${project.id}/tasks`, outsider)).status).toBe(404);
  });
});
