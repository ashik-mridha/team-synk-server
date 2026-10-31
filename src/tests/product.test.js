import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, signUp, startTestApp } from './helpers.js';

let ctx;
let app;
let cookies;
let ids;
let workspaceId;
let project;

const call = (method, path, who, body) => api(app, method, path, cookies[who], body);
const createTask = async (who, body) =>
  (await call('post', `/projects/${project.id}/tasks`, who, body)).body.data.task;
const listTasks = async (who = 'owner') =>
  (await call('get', `/projects/${project.id}/tasks`, who)).body.data.tasks;

beforeAll(async () => {
  ctx = await startTestApp();
  app = ctx.app;
});
afterAll(() => ctx.stop());

beforeEach(async () => {
  await ctx.reset();
  cookies = {};
  for (const [key, name] of [
    ['owner', 'Olivia Owner'],
    ['admin', 'Adam Admin'],
    ['member', 'Mia Member'],
    ['viewer', 'Vik Viewer'],
    ['outsider', 'Otto Outsider'],
  ]) {
    cookies[key] = (await signUp(app, name, `${key}@example.com`)).cookie;
  }
  workspaceId = (await call('post', '/workspaces', 'owner', { name: 'Team Phoenix' })).body.data
    .workspace.id;
  let members;
  for (const [key, role] of [
    ['admin', 'admin'],
    ['member', 'member'],
    ['viewer', 'viewer'],
  ]) {
    const res = await call('post', `/workspaces/${workspaceId}/members`, 'owner', {
      email: `${key}@example.com`,
      role,
    });
    members = res.body.data.members;
  }
  ids = Object.fromEntries(members.map((m) => [m.email.split('@')[0], m.userId]));
  project = (
    await call('post', `/workspaces/${workspaceId}/projects`, 'owner', {
      name: 'E-commerce Website',
    })
  ).body.data.project;
});

