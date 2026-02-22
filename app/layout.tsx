import type { Metadata } from 'next';
import { DM_Mono, Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TCV — Token Cluster Visualizer',
  description: 'Visualize on-chain token transfer clusters on Avalanche C-Chain',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${outfit.variable} ${dmMono.variable} font-sans antialiased bg-void text-gray-200`}
      >
        {children}
      </body>
    </html>
  );
}
