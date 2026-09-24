'use client';

import { useRouter } from 'next/navigation';
import { TableRow } from '@/components/ui/table';

// A table row that opens `href` when clicked (links inside the row still work on their own).
export default function ClickableRow({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <TableRow
      className={`cursor-pointer ${className}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button')) return;
        router.push(href);
      }}
    >
      {children}
    </TableRow>
  );
}
