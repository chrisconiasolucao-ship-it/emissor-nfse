# Design do emissor (visual F · marca CHRISCON)

Fonte única das decisões visuais. Os valores vivem em `src/app/globals.css` (`:root`). Direção registrada em `.impeccable/surfaces/src-app-app-layout-tsx.md`.

## Mundo
- Modo: ferramenta de trabalho (Operate), uso no computador.
- Casca: faixa de ambiente no topo (laranja na restrita, verde na produção), menu lateral grafite fixo com o símbolo do logo, área de trabalho clara com cartões brancos de borda fina.
- Assinatura: nos cartões de empresa do painel, as barras do logo viram o faturamento autorizado dos últimos 6 meses, com o mês atual em azul.

## Cores (tokens)
| Token | Valor | Uso |
|---|---|---|
| `--primaria` | #1565D8 | ação principal, item selecionado, foco |
| `--primaria-escura` | #0B4FB3 | hover da ação |
| `--primaria-clara` | #E5EFFC | seleção, foco suave |
| `--grafite` | #1E252C | menu lateral, indicador de destaque |
| `--grafite-2` | #2B3441 | hover no menu, sigla neutra |
| `--fundo` | #F2F4F7 | fundo da área de trabalho |
| `--cartao` | #FFFFFF | cartões |
| `--texto` / `--suave` | #1C232C / #5F6B7A | texto e texto secundário |
| `--borda` / `--borda-forte` | #DDE2E9 / #C9D0DA | bordas de cartão e de campo |
| `--ok` / `--alerta` / `--erro` | #16794A / #A35A00 / #C0281C | estados (com fundos `-claro`) |

Azul só em ação e seleção; estados nunca usam o azul. Ainda sem tema escuro.

## Tipografia
Inter (next/font), 14,5px no corpo; h1 24px/700; números com `tabular-nums`. Código de tributação em monoespaçada (`.codigo`, formato 01.07.01).

## Componentes
- `.cartao` (raio 10px, borda 1px, sem sombra); `.indicador` / `.indicador.destaque`; `.empresa` com `.contagens`, `.barras`, `.empresa-pe`.
- Estados de nota: `.selo.<situacao>` em pílula (autorizada verde, na fila/enviando âmbar, rejeitada vermelho, cancelada/substituída riscada).
- Filtros em pílula (`.filtro[aria-current]`), tabelas dentro de cartão (`.tabela`), linha rejeitada tingida (`tr.com-erro`).
- Nova nota: três passos (`PassosNota`) com lista sempre visível e busca (`EscolherLista`), "Cadastrar novo" no fim da lista, item escolhido em `.escolhido` com "Trocar"; resumo fixo à direita.
- Botões: `button`/`.botao` (azul), `.secundario` (contorno), `.perigo` (vermelho), `.mini`.