describe('RBAC matrix', () => {
  it('lets a viewer read but not write', async () => {
    const task = await createTask('member', { title: 'Visible to viewers' });

    expect((await call('get', `/projects/${project.id}/tasks`, 'viewer')).status).toBe(200);
    expect(
      (await call('post', `/projects/${project.id}/tasks`, 'viewer', { title: 'x' })).status,
    ).toBe(403);
    expect((await call('patch', `/tasks/${task.id}`, 'viewer', { title: 'y' })).status).toBe(403);
    expect(
      (await call('post', `/tasks/${task.id}/move`, 'viewer', { status: 'done' })).status,
    ).toBe(403);
    expect((await call('delete', `/tasks/${task.id}`, 'viewer')).status).toBe(403);
    expect(
      (await call('post', `/tasks/${task.id}/comments`, 'viewer', { body: 'hi' })).status,
    ).toBe(403);
    expect(
      (await call('post', `/workspaces/${workspaceId}/projects`, 'viewer', { name: 'Nope' }))
        .status,
    ).toBe(403);
  });

  it('lets a member contribute but not manage people', async () => {
    const task = await createTask('member', { title: 'Member task' });

    expect((await call('patch', `/tasks/${task.id}`, 'member', { priority: 'high' })).status).toBe(
      200,
    );
    expect(
      (await call('post', `/workspaces/${workspaceId}/invites`, 'member', { role: 'member' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('post', `/workspaces/${workspaceId}/members`, 'member', {
          email: 'outsider@example.com',
        })
      ).status,
    ).toBe(403);
  });

  it('keeps every workspace-scoped resource invisible to non-members (IDOR)', async () => {
    const task = await createTask('owner', { title: 'Secret' });
    const comment = (await call('post', `/tasks/${task.id}/comments`, 'owner', { body: 'private' }))
      .body.data.comment;
    const attempts = [
      call('get', `/workspaces/${workspaceId}`, 'outsider'),
      call('get', `/workspaces/${workspaceId}/analytics`, 'outsider'),
      call('get', `/workspaces/${workspaceId}/search?q=Secret`, 'outsider'),
      call('get', `/projects/${project.id}`, 'outsider'),
      call('get', `/projects/${project.id}/tasks`, 'outsider'),
      call('patch', `/tasks/${task.id}`, 'outsider', { title: 'hacked' }),
      call('post', `/tasks/${task.id}/move`, 'outsider', { status: 'done' }),
      call('delete', `/tasks/${task.id}`, 'outsider'),
      call('get', `/tasks/${task.id}/comments`, 'outsider'),
      call('get', `/tasks/${task.id}/activity`, 'outsider'),
      call('post', `/comments/${comment.id}/reactions`, 'outsider', { emoji: '👍' }),
    ];
    const statuses = (await Promise.all(attempts)).map((r) => r.status);

    expect(statuses.every((s) => s === 404)).toBe(true);
    expect((await ctx.db.collection('tasks').findOne({})).title).toBe('Secret');
  });

  it('validates ids and bodies instead of passing them to MongoDB', async () => {
    expect((await call('get', '/projects/not-an-id', 'owner')).status).toBe(404);
    const task = await createTask('owner', { title: 'Injection target' });
    const res = await call('patch', `/tasks/${task.id}`, 'owner', { title: { $ne: null } });

    expect(res.status).toBe(422);
  });
});

describe('task ordering and moves', () => {
  it('places a card between two neighbours and rewrites only that document', async () => {
    const [a, b, c] = [
      await createTask('member', { title: 'A' }),
      await createTask('member', { title: 'B' }),
      await createTask('member', { title: 'C' }),
    ];
    const before = Object.fromEntries((await listTasks()).map((t) => [t.title, t.updatedAt]));

    const res = await call('post', `/tasks/${c.id}/move`, 'member', {
      status: 'todo',
      afterId: a.id,
      beforeId: b.id,
    });
    expect(res.status).toBe(200);

    const after = await listTasks();
    expect(after.map((t) => t.title)).toEqual(['A', 'C', 'B']);
    expect(after.find((t) => t.title === 'A').updatedAt).toBe(before.A);
    expect(after.find((t) => t.title === 'B').updatedAt).toBe(before.B);
    expect(after.find((t) => t.title === 'C').order).toBeGreaterThan(a.order);
    expect(after.find((t) => t.title === 'C').order).toBeLessThan(b.order);
  });

  it('is idempotent: repeating the same move gives the same position', async () => {
    const a = await createTask('member', { title: 'A' });
    const b = await createTask('member', { title: 'B' });
    const c = await createTask('member', { title: 'C' });
    const body = { status: 'todo', afterId: a.id, beforeId: b.id };

    const first = (await call('post', `/tasks/${c.id}/move`, 'member', body)).body.data.task.order;
    const second = (await call('post', `/tasks/${c.id}/move`, 'member', body)).body.data.task.order;

    expect(second).toBe(first);
  });

  it('moves across columns, appends at the end and sets completedAt', async () => {
    const a = await createTask('member', { title: 'A', status: 'done' });
    const b = await createTask('member', { title: 'B' });

    const res = await call('post', `/tasks/${b.id}/move`, 'member', {
      status: 'done',
      afterId: a.id,
    });
    const moved = res.body.data.task;

    expect(moved.status).toBe('done');
    expect(moved.order).toBeGreaterThan(a.order);
    expect(moved.completedAt).toBeTruthy();
    const back = await call('post', `/tasks/${b.id}/move`, 'member', { status: 'todo' });
    expect(back.body.data.task.completedAt).toBeNull();
  });

  it('renumbers the column when the gap between neighbours gets too small', async () => {
    const a = await createTask('member', { title: 'A' });
    const b = await createTask('member', { title: 'B' });
    const c = await createTask('member', { title: 'C' });
    await ctx.db.collection('tasks').updateOne({ title: 'B' }, { $set: { order: a.order + 1e-9 } });

    const res = await call('post', `/tasks/${c.id}/move`, 'member', {
      status: 'todo',
      afterId: a.id,
      beforeId: b.id,
    });

    expect(res.body.data.rebalanced).toBe(true);
    expect((await listTasks()).map((t) => t.title)).toEqual(['A', 'C', 'B']);
  });

  it('soft-deletes with undo and reports changes since a timestamp', async () => {
    const task = await createTask('member', { title: 'Delete me' });
    const since = new Date(Date.now() - 1000).toISOString();

    expect((await call('delete', `/tasks/${task.id}`, 'member')).status).toBe(200);
    expect(await listTasks()).toHaveLength(0);
    expect((await call('get', `/tasks/${task.id}/comments`, 'member')).status).toBe(404);

    const caughtUp = await call('get', `/projects/${project.id}/tasks?since=${since}`, 'owner');
    expect(caughtUp.body.data.tasks[0].deletedAt).toBeTruthy();

    expect((await call('post', `/tasks/${task.id}/restore`, 'member')).status).toBe(200);
    expect(await listTasks()).toHaveLength(1);
  });

  it('records field changes in the activity timeline', async () => {
    const task = await createTask('member', { title: 'Track me' });
    await call('patch', `/tasks/${task.id}`, 'member', { priority: 'high', assignee: ids.admin });

    const { activity } = (await call('get', `/tasks/${task.id}/activity`, 'owner')).body.data;

    expect(activity.map((a) => a.type)).toEqual(
      expect.arrayContaining(['task.created', 'task.updated']),
    );
    expect(activity.find((a) => a.meta.field === 'priority').meta.to).toBe('high');
  });
});

describe('comments, mentions and notifications', () => {
  it('notifies mentioned members and the assignee, ignoring non-members and self', async () => {
    const task = await createTask('owner', { title: 'Fix login bug', assignee: ids.admin });
    ctxClearNotifications();
    const res = await call('post', `/tasks/${task.id}/comments`, 'member', {
      body: 'Ping @Vik Viewer',
      mentions: [ids.viewer, ids.member, '64b7f0f0f0f0f0f0f0f0f0f0'],
    });
    expect(res.status).toBe(201);

    const viewer = (await call('get', '/notifications', 'viewer')).body.data;
    const adminInbox = (await call('get', '/notifications', 'admin')).body.data;
    const memberInbox = (await call('get', '/notifications', 'member')).body.data;

    expect(viewer.notifications.find((n) => n.type === 'mention')).toBeTruthy();
    expect(adminInbox.notifications.find((n) => n.type === 'comment')).toBeTruthy();
    expect(memberInbox.notifications.filter((n) => n.type === 'mention')).toHaveLength(0);
    expect((await ctx.db.collection('tasks').findOne({})).commentCount).toBe(1);
  });

  it('notifies on assignment and marks notifications read', async () => {
    const task = await createTask('owner', { title: 'Assign me' });
    await call('patch', `/tasks/${task.id}`, 'owner', { assignee: ids.member });

    const inbox = (await call('get', '/notifications?unread=1', 'member')).body.data;
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.notifications[0].type).toBe('assigned');

    const read = await call('post', '/notifications/read', 'member', { all: true });
    expect(read.body.data.unreadCount).toBe(0);
    expect(
      (await call('get', '/notifications?unread=1', 'owner')).body.data.notifications,
    ).toHaveLength(0);
  });

  it("only marks the caller's own notifications", async () => {
    const task = await createTask('owner', { title: 'Mine' });
    await call('patch', `/tasks/${task.id}`, 'owner', { assignee: ids.member });
    const { notifications } = (await call('get', '/notifications', 'member')).body.data;

    await call('post', '/notifications/read', 'admin', { ids: [notifications[0].id] });

    expect((await call('get', '/notifications?unread=1', 'member')).body.data.unreadCount).toBe(1);
  });

  it('toggles emoji reactions', async () => {
    const task = await createTask('owner', { title: 'React' });
    const comment = (await call('post', `/tasks/${task.id}/comments`, 'owner', { body: 'nice' }))
      .body.data.comment;

    const on = await call('post', `/comments/${comment.id}/reactions`, 'member', { emoji: '👍' });
    expect(on.body.data.comment.reactions['👍']).toEqual([ids.member]);
    const off = await call('post', `/comments/${comment.id}/reactions`, 'member', { emoji: '👍' });
    expect(off.body.data.comment.reactions['👍']).toBeUndefined();
    expect(
      (await call('post', `/comments/${comment.id}/reactions`, 'member', { emoji: '💩' })).status,
    ).toBe(422);
  });
});

// Notifications created while setting up the fixture are not what these tests assert on.
function ctxClearNotifications() {
  return ctx.db.collection('notifications').deleteMany({});
}

describe('search, analytics, favorites, readiness', () => {
  it('finds tasks by full word and by prefix, and projects by name', async () => {
    await createTask('member', { title: 'Redesign pricing page' });

    const word = (await call('get', `/workspaces/${workspaceId}/search?q=pricing`, 'member')).body
      .data;
    const prefix = (await call('get', `/workspaces/${workspaceId}/search?q=pric`, 'member')).body
      .data;
    const proj = (await call('get', `/workspaces/${workspaceId}/search?q=commerce`, 'member')).body
      .data;

    expect(word.tasks).toHaveLength(1);
    expect(prefix.tasks).toHaveLength(1);
    expect(proj.projects[0].name).toBe('E-commerce Website');
  });

  it('computes workspace analytics', async () => {
    await createTask('member', { title: 'Open', assignee: ids.member, dueDate: '2020-01-01' });
    const done = await createTask('member', { title: 'Done one' });
    await call('post', `/tasks/${done.id}/move`, 'member', { status: 'done' });

    const data = (await call('get', `/workspaces/${workspaceId}/analytics`, 'viewer')).body.data;

    expect(data.byStatus).toMatchObject({ todo: 1, done: 1 });
    expect(data.overdue).toBe(1);
    expect(data.workload[0]).toMatchObject({ name: 'Mia Member', count: 1 });
    expect(data.completedPerWeek).toHaveLength(8);
    expect(data.completedPerWeek.at(-1).count).toBe(1);
    expect(data.avgCycleTimeDays).not.toBeNull();
  });

  it('toggles favorite projects per user', async () => {
    const on = await call('post', `/workspaces/${workspaceId}/favorites/${project.id}`, 'member');
    expect(on.body.data.favorites).toEqual([project.id]);
    expect((await call('get', `/workspaces/${workspaceId}`, 'owner')).body.data.favorites).toEqual(
      [],
    );
    const off = await call('post', `/workspaces/${workspaceId}/favorites/${project.id}`, 'member');
    expect(off.body.data.favorites).toEqual([]);
  });

  it('records when a member was last active', async () => {
    await call('get', `/workspaces/${workspaceId}`, 'member');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const doc = await ctx.db.collection('workspaces').findOne({});
    expect(doc.members.find((m) => m.userId === ids.member).lastActiveAt).toBeTruthy();
  });

  it('reports readiness and request ids', async () => {
    const res = await request(app).get('/api/v1/ready').set('x-request-id', 'trace-me');

    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('team-sync');
    expect(res.headers['x-request-id']).toBe('trace-me');
  });
});

describe('invites', () => {
  const invite = (who, body) => call('post', `/workspaces/${workspaceId}/invites`, who, body);
  const tokenOf = (link) => link.split('/invite/')[1];

  it('creates a link, stores only a hash, and lets a new person join with the role', async () => {
    const res = await invite('owner', { role: 'viewer' });
    expect(res.status).toBe(201);
    const token = tokenOf(res.body.data.link);

    const stored = await ctx.db.collection('invites').findOne({});
    expect(stored.tokenHash).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(res.body.data.invite)).not.toContain('tokenHash');

    const preview = await request(app).get(`/api/v1/invites/${token}`);
    expect(preview.body.data).toMatchObject({ workspaceName: 'Team Phoenix', role: 'viewer' });

    const accept = await call('post', `/invites/${token}/accept`, 'outsider');
    expect(accept.status).toBe(200);
    const members = (await call('get', `/workspaces/${workspaceId}/members`, 'owner')).body.data
      .members;
    expect(members.find((m) => m.email === 'outsider@example.com').role).toBe('viewer');
  });

  it('is single use', async () => {
    const token = tokenOf((await invite('owner', { role: 'member' })).body.data.link);
    await call('post', `/invites/${token}/accept`, 'outsider');

    const again = await call('post', `/invites/${token}/accept`, 'viewer');
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('INVITE_INVALID');
  });

  it('can be revoked and then no longer works', async () => {
    const created = (await invite('owner', { role: 'member' })).body.data;
    const pending = await call('get', `/workspaces/${workspaceId}/invites`, 'owner');
    expect(pending.body.data.invites).toHaveLength(1);

    const revoke = await call(
      'delete',
      `/workspaces/${workspaceId}/invites/${created.invite.id}`,
      'owner',
    );
    expect(revoke.status).toBe(200);
    expect(
      (await call('post', `/invites/${tokenOf(created.link)}/accept`, 'outsider')).status,
    ).toBe(404);
    expect(
      (await call('get', `/workspaces/${workspaceId}/invites`, 'owner')).body.data.invites,
    ).toHaveLength(0);
  });

  it('expires', async () => {
    const token = tokenOf((await invite('owner', { role: 'member' })).body.data.link);
    await ctx.db.collection('invites').updateMany({}, { $set: { expiresAt: new Date(0) } });

    expect((await request(app).get(`/api/v1/invites/${token}`)).status).toBe(404);
    expect((await call('post', `/invites/${token}/accept`, 'outsider')).status).toBe(404);
  });

  it('binds an email-restricted invite to that address', async () => {
    const token = tokenOf(
      (await invite('owner', { role: 'member', email: 'outsider@example.com' })).body.data.link,
    );

    expect((await call('post', `/invites/${token}/accept`, 'viewer')).status).toBe(403);
    expect((await call('post', `/invites/${token}/accept`, 'outsider')).status).toBe(200);
  });

  it('limits who can hand out which role', async () => {
    expect((await invite('admin', { role: 'admin' })).status).toBe(403);
    expect((await invite('admin', { role: 'member' })).status).toBe(201);
    expect((await invite('member', { role: 'member' })).status).toBe(403);
    expect((await invite('owner', { role: 'owner' })).status).toBe(400);
  });

  it('requires a session to accept', async () => {
    const token = tokenOf((await invite('owner', { role: 'member' })).body.data.link);

    expect((await request(app).post(`/api/v1/invites/${token}/accept`)).status).toBe(401);
  });
});
