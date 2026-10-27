-- Primeira migração (fase 0 do docs/plano-contas.md): só o sinal de vida do VidaDoBanco. As tabelas de contas,
-- servidores e salas chegam nas fases seguintes, cada uma na sua migração. Migração aplicada nunca muda: corrija com
-- uma nova.

-- Um dia por linha: o Supabase grátis pausa o projeto depois de 7 dias sem uso.
create table sinais_de_vida (
    dia date primary key
);
