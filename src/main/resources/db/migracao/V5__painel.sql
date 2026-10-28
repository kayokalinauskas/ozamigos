-- O painel do dono (Painel, PainelApi): os banimentos e o registro do que o dono fez por ele.

-- Quem foi banido não entra mais, nem com a mesma conta do Google ou do Discord numa conta nova: o banimento é da
-- identidade do provedor, e fica mesmo se a conta for apagada (usuario_id vira null). O nome é o da conta na hora do
-- banimento, para a lista continuar dizendo quem é.
create table banimentos (
    provedor text not null check (provedor in ('google', 'discord')),
    id_externo text not null check (char_length(id_externo) between 1 and 255),
    usuario_id uuid references usuarios (id) on delete set null,
    nome text not null check (char_length(nome) between 1 and 40),
    banido_por uuid references usuarios (id) on delete set null,
    banido_em timestamptz not null default now(),
    primary key (provedor, id_externo)
);
create index banimentos_por_usuario on banimentos (usuario_id);

-- Cada ação do painel (apagar um servidor, banir, desbanir): quem fez, quando, e em quem ou em quê (o nome na hora).
create table acoes_do_painel (
    id bigserial primary key,
    quando timestamptz not null default now(),
    quem uuid references usuarios (id) on delete set null,
    acao text not null check (acao in ('apagar-servidor', 'banir', 'desbanir')),
    alvo text not null,
    nome_do_alvo text not null
);
