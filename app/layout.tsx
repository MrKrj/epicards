import type { Metadata } from 'next';
import './style.css';
export const metadata: Metadata = { title: 'Epicards — Epitech', description: 'Collectionne les cartes de la vie Epitech.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fr"><body>{children}</body></html>; }
