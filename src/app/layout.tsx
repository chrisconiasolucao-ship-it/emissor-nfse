import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--fonte-inter", display: "swap" });

export const metadata: Metadata = { title: "Emissor NFS-e · CHRISCON", description: "Emissão de NFS-e Nacional para clientes do Simples e MEI", icons: { icon: "/logo-chriscon.svg" } };

export default function RaizLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
