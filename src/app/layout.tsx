import type { Metadata } from 'next';
import QueryProvider from '@/components/providers/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smart Workspace - AI Powered Team & Task Management',
  description: 'Enterprise AI Workspace platform with pgvector candidate search, adaptive task breakdown, and dynamic Kanban board.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#090d16] text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
