'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', match: (p: string) => p.startsWith('/dashboard') },
  { href: '/', label: 'Inbox', match: (p: string) => p === '/' || p.startsWith('/tickets') },
  { href: '/approvals', label: 'Approvals', match: (p: string) => p.startsWith('/approvals') },
  { href: '/simulate', label: 'Simulator', match: (p: string) => p.startsWith('/simulate') },
  { href: '/prompts', label: 'Prompts', match: (p: string) => p.startsWith('/prompts') },
  { href: '/ops', label: 'Ops', match: (p: string) => p.startsWith('/ops') },
  { href: '/lifecycle', label: 'Lifecycle', match: (p: string) => p.startsWith('/lifecycle') },
  { href: '/safety', label: 'Safety', match: (p: string) => p.startsWith('/safety') },
];

const ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
  '/': <path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z" />,
  '/approvals': <path d="M9 12l2 2 4-4M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  '/simulate': <path d="M6 4l14 8-14 8z" />,
  '/prompts': <path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" />,
  '/ops': <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  '/lifecycle': <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />,
  '/safety': <path d="M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6zM9 12l2 2 4-4" />,
};

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 md:flex-col" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.match(pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[l.href]}
            </svg>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
