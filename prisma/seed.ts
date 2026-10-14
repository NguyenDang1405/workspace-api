import { PrismaClient, Role, Department, Level, Complexity, ProjectStatus, TaskPriority, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Clean up existing data in dependency order
  await prisma.userSkillRating.deleteMany();
  await prisma.userSkillEvidence.deleteMany();
  await prisma.userSkillState.deleteMany();
  await prisma.talentAuditLog.deleteMany();
  await prisma.taskBlockHistory.deleteMany();
  await prisma.taskStatusHistory.deleteMany();
  await prisma.taskRequiredSkill.deleteMany();
  await prisma.taskDependency.deleteMany();
  await prisma.dispatchRecommendation.deleteMany();
  await prisma.taskDispatchLog.deleteMany();
  await prisma.dispatchRun.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.userToken.deleteMany();
  await prisma.userTalentProfile.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  // 2. Create Teams
  const teamAlpha = await prisma.team.create({
    data: {
      name: 'Alpha Engineering',
      description: 'Core Backend & AI Solutions Team',
    },
  });

  const teamFrontend = await prisma.team.create({
    data: {
      name: 'UX & Frontend Guild',
      description: 'UI/UX & Design Systems Specialists',
    },
  });

  // 3. Create Users with Talent Profiles
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@smartworkspace.com',
      passwordHash,
      fullName: 'Alex Morgan',
      role: Role.ADMIN,
      talentProfile: {
        create: {
          department: Department.FULLSTACK,
          level: Level.SENIOR,
          skills: ['TypeScript', 'Next.js', 'PostgreSQL', 'System Architecture'],
          bioSummary: 'Senior Tech Lead with 8+ years experience in building AI-powered Web Platforms.',
        },
      },
    },
  });

  // Set Alpha Engineering team leader
  await prisma.team.update({
    where: { id: teamAlpha.id },
    data: { leaderId: adminUser.id },
  });

  const memberUser = await prisma.user.create({
    data: {
      email: 'john.doe@smartworkspace.com',
      passwordHash,
      fullName: 'John Doe',
      role: Role.MEMBER,
      talentProfile: {
        create: {
          department: Department.FRONTEND,
          level: Level.JUNIOR,
          skills: ['React', 'Tailwind CSS', 'TypeScript', 'Shadcn UI'],
          bioSummary: 'Passionate Frontend Developer focused on interactive interfaces.',
        },
      },
    },
  });

  const devopsUser = await prisma.user.create({
    data: {
      email: 'sarah.ops@smartworkspace.com',
      passwordHash,
      fullName: 'Sarah Connor',
      role: Role.LEADER,
      talentProfile: {
        create: {
          department: Department.DEVOPS,
          level: Level.MIDDLE,
          skills: ['Docker', 'Kubernetes', 'CI/CD', 'PostgreSQL', 'pgvector'],
          bioSummary: 'DevOps & Infrastructure Specialist.',
        },
      },
    },
  });

  // 4. Create Team Memberships
  await prisma.teamMember.createMany({
    data: [
      { teamId: teamAlpha.id, userId: adminUser.id },
      { teamId: teamAlpha.id, userId: devopsUser.id },
      { teamId: teamFrontend.id, userId: memberUser.id },
    ],
  });

  // 5. Create Master Skills
  const skillsData = [
    { name: 'TypeScript' },
    { name: 'React' },
    { name: 'Next.js' },
    { name: 'PostgreSQL' },
    { name: 'Docker' },
  ];

  for (const s of skillsData) {
    await prisma.skill.create({ data: s });
  }

  // 6. Create Project
  const projectSmart = await prisma.project.create({
    data: {
      name: 'Smart Workspace Platform',
      description: 'AI-driven task decomposition, dynamic team matching, and RAG candidate search.',
      techStack: ['Next.js', 'Prisma', 'OpenAI', 'pgvector', 'Tailwind CSS'],
      complexity: Complexity.HARD,
      status: ProjectStatus.ACTIVE,
      ownerId: adminUser.id,
      teamId: teamAlpha.id,
    },
  });

  // 7. Create Tasks
  const task1 = await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: adminUser.id,
      title: 'Configure PostgreSQL Vector Extension & Schema',
      description: 'Setup pgvector extension in Prisma schema and integrate user embeddings.',
      targetDepartment: Department.BACKEND,
      requiredLevel: Level.SENIOR,
      estimatedHours: 8.0,
      priority: TaskPriority.URGENT,
      status: TaskStatus.DONE,
      startedAt: new Date(Date.now() - 24 * 3600 * 1000),
      completedAt: new Date(Date.now() - 18 * 3600 * 1000),
      isBlocked: false,
      checklist: [
        { id: 'step-1', text: 'Update schema.prisma with pgvector extension', done: true },
        { id: 'step-2', text: 'Create seed file with test vector data', done: true },
      ],
      statusHistories: {
        createMany: {
          data: [
            { fromStatus: 'TODO', toStatus: 'IN_PROGRESS', durationInPreviousStatusHours: 2.5, changedBy: adminUser.id },
            { fromStatus: 'IN_PROGRESS', toStatus: 'DONE', durationInPreviousStatusHours: 6.0, changedBy: adminUser.id },
          ],
        },
      },
    },
  });

  const task2 = await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: memberUser.id,
      title: 'Build Interactive Kanban Board Page',
      description: 'Implement drag and drop styled Kanban Board with TODO, IN_PROGRESS, REVIEW, DONE columns.',
      targetDepartment: Department.FRONTEND,
      requiredLevel: Level.JUNIOR,
      estimatedHours: 12.0,
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date(Date.now() - 12 * 3600 * 1000),
      isBlocked: true,
      blockReason: 'Waiting for design tokens approval from UX Guild',
      checklist: [
        { id: 'step-1', text: 'Build Column components', done: true },
        { id: 'step-2', text: 'Add Task cards with priority badges', done: false },
        { id: 'step-3', text: 'Connect API data hooks', done: false },
      ],
      statusHistories: {
        createMany: {
          data: [
            { fromStatus: 'TODO', toStatus: 'IN_PROGRESS', durationInPreviousStatusHours: 4.0, changedBy: memberUser.id },
          ],
        },
      },
    },
  });

  const task3 = await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: devopsUser.id,
      title: 'Dockerize Environment & PostgreSQL pgvector Container',
      description: 'Provide reproducible docker-compose config for local DB setup.',
      targetDepartment: Department.DEVOPS,
      requiredLevel: Level.MIDDLE,
      estimatedHours: 10.0,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.DONE,
      startedAt: new Date(Date.now() - 48 * 3600 * 1000),
      completedAt: new Date(Date.now() - 40 * 3600 * 1000),
      isBlocked: false,
      statusHistories: {
        createMany: {
          data: [
            { fromStatus: 'TODO', toStatus: 'IN_PROGRESS', durationInPreviousStatusHours: 1.0, changedBy: devopsUser.id },
            { fromStatus: 'IN_PROGRESS', toStatus: 'DONE', durationInPreviousStatusHours: 8.0, changedBy: devopsUser.id },
          ],
        },
      },
    },
  });

  await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      parentTaskId: task2.id,
      assignedTo: memberUser.id,
      title: 'Integrate AI Task Breakdown Modal',
      description: 'Call /api/ai/breakdown-task to split complex tasks into actionable subtasks.',
      targetDepartment: Department.FRONTEND,
      requiredLevel: Level.INTERN,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.TODO,
      isBlocked: false,
    },
  });

  // 8. Seed Dynamic Skill Ratings (Elo)
  await prisma.userSkillRating.createMany({
    data: [
      { userId: adminUser.id, skillName: 'PostgreSQL', ratingScore: 1350.00, tasksCompleted: 14, tasksRejected: 1 },
      { userId: adminUser.id, skillName: 'System Architecture', ratingScore: 1420.50, tasksCompleted: 18, tasksRejected: 0 },
      { userId: memberUser.id, skillName: 'React', ratingScore: 1245.00, tasksCompleted: 6, tasksRejected: 1 },
      { userId: memberUser.id, skillName: 'Tailwind CSS', ratingScore: 1290.00, tasksCompleted: 8, tasksRejected: 0 },
      { userId: devopsUser.id, skillName: 'Docker', ratingScore: 1380.00, tasksCompleted: 12, tasksRejected: 1 },
    ],
  });

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
