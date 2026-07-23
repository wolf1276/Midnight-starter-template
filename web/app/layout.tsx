import type { Metadata } from 'next';
import { AppProviders } from '@/components/providers/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bulletin Board — Midnight Network',
  description: 'A privacy-preserving bulletin board dApp built on Midnight Network.',
  icons: { icon: '/icon.png' },
};

export default function RootLayout({ children }: Readonly<React.PropsWithChildren>) {
  return (
    <html lang="en">
      <body className="bg-[#464655] text-white">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
