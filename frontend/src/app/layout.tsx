import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gladius — 1v1 Subjective Skill Adjudication Arena",
  description: "Challenge opponents in subjective skill duels (coding, writing, design, math, and trivia). Stakes are secured in smart contracts and judged by decentralized AI consensus on GenLayer. Zero bias, instant payouts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
