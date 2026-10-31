/**
 * Demo data: workspace "Team Phoenix", project "E-commerce Website", one user per role,
 * ~30 tasks, comments and activity. Safe to re-run: it stops if the workspace already exists.
 *
 * Usage: npm run seed
 * Logins: owner@teamphoenix.dev, admin@..., member@..., viewer@... (password: Demo1234!)
 */
import { auth, closeAuthDb } from '../src/config/auth.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Role } from '../src/config/constants.js';
import { AuthUser, Task, Workspace } from '../src/models/index.js';
import * as projectService from '../src/services/project.service.js';
import * as taskService from '../src/services/task.service.js';
import * as workspaceService from '../src/services/workspace.service.js';

const PASSWORD = 'Demo1234!';
const USERS = [
  { key: 'owner', name: 'Olivia Owner', role: Role.OWNER },
  { key: 'admin', name: 'Adam Admin', role: Role.ADMIN },
  { key: 'member', name: 'Mia Member', role: Role.MEMBER },
  { key: 'rahim', name: 'Rahim Uddin', role: Role.MEMBER },
  { key: 'viewer', name: 'Vik Viewer', role: Role.VIEWER },
];

const day = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * day);

// [title, status, priority, assignee key, labels, due in days, subtasks]
const TASKS = [
  [
    'Design the product page layout',
    'done',
    'high',
    'member',
    ['design'],
    -6,
    ['Wireframes', 'Hi-fi mockups'],
  ],
  ['Set up the Next.js storefront', 'done', 'high', 'rahim', ['frontend'], -9, []],
  [
    'Create product catalog API',
    'done',
    'high',
    'admin',
    ['backend'],
    -5,
    ['Schema', 'CRUD endpoints', 'Pagination'],
  ],
  [
    'Integrate payment gateway',
    'in-progress',
    'high',
    'rahim',
    ['backend', 'payments'],
    3,
    ['Sandbox keys', 'Checkout flow', 'Webhooks'],
  ],
  [
    'Shopping cart state and persistence',
    'in-progress',
    'high',
    'member',
    ['frontend'],
    2,
    ['Add/remove items', 'Persist across reloads'],
  ],
  ['Fix login redirect bug', 'in-progress', 'medium', 'admin', ['bug', 'auth'], 1, []],
  ['Product image optimization', 'in-progress', 'medium', 'rahim', ['performance'], 5, []],
  ['Order confirmation emails', 'todo', 'medium', 'admin', ['backend'], 7, ['Template', 'Queue']],
  ['Wishlist feature', 'todo', 'low', 'member', ['frontend'], 14, []],
  [
    'Search with filters and sorting',
    'todo',
    'high',
    'rahim',
    ['frontend', 'search'],
    6,
    ['Filters UI', 'Query params'],
  ],
  ['Inventory sync with warehouse', 'todo', 'medium', 'admin', ['backend'], 10, []],
  [
    'Accessibility audit (WCAG AA)',
    'todo',
    'medium',
    'member',
    ['a11y'],
    8,
    ['Keyboard', 'Contrast', 'Screen reader'],
  ],
  ['Mobile checkout polish', 'todo', 'high', 'member', ['frontend', 'mobile'], 4, []],
  ['Add product reviews', 'todo', 'low', null, ['frontend'], 21, []],
  ['Rate limiting on public API', 'done', 'medium', 'admin', ['backend', 'security'], -3, []],
  ['Dark mode for the storefront', 'todo', 'low', 'member', ['design'], 18, []],
  ['Analytics event tracking', 'todo', 'medium', 'rahim', ['analytics'], 9, []],
  ['Fix cart total rounding error', 'in-progress', 'high', 'rahim', ['bug'], -1, []],
  ['Write API documentation', 'todo', 'low', 'admin', ['docs'], 16, []],
  ['Set up CI pipeline', 'done', 'medium', 'admin', ['devops'], -8, []],
  ['Load test checkout endpoint', 'todo', 'medium', 'admin', ['performance'], 12, []],
  ['Coupon codes', 'todo', 'medium', 'member', ['backend', 'payments'], 11, []],
  ['Localize storefront (Bengali)', 'todo', 'low', 'member', ['i18n'], 25, []],
  ['Fix broken breadcrumb on mobile', 'done', 'low', 'member', ['bug', 'mobile'], -2, []],
  [
    'Customer account page',
    'in-progress',
    'medium',
    'member',
    ['frontend'],
    6,
    ['Orders list', 'Addresses'],
  ],
  ['Error monitoring setup', 'todo', 'medium', 'admin', ['devops'], 13, []],
  ['Sitemap and SEO metadata', 'todo', 'low', 'rahim', ['seo'], 20, []],
  ['Refund workflow', 'todo', 'high', 'admin', ['backend', 'payments'], 15, []],
  ['Email verification for new accounts', 'todo', 'medium', null, ['auth'], 17, []],
  ['Pick final brand colors', 'done', 'low', 'member', ['design'], -10, []],
];

