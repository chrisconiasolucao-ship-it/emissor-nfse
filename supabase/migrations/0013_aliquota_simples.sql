-- pTotTribSN: na DPS de ME/EPP a Sefin exige o percentual aproximado dos tributos pela alíquota do Simples Nacional
-- (E0712: "Para ME/EPP o indicador de informação de valor total de tributos não pode ser informado").
-- Fica no cadastro da empresa; o escritório mantém atualizado. MEI continua com indTotTrib = 0.
alter table public.empresa add column if not exists aliquota_simples numeric(5,2)
  check (aliquota_simples is null or (aliquota_simples >= 0 and aliquota_simples < 100));
comment on column public.empresa.aliquota_simples is 'Alíquota aproximada do Simples Nacional (%) informada em pTotTribSN na DPS (ME/EPP).';
