"""Extrai as tabelas do IBS/CBS usadas na NFS-e a partir da base oficial da Calculadora de Tributos da Receita Federal.

Fonte: github.com/ReceitaFederal/calculadora-rtc-regime-regular (flyway/sql). Monte a base SQLite rodando, nesta ordem,
criacao/beforeMigrate.sql, criacao/B0001__sistema_tributario_completo.sql e cada manutencao/V*.sql dentro de uma
transação (BEGIN ... COMMIT), como o Flyway faz. Depois:

    python3 -I scripts/extrair-tabelas-rtc.py caminho/rtc.db

Grava data/catalogo/rtc_*.csv (só NFS-e, vigentes a partir de 07/12/2026). Em seguida: node scripts/gerar-catalogo.mjs.
"""
import csv
import sqlite3
import sys

DB = sqlite3.connect(sys.argv[1])
NFSE = 10  # TIPO_DFE.TPDF_ID da NFS-e
DESDE = "2026-12-07"
OUT = "data/catalogo/"


def gravar(nome, cab, linhas):
    with open(OUT + nome, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cab)
        w.writerows(linhas)
    print(nome, len(linhas))


def item(lc):
    p = lc.split(".")
    return p[0].zfill(2) + p[1].zfill(2) + (p[2].zfill(2) if len(p) > 2 else "")


q = lambda s, *a: DB.execute(s, a).fetchall()
vig = lambda p: f"({p}_FIM_VIGENCIA is null or {p}_FIM_VIGENCIA >= '{DESDE}')"

gravar(
    "rtc_cst.csv",
    ["codigo", "descricao", "exige_gibscbs"],
    q("select SITR_CD, SITR_DESCRICAO, SITR_IND_GIBSCBS from SITUACAO_TRIBUTARIA where SITR_ID <= 18 order by 1"),
)
gravar(
    "rtc_cclasstrib.csv",
    ["codigo", "cst", "nome", "tp_rbsn", "inicio_vigencia"],
    q(
        f"""select distinct c.CLTR_CD, s.SITR_CD, trim(c.CLTR_DESCRICAO), c.CLTR_TPRBSN, c.CLTR_INICIO_VIGENCIA
        from CLASSIFICACAO_TRIBUTARIA c join SITUACAO_TRIBUTARIA s on s.SITR_ID = c.CLTR_SITR_ID
        join TIPO_DFE_CLASSIFICACAO t on t.TDCL_CLTR_ID = c.CLTR_ID
        where s.SITR_ID <= 18 and t.TDCL_TPDF_ID = ? and {vig('c.CLTR')} and {vig('t.TDCL')} order by 1""",
        NFSE,
    ),
)
gravar(
    "rtc_indop.csv",
    ["codigo", "local_incidencia", "tipo_operacao", "inicio_vigencia"],
    q(f"select IOIC_CD, trim(IOIC_LOCAL_INCIDENCIA), trim(IOIC_TIPO_OPERACAO), IOIC_INICIO_VIGENCIA from INDICADOR_OPERACAO_IBS_CBS where {vig('IOIC')} order by 1"),
)
gravar(
    "rtc_correlacao.csv",
    ["item", "nbs", "ind_op", "cclasstrib", "inicio_vigencia"],
    sorted(
        {
            (item(lc), nbs, io, cc, ini)
            for lc, nbs, io, cc, ini in q(
                f"""select n.CNIL_LSLC_CD, n.CNIL_NBS_CD, i.IOIC_CD, c.CLTR_CD, n.CNIL_INICIO_VIGENCIA
                from CLASSIF_NBS_INDOP_LC n join INDICADOR_OPERACAO_IBS_CBS i on i.IOIC_ID = n.CNIL_IOIC_ID
                join CLASSIFICACAO_TRIBUTARIA c on c.CLTR_ID = n.CNIL_CLTR_ID where {vig('n.CNIL')}"""
            )
        }
    ),
)
gravar(
    "rtc_atividade_sn.csv",
    ["codigo", "anexo", "descricao"],
    q(
        f"""select a.ATSN_CATIVSN, a.ATSN_ROTULO_CURTO, trim(a.ATSN_DESCRICAO) from ATIVIDADE_SIMPLES_NACIONAL a
        join TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL t on t.TDAS_ATSN_ID = a.ATSN_ID
        where t.TDAS_TPDF_ID = ? and {vig('a.ATSN')} and {vig('t.TDAS')} order by 1""",
        NFSE,
    ),
)
