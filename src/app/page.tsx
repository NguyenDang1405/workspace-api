import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/projects/demo-project-id/kanban');
}
