# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Duas audiências usam as mesmas telas no dia a dia:

- **Equipe do escritório contábil CHRISCON** (papéis `escritorio_admin` e `escritorio_operador`): vê todas as empresas da sua base, cadastra empresas e certificados, importa municípios, acompanha a fila e os avisos, e emite notas em nome dos clientes.
- **Clientes do escritório** (papéis `cliente_admin` e `cliente_usuario`): empresários de ME, EPP e MEI do Simples Nacional. Veem só a própria empresa e emitem as próprias notas.

O trabalho principal de ambos é emitir uma NFS-e Nacional correta, sem retrabalho, e depois consultar, baixar (XML e DANFSe) ou cancelar.

## Product Purpose

Emissor de NFS-e no padrão nacional (Sefin/ADN da Receita) para várias empresas do Simples Nacional e MEI, operado por um escritório contábil. Existe porque a ferramenta de terceiro usada antes bloqueava municípios (ex.: Bagé/RS). Sucesso é emitir em qualquer município aderente, com fila, novas tentativas automáticas, certificado A1 guardado cifrado e trilha de auditoria.

## Positioning

Feito pelo próprio escritório para a sua carteira: um único sistema onde o contador enxerga todas as empresas e o cliente enxerga só a sua, com as regras do Simples (ME/EPP/MEI) já embutidas.

## Operating Context

- Uso no computador (desktop). Celular não é alvo nesta versão.
- Ambientes: teste (produção restrita da Receita) e produção; a tela mostra uma faixa "PRODUÇÃO RESTRITA" ou "PRODUÇÃO".
- Fluxo da nova nota: empresa → tomador → serviço, com lista clicável e busca (tomador por nome ou CPF/CNPJ, serviço por código ou nome) e "cadastrar novo" quando não achar.
- Telas atuais: painel, notas (lista, detalhe, nova), cadastros (tomadores e serviços), empresas (com certificado e usuários), municípios, importar (planilha até 30 notas), avisos.
- Stack: Next.js (App Router) na Vercel + Supabase.

## Capabilities and Constraints

- Só empresas ME, EPP ou MEI do Simples Nacional.
- Emissão assíncrona por fila, com novas tentativas (5/15/60 min); a tela precisa mostrar estados de nota (na fila, autorizada, rejeitada, cancelada) com clareza.
- DANFSe gerado pelo próprio sistema (API da Receita suspensa).
- Linguagem da interface: português do Brasil, termos fiscais oficiais (DPS, NFS-e, tomador, prestador, código de tributação nacional).
- Em aberto: envio da nota ao tomador pelo WhatsApp numa versão futura, depois que o uso no PC estiver estável.

## Brand Commitments

Usar a paleta do logo "CHRISCON I.A" (decisão do José, 26/11/2026): azul vivo da seta (~#1565D8, variando até ~#0B4FB3) para ações e seleção, e grafite azulado (~#1E252C a ~#2B3441) para o menu e áreas de destaque, sobre fundo claro. O símbolo do logo (seta e barras) pode aparecer no menu. Códigos exatos de cor podem vir do José depois; quando vierem, eles valem.

## Evidence on Hand

- Exemplos de layout em 3 estilos (A clara, B menu lateral, C cartões grandes): `/mnt/project-files/visual-cards/exemplos-visual.html`. José não aprovou A–E; pediu as cores da marca. Direções F (marca clara) e G (marca escura) no mesmo arquivo.
- Especificação SDD do emissor (brainstorm, define, design) fora do repositório, na pasta do projeto.
- Não há depoimentos, clientes citáveis ou números públicos; não inventar.

## Product Principles

1. Correção fiscal antes de velocidade: nada na tela pode induzir a emitir nota errada.
2. O estado de cada nota é sempre visível e explicado em linguagem simples, inclusive falhas da Receita.
3. A mesma tela serve ao contador (muitas empresas) e ao empresário (uma empresa); o escopo muda, o fluxo não.
4. Menos digitação: escolher de listas e cadastros antes de pedir texto livre.
