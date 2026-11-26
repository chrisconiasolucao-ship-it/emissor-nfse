import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Emissor NFS-e · CHRISCON", description: "Emissão de NFS-e Nacional para clientes do Simples e MEI" };

export default function RaizLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
