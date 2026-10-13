import { PrismaClient, Role, Department, Level, Complexity, ProjectStatus, TaskPriority, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

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

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@smartworkspace.com',
      passwordHash,
      fullName: 'Alex Morgan',
      role: Role.ADMIN,
      department: Department.FULLSTACK,
      level: Level.SENIOR,
      skills: ['TypeScript', 'Next.js', 'PostgreSQL', 'System Architecture'],
      bioSummary: 'Senior Tech Lead with 8+ years experience in building AI-powered Web Platforms.',
      teamId: teamAlpha.id,
    },
  });

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
      department: Department.FRONTEND,
      level: Level.JUNIOR,
      skills: ['React', 'Tailwind CSS', 'TypeScript', 'Shadcn UI'],
      bioSummary: 'Passionate Frontend Developer focused on interactive interfaces.',
      teamId: teamFrontend.id,
    },
  });

  const devopsUser = await prisma.user.create({
    data: {
      email: 'sarah.ops@smartworkspace.com',
      passwordHash,
      fullName: 'Sarah Connor',
      role: Role.LEADER,
      department: Department.DEVOPS,
      level: Level.MIDDLE,
      skills: ['Docker', 'Kubernetes', 'CI/CD', 'PostgreSQL', 'pgvector'],
      bioSummary: 'DevOps & Infrastructure Specialist.',
      teamId: teamAlpha.id,
    },
  });

  const projectSmart = await prisma.project.create({
    data: {
      name: 'Smart Workspace Platform',
      description: 'AI-driven task decomposition, dynamic team matching, and RAG candidate search.',
      requiredSkills: ['Next.js', 'Prisma', 'OpenAI', 'pgvector', 'Tailwind CSS'],
      complexity: Complexity.HARD,
      status: ProjectStatus.IN_PROGRESS,
      createdBy: adminUser.id,
      assignedTeamId: teamAlpha.id,
    },
  });

  await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: adminUser.id,
      title: 'Configure PostgreSQL Vector Extension & Schema',
      description: 'Setup pgvector extension in Prisma schema and integrate user embeddings.',
      priority: TaskPriority.URGENT,
      status: TaskStatus.DONE,
      requiredLevel: 'SENIOR',
      checklist: [
        { id: 'step-1', text: 'Update schema.prisma with pgvector extension', done: true },
        { id: 'step-2', text: 'Create seed file with test vector data', done: true },
      ],
    },
  });

  const task2 = await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: memberUser.id,
      title: 'Build Interactive Kanban Board Page',
      description: 'Implement drag and drop styled Kanban Board with TODO, IN_PROGRESS, REVIEW, DONE columns.',
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
      requiredLevel: 'JUNIOR',
      checklist: [
        { id: 'step-1', text: 'Build Column components', done: true },
        { id: 'step-2', text: 'Add Task cards with priority badges', done: false },
        { id: 'step-3', text: 'Connect API data hooks', done: false },
      ],
    },
  });

  await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      assignedTo: devopsUser.id,
      title: 'Dockerize Environment & PostgreSQL pgvector Container',
      description: 'Provide reproducible docker-compose config for local DB setup.',
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.DONE,
      requiredLevel: 'MIDDLE',
    },
  });

  await prisma.task.create({
    data: {
      projectId: projectSmart.id,
      parentTaskId: task2.id,
      assignedTo: memberUser.id,
      title: 'Integrate AI Task Breakdown Modal',
      description: 'Call /api/ai/breakdown-task to split complex tasks into actionable subtasks.',
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.TODO,
      requiredLevel: 'INTERN',
    },
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
