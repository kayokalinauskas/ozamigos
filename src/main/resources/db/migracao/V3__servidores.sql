-- Fase 2 do docs/plano-contas.md: servidores salvos, com membros e convites. Só para quem tem conta.
-- O dono não fica numa coluna do servidor: é o membro de papel 'dono' (um só, pelo índice abaixo), e passar a posse
-- é trocar dois papéis.

create table servidores (
    id uuid primary key,
    -- O endereço (/s/<codigo>): curto e aleatório, para não disputar nome com os grupos criados na hora (/nome).
    codigo text not null unique check (codigo ~ '^[A-Za-z0-9]{10}$'),
    nome text not null check (char_length(nome) between 1 and 40),
    -- Como a foto da conta: reduzido no servidor (Imagens), e a versão entra no endereço (cache longo).
    icone bytea check (octet_length(icone) <= 16384),
    icone_versao integer not null default 0,
    -- Membros (além do dono e dos admins) podem criar convites.
    membros_convidam boolean not null default true,
    criado_em timestamptz not null default now()
);

create table membros (
    servidor_id uuid not null references servidores (id) on delete cascade,
    usuario_id uuid not null references usuarios (id) on delete cascade,
    papel text not null check (papel in ('dono', 'admin', 'membro')),
    entrou_em timestamptz not null default now(),
    primary key (servidor_id, usuario_id)
);
create index membros_por_usuario on membros (usuario_id);
create unique index um_dono_por_servidor on membros (servidor_id) where papel = 'dono';

create table convites (
    codigo text primary key check (codigo ~ '^[A-Za-z0-9]{10}$'),
    servidor_id uuid not null references servidores (id) on delete cascade,
    -- Quem criou: sai junto com a conta dela (o convite continua valendo, sem autor).
    criado_por uuid references usuarios (id) on delete set null,
    criado_em timestamptz not null default now(),
    expira_em timestamptz,
    usos_maximos integer check (usos_maximos > 0),
    usos integer not null default 0
);
create index convites_por_servidor on convites (servidor_id);

-- Quem foi expulso não volta por convite nenhum até o dono ou um admin desfazer (decisão do dono, 28/10/2026).
create table bloqueios (
    servidor_id uuid not null references servidores (id) on delete cascade,
    usuario_id uuid not null references usuarios (id) on delete cascade,
    bloqueado_por uuid references usuarios (id) on delete set null,
    bloqueado_em timestamptz not null default now(),
    primary key (servidor_id, usuario_id)
);