async function ensureUser({ name, key }) {
  const email = `${key}@teamphoenix.dev`;
  const existing = await AuthUser.findOne({ email }).lean();
  if (existing) return { id: String(existing._id), name: existing.name, email };
  const { user } = await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return { id: user.id, name: user.name, email };
}

try {
  await connectDb();

  if (await Workspace.exists({ name: 'Team Phoenix' })) {
    console.log('Workspace "Team Phoenix" already exists. Nothing to do.');
  } else {
    const people = {};
    for (const spec of USERS) people[spec.key] = await ensureUser(spec);

    const workspace = await workspaceService.createWorkspace(people.owner, {
      name: 'Team Phoenix',
    });
    for (const spec of USERS.filter((u) => u.key !== 'owner')) {
      workspace.members.push({ userId: people[spec.key].id, role: spec.role });
    }
    await workspace.save();

    const project = await projectService.createProject(workspace, people.owner, {
      name: 'E-commerce Website',
      color: '#5E6AD2',
    });

    const created = [];
    for (const [title, status, priority, who, labels, due, subtasks] of TASKS) {
      const task = await taskService.createTask(workspace, project, people.owner, {
        title,
        status,
        priority,
        labels,
        assignee: who ? people[who].id : null,
        dueDate: inDays(due),
        description: `Part of the storefront launch. ${title}.`,
      });
      if (subtasks.length) {
        task.subtasks = subtasks.map((s, i) => ({ title: s, done: status === 'done' || i === 0 }));
        await task.save();
      }
      if (status === 'done') {
        // Back-date completion so the analytics charts have history.
        await Task.collection.updateOne(
          { _id: task._id },
          {
            $set: { completedAt: inDays(-Math.floor(Math.random() * 40)), createdAt: inDays(-45) },
          },
        );
      }
      created.push(task);
    }

    const commenters = ['member', 'admin', 'rahim', 'owner'];
    const lines = [
      'Started on this today, will share a preview soon.',
      'Looks good! Can we double check the mobile layout?',
      'Blocked on the API change, pinging the backend folks.',
      'Done on my side, ready for review.',
    ];
    for (const [i, task] of created.slice(0, 12).entries()) {
      const author = people[commenters[i % commenters.length]];
      await taskService.createComment(workspace, task, author, {
        body: lines[i % lines.length],
        mentions: i % 3 === 0 ? [people.rahim.id] : [],
      });
    }

    console.log(
      `Seeded workspace "Team Phoenix" with ${created.length} tasks in database "team-sync".`,
    );
    console.log(
      `Log in as owner@teamphoenix.dev / admin@ / member@ / rahim@ / viewer@ (password ${PASSWORD})`,
    );
  }
} finally {
  await disconnectDb();
  await closeAuthDb();
}
