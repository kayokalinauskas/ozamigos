-- Fase 1 do docs/plano-contas.md: contas com login pelo Google e pelo Discord.
-- O mínimo de dados pessoais: sem e-mail, sem senha, sem IP. Apagar o usuário apaga tudo dele (on delete cascade).

create table usuarios (
    id uuid primary key,
    -- O nome na sala: vem do provedor no primeiro login, e a pessoa muda (as regras do SinalizacaoHandler.nomeLimpo).
    nome text not null check (char_length(nome) between 1 and 40),
    -- A foto do provedor, baixada uma vez e reduzida no servidor (Imagens): ninguém da sala acessa o Google ou o Discord.
    foto bytea check (octet_length(foto) <= 16384),
    -- De onde veio a foto, para baixar de novo só quando ela mudar; e a versão, que entra no endereço (cache longo).
    foto_origem text,
    foto_versao integer not null default 0,
    criado_em timestamptz not null default now(),
    visto_em timestamptz not null default now()
);

-- Cada conta do Google ou do Discord ligada a um usuário: no máximo uma de cada provedor por usuário.
create table identidades (
    provedor text not null check (provedor in ('google', 'discord')),
    id_externo text not null check (char_length(id_externo) between 1 and 255),
    usuario_id uuid not null references usuarios (id) on delete cascade,
    criada_em timestamptz not null default now(),
    primary key (provedor, id_externo),
    unique (usuario_id, provedor)
);

-- As sessões: o cookie leva um segredo aleatório, e aqui fica só o resumo dele (SHA-256). Quem lesse o banco não
-- conseguiria se passar por ninguém.
create table sessoes (
    resumo bytea primary key check (octet_length(resumo) = 32),
    usuario_id uuid not null references usuarios (id) on delete cascade,
    aparelho text not null check (aparelho in ('navegador', 'app')),
    criada_em timestamptz not null default now(),
    usada_em timestamptz not null default now(),
    expira_em timestamptz not null
);
create index sessoes_por_usuario on sessoes (usuario_id);
create index sessoes_por_validade on sessoes (expira_em);
